#!/usr/bin/env node
/**
 * Render a grid figure of ROI-brain panels (Riccardi-style) from a JSON spec,
 * driving the viewer headlessly via its window.brainAPI.
 *
 *   node make_figure.mjs figure_example.json
 *
 * Spec shape:
 * {
 *   "out": "figure.png",
 *   "cols": 2,
 *   "cell": [460, 360],          // px per panel
 *   "gap": 14, "bg": "#ffffff", "labelSize": 24, "labelColor": "#111",
 *   "colorbar": true,            // draw a shared colorbar from the first overlay panel
 *   "panels": [
 *     { "atlas":"jhu", "view":"left", "task":"motor", "label":"Motor",
 *       "explosion":{"amount":0,"distance":1.5}, "connectivity":false,
 *       "scheme":"lobe", "regionSet":"", "bg":"#ffffff",
 *       "controls": { "vivid":1.6, "ovStyle":"solid", "ovColor":"#d62728", "cthresh":0.2 } }
 *   ]
 * }
 */
import { spawn } from 'child_process';
import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const WebSocket = require('ws');
const HERE = path.dirname(fileURLToPath(import.meta.url));

const CHROME_CANDIDATES = [
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Chromium.app/Contents/MacOS/Chromium",
  "google-chrome", "chromium", "chrome",
];
const CHROME = CHROME_CANDIDATES.find(p => { try { return p.includes('/') ? fs.existsSync(p) : true; } catch { return false; } });

const specPath = process.argv[2];
if (!specPath) { console.error("usage: node make_figure.mjs <spec.json|figure.bwz> [--root <folder-with-nii>] [--out file.png]"); process.exit(1); }
// --root resolves .nii file overlays in .bwz panels; defaults to the spec's folder
function argVal(name){ const i=process.argv.indexOf(name); if(i>=0) return process.argv[i+1];
  const eq=process.argv.find(a=>a.startsWith(name+"=")); return eq?eq.split("=").slice(1).join("="):undefined; }
const spec = JSON.parse(fs.readFileSync(specPath, "utf8"));
const isBwz = !!spec.bwz;
const ROOT = path.resolve(argVal("--root") || path.dirname(specPath));
let cols, cellW, cellH, gap, bg, labelSize, labelColor, cbarSize, titleFont;
if (isBwz) {
  cols = parseInt((spec.grid||"2x2").split("x")[1]) || 2;
  const f = spec.figure || {};
  cellW = f.brain || 640; cellH = Math.round(cellW * 0.78);
  gap = f.gap ?? 18; bg = f.bg || "#ffffff";
  labelSize = f.titleSize ?? 24; labelColor = f.titleColor || "#111";
  cbarSize = f.colorbarSize ?? 40; titleFont = f.titleFont || "system-ui";
} else {
  cols = spec.cols || 2; [cellW, cellH] = spec.cell || [460, 360];
  gap = spec.gap ?? 14; bg = spec.bg || "#ffffff";
  labelSize = spec.labelSize ?? 24; labelColor = spec.labelColor || "#111";
  cbarSize = spec.cbarSize ?? 38; titleFont = spec.titleFont || "system-ui";
}
const outArg = argVal("--out");
const out = outArg ? path.resolve(process.cwd(), outArg)   // --out is relative to CWD
  : path.resolve(path.dirname(specPath), spec.out || (isBwz ? path.basename(specPath).replace(/\.bwz$/i,"")+".png" : "figure.png"));

// colormaps (for the shared colorbar) parsed from colormaps.js
function loadCmaps() {
  try { const t = fs.readFileSync(path.join(HERE, "colormaps.js"), "utf8");
    return JSON.parse(t.match(/=\s*({[\s\S]*})\s*;/)[1]); } catch { return {}; }
}
const CMAPS = loadCmaps();

const sleep = ms => new Promise(r => setTimeout(r, ms));
const port = 9400 + Math.floor((spec.panels.length * 7) % 500);

async function cdp() {
  const chrome = spawn(CHROME, ["--headless=new", `--remote-debugging-port=${port}`,
    "--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader",
    "--no-first-run", "--user-data-dir=" + path.join(HERE, ".chrome-figtmp-" + port),
    "--window-size=1400,1000", "about:blank"], { stdio: "ignore" });
  const getJSON = p => new Promise((res, rej) => http.get({ host: "127.0.0.1", port, path: p },
    r => { let d = ""; r.on("data", c => d += c); r.on("end", () => res(JSON.parse(d))); }).on("error", rej));
  await sleep(1500);
  let tabs; for (let i = 0; i < 30; i++) { try { tabs = await getJSON("/json"); break; } catch { await sleep(500); } }
  const target = tabs.find(t => t.type === "page");
  const sock = new WebSocket(target.webSocketDebuggerUrl);
  let id = 0; const pend = {};
  sock.on("message", d => { const m = JSON.parse(d); if (m.id && pend[m.id]) { pend[m.id](m); delete pend[m.id]; } });
  await new Promise(r => sock.on("open", r));
  const send = (method, params = {}) => new Promise(r => { const i = ++id; pend[i] = r; sock.send(JSON.stringify({ id: i, method, params })); });
  await send("Runtime.enable"); await send("Page.enable");
  const ev = async expr => { const r = await send("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true });
    if (r.result?.exceptionDetails || r.result?.subtype === "error") throw new Error(JSON.stringify(r.result)); return r.result?.result?.value ?? r.result?.value; };
  const navigate = async url => { await send("Page.navigate", { url }); await sleep(300); };
  return { chrome, sock, send, ev, navigate };
}

async function renderPanel(ctx, panel) {
  if (!panel) return null;
  const atlas = panel.atlas || "jhu";
  await ctx.navigate(`file://${HERE}/index.html?atlas=${encodeURIComponent(atlas)}`);
  for (let i = 0; i < 60; i++) { const t = await ctx.ev(`typeof window.brainAPI`); if (t === "object") break; await sleep(400); }
  await ctx.ev(`window.brainAPI.ready`);
  await ctx.ev(`window.brainAPI.hideUI()`);
  const mode = panel.mode || "mesh";
  if (panel.overlays || panel.vals) {
    // .bwz panel: restore the full viewer config (overlay stack, view mode, slice/mosaic)
    await ctx.ev(`window.brainAPI.applyCfg(${JSON.stringify(panel)})`);
    if (panel.overlays) {                       // new format: load each file overlay into its slot
      for (let k = 0; k < panel.overlays.length; k++) {
        const o = panel.overlays[k];
        if (o.kind !== "file" || !o.fileName) continue;
        const fp = path.resolve(ROOT, o.fileName);
        if (!fs.existsSync(fp)) { console.warn(`  ! missing overlay file: ${fp}`); continue; }
        const b64 = fs.readFileSync(fp).toString("base64");
        await ctx.ev(`window.brainAPI.loadOverlayFile(${k}, ${JSON.stringify(b64)}, ${JSON.stringify(o.fileName)})`);
      }
    } else {                                    // legacy single/A-B file panel
      for (const slot of ["A","B"]) {
        const fn = panel["file"+slot]; if (!fn) continue;
        const fp = path.resolve(ROOT, fn);
        if (!fs.existsSync(fp)) { console.warn(`  ! missing file for Map ${slot}: ${fp}`); continue; }
        const b64 = fs.readFileSync(fp).toString("base64");
        await ctx.ev(`window.brainAPI.loadStatArray(${JSON.stringify(b64)}, "A", ${JSON.stringify(fn)})`);
      }
    }
    await sleep(200);
  } else {
    const cfg = { view: panel.view || "left", task: panel.task, regionSet: panel.regionSet,
      scheme: panel.scheme, explosion: panel.explosion, connectivity: panel.connectivity,
      bg: panel.bg || bg, controls: panel.controls || {}, uiHidden: true };
    await ctx.ev(`window.brainAPI.applyConfig(${JSON.stringify(cfg)})`);
    await sleep(250);
  }
  const dataURL = await ctx.ev(`window.brainAPI.captureView(${cellW},${cellH},true)`);
  const cbar = (mode === "mesh") ? await ctx.ev(`window.brainAPI.colorbar()`) : null;  // slice/mosaic carry their own
  return { dataURL, label: panel.label || "", cbar };
}

function hexToRgb(h){ h=(h||'#888').replace('#',''); return [parseInt(h.slice(0,2),16)/255,parseInt(h.slice(2,4),16)/255,parseInt(h.slice(4,6),16)/255]; }
function composite(panels) {
  // per-cell layout: title -> (its own) colorbar -> brain. Each panel keeps its
  // own colorbar (only drawn when that panel has an overlay).
  const rows = Math.ceil(panels.length / cols);
  const showBars = spec.colorbar !== false;
  const withLut = cb => (cb.kind==='single' || cb.style)   // single map -> precompute LUT
    ? { ...cb, lut: cb.style === "cmap" ? (CMAPS[cb.cmap] || CMAPS.viridis)
                                        : [[0.54,0.56,0.6], hexToRgb(cb.color)] }
    : cb;                                                    // conj/sub -> pass colors through
  return { cols, rows, cellW, cellH, gap, bg, labelSize, labelColor, cbarSize, showBars, font: titleFont,
    panels: panels.map(p => p ? ({ dataURL: p.dataURL, label: p.label,
      cbar: (showBars && p.cbar) ? withLut(p.cbar) : null }) : null) };
}

const COMPOSITOR = `async (F)=>{
  const titRes = (F.labelSize>0 && F.panels.some(p=>p&&p.label)) ? F.labelSize+6 : 0;
  const anyCb = F.showBars && F.cbarSize>0 && F.panels.some(p=>p&&p.cbar);
  const cbRes = anyCb ? F.cbarSize+18 : 0;
  const blockH = titRes + cbRes + F.cellH;
  const cvs=document.createElement('canvas');
  cvs.width = F.cols*F.cellW + (F.cols+1)*F.gap;
  cvs.height = F.rows*blockH + (F.rows+1)*F.gap;
  const x=cvs.getContext('2d'); x.fillStyle=F.bg; x.fillRect(0,0,cvs.width,cvs.height);
  const hx=h=>{h=(h||'#888').replace('#','');return [parseInt(h.slice(0,2),16),parseInt(h.slice(2,4),16),parseInt(h.slice(4,6),16)];};
  const GRAY=[138,143,153];
  function drawCb(cb,bx,by,W,H){
    const fs=Math.max(9,Math.min(13,Math.round(H*0.4))); x.font=fs+'px system-ui'; x.fillStyle=F.labelColor;
    if(cb.kind==='conj'){ const S=H, sx=bx+(W-S)/2, A=hx(cb.colorA), B=hx(cb.colorB), N=48, cell=S/N;
      for(let ix=0;ix<N;ix++)for(let iy=0;iy<N;iy++){ const nA=ix/(N-1),nB=iy/(N-1);
        const r=GRAY[0]+nA*(A[0]-GRAY[0])+nB*(B[0]-GRAY[0]), g=GRAY[1]+nA*(A[1]-GRAY[1])+nB*(B[1]-GRAY[1]), b=GRAY[2]+nA*(A[2]-GRAY[2])+nB*(B[2]-GRAY[2]);
        x.fillStyle='rgb('+Math.round(r)+','+Math.round(g)+','+Math.round(b)+')'; x.fillRect(sx+ix*cell, by+S-(iy+1)*cell, Math.ceil(cell),Math.ceil(cell)); }
      x.font=Math.max(9,Math.min(12,Math.round(S*0.15)))+'px system-ui';
      x.textAlign='center'; x.fillText('A →', sx+S/2, by+S+Math.round(S*0.17));
      x.save(); x.translate(sx-3, by+S/2); x.rotate(-Math.PI/2); x.fillText('B →',0,0); x.restore(); return; }
    if(cb.kind==='sub'){ const A=hx(cb.colorA), B=hx(cb.colorB);
      for(let px=0;px<W;px++){ const d=(px/(W-1))*2-1, t=Math.abs(d), C=d<0?B:A;
        x.fillStyle='rgb('+Math.round(GRAY[0]+(C[0]-GRAY[0])*t)+','+Math.round(GRAY[1]+(C[1]-GRAY[1])*t)+','+Math.round(GRAY[2]+(C[2]-GRAY[2])*t)+')'; x.fillRect(bx+px,by,1,H); }
      x.textAlign='left'; x.fillText(cb.nameB||'B',bx,by-3); x.textAlign='right'; x.fillText(cb.name||'A',bx+W,by-3); return; }
    const lut=cb.lut;
    for(let i=0;i<W;i++){ const t=i/(W-1),f=t*(lut.length-1),a=Math.floor(f),g=f-a;
      const c0=lut[a],c1=lut[Math.min(lut.length-1,a+1)];
      x.fillStyle='rgb('+Math.round(255*(c0[0]+(c1[0]-c0[0])*g))+','+Math.round(255*(c0[1]+(c1[1]-c0[1])*g))+','+Math.round(255*(c0[2]+(c1[2]-c0[2])*g))+')';
      x.fillRect(bx+i,by,1,H); }
    x.textAlign='left'; x.fillText(cb.min.toFixed(1),bx,by-3); x.textAlign='right'; x.fillText(cb.max.toFixed(1),bx+W,by-3); }
  await Promise.all(F.panels.map((p,i)=>new Promise(res=>{
    if(!p){ res(); return; }
    const c=i%F.cols, r=Math.floor(i/F.cols);
    const px=F.gap+c*(F.cellW+F.gap), py=F.gap+r*(blockH+F.gap);
    if(F.labelSize>0 && p.label){ x.fillStyle=F.labelColor; x.font='bold '+Math.round(F.labelSize*0.74)+'px '+(F.font||'system-ui');
      x.textAlign='center'; x.fillText(p.label, px+F.cellW/2, py+F.labelSize*0.82); }
    if(F.cbarSize>0 && p.cbar){ const W=Math.min(F.cellW*0.8,F.cellW-20), bx=px+(F.cellW-W)/2, by=py+titRes+14;
      drawCb(p.cbar, bx, by, W, F.cbarSize); }
    const img=new Image(); img.onload=()=>{ x.drawImage(img,px,py+titRes+cbRes,F.cellW,F.cellH); res(); };
    img.onerror=()=>res(); img.src=p.dataURL;
  })));
  return cvs.toDataURL('image/png');
}`;

(async () => {
  if (!CHROME) { console.error("Chrome/Chromium not found."); process.exit(1); }
  console.log(`rendering ${spec.panels.length} panel(s) …`);
  const ctx = await cdp();
  const rendered = [];
  for (let i = 0; i < spec.panels.length; i++) {
    const p = spec.panels[i];
    if (!p) { rendered.push(null); continue; }   // empty tile
    process.stdout.write(`  panel ${i + 1}/${spec.panels.length} (${p.atlas || 'jhu'} · ${p.label || ''}) … `);
    rendered.push(await renderPanel(ctx, p));
    console.log("ok");
  }
  console.log("compositing …");
  const payload = composite(rendered);
  await ctx.navigate("about:blank");
  const finalURL = await ctx.ev(`(${COMPOSITOR})(${JSON.stringify(payload)})`);
  fs.writeFileSync(out, Buffer.from(finalURL.split(",")[1], "base64"));
  console.log("wrote " + out);
  ctx.sock.close(); ctx.chrome.kill();
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
