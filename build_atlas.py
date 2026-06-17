#!/usr/bin/env python3
"""
Build a Three.js-ready exploding-brain asset from the JHU atlas.

For every labelled ROI in jhu.nii we run marching cubes to extract a surface,
lightly smooth + decimate it, recenter the whole brain on the origin, and pack
all ROIs into ONE glb scene (one named mesh per ROI). The glb is base64-embedded
into data.js along with the ROI label table, so index.html runs by just being
opened in a browser (no local server required).
"""
import base64
import json
import os

import nibabel as nib
import numpy as np
import trimesh
import fast_simplification
from skimage import measure
from scipy import ndimage

NII   = "/Users/super/Documents/LR_LSM_explorationForJulius/jhu.nii"
TXT   = "/Users/super/Documents/LR_LSM_explorationForJulius/jhu.txt"
OUT   = "/Users/super/Documents/jhu_brain_atlas"

STEP        = 1          # marching-cubes step size (1 = full res)
SMOOTH_SIG  = 0.6        # gaussian smoothing of the binary mask before MC
TARGET_FACE = 1500       # quadric-decimation target faces per ROI (None to skip)
LAPLACIAN   = 6          # laplacian smoothing iterations on the mesh


def load_labels(path):
    labels = {}
    with open(path) as fh:
        for line in fh:
            line = line.strip()
            if not line:
                continue
            parts = line.split("|")
            if len(parts) < 3:
                continue
            idx = int(parts[0])
            labels[idx] = {"id": idx, "abbr": parts[1], "name": parts[2]}
    return labels


def lobe_of(abbr, name):
    """Crude lobe / structure grouping for color-scheme presets."""
    n = name.lower()
    a = abbr.lower()
    if any(k in n for k in ["cerebellum", "cerebellar", "vermis"]):
        return "Cerebellum"
    if any(k in n for k in ["frontal", "rectus", "precentral", "gyrus rectus",
                            "orbital"]) and "temporal" not in n:
        return "Frontal"
    if any(k in n for k in ["temporal", "fusiform", "hippocamp", "amygdala",
                            "parahippocamp", "heschl"]):
        return "Temporal"
    if any(k in n for k in ["parietal", "postcentral", "supramarginal",
                            "angular", "precuneus", "cuneus" ]):
        return "Parietal"
    if any(k in n for k in ["occipital", "lingual", "calcarine"]):
        return "Occipital"
    if any(k in n for k in ["cingul", "insula"]):
        return "Limbic"
    if any(k in n for k in ["thalamus", "caudate", "putamen", "pallidum",
                            "accumbens", "nucleus", "globus"]):
        return "SubcorticalGM"
    if any(k in n for k in ["white matter", "corona", "capsule", "callosum",
                            "fornix", "fasciculus", "radiata", "peduncle",
                            "lemniscus", "cerebral peduncle", "tract",
                            "longitudinal", "tapetum", "corticospinal"]):
        return "WhiteMatter"
    if any(k in n for k in ["midbrain", "pons", "medulla", "brainstem",
                            "red nucleus", "substantia"]):
        return "Brainstem"
    if any(k in n for k in ["ventricle", "csf"]):
        return "Ventricle"
    return "Other"


def hemi_of(abbr):
    if abbr.endswith("_L") or abbr.endswith("_l"):
        return "L"
    if abbr.endswith("_R") or abbr.endswith("_r"):
        return "R"
    return "M"


def main():
    print("loading", NII)
    img = nib.load(NII)
    vol = img.get_fdata().astype(np.int32)
    affine = img.affine
    labels = load_labels(TXT)

    present = np.unique(vol)
    present = present[present > 0]
    print(f"{len(present)} labelled ROIs present")

    scene = trimesh.Scene()
    meta = []

    # global voxel->world: we just use voxel coords scaled by zoom, then recenter.
    zooms = img.header.get_zooms()[:3]

    all_centroids = []
    built = []
    kept = 0
    for lab in present:
        lab = int(lab)
        mask = vol == lab
        if mask.sum() < 30:
            continue
        # pad so surfaces close at the volume edge
        m = np.pad(mask.astype(np.float32), 1)
        if SMOOTH_SIG:
            m = ndimage.gaussian_filter(m, SMOOTH_SIG)
        try:
            verts, faces, _, _ = measure.marching_cubes(
                m, level=0.5, step_size=STEP, allow_degenerate=False)
        except (ValueError, RuntimeError):
            continue
        verts -= 1.0  # undo pad
        # voxel index -> world mm via the NIfTI affine (RAS)
        verts = nib.affines.apply_affine(affine, verts)
        # RAS (x=Right, y=Anterior, z=Superior) -> three.js (x=Right, y=Up/Sup, z=-Anterior)
        verts = np.column_stack([verts[:, 0], verts[:, 2], -verts[:, 1]])

        mesh = trimesh.Trimesh(vertices=verts, faces=faces, process=True)
        if len(mesh.faces) == 0:
            continue
        # keep only the largest connected component to drop speckles
        comps = mesh.split(only_watertight=False)
        if len(comps) > 1:
            mesh = max(comps, key=lambda c: c.area)
        if LAPLACIAN:
            trimesh.smoothing.filter_laplacian(mesh, iterations=LAPLACIAN)
        if TARGET_FACE and len(mesh.faces) > TARGET_FACE:
            try:
                reduction = 1.0 - (TARGET_FACE / len(mesh.faces))
                v, f = fast_simplification.simplify(
                    mesh.vertices, mesh.faces, target_reduction=reduction)
                mesh = trimesh.Trimesh(vertices=v, faces=f, process=True)
            except Exception as e:
                print("  decimate failed", lab, e)

        info = labels.get(lab, {"id": lab, "abbr": f"ROI{lab}",
                                "name": f"region {lab}"})
        node = f"roi_{lab}"
        c = mesh.vertices.mean(axis=0)
        all_centroids.append(c)
        built.append((node, mesh, info, c))
        kept += 1

    # global brain center -> bake recentering into the vertices (identity nodes)
    center = np.mean(all_centroids, axis=0)
    print("brain center (mm):", center, "| ROIs kept:", kept)

    for node, mesh, info, c in built:
        mesh.apply_translation(-center)             # bake into vertices
        trimesh.repair.fix_normals(mesh)            # outward-facing normals
        scene.add_geometry(mesh, node_name=node, geom_name=node)
        cc = c - center
        meta.append({
            "id": info["id"],
            "node": node,
            "abbr": info["abbr"],
            "name": info["name"],
            "hemi": hemi_of(info["abbr"]),
            "lobe": lobe_of(info["abbr"], info["name"]),
            "centroid": [float(cc[0]), float(cc[1]), float(cc[2])],
            "nverts": int(len(mesh.vertices)),
            "nfaces": int(len(mesh.faces)),
        })

    glb = scene.export(file_type="glb")
    print(f"glb size: {len(glb)/1e6:.2f} MB")

    b64 = base64.b64encode(glb).decode("ascii")
    meta.sort(key=lambda x: (x["lobe"], x["abbr"]))

    data_js = os.path.join(OUT, "data.js")
    with open(data_js, "w") as fh:
        fh.write("window.JHU_LABELS = ")
        json.dump(meta, fh)
        fh.write(";\n")
        fh.write(f'window.JHU_GLB_B64 = "{b64}";\n')
    print("wrote", data_js, f"({os.path.getsize(data_js)/1e6:.2f} MB)")

    # also drop a raw glb for anyone who wants to load it directly
    with open(os.path.join(OUT, "brain.glb"), "wb") as fh:
        fh.write(glb)
    print("done. ROIs:", kept)


if __name__ == "__main__":
    main()
