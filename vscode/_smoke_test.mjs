// Smoke-test the VS Code webview viewer against the real repo T1. Serves the repo root, loads
// vscode/_smoke.html (mirrors extension.js DOM), and checks slices, 3D, header, the new controls,
// and the axial CUT plane. Node + playwright + python http.server.
import { chromium } from 'playwright';
import { spawn } from 'child_process';

const ROOT = new URL('..', import.meta.url).pathname;   // repo root (vscode/..)
const PORT = 8793;
const srv = spawn('python3', ['-m', 'http.server', String(PORT)], { cwd: ROOT, stdio: 'ignore' });
const sleep = ms => new Promise(r => setTimeout(r, ms));
await sleep(700);

let ok = true;
const errs = [];
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1100, height: 820 } });
page.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
page.on('pageerror', e => errs.push('PAGEERROR: ' + e.message));

try {
  await page.goto(`http://localhost:${PORT}/vscode/_smoke.html`, { waitUntil: 'load' });
  await page.waitForFunction(() => {
    const s = document.getElementById('status')?.textContent || '';
    return s.includes('×') || s.startsWith('Failed');
  }, { timeout: 30000 });
  const status = await page.textContent('#status');
  console.log('status:', status);
  if (status.startsWith('Failed')) ok = false;
  await sleep(1800);                                     // let 3D build + face-forward settle

  const R = await page.evaluate(() => {
    const painted = id => { const cv = document.getElementById(id); if (!cv || !cv.width) return false;
      const d = cv.getContext('2d').getImageData(0,0,cv.width,cv.height).data;
      let nz=0; for (let i=0;i<d.length;i+=4) if (d[i]||d[i+1]||d[i+2]) { if (++nz>200) return true; } return false; };
    const ids = ['thr3d','wire3d','spin3d','face3d','cut3d','cutlev3d','xhairBtn'];
    return {
      axi: painted('cv_axi'), cor: painted('cv_cor'), sag: painted('cv_sag'),
      has3dCanvas: !!document.querySelector('#view3d canvas'),
      hdrRows: document.querySelectorAll('#hdrbody .hk').length,
      cmapOpts: document.querySelectorAll('#cmap option').length,
      controls: Object.fromEntries(ids.map(i => [i, !!document.getElementById(i)])),
    };
  });
  console.log('slices:', R.axi, R.cor, R.sag, '| 3D:', R.has3dCanvas, '| hdr rows:', R.hdrRows, '| cmaps:', R.cmapOpts);
  console.log('new controls present:', JSON.stringify(R.controls));
  await page.screenshot({ path: 'vscode/_smoke.png' });   // default face-forward view

  // exercise colormap + wireframe
  await page.selectOption('#cmap', 'viridis'); await sleep(200);

  // exercise the CUT plane: toggle on, move the axial level, screenshot
  await page.click('#cut3d');
  const cutActive = await page.evaluate(() => document.getElementById('cut3d').classList.contains('active'));
  await page.evaluate(() => { const s=document.getElementById('cutlev3d'); s.value=Math.floor(s.max*0.55); s.dispatchEvent(new Event('input',{bubbles:true})); });
  await sleep(700);
  await page.selectOption('#cmap', 'gray'); await sleep(300);
  console.log('cut toggled active:', cutActive);
  await page.screenshot({ path: 'vscode/_cut.png' });      // head cut open, MRI slice inside

  // stat-map overlay: load t2 as a colored overlay
  const T2 = new URL('../t2.nii.gz', import.meta.url).pathname;
  await page.setInputFiles('#ovFile', T2); await sleep(1000);
  const ovShown = await page.evaluate(() => getComputedStyle(document.getElementById('ovGroup')).display !== 'none');
  console.log('overlay loaded + controls shown:', ovShown);
  await page.screenshot({ path: 'vscode/_overlay.png' });
  if (!ovShown) { ok = false; console.log('FAIL: overlay did not load'); }

  // header panel opens
  await page.click('#hdrBtn'); await sleep(300);
  const hdrOpen = await page.evaluate(() => document.getElementById('hdrpanel').classList.contains('open'));

  if (!(R.axi && R.cor && R.sag)) { ok=false; console.log('FAIL: a slice did not paint'); }
  if (!R.has3dCanvas)             { ok=false; console.log('FAIL: no 3D canvas'); }
  if (R.hdrRows < 10)             { ok=false; console.log('FAIL: header not populated'); }
  if (R.cmapOpts < 10)            { ok=false; console.log('FAIL: colormaps not expanded'); }
  if (Object.values(R.controls).some(v=>!v)) { ok=false; console.log('FAIL: a new control is missing'); }
  if (!cutActive)                 { ok=false; console.log('FAIL: cut did not toggle on'); }
  if (!hdrOpen)                   { ok=false; console.log('FAIL: header panel did not open'); }
} catch (e) { ok=false; console.error('EXCEPTION:', e.message); }
finally {
  if (errs.length) { ok=false; console.log('CONSOLE ERRORS:\n' + errs.join('\n')); }
  await browser.close(); srv.kill();
  console.log(ok ? '\n✅ SMOKE TEST PASSED' : '\n❌ SMOKE TEST FAILED');
  process.exit(ok ? 0 : 1);
}
