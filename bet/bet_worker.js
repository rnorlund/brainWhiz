// bet/bet_worker.js — off-main-thread brain extraction + tissue segmentation for the brainWhiz UI.
// Module worker. Two BET engines, both clean-room:
//   • 'learned'  — our distilled 3D U-Net (bet/model/bet_unet.onnx) via onnxruntime-web (best quality).
//   • 'refined'/'fast' — geometric deep-core + curvature prior (+ optional OASIS-prior gate).
// Then CSF/GM/WM tissue segmentation. Posts progress + transferable results.
// Requires the app to be SERVED (module workers can't load on file://).
import { extractBrain, applyMask, largestComponent, fillHoles3D, smoothMask3D, dilate3D } from './bet.js';
import { segmentTissue } from './tissue.js';
import { registerAffine, invert4x4, resampleLabels } from '../chop/chop.js';
import { conformVol, probToNative, BET_SHAPE } from './conform.js';

const P = (pct, msg) => self.postMessage({ type: 'progress', pct, msg });
const ORT_VER = '1.20.1', ORT_CDN = `https://cdn.jsdelivr.net/npm/onnxruntime-web@${ORT_VER}/dist/`;
let _ort = null, _sess = null;
async function loadModel() {
  if (_sess) return _sess;
  if (!_ort) { _ort = await import(ORT_CDN + 'ort.wasm.min.mjs'); _ort.env.wasm.wasmPaths = ORT_CDN; }
  const url = new URL('model/bet_unet.onnx', import.meta.url);
  const buf = await (await fetch(url)).arrayBuffer();
  _sess = await _ort.InferenceSession.create(buf, { executionProviders: ['wasm'] });
  return _sess;
}
const affToMT = a => ({ M: [a[0][0], a[0][1], a[0][2], a[1][0], a[1][1], a[1][2], a[2][0], a[2][1], a[2][2]], T: [a[0][3], a[1][3], a[2][3]] });

async function learnedMask(vol) {                 // vol: {data,dims,affine} -> Uint8 native mask
  P(20, 'Loading AI model…'); const sess = await loadModel();
  const { M, T } = affToMT(vol.affine);
  P(45, 'Conforming to model grid…');
  const { x, Tat } = conformVol({ data: vol.data, dims: vol.dims, M, T });
  P(60, 'Running AI brain extraction…');
  const out = await sess.run({ t1: new _ort.Tensor('float32', x, [1, 1, BET_SHAPE[0], BET_SHAPE[1], BET_SHAPE[2]]) });
  const logit = (out.logit || out[Object.keys(out)[0]]).data;
  const prob = new Float32Array(logit.length);
  for (let i = 0; i < logit.length; i++) prob[i] = 1 / (1 + Math.exp(-logit[i]));
  P(80, 'Warping mask to native space…');
  const np = probToNative(prob, Tat, { data: vol.data, dims: vol.dims, M, T });
  const mask = new Uint8Array(np.length); for (let i = 0; i < np.length; i++) mask[i] = np[i] >= 0.5 ? 1 : 0;
  return mask;
}

self.onmessage = async (e) => {
  const m = e.data; if (m.cmd !== 'extract') return;
  try {
    const { vol, mni, prior, opts = {} } = m;
    const [nx, ny, nz] = vol.dims, N = nx * ny * nz;
    let mask, note;
    if (opts.method === 'learned') {
      mask = await learnedMask(vol);
      let v0 = 0; for (let i = 0; i < N; i++) v0 += mask[i];
      note = `AI U-Net (distilled, ${(100 * v0 / N).toFixed(1)}%)`;
    } else {
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
    }
    P(86, 'Cleaning mask…');
    mask = largestComponent(mask, vol.dims); mask = fillHoles3D(mask, vol.dims); mask = smoothMask3D(mask, vol.dims, opts.method === 'learned' ? 1 : (opts.refined ? 2 : 1));
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
