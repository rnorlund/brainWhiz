import json, os, numpy as np, nibabel as nib
NII="/Users/super/Documents/LR_LSM_explorationForJulius/jhu.nii"
OUT="/Users/super/Documents/jhu_brain_atlas"
N=180  # sample points per ROI
rng=np.random.default_rng(1234)
img=nib.load(NII); lab=img.get_fdata().astype(np.int32); aff=img.affine
present=np.unique(lab); present=present[present>0]
samples={}
for L in present:
    idx=np.argwhere(lab==L)
    if len(idx)>N:
        idx=idx[rng.choice(len(idx), N, replace=False)]
    mm=nib.affines.apply_affine(aff, idx)  # voxel->MNI mm
    samples[int(L)]=[int(round(v)) for v in mm.ravel()]
with open(os.path.join(OUT,"samples.js"),"w") as fh:
    fh.write("window.JHU_SAMPLES=")
    json.dump(samples, fh)
    fh.write(";\n")
print("wrote samples.js", os.path.getsize(os.path.join(OUT,'samples.js'))/1e3,"KB; rois",len(samples))
