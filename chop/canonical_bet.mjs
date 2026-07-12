// Canonical-space BET (bootstrap, no OASIS): extract → register brain→MNI → warp an MNI brain-
// envelope prior back to native → GATE the mask, dropping the neck/face (prior≈0 there). Clean-room.
//   node chop/canonical_bet.mjs <scan.nii[.gz]> [dilateMM]
import fs from 'fs'; import zlib from 'zlib'; import path from 'path';
import { extractBrain, applyMask, otsu, largestComponent, dilate3D, smoothMask3D, fillHoles3D } from '../bet/bet.js';
import { registerAffine, invert4x4, resampleLabels } from './chop.js';

function loadNifti(file){ let raw=fs.readFileSync(file); if(file.endsWith('.gz')) raw=zlib.gunzipSync(raw);
  const dv=new DataView(raw.buffer,raw.byteOffset,raw.byteLength), le=true;
  const dim=[]; for(let i=0;i<8;i++) dim.push(dv.getInt16(40+i*2,le)); const nx=dim[1],ny=dim[2],nz=dim[3]||1;
  const dtp=dv.getInt16(70,le); let sl=dv.getFloat32(112,le)||1, it=dv.getFloat32(116,le)||0; if(!sl)sl=1;
  const vox=dv.getFloat32(108,le)|0, sform=dv.getInt16(254,le);
  const sp=[Math.abs(dv.getFloat32(80,le))||1,Math.abs(dv.getFloat32(84,le))||1,Math.abs(dv.getFloat32(88,le))||1];
  let A; if(sform>0){ A=[[dv.getFloat32(280,le),dv.getFloat32(284,le),dv.getFloat32(288,le),dv.getFloat32(292,le)],
     [dv.getFloat32(296,le),dv.getFloat32(300,le),dv.getFloat32(304,le),dv.getFloat32(308,le)],
     [dv.getFloat32(312,le),dv.getFloat32(316,le),dv.getFloat32(320,le),dv.getFloat32(324,le)],[0,0,0,1]]; }
  else A=[[sp[0],0,0,-sp[0]*nx/2],[0,sp[1],0,-sp[1]*ny/2],[0,0,sp[2],-sp[2]*nz/2],[0,0,0,1]];
  const rd={2:['getUint8',1],256:['getInt8',1],4:['getInt16',2],512:['getUint16',2],8:['getInt32',4],16:['getFloat32',4],64:['getFloat64',8]}[dtp];
  const [fn,bp]=rd; const N=nx*ny*nz, data=new Float32Array(N); let o=vox; for(let i=0;i<N;i++){data[i]=dv[fn](o,le)*sl+it;o+=bp;}
  return { data, dims:[nx,ny,nz], spacing:sp, affine:A, header:raw.slice(0,348) };
}
function loadMNI(){ const src=fs.readFileSync('bundles/_mni152.js','utf8'); const w={}; new Function('window',src)(w);
  const M=w.MNI152, raw=zlib.gunzipSync(Buffer.from(M.data,'base64')); return { data:Float32Array.from(raw), dims:M.dim.slice(), affine:M.affine }; }
function writeNifti(file, floatData, srcHeader){ const h=Buffer.from(srcHeader); const dv=new DataView(h.buffer,h.byteOffset,h.byteLength),le=true;
  dv.setInt16(70,16,le); dv.setInt16(72,32,le); dv.setFloat32(108,352,le); dv.setFloat32(112,1,le); dv.setFloat32(116,0,le);
  const body=Buffer.alloc(4+floatData.length*4); const bd=new DataView(body.buffer); for(let i=0;i<floatData.length;i++) bd.setFloat32(4+i*4,floatData[i],le);
  fs.writeFileSync(file, zlib.gzipSync(Buffer.concat([h,body]))); }
const _crc=(()=>{const t=new Uint32Array(256);for(let n=0;n<256;n++){let c=n;for(let k=0;k<8;k++)c=c&1?0xedb88320^(c>>>1):c>>>1;t[n]=c>>>0;}return t;})();
const crc32=b=>{let c=0xffffffff;for(let i=0;i<b.length;i++)c=_crc[(c^b[i])&0xff]^(c>>>8);return(c^0xffffffff)>>>0;};
function writePNG(file,rgb,w,h){const raw=Buffer.alloc((w*3+1)*h);for(let y=0;y<h;y++){raw[y*(w*3+1)]=0;rgb.copy(raw,y*(w*3+1)+1,y*w*3,y*w*3+w*3);}
  const idat=zlib.deflateSync(raw,{level:6});const ch=(t,d)=>{const l=Buffer.alloc(4);l.writeUInt32BE(d.length);const b=Buffer.concat([Buffer.from(t),d]);const c=Buffer.alloc(4);c.writeUInt32BE(crc32(b));return Buffer.concat([l,b,c]);};
  const ih=Buffer.alloc(13);ih.writeUInt32BE(w,0);ih.writeUInt32BE(h,4);ih[8]=8;ih[9]=2;fs.writeFileSync(file,Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),ch('IHDR',ih),ch('IDAT',idat),ch('IEND',Buffer.alloc(0))]));}

const file=process.argv[2], dilMM=+(process.argv[3]||8);
const base=path.basename(file).replace(/\.nii(\.gz)?$/i,'');
const vol=loadNifti(file), mni=loadMNI(), [nx,ny,nz]=vol.dims;
const t0=Date.now();

// 1) initial extraction (brain + maybe neck)
const M0=extractBrain(vol,{method:'deepcore'});
// 2) register the extracted brain -> MNI
const brainVol={ data:applyMask(vol.data,M0.mask), dims:vol.dims, affine:vol.affine };
const reg=registerAffine(brainVol, mni, {});
console.log(`${base}: init ${(100*M0.voxels/(nx*ny*nz)).toFixed(1)}%  reg NMI=${reg.nmi.toFixed(3)}  (${(Date.now()-t0)}ms)`);
// 3) MNI brain-envelope prior — use the OASIS population probability prior if built, else template threshold
let mniMask, priorSrc='template';
try{ const src=fs.readFileSync('bet/mni_brain_prior.js','utf8'); const w={}; new Function('window',src)(w);
  const P=w.MNI_BRAIN_PRIOR, raw=zlib.gunzipSync(Buffer.from(P.data,'base64')); const PT=255*0.15;
  mniMask=new Int32Array(raw.length); for(let i=0;i<raw.length;i++) mniMask[i]= raw[i]>=PT?1:0; priorSrc='OASIS n='+P.n;
}catch(e){ const mthr=otsu(mni.data)*0.5; mniMask=new Int32Array(mni.data.length); for(let i=0;i<mni.data.length;i++) mniMask[i]= mni.data[i]>mthr?1:0; }
console.log('  prior: '+priorSrc);
// 4) warp prior -> native: for each native voxel -> MNI (invert MNI→subject), sample prior
const S2M=invert4x4(reg.matrix);   // reg.matrix = MNI→subject world; invert = subject→MNI world
let nativePrior=resampleLabels({data:mniMask,dims:mni.dims,affine:mni.affine}, {dims:vol.dims,affine:vol.affine}, S2M);
// to Uint8 + dilate for affine slack
let pr=new Uint8Array(nativePrior.length); for(let i=0;i<pr.length;i++) pr[i]=nativePrior[i]?1:0;
const dil=Math.max(1,Math.round(dilMM/Math.min(...vol.spacing)));
pr=dilate3D(pr, vol.dims, dil);
// 5) gate + clean
let m=new Uint8Array(M0.mask.length); for(let i=0;i<m.length;i++) m[i]= (M0.mask[i]&&pr[i])?1:0;
m=largestComponent(m, vol.dims); m=fillHoles3D(m, vol.dims); m=smoothMask3D(m, vol.dims, 2);
let vox=0; for(let i=0;i<m.length;i++) vox+=m[i];
console.log(`gated brain: ${vox} vox (${(100*vox/(nx*ny*nz)).toFixed(1)}%, was ${(100*M0.voxels/(nx*ny*nz)).toFixed(1)}%)  dilate=${dil}vox  total ${(Date.now()-t0)}ms`);
writeNifti(`bet/${base}_cbrain.nii.gz`, applyMask(vol.data,m), vol.header); console.log(`wrote bet/${base}_cbrain.nii.gz`);

// overlay montage on the T1 (red = final boundary)
const srt=Float32Array.from(vol.data).sort(), p=q=>srt[Math.min(srt.length-1,Math.round(q*(srt.length-1)))]; const lo=p(0.02),hi=p(0.98)||1;
const cols=4,rows=3,n=cols*rows, W=cols*nx,H=rows*ny, img=Buffer.alloc(W*H*3);
for(let t=0;t<n;t++){ const z=Math.round((t+0.5)/n*nz), gx=(t%cols)*nx, gy=((t/cols)|0)*ny;
  for(let y=0;y<ny;y++)for(let x=0;x<nx;x++){ const s=x+nx*(y+ny*z); let g=Math.max(0,Math.min(255,Math.round(255*(vol.data[s]-lo)/(hi-lo)))); let r=g,gg=g,b=g;
    if(m[s]){ const e=(x>0&&!m[s-1])||(x<nx-1&&!m[s+1])||(y>0&&!m[s-nx])||(y<ny-1&&!m[s+nx]); if(e){r=255;gg=40;b=40;} }
    const px=((gy+(ny-1-y))*W+(gx+x))*3; img[px]=r;img[px+1]=gg;img[px+2]=b; } }
writePNG(`bet/${base}_cbet.png`, img, W, H); console.log(`wrote bet/${base}_cbet.png  (${W}×${H})`);
