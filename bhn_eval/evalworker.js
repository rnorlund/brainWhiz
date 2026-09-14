/* BHN evaluator inference worker — keeps the page responsive during ~85s WASM inference. */
importScripts('ort.min.js');
ort.env.wasm.wasmPaths = './'; ort.env.wasm.numThreads = 1; ort.env.wasm.simd = true;
const N = 256*256*256;

function parseNii(ab){ const dv=new DataView(ab),u8=new Uint8Array(ab); const dim=[];for(let i=0;i<8;i++)dim.push(dv.getInt16(40+i*2,true));
  const dt=dv.getInt16(70,true),o=Math.round(dv.getFloat32(108,true)); const srow=[];for(let r=0;r<3;r++){const row=[];for(let c=0;c<4;c++)row.push(dv.getFloat32(280+r*16+c*4,true));srow.push(row);}srow.push([0,0,0,1]);
  const nx=dim[1],ny=dim[2],nz=dim[3],n=nx*ny*nz,data=new Float32Array(n);
  if(dt===16)for(let i=0;i<n;i++)data[i]=dv.getFloat32(o+i*4,true);else if(dt===4)for(let i=0;i<n;i++)data[i]=dv.getInt16(o+i*2,true);
  else if(dt===512)for(let i=0;i<n;i++)data[i]=dv.getUint16(o+i*2,true);else if(dt===2)for(let i=0;i<n;i++)data[i]=u8[o+i];
  else if(dt===8)for(let i=0;i<n;i++)data[i]=dv.getInt32(o+i*4,true);else throw "datatype "+dt; return {dim:[nx,ny,nz],affine:srow,data}; }
function inv3(m){const a=m[0][0],b=m[0][1],c=m[0][2],d=m[1][0],e=m[1][1],f=m[1][2],g=m[2][0],h=m[2][1],i=m[2][2];const A=e*i-f*h,B=-(d*i-f*g),C=d*h-e*g,id=1/(a*A+b*B+c*C);
  return[[A*id,(c*h-b*i)*id,(b*f-c*e)*id],[B*id,(a*i-c*g)*id,(c*d-a*f)*id],[C*id,(b*g-a*h)*id,(a*e-b*d)*id]];}
function conform256(nii){const {dim,affine,data}=nii,[nx,ny,nz]=dim;const cc=[(nx-1)/2,(ny-1)/2,(nz-1)/2];
  const cen=[0,1,2].map(r=>affine[r][0]*cc[0]+affine[r][1]*cc[1]+affine[r][2]*cc[2]+affine[r][3]);
  const R=[[affine[0][0],affine[0][1],affine[0][2]],[affine[1][0],affine[1][1],affine[1][2]],[affine[2][0],affine[2][1],affine[2][2]]];
  const Ri=inv3(R),t=[affine[0][3],affine[1][3],affine[2][3]],out=new Float32Array(N);
  for(let k=0;k<256;k++){const wz=cen[2]+(k-127.5);for(let j=0;j<256;j++){const wy=cen[1]+(j-127.5);for(let i=0;i<256;i++){const wx=cen[0]+(i-127.5);
    const dx=wx-t[0],dy=wy-t[1],dz=wz-t[2],vi=Ri[0][0]*dx+Ri[0][1]*dy+Ri[0][2]*dz,vj=Ri[1][0]*dx+Ri[1][1]*dy+Ri[1][2]*dz,vk=Ri[2][0]*dx+Ri[2][1]*dy+Ri[2][2]*dz;
    if(vi<0||vj<0||vk<0||vi>nx-1||vj>ny-1||vk>nz-1)continue;const x0=Math.floor(vi),y0=Math.floor(vj),z0=Math.floor(vk),x1=Math.min(x0+1,nx-1),y1=Math.min(y0+1,ny-1),z1=Math.min(z0+1,nz-1);
    const fx=vi-x0,fy=vj-y0,fz=vk-z0,ix=(x,y,z)=>data[x+nx*(y+ny*z)];
    const c00=ix(x0,y0,z0)*(1-fx)+ix(x1,y0,z0)*fx,c10=ix(x0,y1,z0)*(1-fx)+ix(x1,y1,z0)*fx,c01=ix(x0,y0,z1)*(1-fx)+ix(x1,y0,z1)*fx,c11=ix(x0,y1,z1)*(1-fx)+ix(x1,y1,z1)*fx;
    const c0=c00*(1-fy)+c10*fy,c1=c01*(1-fy)+c11*fy;out[i*65536+j*256+k]=c0*(1-fz)+c1*fz;}}} return out; }
function z199(v){const b=[];for(let i=0;i<v.length;i++)if(v[i]>0)b.push(v[i]);b.sort((a,z)=>a-z);
  const pc=q=>{const r=(b.length-1)*q,i0=Math.floor(r),f=r-i0;return b[i0]+(i0+1<b.length?f*(b[i0+1]-b[i0]):0);};
  const q1=pc(0.01),q99=pc(0.99);const out=new Float32Array(v.length);let s=0,n=0;
  for(let i=0;i<v.length;i++){let x=v[i];if(x<q1)x=q1;else if(x>q99)x=q99;out[i]=x;if(v[i]>0){s+=x;n++;}}
  const mu=s/n;let ss=0;for(let i=0;i<v.length;i++)if(v[i]>0)ss+=(out[i]-mu)*(out[i]-mu);const sd=Math.sqrt(ss/n)+1e-6;
  for(let i=0;i<v.length;i++)out[i]=v[i]>0?(out[i]-mu)/sd:0;return out;}
function q595(v){const b=[];for(let i=0;i<v.length;i++)if(v[i]>0)b.push(v[i]);b.sort((a,z)=>a-z);
  const pc=q=>{const r=(b.length-1)*q,i0=Math.floor(r),f=r-i0;return b[i0]+(i0+1<b.length?f*(b[i0+1]-b[i0]):0);};
  const lo=pc(0.05),hi=pc(0.95),d=hi-lo+1e-6,out=new Float32Array(v.length);
  for(let i=0;i<v.length;i++){let x=(v[i]-lo)/d;out[i]=x<0?0:(x>1?1:x);}return out;}
function buildNiiBuf(cvol,dt){const bpv=dt===2?1:4,buf=new ArrayBuffer(352+N*bpv),dv=new DataView(buf),u8=new Uint8Array(buf);
  dv.setInt16(0,348,true);dv.setInt16(40,3,true);for(let i=0;i<3;i++)dv.setInt16(42+i*2,256,true);for(let i=3;i<8;i++)dv.setInt16(42+i*2,1,true);
  dv.setInt16(70,dt,true);dv.setInt16(72,dt===2?8:32,true);dv.setFloat32(108,352,true);for(let i=0;i<3;i++)dv.setFloat32(80+i*4,1,true);
  dv.setInt16(254,1,true);const sr=[[1,0,0,-127.5],[0,1,0,-127.5],[0,0,1,-127.5]];for(let r=0;r<3;r++)for(let c=0;c<4;c++)dv.setFloat32(280+r*16+c*4,sr[r][c],true);
  u8[344]=0x6e;u8[345]=0x2b;u8[346]=0x31;u8[347]=0;const out=dt===2?new Uint8Array(buf,352):new Float32Array(buf,352);
  for(let R=0;R<256;R++)for(let A=0;A<256;A++)for(let S=0;S<256;S++)out[R+256*A+65536*S]=cvol[R*65536+A*256+S];return buf;}
const f32=u=>{const f=new Float32Array(u.length);for(let i=0;i<u.length;i++)f[i]=u[i];return f;};
const sessions={}; async function getS(f){ if(!sessions[f]) sessions[f]=await ort.InferenceSession.create(f,{executionProviders:['wasm']}); return sessions[f]; }
const P=(stage,detail)=>self.postMessage({type:'progress',stage,detail});

self.onmessage = async (e)=>{ const {mods,tasks,stripped}=e.data; try{
  const prep={}; let underlay=null;
  for(const key of Object.keys(mods)){ P('Preprocessing',key.toUpperCase()); const raw=conform256(parseNii(mods[key]));
    if(!stripped){ P('Brain extraction',key.toUpperCase()+' (mindgrab, ~60–90s)'); const mo=await (await getS('mindgrab.onnx')).run({t1:new ort.Tensor('float32',q595(raw),[1,1,256,256,256])}); const lg=mo.logits.data; for(let i=0;i<N;i++) if(!(lg[N+i]>lg[i])) raw[i]=0; }
    prep[key]=raw; if(!underlay) underlay=buildNiiBuf(raw,16); }
  const overlays=[];
  for(const t of tasks){ if(!prep[t.modKey])continue; P('Running '+t.label,'(~60–90s on CPU)'); const t0=Date.now();
    const s=await getS(t.file); const out=await s.run({t1:new ort.Tensor('float32', z199(prep[t.modKey]), [1,1,256,256,256])});
    const lg=out.logits.data, seg=new Uint8Array(N); let vox=0; for(let i=0;i<N;i++){ if(lg[N+i]>lg[i]){seg[i]=1;vox++;} }
    overlays.push({label:t.label,cmap:t.cmap,vox,buf:buildNiiBuf(f32(seg),16),secs:Math.round((Date.now()-t0)/1000)}); }
  const transfers=[underlay,...overlays.map(o=>o.buf)];
  self.postMessage({type:'done',underlay,overlays},transfers);
}catch(err){ self.postMessage({type:'error',msg:String((err&&err.message)||err)}); } };
