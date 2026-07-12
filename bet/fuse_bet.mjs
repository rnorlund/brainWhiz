// Multi-atlas label fusion BET (clean-room): build a library of OASIS subjects (T1+rough mask) in
// MNI space, register the TARGET to MNI, then for each voxel take a LOCALLY-WEIGHTED vote of the
// atlas masks (weight = patch-intensity similarity to the target). Warp the fused mask to native,
// gate by tissue, clean. Locally-weighted fusion adapts to the individual → tighter than a flat prior.
//   node bet/fuse_bet.mjs <target.nii[.gz]> <oasisDir> [N=12] [thresh=0.5]
import fs from 'fs'; import zlib from 'zlib'; import path from 'path';
import { extractBrain, otsu, largestComponent, fillHoles3D, smoothMask3D } from './bet.js';
import { registerAffine, invert4x4, applyAffine } from '../chop/chop.js';

function loadNifti(file){ let raw=fs.readFileSync(file); if(file.endsWith('.gz')) raw=zlib.gunzipSync(raw);
  const dv=new DataView(raw.buffer,raw.byteOffset,raw.byteLength),le=true; const dim=[];for(let i=0;i<8;i++)dim.push(dv.getInt16(40+i*2,le));
  const nx=dim[1],ny=dim[2],nz=dim[3]||1,dtp=dv.getInt16(70,le);let sl=dv.getFloat32(112,le)||1,it=dv.getFloat32(116,le)||0;if(!sl)sl=1;
  const vox=dv.getFloat32(108,le)|0,sform=dv.getInt16(254,le),sp=[Math.abs(dv.getFloat32(80,le))||1,Math.abs(dv.getFloat32(84,le))||1,Math.abs(dv.getFloat32(88,le))||1];
  let A;if(sform>0){A=[[dv.getFloat32(280,le),dv.getFloat32(284,le),dv.getFloat32(288,le),dv.getFloat32(292,le)],[dv.getFloat32(296,le),dv.getFloat32(300,le),dv.getFloat32(304,le),dv.getFloat32(308,le)],[dv.getFloat32(312,le),dv.getFloat32(316,le),dv.getFloat32(320,le),dv.getFloat32(324,le)],[0,0,0,1]];}
  else A=[[sp[0],0,0,-sp[0]*nx/2],[0,sp[1],0,-sp[1]*ny/2],[0,0,sp[2],-sp[2]*nz/2],[0,0,0,1]];
  const rd={2:['getUint8',1],256:['getInt8',1],4:['getInt16',2],512:['getUint16',2],8:['getInt32',4],16:['getFloat32',4],64:['getFloat64',8]}[dtp];const[fn,bp]=rd;
  const N=nx*ny*nz,data=new Float32Array(N);let o=vox;for(let i=0;i<N;i++){data[i]=dv[fn](o,le)*sl+it;o+=bp;}return{data,dims:[nx,ny,nz],spacing:sp,affine:A,header:raw.slice(0,348)};}
function downsample(v,f){const[nx,ny,nz]=v.dims,mx=(nx/f)|0,my=(ny/f)|0,mz=(nz/f)|0,out=new Float32Array(mx*my*mz);for(let k=0;k<mz;k++)for(let j=0;j<my;j++)for(let i=0;i<mx;i++){let s=0;for(let dz=0;dz<f;dz++)for(let dy=0;dy<f;dy++)for(let dx=0;dx<f;dx++)s+=v.data[(i*f+dx)+nx*((j*f+dy)+ny*(k*f+dz))];out[i+mx*(j+my*k)]=s/(f*f*f);}const A=v.affine,o=(f-1)/2;return{data:out,dims:[mx,my,mz],spacing:v.spacing.map(s=>s*f),affine:[[A[0][0]*f,A[0][1]*f,A[0][2]*f,A[0][3]+(A[0][0]+A[0][1]+A[0][2])*o],[A[1][0]*f,A[1][1]*f,A[1][2]*f,A[1][3]+(A[1][0]+A[1][1]+A[1][2])*o],[A[2][0]*f,A[2][1]*f,A[2][2]*f,A[2][3]+(A[2][0]+A[2][1]+A[2][2])*o],[0,0,0,1]]};}
function loadMNI(){const src=fs.readFileSync('bundles/_mni152.js','utf8');const w={};new Function('window',src)(w);const M=w.MNI152,raw=zlib.gunzipSync(Buffer.from(M.data,'base64'));return{data:Float32Array.from(raw),dims:M.dim.slice(),affine:M.affine};}
const A16=a=>[a[0][0],a[0][1],a[0][2],a[0][3],a[1][0],a[1][1],a[1][2],a[1][3],a[2][0],a[2][1],a[2][2],a[2][3],0,0,0,1];
function writeNifti(file,fd,h0){const h=Buffer.from(h0);const dv=new DataView(h.buffer,h.byteOffset,h.byteLength),le=true;dv.setInt16(70,16,le);dv.setInt16(72,32,le);dv.setFloat32(108,352,le);dv.setFloat32(112,1,le);dv.setFloat32(116,0,le);const body=Buffer.alloc(4+fd.length*4),bd=new DataView(body.buffer);for(let i=0;i<fd.length;i++)bd.setFloat32(4+i*4,fd[i],le);fs.writeFileSync(file,zlib.gzipSync(Buffer.concat([h,body])));}
// warp a source volume (data,dims,affine) onto the MNI grid using reg.matrix (MNI→source world)
function warpToMNI(src, srcMatrixMNItoSrc, mni){ const [fx,fy,fz]=mni.dims,Fw=A16(mni.affine),Sinv=invert4x4(A16(src.affine)),[mx,my,mz]=src.dims,out=new Float32Array(fx*fy*fz);
  for(let k=0;k<fz;k++)for(let j=0;j<fy;j++)for(let i=0;i<fx;i++){const w=applyAffine(Fw,i,j,k),wm=applyAffine(srcMatrixMNItoSrc,w[0],w[1],w[2]),v=applyAffine(Sinv,wm[0],wm[1],wm[2]);const x=Math.round(v[0]),y=Math.round(v[1]),z=Math.round(v[2]);if(x<0||y<0||z<0||x>=mx||y>=my||z>=mz)continue;out[i+fx*(j+fy*k)]=src.data[x+mx*(y+my*z)];}return out;}
const norm=a=>{let lo=Infinity,hi=-Infinity;for(let i=0;i<a.length;i++){if(a[i]<lo)lo=a[i];if(a[i]>hi)hi=a[i];}const s=hi>lo?1/(hi-lo):1;const o=new Float32Array(a.length);for(let i=0;i<a.length;i++)o[i]=(a[i]-lo)*s;return o;}

const target=process.argv[2], dir=process.argv[3], N=+(process.argv[4]||12), TH=+(process.argv[5]||0.5);
const base=path.basename(target).replace(/\.nii(\.gz)?$/i,''), tbn=path.basename(target);
const mni=loadMNI(),[fx,fy,fz]=mni.dims,nxy=fx*fy; const t0=Date.now();
// ---- build library in MNI ----
const files=fs.readdirSync(dir).filter(f=>/\.nii(\.gz)?$/.test(f)&&f!==tbn).slice(0,N);
const libT1=[],libMask=[];
for(const f of files){ try{ const v=downsample(loadNifti(path.join(dir,f)),2); const M=extractBrain(v,{method:'deepcore',hull:false,smooth:1});
  const reg=registerAffine({data:v.data,dims:v.dims,affine:v.affine},mni,{}); libT1.push(norm(warpToMNI(v,reg.matrix,mni))); libMask.push(warpToMNI({data:Float32Array.from(M.mask),dims:v.dims,affine:v.affine},reg.matrix,mni));
  if(libT1.length%4===0) console.log(`  lib ${libT1.length}/${files.length} (${((Date.now()-t0)/1000).toFixed(0)}s)`);
}catch(e){ console.log('  skip '+f); } }
// ---- target → MNI ----
const tv=downsample(loadNifti(target),2), treg=registerAffine({data:tv.data,dims:tv.dims,affine:tv.affine},mni,{}); const tT1=norm(warpToMNI(tv,treg.matrix,mni));
console.log(`library ${libT1.length}, target reg NMI ${treg.nmi.toFixed(3)}  (${((Date.now()-t0)/1000).toFixed(0)}s)`);
// ---- locally-weighted label fusion in MNI (3x3x3 patch SSD, h = mean SSD) ----
const R=1, fused=new Float32Array(nxy*fz), h2Arr=new Float64Array(libT1.length);
const patchSSD=(a,b,i,j,k)=>{ let s=0,n=0; for(let dz=-R;dz<=R;dz++)for(let dy=-R;dy<=R;dy++)for(let dx=-R;dx<=R;dx++){ const x=i+dx,y=j+dy,z=k+dz; if(x<0||y<0||z<0||x>=fx||y>=fy||z>=fz)continue; const d=a[x+fx*(y+fy*z)]-b[x+fx*(y+fy*z)]; s+=d*d; n++; } return n? s/n : 1; };
for(let k=0;k<fz;k++)for(let j=0;j<fy;j++)for(let i=0;i<fx;i++){ const idx=i+fx*(j+fy*k);
  // skip clearly-empty (no atlas brain and dark target)
  let any=0; for(let a=0;a<libMask.length;a++) any+=libMask[a][idx]; if(any===0 && tT1[idx]<0.05){ continue; }
  let wsum=0, msum=0; const h2=0.02;   // similarity bandwidth on normalized intensities
  for(let a=0;a<libT1.length;a++){ const ssd=patchSSD(tT1,libT1[a],i,j,k); const w=Math.exp(-ssd/h2); wsum+=w; msum+=w*libMask[a][idx]; }
  fused[idx]= wsum? msum/wsum : 0;
}
// fused mask in MNI → threshold
const fusedMask=new Uint8Array(fused.length); for(let i=0;i<fused.length;i++) fusedMask[i]= fused[i]>=TH?1:0;
// ---- warp fused mask → target NATIVE (full res) + gate by tissue + clean ----
const full=loadNifti(target),[nx,ny,nz]=full.dims,Fw=A16(full.affine),S2M=invert4x4(treg.matrix),Pinv=invert4x4(A16(mni.affine));
const thr=otsu(full.data)*0.45; let m=new Uint8Array(nx*ny*nz);
for(let k=0;k<nz;k++)for(let j=0;j<ny;j++)for(let i=0;i<nx;i++){ const idx=i+nx*(j+ny*k); if(full.data[idx]<=thr) continue;
  const w=applyAffine(Fw,i,j,k),wm=applyAffine(S2M,w[0],w[1],w[2]),pv=applyAffine(Pinv,wm[0],wm[1],wm[2]);
  const x=Math.round(pv[0]),y=Math.round(pv[1]),z=Math.round(pv[2]); if(x<0||y<0||z<0||x>=fx||y>=fy||z>=fz) continue;
  if(fusedMask[x+fx*(y+fy*z)]) m[idx]=1; }
m=largestComponent(m,full.dims); m=fillHoles3D(m,full.dims); m=smoothMask3D(m,full.dims,1);
let vox=0; for(let i=0;i<m.length;i++) vox+=m[i];
console.log(`FUSED brain: ${vox} vox (${(100*vox/(nx*ny*nz)).toFixed(1)}%)  total ${((Date.now()-t0)/1000).toFixed(0)}s`);
writeNifti(`bet/${base}_fusebrain.nii.gz`, (()=>{const o=new Float32Array(full.data.length);for(let i=0;i<o.length;i++)o[i]=m[i]?full.data[i]:0;return o;})(), full.header); console.log(`wrote bet/${base}_fusebrain.nii.gz`);
// overlay montage
const _crc=(()=>{const t=new Uint32Array(256);for(let n=0;n<256;n++){let c=n;for(let k=0;k<8;k++)c=c&1?0xedb88320^(c>>>1):c>>>1;t[n]=c>>>0;}return t;})();const crc32=b=>{let c=0xffffffff;for(let i=0;i<b.length;i++)c=_crc[(c^b[i])&0xff]^(c>>>8);return(c^0xffffffff)>>>0;};
function png(f,rgb,w,h){const r=Buffer.alloc((w*3+1)*h);for(let y=0;y<h;y++){r[y*(w*3+1)]=0;rgb.copy(r,y*(w*3+1)+1,y*w*3,y*w*3+w*3);}const id=zlib.deflateSync(r,{level:6});const ch=(t,dd)=>{const l=Buffer.alloc(4);l.writeUInt32BE(dd.length);const b=Buffer.concat([Buffer.from(t),dd]);const c=Buffer.alloc(4);c.writeUInt32BE(crc32(b));return Buffer.concat([l,b,c]);};const ih=Buffer.alloc(13);ih.writeUInt32BE(w,0);ih.writeUInt32BE(h,4);ih[8]=8;ih[9]=2;fs.writeFileSync(f,Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),ch('IHDR',ih),ch('IDAT',id),ch('IEND',Buffer.alloc(0))]));}
const srt=Float32Array.from(full.data).sort(),pq=q=>srt[Math.min(srt.length-1,Math.round(q*(srt.length-1)))],lo=pq(0.02),hi=pq(0.98)||1;
const cols=4,rows=3,n=cols*rows,W=cols*nx,H=rows*ny,img=Buffer.alloc(W*H*3);
for(let t=0;t<n;t++){const z=Math.round((t+0.5)/n*nz),gx=(t%cols)*nx,gy=((t/cols)|0)*ny;for(let y=0;y<ny;y++)for(let x=0;x<nx;x++){const s=x+nx*(y+ny*z);let g=Math.max(0,Math.min(255,Math.round(255*(full.data[s]-lo)/(hi-lo))));let r=g,gg=g,b=g;if(m[s]){const e=(x>0&&!m[s-1])||(x<nx-1&&!m[s+1])||(y>0&&!m[s-nx])||(y<ny-1&&!m[s+nx]);if(e){r=255;gg=40;b=40;}}const px=((gy+(ny-1-y))*W+(gx+x))*3;img[px]=r;img[px+1]=gg;img[px+2]=b;}}
png(`bet/${base}_fusebet.png`,img,W,H); console.log(`wrote bet/${base}_fusebet.png (${W}×${H})`);
