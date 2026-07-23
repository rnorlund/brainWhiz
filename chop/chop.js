// chop/chop.js — clean-room "inverse-normalization" label propagation for brainWhiz.
// Register subject -> MNI152, invert, resample an atlas's labels into the subject's native space.
// Dependency-free, DOM-free. Original implementations of standard, patent-free registration math
// (NMI/NCC metrics, gradient-free affine optimization). No ANTs/FSL/SPM/SynthMorph code or models.
//
// Volume shape: {data:TypedArray, dims:[nx,ny,nz], affine:[[..4],[..4],[..4],[0,0,0,1]]}
// where `affine` maps voxel (i,j,k,1) -> world/scanner mm (RAS). Index = i + nx*(j + ny*k).

// ---------- 4x4 matrix math (row-major number[16]) ----------
export function mul4(a,b){ const o=new Array(16);
  for(let r=0;r<4;r++)for(let c=0;c<4;c++){ let s=0; for(let k=0;k<4;k++) s+=a[r*4+k]*b[k*4+c]; o[r*4+c]=s; }
  return o; }
export function applyAffine(m, x,y,z){ return [
  m[0]*x+m[1]*y+m[2]*z+m[3], m[4]*x+m[5]*y+m[6]*z+m[7], m[8]*x+m[9]*y+m[10]*z+m[11] ]; }
export function invert4x4(m){ // general 4x4 inverse (Laplace expansion); returns number[16] or null
  const inv=new Array(16), a=m;
  inv[0]=a[5]*a[10]*a[15]-a[5]*a[11]*a[14]-a[9]*a[6]*a[15]+a[9]*a[7]*a[14]+a[13]*a[6]*a[11]-a[13]*a[7]*a[10];
  inv[4]=-a[4]*a[10]*a[15]+a[4]*a[11]*a[14]+a[8]*a[6]*a[15]-a[8]*a[7]*a[14]-a[12]*a[6]*a[11]+a[12]*a[7]*a[10];
  inv[8]=a[4]*a[9]*a[15]-a[4]*a[11]*a[13]-a[8]*a[5]*a[15]+a[8]*a[7]*a[13]+a[12]*a[5]*a[11]-a[12]*a[7]*a[9];
  inv[12]=-a[4]*a[9]*a[14]+a[4]*a[10]*a[13]+a[8]*a[5]*a[14]-a[8]*a[6]*a[13]-a[12]*a[5]*a[10]+a[12]*a[6]*a[9];
  inv[1]=-a[1]*a[10]*a[15]+a[1]*a[11]*a[14]+a[9]*a[2]*a[15]-a[9]*a[3]*a[14]-a[13]*a[2]*a[11]+a[13]*a[3]*a[10];
  inv[5]=a[0]*a[10]*a[15]-a[0]*a[11]*a[14]-a[8]*a[2]*a[15]+a[8]*a[3]*a[14]+a[12]*a[2]*a[11]-a[12]*a[3]*a[10];
  inv[9]=-a[0]*a[9]*a[15]+a[0]*a[11]*a[13]+a[8]*a[1]*a[15]-a[8]*a[3]*a[13]-a[12]*a[1]*a[11]+a[12]*a[3]*a[9];
  inv[13]=a[0]*a[9]*a[14]-a[0]*a[10]*a[13]-a[8]*a[1]*a[14]+a[8]*a[2]*a[13]+a[12]*a[1]*a[10]-a[12]*a[2]*a[9];
  inv[2]=a[1]*a[6]*a[15]-a[1]*a[7]*a[14]-a[5]*a[2]*a[15]+a[5]*a[3]*a[14]+a[13]*a[2]*a[7]-a[13]*a[3]*a[6];
  inv[6]=-a[0]*a[6]*a[15]+a[0]*a[7]*a[14]+a[4]*a[2]*a[15]-a[4]*a[3]*a[14]-a[12]*a[2]*a[7]+a[12]*a[3]*a[6];
  inv[10]=a[0]*a[5]*a[15]-a[0]*a[7]*a[13]-a[4]*a[1]*a[15]+a[4]*a[3]*a[13]+a[12]*a[1]*a[7]-a[12]*a[3]*a[5];
  inv[14]=-a[0]*a[5]*a[14]+a[0]*a[6]*a[13]+a[4]*a[1]*a[14]-a[4]*a[2]*a[13]-a[12]*a[1]*a[6]+a[12]*a[2]*a[5];
  inv[3]=-a[1]*a[6]*a[11]+a[1]*a[7]*a[10]+a[5]*a[2]*a[11]-a[5]*a[3]*a[10]-a[9]*a[2]*a[7]+a[9]*a[3]*a[6];
  inv[7]=a[0]*a[6]*a[11]-a[0]*a[7]*a[10]-a[4]*a[2]*a[11]+a[4]*a[3]*a[10]+a[8]*a[2]*a[7]-a[8]*a[3]*a[6];
  inv[11]=-a[0]*a[5]*a[11]+a[0]*a[7]*a[9]+a[4]*a[1]*a[11]-a[4]*a[3]*a[9]-a[8]*a[1]*a[7]+a[8]*a[3]*a[5];
  inv[15]=a[0]*a[5]*a[10]-a[0]*a[6]*a[9]-a[4]*a[1]*a[10]+a[4]*a[2]*a[9]+a[8]*a[1]*a[6]-a[8]*a[2]*a[5];
  let det=a[0]*inv[0]+a[1]*inv[4]+a[2]*inv[8]+a[3]*inv[12]; if(!det) return null; det=1/det;
  for(let i=0;i<16;i++) inv[i]*=det; return inv;
}
const affTo16 = a => a.length===16 ? a : [a[0][0],a[0][1],a[0][2],a[0][3], a[1][0],a[1][1],a[1][2],a[1][3], a[2][0],a[2][1],a[2][2],a[2][3], 0,0,0,1];

// ---------- resample an atlas label volume into a target grid ----------
// `xform16` maps TARGET world mm -> SOURCE(atlas) world mm (i.e. the inverse of subject->atlas).
// Nearest-neighbor keeps labels integer. Returns Int32Array on the target grid.
export function resampleLabels(atlas, target, xform16){
  const A16=affTo16(atlas.affine), T16=affTo16(target.affine);
  const Ainv=invert4x4(A16); if(!Ainv) throw new Error('atlas affine not invertible');
  const [ax,ay,az]=atlas.dims, [tx,ty,tz]=target.dims;
  const out=new Int32Array(tx*ty*tz);
  for(let k=0;k<tz;k++)for(let j=0;j<ty;j++)for(let i=0;i<tx;i++){
    const w=applyAffine(T16,i,j,k);                       // target voxel -> target world
    const s=applyAffine(xform16, w[0],w[1],w[2]);         // -> source world
    const v=applyAffine(Ainv, s[0],s[1],s[2]);            // -> atlas voxel
    const ai=Math.round(v[0]), aj=Math.round(v[1]), ak=Math.round(v[2]);
    if(ai<0||aj<0||ak<0||ai>=ax||aj>=ay||ak>=az) continue;
    out[i+tx*(j+ty*k)] = atlas.data[ai+ax*(aj+ay*ak)];
  }
  return out;
}

// center of mass of a volume in WORLD mm (intensity-weighted over a threshold)
function centerOfMass(vol){ const [nx,ny,nz]=vol.dims, A=affTo16(vol.affine), d=vol.data;
  let lo=Infinity,hi=-Infinity; for(let i=0;i<d.length;i++){ if(d[i]<lo)lo=d[i]; if(d[i]>hi)hi=d[i]; }
  const thr=lo+(hi-lo)*0.12; let sx=0,sy=0,sz=0,sw=0;
  for(let k=0;k<nz;k++)for(let j=0;j<ny;j++)for(let i=0;i<nx;i++){ const v=d[i+nx*(j+ny*k)]; if(v<=thr) continue;
    const w=applyAffine(A,i,j,k); sx+=w[0]*v; sy+=w[1]*v; sz+=w[2]*v; sw+=v; }
  return sw? [sx/sw,sy/sw,sz/sw] : [0,0,0];
}
// rough world-extent radius of the above-threshold region (for scale init)
function extentRadius(vol){ const [nx,ny,nz]=vol.dims, A=affTo16(vol.affine), d=vol.data;
  let lo=Infinity,hi=-Infinity; for(let i=0;i<d.length;i++){ if(d[i]<lo)lo=d[i]; if(d[i]>hi)hi=d[i]; }
  const thr=lo+(hi-lo)*0.12; const c=centerOfMass(vol); let s=0,n=0;
  for(let k=0;k<nz;k+=2)for(let j=0;j<ny;j+=2)for(let i=0;i<nx;i+=2){ if(d[i+nx*(j+ny*k)]<=thr) continue;
    const w=applyAffine(A,i,j,k); s+=(w[0]-c[0])**2+(w[1]-c[1])**2+(w[2]-c[2])**2; n++; }
  return n? Math.sqrt(s/n) : 1;
}
const eulerMat=(rx,ry,rz)=>{ const cx=Math.cos(rx),sx=Math.sin(rx),cy=Math.cos(ry),sy=Math.sin(ry),cz=Math.cos(rz),sz=Math.sin(rz);
  return [ cy*cz, -cy*sz, sy,  cx*sz+sx*sy*cz, cx*cz-sx*sy*sz, -sx*cy,  sx*sz-cx*sy*cz, sx*cz+cx*sy*sz, cx*cy ]; };  // 3x3 row-major

// NMI cost for a fixed→moving transform param set p=[tx,ty,tz,rx,ry,rz,logs], sampling the fixed grid
// at `stride`. cF/cM are fixed/moving centers of mass (world); Minv = inverse moving affine.
function nmiCost(p, fixed, moving, Minv, cF, cM, stride, bins=48){
  const [fx,fy,fz]=fixed.dims, F=affTo16(fixed.affine), fd=fixed.data, md=moving.data, [mx,my,mz]=moving.dims;
  const R=eulerMat(p[3],p[4],p[5]);
  // 12-DOF affine: A = R · K, with K upper-triangular = per-axis scale (exp) + shear. (7-DOF rigid+iso
  // can't fit a brain to MNI — poles/proportions drift, mislabeling frontal↔temporal.)
  const sx=Math.exp(p[6]), sy=Math.exp(p[7]), sz=Math.exp(p[8]), hxy=p[9], hxz=p[10], hyz=p[11];
  const HA=new Float64Array(bins), HB=new Float64Array(bins), HJ=new Float64Array(bins*bins);
  // intensity ranges (precomputed once by caller via fixed._lo etc.)
  const fl=fixed._lo, fs=(bins-1)/((fixed._hi-fl)||1), ml=moving._lo, ms=(bins-1)/((moving._hi-ml)||1);
  let n=0;
  for(let k=0;k<fz;k+=stride)for(let j=0;j<fy;j+=stride)for(let i=0;i<fx;i+=stride){
    const fv=fd[i+fx*(j+fy*k)]; if(fv<=fl) continue;                 // skip background of fixed
    const w=applyAffine(F,i,j,k), dx=w[0]-cF[0],dy=w[1]-cF[1],dz=w[2]-cF[2];
    const kx=sx*dx+hxy*dy+hxz*dz, ky=sy*dy+hyz*dz, kz=sz*dz;         // K·d
    const wx=cM[0]+p[0]+(R[0]*kx+R[1]*ky+R[2]*kz), wy=cM[1]+p[1]+(R[3]*kx+R[4]*ky+R[5]*kz), wz=cM[2]+p[2]+(R[6]*kx+R[7]*ky+R[8]*kz);
    const v=applyAffine(Minv, wx,wy,wz); const ix=v[0],iy=v[1],iz=v[2];
    if(ix<0||iy<0||iz<0||ix>=mx-1||iy>=my-1||iz>=mz-1) continue;
    const x0=ix|0,y0=iy|0,z0=iz|0, fxk=ix-x0,fyk=iy-y0,fzk=iz-z0;    // trilinear
    const idx=(a,b,c)=>a+mx*(b+my*c);
    const c00=md[idx(x0,y0,z0)]*(1-fxk)+md[idx(x0+1,y0,z0)]*fxk, c10=md[idx(x0,y0+1,z0)]*(1-fxk)+md[idx(x0+1,y0+1,z0)]*fxk;
    const c01=md[idx(x0,y0,z0+1)]*(1-fxk)+md[idx(x0+1,y0,z0+1)]*fxk, c11=md[idx(x0,y0+1,z0+1)]*(1-fxk)+md[idx(x0+1,y0+1,z0+1)]*fxk;
    const mv=(c00*(1-fyk)+c10*fyk)*(1-fzk)+(c01*(1-fyk)+c11*fyk)*fzk;
    let a=(fv-fl)*fs|0; if(a<0)a=0; if(a>=bins)a=bins-1; let b=(mv-ml)*ms|0; if(b<0)b=0; if(b>=bins)b=bins-1;
    HA[a]++; HB[b]++; HJ[a*bins+b]++; n++;
  }
  if(n<50) return 0;
  let Ha=0,Hb=0,Hab=0; for(let x=0;x<bins;x++){ if(HA[x]){const q=HA[x]/n;Ha-=q*Math.log(q);} if(HB[x]){const q=HB[x]/n;Hb-=q*Math.log(q);} }
  for(let i=0;i<HJ.length;i++) if(HJ[i]){const q=HJ[i]/n;Hab-=q*Math.log(q);}
  return Hab>0 ? (Ha+Hb)/Hab : 0;   // normalized MI, maximize
}

// ---- clean-room affine (rigid + isotropic scale, 7-DOF) registration: MOVING -> FIXED ----
// Returns { params, matrix, nmi } where matrix (16) maps FIXED world -> MOVING world (use its inverse
// for MOVING->FIXED / to resample moving into fixed). Multi-resolution coordinate descent on NMI.
export function registerAffine(moving, fixed, opts={}){
  const prep=v=>{ let lo=Infinity,hi=-Infinity; for(let i=0;i<v.data.length;i++){const x=v.data[i]; if(x<lo)lo=x; if(x>hi)hi=x;}
    v._lo=lo+(hi-lo)*0.06; v._hi=hi; };  // _lo doubles as a background cutoff
  prep(fixed); prep(moving);
  const Minv=invert4x4(affTo16(moving.affine)); if(!Minv) throw new Error('moving affine not invertible');
  const cF=centerOfMass(fixed), cM=centerOfMass(moving);
  const ls=Math.log((extentRadius(moving)/(extentRadius(fixed)||1))||1);
  // 12 params: tx,ty,tz, rx,ry,rz, log(sx),log(sy),log(sz), shear_xy,shear_xz,shear_yz.
  let p=[0,0,0, 0,0,0, ls,ls,ls, 0,0,0];
  // STAGE the DOF: rigid (translation+rotation) FIRST, so the head POSE — including a tilted head — is
  // locked before scale/shear can absorb the misalignment (which would leave the parcellation un-rotated
  // and mislabel across lobes). Then add anisotropic scale, then shear. Coarse→fine strides within each
  // stage; coordinate descent accepts only NMI-improving moves.
  const step=(mm,rad,sc,sh)=>[mm,mm,mm, rad,rad,rad, sc,sc,sc, sh,sh,sh];
  const descend=(dof, steps, stride, sweeps)=>{
    let best=nmiCost(p, fixed, moving, Minv, cF, cM, stride);
    for(let sweep=0; sweep<sweeps; sweep++){ let improved=false;
      for(let d=0; d<dof; d++){ for(const sgn of [1,-1]){ const q=p.slice(); q[d]+=sgn*steps[d];
        const c=nmiCost(q, fixed, moving, Minv, cF, cM, stride); if(c>best){ best=c; p=q; improved=true; } } }
      if(!improved){ for(let d=0;d<dof;d++) steps[d]*=0.5; if(steps[0]<0.25 && steps[3]<0.008) break; }
    }
  };
  descend(6,  step(12,0.20,0,0),        4, 40);   // rigid, coarse — recover the head tilt from a 0 start
  descend(6,  step(6, 0.10,0,0),        2, 30);   // rigid, medium
  descend(9,  step(4, 0.05,0.06,0),     2, 24);   // + anisotropic scale
  descend(12, step(2, 0.03,0.03,0.04),  1, 24);   // + shear, fine
  descend(12, step(1, 0.015,0.015,0.02),1, 18);   // finer
  // build FIXED->MOVING matrix: xM = cM + t + A(xF - cF), A = R·K, K = per-axis scale + upper-tri shear
  const R=eulerMat(p[3],p[4],p[5]);
  const sx=Math.exp(p[6]), sy=Math.exp(p[7]), sz=Math.exp(p[8]), hxy=p[9], hxz=p[10], hyz=p[11];
  const K=[sx,hxy,hxz, 0,sy,hyz, 0,0,sz];
  const A=[ R[0]*K[0]+R[1]*K[3]+R[2]*K[6], R[0]*K[1]+R[1]*K[4]+R[2]*K[7], R[0]*K[2]+R[1]*K[5]+R[2]*K[8],
            R[3]*K[0]+R[4]*K[3]+R[5]*K[6], R[3]*K[1]+R[4]*K[4]+R[5]*K[7], R[3]*K[2]+R[4]*K[5]+R[5]*K[8],
            R[6]*K[0]+R[7]*K[3]+R[8]*K[6], R[6]*K[1]+R[7]*K[4]+R[8]*K[7], R[6]*K[2]+R[7]*K[5]+R[8]*K[8] ];
  const M=[ A[0],A[1],A[2], cM[0]+p[0]-(A[0]*cF[0]+A[1]*cF[1]+A[2]*cF[2]),
            A[3],A[4],A[5], cM[1]+p[1]-(A[3]*cF[0]+A[4]*cF[1]+A[5]*cF[2]),
            A[6],A[7],A[8], cM[2]+p[2]-(A[6]*cF[0]+A[7]*cF[1]+A[8]*cF[2]), 0,0,0,1 ];
  return { params:p, matrix:M, nmi: nmiCost(p, fixed, moving, Minv, cF, cM, 1) };
}

// Normalized mutual information between two equal-length samples (bins histograms) — metric for
// the registration optimizer above. Higher = better aligned. (Implemented ahead of the optimizer.)
export function nmi(a, b, bins=64){
  let alo=Infinity,ahi=-Infinity,blo=Infinity,bhi=-Infinity;
  for(let i=0;i<a.length;i++){ if(a[i]<alo)alo=a[i]; if(a[i]>ahi)ahi=a[i]; if(b[i]<blo)blo=b[i]; if(b[i]>bhi)bhi=b[i]; }
  const asc=(bins-1)/((ahi-alo)||1), bsc=(bins-1)/((bhi-blo)||1);
  const hj=new Float64Array(bins*bins), ha=new Float64Array(bins), hb=new Float64Array(bins);
  const n=a.length; for(let i=0;i<n;i++){ const x=(a[i]-alo)*asc|0, y=(b[i]-blo)*bsc|0; hj[x*bins+y]++; ha[x]++; hb[y]++; }
  let Ha=0,Hb=0,Hab=0;
  for(let x=0;x<bins;x++){ if(ha[x]){ const p=ha[x]/n; Ha-=p*Math.log(p); } if(hb[x]){ const p=hb[x]/n; Hb-=p*Math.log(p); } }
  for(let i=0;i<hj.length;i++){ if(hj[i]){ const p=hj[i]/n; Hab-=p*Math.log(p); } }
  return Hab>0 ? (Ha+Hb)/Hab : 0;   // normalized MI (Studholme): 1 when independent, higher when aligned
}
