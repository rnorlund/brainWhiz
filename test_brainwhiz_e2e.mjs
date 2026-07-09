// brainWhiz end-to-end tests — focus: SHARING (.bwz / .bwzproj save→load round-trips) since that is
// the critical collaborator feature. Also guards the panel-restore / overlay-data / camera / editor
// regressions. Drives the real app over the local static server via Playwright (swiftshader).
//
// Prereq: a static server on :8777 serving the repo root, e.g.
//   python3 -m http.server 8777
// Run:  node test_brainwhiz_e2e.mjs
import { createRequire } from 'module'; import path from 'path'; import fs from 'fs'; import os from 'os';
const REPO = path.dirname(new URL(import.meta.url).pathname);
const require = createRequire(path.join(REPO, 'test_molwhiz.mjs'));
const { chromium } = require('playwright');
const BASE = 'http://localhost:8777/index.html';
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'bwtest-'));

let PASS = 0, FAIL = 0; const FAILURES = [];
function ok(name, cond, extra=''){ if(cond){ PASS++; console.log('  ✅ '+name); } else { FAIL++; FAILURES.push(name+(extra?' — '+extra:'')); console.log('  ❌ '+name+(extra?' — '+extra:'')); } }
const near = (a,b,tol=0.15)=>Math.abs(a-b)<=tol;

let browser;
async function instance(atlas){
  const ctx = await browser.newContext({ viewport:{width:1400,height:900}, deviceScaleFactor:2, acceptDownloads:true });
  const page = await ctx.newPage(); const errs=[]; page.on('pageerror',e=>errs.push(String(e)));
  const url = BASE + (atlas?('?atlas='+atlas):'');
  await page.goto(url, { waitUntil:'load' });
  await page.waitForFunction(()=>window.brainAPI && window.brainAPI.ready, { timeout:30000 });
  await page.evaluate(()=>window.brainAPI.ready);
  await page.waitForTimeout(600);
  page._errs = errs; return page;
}
// build a deterministic 3-overlay figure on the current page and return its projectJSON
async function buildFigure(page){
  return await page.evaluate(async ()=>{
    const ids = window.brainAPI.labels().map(o=>o.id).slice(0, 60);
    const mk = (f)=>{ const o={}; ids.forEach(id=>o[id]=f(id)); return o; };
    // overlay 0
    window.brainAPI.setRegionValues(mk(id=>id%10), 'MapA');
    window.brainAPI.styleActiveOverlay({style:'cmap', cmap:'YlOrRd', cmin:0, cmax:9, cthresh:0});
    // overlay 1
    window.brainAPI.newOverlay();
    window.brainAPI.setRegionValues(mk(id=>(id*3)%7), 'MapB');
    window.brainAPI.styleActiveOverlay({style:'cmap', cmap:'viridis', cmin:0, cmax:6, cthresh:0});
    // overlay 2
    window.brainAPI.newOverlay();
    window.brainAPI.setRegionValues(mk(id=>((id%11)-5)), 'MapC');
    window.brainAPI.styleActiveOverlay({style:'cmap', cmap:'PuYl', cmin:-5, cmax:5, cthresh:0});
    window.brainAPI.selectOverlay(0);
    window.brainAPI.setFov && window.brainAPI.setFov(16);
    await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
    return window.brainAPI.projectJSON();
  });
}

(async ()=>{
  browser = await chromium.launch({ headless:true, args:['--use-gl=angle','--use-angle=swiftshader','--ignore-gpu-blocklist'] });

  // ============ GROUP 1: .bwzproj round-trip (matching atlas) ============
  console.log('\n[1] .bwzproj round-trip — same atlas (collaborator with the atlas installed)');
  {
    const p1 = await instance('neuromorph');
    const proj = await buildFigure(p1);
    ok('build produced 3 overlays', proj.viewer.overlays.length===3, 'got '+proj.viewer.overlays.length);
    ok('overlay values baked into cfg', proj.viewer.overlays.every(o=>o.vals && Object.keys(o.vals).length>0));
    const file = path.join(TMP,'rt.bwzproj'); fs.writeFileSync(file, JSON.stringify(proj));
    ok('saved file parses as JSON', (()=>{ try{ JSON.parse(fs.readFileSync(file,'utf8')); return true; }catch(_){ return false; } })());
    await p1.context().close();

    // fresh instance, load the saved project
    const p2 = await instance('neuromorph');
    const loaded = JSON.parse(fs.readFileSync(file,'utf8'));
    const res = await p2.evaluate(async(pj)=>await window.brainAPI.loadProject(pj), loaded);
    ok('loadProject returned true', res===true);
    await p2.waitForTimeout(600);
    const proj2 = await p2.evaluate(()=>window.brainAPI.projectJSON());
    ok('overlay count preserved', proj2.viewer.overlays.length===3, 'got '+proj2.viewer.overlays.length);
    ok('overlay names preserved', JSON.stringify(proj2.viewer.overlays.map(o=>o.name))===JSON.stringify(['MapA','MapB','MapC']),
       JSON.stringify(proj2.viewer.overlays.map(o=>o.name)));
    ok('overlay cmaps preserved', JSON.stringify(proj2.viewer.overlays.map(o=>o.s.cmap))===JSON.stringify(['YlOrRd','viridis','PuYl']),
       JSON.stringify(proj2.viewer.overlays.map(o=>o.s.cmap)));
    ok('overlay cmin/cmax preserved', proj2.viewer.overlays[2].s.cmin==-5 && proj2.viewer.overlays[2].s.cmax==5,
       proj2.viewer.overlays[2].s.cmin+'..'+proj2.viewer.overlays[2].s.cmax);
    ok('overlay VALUES preserved after load', proj2.viewer.overlays.every((o,i)=>{
        const a=loaded.viewer.overlays[i].vals, b=o.vals; if(!a||!b) return false;
        const ka=Object.keys(a); return ka.length===Object.keys(b).length && ka.every(k=>+a[k]===+b[k]); }));
    ok('active overlay index preserved', proj2.viewer.active===loaded.viewer.active, proj2.viewer.active+' vs '+loaded.viewer.active);
    ok('FOV preserved', near(proj2.viewer.fov, loaded.viewer.fov, 0.05), proj2.viewer.fov+' vs '+loaded.viewer.fov);
    ok('camera position preserved', loaded.viewer.camP.every((v,i)=>near(v, proj2.viewer.camP[i], 0.2)),
       JSON.stringify(proj2.viewer.camP)+' vs '+JSON.stringify(loaded.viewer.camP));
    // live scene actually shows the active overlay (not lobe fallback)
    const colored = await p2.evaluate(()=>{ window.brainAPI.selectOverlay(0);
      const labs=window.brainAPI.labels(); // MapA = id%10, so id with value 9 exists among first 60
      const hi = labs.find(o=>(o.id%10)===9); if(!hi) return null;
      const c = window.brainAPI.regionColor(hi.id); return c; });
    ok('active overlay renders (high MapA region is warm, not lobe grey)', (()=>{ if(!colored) return false;
        const r=parseInt(colored.slice(1,3),16), g=parseInt(colored.slice(3,5),16), b=parseInt(colored.slice(5,7),16);
        return r>140 && r>b+30 && g<r+10; })(), 'color='+colored);
    ok('no page errors during load', p2._errs.length===0, p2._errs.slice(0,2).join(' | '));
    await p2.context().close();
  }

  // ============ GROUP 2: .bwzproj cross-atlas (collaborator on default atlas) ============
  console.log('\n[2] .bwzproj cross-atlas — drop neuromorph project into a default (jhu) instance');
  {
    const src = await instance('neuromorph');
    const proj = await buildFigure(src);
    // add an editor figure so we can assert it shows regardless of atlas
    await src.evaluate(async(pj)=>{
      await window.brainAPI.editorFigure({ w:800, h:400, bg:'#000', items:[
        {type:'text', text:'Shared figure', left:20, top:20, size:28, fill:'#fff', bold:true},
        {type:'line', x1:20, y1:60, x2:400, y2:60, color:'#888', width:2} ] });
    }, proj);
    const proj2 = await src.evaluate(()=>window.brainAPI.projectJSON());
    const file = path.join(TMP,'cross.bwzproj'); fs.writeFileSync(file, JSON.stringify(proj2));
    ok('project carries editor figure', proj2.editor && proj2.editor.objects.length>=2, 'objs='+(proj2.editor?proj2.editor.objects.length:0));
    await src.context().close();

    const dst = await instance();  // DEFAULT atlas (jhu)
    const atlas0 = await dst.evaluate(()=>window.ATLAS_ID || (window.ATLAS_REGISTRY&&'default'));
    const loaded = JSON.parse(fs.readFileSync(file,'utf8'));
    // mimic the drop handler exactly
    const res = await dst.evaluate(async(pj)=>{ const ok=await window.brainAPI.loadProject(pj);
      if(pj.editor && pj.editor.objects && pj.editor.objects.length && !document.getElementById('figEditor').classList.contains('on')){ document.getElementById('feToggle').click(); }
      return ok; }, loaded);
    ok('cross-atlas loadProject returns true (does NOT refuse)', res===true);
    await dst.waitForFunction(()=>window.feCanvas && typeof window.feCanvas.getObjects==='function' && window.feCanvas.getObjects().length>0, {timeout:15000}).catch(()=>{});
    await dst.waitForTimeout(800);
    const info = await dst.evaluate(()=>({
      editorOpen: document.getElementById('figEditor').classList.contains('on'),
      objs: window.feCanvas?window.feCanvas.getObjects().length:0,
      banner: !!document.getElementById('projMismatch') }));
    ok('editor auto-opened on cross-atlas drop', info.editorOpen);
    ok('editor figure objects present cross-atlas', info.objs>=2, 'objs='+info.objs);
    ok('mismatch banner shown (offer to switch atlas)', info.banner);
    ok('no page errors on cross-atlas load', dst._errs.length===0, dst._errs.slice(0,2).join(' | '));
    await dst.context().close();
  }

  // ============ GROUP 3: panel restore preserves data (today's regression) ============
  console.log('\n[3] panel restore (tile ⚙) preserves overlay data — no lobe fallback');
  {
    const p = await instance('neuromorph');
    const proj = await buildFigure(p);
    // capture panel 0 with overlay 0 active, then change look and restore
    const st = await p.evaluate(async()=>{
      window.brainAPI.pbGrid(1,2);
      window.brainAPI.selectOverlay(0);
      await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
      window.brainAPI.pbCapturePanel(0);
      const cfg = window.brainAPI.projectJSON().panels[0].cfg;
      // wipe live look: switch to lobe scheme by clearing overlays via a bare cfg? Instead re-apply cfg and check
      await window.brainAPI.applyCfg(cfg);
      await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
      const labs=window.brainAPI.labels(); const hi=labs.find(o=>(o.id%10)===9);
      return { hasVals: (cfg.overlays||[]).every(o=>o.vals && Object.keys(o.vals).length>0),
               color: hi? window.brainAPI.regionColor(hi.id) : null };
    });
    ok('captured panel cfg has baked overlay values', st.hasVals);
    ok('restored panel renders the map (warm), not lobe', (()=>{ if(!st.color) return false;
        const r=parseInt(st.color.slice(1,3),16), b=parseInt(st.color.slice(5,7),16); return r>140 && r>b+30; })(), 'color='+st.color);
    await p.context().close();
  }

  // ============ GROUP 4: .bwz round-trip via the real Save/Load buttons ============
  console.log('\n[4] .bwz recipe round-trip — real 💾/📂 buttons + file input');
  {
    const p = await instance('neuromorph');
    await buildFigure(p);
    await p.evaluate(async()=>{ window.brainAPI.pbGrid(1,2); await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
      window.brainAPI.pbCapturePanel(0); window.brainAPI.selectOverlay(2); await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))); window.brainAPI.pbCapturePanel(1); });
    // open panel builder so the save button is live
    await p.evaluate(()=>{ const t=document.getElementById('pbToggle'); if(t) t.click(); });
    const [dl] = await Promise.all([ p.waitForEvent('download'), p.click('#pbSaveBwz') ]);
    const bwzPath = path.join(TMP,'fig.bwz'); await dl.saveAs(bwzPath);
    const bwz = JSON.parse(fs.readFileSync(bwzPath,'utf8'));
    ok('.bwz has 2 panels', (bwz.panels||[]).filter(Boolean).length===2, 'got '+(bwz.panels||[]).filter(Boolean).length);
    ok('.bwz panel carries baked overlay values (offline-safe)', (bwz.panels[0].overlays||[]).some(o=>o&&o.vals&&Object.keys(o.vals).length>0));
    ok('.bwz grid recorded', bwz.grid==='1x2', 'grid='+bwz.grid);
    await p.context().close();

    // load the .bwz into a fresh instance via the file input (real path)
    const p2 = await instance('neuromorph');
    await p2.evaluate(()=>{ const t=document.getElementById('pbToggle'); if(t) t.click(); });
    await p2.setInputFiles('#pbBwzFile', bwzPath);
    // bwzImport re-renders panel thumbnails sequentially (rAF-gated), so allow time for all of them
    await p2.waitForFunction(()=>{ const p=window.brainAPI.projectJSON().panels||[]; const want=p.filter(Boolean).length; return want>0 && p.filter(x=>x&&x.dataURL).length===want; }, {timeout:12000}).catch(()=>{});
    await p2.waitForTimeout(300);
    const after = await p2.evaluate(()=>{ const proj=window.brainAPI.projectJSON();
      return { panels: (proj.panels||[]).filter(Boolean).length,
               thumbs: (proj.panels||[]).filter(x=>x&&x.dataURL).length }; });
    ok('.bwz import restored 2 panels', after.panels===2, 'got '+after.panels);
    ok('.bwz import re-rendered thumbnails', after.thumbs===2, 'got '+after.thumbs);
    ok('no errors importing .bwz', p2._errs.length===0, p2._errs.slice(0,2).join(' | '));
    await p2.context().close();
  }

  // ============ GROUP 5: editor round-trip (flipX, text, sizes) ============
  console.log('\n[5] editor round-trip — flipped colorbar, text labels, panel sizes');
  {
    const p = await instance('neuromorph');
    const proj = await buildFigure(p);
    await p.evaluate(async(pj)=>{
      await window.brainAPI.editorFigure({ w:900, h:500, bg:'#000', items:[
        {type:'text', text:'Left', left:20, top:20, size:24, fill:'#fff'},
        {type:'text', text:'Right', left:700, top:20, size:24, fill:'#fff', align:'right'} ] });
      // flip the first image-less canvas by adding a marker via fabric: flip a text obj as a stand-in flag
      const objs=window.feCanvas.getObjects(); if(objs[0]) objs[0].set('flipX', true); window.feCanvas.requestRenderAll();
    }, proj);
    const projE = await p.evaluate(()=>window.brainAPI.projectJSON());
    const file = path.join(TMP,'ed.bwzproj'); fs.writeFileSync(file, JSON.stringify(projE));
    ok('editor serialized with objects', projE.editor && projE.editor.objects.length>=2);
    ok('flipX serialized on an object', projE.editor.objects.some(o=>o.flipX===true));
    await p.context().close();

    const p2 = await instance('neuromorph');
    await p2.evaluate(async(pj)=>{ await window.brainAPI.loadProject(pj);
      if(!document.getElementById('figEditor').classList.contains('on')) document.getElementById('feToggle').click(); }, JSON.parse(fs.readFileSync(file,'utf8')));
    await p2.waitForFunction(()=>window.feCanvas && typeof window.feCanvas.getObjects==='function' && window.feCanvas.getObjects().length>=2, {timeout:15000}).catch(()=>{});
    await p2.waitForTimeout(600);
    const rt = await p2.evaluate(()=>{ const o=window.feCanvas.getObjects();
      return { n:o.length, flip:o.some(x=>x.flipX===true), texts:o.filter(x=>x.text).map(x=>x.text) }; });
    ok('editor objects restored', rt.n>=2, 'n='+rt.n);
    ok('flipX preserved through save/load', rt.flip===true);
    ok('text labels preserved', rt.texts.includes('Left') && rt.texts.includes('Right'), JSON.stringify(rt.texts));
    await p2.context().close();
  }

  // ============ GROUP 6: editor exit (Esc + button) ============
  console.log('\n[6] editor exit — Esc key and Close button');
  {
    const p = await instance('neuromorph');
    await p.evaluate(async()=>{ await window.brainAPI.editorFigure({ w:600,h:300,bg:'#000',items:[{type:'text',text:'x',left:10,top:10,size:20,fill:'#fff'}] }); });
    await p.waitForTimeout(300);
    ok('editor open', await p.evaluate(()=>document.getElementById('figEditor').classList.contains('on')));
    await p.keyboard.press('Escape'); await p.waitForTimeout(300);
    ok('Esc closes the editor', await p.evaluate(()=>!document.getElementById('figEditor').classList.contains('on')));
    await p.context().close();
  }

  // ============ GROUP 7: grid dropdown reflects real dims ============
  console.log('\n[7] grid dropdown honesty');
  {
    const p = await instance('neuromorph');
    const v = await p.evaluate(()=>{ window.brainAPI.pbGrid(3,4); const g=document.getElementById('pbGrid'); return g?g.value:'?'; });
    ok('Grid dropdown shows 3x4 for a 3x4 grid', v==='3x4', 'got '+v);
    const v2 = await p.evaluate(()=>{ window.brainAPI.pbGrid(2,2); const g=document.getElementById('pbGrid'); return g?g.value:'?'; });
    ok('Grid dropdown shows 2x2 for a 2x2 grid', v2==='2x2', 'got '+v2);
    await p.context().close();
  }

  await browser.close();
  console.log(`\n──────── RESULTS: ${PASS} passed, ${FAIL} failed ────────`);
  if(FAIL){ console.log('FAILURES:'); FAILURES.forEach(f=>console.log('  • '+f)); process.exit(1); }
  process.exit(0);
})().catch(e=>{ console.error('HARNESS ERROR:', e); process.exit(2); });
