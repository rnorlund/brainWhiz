// Quick clean-room BET check: parse a .nii(.gz), run extractBrain, render an axial montage
// (T1 grayscale + red brain-mask outline) to a PNG. Node-only; no third-party deps.
//   node bet/test_bet.mjs <scan.nii[.gz]> [out.png] [threshMul] [erode]
import fs from 'fs'; import zlib from 'zlib'; import path from 'path';
import { extractBrain } from './bet.js';

// ---- minimal NIfTI-1 reader (handles uint8/int16/uint16/int32/float32/float64) ----
function readNifti(file){
  let buf=fs.readFileSync(file);
  if(file.endsWith('.gz')) buf=zlib.gunzipSync(buf);
  const dv=new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const le=true;
  const dim=[]; for(let i=0;i<8;i++) dim.push(dv.getInt16(40+i*2, le));
  const nx=dim[1], ny=dim[2], nz=dim[3]||1;
  const datatype=dv.getInt16(70, le);
  let slope=dv.getFloat32(112, le)||1, inter=dv.getFloat32(116, le)||0; if(slope===0)slope=1;
  const voxOff=dv.getFloat32(108, le)|0;
  const spacing=[Math.abs(dv.getFloat32(80,le))||1, Math.abs(dv.getFloat32(84,le))||1, Math.abs(dv.getFloat32(88,le))||1];  // pixdim[1..3]
  const N=nx*ny*nz; const data=new Float32Array(N);
  const rd = { 2:['getUint8',1], 256:['getInt8',1], 4:['getInt16',2], 512:['getUint16',2],
               8:['getInt32',4], 16:['getFloat32',4], 64:['getFloat64',8] }[datatype];
  if(!rd) throw new Error('unsupported NIfTI datatype '+datatype);
  const [fn,bp]=rd; let o=voxOff;
  for(let i=0;i<N;i++){ data[i]=dv[fn](o, le)*slope+inter; o+=bp; }
  return { data, dims:[nx,ny,nz], spacing, datatype };
}

// ---- tiny RGB PNG writer ----
function writePNG(file, rgb, w, h){
  const raw=Buffer.alloc((w*3+1)*h);
  for(let y=0;y<h;y++){ raw[y*(w*3+1)]=0; rgb.copy(raw, y*(w*3+1)+1, y*w*3, y*w*3+w*3); }
  const idat=zlib.deflateSync(raw, {level:6});
  const chunk=(type,data)=>{ const len=Buffer.alloc(4); len.writeUInt32BE(data.length);
    const body=Buffer.concat([Buffer.from(type), data]); const crc=Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body)>>>0); return Buffer.concat([len, body, crc]); };
  const ihdr=Buffer.alloc(13); ihdr.writeUInt32BE(w,0); ihdr.writeUInt32BE(h,4); ihdr[8]=8; ihdr[9]=2;
  const png=Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]), chunk('IHDR',ihdr), chunk('IDAT',idat), chunk('IEND',Buffer.alloc(0))]);
  fs.writeFileSync(file, png);
}
const _crc=(()=>{ const t=new Uint32Array(256); for(let n=0;n<256;n++){ let c=n; for(let k=0;k<8;k++) c=c&1?0xedb88320^(c>>>1):c>>>1; t[n]=c>>>0; } return t; })();
function crc32(b){ let c=0xffffffff; for(let i=0;i<b.length;i++) c=_crc[(c^b[i])&0xff]^(c>>>8); return (c^0xffffffff)>>>0; }

// ---- build the montage ----
const file=process.argv[2]; const out=process.argv[3]||'bet/bet_result.png';
const opts=process.argv[4]?JSON.parse(process.argv[4]):{};
const t0=Date.now(); const vol=readNifti(file);
const [nx,ny,nz]=vol.dims; console.log(`loaded ${path.basename(file)}  dims=${nx}×${ny}×${nz}  spacing=${vol.spacing.map(s=>s.toFixed(2))}  opts=${JSON.stringify(opts)}  (${(Date.now()-t0)}ms)`);
const t1=Date.now(); const res=extractBrain(vol, opts);
const total=nx*ny*nz;
console.log(`extractBrain: ${res.voxels} brain voxels (${(100*res.voxels/total).toFixed(1)}% of volume), thr=${res.threshold.toFixed(1)}, ${(Date.now()-t1)}ms`);

// robust intensity window for display
const sorted=Float32Array.from(vol.data).sort(); const p=q=>sorted[Math.min(sorted.length-1,Math.max(0,Math.round(q*(sorted.length-1))))];
const lo=p(0.02), hi=p(0.98)||1;
const cols=4, rows=3, n=cols*rows;
const zs=Array.from({length:n},(_,i)=>Math.round((i+0.5)/n*nz));
const cw=nx, ch=ny, W=cols*cw, H=rows*ch, img=Buffer.alloc(W*H*3);
const mask=res.mask;
for(let t=0;t<n;t++){ const z=zs[t], gx=(t%cols)*cw, gy=((t/cols)|0)*ch;
  for(let y=0;y<ny;y++)for(let x=0;x<nx;x++){ const s=x+nx*(y+ny*z);
    let g=Math.max(0,Math.min(255, Math.round(255*(vol.data[s]-lo)/(hi-lo))));
    let r=g,gg=g,b=g;
    // red where mask boundary (mask voxel adjacent to non-mask)
    if(mask[s]){ const edge = (x>0&&!mask[s-1])||(x<nx-1&&!mask[s+1])||(y>0&&!mask[s-nx])||(y<ny-1&&!mask[s+nx]);
      if(edge){ r=255; gg=40; b=40; } else { r=Math.min(255,g+10); b=Math.max(0,b-30); } }  // faint warm tint inside
    const px=((gy+(ny-1-y))*W + (gx+x))*3;   // flip Y so slices look radiological-ish
    img[px]=r; img[px+1]=gg; img[px+2]=b;
  } }
writePNG(out, img, W, H);
console.log('wrote '+out+`  (${W}×${H})`);
