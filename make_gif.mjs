#!/usr/bin/env node
// make_gif.mjs — render a looping Quickstart GIF of brainWhiz (rotate + explode + overlay).
// Usage: node make_gif.mjs [--atlas jhu] [--task motor] [--frames 48] [--size 480x375] [--out docs/img/quickstart.gif]
// Requires: npm install ws  +  Chrome/Chromium  +  ffmpeg (on PATH).
import http from 'http';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { spawn, spawnSync } from 'child_process';
import { fileURLToPath } from 'url';
import { WebSocket } from 'ws';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const arg = (n, d) => { const i = process.argv.indexOf(n); return i >= 0 ? process.argv[i + 1] : d; };

const ATLAS  = arg('--atlas', 'jhu');
const TASK   = arg('--task', 'motor');
const FRAMES = parseInt(arg('--frames', '48'));
const [W, H] = arg('--size', '480x375').split('x').map(Number);
const OUT    = path.resolve(process.cwd(), arg('--out', 'docs/img/quickstart.gif'));
const RADIUS = parseFloat(arg('--radius', '335'));
const ELEV   = parseFloat(arg('--elev', '40'));
const EMAX   = parseFloat(arg('--explode', '0.6'));

const CHROME_CANDIDATES = [
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Chromium.app/Contents/MacOS/Chromium",
  "google-chrome", "chromium", "chrome",
];
const CHROME = CHROME_CANDIDATES.find(p => { try { return p.includes('/') ? fs.existsSync(p) : true; } catch { return false; } });
const sleep = ms => new Promise(r => setTimeout(r, ms));
const port = 9700 + (FRAMES % 200);

async function cdp() {
  const chrome = spawn(CHROME, ["--headless=new", `--remote-debugging-port=${port}`,
    "--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader",
    "--no-first-run", "--user-data-dir=" + path.join(HERE, ".chrome-giftmp-" + port),
    "--window-size=1200,900", "about:blank"], { stdio: "ignore" });
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

(async () => {
  if (!CHROME) { console.error("Chrome/Chromium not found."); process.exit(1); }
  if (!spawnSync("ffmpeg", ["-version"], { stdio: "ignore" }).status === 0) {}
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "bwz-gif-"));
  console.log(`booting headless Chrome (atlas=${ATLAS}, task=${TASK}, ${FRAMES} frames @ ${W}x${H}) …`);
  const ctx = await cdp();
  await ctx.navigate(`file://${HERE}/index.html?atlas=${encodeURIComponent(ATLAS)}`);
  for (let i = 0; i < 60; i++) { if (await ctx.ev(`typeof window.brainAPI`) === "object") break; await sleep(400); }
  await ctx.ev(`window.brainAPI.ready`);
  // initial look: gray brain + colored task overlay, white background, UI hidden
  await ctx.ev(`window.brainAPI.applyConfig(${JSON.stringify({
    task: TASK, bg: "#ffffff", explosion: { amount: 0, distance: 1.4 },
    controls: { ovStyle: "solid", ovColor: "#d62728", cthresh: "0.12", vivid: "1.6" },
    uiHidden: true })})`);
  await sleep(300);

  for (let i = 0; i < FRAMES; i++) {
    const th = (i / FRAMES) * Math.PI * 2;
    const e  = (EMAX / 2) * (1 - Math.cos(th));                 // 0 → EMAX → 0 across the loop
    const camP = [RADIUS * Math.sin(th), ELEV, RADIUS * Math.cos(th)];
    await ctx.ev(`window.brainAPI.applyConfig(${JSON.stringify({ explosion: { amount: e, distance: 1.4 } })})`);
    await ctx.ev(`window.brainAPI.applyCfg(${JSON.stringify({ atlas: ATLAS, vals: {}, camP, camT: [0, 0, 0] })})`);
    const url = await ctx.ev(`window.brainAPI.renderTo(${W},${H},false)`);
    fs.writeFileSync(path.join(tmp, `f${String(i).padStart(3, "0")}.png`), Buffer.from(url.split(",")[1], "base64"));
    process.stdout.write(`\r  frame ${i + 1}/${FRAMES}`);
  }
  console.log("\nencoding GIF with ffmpeg …");
  ctx.sock.close(); ctx.chrome.kill();

  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  const fps = 16, pal = path.join(tmp, "pal.png");
  spawnSync("ffmpeg", ["-y", "-i", path.join(tmp, "f%03d.png"),
    "-vf", `fps=${fps},palettegen=stats_mode=diff`, pal], { stdio: "ignore" });
  const r = spawnSync("ffmpeg", ["-y", "-framerate", String(fps), "-i", path.join(tmp, "f%03d.png"), "-i", pal,
    "-lavfi", `fps=${fps} [x]; [x][1:v] paletteuse=dither=bayer:bayer_scale=3`,
    "-loop", "0", OUT], { stdio: "ignore" });
  if (r.status !== 0) { console.error("ffmpeg failed"); process.exit(1); }
  console.log(`wrote ${OUT} (${(fs.statSync(OUT).size / 1024).toFixed(0)} KB)`);
})();
