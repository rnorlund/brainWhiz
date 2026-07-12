"""Shared preprocessing for the BET student: conform any head T1 to a fixed canonical grid.
We crop to the foreground (head) bounding box first, then resample to a fixed shape+voxel so the
brain is reliably centered regardless of how much neck/FOV the scan includes. The SAME transform
is reproduced at inference time and inverted to paint the mask back into native space."""
import numpy as np, nibabel as nib

SHAPE = (96, 112, 96)      # fixed model input (x,y,z) in canonical RAS
VOX   = 2.0                # mm isotropic  -> 192 x 224 x 192 mm box (covers brain + margin)

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

def conform(t1_path, mask_path=None):
    """Return (x[float32, SHAPE], y[float32 or None], meta) with x normalized to ~[0,1]."""
    import nibabel.processing as nip
    img = nib.as_closest_canonical(nib.load(t1_path))
    data = np.asanyarray(img.dataobj).astype(np.float32)
    z = img.header.get_zooms()[:3]
    lo, hi = head_bbox(data, 8, z)
    sl = tuple(slice(lo[d], hi[d] + 1) for d in range(3))
    aff = img.affine.copy(); aff[:3, 3] = img.affine[:3, :3] @ np.array(lo) + img.affine[:3, 3]
    cimg = nib.Nifti1Image(data[sl], aff)
    ct1 = nip.conform(cimg, out_shape=SHAPE, voxel_size=(VOX,) * 3, order=1, cval=0.0)
    x = ct1.get_fdata().astype(np.float32)
    p = np.percentile(x[x > 0], 99.5) if (x > 0).any() else 1.0
    x = np.clip(x / (p if p > 0 else 1.0), 0, 1).astype(np.float32)
    y = None
    if mask_path:
        m = nib.as_closest_canonical(nib.load(mask_path))
        md = np.asanyarray(m.dataobj).astype(np.float32)
        maff = m.affine.copy(); maff[:3, 3] = m.affine[:3, :3] @ np.array(lo) + m.affine[:3, 3]
        # crop mask with the SAME native bbox (same canonical grid as the T1)
        cm = nib.Nifti1Image(md[sl], maff)
        cmy = nip.conform(cm, out_shape=SHAPE, voxel_size=(VOX,) * 3, order=0, cval=0.0)
        y = (cmy.get_fdata() > 0.5).astype(np.float32)
    return x, y, {'affine': ct1.affine, 'src_affine': img.affine, 'bbox': (lo, hi), 'src_shape': data.shape}
