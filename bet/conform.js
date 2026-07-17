// bet/conform.js — JS reproduction of bet/train/common.py's explicit conform, so the ONNX model
// sees the SAME 192x224x192 @1mm RAS input in-browser as it did in training. Also maps the model's
// probability/label volume back into native space. Dependency-free (usable in the worker and in node).
export const BET_SHAPE = [192, 224, 192], BET_VOX = 1.0;   // high-res 3-class tissue model (was 96x112x96 @2mm)

function inv3(m) {  // 3x3 inverse, row-major
  const [a,b,c,d,e,f,g,h,i] = m;
  const A=e*i-f*h, B=-(d*i-f*g), C=d*h-e*g, det=a*A+b*B+c*C, id=1/det;
  return [A*id, (c*h-b*i)*id, (b*f-c*e)*id, B*id, (a*i-c*g)*id, (c*d-a*f)*id, C*id, (b*g-a*h)*id, (a*e-b*d)*id];
}
// Otsu over a 256-bin histogram of [0, p99.5] (matches common._otsu closely enough for the bbox)
function otsuThresh(data) {
  let hi = 0; const N = data.length;
  // p99.5 via a coarse pass: max then histogram-CDF
  let mx = 0; for (let i = 0; i < N; i++) { const v = data[i]; if (v > mx) mx = v; }
  if (mx <= 0) return 0;
  const B = 512, h = new Float64Array(B), s = mx / B;
  for (let i = 0; i < N; i++) { const v = data[i]; if (v > 0) h[Math.min(B - 1, (v / s) | 0)]++; }
  let cum = 0, tot = 0; for (let k = 0; k < B; k++) tot += h[k];
  for (let k = 0; k < B; k++) { cum += h[k]; if (cum >= 0.995 * tot) { hi = (k + 1) * s; break; } }
  if (hi <= 0) hi = mx;
  const nb = 256, hist = new Float64Array(nb), bs = hi / nb;
  for (let i = 0; i < N; i++) { let v = data[i]; if (v < 0) v = 0; if (v > hi) v = hi; hist[Math.min(nb - 1, (v / bs) | 0)]++; }
  let sum = 0, wsum = 0, n = 0; for (let k = 0; k < nb; k++) { sum += hist[k]; wsum += k * hist[k]; }
  let wB = 0, sB = 0, best = -1, thr = 0;
  for (let k = 0; k < nb; k++) { wB += hist[k]; if (!wB) continue; const wF = sum - wB; if (!wF) break;
    sB += k * hist[k]; const mB = sB / wB, mF = (wsum - sB) / wF, v = wB * wF * (mB - mF) * (mB - mF);
    if (v > best) { best = v; thr = k * bs; } }
  return thr;
}
// vol: {data:Float32Array, dims:[nx,ny,nz], M:[9 row-major], T:[3]}  (M,T = native voxel->world)
export function conformVol(vol, shape, vox) {
  const [nx, ny, nz] = vol.dims, M = vol.M, T = vol.T, data = vol.data;
  const thr = otsuThresh(data) * 0.5;
  let lo = [nx, ny, nz], hi = [-1, -1, -1];
  for (let k = 0; k < nz; k++) for (let j = 0; j < ny; j++) { const b = nx * (j + ny * k);
    for (let i = 0; i < nx; i++) if (data[b + i] > thr) {
      if (i < lo[0]) lo[0] = i; if (i > hi[0]) hi[0] = i; if (j < lo[1]) lo[1] = j; if (j > hi[1]) hi[1] = j;
      if (k < lo[2]) lo[2] = k; if (k > hi[2]) hi[2] = k; } }
  if (hi[0] < 0) { lo = [0, 0, 0]; hi = [nx - 1, ny - 1, nz - 1]; }
  const zoom = [Math.hypot(M[0],M[3],M[6])||1, Math.hypot(M[1],M[4],M[7])||1, Math.hypot(M[2],M[5],M[8])||1];
  for (let d = 0; d < 3; d++) { const p = Math.round(8 / zoom[d]); lo[d] = Math.max(0, lo[d] - p); hi[d] = Math.min([nx,ny,nz][d]-1, hi[d] + p); }
  const cvox = [(lo[0]+hi[0])/2, (lo[1]+hi[1])/2, (lo[2]+hi[2])/2];
  const center = [ M[0]*cvox[0]+M[1]*cvox[1]+M[2]*cvox[2]+T[0], M[3]*cvox[0]+M[4]*cvox[1]+M[5]*cvox[2]+T[1], M[6]*cvox[0]+M[7]*cvox[1]+M[8]*cvox[2]+T[2] ];
  const [SX, SY, SZ] = shape || BET_SHAPE, V = vox || BET_VOX;
  const Tat = [ center[0]-V*(SX-1)/2, center[1]-V*(SY-1)/2, center[2]-V*(SZ-1)/2 ];   // Ta diag(V) + Tat
  const Ri = inv3(M);  // native world->voxel = Ri @ (world - T)
  const x = new Float32Array(SX*SY*SZ);
  for (let i = 0; i < SX; i++) for (let j = 0; j < SY; j++) for (let k = 0; k < SZ; k++) {
    const wx = V*i + Tat[0], wy = V*j + Tat[1], wz = V*k + Tat[2];        // target voxel -> world (RAS)
    const dx = wx - T[0], dy = wy - T[1], dz = wz - T[2];
    const vx = Ri[0]*dx+Ri[1]*dy+Ri[2]*dz, vy = Ri[3]*dx+Ri[4]*dy+Ri[5]*dz, vz = Ri[6]*dx+Ri[7]*dy+Ri[8]*dz;
    x[(i*SY + j)*SZ + k] = trilin(data, nx, ny, nz, 1, nx, nx*ny, vx, vy, vz);   // C-order out (numpy/torch/onnx)
  }
  // normalize by p99.5 of positive values
  const pos = []; for (let i = 0; i < x.length; i++) if (x[i] > 0) pos.push(x[i]);
  pos.sort((a, b) => a - b); const p = pos.length ? pos[Math.min(pos.length-1, Math.round(0.995*(pos.length-1)))] : 1;
  const inv = 1 / (p > 0 ? p : 1); for (let i = 0; i < x.length; i++) { let v = x[i]*inv; x[i] = v < 0 ? 0 : (v > 1 ? 1 : v); }
  return { x, Tat, lo, hi };
}
// generic strided trilinear: sample array `a` (dims nx,ny,nz; index = x*sx+y*sy+z*sz) at (x,y,z)
function trilin(a, nx, ny, nz, sx, sy, sz, x, y, z) {
  const x0 = Math.floor(x), y0 = Math.floor(y), z0 = Math.floor(z);
  if (x0 < 0 || y0 < 0 || z0 < 0 || x0 >= nx-1 || y0 >= ny-1 || z0 >= nz-1) {
    const xi = Math.round(x), yi = Math.round(y), zi = Math.round(z);
    if (xi < 0 || yi < 0 || zi < 0 || xi >= nx || yi >= ny || zi >= nz) return 0;
    return a[xi*sx + yi*sy + zi*sz];
  }
  const fx = x-x0, fy = y-y0, fz = z-z0, b = x0*sx + y0*sy + z0*sz;
  const c000=a[b], c100=a[b+sx], c010=a[b+sy], c110=a[b+sx+sy];
  const c001=a[b+sz], c101=a[b+sx+sz], c011=a[b+sy+sz], c111=a[b+sx+sy+sz];
  const c00=c000*(1-fx)+c100*fx, c01=c001*(1-fx)+c101*fx, c10=c010*(1-fx)+c110*fx, c11=c011*(1-fx)+c111*fx;
  return (c00*(1-fy)+c10*fy)*(1-fz) + (c01*(1-fy)+c11*fy)*fz;
}
// map a model probability volume (SHAPE, C-order) back to native voxels (i-fastest)
export function probToNative(prob, Tat, vol, shape, vox) {
  const [nx, ny, nz] = vol.dims, M = vol.M, T = vol.T, [SX, SY, SZ] = shape || BET_SHAPE, V = vox || BET_VOX;
  const out = new Float32Array(nx*ny*nz);
  for (let k = 0; k < nz; k++) for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    const wx = M[0]*i+M[1]*j+M[2]*k+T[0], wy = M[3]*i+M[4]*j+M[5]*k+T[1], wz = M[6]*i+M[7]*j+M[8]*k+T[2];
    const tx = (wx - Tat[0])/V, ty = (wy - Tat[1])/V, tz = (wz - Tat[2])/V;
    out[i + nx*(j + ny*k)] = trilin(prob, SX, SY, SZ, SY*SZ, SZ, 1, tx, ty, tz);   // prob is C-order
  }
  return out;
}
// map a model LABEL volume (SHAPE, C-order, integer classes) back to native voxels by NEAREST neighbour
// (trilinear would blur class boundaries). Used by the multi-class tissue model.
export function labelToNative(label, Tat, vol, shape, vox) {
  const [nx, ny, nz] = vol.dims, M = vol.M, T = vol.T, [SX, SY, SZ] = shape || BET_SHAPE, V = vox || BET_VOX;
  const out = new Uint8Array(nx*ny*nz);
  for (let k = 0; k < nz; k++) for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    const wx = M[0]*i+M[1]*j+M[2]*k+T[0], wy = M[3]*i+M[4]*j+M[5]*k+T[1], wz = M[6]*i+M[7]*j+M[8]*k+T[2];
    const tx = Math.round((wx - Tat[0])/V), ty = Math.round((wy - Tat[1])/V), tz = Math.round((wz - Tat[2])/V);
    if (tx < 0 || ty < 0 || tz < 0 || tx >= SX || ty >= SY || tz >= SZ) continue;
    out[i + nx*(j + ny*k)] = label[(tx*SY + ty)*SZ + tz];   // label is C-order
  }
  return out;
}
