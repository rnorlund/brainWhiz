#!/usr/bin/env python3
"""
make_synth_atlas.py — generate a 100% ORIGINAL, license-free synthetic atlas + template so the
Engine Edition ships with something usable (and presentable) out of the box.

Design goals (so it doesn't look junky):
  * brain-LIKE shape: two hemispheres with a dorsal interhemispheric fissure, gyral folding on
    the surface, a flatter inferior base, tapered frontal/occipital poles.
  * structured parcellation: Voronoi parcels per hemisphere, each NAMED by a pseudo-lobe from its
    location (Frontal/Parietal/Temporal/Occipital/Limbic/SubcorticalGM) so the viewer's lobe
    color scheme gives a clean, atlas-like look (not random rainbow tiles).
  * a matching synthetic grayscale template for slice backgrounds.

NOT anatomy — an abstract, clearly-labelled "Synthetic" demo. Re-run to regenerate.
Outputs: bundles/synth/{data.js,samples.js} (+ registry entry) and bundles/_mni152_synth.js
Deps: numpy, nibabel (same env as build_bundle.py).
"""
import os, sys, gzip, base64, subprocess, tempfile
import numpy as np
import nibabel as nib

HERE = os.path.dirname(os.path.abspath(__file__))
DIM  = (99, 117, 95)
AFF  = np.array([[2.,0,0,-98.],[0,2.,0,-134.],[0,0,2.,-72.],[0,0,0,1.]])
K_PER_HEMI = 36
SEED = 11
CX,CY,CZ = 0.0,-16.0,16.0           # brain center (world mm)
AX,AY,AZ = 62.0,86.0,52.0           # semi-axes (L-R, A-P, S-I)

def world_grid():
    i,j,k = np.meshgrid(np.arange(DIM[0]), np.arange(DIM[1]), np.arange(DIM[2]), indexing='ij')
    return (AFF[0,0]*i+AFF[0,3]).astype(np.float32), (AFF[1,1]*j+AFF[1,3]).astype(np.float32), (AFF[2,2]*k+AFF[2,3]).astype(np.float32)

def brain_field(x,y,z):
    """Signed field <=0 inside a folded, tapered, hemisphere-split brain-like volume."""
    dx,dy,dz = x-CX, y-CY, z-CZ
    # taper poles (narrower frontal/occipital) and flatten the base
    ax = AX*(1.0 - 0.18*np.clip(dy/AY,0,1) - 0.10*np.clip(-dy/AY,0,1))     # frontal/occipital taper in L-R
    az = np.where(dz>=0, AZ, AZ*0.82)                                       # flatter inferior
    rn = np.sqrt((dx/ax)**2 + (dy/AY)**2 + (dz/az)**2)
    # gyral folding on the boundary (bold enough to survive mesh smoothing)
    fold = ( np.sin(0.42*x)*np.sin(0.40*y)
           + np.sin(0.40*y)*np.sin(0.52*z)
           + np.sin(0.52*x+0.33*z) ) / 3.0
    fold += 0.5*np.sin(0.95*x)*np.sin(0.85*y)*np.sin(0.8*z)
    surf = 1.0 + 0.11*fold
    return rn - surf

def lobe_name(cx,cy,cz):
    dx,dy,dz = cx-CX, cy-CY, cz-CZ
    if abs(dx)<24 and abs(dy)<26 and abs(dz)<18: return "SubcorticalGM","Subcortical"
    if abs(dx)<14 and dz>4:                       return "Limbic","Cingulate"
    if dy >  26: return "Frontal","Frontal"
    if dy < -34: return "Occipital","Occipital"
    if dz >  10: return "Parietal","Parietal"
    return "Temporal","Temporal"

def main():
    x,y,z = world_grid()
    f = brain_field(x,y,z)
    brain = f <= 0
    # dorsal interhemispheric fissure: wide gap on top, narrow at base
    gap = 2.0 + 5.0*np.clip((z-CZ)/AZ,0,1)
    brain &= (np.abs(x) >= gap)

    rng = np.random.default_rng(SEED)
    labels = np.zeros(DIM, dtype=np.int16)
    seeds = []; nid = 0
    for hemi, xs in (("L", x < 0), ("R", x > 0)):
        region = brain & xs
        vox = np.argwhere(region)
        pick = vox[rng.choice(len(vox), size=K_PER_HEMI, replace=False)]
        sw = np.stack([AFF[0,0]*pick[:,0]+AFF[0,3], AFF[1,1]*pick[:,1]+AFF[1,3], AFF[2,2]*pick[:,2]+AFF[2,3]],1)
        pts = np.stack([x[region],y[region],z[region]],1)
        nearest = (((pts[:,None,:]-sw[None,:,:])**2).sum(2)).argmin(1)
        ids = np.arange(nid+1, nid+1+K_PER_HEMI, dtype=np.int16)
        labels[region] = ids[nearest]
        for m in range(K_PER_HEMI): seeds.append((sw[m], nid+1+m, hemi))
        nid += K_PER_HEMI
    K = nid

    tmp = tempfile.mkdtemp()
    nii_path = os.path.join(tmp,"synth.nii.gz"); nib.save(nib.Nifti1Image(labels, AFF), nii_path)
    lab_path = os.path.join(tmp,"synth_labels.txt")
    with open(lab_path,"w") as fh:
        per = {}
        for (w,sid,hemi) in seeds:
            lobe,short = lobe_name(*w); per[lobe]=per.get(lobe,0)+1; n=per[lobe]
            side = "Left" if hemi=="L" else "Right"
            fh.write(f"{sid}|{short[:3]}{n}{hemi}|{short} {n} {side}\n")   # name keywords drive lobe coloring

    print(f"[synth] building {K}-parcel brain-like bundle …")
    subprocess.run([sys.executable, os.path.join(HERE,"build_bundle.py"),
        "--atlas", nii_path, "--labels", lab_path,
        "--id","synth","--name",f"Synthetic ({K})","--no-neuro"], check=True, cwd=HERE)

    # synthetic grayscale template (same folded shape) for slice backgrounds
    dx,dy,dz = x-CX, y-CY, z-CZ
    rn = np.sqrt((dx/AX)**2+(dy/AY)**2+(dz/AZ)**2)
    inten = np.zeros(DIM, np.float32)
    core = np.clip(255*(0.40+0.60*(1.0-rn)),0,255)
    gyral = 14*np.sin(x*0.5)*np.sin(y*0.5)*np.sin(z*0.5)
    inten[brain] = np.clip(core[brain]+gyral[brain],14,255)
    vol = inten.astype(np.uint8)
    b64 = base64.b64encode(gzip.compress(vol.ravel(order="F").tobytes())).decode("ascii")
    aff_list=[[float(AFF[r,c]) for c in range(4)] for r in range(4)]
    with open(os.path.join(HERE,"bundles","_mni152_synth.js"),"w") as fh:
        fh.write("// SYNTHETIC slice-background template (original, license-free) — Engine Edition.\n")
        fh.write("// NOT a real MNI152/anatomical template; an abstract grayscale field for demo backgrounds.\n")
        fh.write(f'window.MNI152={{dim:{list(DIM)},affine:{aff_list},order:"F",data:"{b64}"}};\n')
    print(f"[synth] done: bundles/synth/ + bundles/_mni152_synth.js  ({K} parcels)")

if __name__ == "__main__":
    main()
