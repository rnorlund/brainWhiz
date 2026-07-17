// Self-contained NIfTI-1 parse + Surface-Nets isosurface, extracted from brainWhiz (clean-room JS, no CDN).
// Used by the webview to view .nii/.nii.gz files: slices + a 3D surface. No external dependencies.

export function inv3(m){ // row-major 3x3 inverse
  const [a,b,c,d,e,f,g,h,i]=m;
  const A=e*i-f*h,B=-(d*i-f*g),C=d*h-e*g,D=-(b*i-c*h),E=a*i-c*g,F=-(a*h-b*g),
        G=b*f-c*e,H=-(a*f-c*d),I=a*e-b*d, det=a*A+b*B+c*C||1e-9;
  return [A/det,D/det,G/det,B/det,E/det,H/det,C/det,F/det,I/det];
}

export function parseNifti(buf){
  const dv=new DataView(buf);
  let little=true; if(dv.getInt32(0,true)!==348){ little=false; if(dv.getInt32(0,false)!==348) little=true; }
  const i16=o=>dv.getInt16(o,little), f32=o=>dv.getFloat32(o,little);
  const dim=[]; for(let k=0;k<8;k++) dim.push(i16(40+k*2));
  const nx=dim[1],ny=dim[2],nz=dim[3];
  const datatype=i16(70);
  let voff=Math.round(f32(108)); if(!voff||voff<352) voff=352;
  let slope=f32(112); const inter=f32(116); if(!slope) slope=1;
  const sform=i16(254);
  let M,T;
  if(sform>0){ M=[f32(280),f32(284),f32(288), f32(296),f32(300),f32(304), f32(312),f32(316),f32(320)]; T=[f32(292),f32(308),f32(324)]; }
  else { const px=[f32(80),f32(84),f32(88)]; M=[px[0],0,0, 0,px[1],0, 0,0,px[2]]; T=[-px[0]*nx/2,-px[1]*ny/2,-px[2]*nz/2]; }
  const Minv=inv3(M);
  const read=(idx)=>{ switch(datatype){
    case 2: return dv.getUint8(voff+idx); case 256: return dv.getInt8(voff+idx);
    case 4: return dv.getInt16(voff+idx*2,little); case 512: return dv.getUint16(voff+idx*2,little);
    case 8: return dv.getInt32(voff+idx*4,little); case 16: return dv.getFloat32(voff+idx*4,little);
    case 64: return dv.getFloat64(voff+idx*8,little); default: return dv.getFloat32(voff+idx*4,little); } };
  const nv=nx*ny*nz;
  const bpv={2:1,256:1,4:2,512:2,8:4,16:4,64:8}[datatype]||4;
  let nt=(dim[0]>=4 && dim[4]>1)?dim[4]:1; const avail=Math.floor((buf.byteLength-voff)/bpv/nv); if(avail>=1) nt=Math.min(nt,Math.max(1,avail));
  const data=new Float32Array(nv); let _frame=-1;
  function loadFrame(k){ k=Math.max(0,Math.min(nt-1,k|0)); const base=k*nv; for(let idx=0;idx<nv;idx++) data[idx]=read(base+idx)*slope+inter; _frame=k; }
  loadFrame(0);
  function sampleMM(x,y,z){ const dx=x-T[0],dy=y-T[1],dz=z-T[2];
    const i=Math.round(Minv[0]*dx+Minv[1]*dy+Minv[2]*dz), j=Math.round(Minv[3]*dx+Minv[4]*dy+Minv[5]*dz), k=Math.round(Minv[6]*dx+Minv[7]*dy+Minv[8]*dz);
    if(i<0||j<0||k<0||i>=nx||j>=ny||k>=nz) return null; return data[i+j*nx+k*nx*ny]; }
  const vox=[Math.hypot(M[0],M[3],M[6]),Math.hypot(M[1],M[4],M[7]),Math.hypot(M[2],M[5],M[8])];
  const worldOf=(i,j,k)=>[M[0]*i+M[1]*j+M[2]*k+T[0], M[3]*i+M[4]*j+M[5]*k+T[1], M[6]*i+M[7]*j+M[8]*k+T[2]];
  const header = readHeader(dv, little, {dim, datatype, sform, M, T, slope, inter, voff});
  return {sampleMM,data,dim:[nx,ny,nz],vox,M,T,Minv,worldOf,nt,setFrame:loadFrame,header,get frame(){return _frame;}};
}

// ---- full NIfTI-1 header, human-readable (for the details panel) ----
const DT_NAMES={2:'uint8',4:'int16',8:'int32',16:'float32',32:'complex64',64:'float64',128:'RGB24',256:'int8',512:'uint16',768:'uint32',1024:'int64',1280:'uint64',1792:'complex128'};
const SPACE_U={0:'unknown',1:'meter',2:'mm',3:'micron'};
const TIME_U={0:'unknown',8:'sec',16:'msec',24:'usec',32:'Hz',40:'ppm',48:'rad/s'};
const XFORM={0:'unknown',1:'scanner_anat',2:'aligned_anat',3:'talairach',4:'mni_152'};
const INTENT={0:'none',2:'correlation',3:'t-test',4:'f-test',5:'z-score',1007:'vector',1005:'sym-matrix',1002:'label',1006:'displacement'};
function readHeader(dv, little, x){
  const f32=o=>dv.getFloat32(o,little), i16=o=>dv.getInt16(o,little);
  const str=(o,n)=>{ let s=''; for(let k=0;k<n;k++){ const c=dv.getUint8(o+k); if(!c) break; s+=String.fromCharCode(c); } return s; };
  const pixdim=[]; for(let k=0;k<8;k++) pixdim.push(f32(76+k*4));
  const units=dv.getUint8(123); const su=units&0x07, tu=units&0x38;
  const ndim=x.dim[0];
  return {
    magic: str(344,4) || 'ni1',
    byteOrder: little?'little-endian':'big-endian',
    ndim, dims: x.dim.slice(1,1+Math.max(1,Math.min(7,ndim))),
    datatype: `${DT_NAMES[x.datatype]||'?'} (code ${x.datatype})`,
    bitpix: i16(72),
    voxelSizeMM: [pixdim[1],pixdim[2],pixdim[3]].map(v=>+v.toFixed(4)),
    timeStep: +(pixdim[4]||0).toFixed(4),
    spaceUnits: SPACE_U[su]||su, timeUnits: TIME_U[tu]||tu,
    sformCode: `${XFORM[i16(254)]||'?'} (${i16(254)})`,
    qformCode: `${XFORM[i16(252)]||'?'} (${i16(252)})`,
    affine: [[+x.M[0].toFixed(4),+x.M[1].toFixed(4),+x.M[2].toFixed(4),+x.T[0].toFixed(3)],
             [+x.M[3].toFixed(4),+x.M[4].toFixed(4),+x.M[5].toFixed(4),+x.T[1].toFixed(3)],
             [+x.M[6].toFixed(4),+x.M[7].toFixed(4),+x.M[8].toFixed(4),+x.T[2].toFixed(3)]],
    orientation: orientCode(x.M),
    sclSlope: +f32(112).toFixed(4), sclInter: +f32(116).toFixed(4),
    calMin: +f32(128).toFixed(3), calMax: +f32(124).toFixed(3),
    intent: `${INTENT[i16(68)]||'?'} (${i16(68)})`, intentName: str(328,16),
    description: str(148,80), auxFile: str(228,24), voxOffset: x.voff,
  };
}
// derive the 3-letter orientation label (e.g. RAS, LPI) from the affine's dominant axes
function orientCode(M){ const L='LR',P='PA',I='S'; const axes=['','',''];
  const cols=[[M[0],M[3],M[6]],[M[1],M[4],M[7]],[M[2],M[5],M[8]]];
  const lbl=[['L','R'],['P','A'],['I','S']];
  for(let c=0;c<3;c++){ let mx=0,ax=0; for(let r=0;r<3;r++){ if(Math.abs(cols[c][r])>Math.abs(mx)){ mx=cols[c][r]; ax=r; } } axes[c]=lbl[ax][mx>=0?1:0]; }
  return axes.join('');
}

// ---- Surface Nets (public-domain algorithm; clean-room JS) ----
const SN_CUBE_EDGES=new Int32Array(24), SN_EDGE_TABLE=new Int32Array(256);
(function(){ let k=0;
  for(let i=0;i<8;i++){ for(let j=1;j<=4;j<<=1){ const p=i^j; if(i<=p){ SN_CUBE_EDGES[k++]=i; SN_CUBE_EDGES[k++]=p; } } }
  for(let i=0;i<256;i++){ let em=0;
    for(let j=0;j<24;j+=2){ const a=!!(i&(1<<SN_CUBE_EDGES[j])), b=!!(i&(1<<SN_CUBE_EDGES[j+1])); if(a!==b) em|=1<<(j>>1); }
    SN_EDGE_TABLE[i]=em; } })();

export function surfaceNets(data, dims){
  const positions=[], cells=[]; const R=[1,dims[0]+1,(dims[0]+1)*(dims[1]+1)];
  const buffer=new Int32Array(R[2]*2); let buf_no=1,n=0; const xx=[0,0,0],grid=new Float32Array(8);
  for(xx[2]=0; xx[2]<dims[2]-1; ++xx[2], n+=dims[0], buf_no^=1, R[2]=-R[2]){
    let m=1+(dims[0]+1)*(1+buf_no*(dims[1]+1));
    for(xx[1]=0; xx[1]<dims[1]-1; ++xx[1], ++n, m+=2)
    for(xx[0]=0; xx[0]<dims[0]-1; ++xx[0], ++n, ++m){
      let mask=0,g=0,idx=n;
      for(let k=0;k<2;++k, idx+=dims[0]*(dims[1]-2)) for(let j=0;j<2;++j, idx+=dims[0]-2) for(let i=0;i<2;++i, ++g, ++idx){ const p=data[idx]; grid[g]=p; if(p<0) mask|=1<<g; }
      if(mask===0||mask===0xff) continue;
      const em=SN_EDGE_TABLE[mask]; const v=[0,0,0]; let ec=0;
      for(let i=0;i<12;++i){ if(!(em&(1<<i))) continue; ++ec;
        const e0=SN_CUBE_EDGES[i*2],e1=SN_CUBE_EDGES[i*2+1],g0=grid[e0],g1=grid[e1]; let t=g0-g1; t=Math.abs(t)>1e-6?g0/t:0.5;
        let kk=1; for(let j=0;j<3;++j){ const a=e0&kk,b=e1&kk; if(a!==b) v[j]+=a?1-t:t; else v[j]+=a?1:0; kk<<=1; } }
      const s=1/ec; for(let i=0;i<3;++i) v[i]=xx[i]+s*v[i];
      buffer[m]=positions.length; positions.push([v[0],v[1],v[2]]);
      for(let i=0;i<3;++i){ if(!(em&(1<<i))) continue; const iu=(i+1)%3, iv=(i+2)%3; if(xx[iu]===0||xx[iv]===0) continue;
        const du=R[iu],dv=R[iv];
        if(mask&1) cells.push([buffer[m],buffer[m-du],buffer[m-du-dv],buffer[m-dv]]); else cells.push([buffer[m],buffer[m-dv],buffer[m-du-dv],buffer[m-du]]); } } }
  return {positions,cells};
}

export function gaussianBlur3D(f, dims, sigma){
  const [nx,ny,nz]=dims, r=Math.max(1,Math.ceil(sigma*2.5)), ker=new Float32Array(2*r+1);
  let s=0; for(let k=-r;k<=r;k++){ const w=Math.exp(-(k*k)/(2*sigma*sigma)); ker[k+r]=w; s+=w; } for(let k=0;k<ker.length;k++) ker[k]/=s;
  const tmp=new Float32Array(f.length), clamp=(v,hi)=>v<0?0:v>=hi?hi-1:v;
  for(let z=0;z<nz;z++)for(let y=0;y<ny;y++){ const b=y*nx+z*nx*ny; for(let x=0;x<nx;x++){ let a=0; for(let k=-r;k<=r;k++) a+=f[b+clamp(x+k,nx)]*ker[k+r]; tmp[b+x]=a; } }
  for(let z=0;z<nz;z++)for(let x=0;x<nx;x++){ const b=x+z*nx*ny; for(let y=0;y<ny;y++){ let a=0; for(let k=-r;k<=r;k++) a+=tmp[b+clamp(y+k,ny)*nx]*ker[k+r]; f[b+y*nx]=a; } }
  for(let y=0;y<ny;y++)for(let x=0;x<nx;x++){ const b=x+y*nx; for(let z=0;z<nz;z++){ let a=0; for(let k=-r;k<=r;k++) a+=f[b+clamp(z+k,nz)*nx*ny]*ker[k+r]; tmp[b+z*nx*ny]=a; } }
  f.set(tmp);
}

function downsampleNii(nii,f){ const [nx,ny,nz]=nii.dim, nX=Math.ceil(nx/f),nY=Math.ceil(ny/f),nZ=Math.ceil(nz/f);
  const src=nii.data, dst=new Float32Array(nX*nY*nZ);
  for(let k=0;k<nZ;k++){ const sk=Math.min(nz-1,k*f)*nx*ny; for(let j=0;j<nY;j++){ const sj=Math.min(ny-1,j*f)*nx; const db=(k*nY+j)*nX; for(let i=0;i<nX;i++) dst[db+i]=src[Math.min(nx-1,i*f)+sj+sk]; } }
  return { data:dst, dim:[nX,nY,nZ], worldOf:(i,j,k)=>nii.worldOf(i*f,j*f,k*f) }; }
export function capNii(nii, budget){ const v=nii.dim[0]*nii.dim[1]*nii.dim[2]; if(v<=budget) return nii; const f=Math.max(2,Math.ceil(Math.cbrt(v/budget))); return downsampleNii(nii,f); }
