// bet/bias.js — clean-room MRI bias-field (intensity inhomogeneity) correction.
// The same tissue drifts in intensity across the image (esp. at the periphery), which breaks global
// thresholds/k-means — a big cause of edge/inferior extraction errors. We iteratively estimate a
// SMOOTH multiplicative field that makes each tissue class uniform, and divide it out. Original
// implementation (simplified N3): no third-party code. Dependency-free.
import { kmeans } from './tissue.js';

// fast separable ~Gaussian via 3 box-blur passes (O(N) per axis via a running window sum)
function blur3D(data, dims, r, passes=3){
  const [nx,ny,nz]=dims; let a=Float32Array.from(data);
  for(let p=0;p<passes;p++){
    // X
    let b=new Float32Array(a.length);
    for(let z=0;z<nz;z++)for(let y=0;y<ny;y++){ const row=nx*(y+ny*z); let s=0;
      for(let x=0;x<=r&&x<nx;x++) s+=a[row+x]; for(let x=0;x<nx;x++){ b[row+x]=s/( Math.min(nx-1,x+r)-Math.max(0,x-r)+1 );
        const add=x+r+1, rem=x-r; if(add<nx)s+=a[row+add]; if(rem>=0)s-=a[row+rem]; } }
    a=b;
    // Y
    b=new Float32Array(a.length);
    for(let z=0;z<nz;z++)for(let x=0;x<nx;x++){ const col=x+nx*ny*z; let s=0;
      for(let y=0;y<=r&&y<ny;y++) s+=a[col+nx*y]; for(let y=0;y<ny;y++){ b[col+nx*y]=s/( Math.min(ny-1,y+r)-Math.max(0,y-r)+1 );
        const add=y+r+1, rem=y-r; if(add<ny)s+=a[col+nx*add]; if(rem>=0)s-=a[col+nx*rem]; } }
    a=b;
    // Z
    b=new Float32Array(a.length);
    for(let y=0;y<ny;y++)for(let x=0;x<nx;x++){ const col=x+nx*y; const st=nx*ny; let s=0;
      for(let z=0;z<=r&&z<nz;z++) s+=a[col+st*z]; for(let z=0;z<nz;z++){ b[col+st*z]=s/( Math.min(nz-1,z+r)-Math.max(0,z-r)+1 );
        const add=z+r+1, rem=z-r; if(add<nz)s+=a[col+st*add]; if(rem>=0)s-=a[col+st*rem]; } }
    a=b;
  }
  return a;
}

// Correct bias. opts: { iters=4, radius=(auto ~ 0.25*min-dim), classes=4 }
export function biasCorrect(data, dims, opts={}){
  const [nx,ny,nz]=dims; const r=opts.radius|| Math.max(6, Math.round(Math.min(nx,ny,nz)*0.22));
  const iters=opts.iters??4, K=opts.classes??4;
  // foreground (head): above a low fraction of the max
  let hi=0; for(let i=0;i<data.length;i++) if(data[i]>hi) hi=data[i];
  const fg=new Uint8Array(data.length); for(let i=0;i<data.length;i++) fg[i]= data[i]>0.08*hi?1:0;
  let work=Float32Array.from(data), field=new Float32Array(data.length).fill(1);
  for(let it=0;it<iters;it++){
    const { labels, centroids }=kmeans(work, fg, K, 8);
    // ratio = observed / class-mean (≈ local bias); 1 in background so blur is neutral there
    const ratio=new Float32Array(data.length);
    for(let i=0;i<data.length;i++){ if(fg[i] && labels[i]){ const c=centroids[labels[i]-1]; ratio[i]= c>1? work[i]/c : 1; } else ratio[i]=1; }
    let b=blur3D(ratio, dims, r, 3);
    // normalize to mean 1 over foreground so we don't change global scale
    let s=0,n=0; for(let i=0;i<data.length;i++) if(fg[i]){ s+=b[i]; n++; } const mean=n? s/n:1;
    for(let i=0;i<data.length;i++){ const bf=(b[i]/mean)||1; if(fg[i] && bf>0.2){ work[i]/=bf; field[i]*=bf; } }
  }
  return { corrected:work, field, fg };
}
