// brainWhiz "every shown setting actually does something" test.
// For each Appearance control, enables its prerequisites, changes it to a distinct value, and asserts
// the 3D render changes. A control that changes nothing = a dead setting = a bug.
// Also verifies the SAME controls re-render live in the Editor (LOOK_LIVE completeness).
// Prereq: static server on :8777. Run: node test_brainwhiz_controls.mjs
import { createRequire } from 'module'; import path from 'path';
const REPO = path.dirname(new URL(import.meta.url).pathname);
const require = createRequire(path.join(REPO, 'test_molwhiz.mjs'));
const { chromium } = require('playwright');

let PASS=0, FAIL=0; const FAILURES=[];
function ok(name, cond, extra=''){ if(cond){PASS++;} else {FAIL++; FAILURES.push(name+(extra?' — '+extra:''));} console.log(`  ${cond?'✅':'❌'} ${name}${!cond&&extra?' — '+extra:''}`); }

// control specs: id, kind, deps (controls to enable/set first), and (for bg) opaque render
const SPECS = [
  // opacity / overlay-driven
  {id:'opacity',   kind:'range'},
  {id:'coloredOp', kind:'range'},
  {id:'grayOp',    kind:'range'},
  {id:'satCut',    kind:'range'},
  // scheme / colors
  {id:'scheme',    kind:'select'},
  {id:'singleColor', kind:'color', deps:{scheme:'single'}},
  {id:'ovBaseColor', kind:'color', pre:'overlay'},   // base grey only matters when an overlay is active
  {id:'bg',        kind:'color', opaque:true},
  // geometry / surface
  {id:'smooth',    kind:'range'},
  {id:'surfStyle', kind:'select'},
  {id:'wireWidth', kind:'range', deps:{surfStyle:'Wireframe'}},
  {id:'shading',   kind:'select'},
  {id:'vivid',     kind:'range'},
  {id:'rim',       kind:'range'},
  {id:'rimColor',  kind:'color', deps:{rim:'1.2'}},
  // outline / edges
  {id:'outlineOn', kind:'toggle'},
  {id:'outlineW',  kind:'range', deps:{outlineOn:true}},
  {id:'edgeOn',    kind:'toggle'},
  {id:'edgeW',     kind:'range', deps:{edgeOn:true}},
  {id:'edgeStr',   kind:'range', deps:{edgeOn:true}},
  // patterns
  {id:'patScale',  kind:'range', deps:{surfStyle:'Stripes'}},
  {id:'patStr',    kind:'range', deps:{surfStyle:'Stripes'}},
  {id:'patTilt',   kind:'range', deps:{surfStyle:'Stripes'}},
  {id:'patMode',   kind:'select', deps:{surfStyle:'Stripes'}},
  // glass
  {id:'glass',     kind:'toggle'},
  {id:'shellOn',   kind:'toggle'},
  {id:'shellColor',kind:'color', deps:{shellOn:true}},
  {id:'shellOp',   kind:'range', deps:{shellOn:true}},
  {id:'shellMNI',  kind:'toggle', deps:{shellOn:true}},
  // ambient occlusion
  {id:'ssaoOn',    kind:'toggle'},
  {id:'ssaoInt',   kind:'range', deps:{ssaoOn:true}},
  {id:'ssaoRadius',kind:'range', deps:{ssaoOn:true}},
  // aura
  {id:'auraOn',    kind:'toggle'},
  {id:'auraColor', kind:'color', deps:{auraOn:true}},
  {id:'auraRainbow',kind:'toggle', deps:{auraOn:true}},
  {id:'auraSize',  kind:'range', deps:{auraOn:true}},
  {id:'auraIntensity', kind:'range', deps:{auraOn:true}},
  {id:'auraPulse', kind:'range', deps:{auraOn:true}},
];

(async ()=>{
  const browser = await chromium.launch({ headless:true, args:['--use-gl=angle','--use-angle=swiftshader','--ignore-gpu-blocklist'] });
  const page = await browser.newPage({ viewport:{width:1000,height:780}, deviceScaleFactor:1 });
  const errs=[]; page.on('pageerror',e=>errs.push(String(e)));
  await page.goto('http://localhost:8777/index.html?atlas=neuromorph', { waitUntil:'load' });
  await page.waitForFunction(()=>window.brainAPI && window.brainAPI.ready, { timeout:30000 });
  await page.evaluate(()=>window.brainAPI.ready); await page.waitForTimeout(600);

  // expose helpers in-page
  await page.evaluate(()=>{
    window.__hash = (opaque)=>{ const u=window.brainAPI.renderTo(360,300,!opaque); let h=0; for(let i=0;i<u.length;i++){h=(h*31+u.charCodeAt(i))>>>0;} return h+'/'+u.length; };   // full hash — no sparse-sampling false negatives
    window.__overlay = ()=>{ const labs=window.brainAPI.labels(); const vals={}; labs.slice(0,Math.min(40,labs.length)).forEach((o,i)=>vals[o.id]=i);
      window.brainAPI.setRegionValues(vals,'ov'); window.brainAPI.styleActiveOverlay({style:'cmap',cmap:'YlOrRd',cmin:0,cmax:39,cthresh:0}); };
    window.__raf = ()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
    window.__set = (id,v)=>{ const e=document.getElementById(id); if(!e) return 'no-el';
      if(e.type==='checkbox'){ e.checked=(v===true||v==='true'); e.dispatchEvent(new Event('change',{bubbles:true})); }
      else { e.value=String(v); e.dispatchEvent(new Event('input',{bubbles:true})); e.dispatchEvent(new Event('change',{bubbles:true})); } return 'ok'; };
    // change a control to a value distinct from its current one; returns [before-desc, after-desc]
    window.__change = (id,kind)=>{ const e=document.getElementById(id); if(!e) return {err:'no-el'};
      if(kind==='toggle'){ const was=e.checked; e.checked=!was; e.dispatchEvent(new Event('change',{bubbles:true})); return {from:was,to:e.checked}; }
      if(kind==='color'){ const was=e.value.toLowerCase(); const to=(was==='#ff00ff')?'#00ff44':'#ff00ff'; e.value=to; e.dispatchEvent(new Event('input',{bubbles:true})); return {from:was,to}; }
      if(kind==='range'){ const min=+e.min, max=+e.max, cur=+e.value; const to=(cur-min)>(max-cur)?min:max; e.value=String(to); e.dispatchEvent(new Event('input',{bubbles:true})); e.dispatchEvent(new Event('change',{bubbles:true})); return {from:cur,to}; }
      if(kind==='select'){ const cur=e.value; let to=cur; for(const o of e.options){ if(o.value!==cur){ to=o.value; break; } } e.value=to; e.dispatchEvent(new Event('change',{bubbles:true})); return {from:cur,to}; }
      return {err:'kind'}; };
  });

  console.log('\n[A] Normal viewer — does each appearance control change the 3D render?');
  for(const s of SPECS){
    // Clean base: lobe scheme with gray regions dimmed, so colored/gray-classification controls
    // (satCut, coloredOp, grayOp, glass) have a visible effect. Overlay only when a spec needs it.
    await page.evaluate(async (pre)=>{ const r=document.getElementById('resetAppear'); if(r) r.click(); await window.__raf();
      window.__set('scheme','lobe'); window.__set('coloredOp','1'); window.__set('grayOp','0.15');
      if(pre==='overlay') window.__overlay();
      await window.__raf(); }, s.pre||null);
    const r = await page.evaluate(async (s)=>{
      for(const d in (s.deps||{})) window.__set(d, s.deps[d]);
      await window.__raf();
      const before = window.__hash(s.opaque);
      const ch = window.__change(s.id, s.kind);
      await window.__raf(); await new Promise(r=>setTimeout(r,150)); await window.__raf();
      const after = window.__hash(s.opaque);
      return { ch, changed: before!==after, before, after };
    }, s);
    ok(`viewer: ${s.id} changes render`, r.changed, `${JSON.stringify(r.ch)} (${r.before}→${r.after})`);
  }

  // reset before editor test
  await page.evaluate(async ()=>{ const r=document.getElementById('resetAppear'); if(r) r.click(); await window.__raf(); });
  console.log(`\n[A] viewer errors: ${errs.length?errs.slice(0,3).join(' | '):'none'}`);

  // ============ [B] Editor live-sync: previously-dead controls re-render panels ============
  console.log('\n[B] Editor — changing an Appearance control live-updates the figure panels');
  await page.evaluate(async ()=>{ window.__overlay(); window.brainAPI.pbGrid(1,2); await window.__raf();
    window.brainAPI.pbCapturePanel(0); window.brainAPI.pbCapturePanel(1);
    document.getElementById('feToggle').click(); });
  await page.waitForFunction(()=>window.feCanvas && typeof window.feCanvas.getObjects==='function' && window.feCanvas.getObjects().length>0, {timeout:15000}).catch(()=>{});
  await page.waitForTimeout(900);
  const panelHash=()=>page.evaluate(()=>{ const u=(window.brainAPI.projectJSON().panels[0]||{}).dataURL||''; let h=0; for(let i=0;i<u.length;i++){h=(h*31+u.charCodeAt(i))>>>0;} return h; });
  for(const t of [{id:'auraOn',kind:'toggle'},{id:'shellOn',kind:'toggle'},{id:'ssaoOn',kind:'toggle'},{id:'patTilt',kind:'range',deps:{surfStyle:'Stripes'}}]){
    await page.evaluate((t)=>{ for(const d in (t.deps||{})) window.__set(d,t.deps[d]); }, t);
    await page.waitForTimeout(1500);          // let any dep-driven re-render fully settle first
    const before = await panelHash();
    await page.evaluate((t)=>window.__change(t.id,t.kind), t);
    // poll — panel re-render is debounced (250ms) + async, and swiftshader panel renders are slow
    let after=before, waited=0; while(after===before && waited<6000){ await page.waitForTimeout(300); after=await panelHash(); waited+=300; }
    ok(`editor: ${t.id} live-updates panels`, before!==after, `${before}->${after} (${waited}ms)`);
  }
  // bg drives the FIGURE (editor canvas) background, since brain panels are transparent
  const bgRes = await page.evaluate(async ()=>{ const before=window.feCanvas.backgroundColor;
    window.__set('bg','#123456'); await window.__raf(); return {before, after:window.feCanvas.backgroundColor}; });
  ok('editor: Background control sets the figure background', (bgRes.after||'').toLowerCase()==='#123456', JSON.stringify(bgRes));
  // "Updating…" chip exists and toggles
  const chip = await page.evaluate(async ()=>{ window.__set('vivid','3'); await new Promise(r=>setTimeout(r,20));
    const shown=!!document.getElementById('feUpdating'); await new Promise(r=>setTimeout(r,1400));
    const el=document.getElementById('feUpdating'); return {exists:shown, hiddenAfter: el? el.style.display==='none':true}; });
  ok('editor: "Updating…" chip appears then clears', chip.exists && chip.hiddenAfter, JSON.stringify(chip));
  console.log(`\n[B] editor errors: ${errs.length?errs.slice(0,3).join(' | '):'none'}`);

  // ============ [C] Multi-select styling applies to ALL selected brains ============
  console.log('\n[C] Editor — outline/shadow apply to every brain in a multi-selection');
  const ms = await page.evaluate(()=>{ const c=window.feCanvas; const panels=c.getObjects().filter(o=>o._panel!=null).slice(0,2);
    if(panels.length<2) return {err:'need 2 panels', n:panels.length};
    const sel=new fabric.ActiveSelection(panels,{canvas:c}); c.setActiveObject(sel); c.requestRenderAll();
    const S=(id,v,ev)=>{const e=document.getElementById(id);if(e.type==='checkbox')e.checked=(v===true);else e.value=String(v);e.dispatchEvent(new Event(ev||'input',{bubbles:true}));};
    S('feStrokeC','#00ff00'); S('feStrokeW','7'); S('feShadow',true); S('feShBlur','12'); S('feShDist','8');
    return { type:c.getActiveObject().type, after:panels.map(o=>({sw:o.strokeWidth, stroke:(o.stroke||'').toLowerCase(), shadow:!!o.shadow})) }; });
  ok('multi-select is an activeSelection', ms.type==='activeSelection', JSON.stringify(ms));
  ok('outline applies to ALL selected brains', ms.after && ms.after.every(a=>a.sw===7 && a.stroke==='#00ff00'), JSON.stringify(ms.after));
  ok('shadow applies to ALL selected brains', ms.after && ms.after.every(a=>a.shadow), JSON.stringify(ms.after));

  // ============ [D] Fit-to-window: whole figure fits, export stays full-res ============
  console.log('\n[D] Editor — fit-to-window scales display only (export stays full resolution)');
  const fit = await page.evaluate(async ()=>{ const set=(id,v)=>{const e=document.getElementById(id);e.value=String(v);e.dispatchEvent(new Event('change',{bubbles:true}));};
    set('feW',2400); set('feH',1600); await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
    const c=window.feCanvas, el=c.getElement(), stage=document.getElementById('feStage');
    const cssW=parseFloat(el.style.width), cssH=parseFloat(el.style.height);
    const exportLen=(window.brainAPI.editorPNG(1)||'').length;
    return { logicalW:c.getWidth(), cssW:Math.round(cssW), stageW:stage.clientWidth, stageH:stage.clientHeight, cssH:Math.round(cssH), exportLen,
      fits: cssW<=stage.clientWidth+1 && cssH<=stage.clientHeight+1 }; });
  ok('fit: whole figure fits inside the stage', fit.fits, JSON.stringify(fit));
  ok('fit: logical/backstore stays full-res (export not shrunk)', fit.logicalW===2400 && fit.exportLen>1000, JSON.stringify(fit));

  // typable zoom + 10% steps
  const z = await page.evaluate(async ()=>{ const el=document.getElementById('feZoomPct'), cv=window.feCanvas.getElement(), css=()=>Math.round(parseFloat(cv.style.width));
    el.value='75'; el.dispatchEvent(new Event('change',{bubbles:true})); await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))); const a=css();
    el.value='120'; el.dispatchEvent(new Event('change',{bubbles:true})); await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))); const b=css();
    return { isInput: el.tagName==='INPUT', w75:a, w120:b, logical:window.feCanvas.getWidth() }; });
  ok('zoom: % is a typable input', z.isInput);
  ok('zoom: typing a % rescales the display (120% > 75%)', z.w120>z.w75, JSON.stringify(z));
  console.log(`\n[C/D] editor errors: ${errs.length?errs.slice(0,3).join(' | '):'none'}`);

  // ============ [E] Tooltip coverage — every visible side-panel control has a hover tooltip ============
  console.log('\n[E] Tooltips — every visible control in the side panels has a title');
  await page.evaluate(()=>{ if(document.getElementById('feClose')) document.getElementById('feClose').click(); });  // leave editor
  await page.waitForTimeout(300);
  await page.evaluate(()=>{ document.querySelectorAll('#sidebar details, #sidebarR details').forEach(d=>d.open=true); });  // expand all sections incl. appearance sub-categories
  await page.waitForTimeout(500);
  const tips = await page.evaluate(()=>{ const sel='#sidebar input, #sidebar select, #sidebar button, #sidebar textarea, #sidebarR input, #sidebarR select, #sidebarR button, #sidebarR textarea';
    const els=[...document.querySelectorAll(sel)].filter(e=>e.type!=='hidden' && e.offsetParent!==null);
    return { total:els.length, missing:els.filter(e=>!(e.title&&e.title.trim())).map(e=>e.id||e.className||e.tagName),
             appearanceSubcats:document.querySelectorAll('#accAppearance .sub>summary').length }; });
  ok(`tooltips: all ${tips.total} visible controls have one`, tips.missing.length===0, tips.missing.slice(0,12).join(', '));
  ok('Appearance panel is split into collapsible sub-categories', tips.appearanceSubcats>=4, 'subcats='+tips.appearanceSubcats);
  console.log(`\n[C/D/E] editor errors: ${errs.length?errs.slice(0,3).join(' | '):'none'}`);

  await browser.close();
  console.log(`\n──────── CONTROL RESULTS: ${PASS} passed, ${FAIL} failed ────────`);
  if(FAIL){ console.log('DEAD/broken controls:'); FAILURES.forEach(f=>console.log('  • '+f)); process.exit(1); }
  process.exit(0);
})().catch(e=>{ console.error('HARNESS ERROR:', e); process.exit(2); });
