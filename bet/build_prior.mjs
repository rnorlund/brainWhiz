// Build an MNI brain-PROBABILITY prior from a set of T1s (clean-room): for each subject, rough
// deep-core BET → register T1→MNI → warp the mask into the MNI grid → accumulate. prob = mean over
// subjects. Averaging washes out per-subject errors (neck etc.), leaving a robust population prior.
//   node bet/build_prior.mjs <dir-of-nii> <N> [outprefix]
import fs from 'fs'; import zlib from 'zlib'; import path from 'path';
import { extractBrain } from './bet.js';
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
  return { data, dims:[nx,ny,nz], spacing:sp, affine:A };
}
// integer block-mean downsample by factor f (isotropic in voxels)
function downsample(v, f){ const [nx,ny,nz]=v.dims, mx=Math.floor(nx/f), my=Math.floor(ny/f), mz=Math.floor(nz/f);
  const out=new Float32Array(mx*my*mz);
  for(let k=0;k<mz;k++)for(let j=0;j<my;j++)for(let i=0;i<mx;i++){ let s=0;
    for(let dz=0;dz<f;dz++)for(let dy=0;dy<f;dy++)for(let dx=0;dx<f;dx++) s+=v.data[(i*f+dx)+nx*((j*f+dy)+ny*(k*f+dz))];
    out[i+mx*(j+my*k)]=s/(f*f*f); }
  const A=v.affine, off=(f-1)/2;   // new affine: columns ×f, origin shifted by half a block
  const A2=[[A[0][0]*f,A[0][1]*f,A[0][2]*f, A[0][3]+ (A[0][0]+A[0][1]+A[0][2])*off],
            [A[1][0]*f,A[1][1]*f,A[1][2]*f, A[1][3]+ (A[1][0]+A[1][1]+A[1][2])*off],
            [A[2][0]*f,A[2][1]*f,A[2][2]*f, A[2][3]+ (A[2][0]+A[2][1]+A[2][2])*off],[0,0,0,1]];
  return { data:out, dims:[mx,my,mz], spacing:v.spacing.map(s=>s*f), affine:A2 };
}
function loadMNI(){ const src=fs.readFileSync('bundles/_mni152.js','utf8'); const w={}; new Function('window',src)(w);
  const M=w.MNI152, raw=zlib.gunzipSync(Buffer.from(M.data,'base64')); return { data:Float32Array.from(raw), dims:M.dim.slice(), affine:M.affine }; }
const A16=a=>[a[0][0],a[0][1],a[0][2],a[0][3],a[1][0],a[1][1],a[1][2],a[1][3],a[2][0],a[2][1],a[2][2],a[2][3],0,0,0,1];

const dir=process.argv[2], N=+(process.argv[3]||50), outp=process.argv[4]||'bet/mni_brain_prior';
const files=fs.readdirSync(dir).filter(f=>/\.nii(\.gz)?$/.test(f)).slice(0,N);
const mni=loadMNI(), [fx,fy,fz]=mni.dims, Fw=A16(mni.affine), count=new Float32Array(fx*fy*fz);
let ok=0; const t0=Date.now();
for(const f of files){ try{
  const vol=downsample(loadNifti(path.join(dir,f)), 2);            // ~2mm for speed
  const M=extractBrain(vol,{method:'deepcore', hull:false, smooth:1});  // rough mask (neck ok — averages out)
  const reg=registerAffine({data:vol.data,dims:vol.dims,affine:vol.affine}, mni, {});
  const Minv=invert4x4(A16(vol.affine)), [mx,my,mz]=vol.dims;
  for(let k=0;k<fz;k++)for(let j=0;j<fy;j++)for(let i=0;i<fx;i++){ const w=applyAffine(Fw,i,j,k); const wm=applyAffine(reg.matrix,w[0],w[1],w[2]); const v=applyAffine(Minv,wm[0],wm[1],wm[2]);
    const x=Math.round(v[0]),y=Math.round(v[1]),z=Math.round(v[2]); if(x<0||y<0||z<0||x>=mx||y>=my||z>=mz) continue; if(M.mask[x+mx*(y+my*z)]) count[i+fx*(j+fy*k)]++; }
  ok++; if(ok%5===0||ok<=3) console.log(`  ${ok}/${files.length}  ${f.slice(0,28)}  NMI=${reg.nmi.toFixed(3)}  (${((Date.now()-t0)/1000).toFixed(0)}s)`);
}catch(e){ console.log('  SKIP '+f+': '+e.message); } }
// probability 0..1 -> uint8 0..255
const prob=new Uint8Array(count.length); for(let i=0;i<count.length;i++) prob[i]=Math.round(255*count[i]/ok);
// save as gzip+base64 JS asset (same shape as _mni152.js) + a plain .nii-ish montage
const gz=zlib.gzipSync(Buffer.from(prob)).toString('base64');
fs.writeFileSync(outp+'.js', `window.MNI_BRAIN_PRIOR=${JSON.stringify({dim:mni.dims,affine:mni.affine,n:ok,data:gz})};\n`);
console.log(`built from ${ok}/${files.length} subjects in ${((Date.now()-t0)/1000).toFixed(0)}s → ${outp}.js`);
// quick montage of the probability map
const _crc=(()=>{const t=new Uint32Array(256);for(let n=0;n<256;n++){let c=n;for(let k=0;k<8;k++)c=c&1?0xedb88320^(c>>>1):c>>>1;t[n]=c>>>0;}return t;})();
const crc32=b=>{let c=0xffffffff;for(let i=0;i<b.length;i++)c=_crc[(c^b[i])&0xff]^(c>>>8);return(c^0xffffffff)>>>0;};
function writePNG(file,rgb,w,h){const raw=Buffer.alloc((w*3+1)*h);for(let y=0;y<h;y++){raw[y*(w*3+1)]=0;rgb.copy(raw,y*(w*3+1)+1,y*w*3,y*w*3+w*3);}const idat=zlib.deflateSync(raw,{level:6});const ch=(t,d)=>{const l=Buffer.alloc(4);l.writeUInt32BE(d.length);const b=Buffer.concat([Buffer.from(t),d]);const c=Buffer.alloc(4);c.writeUInt32BE(crc32(b));return Buffer.concat([l,b,c]);};const ih=Buffer.alloc(13);ih.writeUInt32BE(w,0);ih.writeUInt32BE(h,4);ih[8]=8;ih[9]=2;fs.writeFileSync(file,Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),ch('IHDR',ih),ch('IDAT',idat),ch('IEND',Buffer.alloc(0))]));}
const cols=5,rows=2,n=cols*rows,W=cols*fx,H=rows*fy,img=Buffer.alloc(W*H*3);
for(let t=0;t<n;t++){const z=Math.round((t+0.5)/n*fz),gx=(t%cols)*fx,gy=((t/cols)|0)*fy;
  for(let y=0;y<fy;y++)for(let x=0;x<fx;x++){const p=prob[x+fx*(y+fy*z)]; const px=((gy+(fy-1-y))*W+(gx+x))*3; img[px]=p; img[px+1]=Math.round(p*0.5); img[px+2]=255-p; }}
writePNG(outp+'.png',img,W,H); console.log('wrote '+outp+'.png');
