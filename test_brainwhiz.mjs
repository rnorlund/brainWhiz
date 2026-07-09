// brainWhiz Playwright test — two-tailed threshold + out-of-range clamp (run: node test_brainwhiz.mjs)
import { createRequire } from 'module'; import path from 'path'; import { fileURLToPath } from 'url';
const require=createRequire(import.meta.url); const { chromium }=require('playwright');
const __dirname=path.dirname(fileURLToPath(import.meta.url));
const URL='file://'+path.join(__dirname,'index.html')+'?atlas=neuromorph';
let pass=0,fail=0; const ok=(n,c)=>{ if(c){pass++;console.log('  ✓',n);}else{fail++;console.log('  ✗ FAIL:',n);} };
const b=await chromium.launch({headless:true,args:['--use-gl=angle','--use-angle=swiftshader','--ignore-gpu-blocklist']});
const p=await b.newPage(); const errs=[]; p.on('pageerror',e=>errs.push(String(e)));
await p.goto(URL,{waitUntil:'load'}); await p.waitForFunction(()=>window.brainAPI&&window.brainAPI.ready,{timeout:30000}); await p.evaluate(()=>window.brainAPI.ready); await p.waitForTimeout(500);
// pick 3 real region ids; assign +3 / -3 / ~0
const ids=await p.evaluate(()=>window.brainAPI.labels().slice(0,3).map(o=>o.id));
const [hi,lo,mid]=ids;
await p.evaluate(({hi,lo,mid})=>{ const v={}; v[hi]=3; v[lo]=-3; v[mid]=0.02;
  window.brainAPI.setRegionValues(v,'diverge'); window.brainAPI.styleActiveOverlay({style:'cmap',cmap:'PuYl',cmin:-3,cmax:3,cthresh:0}); }, {hi,lo,mid});
await p.waitForTimeout(200);
const base=await p.evaluate(()=>{const e=document.getElementById('ovBaseColor');return '#'+e.value.replace('#','');});
const c0=await p.evaluate(({hi,lo,mid})=>({hi:window.brainAPI.regionColor(hi),lo:window.brainAPI.regionColor(lo),mid:window.brainAPI.regionColor(mid)}),{hi,lo,mid});
ok('no-threshold: all three coloured', c0.hi!==base && c0.lo!==base && c0.mid!==base);
// enable TWO-TAILED threshold, center 0, high threshold → hide middle, keep both tails
await p.evaluate(()=>window.brainAPI.styleActiveOverlay({twoTailed:true, center:0, cthreshMode:'raw', cthresh:1.5}));
await p.waitForTimeout(200);
const c1=await p.evaluate(({hi,lo,mid})=>({hi:window.brainAPI.regionColor(hi),lo:window.brainAPI.regionColor(lo),mid:window.brainAPI.regionColor(mid)}),{hi,lo,mid});
ok(`two-tailed keeps HIGH tail (${c1.hi})`, c1.hi!==base);
ok(`two-tailed keeps LOW tail (${c1.lo})`, c1.lo!==base);
ok(`two-tailed hides near-centre (mid=${c1.mid} == base ${base})`, c1.mid===base);
// one-tailed (normal) with same threshold would hide the LOW tail
await p.evaluate(()=>window.brainAPI.styleActiveOverlay({twoTailed:false, cthreshMode:'raw', cthresh:1.5}));
await p.waitForTimeout(200);
const c2=await p.evaluate(({hi,lo})=>({hi:window.brainAPI.regionColor(hi),lo:window.brainAPI.regionColor(lo)}),{hi,lo});
ok(`one-tailed hides LOW tail (lo=${c2.lo})`, c2.lo===base && c2.hi!==base);
console.log('\npage errors:', errs.length?errs.slice(0,3):'none');
console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
await b.close(); process.exit(fail?1:0);
