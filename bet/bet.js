// bet/bet.js — clean-room brain extraction (skull stripping) for brainWhiz.
// Dependency-free, DOM-free pure functions on a volume {data, dims:[nx,ny,nz]}
// (voxel index = x + nx*(y + ny*z)). Safe to run in a Web Worker or Node.
//
// Every routine here is an original implementation of standard, patent-free image processing
// (Otsu 1979 threshold; 3-D connected components; binary morphology; scanline hole fill).
// No third-party neuroimaging code/models are used — nothing to cite, credit, or license.

// ---- Otsu threshold: maximize between-class variance over a 256-bin histogram ----
export function otsu(data){
  let lo=Infinity, hi=-Infinity;
  for(let i=0;i<data.length;i++){ const v=data[i]; if(v<lo)lo=v; if(v>hi)hi=v; }
  if(hi<=lo) return lo;
  const B=256, hist=new Float64Array(B), sc=(B-1)/(hi-lo);
  for(let i=0;i<data.length;i++){ hist[(data[i]-lo)*sc|0]++; }
  let total=data.length, sum=0; for(let b=0;b<B;b++) sum+=b*hist[b];
  let sumB=0, wB=0, best=0, thrBin=0;
  for(let b=0;b<B;b++){ wB+=hist[b]; if(!wB) continue; const wF=total-wB; if(!wF) break;
    sumB+=b*hist[b]; const mB=sumB/wB, mF=(sum-sumB)/wF, between=wB*wF*(mB-mF)*(mB-mF);
    if(between>best){ best=between; thrBin=b; } }
  return lo + thrBin/sc;
}

// ---- binary mask from a threshold ----
export function threshMask(data, thr){ const m=new Uint8Array(data.length);
  for(let i=0;i<data.length;i++) m[i]= data[i]>thr ? 1:0; return m; }

// ---- 3-D 6-connected components; returns {labels:Int32Array, sizes:number[]} (label 0 = background) ----
export function connectedComponents3D(mask, dims){
  const [nx,ny,nz]=dims, N=nx*ny*nz, labels=new Int32Array(N), sizes=[0];
  const stack=new Int32Array(N); let cur=0;
  for(let s=0;s<N;s++){ if(!mask[s] || labels[s]) continue;
    cur++; let sp=0; stack[sp++]=s; labels[s]=cur; let cnt=0;
    while(sp){ const p=stack[--sp]; cnt++;
      const z=(p/(nx*ny))|0, r=p-z*nx*ny, y=(r/nx)|0, x=r-y*nx;
      if(x>0){const q=p-1;      if(mask[q]&&!labels[q]){labels[q]=cur;stack[sp++]=q;}}
      if(x<nx-1){const q=p+1;   if(mask[q]&&!labels[q]){labels[q]=cur;stack[sp++]=q;}}
      if(y>0){const q=p-nx;     if(mask[q]&&!labels[q]){labels[q]=cur;stack[sp++]=q;}}
      if(y<ny-1){const q=p+nx;  if(mask[q]&&!labels[q]){labels[q]=cur;stack[sp++]=q;}}
      if(z>0){const q=p-nx*ny;  if(mask[q]&&!labels[q]){labels[q]=cur;stack[sp++]=q;}}
      if(z<nz-1){const q=p+nx*ny;if(mask[q]&&!labels[q]){labels[q]=cur;stack[sp++]=q;}}
    }
    sizes[cur]=cnt;
  }
  return {labels, sizes};
}

// ---- keep only the largest foreground component ----
export function largestComponent(mask, dims){
  const {labels,sizes}=connectedComponents3D(mask, dims);
  let best=0,bi=0; for(let i=1;i<sizes.length;i++) if(sizes[i]>best){best=sizes[i];bi=i;}
  const out=new Uint8Array(mask.length); if(!bi) return out;
  for(let i=0;i<out.length;i++) out[i]= labels[i]===bi ?1:0; return out;
}

// ---- binary morphology (6-connectivity), `iters` passes ----
function morph(mask, dims, iters, dilate){
  const [nx,ny,nz]=dims; let a=mask;
  for(let it=0;it<iters;it++){ const b=new Uint8Array(a.length);
    for(let z=0;z<nz;z++) for(let y=0;y<ny;y++) for(let x=0;x<nx;x++){
      const p=x+nx*(y+ny*z), v=a[p];
      // dilate: set if any 6-neighbor set; erode: clear if any 6-neighbor clear
      let hit=dilate?v:1-v;
      if(!hit){
        if(x>0)      hit=dilate?(hit||a[p-1]):(hit|| (1-a[p-1]));
        if(!hit&&x<nx-1) hit=dilate?a[p+1]:(1-a[p+1]);
        if(!hit&&y>0)    hit=dilate?a[p-nx]:(1-a[p-nx]);
        if(!hit&&y<ny-1) hit=dilate?a[p+nx]:(1-a[p+nx]);
        if(!hit&&z>0)    hit=dilate?a[p-nx*ny]:(1-a[p-nx*ny]);
        if(!hit&&z<nz-1) hit=dilate?a[p+nx*ny]:(1-a[p+nx*ny]);
      }
      b[p]= dilate ? (v||hit?1:0) : (v&&!hit?1:0);
    }
    a=b;
  }
  return a;
}
export const erode3D  = (mask,dims,iters=1)=>morph(mask,dims,iters,false);
export const dilate3D = (mask,dims,iters=1)=>morph(mask,dims,iters,true);

// ---- fill interior holes: flood the OUTSIDE background from the volume border;
//      any background voxel not reached is an enclosed hole -> set it foreground. ----
export function fillHoles3D(mask, dims){
  const [nx,ny,nz]=dims, N=nx*ny*nz, outside=new Uint8Array(N), stack=new Int32Array(N); let sp=0;
  const push=p=>{ if(!mask[p] && !outside[p]){ outside[p]=1; stack[sp++]=p; } };
  for(let z=0;z<nz;z++)for(let y=0;y<ny;y++)for(let x=0;x<nx;x++){
    if(x===0||x===nx-1||y===0||y===ny-1||z===0||z===nz-1) push(x+nx*(y+ny*z)); }
  while(sp){ const p=stack[--sp]; const z=(p/(nx*ny))|0, r=p-z*nx*ny, y=(r/nx)|0, x=r-y*nx;
    if(x>0)push(p-1); if(x<nx-1)push(p+1); if(y>0)push(p-nx); if(y<ny-1)push(p+nx);
    if(z>0)push(p-nx*ny); if(z<nz-1)push(p+nx*ny); }
  const out=new Uint8Array(N); for(let i=0;i<N;i++) out[i]= (mask[i]||!outside[i])?1:0; return out;
}

// ---- 3-D chamfer distance transform (mm) from the background of a binary mask ----
// Two-pass 3-4-5 chamfer scaled by voxel spacing — fast (~2 linear sweeps), ~2% of exact Euclidean.
export function distanceTransform3D(mask, dims, spacing=[1,1,1]){
  const [nx,ny,nz]=dims, N=nx*ny*nz, INF=1e9, d=new Float32Array(N);
  const [sx,sy,sz]=spacing;
  const w1x=sx,w1y=sy,w1z=sz;                                   // face neighbors
  const wxy=Math.hypot(sx,sy), wxz=Math.hypot(sx,sz), wyz=Math.hypot(sy,sz);   // edge
  const wxyz=Math.hypot(sx,sy,sz);                              // corner
  for(let i=0;i<N;i++) d[i]= mask[i]?INF:0;
  const at=(x,y,z)=>x+nx*(y+ny*z);
  const rel=(x,y,z,base,w)=>{ if(x<0||y<0||z<0||x>=nx||y>=ny||z>=nz) return; const v=d[at(x,y,z)]+w; if(v<base.v) base.v=v; };
  // forward pass
  for(let z=0;z<nz;z++)for(let y=0;y<ny;y++)for(let x=0;x<nx;x++){ const p=at(x,y,z); if(d[p]===0) continue;
    const b={v:d[p]};
    rel(x-1,y,z,b,w1x); rel(x,y-1,z,b,w1y); rel(x,y,z-1,b,w1z);
    rel(x-1,y-1,z,b,wxy); rel(x+1,y-1,z,b,wxy); rel(x-1,y,z-1,b,wxz); rel(x+1,y,z-1,b,wxz); rel(x,y-1,z-1,b,wyz); rel(x,y+1,z-1,b,wyz);
    rel(x-1,y-1,z-1,b,wxyz); rel(x+1,y-1,z-1,b,wxyz); rel(x-1,y+1,z-1,b,wxyz); rel(x+1,y+1,z-1,b,wxyz);
    d[p]=b.v; }
  // backward pass
  for(let z=nz-1;z>=0;z--)for(let y=ny-1;y>=0;y--)for(let x=nx-1;x>=0;x--){ const p=at(x,y,z); if(d[p]===0) continue;
    const b={v:d[p]};
    rel(x+1,y,z,b,w1x); rel(x,y+1,z,b,w1y); rel(x,y,z+1,b,w1z);
    rel(x+1,y+1,z,b,wxy); rel(x-1,y+1,z,b,wxy); rel(x+1,y,z+1,b,wxz); rel(x-1,y,z+1,b,wxz); rel(x,y+1,z+1,b,wyz); rel(x,y-1,z+1,b,wyz);
    rel(x+1,y+1,z+1,b,wxyz); rel(x-1,y+1,z+1,b,wxyz); rel(x+1,y-1,z+1,b,wxyz); rel(x-1,y-1,z+1,b,wxyz);
    d[p]=b.v; }
  return d;
}

// ---- bounded geodesic dilation: grow `seed` outward, staying inside `bound`, for `iters` passes.
// (Regrows the eroded brain shell but can't travel far enough to reach scalp across the skull gap.) ----
export function geodesicDilate(seed, bound, dims, iters){
  let a=seed;
  for(let it=0;it<iters;it++){ const b=dilate3D(a,dims,1);
    for(let i=0;i<b.length;i++) b[i]= (b[i]&&bound[i])?1:0;
    a=b; }
  return a;
}

// ---- curvature-limited smoothing: majority vote in a 3×3×3 window, `iters` passes.
// Encodes the "brain surface is smooth" shape prior — clips spikes, fills nicks, no net erosion. ----
export function smoothMask3D(mask, dims, iters=1){
  const [nx,ny,nz]=dims; let a=mask;
  for(let it=0;it<iters;it++){ const b=new Uint8Array(a.length);
    for(let z=0;z<nz;z++)for(let y=0;y<ny;y++)for(let x=0;x<nx;x++){ let s=0,c=0;
      for(let dz=-1;dz<=1;dz++)for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){
        const X=x+dx,Y=y+dy,Z=z+dz; if(X<0||Y<0||Z<0||X>=nx||Y>=ny||Z>=nz) continue; c++; s+=a[X+nx*(Y+ny*Z)]; }
      b[x+nx*(y+ny*z)]= (s*2>c)?1:0; }
    a=b; }
  return a;
}

// ---- radial-smoothness hull (shape/curvature prior) ----
// Build R(θ,φ) = how far the mask extends from its centroid in each direction; smooth R over the
// sphere and cap outliers, then rebuild the mask as everything within the smoothed radius. A smooth
// brain hull can't snake a thin spike down the neck/face — those become angular outliers and get
// pulled in. Clean-room; encodes "the brain boundary is a smooth closed surface."
export function refineRadialHull(mask, dims, spacing=[1,1,1], opts={}){
  const [nx,ny,nz]=dims, [sx,sy,sz]=spacing;
  const NT=opts.nTheta??48, NP=opts.nPhi??96, capMul=opts.capMul??1.35, sigma=opts.sigma??2.2;
  // centroid (mm)
  let cx=0,cy=0,cz=0,cnt=0;
  for(let z=0;z<nz;z++)for(let y=0;y<ny;y++)for(let x=0;x<nx;x++){ if(mask[x+nx*(y+ny*z)]){ cx+=x;cy+=y;cz+=z;cnt++; } }
  if(!cnt) return mask; cx=cx/cnt*sx; cy=cy/cnt*sy; cz=cz/cnt*sz;
  const R=new Float32Array(NT*NP), maxR=opts.maxR??130, step=0.6, gap=opts.gap??6;
  const inMask=(mx,my,mz)=>{ const x=Math.round(mx/sx),y=Math.round(my/sy),z=Math.round(mz/sz);
    return (x<0||y<0||z<0||x>=nx||y>=ny||z>=nz)?0:mask[x+nx*(y+ny*z)]; };
  for(let it=0;it<NT;it++){ const th=Math.PI*(it+0.5)/NT, st=Math.sin(th), ct=Math.cos(th);
    for(let ip=0;ip<NP;ip++){ const ph=2*Math.PI*ip/NP;
      const dx=st*Math.cos(ph), dy=st*Math.sin(ph), dz=ct; let last=0, run=0;
      for(let t=step;t<=maxR;t+=step){ if(inMask(cx+dx*t,cy+dy*t,cz+dz*t)){ last=t; run=0; } else if(last){ run+=step; if(run>gap) break; } }
      R[it*NP+ip]=last; } }
  // median for the cap
  const srt=Float32Array.from(R).sort(); const med=srt[srt.length>>1]||1;
  for(let i=0;i<R.length;i++) R[i]=Math.min(R[i], capMul*med);
  // smooth over the sphere (φ wraps, θ clamps) — separable Gaussian
  const ker=[]; const ks=Math.ceil(sigma*3); for(let k=-ks;k<=ks;k++) ker.push(Math.exp(-(k*k)/(2*sigma*sigma)));
  const ksum=ker.reduce((a,b)=>a+b,0);
  const tmp=new Float32Array(R.length);
  for(let it=0;it<NT;it++)for(let ip=0;ip<NP;ip++){ let s=0; for(let k=-ks;k<=ks;k++){ const jp=((ip+k)%NP+NP)%NP; s+=R[it*NP+jp]*ker[k+ks]; } tmp[it*NP+ip]=s/ksum; }
  for(let it=0;it<NT;it++)for(let ip=0;ip<NP;ip++){ let s=0; for(let k=-ks;k<=ks;k++){ const jt=Math.min(NT-1,Math.max(0,it+k)); s+=tmp[jt*NP+ip]*ker[k+ks]; } R[it*NP+ip]=s/ksum; }
  // rebuild: voxel inside if its distance from centroid ≤ smoothed R(dir) (bilinear on the θ,φ grid)
  const out=new Uint8Array(mask.length);
  for(let z=0;z<nz;z++)for(let y=0;y<ny;y++)for(let x=0;x<nx;x++){
    const vx=x*sx-cx, vy=y*sy-cy, vz=z*sz-cz, d=Math.hypot(vx,vy,vz); if(d<1e-3){ out[x+nx*(y+ny*z)]=1; continue; }
    const th=Math.acos(Math.max(-1,Math.min(1,vz/d))), ph=(Math.atan2(vy,vx)+2*Math.PI)%(2*Math.PI);
    const ft=th/Math.PI*NT-0.5, fp=ph/(2*Math.PI)*NP;
    const it0=Math.max(0,Math.min(NT-1,Math.floor(ft))), it1=Math.min(NT-1,it0+1), at=ft-it0;
    const ip0=((Math.floor(fp)%NP)+NP)%NP, ip1=(ip0+1)%NP, ap=fp-Math.floor(fp);
    const r=(R[it0*NP+ip0]*(1-ap)+R[it0*NP+ip1]*ap)*(1-at)+(R[it1*NP+ip0]*(1-ap)+R[it1*NP+ip1]*ap)*at;
    if(d<=r) out[x+nx*(y+ny*z)]=1;
  }
  return out;
}

// ---- full pipeline. method:
//   'deepcore' (default, our invention): Otsu tissue → head → distance transform → keep the deepest
//     central mass (brain core) → bounded geodesic regrowth (can't leak to scalp) → smooth + fill.
//   'morph': simple erode→largestCC→dilate (fast/crude, keeps whole head on thick scalp).
// opts: { threshMul=0.45, coreR=9 (mm; scalp+skull thickness to peel), pad=2, smooth=2, spacing=[1,1,1] }
export function extractBrain(vol, opts={}){
  const {data,dims}=vol, spacing=vol.spacing||opts.spacing||[1,1,1];
  const method=opts.method||'deepcore';
  const thr=otsu(data)*(opts.threshMul??0.45);
  let head=largestComponent(threshMask(data, thr), dims);
  head=fillHoles3D(head, dims);
  let m;
  if(method==='morph'){ const e=opts.erode??2; m=erode3D(head,dims,e); m=largestComponent(m,dims); m=dilate3D(m,dims,e); }
  else { // deepcore
    const dt=distanceTransform3D(head, dims, spacing);
    const R=opts.coreR??9;                                       // mm to peel (scalp+skull)
    const core=new Uint8Array(dt.length); for(let i=0;i<dt.length;i++) core[i]= dt[i]>R ?1:0;
    let seed=largestComponent(core, dims);                        // the deepest single mass = brain core
    const minSp=Math.min(spacing[0],spacing[1],spacing[2])||1;
    const iters=Math.ceil(R/minSp)+(opts.pad??2);
    m=geodesicDilate(seed, head, dims, iters);                    // regrow to the brain boundary, bounded
    m=largestComponent(m, dims);
    const open=opts.open??7;                                      // neck cut: opening severs the narrow foramen-magnum bridge to the neck
    if(open>0){ let e=erode3D(m,dims,open); e=largestComponent(e,dims); m=geodesicDilate(e, m, dims, open); }
  }
  if(opts.hull!==false && method!=='morph'){                      // shape/curvature prior: trim out-of-hull neck/face spikes
    const hull=refineRadialHull(m, dims, spacing, opts);
    for(let i=0;i<m.length;i++) m[i]= (m[i]&&hull[i])?1:0;
    m=largestComponent(m, dims);
  }
  if((opts.smooth??2)>0) m=smoothMask3D(m, dims, opts.smooth??2); // curvature prior
  if(opts.fill!==false) m=fillHoles3D(m, dims);
  let vox=0; for(let i=0;i<m.length;i++) vox+=m[i];
  return { mask:m, threshold:thr, voxels:vox };
}

// ---- apply a mask to a volume (returns a new array; background -> 0) ----
export function applyMask(data, mask){ const out=new data.constructor(data.length);
  for(let i=0;i<data.length;i++) out[i]= mask[i]?data[i]:0; return out; }
