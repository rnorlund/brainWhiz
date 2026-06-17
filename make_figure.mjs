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
if (!specPath) { console.error("usage: node make_figure.mjs <spec.json>"); process.exit(1); }
const spec = JSON.parse(fs.readFileSync(specPath, "utf8"));
const cols = spec.cols || 2;
const [cellW, cellH] = spec.cell || [460, 360];
const gap = spec.gap ?? 14, bg = spec.bg || "#ffffff";
const labelSize = spec.labelSize ?? 24, labelColor = spec.labelColor || "#111";
const out = path.resolve(path.dirname(specPath), spec.out || "figure.png");

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
    "--no-first-run", "--user-data-dir=" + path.join(HERE, ".chrome-figtmp"),
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
  const atlas = panel.atlas || "jhu";
  await ctx.navigate(`file://${HERE}/index.html?atlas=${encodeURIComponent(atlas)}`);
  // wait for brainAPI + model
  for (let i = 0; i < 60; i++) { const t = await ctx.ev(`typeof window.brainAPI`); if (t === "object") break; await sleep(400); }
  await ctx.ev(`window.brainAPI.ready`);
  const cfg = {
    view: panel.view || "left", task: panel.task, regionSet: panel.regionSet,
    scheme: panel.scheme, explosion: panel.explosion, connectivity: panel.connectivity,
    bg: panel.bg || bg, controls: panel.controls || {}, uiHidden: true,
  };
  await ctx.ev(`window.brainAPI.applyConfig(${JSON.stringify(cfg)})`);
  await sleep(250);
  const dataURL = await ctx.ev(`window.brainAPI.renderTo(${cellW},${cellH},false)`);
  const cbar = await ctx.ev(`window.brainAPI.colorbar()`);
  return { dataURL, label: panel.label || "", cbar };
}

function composite(panels) {
  // build the montage inside the browser (has Canvas), return final PNG dataURL
  const rows = Math.ceil(panels.length / cols);
  const cbInfo = spec.colorbar ? (panels.find(p => p.cbar) || {}).cbar : null;
  let lut = null;
  if (cbInfo) lut = (cbInfo.style === "cmap") ? (CMAPS[cbInfo.cmap] || CMAPS.viridis)
    : [[0.54, 0.56, 0.6], hexToRgb(cbInfo.color)];
  const payload = { cols, cellW, cellH, gap, bg, labelSize, labelColor, rows,
    panels: panels.map(p => ({ dataURL: p.dataURL, label: p.label })),
    cbar: cbInfo ? { ...cbInfo, lut } : null };
  return payload;
}
function hexToRgb(h){ h=h.replace('#',''); return [parseInt(h.slice(0,2),16)/255,parseInt(h.slice(2,4),16)/255,parseInt(h.slice(4,6),16)/255]; }

const COMPOSITOR = `async (F)=>{
  const cbH = F.cbar ? 54 : 0;
  const cvs=document.createElement('canvas');
  cvs.width = F.cols*F.cellW + (F.cols+1)*F.gap;
  cvs.height = F.rows*(F.cellH+F.labelSize) + (F.rows+1)*F.gap + cbH;
  const x=cvs.getContext('2d'); x.fillStyle=F.bg; x.fillRect(0,0,cvs.width,cvs.height);
  await Promise.all(F.panels.map((p,i)=>new Promise(res=>{
    const img=new Image(); img.onload=()=>{
      const c=i%F.cols, r=Math.floor(i/F.cols);
      const px=F.gap+c*(F.cellW+F.gap), py=F.gap+r*(F.cellH+F.labelSize+F.gap);
      x.drawImage(img,px,py,F.cellW,F.cellH);
      if(p.label){ x.fillStyle=F.labelColor; x.font='bold '+Math.round(F.labelSize*0.72)+'px system-ui';
        x.textAlign='center'; x.fillText(p.label, px+F.cellW/2, py+F.cellH+F.labelSize*0.78); }
      res();
    }; img.onerror=()=>res(); img.src=p.dataURL;
  })));
  if(F.cbar){ const cb=F.cbar, W=Math.min(360,cvs.width-120), H=14;
    const bx=(cvs.width-W)/2, by=cvs.height-cbH+14;
    for(let i=0;i<W;i++){ const t=i/(W-1); const lut=cb.lut; const f=t*(lut.length-1), a=Math.floor(f), g=f-a;
      const c0=lut[a], c1=lut[Math.min(lut.length-1,a+1)];
      const rr=Math.round(255*(c0[0]+(c1[0]-c0[0])*g)), gg=Math.round(255*(c0[1]+(c1[1]-c0[1])*g)), bb=Math.round(255*(c0[2]+(c1[2]-c0[2])*g));
      x.fillStyle='rgb('+rr+','+gg+','+bb+')'; x.fillRect(bx+i,by,1,H); }
    x.fillStyle=F.labelColor; x.font='12px system-ui'; x.textAlign='left'; x.fillText((cb.min).toFixed(1), bx, by+H+14);
    x.textAlign='right'; x.fillText((cb.max).toFixed(1), bx+W, by+H+14);
    x.textAlign='center'; x.fillText(cb.name||'', bx+W/2, by-4);
  }
  return cvs.toDataURL('image/png');
}`;

(async () => {
  if (!CHROME) { console.error("Chrome/Chromium not found."); process.exit(1); }
  console.log(`rendering ${spec.panels.length} panel(s) …`);
  const ctx = await cdp();
  const rendered = [];
  for (let i = 0; i < spec.panels.length; i++) {
    process.stdout.write(`  panel ${i + 1}/${spec.panels.length} (${spec.panels[i].atlas || 'jhu'} · ${spec.panels[i].label || ''}) … `);
    rendered.push(await renderPanel(ctx, spec.panels[i]));
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
