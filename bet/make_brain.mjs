// Extract the brain and WRITE it out: <name>_brain.nii.gz (masked volume, original affine preserved)
// + <name>_brain.png (3-plane montage of the extracted brain). Node-only, no deps.
//   node bet/make_brain.mjs <scan.nii[.gz]> [opts-json]
import fs from 'fs'; import zlib from 'zlib'; import path from 'path';
import { extractBrain, applyMask } from './bet.js';

function loadNifti(file){
  let raw=fs.readFileSync(file); if(file.endsWith('.gz')) raw=zlib.gunzipSync(raw);
  const dv=new DataView(raw.buffer, raw.byteOffset, raw.byteLength), le=true;
  const dim=[]; for(let i=0;i<8;i++) dim.push(dv.getInt16(40+i*2,le));
  const nx=dim[1],ny=dim[2],nz=dim[3]||1, datatype=dv.getInt16(70,le);
  let slope=dv.getFloat32(112,le)||1, inter=dv.getFloat32(116,le)||0; if(!slope)slope=1;
  const voxOff=dv.getFloat32(108,le)|0;
  const spacing=[Math.abs(dv.getFloat32(80,le))||1,Math.abs(dv.getFloat32(84,le))||1,Math.abs(dv.getFloat32(88,le))||1];
  const rd={2:['getUint8',1],256:['getInt8',1],4:['getInt16',2],512:['getUint16',2],8:['getInt32',4],16:['getFloat32',4],64:['getFloat64',8]}[datatype];
  if(!rd) throw new Error('unsupported datatype '+datatype); const [fn,bp]=rd;
  const N=nx*ny*nz, data=new Float32Array(N); let o=voxOff; for(let i=0;i<N;i++){ data[i]=dv[fn](o,le)*slope+inter; o+=bp; }
  return { data, dims:[nx,ny,nz], spacing, header:raw.slice(0,348) };   // keep the raw 348-byte header (affine/qform)
}

// write NIfTI-1 as float32, cloning the source header (preserves dim/pixdim/srow/qform) and patching type
function writeNifti(file, floatData, srcHeader){
  const h=Buffer.from(srcHeader); const dv=new DataView(h.buffer,h.byteOffset,h.byteLength), le=true;
  dv.setInt16(70,16,le);            // datatype = float32
  dv.setInt16(72,32,le);            // bitpix
  dv.setFloat32(108,352,le);        // vox_offset
  dv.setFloat32(112,1,le); dv.setFloat32(116,0,le);   // scl_slope=1, scl_inter=0
  const body=Buffer.alloc(4 + floatData.length*4);    // 4-byte extender (zeros) + data
  const bdv=new DataView(body.buffer); for(let i=0;i<floatData.length;i++) bdv.setFloat32(4+i*4, floatData[i], le);
  fs.writeFileSync(file, zlib.gzipSync(Buffer.concat([h, body])));
}

// ---- tiny grayscale->RGB PNG ----
const _crc=(()=>{const t=new Uint32Array(256);for(let n=0;n<256;n++){let c=n;for(let k=0;k<8;k++)c=c&1?0xedb88320^(c>>>1):c>>>1;t[n]=c>>>0;}return t;})();
const crc32=b=>{let c=0xffffffff;for(let i=0;i<b.length;i++)c=_crc[(c^b[i])&0xff]^(c>>>8);return(c^0xffffffff)>>>0;};
function writePNG(file,rgb,w,h){ const raw=Buffer.alloc((w*3+1)*h);
  for(let y=0;y<h;y++){raw[y*(w*3+1)]=0;rgb.copy(raw,y*(w*3+1)+1,y*w*3,y*w*3+w*3);}
  const idat=zlib.deflateSync(raw,{level:6});
  const chunk=(t,d)=>{const l=Buffer.alloc(4);l.writeUInt32BE(d.length);const b=Buffer.concat([Buffer.from(t),d]);const c=Buffer.alloc(4);c.writeUInt32BE(crc32(b));return Buffer.concat([l,b,c]);};
  const ih=Buffer.alloc(13);ih.writeUInt32BE(w,0);ih.writeUInt32BE(h,4);ih[8]=8;ih[9]=2;
  fs.writeFileSync(file,Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',ih),chunk('IDAT',idat),chunk('IEND',Buffer.alloc(0))]));
}

const file=process.argv[2], opts=process.argv[3]?JSON.parse(process.argv[3]):{};
const base=path.basename(file).replace(/\.nii(\.gz)?$/i,'');
const vol=loadNifti(file);
const [nx,ny,nz]=vol.dims;
const t0=Date.now(); const {mask,voxels}=extractBrain(vol,opts);
const brain=applyMask(vol.data, mask);
console.log(`${base}: ${nx}×${ny}×${nz}  brain=${voxels} vox (${(100*voxels/(nx*ny*nz)).toFixed(1)}%)  ${(Date.now()-t0)}ms`);
const outNii=`bet/${base}_brain.nii.gz`; writeNifti(outNii, brain, vol.header);
console.log('wrote '+outNii);

// 3-plane montage of the EXTRACTED brain (grayscale on black)
const srt=Float32Array.from(brain.filter(v=>v>0)).sort(); const p=q=>srt[Math.min(srt.length-1,Math.max(0,Math.round(q*(srt.length-1))))]||1;
const lo=0, hi=p(0.985)||1;
const g=v=>Math.max(0,Math.min(255,Math.round(255*(v-lo)/(hi-lo))));
const cx=nx>>1, cy=ny>>1, cz=nz>>1;
const planes=[
  {n:4, w:ny, h:nz, get:(i,a,b)=>brain[i+nx*(a+ny*b)], along:nx},   // sagittal (vary x)
  {n:4, w:nx, h:nz, get:(i,a,b)=>brain[a+nx*(i+ny*b)], along:ny},   // coronal  (vary y)
  {n:4, w:nx, h:ny, get:(i,a,b)=>brain[a+nx*(b+ny*i)], along:nz},   // axial    (vary z)
];
const cols=4, cw=Math.max(nx,ny), ch=Math.max(ny,nz), W=cols*cw, H=planes.length*ch, img=Buffer.alloc(W*H*3);
planes.forEach((pl,row)=>{ for(let c=0;c<cols;c++){ const idx=Math.round((c+0.5)/cols*pl.along);
  const gx=c*cw, gy=row*ch, ox=(cw-pl.w)>>1, oy=(ch-pl.h)>>1;
  for(let b=0;b<pl.h;b++)for(let a=0;a<pl.w;a++){ const val=pl.get(idx,a,b); const gg=g(val);
    const px=((gy+(pl.h-1-b)+oy)*W + (gx+a+ox))*3; img[px]=gg; img[px+1]=gg; img[px+2]=gg; } } });
const outPng=`bet/${base}_brain.png`; writePNG(outPng, img, W, H);
console.log('wrote '+outPng+`  (${W}×${H})`);
