// Validate bet/conform.js (JS) against bet/train/common.py (Python) on one scan: they MUST agree so
// the ONNX model sees the same input in-browser as in training. Usage: node validate_conform.mjs <t1> <x_py.f32>
import fs from 'fs'; import zlib from 'zlib';
import { conformVol, BET_SHAPE } from '../conform.js';
function loadNifti(file){ let raw=fs.readFileSync(file); if(file.endsWith('.gz')) raw=zlib.gunzipSync(raw);
  const dv=new DataView(raw.buffer,raw.byteOffset,raw.byteLength),le=true; const dim=[];for(let i=0;i<8;i++)dim.push(dv.getInt16(40+i*2,le));
  const nx=dim[1],ny=dim[2],nz=dim[3]||1,dtp=dv.getInt16(70,le);let sl=dv.getFloat32(112,le)||1,it=dv.getFloat32(116,le)||0;if(!sl)sl=1;
  const vox=dv.getFloat32(108,le)|0,sform=dv.getInt16(254,le);
  let A;if(sform>0){A=[[dv.getFloat32(280,le),dv.getFloat32(284,le),dv.getFloat32(288,le),dv.getFloat32(292,le)],[dv.getFloat32(296,le),dv.getFloat32(300,le),dv.getFloat32(304,le),dv.getFloat32(308,le)],[dv.getFloat32(312,le),dv.getFloat32(316,le),dv.getFloat32(320,le),dv.getFloat32(324,le)]];}
  else{const sp=[dv.getFloat32(80,le),dv.getFloat32(84,le),dv.getFloat32(88,le)];A=[[sp[0],0,0,-sp[0]*nx/2],[0,sp[1],0,-sp[1]*ny/2],[0,0,sp[2],-sp[2]*nz/2]];}
  const rd={2:['getUint8',1],256:['getInt8',1],4:['getInt16',2],512:['getUint16',2],8:['getInt32',4],16:['getFloat32',4],64:['getFloat64',8]}[dtp];const[fn,bp]=rd;
  const N=nx*ny*nz,data=new Float32Array(N);let o=vox;for(let i=0;i<N;i++){data[i]=dv[fn](o,le)*sl+it;o+=bp;}
  return {data,dims:[nx,ny,nz],M:[A[0][0],A[0][1],A[0][2],A[1][0],A[1][1],A[1][2],A[2][0],A[2][1],A[2][2]],T:[A[0][3],A[1][3],A[2][3]]}; }

const vol=loadNifti(process.argv[2]);
const { x }=conformVol(vol);
const xpy=new Float32Array(fs.readFileSync(process.argv[3]).buffer);
if(xpy.length!==x.length){ console.log('LENGTH MISMATCH',x.length,xpy.length); process.exit(1); }
let maxd=0,sad=0,sx=0,sy=0,sxx=0,syy=0,sxy=0,n=x.length;
for(let i=0;i<n;i++){ const a=x[i],b=xpy[i],d=Math.abs(a-b); if(d>maxd)maxd=d; sad+=d; sx+=a;sy+=b;sxx+=a*a;syy+=b*b;sxy+=a*b; }
const corr=(n*sxy-sx*sy)/Math.sqrt((n*sxx-sx*sx)*(n*syy-sy*sy));
console.log(`conform grid ${BET_SHAPE}  |  max|Δ| ${maxd.toFixed(4)}  mean|Δ| ${(sad/n).toFixed(5)}  corr ${corr.toFixed(5)}`);
console.log(maxd<0.05 && corr>0.999 ? 'PASS — JS conform matches Python' : (corr>0.99?'CLOSE (minor diffs, ok with translation aug)':'FAIL — investigate'));
