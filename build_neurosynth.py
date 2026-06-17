#!/usr/bin/env python3
"""
Bake per-ROI task maps for the JHU atlas using NeuroQuery (the modern
successor to Neurosynth). For each search term we ask NeuroQuery for the
predicted brain map, then average that map within every JHU ROI and store
the per-ROI values in neuro.js for the viewer to color by.
"""
import json, os
import numpy as np
import nibabel as nib
from nilearn import image
from neuroquery import fetch_neuroquery_model, NeuroQueryModel

NII = "/Users/super/Documents/LR_LSM_explorationForJulius/jhu.nii"
OUT = "/Users/super/Documents/jhu_brain_atlas"

# common cognitive / task terms to bake in
TERMS = [
    "motor", "movement", "finger tapping", "language", "speech production",
    "semantic", "reading", "working memory", "attention", "visual",
    "auditory", "face", "fear", "reward", "pain", "emotion",
    "decision making", "memory", "spatial", "inhibition",
]

def main():
    print("loading JHU atlas …")
    atlas = nib.load(NII)
    labels = atlas.get_fdata().astype(np.int32)
    present = np.unique(labels); present = present[present > 0]

    print("fetching NeuroQuery model (first run downloads ~hundreds of MB) …")
    encoder = NeuroQueryModel.from_data_dir(fetch_neuroquery_model())

    out = {"terms": {}, "order": []}
    for term in TERMS:
        try:
            res = encoder(term)
        except Exception as e:
            print("  skip", term, e); continue
        img = res["brain_map"]                      # MNI z-like map
        # resample NeuroQuery map onto the atlas grid so voxels line up
        rimg = image.resample_to_img(img, atlas, interpolation="continuous")
        data = rimg.get_fdata()
        vals = {}
        for lab in present:
            m = labels == lab
            v = data[m]
            v = v[np.isfinite(v)]
            vals[int(lab)] = float(v.mean()) if v.size else 0.0
        out["terms"][term] = vals
        out["order"].append(term)
        arr = np.array(list(vals.values()))
        print(f"  {term:18s}  roi mean range [{arr.min():.3f}, {arr.max():.3f}]")

    path = os.path.join(OUT, "neuro.js")
    with open(path, "w") as fh:
        fh.write("window.JHU_NEURO = ")
        json.dump(out, fh)
        fh.write(";\n")
    print("wrote", path, f"({os.path.getsize(path)/1e3:.0f} KB)  terms: {len(out['order'])}")

if __name__ == "__main__":
    main()
