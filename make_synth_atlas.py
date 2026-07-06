#!/usr/bin/env python3
"""
make_synth_atlas.py — generate a 100% ORIGINAL, license-free synthetic atlas + template so the
Engine Edition ships with something usable (and presentable) out of the box.

Design goals:
  * brain-LIKE + L/R SYMMETRICAL: the shape field is even in x and the parcellation is generated on
    the LEFT then MIRRORED to the right, so left/right regions match exactly.
  * smooth gyral folding (gentle, low-frequency) + strong mesh smoothing so it doesn't look chunky.
  * a CEREBELLUM (posterior-inferior, two lobes + midline vermis, transverse foliation).
  * pseudo-lobe names (Frontal/Parietal/Temporal/Occipital/Limbic/Subcortical/Cerebellum) so the
    viewer's lobe color scheme gives a clean, atlas-like look.
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
KL   = 30           # cerebrum parcels PER hemisphere (mirrored L<->R)
SEED = 11
CX,CY,CZ = 0.0,-16.0,18.0           # cerebrum center (world mm)
AX,AY,AZ = 62.0,86.0,52.0           # cerebrum semi-axes (L-R, A-P, S-I)
# cerebellum (posterior-inferior)
BX,BY,BZ = 0.0,-74.0,-30.0
BAX,BAY,BAZ = 46.0,30.0,26.0

def world_grid():
    i,j,k = np.meshgrid(np.arange(DIM[0]), np.arange(DIM[1]), np.arange(DIM[2]), indexing='ij')
    return (AFF[0,0]*i+AFF[0,3]).astype(np.float32), (AFF[1,1]*j+AFF[1,3]).astype(np.float32), (AFF[2,2]*k+AFF[2,3]).astype(np.float32)

def cerebrum_field(x,y,z):
    """Signed field <=0 inside a folded, tapered, hemisphere brain-like volume. EVEN in x (symmetric)."""
    ax_abs = np.abs(x)
    dx,dy,dz = ax_abs-0.0, y-CY, z-CZ
    ax = AX*(1.0 - 0.16*np.clip(dy/AY,0,1) - 0.10*np.clip(-dy/AY,0,1))   # frontal/occipital taper
    az = np.where(dz>=0, AZ, AZ*0.84)                                     # flatter inferior
    rn = np.sqrt((ax_abs/ax)**2 + (dy/AY)**2 + (dz/az)**2)
    # gentle low-frequency gyral folding, EVEN in x -> symmetric + smooth
    fold = ( np.sin(0.32*ax_abs)*np.sin(0.30*y)
           + np.sin(0.30*y)*np.sin(0.38*z)
           + np.sin(0.38*ax_abs+0.24*z) ) / 3.0
    surf = 1.0 + 0.075*fold
    return rn - surf

def cerebellum_mask(x,y,z):
    dx,dy,dz = np.abs(x), y-BY, z-BZ
    rn = np.sqrt((dx/BAX)**2 + (dy/BAY)**2 + (dz/BAZ)**2)
    foliation = 0.05*np.sin(1.1*z)               # fine transverse folds, symmetric
    return rn <= (1.0 + foliation)

def lobe_name(cx,cy,cz):
    dx,dy,dz = cx-CX, cy-CY, cz-CZ
    if abs(dx)<24 and abs(dy)<26 and abs(dz)<18: return "Subcortical"
    if abs(dx)<14 and dz>4:                       return "Cingulate"
    if dy >  26: return "Frontal"
    if dy < -34: return "Occipital"
    if dz >  10: return "Parietal"
    return "Temporal"

def main():
    x,y,z = world_grid()
    cb = cerebellum_mask(x,y,z)
    cereb = (cerebrum_field(x,y,z) <= 0) & (~cb)
    gap = 2.0 + 5.0*np.clip((z-CZ)/AZ,0,1)        # interhemispheric fissure (wide dorsal)
    cereb &= (np.abs(x) >= gap)
    brain = cereb | cb

    rng = np.random.default_rng(SEED)
    labels = np.zeros(DIM, dtype=np.int16)
    mirror = (DIM[0]-1) - np.arange(DIM[0])       # x-axis index reflection (i -> 98-i)

    # --- LEFT cerebrum: Voronoi parcels, then MIRROR to the right ---
    leftmask = cereb & (x < 0)
    vox = np.argwhere(leftmask)
    pick = vox[rng.choice(len(vox), size=KL, replace=False)]
    sw = np.stack([AFF[0,0]*pick[:,0]+AFF[0,3], AFF[1,1]*pick[:,1]+AFF[1,3], AFF[2,2]*pick[:,2]+AFF[2,3]],1)
    pts = np.stack([x[leftmask],y[leftmask],z[leftmask]],1)
    nearest = (((pts[:,None,:]-sw[None,:,:])**2).sum(2)).argmin(1)
    lab_l = np.zeros(DIM, dtype=np.int16); lab_l[leftmask] = (nearest+1).astype(np.int16)
    labels[leftmask] = lab_l[leftmask]
    lab_ref = lab_l[mirror,:,:]                    # reflected left labels
    rightmask = cereb & (x > 0)
    labels[rightmask] = np.where(lab_ref[rightmask]>0, lab_ref[rightmask]+KL, 0).astype(np.int16)

    # --- cerebellum: vermis + L/R lobes (symmetric by construction) ---
    VER, LCB, RCB = 2*KL+1, 2*KL+2, 2*KL+3
    labels[cb & (np.abs(x)<8)]  = VER
    labels[cb & (x<=-8)]        = LCB
    labels[cb & (x>= 8)]        = RCB
    K = 2*KL+3

    # --- label file: mirrored cerebrum names + cerebellum ---
    lab_path = os.path.join(tempfile.mkdtemp(),"synth_labels.txt")
    per={}
    lines=[]
    for m in range(KL):
        lobe = lobe_name(*sw[m]); per[lobe]=per.get(lobe,0)+1; n=per[lobe]
        lines.append(f"{m+1}|{lobe[:3]}{n}L|{lobe} {n} Left")
        lines.append(f"{m+1+KL}|{lobe[:3]}{n}R|{lobe} {n} Right")
    lines.append(f"{VER}|VermisC|Cerebellum Vermis")
    lines.append(f"{LCB}|CbL|Cerebellum Left")
    lines.append(f"{RCB}|CbR|Cerebellum Right")
    with open(lab_path,"w") as fh: fh.write("\n".join(sorted(lines, key=lambda s:int(s.split('|')[0])))+"\n")

    tmp2 = tempfile.mkdtemp()
    nii_path = os.path.join(tmp2,"synth.nii.gz"); nib.save(nib.Nifti1Image(labels, AFF), nii_path)
    print(f"[synth] building {K}-parcel symmetric brain (+cerebellum) …")
    subprocess.run([sys.executable, os.path.join(HERE,"build_bundle.py"),
        "--atlas", nii_path, "--labels", lab_path,
        "--id","synth","--name",f"Synthetic ({K})","--no-neuro",
        "--smooth-sig","1.0","--laplacian","18"], check=True, cwd=HERE)   # extra smoothing -> smooth, brain-like

    # synthetic grayscale template (symmetric) for slice backgrounds
    ax_abs=np.abs(x); dy,dz=y-CY,z-CZ
    rn = np.sqrt((ax_abs/AX)**2+(dy/AY)**2+(dz/AZ)**2)
    inten = np.zeros(DIM, np.float32)
    core = np.clip(255*(0.42+0.58*(1.0-rn)),0,255)
    gyral = 12*np.sin(ax_abs*0.42)*np.sin(y*0.42)*np.sin(z*0.42)         # symmetric gyral texture
    inten[brain] = np.clip(core[brain]+gyral[brain],16,255)
    vol = inten.astype(np.uint8)
    b64 = base64.b64encode(gzip.compress(vol.ravel(order="F").tobytes())).decode("ascii")
    aff_list=[[float(AFF[r,c]) for c in range(4)] for r in range(4)]
    with open(os.path.join(HERE,"bundles","_mni152_synth.js"),"w") as fh:
        fh.write("// SYNTHETIC slice-background template (original, license-free) — Engine Edition.\n")
        fh.write("// NOT a real MNI152/anatomical template; an abstract grayscale field for demo backgrounds.\n")
        fh.write(f'window.MNI152={{dim:{list(DIM)},affine:{aff_list},order:"F",data:"{b64}"}};\n')
    print(f"[synth] done: bundles/synth/ + bundles/_mni152_synth.js  ({K} parcels, symmetric, +cerebellum)")

if __name__ == "__main__":
    main()
