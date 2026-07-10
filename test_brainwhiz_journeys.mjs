// brainWhiz JOURNEY tests — cross-mode & cross-reload behaviors that unit-per-control tests miss.
// These cover the classes of bug real usage surfaces: a setting changed in one VIEW refreshing that
// view, and state (or its absence) surviving a page reload / atlas switch.
// Prereq: static server on :8777. Run: node test_brainwhiz_journeys.mjs
import { createRequire } from 'module'; import path from 'path';
const REPO = path.dirname(new URL(import.meta.url).pathname);
const require = createRequire(path.join(REPO, 'test_molwhiz.mjs'));
const { chromium } = require('playwright');
const BASE='http://localhost:8777/index.html';

let PASS=0, FAIL=0; const FAILURES=[];
function ok(name, cond, extra=''){ if(cond){PASS++;} else {FAIL++; FAILURES.push(name+(extra?' — '+extra:''));} console.log(`  ${cond?'✅':'❌'} ${name}${!cond&&extra?' — '+extra:''}`); }

(async ()=>{
  const b=await chromium.launch({headless:true,args:['--use-gl=angle','--use-angle=swiftshader','--ignore-gpu-blocklist']});
  const ctx=await b.newContext({viewport:{width:1400,height:900},deviceScaleFactor:1}); const p=await ctx.newPage();
  const errs=[]; p.on('pageerror',e=>errs.push(String(e)));
  const boot=async(url)=>{ await p.goto(url,{waitUntil:'load'}); await p.waitForFunction(()=>window.brainAPI&&window.brainAPI.ready,{timeout:30000}); await p.evaluate(()=>window.brainAPI.ready); await p.waitForTimeout(700); };

  // ---- 1) slice/mosaic views auto-refresh when a setting changes (no manual click needed) ----
  console.log('\n[1] Slice view refreshes on a setting change (hemisphere) without a manual click');
  await boot(BASE+'?atlas=neuromorph');
  await p.evaluate(async()=>{ const labs=window.brainAPI.labels(); const vals={}; labs.forEach((o,i)=>vals[o.id]=(i%20)-10);
    window.brainAPI.setRegionValues(vals,'t'); window.brainAPI.styleActiveOverlay({style:'cmap',cmap:'viridis',cmin:-10,cmax:10});
    window.brainAPI.setViewMode('slice'); await new Promise(r=>setTimeout(r,300)); document.getElementById('slKindMeshVox').click(); await new Promise(r=>setTimeout(r,500)); });
  const sliceHash=()=>p.evaluate(()=>{ let s=''; for(const id of ['slSag','slCor','slAxi']){ const c=document.getElementById(id); if(c&&c.toDataURL) s+=c.toDataURL(); } let h=0; for(let i=0;i<s.length;i++)h=(h*31+s.charCodeAt(i))>>>0; return h; });
  await p.evaluate(()=>document.getElementById('hemiL').click()); await p.waitForTimeout(500);
  const hL=await sliceHash();
  await p.evaluate(()=>document.getElementById('hemiAll').click());   // no other interaction after this
  let hAll=hL, waited=0; while(hAll===hL && waited<3500){ await p.waitForTimeout(200); hAll=await sliceHash(); waited+=200; }
  ok('hemisphere change refreshes slices on its own', hL!==hAll, waited>=3500?'stayed stale':('after '+waited+'ms'));

  // ---- 2) atlas switch carries the look + view mode (mesh+vox) ----
  console.log('\n[2] Atlas switch keeps the current look & view mode');
  const defShading=await p.evaluate(()=>document.getElementById('shading').value);
  await p.evaluate(async()=>{ const s=document.getElementById('shading'); s.value='matcap:Pearl'; s.dispatchEvent(new Event('change',{bubbles:true})); });
  await Promise.all([ p.waitForNavigation({waitUntil:'load'}).catch(()=>{}),
    p.evaluate(()=>{ const a=document.getElementById('atlasSel'); a.value='aal'; a.dispatchEvent(new Event('change')); }) ]);
  await p.waitForFunction(()=>window.brainAPI&&window.brainAPI.ready,{timeout:30000}); await p.evaluate(()=>window.brainAPI.ready); await p.waitForTimeout(900);
  const sw=await p.evaluate(()=>({ atlas:(document.getElementById('atlasSel')||{}).value || new URLSearchParams(location.search).get('atlas'), shading:document.getElementById('shading').value, mode:window.brainAPI.projectJSON().viewer.mode, meshVox:document.getElementById('slMeshVox').checked }));
  ok('switched atlas (neuromorph → aal)', sw.atlas==='aal', sw.atlas);
  ok('look carried across atlas switch (matcap)', sw.shading==='matcap:Pearl', sw.shading);
  ok('view mode carried across atlas switch (mesh+vox slices)', sw.mode==='slice' && sw.meshVox, JSON.stringify(sw));

  // ---- 3) a plain fresh reload opens at the DEFAULT look & view (not the carried one) ----
  console.log('\n[3] Fresh reload is the default look & view (carry is not sticky)');
  await boot(BASE+'?atlas=aal');
  const fresh=await p.evaluate(()=>({ shading:document.getElementById('shading').value, mode:window.brainAPI.projectJSON().viewer.mode }));
  ok('fresh reload = default shading', fresh.shading===defShading, fresh.shading);
  ok('fresh reload = default mesh view', fresh.mode==='mesh', fresh.mode);

  // ---- 4) accessibility: UI text size scales the panels, re-insets the canvas, and persists ----
  console.log('\n[4] Text-size control scales the UI, keeps the canvas aligned, and persists');
  await boot(BASE+'?atlas=neuromorph');
  const snap=()=>p.evaluate(()=>({ scale:getComputedStyle(document.documentElement).getPropertyValue('--uiScale').trim(),
    sb:Math.round(document.getElementById('sidebar').getBoundingClientRect().width),
    cvL:Math.round(parseFloat(document.querySelector('canvas').style.left)||0),
    logo:Math.round(document.querySelector('.brandlogo').getBoundingClientRect().height),
    tbH:Math.round(document.getElementById('topbar').getBoundingClientRect().height),
    sbTop:Math.round(document.getElementById('sidebar').getBoundingClientRect().top),
    tbBottom:Math.round(document.getElementById('topbar').getBoundingClientRect().bottom),
    hudLeft:Math.round(parseFloat((document.getElementById('hud')||{}).style?.left)||0) }));
  const base=await snap();
  await p.evaluate(()=>{ [...document.querySelectorAll('.uiSizeBtn')].find(b=>b.dataset.uiscale==='1.45').click(); }); await p.waitForTimeout(300);
  const xl=await snap();
  ok('XL scales the panels up', parseFloat(xl.scale)===1.45 && xl.sb>base.sb, JSON.stringify(xl));
  ok('XL scales the TOP TOOLBAR too', xl.tbH>base.tbH+6, `tbH ${base.tbH}→${xl.tbH}`);
  ok('sidebar sits flush under the (taller) toolbar — no gap', Math.abs(xl.sbTop-xl.tbBottom)<=2, `sbTop=${xl.sbTop} tbBottom=${xl.tbBottom}`);
  ok('brainWhiz logo stays fixed size regardless of text size', xl.logo===base.logo && base.logo>=38, `base=${base.logo} xl=${xl.logo}`);
  ok('region-label HUD clears the widened sidebar (not hidden behind it)', xl.hudLeft>=xl.sb, `hudLeft=${xl.hudLeft} sidebar=${xl.sb}`);
  ok('canvas re-insets to the scaled panel (no overlap)', Math.abs(xl.cvL-xl.sb)<=2, `canvasLeft=${xl.cvL} sidebar=${xl.sb}`);
  await boot(BASE+'?atlas=neuromorph');
  const persist=await p.evaluate(()=>getComputedStyle(document.documentElement).getPropertyValue('--uiScale').trim());
  ok('text size persists across a fresh reload', parseFloat(persist)===1.45, persist);
  await p.evaluate(()=>{ [...document.querySelectorAll('.uiSizeBtn')].find(b=>b.dataset.uiscale==='1').click(); });  // reset

  ok('no page errors across journeys', errs.length===0, errs.slice(0,3).join(' | '));
  await b.close();
  console.log(`\n──────── JOURNEY RESULTS: ${PASS} passed, ${FAIL} failed ────────`);
  if(FAIL){ console.log('FAILURES:'); FAILURES.forEach(f=>console.log('  • '+f)); process.exit(1); }
  process.exit(0);
})().catch(e=>{ console.error('HARNESS ERROR:', e); process.exit(2); });
