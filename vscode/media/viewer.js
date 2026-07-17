// brainWhiz .nii viewer — webview. Ortho slices (window/level, crosshair, orientation labels) +
// a 3D Surface-Nets render with: a live isosurface-level "peel" (skin → skull → brain), wireframe,
// auto-rotate, face-forward reset, and a movable axial CUT plane that slices into the head and shows
// the real MRI slice inside (clipping plane + texture-mapped axial slice).
import * as THREE from './three.module.js';
import { OrbitControls } from './OrbitControls.js';
import { parseNifti, surfaceNets, gaussianBlur3D, capNii } from './nifti.js';

const S = window.NII;                       // { uri, name } injected by the extension
const $ = id => document.getElementById(id);
let nii, cross, win, lev, lo2, hi98;
let cmap = 'gray', showCross = true, thrFrac = 0.12;   // view state
let ovNii = null, ovOn = false, ovCmap = 'hot', ovThrFrac = 0.20, ovHi = 1, ovOp = 0.80;   // stat-map overlay

(async function(){
  try{
    const buf = await loadBytes(S.uri, S.name);
    nii = parseNifti(buf);
    initStats(); initUI(); renderAll(); build3D();
    $('status').textContent = `${S.name}  ·  ${nii.dim.join('×')}  ·  ${nii.vox.map(v=>v.toFixed(2)).join('×')} mm` + (nii.nt>1?`  ·  ${nii.nt} frames`:'');
  }catch(e){ $('status').textContent = 'Failed to load: ' + (e && e.message || e); console.error(e); }
})();

async function loadBytes(uri, name){
  let ab = await (await fetch(uri)).arrayBuffer();
  if(/\.gz$/i.test(name)){                   // gunzip via the built-in DecompressionStream (no pako/CDN)
    const st = new Blob([new Uint8Array(ab)]).stream().pipeThrough(new DecompressionStream('gzip'));
    ab = await new Response(st).arrayBuffer();
  }
  return ab;
}

function initStats(){
  const d = nii.data, N = d.length; const samp = [];
  for(let i=0;i<N;i+=Math.max(1,(N/200000)|0)){ const v=d[i]; if(v>0||v<0) samp.push(v); }
  samp.sort((a,b)=>a-b);
  lo2  = samp[Math.floor(samp.length*0.02)] ?? 0;
  hi98 = samp[Math.floor(samp.length*0.98)] ?? 1;
  if(hi98<=lo2) hi98 = lo2 + 1;
  lev = (lo2+hi98)/2; win = (hi98-lo2);
  cross = [nii.dim[0]>>1, nii.dim[1]>>1, nii.dim[2]>>1];
}

// ---------- colormaps (piecewise-linear LUTs; matplotlib-style) ----------
const lut = stops => t => { t = t<0?0:t>1?1:t;
  for(let i=1;i<stops.length;i++){ if(t<=stops[i][0]){ const a=stops[i-1], b=stops[i], f=(t-a[0])/((b[0]-a[0])||1);
    return [a[1]+(b[1]-a[1])*f, a[2]+(b[2]-a[2])*f, a[3]+(b[3]-a[3])*f]; } }
  const l=stops[stops.length-1]; return [l[1],l[2],l[3]]; };
const CMAPS = {
  gray:      lut([[0,0,0,0],[1,255,255,255]]),
  'gray-inv':lut([[0,255,255,255],[1,0,0,0]]),
  bone:      lut([[0,0,0,0],[0.5,84,100,124],[1,255,255,255]]),
  hot:       lut([[0,0,0,0],[0.33,230,0,0],[0.66,255,220,0],[1,255,255,255]]),
  viridis:   lut([[0,68,1,84],[0.25,59,82,139],[0.5,33,145,140],[0.75,94,201,98],[1,253,231,37]]),
  inferno:   lut([[0,0,0,4],[0.25,87,16,110],[0.5,188,55,84],[0.75,249,142,9],[1,252,255,164]]),
  magma:     lut([[0,0,0,4],[0.25,81,18,124],[0.5,183,55,121],[0.75,252,137,97],[1,252,253,191]]),
  plasma:    lut([[0,13,8,135],[0.25,126,3,168],[0.5,204,71,120],[0.75,248,149,64],[1,240,249,33]]),
  turbo:     lut([[0,48,18,59],[0.2,70,134,251],[0.4,38,214,142],[0.6,175,240,39],[0.8,255,123,29],[1,122,4,3]]),
  jet:       lut([[0,0,0,131],[0.125,0,60,170],[0.375,5,255,255],[0.625,255,255,0],[0.875,250,0,0],[1,128,0,0]]),
  cividis:   lut([[0,0,32,76],[0.25,47,73,102],[0.5,124,123,120],[0.75,186,176,120],[1,255,233,69]]),
};

// ---------- stat-map overlay (a 2nd volume, resampled onto the base grid via world coords) ----------
function computeOvStats(){ const d=ovNii.data, N=d.length, s=[];
  for(let i=0;i<N;i+=Math.max(1,(N/150000)|0)){ const v=Math.abs(d[i]); if(v>0) s.push(v); }
  s.sort((a,b)=>a-b); ovHi=s[Math.floor(s.length*0.98)]||1; if(ovHi<=0) ovHi=1; }
function ovSample(i,j,k){ const w=nii.worldOf(i,j,k), M=ovNii.Minv, T=ovNii.T;   // base voxel -> world -> overlay voxel
  const dx=w[0]-T[0], dy=w[1]-T[1], dz=w[2]-T[2];
  const oi=Math.round(M[0]*dx+M[1]*dy+M[2]*dz), oj=Math.round(M[3]*dx+M[4]*dy+M[5]*dz), ok=Math.round(M[6]*dx+M[7]*dy+M[8]*dz);
  const [ox,oy,oz]=ovNii.dim; if(oi<0||oj<0||ok<0||oi>=ox||oj>=oy||ok>=oz) return NaN;
  return ovNii.data[oi+oj*ox+ok*ox*oy]; }
function ovBlend(D,o,i,j,k){ if(!ovOn||!ovNii) return; const ov=ovSample(i,j,k); if(ov!==ov) return;   // NaN -> skip
  const av=Math.abs(ov), thr=ovThrFrac*ovHi; if(av<=thr) return;
  let t=(av-thr)/((ovHi-thr)||1); t=t<0?0:t>1?1:t;
  const [R,G,B]=(CMAPS[ovCmap]||CMAPS.hot)(t), a=ovOp;
  D[o]=D[o]*(1-a)+R*a; D[o+1]=D[o+1]*(1-a)+G*a; D[o+2]=D[o+2]*(1-a)+B*a; }

// ---------- orientation ----------
const AXL = [['R','L'],['A','P'],['S','I']];       // world axis -> [+dir, -dir]
function letterFor(vaxis, sign){                    // anatomical letter for +/- of a voxel axis (robust to any affine)
  const M=nii.M, col=[M[vaxis],M[3+vaxis],M[6+vaxis]];
  let d=0,best=Math.abs(col[0]); for(let k=1;k<3;k++){ const a=Math.abs(col[k]); if(a>best){best=a;d=k;} }
  const positive = (col[d]>=0)===(sign>0); return AXL[d][positive?0:1];
}
function drawLabel(ctx, txt, x, y, align){
  ctx.save(); ctx.font='bold 12px ui-monospace,Menlo,monospace'; ctx.textAlign=align||'center'; ctx.textBaseline='middle';
  ctx.shadowColor='rgba(0,0,0,.95)'; ctx.shadowBlur=4; ctx.fillStyle='#8fd3ff'; ctx.fillText(txt,x,y); ctx.restore();
}

// ---------- slice rendering ----------
// plane 0=axial (k fixed), 1=coronal (j fixed), 2=sagittal (i fixed)
const PLANES = [
  { id:'axi', fixed:2, ha:0, va:1, name:'Axial' },      // width=x, height=y
  { id:'cor', fixed:1, ha:0, va:2, name:'Coronal' },    // width=x, height=z
  { id:'sag', fixed:0, ha:1, va:2, name:'Sagittal' },   // width=y, height=z
];

// draw an axial slice (k) into an offscreen canvas at native voxel res (for the 3D cut texture)
function axialSliceCanvas(k){
  const [nx,ny]=nii.dim, d=nii.data, nxny=nx*ny;
  const cv=document.createElement('canvas'); cv.width=nx; cv.height=ny; const ctx=cv.getContext('2d');
  const img=ctx.createImageData(nx,ny), D=img.data; const cm=CMAPS[cmap]||CMAPS.gray; const a=lev-win/2, span=win||1;
  for(let rr=0;rr<ny;rr++){ const j=ny-1-rr;                    // top row = max j (anterior for RAS)
    for(let c=0;c<nx;c++){ const v=d[c+j*nx+k*nxny]; let t=(v-a)/span; t=t<0?0:t>1?1:t;
      const [R,G,B]=cm(t); const o=(rr*nx+c)*4; D[o]=R;D[o+1]=G;D[o+2]=B;D[o+3]=255; ovBlend(D,o,c,j,k); } }
  ctx.putImageData(img,0,0); return cv;
}

function drawSlice(p){
  const cv = $('cv_'+p.id), ctx = cv.getContext('2d'); const [nx,ny,nz]=nii.dim, d=nii.data;
  const wdim = nii.dim[p.ha], hdim = nii.dim[p.va]; const s = cross[p.fixed];
  const img = ctx.createImageData(wdim, hdim), D = img.data;
  const cm = CMAPS[cmap]||CMAPS.gray; const a = lev - win/2, span = win||1;
  for(let r=0;r<hdim;r++){ const hv = hdim-1-r;                    // flip vertical (superior/anterior up)
    for(let c=0;c<wdim;c++){
      let i,j,k;
      if(p.fixed===2){ i=c; j=hv; k=s; } else if(p.fixed===1){ i=c; j=s; k=hv; } else { i=s; j=c; k=hv; }
      const v = d[i + j*nx + k*nx*ny];
      let t = (v - a)/span; t = t<0?0:t>1?1:t;
      const [R,G,B] = cm(t); const o=(r*wdim+c)*4; D[o]=R; D[o+1]=G; D[o+2]=B; D[o+3]=255; ovBlend(D,o,i,j,k);
    } }
  // scale to the canvas preserving physical aspect (voxel size)
  const aspW = wdim*nii.vox[p.ha], aspH = hdim*nii.vox[p.va];
  const off = document.createElement('canvas'); off.width=wdim; off.height=hdim; off.getContext('2d').putImageData(img,0,0);
  const cw=cv.clientWidth, ch=cv.clientHeight, dpr=Math.min(2,window.devicePixelRatio||1);
  cv.width=cw*dpr; cv.height=ch*dpr; ctx.setTransform(dpr,0,0,dpr,0,0); ctx.imageSmoothingEnabled=false;
  ctx.fillStyle='#000'; ctx.fillRect(0,0,cw,ch);
  const sc = Math.min(cw/aspW, ch/aspH)*0.92, dw=aspW*sc, dh=aspH*sc, dx=(cw-dw)/2, dy=(ch-dh)/2;
  ctx.drawImage(off, 0,0,wdim,hdim, dx,dy,dw,dh);
  // crosshair
  if(showCross){
    const hc = cross[p.ha], vc = cross[p.va];
    const cx = dx + (hc+0.5)/wdim*dw, cy = dy + (hdim-1-vc+0.5)/hdim*dh;
    ctx.strokeStyle='rgba(90,200,255,.7)'; ctx.lineWidth=1;
    ctx.beginPath(); ctx.moveTo(dx,cy); ctx.lineTo(dx+dw,cy); ctx.moveTo(cx,dy); ctx.lineTo(cx,dy+dh); ctx.stroke();
  }
  // anatomical orientation labels
  const mx=dx+dw/2, my=dy+dh/2;
  drawLabel(ctx, letterFor(p.va,+1), mx, dy+11, 'center');       // top
  drawLabel(ctx, letterFor(p.va,-1), mx, dy+dh-11, 'center');    // bottom
  drawLabel(ctx, letterFor(p.ha,-1), dx+10, my, 'left');         // left
  drawLabel(ctx, letterFor(p.ha,+1), dx+dw-10, my, 'right');     // right
  cv._geom = {dx,dy,dw,dh,wdim,hdim,p};
}
function renderAll(){ for(const p of PLANES) drawSlice(p); updateReadout(); }
function updateReadout(){ const [i,j,k]=cross; const w=nii.worldOf(i,j,k).map(x=>Math.round(x));
  const v = nii.data[i + j*nii.dim[0] + k*nii.dim[0]*nii.dim[1]];
  $('readout').textContent = `voxel [${i}, ${j}, ${k}]  ·  world ${w.join(', ')} mm  ·  value ${(+v).toFixed(2)}`; }

function pickOnSlice(cv, ev){ const g=cv._geom; if(!g) return; const r=cv.getBoundingClientRect();
  const x=(ev.clientX-r.left)-g.dx, y=(ev.clientY-r.top)-g.dy; if(x<0||y<0||x>g.dw||y>g.dh) return;
  const hc=Math.floor(x/g.dw*g.wdim), vc=g.hdim-1-Math.floor(y/g.dh*g.hdim);
  cross[g.p.ha]=Math.max(0,Math.min(g.wdim-1,hc)); cross[g.p.va]=Math.max(0,Math.min(g.hdim-1,vc));
  syncSliders(); renderAll(); if(cutOn) updateCut();
}

// ---------- UI ----------
let rebuildTimer;
function scheduleRebuild(){ clearTimeout(rebuildTimer); rebuildTimer=setTimeout(build3D, 130); }  // debounce peel drags
function setAxial(k){ cross[2]=Math.max(0,Math.min(nii.dim[2]-1,k|0)); syncSliders(); renderAll(); if(cutOn) updateCut(); }
function initUI(){
  for(const p of PLANES){ const cv=$('cv_'+p.id);
    cv.addEventListener('pointerdown', e=>{ pickOnSlice(cv,e); const mv=ev=>pickOnSlice(cv,ev); const up=()=>{removeEventListener('pointermove',mv);removeEventListener('pointerup',up);}; addEventListener('pointermove',mv); addEventListener('pointerup',up); });
    cv.addEventListener('wheel', e=>{ e.preventDefault(); const nk=cross[p.fixed]+(e.deltaY<0?1:-1);
      if(p.fixed===2){ setAxial(nk); } else { cross[p.fixed]=Math.max(0,Math.min(nii.dim[p.fixed]-1,nk)); syncSliders(); renderAll(); } }, {passive:false});
  }
  const mk=(id,max,plane)=>{ const el=$(id); el.max=max-1; el.value=cross[plane]; };
  mk('sl_axi', nii.dim[2], 2); mk('sl_cor', nii.dim[1], 1); mk('sl_sag', nii.dim[0], 0);
  $('sl_axi').oninput = e=>setAxial(+e.target.value);
  $('sl_cor').oninput = e=>{ cross[1]=+e.target.value; renderAll(); };
  $('sl_sag').oninput = e=>{ cross[0]=+e.target.value; renderAll(); };
  $('winr').oninput = e=>{ win = Math.max(1e-3, (hi98-lo2) * (+e.target.value/100)*2); renderAll(); if(cutOn) updateCut(); };
  $('levr').oninput = e=>{ lev = lo2 + (hi98-lo2) * (+e.target.value/100); renderAll(); if(cutOn) updateCut(); };
  $('cmap').onchange = e=>{ cmap = e.target.value; renderAll(); if(cutOn) updateCut(); };
  $('xhairBtn').onclick = e=>{ showCross=!showCross; e.currentTarget.classList.toggle('active',showCross); renderAll(); };
  // stat-map overlay: pick a 2nd .nii, blend it colored on the slices + 3D cut
  $('ovBtn').onclick = ()=> $('ovFile').click();
  $('ovFile').onchange = async e=>{ const f=e.target.files&&e.target.files[0]; if(!f) return;
    try{ let ab=await f.arrayBuffer();
      if(/\.gz$/i.test(f.name)){ const st=new Blob([new Uint8Array(ab)]).stream().pipeThrough(new DecompressionStream('gzip')); ab=await new Response(st).arrayBuffer(); }
      ovNii=parseNifti(ab); computeOvStats(); ovOn=true;
      $('ovGroup').style.display='inline-flex'; $('ovBtn').classList.add('active'); $('ovBtn').textContent='Overlay: '+f.name.replace(/\.(nii|gz)$/gi,'').slice(0,14);
      renderAll(); if(cutOn) updateCut();
    }catch(err){ $('status').textContent='Overlay failed: '+(err&&err.message||err); }
    e.target.value=''; };
  $('ovCmap').onchange = e=>{ ovCmap=e.target.value; renderAll(); if(cutOn) updateCut(); };
  $('ovThr').oninput = e=>{ ovThrFrac=+e.target.value/100; renderAll(); if(cutOn) updateCut(); };
  $('ovOp').oninput = e=>{ ovOp=+e.target.value/100; renderAll(); if(cutOn) updateCut(); };
  $('ovClear').onclick = ()=>{ ovOn=false; ovNii=null; $('ovGroup').style.display='none'; $('ovBtn').classList.remove('active'); $('ovBtn').textContent='+ Overlay'; renderAll(); if(cutOn) updateCut(); };
  if(nii.nt>1){ const f=$('framewrap'); f.style.display='flex'; const fr=$('frame'); fr.max=nii.nt-1;
    fr.oninput=e=>{ nii.setFrame(+e.target.value); $('frameV').textContent=nii.frame; initStats(); syncSliders(); renderAll(); build3D(); }; }
  // 3D controls
  $('thr3d').oninput = e=>{ thrFrac = +e.target.value/100; scheduleRebuild(); };
  $('wire3d').onclick = e=>{ wire=!wire; e.currentTarget.classList.toggle('active',wire); if(mesh) mesh.material.wireframe=wire; };
  $('spin3d').onclick = e=>{ const on=!(controls&&controls.autoRotate); if(controls) controls.autoRotate=on; e.currentTarget.classList.toggle('active',on); };
  $('face3d').onclick = faceView;
  $('cut3d').onclick = e=>{ setCut(!cutOn); e.currentTarget.classList.toggle('active',cutOn); };
  const cl=$('cutlev3d'); cl.max=nii.dim[2]-1; cl.value=cross[2]; cl.oninput=e=>setAxial(+e.target.value);
  const vscodeApi = (typeof acquireVsCodeApi!=='undefined') ? acquireVsCodeApi() : null;   // present only inside VS Code
  $('openFull')?.addEventListener('click', ()=> vscodeApi
    ? vscodeApi.postMessage({cmd:'openFull'})
    : window.open('https://rnorlund.github.io/brainWhiz/','_blank'));
  $('hdrBtn').onclick = ()=>$('hdrpanel').classList.toggle('open');
  $('hdrClose').onclick = ()=>$('hdrpanel').classList.remove('open');
  $('hdrCopy').onclick = ()=>{ navigator.clipboard?.writeText(headerText()); $('hdrCopy').textContent='Copied'; setTimeout(()=>$('hdrCopy').textContent='Copy',1200); };
  renderHeader();
  addEventListener('resize', renderAll);
}
function syncSliders(){ $('sl_axi').value=cross[2]; $('sl_cor').value=cross[1]; $('sl_sag').value=cross[0]; const c=$('cutlev3d'); if(c) c.value=cross[2]; }

// ---------- NIfTI header details ----------
function headerRows(){ const h=nii.header; return [
  ['File', S.name], ['Dimensions', h.dims.join(' × ')], ['Voxel size (mm)', h.voxelSizeMM.join(' × ')],
  ['Data type', h.datatype], ['Bits / voxel', h.bitpix], ['Orientation', h.orientation],
  ['Space units', h.spaceUnits], ['Frames (4D)', nii.nt], ['Time step', h.timeStep + ' ' + h.timeUnits],
  ['sform', h.sformCode], ['qform', h.qformCode], ['scl slope / inter', h.sclSlope + ' / ' + h.sclInter],
  ['cal min / max', h.calMin + ' / ' + h.calMax], ['Intent', h.intent + (h.intentName?` "${h.intentName}"`:'')],
  ['Description', h.description || '—'], ['Aux file', h.auxFile || '—'], ['Magic', h.magic],
  ['Byte order', h.byteOrder], ['Vox offset', h.voxOffset],
]; }
function affineText(){ return nii.header.affine.map(r=>r.map(x=>String(x).padStart(10)).join('')).join('\n'); }
function headerText(){ return headerRows().map(([k,v])=>`${k}: ${v}`).join('\n') + '\n\nAffine (voxel→world mm):\n' + affineText(); }
function renderHeader(){ const el=$('hdrbody'); if(!el) return;
  el.innerHTML = headerRows().map(([k,v])=>`<div class="hk">${k}</div><div class="hv">${v}</div>`).join('')
    + `<div class="hk">Affine</div><div class="hv"><pre>${affineText()}</pre></div>`;
}

// ---------- 3D Surface-Nets ----------
let renderer, scene, camera, controls, mesh, raf, wire=false, curR=120, didFrame=false;
let cutOn=false, sliceMesh=null, meshC=[0,0,0];
const clipPlane = new THREE.Plane(new THREE.Vector3(0,-1,0), 1e9);   // keeps y <= constant; starts inert
function faceView(){ if(!camera) return; const R=curR;
  camera.position.set(R*0.35, R*0.30, -R*2.9); camera.near=R*0.05; camera.far=R*14; camera.updateProjectionMatrix();
  controls.target.set(0,0,0); controls.update(); }
function cutView(){ if(!camera) return; const R=curR;   // elevated front view — looks down into the axial opening
  camera.position.set(R*0.5, R*2.0, -R*2.2); camera.near=R*0.05; camera.far=R*16; camera.updateProjectionMatrix();
  controls.target.set(0, clipPlane.constant*0.6, 0); controls.update(); }

// place/refresh the axial cut: clip the head above the slice, show the real MRI at the cut
function updateCut(){
  if(!scene) return;
  const k=cross[2], [nx,ny]=nii.dim;
  const yCut = nii.worldOf(nx>>1, ny>>1, k)[2] - meshC[1];
  clipPlane.constant = yCut;
  const corner=(i,j)=>{ const w=nii.worldOf(i,j,k); return [w[0]-meshC[0], w[2]-meshC[1], -w[1]-meshC[2]]; }; // centered tjs
  const c00=corner(0,ny-1), c10=corner(nx-1,ny-1), c11=corner(nx-1,0), c01=corner(0,0);
  const positions=new Float32Array([...c00,...c10,...c11,...c01]);
  const tex=new THREE.CanvasTexture(axialSliceCanvas(k)); tex.minFilter=THREE.LinearFilter; tex.magFilter=THREE.LinearFilter;
  if('SRGBColorSpace' in THREE) tex.colorSpace=THREE.SRGBColorSpace;
  if(!sliceMesh){
    const g=new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(positions,3));
    g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array([0,1, 1,1, 1,0, 0,0]),2));
    g.setIndex([0,1,2, 0,2,3]);
    sliceMesh=new THREE.Mesh(g, new THREE.MeshBasicMaterial({map:tex, side:THREE.DoubleSide}));
    scene.add(sliceMesh);
  } else {
    sliceMesh.geometry.setAttribute('position', new THREE.BufferAttribute(positions,3));
    sliceMesh.geometry.attributes.position.needsUpdate=true; sliceMesh.geometry.computeBoundingSphere();
    sliceMesh.material.map.dispose(); sliceMesh.material.map=tex; sliceMesh.material.needsUpdate=true;
  }
  sliceMesh.visible=true;
}
function setCut(on){ cutOn=on;
  if(mesh){ mesh.material.clippingPlanes = on?[clipPlane]:null; mesh.material.needsUpdate=true; }
  if(on){ updateCut(); cutView(); }               // reveal: tilt to look down into the opening
  else { if(sliceMesh) sliceMesh.visible=false; faceView(); }
}

function build3D(){
  const host = $('view3d'); const budget = 2_000_000;
  const v = capNii({data:nii.data, dim:nii.dim, worldOf:nii.worldOf}, budget);
  const [nx,ny,nz]=v.dim, d=v.data;
  const thr = lo2 + (hi98-lo2)*thrFrac;
  let x0=nx,y0=ny,z0=nz,x1=-1,y1=-1,z1=-1,cnt=0;
  for(let k=0;k<nz;k++)for(let j=0;j<ny;j++){ const b=(k*ny+j)*nx; for(let i=0;i<nx;i++){ if(d[b+i]>thr){ cnt++; if(i<x0)x0=i;if(i>x1)x1=i;if(j<y0)y0=j;if(j>y1)y1=j;if(k<z0)z0=k;if(k>z1)z1=k; } } }
  const hint = m => { host.querySelector('.hint3d')?.remove(); const el=document.createElement('div'); el.className='hint3d'; el.textContent=m; host.appendChild(el); };
  if(cnt<50){ hint('No surface at this level'); if(mesh){ scene.remove(mesh); mesh.geometry.dispose(); mesh=null; } return; }
  const PAD=3, bw=x1-x0+1,bh=y1-y0+1,bd=z1-z0+1, fw=bw+2*PAD,fh=bh+2*PAD,fd=bd+2*PAD, occ=new Float32Array(fw*fh*fd);
  for(let z=0;z<bd;z++)for(let y=0;y<bh;y++)for(let x=0;x<bw;x++){ if(d[(x0+x)+(y0+y)*nx+(z0+z)*nx*ny]>thr) occ[(x+PAD)+(y+PAD)*fw+(z+PAD)*fw*fh]=1; }
  gaussianBlur3D(occ,[fw,fh,fd],1.1);
  const field=new Float32Array(occ.length); for(let i=0;i<occ.length;i++) field[i]=0.5-occ[i];
  const sn=surfaceNets(field,[fw,fh,fd]); if(!sn.positions.length){ return; }
  const tjs=(i,jj,k)=>{ const w=v.worldOf(i,jj,k); return [w[0],w[2],-w[1]]; };   // world -> three.js axes
  const vmap=sn.positions.map(p=>tjs(x0-PAD+p[0], y0-PAD+p[1], z0-PAD+p[2]));
  const pos=[]; for(const c of sn.cells){ const a=vmap[c[0]],b=vmap[c[1]],dd=vmap[c[2]],f=vmap[c[3]];
    pos.push(a[0],a[1],a[2],b[0],b[1],b[2],dd[0],dd[1],dd[2], a[0],a[1],a[2],dd[0],dd[1],dd[2],f[0],f[1],f[2]); }
  let cx=0,cy=0,cz=0; for(const p of vmap){ cx+=p[0];cy+=p[1];cz+=p[2]; } const n2=vmap.length||1; cx/=n2;cy/=n2;cz/=n2;
  meshC=[cx,cy,cz];
  const pa=new Float32Array(pos); for(let i=0;i<pa.length;i+=3){ pa[i]-=cx;pa[i+1]-=cy;pa[i+2]-=cz; }
  const geo=new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.BufferAttribute(pa,3)); geo.computeVertexNormals();

  if(!renderer){
    renderer=new THREE.WebGLRenderer({antialias:true, alpha:true}); renderer.setPixelRatio(Math.min(2,window.devicePixelRatio||1));
    renderer.localClippingEnabled=true;
    host.appendChild(renderer.domElement);
    scene=new THREE.Scene();
    camera=new THREE.PerspectiveCamera(45, 1, 1, 5000);
    controls=new OrbitControls(camera, renderer.domElement); controls.enableDamping=true; controls.autoRotateSpeed=2.4;
    scene.add(new THREE.HemisphereLight(0xffffff,0x334455,1.1));
    const dl=new THREE.DirectionalLight(0xffffff,0.6); dl.position.set(1,1,1); scene.add(dl);
    const resize3d=()=>{ const w=host.clientWidth,h=host.clientHeight; renderer.setSize(w,h,false); camera.aspect=w/h; camera.updateProjectionMatrix(); };
    addEventListener('resize', resize3d); resize3d();
    (function loop(){ raf=requestAnimationFrame(loop); controls.update(); renderer.render(scene,camera); })();
  }
  host.querySelector('.hint3d')?.remove();
  if(mesh){ scene.remove(mesh); mesh.geometry.dispose(); mesh.material.dispose(); }
  const mat=new THREE.MeshStandardMaterial({color:0xd8b8a8, roughness:0.75, metalness:0.0, flatShading:false,
    wireframe:wire, side:THREE.DoubleSide, clippingPlanes: cutOn?[clipPlane]:null});
  mesh=new THREE.Mesh(geo,mat); scene.add(mesh);
  geo.computeBoundingSphere(); curR=geo.boundingSphere.radius||120;
  if(!didFrame){ faceView(); didFrame=true; }
  if(cutOn) updateCut();     // reposition the cut for the new (re-centered) mesh
}
