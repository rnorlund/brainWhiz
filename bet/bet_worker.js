// bet/bet_worker.js — off-main-thread brain extraction + tissue segmentation for the brainWhiz UI.
// Module worker: imports our clean-room modules and runs deepcore BET, an optional OASIS-prior
// refine (neck/face gate), and CSF/GM/WM tissue segmentation. Posts progress + transferable results.
// Requires the app to be SERVED (http/https); module workers can't load on file://.
import { extractBrain, applyMask, largestComponent, fillHoles3D, smoothMask3D, dilate3D } from './bet.js';
import { segmentTissue } from './tissue.js';
import { registerAffine, invert4x4, resampleLabels } from '../chop/chop.js';

const P=(pct,msg)=>self.postMessage({type:'progress',pct,msg});

self.onmessage=(e)=>{
  const m=e.data; if(m.cmd!=='extract') return;
  try{
    const { vol, mni, prior, opts={} } = m;         // vol/mni:{data,dims,spacing,affine}; prior:{data(Uint8),dims,affine,n,pt}
    const [nx,ny,nz]=vol.dims, N=nx*ny*nz;
    P(6,'Thresholding & deep-core…');
    const M0=extractBrain(vol,{method:'deepcore'});
    let mask=M0.mask, note=`deep-core ${(100*M0.voxels/N).toFixed(1)}%`;

    if(opts.refined && mni && prior){
      P(42,'Registering brain → MNI…');
      const brainVol={ data:applyMask(vol.data,mask), dims:vol.dims, affine:vol.affine };
      const reg=registerAffine(brainVol, mni, {});
      P(70,`Warping OASIS prior back (NMI ${reg.nmi.toFixed(3)})…`);
      const S2M=invert4x4(reg.matrix);                       // subject→MNI world
      const PT=255*(prior.pt??0.20);
      const mniMask=new Int32Array(prior.data.length); for(let i=0;i<mniMask.length;i++) mniMask[i]= prior.data[i]>=PT?1:0;
      let np=resampleLabels({data:mniMask,dims:prior.dims,affine:prior.affine}, {dims:vol.dims,affine:vol.affine}, S2M);
      let pr=new Uint8Array(N); for(let i=0;i<N;i++) pr[i]=np[i]?1:0;
      const dil=Math.max(1,Math.round((opts.dilMM??6)/Math.min(vol.spacing[0],vol.spacing[1],vol.spacing[2])));
      pr=dilate3D(pr, vol.dims, dil);
      const g=new Uint8Array(N); for(let i=0;i<N;i++) g[i]=(mask[i]&&pr[i])?1:0;
      mask=g; note+=` → OASIS-gated (n=${prior.n}, P≥${prior.pt??0.20})`;
    }
    P(84,'Cleaning mask…');
    mask=largestComponent(mask,vol.dims); mask=fillHoles3D(mask,vol.dims); mask=smoothMask3D(mask,vol.dims,opts.refined?2:1);

    P(90,'Segmenting tissue (CSF/GM/WM)…');
    const seg=segmentTissue(vol.data, mask, {invert:!!opts.t2});
    const cortex=new Float32Array(N), wm=new Float32Array(N), gm=new Float32Array(N);
    for(let i=0;i<N;i++){ if(seg.cortex[i]) cortex[i]=vol.data[i]; if(seg.wm[i]) wm[i]=vol.data[i]; if(seg.gm[i]) gm[i]=vol.data[i]; }
    let vox=0; for(let i=0;i<N;i++) vox+=mask[i];
    // pack mask as Uint8 for transfer
    const mask8=(mask instanceof Uint8Array)?mask:Uint8Array.from(mask);
    P(100,'Done');
    self.postMessage({ type:'done', mask:mask8, cortex, wm, gm, voxels:vox, total:N,
      centroids:seg.centroids, note }, [mask8.buffer, cortex.buffer, wm.buffer, gm.buffer]);
  }catch(err){ self.postMessage({type:'error', msg:(err&&err.message)||String(err)}); }
};
