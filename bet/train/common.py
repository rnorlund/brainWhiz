"""Shared preprocessing for the BET student: conform any head T1 to a fixed canonical grid.
We crop to the foreground (head) bounding box first, then resample to a fixed shape+voxel so the
brain is reliably centered regardless of how much neck/FOV the scan includes. The SAME transform
is reproduced at inference time and inverted to paint the mask back into native space."""
import os, numpy as np   # nibabel imported lazily in conform() so training (cache-only) needs no nibabel

# Default = the shipped 2mm envelope model. Override via env for the high-res tissue model
# (e.g. BET_SHAPE=192,224,192 BET_VOX=1.0), so the same conform code serves both without a fork.
SHAPE = tuple(int(v) for v in os.environ.get('BET_SHAPE', '96,112,96').split(','))
VOX   = float(os.environ.get('BET_VOX', '2.0'))   # mm isotropic; 2.0 -> 192x224x192mm box (brain+margin)

def _otsu(a, nbins=256):
    a = a[np.isfinite(a)];
    if a.size == 0: return 0.0
    hi = np.percentile(a, 99.5);
    if hi <= 0: return 0.0
    h, edges = np.histogram(np.clip(a, 0, hi), bins=nbins)
    p = h.astype(np.float64) / max(h.sum(), 1); w = np.cumsum(p); mu = np.cumsum(p * np.arange(nbins))
    muT = mu[-1]; denom = w * (1 - w); denom[denom == 0] = 1e-9
    sigma = (muT * w - mu) ** 2 / denom
    return edges[int(np.argmax(sigma))]

def head_bbox(data, pad_mm=8, zooms=(1,1,1)):
    thr = _otsu(data) * 0.5
    fg = data > thr
    if fg.sum() < 100: fg = data > data.mean()
    idx = np.where(fg)
    lo = [int(idx[d].min()) for d in range(3)]; hi = [int(idx[d].max()) for d in range(3)]
    pad = [int(round(pad_mm / max(zooms[d], 1e-3))) for d in range(3)]
    lo = [max(0, lo[d] - pad[d]) for d in range(3)]
    hi = [min(data.shape[d] - 1, hi[d] + pad[d]) for d in range(3)]
    return lo, hi

def target_affine(aff, data_shape=None, lo=None, hi=None, data=None):
    """Explicit axis-aligned RAS target grid (VOX mm, SHAPE), centered on the head-bbox world center.
    Fully specified (no nibabel.conform black box) so JS can reproduce it exactly for in-browser use."""
    aff = np.asarray(aff, float)
    if lo is None or hi is None:
        lo, hi = head_bbox(data, 8, (1, 1, 1))
    cvox = (np.asarray(lo, float) + np.asarray(hi, float)) / 2.0
    center = aff[:3, :3] @ cvox + aff[:3, 3]                    # world center of the head bbox
    S = np.array(SHAPE, float)
    Ta = np.eye(4); Ta[0, 0] = Ta[1, 1] = Ta[2, 2] = VOX        # +RAS, isotropic
    Ta[:3, 3] = center - Ta[:3, :3] @ ((S - 1) / 2.0)          # center the FOV on the head
    return Ta, lo, hi

def _resample(data, src_aff, Ta, order):
    from scipy.ndimage import map_coordinates
    S = SHAPE
    gi, gj, gk = np.meshgrid(np.arange(S[0]), np.arange(S[1]), np.arange(S[2]), indexing='ij')
    tv = np.stack([gi.ravel(), gj.ravel(), gk.ravel(), np.ones(gi.size)], 0)    # 4 x N target voxels
    world = Ta @ tv                                                            # -> world (RAS mm)
    coords = (np.linalg.inv(np.asarray(src_aff, float)) @ world)[:3]           # -> native voxel coords
    return map_coordinates(data, coords, order=order, cval=0.0, prefilter=False).reshape(S)

def conform(t1_path, mask_path=None):
    """Return (x[float32, SHAPE] ~[0,1], y[float32 or None], meta). Explicit reproducible conform."""
    import nibabel as nib
    img = nib.load(t1_path); data = np.asanyarray(img.dataobj).astype(np.float32); aff = img.affine.astype(np.float64)
    Ta, lo, hi = target_affine(aff, data=data)
    x = _resample(data, aff, Ta, order=1).astype(np.float32)
    pos = x[x > 0]; p = np.percentile(pos, 99.5) if pos.size else 1.0
    x = np.clip(x / (p if p > 0 else 1.0), 0, 1).astype(np.float32)
    y = None
    if mask_path:
        mimg = nib.load(mask_path); md = np.asanyarray(mimg.dataobj).astype(np.float32)
        # ROUND to nearest label: binary masks -> 0/1; CAT12 p0 -> 0/1/2/3 (bg/CSF/GM/WM). brain = y>0.
        y = np.clip(np.round(_resample(md, mimg.affine.astype(np.float64), Ta, order=0)), 0, 10).astype(np.float32)
    return x, y, {'Ta': Ta.tolist(), 'aff': aff.tolist(), 'lo': list(map(int, lo)), 'hi': list(map(int, hi)),
                  'shape': list(SHAPE), 'vox': VOX, 'src_shape': list(data.shape)}
