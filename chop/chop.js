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

// ---------- affine registration subject -> reference (SCAFFOLD) ----------
// Plan: multi-resolution (downsample pyramid); parameterize a 12-DOF affine as
// translation(3) + rotation(3, Euler) + scale(3) + shear(3); maximize normalized mutual
// information between resampled subject and reference via Nelder-Mead / Powell (gradient-free).
// Returns a 16-element affine mapping subject world -> reference world.
export function registerAffine(subject, reference, opts={}){
  throw new Error('registerAffine: not implemented yet — see chop/README.md pipeline. '+
    'Deterministic pieces (invert4x4, resampleLabels) are ready; the NMI + optimizer is the next build step.');
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
