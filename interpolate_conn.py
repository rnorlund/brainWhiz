#!/usr/bin/env python3
"""
Estimate connectivity for an atlas that has no measured data, by projecting the
*measured* AICHA and JHU connectomes through spatial overlap and blending them.

For each target ROI we compute its fractional voxel overlap with the donor
atlas's ROIs (W), then  C* = W . C_donor . W^T  (a proximity-weighted average of
the donor edges the target regions sit on). AICHA (cortical, fine) and JHU
(adds deep/WM coverage) are each projected, normalised, then blended.

Results are written into bundles/<id>/conn.js as types tagged "interp": true,
WITHOUT overwriting any real measured type already present. Marked DTI*/RS* in UI.

  python interpolate_conn.py --atlas X.nii --id myid [--types dti,rs]
"""
import argparse, glob, json, os, re
import numpy as np
import nibabel as nib

HERE = os.path.dirname(os.path.abspath(__file__))
DONORS = {
    "aicha": ("/Users/super/Documents/NiiStat/roi/AICHA.nii", "bundles/aicha/conn.js"),
    "jhu":   ("/Users/super/Documents/LR_LSM_explorationForJulius/jhu.nii", "bundles/jhu/conn.js"),
}

def load_conn_js(path):
    t = open(os.path.join(HERE, path)).read()
    return json.loads(re.search(r"=\s*({.*})\s*;", t, re.S).group(1))

def dense_from_edges(conn, n):
    M = np.zeros((n, n))
    for i, j, w in conn["edges"]:
        M[i-1, j-1] = w; M[j-1, i-1] = w
    return M

def overlap_weights(tgt_vol, tgt_aff, donor_vol, donor_aff, tgt_labels):
    """W[a, d] = fraction of target ROI a's voxels that fall in donor ROI d."""
    dn = int(donor_vol.max())
    inv = np.linalg.inv(donor_aff)
    W = np.zeros((len(tgt_labels), dn))
    for ai, lab in enumerate(tgt_labels):
        idx = np.argwhere(tgt_vol == lab)
        if len(idx) == 0:
            continue
        mm = nib.affines.apply_affine(tgt_aff, idx)
        dij = np.rint(nib.affines.apply_affine(inv, mm)).astype(int)
        ok = (dij >= 0).all(1) & (dij[:, 0] < donor_vol.shape[0]) & \
             (dij[:, 1] < donor_vol.shape[1]) & (dij[:, 2] < donor_vol.shape[2])
        dij = dij[ok]
        if len(dij) == 0:
            continue
        dl = donor_vol[dij[:, 0], dij[:, 1], dij[:, 2]]
        dl = dl[dl > 0]
        if len(dl) == 0:
            continue
        cnt = np.bincount(dl, minlength=dn + 1)[1:]
        W[ai] = cnt / len(idx)      # fraction of target voxels (incl. those landing in unlabeled)
    return W

def project(W, C):
    """Proximity-weighted estimate C* = W C W^T, normalised to [0,1], diag 0."""
    P = W @ C @ W.T
    np.fill_diagonal(P, 0)
    mx = P.max()
    if mx > 0:
        P = P / mx
    return P

def build_type(tgt_vol, tgt_aff, tgt_labels, kind):
    field = "dti" if kind == "dti" else "rs"
    projs, covs = [], []
    for dname, (dnii, dconn) in DONORS.items():
        conn = load_conn_js(dconn)
        if field not in conn:
            continue
        dvol = np.squeeze(np.asarray(nib.load(dnii).dataobj)).astype(int)
        daff = nib.load(dnii).affine
        n = int(dvol.max())
        C = dense_from_edges(conn[field], n)
        W = overlap_weights(tgt_vol, tgt_aff, dvol, daff, tgt_labels)
        projs.append(project(W, C))
        covs.append(W.sum(1))      # per-target coverage in this donor
    if not projs:
        return None
    # blend: average over donors that actually cover each region pair
    blended = np.zeros_like(projs[0]); wsum = np.zeros_like(projs[0])
    for P, cov in zip(projs, covs):
        good = (cov > 0.2)
        m = np.outer(good, good).astype(float)
        blended += P * m; wsum += m
    blended = np.divide(blended, wsum, out=np.zeros_like(blended), where=wsum > 0)
    edges = []
    nT = len(tgt_labels)
    for a in range(nT):
        for b in range(a + 1, nT):
            w = blended[a, b]
            if w > 0.08:
                edges.append([tgt_labels[a], tgt_labels[b], round(float(w), 3)])
    edges.sort(key=lambda e: -e[2])
    if not edges:
        return None
    return {"interp": True, "donors": list(DONORS), "max": edges[0][2],
            "kind": kind + "*", "edges": edges}

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--atlas", required=True); ap.add_argument("--id", required=True)
    ap.add_argument("--types", default="dti,rs")
    a = ap.parse_args()
    out = os.path.join(HERE, "bundles", a.id, "conn.js")
    conn = {}
    if os.path.exists(out):
        conn = load_conn_js("bundles/" + a.id + "/conn.js")
    img = nib.load(a.atlas); vol = np.squeeze(np.asarray(img.dataobj)).astype(int)
    labels = [int(x) for x in np.unique(vol) if x > 0]
    for kind in [t.strip() for t in a.types.split(",")]:
        if kind in conn and not conn[kind].get("interp"):
            print(f"[{a.id}] {kind}: real data present, skipping interpolation"); continue
        c = build_type(vol, img.affine, labels, kind)
        if c:
            conn[kind] = c; print(f"[{a.id}] {kind}*: {len(c['edges'])} interpolated edges")
        else:
            print(f"[{a.id}] {kind}: no donor coverage")
    if conn:
        with open(out, "w") as fh:
            fh.write("window.ATLAS_CONN="); json.dump(conn, fh); fh.write(";\n")
        print(f"[{a.id}] wrote {out}")

if __name__ == "__main__":
    main()
