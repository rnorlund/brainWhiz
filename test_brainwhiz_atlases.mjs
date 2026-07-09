// brainWhiz atlas + feature coverage — ship-readiness smoke across EVERY bundled atlas, plus
// feature depth (render modes, overlays, connectivity, tracts, PNG export) on representatives.
// Prereq: static server on :8777 (python3 -m http.server 8777). Run: node test_brainwhiz_atlases.mjs
import { createRequire } from 'module'; import path from 'path'; import fs from 'fs'; import os from 'os';
const REPO = path.dirname(new URL(import.meta.url).pathname);
const require = createRequire(path.join(REPO, 'test_molwhiz.mjs'));
const { chromium } = require('playwright');
const BASE = 'http://localhost:8777/index.html';
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'bwatlas-'));

// enumerate atlases straight from the registry the app uses
globalThis.window = {}; require(path.join(REPO,'bundles','registry.js'));
const ATLASES = globalThis.window.ATLAS_REGISTRY.map(a=>({id:a.id, nroi:a.nroi, name:a.name, has:a.has||{}}));
delete globalThis.window;

let PASS=0, FAIL=0; const FAILURES=[];
function ok(name, cond, extra=''){ if(cond){PASS++;} else {FAIL++; FAILURES.push(name+(extra?' — '+extra:''));} console.log(`  ${cond?'✅':'❌'} ${name}${!cond&&extra?' — '+extra:''}`); }

let browser;
async function instance(atlas){
  const ctx = await browser.newContext({ viewport:{width:1200,height:820}, deviceScaleFactor:1, acceptDownloads:true });
  const page = await ctx.newPage(); const errs=[]; page.on('pageerror',e=>errs.push(String(e)));
  await page.goto(BASE+'?atlas='+atlas, { waitUntil:'load' });
  await page.waitForFunction(()=>window.brainAPI && window.brainAPI.ready, { timeout:30000 });
  await page.evaluate(()=>window.brainAPI.ready); await page.waitForTimeout(500);
  page._errs=errs; return page;
}
// fraction of non-transparent pixels in a transparent-bg render (proves geometry drew)
async function coverage(page, w=420, h=340){
  return await page.evaluate(({w,h})=>{ const url=window.brainAPI.renderTo(w,h,true);
    return new Promise(res=>{ const im=new Image(); im.onload=()=>{ const c=document.createElement('canvas');c.width=im.naturalWidth;c.height=im.naturalHeight;
      const x=c.getContext('2d'); x.drawImage(im,0,0); const d=x.getImageData(0,0,c.width,c.height).data; let n=0,t=0;
      for(let i=0;i<d.length;i+=4){ t++; if(d[i+3]>20) n++; } res(Math.round(n/t*100)); }; im.src=url; }); }, {w,h});
}

(async ()=>{
  browser = await chromium.launch({ headless:true, args:['--use-gl=angle','--use-angle=swiftshader','--ignore-gpu-blocklist'] });

  // ============ TIER 1: boot health for ALL atlases ============
  console.log(`\n[TIER 1] boot health — ${ATLASES.length} atlases (load, region count, render, view modes, overlay)`);
  for(const a of ATLASES){
    console.log(`\n • ${a.id} (${a.name})`);
    let page;
    try { page = await instance(a.id); }
    catch(e){ ok(`${a.id}: boots`, false, e.message); continue; }
    ok(`${a.id}: brainAPI.ready resolved`, true);
    // region count matches the registry
    const n = await page.evaluate(()=>window.brainAPI.labels().length);
    ok(`${a.id}: region count = nroi (${a.nroi})`, n===a.nroi, `got ${n}`);
    // mesh renders geometry (sparse network atlases like Fox cover only a few %, so just require >0)
    const cov = await coverage(page);
    ok(`${a.id}: mesh render has geometry`, cov>=1, `coverage ${cov}%`);
    // view modes switch without throwing
    const modes = await page.evaluate(async ()=>{ const out={};
      try{ window.brainAPI.setViewMode('slice'); await new Promise(r=>setTimeout(r,250)); out.slice=true; }catch(e){ out.slice='ERR:'+e.message; }
      try{ window.brainAPI.setViewMode('mosaic'); await new Promise(r=>setTimeout(r,250)); out.mosaic=true; }catch(e){ out.mosaic='ERR:'+e.message; }
      try{ window.brainAPI.setViewMode('mesh'); await new Promise(r=>setTimeout(r,150)); out.mesh=true; }catch(e){ out.mesh='ERR:'+e.message; }
      return out; });
    ok(`${a.id}: slice mode ok`, modes.slice===true, String(modes.slice));
    ok(`${a.id}: mosaic mode ok`, modes.mosaic===true, String(modes.mosaic));
    // mosaic canvas actually has content
    const mos = await page.evaluate(()=>{ const c=document.getElementById('mosaicCanvas'); return c?{w:c.width,h:c.height}:null; });
    ok(`${a.id}: mosaic canvas sized`, mos && mos.w>0 && mos.h>0, JSON.stringify(mos));
    // overlay colors a region (use the LAST available region so tiny atlases like Fox (10 ROIs) still work)
    const colored = await page.evaluate(async ()=>{ const ids=window.brainAPI.labels().map(o=>o.id); const N=ids.length;
      const vals={}; ids.forEach((id,i)=>vals[id]=i); window.brainAPI.setRegionValues(vals,'t');
      window.brainAPI.styleActiveOverlay({style:'cmap',cmap:'YlOrRd',cmin:0,cmax:N-1,cthresh:0});
      await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
      return window.brainAPI.regionColor(ids[N-1]); });
    ok(`${a.id}: overlay colors a region (warm)`, (()=>{ if(!colored) return false; const r=parseInt(colored.slice(1,3),16),b=parseInt(colored.slice(5,7),16); return r>120&&r>b+25; })(), 'color='+colored);
    ok(`${a.id}: no page errors`, page._errs.length===0, page._errs.slice(0,2).join(' | '));
    await page.context().close();
  }

  // ============ TIER 2: connectivity (atlases that have it) ============
  console.log('\n[TIER 2] connectivity — DTI (jhu, aicha) + RS');
  for(const a of ATLASES.filter(x=>x.has.dti || x.has.rs)){
    const page = await instance(a.id);
    const r = await page.evaluate(async ()=>{ const out={opts:[]};
      const sel=document.getElementById('connType'); out.opts=sel?[...sel.options].map(o=>o.value):[];
      const on=document.getElementById('connOn'); if(on){ on.checked=true; on.dispatchEvent(new Event('change')); }
      await new Promise(r=>setTimeout(r,400)); out.ok=true; return out; }).catch(e=>({ok:false,err:e.message}));
    const want = [a.has.dti&&'dti', a.has.rs&&'rs'].filter(Boolean);
    ok(`${a.id}: conn modalities present [${want}]`, r.ok && want.every(w=>r.opts.includes(w)), 'opts='+JSON.stringify(r&&r.opts));
    ok(`${a.id}: enabling connectivity doesn't error`, r.ok && page._errs.length===0, page._errs.slice(0,1).join());
    await page.context().close();
  }

  // ============ TIER 3: white-matter tract streamlines (Load button) ============
  console.log('\n[TIER 3] white-matter tract streamlines — real Load button on a cortical atlas');
  {
    const page = await instance('jhu');   // load XTRACT tracts as an overlay on a cortical atlas
    const before = await coverage(page);
    const r = await page.evaluate(async ()=>{
      const sel=document.getElementById('tractAtlas'); if(sel) sel.value='xtract';
      document.getElementById('tractLoad').click();
      await new Promise(r=>setTimeout(r,2800));
      return { listRows: document.getElementById('tractList').children.length,
               count: (document.getElementById('tractCount')||{}).textContent||'' };
    }).catch(e=>({err:e.message}));
    const after = await coverage(page);
    ok('tracts: Load populates the tract list', r.listRows>0, JSON.stringify(r));
    ok('tracts: loading changes the scene (adds geometry)', after!==before, `cov ${before}%→${after}%`);
    ok('tracts: no errors during load', page._errs.length===0, page._errs.slice(0,2).join(' | '));
    await page.context().close();
  }

  // ============ TIER 4: figure PNG export (real Export button) ============
  console.log('\n[TIER 4] figure export — PNG via the Panels Export button');
  {
    const page = await instance('neuromorph');
    await page.evaluate(async ()=>{ const labs=window.brainAPI.labels(); const vals={}; labs.slice(0,30).forEach((o,i)=>vals[o.id]=i);
      window.brainAPI.setRegionValues(vals,'t'); window.brainAPI.styleActiveOverlay({style:'cmap',cmap:'viridis',cmin:0,cmax:29});
      window.brainAPI.pbGrid(1,2); await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
      window.brainAPI.pbCapturePanel(0); window.brainAPI.pbCapturePanel(1);
      const t=document.getElementById('pbToggle'); if(t) t.click(); });
    await page.selectOption('#pbFormat','png').catch(()=>{});
    let pngOk=false;
    try{ const [dl]=await Promise.all([ page.waitForEvent('download',{timeout:15000}), page.click('#pbExport') ]);
      const out=path.join(TMP,'export.png'); await dl.saveAs(out); pngOk = fs.statSync(out).size>2000; }catch(e){ pngOk=false; }
    ok('PNG export downloads a non-empty file', pngOk);
    ok('no errors during export', page._errs.length===0, page._errs.slice(0,2).join(' | '));
    await page.context().close();
  }

  await browser.close();
  console.log(`\n──────── ATLAS/FEATURE RESULTS: ${PASS} passed, ${FAIL} failed ────────`);
  if(FAIL){ console.log('FAILURES:'); FAILURES.forEach(f=>console.log('  • '+f)); process.exit(1); }
  process.exit(0);
})().catch(e=>{ console.error('HARNESS ERROR:', e); process.exit(2); });
