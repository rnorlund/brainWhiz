// Fast prior-driven BET: downsample → quick deep-core (for registration) → register→MNI → warp the
// OASIS brain-probability prior back → gate (tissue ∩ prior) → clean → upsample. Skips the slow
// distance-transform/geodesic/hull; the population prior removes neck/face. Clean-room.
//   node bet/fast_bet.mjs <scan.nii[.gz]> [priorThresh=0.15]
import fs from 'fs'; import zlib from 'zlib'; import path from 'path';
import { extractBrain, applyMask, otsu, threshMask, largestComponent, fillHoles3D, smoothMask3D } from './bet.js';
import { registerAffine, invert4x4, applyAffine } from '../chop/chop.js';

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
function downsample(v,f){ const [nx,ny,nz]=v.dims,mx=(nx/f)|0,my=(ny/f)|0,mz=(nz/f)|0,out=new Float32Array(mx*my*mz);
  for(let k=0;k<mz;k++)for(let j=0;j<my;j++)for(let i=0;i<mx;i++){let s=0;for(let dz=0;dz<f;dz++)for(let dy=0;dy<f;dy++)for(let dx=0;dx<f;dx++)s+=v.data[(i*f+dx)+nx*((j*f+dy)+ny*(k*f+dz))];out[i+mx*(j+my*k)]=s/(f*f*f);}
  const A=v.affine,o=(f-1)/2,A2=[[A[0][0]*f,A[0][1]*f,A[0][2]*f,A[0][3]+(A[0][0]+A[0][1]+A[0][2])*o],[A[1][0]*f,A[1][1]*f,A[1][2]*f,A[1][3]+(A[1][0]+A[1][1]+A[1][2])*o],[A[2][0]*f,A[2][1]*f,A[2][2]*f,A[2][3]+(A[2][0]+A[2][1]+A[2][2])*o],[0,0,0,1]];
  return { data:out, dims:[mx,my,mz], spacing:v.spacing.map(s=>s*f), affine:A2 }; }
function loadPrior(){ const src=fs.readFileSync('bet/mni_brain_prior.js','utf8'); const w={}; new Function('window',src)(w);
  const P=w.MNI_BRAIN_PRIOR, raw=zlib.gunzipSync(Buffer.from(P.data,'base64')); return { data:raw, dims:P.dim, affine:P.affine, n:P.n }; }
function loadMNI(){ const src=fs.readFileSync('bundles/_mni152.js','utf8'); const w={}; new Function('window',src)(w);
  const M=w.MNI152, raw=zlib.gunzipSync(Buffer.from(M.data,'base64')); return { data:Float32Array.from(raw), dims:M.dim.slice(), affine:M.affine }; }
const A16=a=>[a[0][0],a[0][1],a[0][2],a[0][3],a[1][0],a[1][1],a[1][2],a[1][3],a[2][0],a[2][1],a[2][2],a[2][3],0,0,0,1];
function writeNifti(file,fd,h0){const h=Buffer.from(h0);const dv=new DataView(h.buffer,h.byteOffset,h.byteLength),le=true;dv.setInt16(70,16,le);dv.setInt16(72,32,le);dv.setFloat32(108,352,le);dv.setFloat32(112,1,le);dv.setFloat32(116,0,le);const body=Buffer.alloc(4+fd.length*4),bd=new DataView(body.buffer);for(let i=0;i<fd.length;i++)bd.setFloat32(4+i*4,fd[i],le);fs.writeFileSync(file,zlib.gzipSync(Buffer.concat([h,body])));}
const _crc=(()=>{const t=new Uint32Array(256);for(let n=0;n<256;n++){let c=n;for(let k=0;k<8;k++)c=c&1?0xedb88320^(c>>>1):c>>>1;t[n]=c>>>0;}return t;})();const crc32=b=>{let c=0xffffffff;for(let i=0;i<b.length;i++)c=_crc[(c^b[i])&0xff]^(c>>>8);return(c^0xffffffff)>>>0;};
function writePNG(file,rgb,w,h){const raw=Buffer.alloc((w*3+1)*h);for(let y=0;y<h;y++){raw[y*(w*3+1)]=0;rgb.copy(raw,y*(w*3+1)+1,y*w*3,y*w*3+w*3);}const idat=zlib.deflateSync(raw,{level:6});const ch=(t,d)=>{const l=Buffer.alloc(4);l.writeUInt32BE(d.length);const b=Buffer.concat([Buffer.from(t),d]);const c=Buffer.alloc(4);c.writeUInt32BE(crc32(b));return Buffer.concat([l,b,c]);};const ih=Buffer.alloc(13);ih.writeUInt32BE(w,0);ih.writeUInt32BE(h,4);ih[8]=8;ih[9]=2;fs.writeFileSync(file,Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),ch('IHDR',ih),ch('IDAT',idat),ch('IEND',Buffer.alloc(0))]));}

const file=process.argv[2], PT=Math.round(255*(+(process.argv[3]||0.15)));
const base=path.basename(file).replace(/\.nii(\.gz)?$/i,''); const t0=Date.now();
const vol=loadNifti(file), [nx,ny,nz]=vol.dims;
const ds=downsample(vol,2);                                        // ~2mm working res
const M0=extractBrain(ds,{method:'deepcore',hull:false,smooth:1}); // rough brain (for registration init only)
const mni=loadMNI(), prior=loadPrior();
const reg=registerAffine({data:applyMask(ds.data,M0.mask),dims:ds.dims,affine:ds.affine}, mni, {});  // register to MNI *template* (has intensity structure)
const S2M=invert4x4(reg.matrix);                                   // native world → MNI world
const Pinv=invert4x4(A16(prior.affine));                           // MNI world → prior voxel (prior shares MNI grid)
const Fw=A16(vol.affine), [px,py,pz]=prior.dims;
const thr=otsu(vol.data)*0.45; let m=new Uint8Array(nx*ny*nz);
for(let k=0;k<nz;k++)for(let j=0;j<ny;j++)for(let i=0;i<nx;i++){ const idx=i+nx*(j+ny*k); if(vol.data[idx]<=thr) continue;   // tissue only
  const w=applyAffine(Fw,i,j,k), wm=applyAffine(S2M,w[0],w[1],w[2]), pv=applyAffine(Pinv,wm[0],wm[1],wm[2]);
  const x=Math.round(pv[0]),y=Math.round(pv[1]),z=Math.round(pv[2]); if(x<0||y<0||z<0||x>=px||y>=py||z>=pz) continue;
  if(prior.data[x+px*(y+py*z)]>=PT) m[idx]=1;                       // gate by population brain probability
}
m=largestComponent(m,vol.dims); m=fillHoles3D(m,vol.dims); m=smoothMask3D(m,vol.dims,1);
let vox=0; for(let i=0;i<m.length;i++) vox+=m[i];
console.log(`${base}: ${vox} vox (${(100*vox/(nx*ny*nz)).toFixed(1)}%)  regNMI=${reg.nmi.toFixed(3)}  ${(Date.now()-t0)}ms`);
writeNifti(`bet/${base}_fbrain.nii.gz`, applyMask(vol.data,m), vol.header); console.log(`wrote bet/${base}_fbrain.nii.gz`);
// overlay montage
const srt=Float32Array.from(vol.data).sort(),pq=q=>srt[Math.min(srt.length-1,Math.round(q*(srt.length-1)))],lo=pq(0.02),hi=pq(0.98)||1;
const cols=4,rows=3,n=cols*rows,W=cols*nx,H=rows*ny,img=Buffer.alloc(W*H*3);
for(let t=0;t<n;t++){const z=Math.round((t+0.5)/n*nz),gx=(t%cols)*nx,gy=((t/cols)|0)*ny;
  for(let y=0;y<ny;y++)for(let x=0;x<nx;x++){const s=x+nx*(y+ny*z);let g=Math.max(0,Math.min(255,Math.round(255*(vol.data[s]-lo)/(hi-lo))));let r=g,gg=g,b=g;
    if(m[s]){const e=(x>0&&!m[s-1])||(x<nx-1&&!m[s+1])||(y>0&&!m[s-nx])||(y<ny-1&&!m[s+nx]);if(e){r=255;gg=40;b=40;}}
    const px2=((gy+(ny-1-y))*W+(gx+x))*3;img[px2]=r;img[px2+1]=gg;img[px2+2]=b;}}
writePNG(`bet/${base}_fbet.png`,img,W,H); console.log(`wrote bet/${base}_fbet.png (${W}×${H})`);
