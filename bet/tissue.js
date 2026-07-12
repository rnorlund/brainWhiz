// bet/tissue.js — clean-room tissue segmentation (CSF / GM / WM) inside a brain mask.
// k-means (k=3) on masked intensities, then optional per-class relabel by centroid order.
// Excluding CSF gives a GM∪WM "cortex" whose surface follows the pial boundary (folded → gyri/sulci),
// unlike the brain MASK which fills sulci. Dependency-free; original implementation.

// k-means on the masked voxels; returns {labels:Uint8Array (0=bg,1..k), centroids:number[] sorted asc}
export function kmeans(data, mask, k=3, iters=12){
  // init centroids by intensity percentiles of the masked voxels
  const vals=[]; for(let i=0;i<data.length;i++) if(mask[i]) vals.push(data[i]);
  vals.sort((a,b)=>a-b); const cent=[]; for(let c=0;c<k;c++) cent.push(vals[Math.floor((c+0.5)/k*(vals.length-1))]);
  const lab=new Uint8Array(data.length);
  for(let it=0;it<iters;it++){ const sum=new Float64Array(k), cnt=new Float64Array(k);
    for(let i=0;i<data.length;i++){ if(!mask[i]) continue; const v=data[i]; let bj=0,bd=Infinity;
      for(let c=0;c<k;c++){ const d=(v-cent[c])*(v-cent[c]); if(d<bd){bd=d;bj=c;} } lab[i]=bj+1; sum[bj]+=v; cnt[bj]++; }
    let moved=0; for(let c=0;c<k;c++) if(cnt[c]){ const nc=sum[c]/cnt[c]; moved+=Math.abs(nc-cent[c]); cent[c]=nc; }
    if(moved<1e-3) break;
  }
  return { labels:lab, centroids:cent };
}

// Segment a brain-masked volume into CSF/GM/WM (by ascending centroid = CSF<GM<WM for T1).
// Returns { csf, gm, wm, cortex } as Uint8 masks (cortex = gm∪wm). For T2 (CSF bright) pass invert:true.
export function segmentTissue(data, brainMask, opts={}){
  const { labels, centroids }=kmeans(data, brainMask, 3, opts.iters||12);
  // rank classes by centroid; class index (1..3) → tissue
  const order=[0,1,2].sort((a,b)=>centroids[a]-centroids[b]);           // ascending intensity
  const csfCls=order[0]+1, gmCls=order[1]+1, wmCls=order[2]+1;
  const csf=new Uint8Array(data.length), gm=new Uint8Array(data.length), wm=new Uint8Array(data.length), cortex=new Uint8Array(data.length);
  const darkIsCSF = !opts.invert;                                       // T1: dark=CSF; T2: bright=CSF (invert)
  const CSF = darkIsCSF? csfCls : wmCls, WM = darkIsCSF? wmCls : csfCls;
  for(let i=0;i<data.length;i++){ if(!brainMask[i]) continue; const L=labels[i];
    if(L===CSF) csf[i]=1; else if(L===gmCls) gm[i]=1; else wm[i]=1;
    cortex[i]= (L!==CSF)?1:0; }
  return { csf, gm, wm, cortex, centroids };
}
