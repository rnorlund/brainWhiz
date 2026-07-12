// Tissue-segment an extracted brain and write a GM∪WM "cortex" (CSF removed) whose surface follows
// the pial boundary → folded (gyri/sulci), unlike the sulci-filled brain mask. Node-only.
//   node bet/make_cortex.mjs <brain.nii[.gz]> [--invert]   (--invert for T2: CSF is bright)
import fs from 'fs'; import zlib from 'zlib'; import path from 'path';
import { segmentTissue } from './tissue.js';
import { smoothMask3D } from './bet.js';

function load(file){ let raw=fs.readFileSync(file); if(file.endsWith('.gz')) raw=zlib.gunzipSync(raw);
  const dv=new DataView(raw.buffer,raw.byteOffset,raw.byteLength),le=true; const d=[];for(let i=0;i<8;i++)d.push(dv.getInt16(40+i*2,le));
  const nx=d[1],ny=d[2],nz=d[3]; const dt=dv.getInt16(70,le); let sl=dv.getFloat32(112,le)||1,it=dv.getFloat32(116,le)||0; if(!sl)sl=1; const vo=dv.getFloat32(108,le)|0;
  const rd={2:['getUint8',1],4:['getInt16',2],16:['getFloat32',4],512:['getUint16',2],8:['getInt32',4],64:['getFloat64',8]}[dt];const[fn,bp]=rd;
  const N=nx*ny*nz,data=new Float32Array(N);let o=vo;for(let i=0;i<N;i++){data[i]=dv[fn](o,le)*sl+it;o+=bp;} return {data,dims:[nx,ny,nz],header:raw.slice(0,348)}; }
function writeNifti(file,fd,h0){const h=Buffer.from(h0);const dv=new DataView(h.buffer,h.byteOffset,h.byteLength),le=true;dv.setInt16(70,16,le);dv.setInt16(72,32,le);dv.setFloat32(108,352,le);dv.setFloat32(112,1,le);dv.setFloat32(116,0,le);const body=Buffer.alloc(4+fd.length*4),bd=new DataView(body.buffer);for(let i=0;i<fd.length;i++)bd.setFloat32(4+i*4,fd[i],le);fs.writeFileSync(file,zlib.gzipSync(Buffer.concat([h,body])));}

const file=process.argv[2], invert=process.argv.includes('--invert');
const base=path.basename(file).replace(/\.nii(\.gz)?$/i,'');
const vol=load(file);
const brain=new Uint8Array(vol.data.length); for(let i=0;i<vol.data.length;i++) brain[i]= vol.data[i]>0?1:0;   // extracted brain = nonzero
const t0=Date.now(); const seg=segmentTissue(vol.data, brain, {invert});
let cvox=0,wvox=0,gvox=0; for(let i=0;i<seg.cortex.length;i++){ cvox+=seg.cortex[i]; wvox+=seg.wm[i]; gvox+=seg.gm[i]; }
console.log(`${base}: centroids=[${seg.centroids.map(c=>c.toFixed(0))}]  GM=${gvox} WM=${wvox} cortex(GM+WM)=${cvox}  ${(Date.now()-t0)}ms`);
// cortex = masked intensity where GM∪WM (CSF→0 so the isosurface carves sulci)
const cortex=new Float32Array(vol.data.length); for(let i=0;i<cortex.length;i++) cortex[i]= seg.cortex[i]? vol.data[i]:0;
writeNifti(`bet/${base}_cortex.nii.gz`, cortex, vol.header); console.log(`wrote bet/${base}_cortex.nii.gz`);
// also a WM surface (smooth folded core)
const wm=new Float32Array(vol.data.length); for(let i=0;i<wm.length;i++) wm[i]= seg.wm[i]? vol.data[i]:0;
writeNifti(`bet/${base}_wm.nii.gz`, wm, vol.header); console.log(`wrote bet/${base}_wm.nii.gz`);
