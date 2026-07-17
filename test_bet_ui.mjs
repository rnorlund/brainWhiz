// Headless E2E for the in-app BET/CHOP panel: load a subject T1, run Refined extraction in the
// Web Worker, then render the folded-cortex surface. Screenshots at each stage.
import http from 'http'; import fs from 'fs'; import path from 'path'; import { spawn } from 'child_process';
import { createRequire } from 'module';
const REPO='/Users/super/Documents/jhu_brain_atlas';
const require=createRequire(path.join(REPO,'test_molwhiz.mjs'));
const { chromium }=require('playwright');
const OUT='/private/tmp/claude-501/-Users-super-Documents-jhu-brain-atlas/bd6b0e20-528e-443b-a72d-7d934a492d9c/scratchpad';
const PORT=8791;
const MIME={'.html':'text/html','.js':'text/javascript','.mjs':'text/javascript','.css':'text/css','.json':'application/json','.nii':'application/octet-stream','.gz':'application/gzip','.png':'image/png','.glb':'model/gltf-binary'};
const server=http.createServer((req,res)=>{ let p=decodeURIComponent(req.url.split('?')[0]); if(p==='/')p='/index.html'; const fp=path.join(REPO,p);
  fs.readFile(fp,(e,d)=>{ if(e){res.writeHead(404);res.end('nf');return;} res.writeHead(200,{'Content-Type':MIME[path.extname(fp)]||'application/octet-stream'}); res.end(d); }); });
await new Promise(r=>server.listen(PORT,r));
const browser=await chromium.launch({args:['--use-angle=swiftshader','--ignore-gpu-blocklist','--enable-unsafe-swiftshader']});
const page=await browser.newPage({viewport:{width:1400,height:900}});
page.setDefaultTimeout(180000);   // 1mm 3-class model runs ~40-70s single-threaded WASM; give waits room
const errs=[]; page.on('pageerror',e=>errs.push('PAGEERR '+e.message)); page.on('console',m=>{ if(m.type()==='error') errs.push('CONSOLE '+m.text()); });
try{
  await page.goto(`http://localhost:${PORT}/index.html?atlas=jhu`,{waitUntil:'domcontentloaded'});
  await page.waitForFunction('window.brainAPI && window.brainAPI.ready',{timeout:30000}); await page.evaluate('window.brainAPI.ready');
  console.log('app ready');
  // open the BET panel
  await page.evaluate(()=>{ const a=document.getElementById('accBET'); if(a){a.open=true;} document.getElementById('accBET').scrollIntoView(); });
  // load the subject T1 into the hidden BET file input
  await page.setInputFiles('#betFile', path.join(REPO,'T1_.nii.gz'));
  await page.waitForFunction(`/Loaded|failed/i.test((document.getElementById('betStatus')||{}).textContent||'')`,{timeout:30000});
  console.log('load status:', await page.$eval('#betStatus',e=>e.textContent), '| src:', await page.$eval('#betSrc',e=>e.textContent));
  // choose Refined + T1, run
  await page.selectOption('#betQual','learned'); await page.selectOption('#betSeq','t1');
  const t0=Date.now(); await page.click('#betRun');
  await page.waitForFunction(`/^Brain:/.test((document.getElementById('betStatus')||{}).textContent||'')`,{timeout:120000});
  const status=await page.$eval('#betStatus',e=>e.textContent);
  console.log(`BET done in ${((Date.now()-t0)/1000).toFixed(1)}s — ${status}`);
  await page.screenshot({path:path.join(OUT,'bet_ui_panel.png')});
  // render folded-cortex surface
  await page.click('#betSurf'); await page.waitForTimeout(2500);
  await page.evaluate(()=>window.brainAPI.setView('left')); await page.waitForTimeout(600);
  await page.screenshot({path:path.join(OUT,'bet_ui_cortex.png')});
  // white-matter surface (open the CHOP accordion first)
  await page.evaluate(()=>{ const a=document.getElementById('accCHOP'); if(a) a.open=true; });
  await page.click('#chopWM'); await page.waitForTimeout(2000);
  await page.evaluate(()=>window.brainAPI.setView('left')); await page.waitForTimeout(500);
  await page.screenshot({path:path.join(OUT,'bet_ui_wm.png')});
  console.log('errors:', errs.length? errs.slice(0,8):'none');
}catch(e){ console.error('TEST FAIL:', e.message); await page.screenshot({path:path.join(OUT,'bet_ui_fail.png')}).catch(()=>{}); console.log('errors:',errs.slice(0,8)); }
finally{ await browser.close(); server.close(); }
