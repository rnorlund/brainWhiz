// bet/bet_worker.js — off-main-thread brain extraction + tissue segmentation for the brainWhiz UI.
// Module worker. Two BET engines, both clean-room:
//   • 'learned'  — our distilled 3D U-Net (bet/model/bet_unet.onnx) via onnxruntime-web (best quality).
//   • 'refined'/'fast' — geometric deep-core + curvature prior (+ optional OASIS-prior gate).
// Then CSF/GM/WM tissue segmentation. Posts progress + transferable results.
// Requires the app to be SERVED (module workers can't load on file://).
import { extractBrain, applyMask, largestComponent, fillHoles3D, smoothMask3D, dilate3D } from './bet.js';
import { segmentTissue } from './tissue.js';
import { registerAffine, invert4x4, resampleLabels } from '../chop/chop.js';
import { conformVol, probToNative, labelToNative, BET_SHAPE } from './conform.js';

const P = (pct, msg) => self.postMessage({ type: 'progress', pct, msg });
const ORT_VER = '1.20.1', ORT_CDN = `https://cdn.jsdelivr.net/npm/onnxruntime-web@${ORT_VER}/dist/`;
let _ort = null, _sess = null, _sessBackend = null, _buf = null, _backend = 'wasm', _last = null;
// Backend is user-selectable (Compute dropdown) so it can be A/B'd on a real GPU:
//   • WASM (CPU): verified identical to the PyTorch reference (agreement 99.98%, Dice 0.9998). Default.
//   • WebGPU (GPU): faster on real hardware, but kernels/precision can differ by device.
// We create the session with the chosen EP ONLY (no silent fallback) so the reported backend is honest.
async function loadModel(want) {
  want = (want === 'webgpu') ? 'webgpu' : 'wasm';
  if (_sess && _sessBackend === want) return _sess;
  // the webgpu bundle ships BOTH backends, so one module serves either choice
  if (!_ort) {
    _ort = await import(ORT_CDN + 'ort.webgpu.min.mjs'); _ort.env.wasm.wasmPaths = ORT_CDN;
    _ort.env.wasm.numThreads = (self.crossOriginIsolated && navigator.hardwareConcurrency)
      ? Math.min(8, navigator.hardwareConcurrency) : 1;                 // multi-threaded WASM if cross-origin isolated
  }
  if (_sess) { try { await _sess.release?.(); } catch (e) {} _sess = null; }   // backend switched → recreate
  if (!_buf) { const url = new URL('model/bet_unet_hires.onnx', import.meta.url); _buf = await (await fetch(url)).arrayBuffer(); }
  if (want === 'webgpu') {
    try {
      _sess = await _ort.InferenceSession.create(_buf, { executionProviders: ['webgpu'] });
      _sessBackend = 'webgpu'; _backend = 'webgpu'; return _sess;
    } catch (e) { _backend = 'wasm (WebGPU unavailable)'; }             // no adapter → honest note, fall to wasm
  }
  _sess = await _ort.InferenceSession.create(_buf, { executionProviders: ['wasm'] });
  _sessBackend = 'wasm';
  if (want === 'wasm') _backend = _ort.env.wasm.numThreads > 1 ? `wasm×${_ort.env.wasm.numThreads}` : 'wasm';
  return _sess;
}
const affToMT = a => ({ M: [a[0][0], a[0][1], a[0][2], a[1][0], a[1][1], a[1][2], a[2][0], a[2][1], a[2][2]], T: [a[0][3], a[1][3], a[2][3]] });

async function learnedTissue(vol, want) {          // vol: {data,dims,affine} -> Uint8 native label 0=bg,1=CSF,2=GM,3=WM
  P(20, 'Loading AI model…'); const sess = await loadModel(want);
  const { M, T } = affToMT(vol.affine);
  P(40, 'Conforming to model grid…');
  const { x, Tat } = conformVol({ data: vol.data, dims: vol.dims, M, T });
  P(55, 'Running AI tissue segmentation…');       // ~40s single-threaded WASM at 192³
  const out = await sess.run({ t1: new _ort.Tensor('float32', x, [1, 1, BET_SHAPE[0], BET_SHAPE[1], BET_SHAPE[2]]) });
  const o = out.logit || out[Object.keys(out)[0]];
  const d = o.data, C = o.dims[1], V = BET_SHAPE[0] * BET_SHAPE[1] * BET_SHAPE[2];
  P(78, 'Warping to native space…');
  const label = new Uint8Array(V);
  if (C === 1) { for (let v = 0; v < V; v++) label[v] = d[v] > 0 ? 1 : 0; }   // binary fallback (old model)
  else { for (let v = 0; v < V; v++) { let best = d[v], bi = 0; for (let c = 1; c < C; c++) { const val = d[c*V + v]; if (val > best) { best = val; bi = c; } } label[v] = bi; } }
  return labelToNative(label, Tat, { data: vol.data, dims: vol.dims, M, T });   // nearest -> native classes
}

// ---- full-head 6-tissue model (bg/CSF/GM/WM/skull/scalp) — its own grid + session ----
const HEAD_SHAPE = [160, 192, 160], HEAD_VOX = 1.4;
let _headBuf = null, _headSess = null, _headBackend = null;
async function loadHeadModel(want) {
  want = (want === 'webgpu') ? 'webgpu' : 'wasm';
  if (_headSess && _headBackend === want) return _headSess;
  if (!_ort) {
    _ort = await import(ORT_CDN + 'ort.webgpu.min.mjs'); _ort.env.wasm.wasmPaths = ORT_CDN;
    _ort.env.wasm.numThreads = (self.crossOriginIsolated && navigator.hardwareConcurrency) ? Math.min(8, navigator.hardwareConcurrency) : 1;
  }
  if (_headSess) { try { await _headSess.release?.(); } catch (e) {} _headSess = null; }
  if (!_headBuf) { const url = new URL('model/bet_head6.onnx', import.meta.url); _headBuf = await (await fetch(url)).arrayBuffer(); }
  if (want === 'webgpu') {
    try { _headSess = await _ort.InferenceSession.create(_headBuf, { executionProviders: ['webgpu'] }); _headBackend = 'webgpu'; _backend = 'webgpu'; return _headSess; }
    catch (e) { _backend = 'wasm (WebGPU unavailable)'; }
  }
  _headSess = await _ort.InferenceSession.create(_headBuf, { executionProviders: ['wasm'] }); _headBackend = 'wasm';
  if (want === 'wasm') _backend = _ort.env.wasm.numThreads > 1 ? `wasm×${_ort.env.wasm.numThreads}` : 'wasm';
  return _headSess;
}
// -> Uint8 native 6-class label: 0=bg,1=CSF,2=GM,3=WM,4=skull,5=scalp
async function learnedHead(vol, want) {
  P(18, 'Loading full-head model…'); const sess = await loadHeadModel(want);
  const { M, T } = affToMT(vol.affine);
  P(38, 'Conforming to head grid…');
  const { x, Tat } = conformVol({ data: vol.data, dims: vol.dims, M, T }, HEAD_SHAPE, HEAD_VOX);
  P(52, 'Running 6-tissue segmentation…');
  const out = await sess.run({ t1: new _ort.Tensor('float32', x, [1, 1, HEAD_SHAPE[0], HEAD_SHAPE[1], HEAD_SHAPE[2]]) });
  const o = out.logit || out[Object.keys(out)[0]];
  const d = o.data, C = o.dims[1], V = HEAD_SHAPE[0] * HEAD_SHAPE[1] * HEAD_SHAPE[2];
  P(80, 'Warping to native space…');
  const label = new Uint8Array(V);
  for (let v = 0; v < V; v++) { let best = d[v], bi = 0; for (let c = 1; c < C; c++) { const val = d[c*V + v]; if (val > best) { best = val; bi = c; } } label[v] = bi; }
  return labelToNative(label, Tat, { data: vol.data, dims: vol.dims, M, T }, HEAD_SHAPE, HEAD_VOX);
}

// grow GM(2)/WM(3) outward into bright partial-volume voxels (> the CSF<->GM intensity valley), up to
// `iters` voxels — recovers the pial rim the >50%-GM teacher trims. Stops at dark CSF/skull.
function pialPush(nat, data, dims, iters) {
  const [nx, ny, nz] = dims, N = nx * ny * nz; let gs = 0, gn = 0, cs = 0, cn = 0;
  for (let i = 0; i < N; i++) { const c = nat[i]; if (c === 2) { gs += data[i]; gn++; } else if (c === 1) { cs += data[i]; cn++; } }
  if (!gn || !cn) return nat; const thr = 0.5 * (gs / gn + cs / cn); const out = Uint8Array.from(nat), nxy = nx * ny;
  for (let it = 0; it < iters; it++) { const add = [];
    for (let z = 1; z < nz - 1; z++) for (let y = 1; y < ny - 1; y++) { const b = nx * (y + ny * z);
      for (let x = 1; x < nx - 1; x++) { const i = b + x; if (out[i] >= 2 || data[i] <= thr) continue;
        if (out[i-1] >= 2 || out[i+1] >= 2 || out[i-nx] >= 2 || out[i+nx] >= 2 || out[i-nxy] >= 2 || out[i+nxy] >= 2) add.push(i); } }
    if (!add.length) break; for (let k = 0; k < add.length; k++) out[add[k]] = 2; }
  return out;
}
// derive brain mask + CSF/GM/WM from a native label honoring the BET controls (pial reach, mask type), then post
function deriveAndPost(vol, natRaw, opts) {
  const [nx, ny, nz] = vol.dims, N = nx * ny * nz, data = vol.data;
  P(90, 'Applying controls…');
  const pial = Math.max(0, Math.min(3, (opts.pial | 0)));
  const nat = pial > 0 ? pialPush(natRaw, data, vol.dims, pial) : natRaw;
  const whole = opts.maskType === 'whole';
  let mask = new Uint8Array(N); for (let i = 0; i < N; i++) mask[i] = (whole ? nat[i] > 0 : nat[i] >= 2) ? 1 : 0;
  mask = largestComponent(mask, vol.dims); mask = fillHoles3D(mask, vol.dims);
  const cortex = new Float32Array(N), wm = new Float32Array(N), gm = new Float32Array(N);
  let cs = 0, cn = 0, gs = 0, gn = 0, ws = 0, wn = 0, vox = 0;
  for (let i = 0; i < N; i++) { if (!mask[i]) continue; vox++; const c = nat[i], val = data[i];
    if (c === 1) { cs += val; cn++; } else if (c === 2) { gm[i] = val; cortex[i] = val; gs += val; gn++; } else if (c === 3) { wm[i] = val; cortex[i] = val; ws += val; wn++; } }
  const centroids = [cn ? cs / cn : 0, gn ? gs / gn : 0, wn ? ws / wn : 0];
  const note = `AI tissue U-Net (1mm 3-class, ${(100 * vox / N).toFixed(1)}%${pial ? ', pial+' + pial : ''}, ${whole ? 'whole' : 'cortical'}) · ${_backend}`;
  const m8 = (mask instanceof Uint8Array) ? mask : Uint8Array.from(mask);
  P(100, 'Done');
  self.postMessage({ type: 'done', mask: m8, cortex, wm, gm, voxels: vox, total: N, centroids, note }, [m8.buffer, cortex.buffer, wm.buffer, gm.buffer]);
}

self.onmessage = async (e) => {
  const m = e.data;
  if (m.cmd === 'reprocess') {   // re-apply BET controls to the cached label — no 40s re-inference
    if (_last) { try { deriveAndPost(_last.vol, _last.nat, m.opts || {}); } catch (err) { self.postMessage({ type: 'error', msg: (err && err.message) || String(err) }); } }
    return;
  }
  if (m.cmd !== 'extract') return;
  try {
    const { vol, mni, prior, opts = {} } = m;
    const [nx, ny, nz] = vol.dims, N = nx * ny * nz;
    let mask, note;
    // ---- full-head 6-tissue layers: post the native label volume for the peelable head render ----
    if (opts.method === 'headlayers') {
      const nat = await learnedHead(vol, opts.backend);   // 0bg 1CSF 2GM 3WM 4skull 5scalp
      const lab = (nat instanceof Uint8Array) ? nat : Uint8Array.from(nat);
      P(100, 'Done');
      self.postMessage({ type: 'headdone', label: lab, dims: vol.dims, affine: vol.affine, note: `Full-head 6-tissue U-Net · ${_backend}` }, [lab.buffer]);
      return;
    }
    // ---- learned engine: the 3-class U-Net gives brain + CSF/GM/WM directly (no k-means heuristic) ----
    if (opts.method === 'learned') {
      const nat = await learnedTissue(vol, opts.backend);   // native label 0=bg,1=CSF,2=GM,3=WM
      _last = { vol: { data: vol.data, dims: vol.dims }, nat };   // cache so control tweaks re-derive instantly
      deriveAndPost(vol, nat, opts);                              // honors opts.pial / opts.maskType
      return;
    }
    // ---- geometric engines (deep-core / OASIS-gated refined) ----
    P(6, 'Thresholding & deep-core…');
    const M0 = extractBrain(vol, { method: 'deepcore' });
    mask = M0.mask; note = `deep-core ${(100 * M0.voxels / N).toFixed(1)}%`;
    if (opts.refined && mni && prior) {
      P(42, 'Registering brain → MNI…');
      const brainVol = { data: applyMask(vol.data, mask), dims: vol.dims, affine: vol.affine };
      const reg = registerAffine(brainVol, mni, {});
      P(70, `Warping OASIS prior back (NMI ${reg.nmi.toFixed(3)})…`);
      const S2M = invert4x4(reg.matrix), PT = 255 * (prior.pt ?? 0.20);
      const mniMask = new Int32Array(prior.data.length); for (let i = 0; i < mniMask.length; i++) mniMask[i] = prior.data[i] >= PT ? 1 : 0;
      let np = resampleLabels({ data: mniMask, dims: prior.dims, affine: prior.affine }, { dims: vol.dims, affine: vol.affine }, S2M);
      let pr = new Uint8Array(N); for (let i = 0; i < N; i++) pr[i] = np[i] ? 1 : 0;
      const dil = Math.max(1, Math.round((opts.dilMM ?? 6) / Math.min(vol.spacing[0], vol.spacing[1], vol.spacing[2])));
      pr = dilate3D(pr, vol.dims, dil);
      const g = new Uint8Array(N); for (let i = 0; i < N; i++) g[i] = (mask[i] && pr[i]) ? 1 : 0;
      mask = g; note += ` → OASIS-gated (n=${prior.n}, P≥${prior.pt ?? 0.20})`;
    }
    P(86, 'Cleaning mask…');
    mask = largestComponent(mask, vol.dims); mask = fillHoles3D(mask, vol.dims); mask = smoothMask3D(mask, vol.dims, opts.refined ? 2 : 1);
    P(90, 'Segmenting tissue (CSF/GM/WM)…');
    const seg = segmentTissue(vol.data, mask, { invert: !!opts.t2 });
    const cortex = new Float32Array(N), wm = new Float32Array(N), gm = new Float32Array(N);
    for (let i = 0; i < N; i++) { if (seg.cortex[i]) cortex[i] = vol.data[i]; if (seg.wm[i]) wm[i] = vol.data[i]; if (seg.gm[i]) gm[i] = vol.data[i]; }
    let vox = 0; for (let i = 0; i < N; i++) vox += mask[i];
    const mask8 = (mask instanceof Uint8Array) ? mask : Uint8Array.from(mask);
    P(100, 'Done');
    self.postMessage({ type: 'done', mask: mask8, cortex, wm, gm, voxels: vox, total: N, centroids: seg.centroids, note },
      [mask8.buffer, cortex.buffer, wm.buffer, gm.buffer]);
  } catch (err) { self.postMessage({ type: 'error', msg: (err && err.message) || String(err) }); }
};
