// Register a subject brain -> bundled MNI152 (clean-room affine), report NMI, and render an overlay
// (MNI grayscale + subject-edges in red) on the MNI grid to eyeball the alignment.
//   node chop/test_reg.mjs <subject_brain.nii[.gz]>
import fs from 'fs'; import zlib from 'zlib'; import path from 'path';
import { registerAffine, invert4x4, applyAffine } from './chop.js';

function loadNifti(file){ let raw=fs.readFileSync(file); if(file.endsWith('.gz')) raw=zlib.gunzipSync(raw);
  const dv=new DataView(raw.buffer,raw.byteOffset,raw.byteLength), le=true;
  const dim=[]; for(let i=0;i<8;i++) dim.push(dv.getInt16(40+i*2,le)); const nx=dim[1],ny=dim[2],nz=dim[3]||1;
  const dt=dv.getInt16(70,le); let sl=dv.getFloat32(112,le)||1, it=dv.getFloat32(116,le)||0; if(!sl)sl=1;
  const vox=dv.getFloat32(108,le)|0, sform=dv.getInt16(254,le);
  let A; if(sform>0){ A=[[dv.getFloat32(280,le),dv.getFloat32(284,le),dv.getFloat32(288,le),dv.getFloat32(292,le)],
                        [dv.getFloat32(296,le),dv.getFloat32(300,le),dv.getFloat32(304,le),dv.getFloat32(308,le)],
                        [dv.getFloat32(312,le),dv.getFloat32(316,le),dv.getFloat32(320,le),dv.getFloat32(324,le)],[0,0,0,1]]; }
  else { const px=[dv.getFloat32(80,le),dv.getFloat32(84,le),dv.getFloat32(88,le)]; A=[[px[0],0,0,-px[0]*nx/2],[0,px[1],0,-px[1]*ny/2],[0,0,px[2],-px[2]*nz/2],[0,0,0,1]]; }
  const rd={2:['getUint8',1],256:['getInt8',1],4:['getInt16',2],512:['getUint16',2],8:['getInt32',4],16:['getFloat32',4],64:['getFloat64',8]}[dt];
  const [fn,bp]=rd; const N=nx*ny*nz, data=new Float32Array(N); let o=vox; for(let i=0;i<N;i++){ data[i]=dv[fn](o,le)*sl+it; o+=bp; }
  return { data, dims:[nx,ny,nz], affine:A };
}
function loadMNI(){ global.window={}; import('../bundles/_mni152.js'); // side-effect set below
}
// load MNI synchronously
const mniSrc=fs.readFileSync('bundles/_mni152.js','utf8');
global.window={}; new Function('window', mniSrc)(global.window);
const M=global.window.MNI152;
const mniRaw=zlib.gunzipSync(Buffer.from(M.data,'base64'));
const fixed={ data:Float32Array.from(mniRaw), dims:M.dim.slice(), affine:M.affine };

const subFile=process.argv[2]||'bet/t2_brain.nii.gz';
const moving=loadNifti(subFile);
console.log(`fixed MNI ${fixed.dims.join('×')} @2mm   moving ${path.basename(subFile)} ${moving.dims.join('×')}`);
const t0=Date.now(); const reg=registerAffine(moving, fixed, {});
console.log(`registered in ${(Date.now()-t0)}ms   final NMI=${reg.nmi.toFixed(4)}   params=[${reg.params.map(v=>v.toFixed(2)).join(', ')}]`);

// resample moving into the MNI grid via matrix (FIXED world -> MOVING world) then Minv
const [fx,fy,fz]=fixed.dims, Faff=fixed.affine.flat?fixed.affine:fixed.affine;
const F16=[Faff[0][0],Faff[0][1],Faff[0][2],Faff[0][3],Faff[1][0],Faff[1][1],Faff[1][2],Faff[1][3],Faff[2][0],Faff[2][1],Faff[2][2],Faff[2][3],0,0,0,1];
const Minv=invert4x4([moving.affine[0][0],moving.affine[0][1],moving.affine[0][2],moving.affine[0][3],moving.affine[1][0],moving.affine[1][1],moving.affine[1][2],moving.affine[1][3],moving.affine[2][0],moving.affine[2][1],moving.affine[2][2],moving.affine[2][3],0,0,0,1]);
const [mx,my,mz]=moving.dims, res=new Float32Array(fx*fy*fz);
for(let k=0;k<fz;k++)for(let j=0;j<fy;j++)for(let i=0;i<fx;i++){ const w=applyAffine(F16,i,j,k); const wm=applyAffine(reg.matrix,w[0],w[1],w[2]); const v=applyAffine(Minv,wm[0],wm[1],wm[2]);
  const x=Math.round(v[0]),y=Math.round(v[1]),z=Math.round(v[2]); if(x<0||y<0||z<0||x>=mx||y>=my||z>=mz) continue; res[i+fx*(j+fy*k)]=moving.data[x+mx*(y+my*z)]; }

// overlay montage: MNI gray + resampled-subject boundary in red
const _crc=(()=>{const t=new Uint32Array(256);for(let n=0;n<256;n++){let c=n;for(let k=0;k<8;k++)c=c&1?0xedb88320^(c>>>1):c>>>1;t[n]=c>>>0;}return t;})();
const crc32=b=>{let c=0xffffffff;for(let i=0;i<b.length;i++)c=_crc[(c^b[i])&0xff]^(c>>>8);return(c^0xffffffff)>>>0;};
function writePNG(file,rgb,w,h){const raw=Buffer.alloc((w*3+1)*h);for(let y=0;y<h;y++){raw[y*(w*3+1)]=0;rgb.copy(raw,y*(w*3+1)+1,y*w*3,y*w*3+w*3);}
  const idat=zlib.deflateSync(raw,{level:6});const ch=(t,d)=>{const l=Buffer.alloc(4);l.writeUInt32BE(d.length);const b=Buffer.concat([Buffer.from(t),d]);const c=Buffer.alloc(4);c.writeUInt32BE(crc32(b));return Buffer.concat([l,b,c]);};
  const ih=Buffer.alloc(13);ih.writeUInt32BE(w,0);ih.writeUInt32BE(h,4);ih[8]=8;ih[9]=2;fs.writeFileSync(file,Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),ch('IHDR',ih),ch('IDAT',idat),ch('IEND',Buffer.alloc(0))]));}
let mlo=Infinity,mhi=-Infinity; for(let i=0;i<fixed.data.length;i++){const v=fixed.data[i]; if(v<mlo)mlo=v; if(v>mhi)mhi=v;}
const cols=5, rows=2, n=cols*rows, W=cols*fx, H=rows*fy, img=Buffer.alloc(W*H*3), rthr=(()=>{const s=Float32Array.from(res.filter(v=>v>0)).sort();return s[(s.length*0.05)|0]||1;})();
for(let t=0;t<n;t++){ const z=Math.round((t+0.5)/n*fz), gx=(t%cols)*fx, gy=((t/cols)|0)*fy;
  for(let y=0;y<fy;y++)for(let x=0;x<fx;x++){ const s=x+fx*(y+fy*z); let g=Math.max(0,Math.min(255,Math.round(255*(fixed.data[s]-mlo)/((mhi-mlo)||1))));
    let r=g,gg=g,b=g; const rv=res[s]>rthr;
    if(rv){ const edge=(x>0&&res[s-1]<=rthr)||(x<fx-1&&res[s+1]<=rthr)||(y>0&&res[s-fx]<=rthr)||(y<fy-1&&res[s+fx]<=rthr); if(edge){r=255;gg=30;b=30;} }
    const px=((gy+(fy-1-y))*W+(gx+x))*3; img[px]=r;img[px+1]=gg;img[px+2]=b; } }
const out='chop/reg_'+path.basename(subFile).replace(/\.nii(\.gz)?$/,'')+'.png'; writePNG(out,img,W,H);
console.log('wrote '+out+`  (${W}×${H})  — MNI gray + subject boundary red`);
