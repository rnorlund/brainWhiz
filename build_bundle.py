#!/usr/bin/env python3
"""
Generalized atlas -> viewer bundle converter.

Turns ANY parcellation (label NIfTI + label list) into a self-contained bundle
the viewer can load: per-ROI meshes (GLB), MNI sample points, optional averaged
DTI connectivity, and optional baked NeuroQuery task maps.

Usage:
  python build_bundle.py --atlas X.nii[.gz] --labels Y.txt --id aal --name "AAL (116)" \
      [--no-neuro] [--conn-mats '/path/*.mat' --conn-field dti_aal]

Outputs to bundles/<id>/{data.js, samples.js, conn.js?, neuro.js?} and updates
bundles/registry.js.
"""
import argparse, base64, glob, json, os, re
import numpy as np
import nibabel as nib
import trimesh
import fast_simplification
from skimage import measure
from scipy import ndimage

HERE = os.path.dirname(os.path.abspath(__file__))
BUNDLES = os.path.join(HERE, "bundles")

STEP, SMOOTH_SIG, TARGET_FACE, LAPLACIAN = 1, 0.6, 1500, 6
N_SAMPLES = 180
NEURO_TERMS = ["motor","movement","finger tapping","language","speech production",
    "semantic","reading","working memory","attention","visual","auditory","face",
    "fear","reward","pain","emotion","decision making","memory","spatial","inhibition"]


def parse_labels(path):
    """Return {idx: {id, abbr, name}} for many common label formats."""
    out = {}
    with open(path, errors="ignore") as fh:
        for line in fh:
            line = line.strip()
            if not line or line.startswith("#"):
                continue
            if "|" in line:
                p = [x.strip() for x in line.split("|")]
            elif "," in line:
                p = [x.strip() for x in line.split(",")]
            else:
                p = line.split()
            if len(p) < 2:
                continue
            try:
                idx = int(float(p[0]))
            except ValueError:
                continue
            if idx <= 0:
                continue
            abbr = p[1] if len(p) > 1 else f"ROI{idx}"
            # name = a later non-numeric field if present, else abbr
            name = abbr
            for extra in p[2:]:
                if not re.fullmatch(r"[-+0-9. ]+", extra):
                    name = extra; break
            if re.fullmatch(r"\d+", abbr):       # numeric abbr (e.g. AAL code) -> use name
                abbr = name
            out[idx] = {"id": idx, "abbr": abbr, "name": name}
    return out


def lobe_of(abbr, name):
    n, a = name.lower(), abbr.lower()
    if any(k in n for k in ["cerebell","vermis"]): return "Cerebellum"
    if any(k in n for k in ["frontal","rectus","precentral","orbital","sfg","mfg","ifg"]) and "temporal" not in n: return "Frontal"
    if any(k in n for k in ["temporal","fusiform","hippocamp","amygdala","parahippo","heschl","stg","mtg","itg"]): return "Temporal"
    if any(k in n for k in ["parietal","postcentral","supramarg","angular","precuneus","cuneus","spg","smg"]): return "Parietal"
    if any(k in n for k in ["occipital","lingual","calcarine","cuneus"]): return "Occipital"
    if any(k in n for k in ["cingul","insula"]): return "Limbic"
    if any(k in n for k in ["thalam","caudate","putamen","pallidum","accumbens","nucleus","globus","striat"]): return "SubcorticalGM"
    if any(k in n for k in ["white matter","corona","capsule","callosum","fornix","fasciculus","radiata","peduncle","lemniscus","tract","longitudinal","tapetum","corticospinal","commissure","segment"]): return "WhiteMatter"
    if any(k in n for k in ["midbrain","pons","medulla","brainstem","red nucleus","substantia"]): return "Brainstem"
    if any(k in n for k in ["ventricle","csf"]): return "Ventricle"
    return "Other"


def hemi_of(abbr, name):
    s = (abbr + " " + name).lower()
    if abbr.endswith("_L") or " left" in name.lower() or s.endswith(" l"): return "L"
    if abbr.endswith("_R") or " right" in name.lower() or s.endswith(" r"): return "R"
    return "M"


def build_meshes(vol, affine, labels):
    zooms = np.abs(np.diag(affine))[:3]
    present = np.unique(vol); present = present[present > 0]
    scene = trimesh.Scene(); meta = []; built = []; centroids = []
    for lab in present:
        lab = int(lab)
        mask = vol == lab
        if mask.sum() < 30: continue
        m = np.pad(mask.astype(np.float32), 1)
        if SMOOTH_SIG: m = ndimage.gaussian_filter(m, SMOOTH_SIG)
        try:
            v, f, _, _ = measure.marching_cubes(m, level=0.5, step_size=STEP, allow_degenerate=False)
        except (ValueError, RuntimeError): continue
        v -= 1.0
        v = nib.affines.apply_affine(affine, v)
        v = np.column_stack([v[:,0], v[:,2], -v[:,1]])   # RAS -> three.js (x=R,y=Sup,z=-Ant)
        mesh = trimesh.Trimesh(vertices=v, faces=f, process=True)
        if len(mesh.faces) == 0: continue
        comps = mesh.split(only_watertight=False)
        if len(comps) > 1: mesh = max(comps, key=lambda c: c.area)
        if LAPLACIAN: trimesh.smoothing.filter_laplacian(mesh, iterations=LAPLACIAN)
        if TARGET_FACE and len(mesh.faces) > TARGET_FACE:
            try:
                red = 1.0 - TARGET_FACE/len(mesh.faces)
                vv, ff = fast_simplification.simplify(mesh.vertices, mesh.faces, target_reduction=red)
                mesh = trimesh.Trimesh(vertices=vv, faces=ff, process=True)
            except Exception: pass
        info = labels.get(lab, {"id":lab,"abbr":f"ROI{lab}","name":f"region {lab}"})
        c = mesh.vertices.mean(axis=0)
        built.append((f"roi_{lab}", mesh, info, c)); centroids.append(c)
    center = np.mean(centroids, axis=0)
    for node, mesh, info, c in built:
        mesh.apply_translation(-center); trimesh.repair.fix_normals(mesh)
        scene.add_geometry(mesh, node_name=node, geom_name=node)
        cc = c - center
        meta.append({"id":info["id"],"node":node,"abbr":info["abbr"],"name":info["name"],
                     "hemi":hemi_of(info["abbr"],info["name"]),"lobe":lobe_of(info["abbr"],info["name"]),
                     "centroid":[float(cc[0]),float(cc[1]),float(cc[2])]})
    meta.sort(key=lambda x:(x["lobe"], x["abbr"]))
    glb = scene.export(file_type="glb")
    return glb, meta, center


def build_samples(vol, affine):
    rng = np.random.default_rng(1234)
    present = np.unique(vol); present = present[present > 0]
    samples = {}
    for L in present:
        idx = np.argwhere(vol == int(L))
        if len(idx) < 1: continue
        if len(idx) > N_SAMPLES: idx = idx[rng.choice(len(idx), N_SAMPLES, replace=False)]
        mm = nib.affines.apply_affine(affine, idx)
        samples[int(L)] = [int(round(x)) for x in mm.ravel()]
    return samples


def build_conn(vol, mats_glob, field):
    import scipy.io as sio
    files = sorted(glob.glob(mats_glob))
    present = np.unique(vol); present = present[present>0]; N = int(present.max())
    acc = np.zeros((N,N)); cnt = np.zeros((N,N)); used = 0
    for f in files:
        try:
            m = sio.loadmat(f)
            if field not in m: continue
            r = np.array(m[field][0,0]["r"], dtype=float)
            if r.shape != (N,N): continue
            mask = np.isfinite(r); acc[mask]+=r[mask]; cnt[mask]+=1; used+=1
        except Exception: continue
    if used == 0: return None
    avg = np.divide(acc,cnt,out=np.zeros_like(acc),where=cnt>0); avg=0.5*(avg+avg.T); np.fill_diagonal(avg,0)
    edges=[]
    for i in range(N):
        for j in range(i+1,N):
            w=avg[i,j]
            if w>0: edges.append([i+1,j+1,round(float(w),3)])
    edges.sort(key=lambda e:-e[2])
    if not edges: return None
    return {"n_subjects":used,"max":edges[0][2],"edges":edges}


def build_neuro(vol, affine, atlas_img):
    from nilearn import image
    from neuroquery import fetch_neuroquery_model, NeuroQueryModel
    enc = NeuroQueryModel.from_data_dir(fetch_neuroquery_model())
    present = np.unique(vol); present = present[present>0]
    out = {"terms":{},"order":[]}
    for term in NEURO_TERMS:
        try: res = enc(term)
        except Exception: continue
        rimg = image.resample_to_img(res["brain_map"], atlas_img, interpolation="continuous")
        d = rimg.get_fdata(); vals={}
        for lab in present:
            vv = d[vol==int(lab)]; vv=vv[np.isfinite(vv)]
            vals[int(lab)] = float(vv.mean()) if vv.size else 0.0
        out["terms"][term]=vals; out["order"].append(term)
    return out


def update_registry(entry):
    os.makedirs(BUNDLES, exist_ok=True)
    path = os.path.join(BUNDLES, "registry.js")
    reg = []
    if os.path.exists(path):
        txt = open(path).read()
        m = re.search(r"=\s*(\[.*\])\s*;", txt, re.S)
        if m:
            try: reg = json.loads(m.group(1))
            except Exception: reg = []
    reg = [r for r in reg if r["id"] != entry["id"]] + [entry]
    reg.sort(key=lambda r: r["name"])
    with open(path, "w") as fh:
        fh.write("window.ATLAS_REGISTRY = "); json.dump(reg, fh); fh.write(";\n")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--atlas", required=True); ap.add_argument("--labels", required=True)
    ap.add_argument("--id", required=True); ap.add_argument("--name", required=True)
    ap.add_argument("--no-neuro", action="store_true")
    ap.add_argument("--conn-mats"); ap.add_argument("--conn-field")
    a = ap.parse_args()

    out = os.path.join(BUNDLES, a.id); os.makedirs(out, exist_ok=True)
    print(f"[{a.id}] loading {a.atlas}")
    img = nib.load(a.atlas); vol = np.asarray(img.dataobj).astype(np.int32); affine = img.affine
    labels = parse_labels(a.labels)
    print(f"[{a.id}] {len(np.unique(vol))-1} labels in volume, {len(labels)} in label file")

    glb, meta, center = build_meshes(vol, affine, labels)
    b64 = base64.b64encode(glb).decode("ascii")
    with open(os.path.join(out,"data.js"),"w") as fh:
        fh.write("window.ATLAS_LABELS = "); json.dump(meta, fh)
        fh.write(";\nwindow.ATLAS_GLB_B64 = \""+b64+"\";\n")
    print(f"[{a.id}] meshes: {len(meta)} ROIs, glb {len(glb)/1e6:.1f} MB")

    samples = build_samples(vol, affine)
    with open(os.path.join(out,"samples.js"),"w") as fh:
        fh.write("window.ATLAS_SAMPLES="); json.dump(samples, fh); fh.write(";\n")

    has_conn = False
    if a.conn_mats and a.conn_field:
        conn = build_conn(vol, a.conn_mats, a.conn_field)
        if conn:
            with open(os.path.join(out,"conn.js"),"w") as fh:
                fh.write("window.ATLAS_CONN="); json.dump(conn, fh); fh.write(";\n")
            has_conn = True; print(f"[{a.id}] conn: {len(conn['edges'])} edges, {conn['n_subjects']} subj")
        else: print(f"[{a.id}] conn: no matching '{a.conn_field}' data")

    has_neuro = False
    if not a.no_neuro:
        try:
            neuro = build_neuro(vol, affine, img)
            with open(os.path.join(out,"neuro.js"),"w") as fh:
                fh.write("window.ATLAS_NEURO="); json.dump(neuro, fh); fh.write(";\n")
            has_neuro = bool(neuro["order"]); print(f"[{a.id}] neuro: {len(neuro['order'])} task maps")
        except Exception as e:
            print(f"[{a.id}] neuro skipped: {e}")

    update_registry({"id":a.id,"name":a.name,"nroi":len(meta),
                     "has":{"conn":has_conn,"neuro":has_neuro}})
    print(f"[{a.id}] done -> {out}")


if __name__ == "__main__":
    main()
