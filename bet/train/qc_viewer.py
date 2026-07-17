#!/usr/bin/env python3
"""Interactive BET QC viewer: run the shipped model on the user's scans + a large held-out OASIS
sample, pick normal + outlier ("hard") cases, embed compact gzipped volumes, and emit a self-contained
HTML viewer (scrub/zoom/pan/mask-toggle/plane-switch). Usage: qc_viewer.py [out.html] [N_scan] [N_show]"""
import os, sys, glob, re, io, gzip, base64, json, html
import numpy as np, torch, nibabel as nib
from scipy.ndimage import label, binary_fill_holes, map_coordinates, zoom as ndzoom
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import common
from unet3d import UNet3D

HERE = os.path.dirname(os.path.abspath(__file__)); REPO = os.path.abspath(f'{HERE}/../..')
SRC = '/Users/super/Downloads/OASIS_T1s_Only'
OUT = sys.argv[1] if len(sys.argv) > 1 else f'{REPO}/bet_qc_viewer.html'
NSCAN = int(sys.argv[2]) if len(sys.argv) > 2 else 40      # how many OASIS to run
NSHOW = int(sys.argv[3]) if len(sys.argv) > 3 else 22      # how many to embed (normals + outliers)
CAP = 150                                                  # max voxel dim per axis (QC resolution)

def largest_cc(m):
    lab, n = label(m)
    if n <= 1: return m
    s = np.bincount(lab.ravel()); s[0] = 0; return lab == s.argmax()

def prob_to_native(prob, Ta, aff, shape):
    nx, ny, nz = shape
    gi, gj, gk = np.meshgrid(np.arange(nx), np.arange(ny), np.arange(nz), indexing='ij')
    world = np.asarray(aff) @ np.stack([gi.ravel(), gj.ravel(), gk.ravel(), np.ones(gi.size)], 0)
    cc = (np.linalg.inv(np.asarray(Ta)) @ world)[:3]
    return map_coordinates(prob, cc, order=1, cval=0.0).reshape(shape)

ck = torch.load(f'{HERE}/bet_unet.pt', map_location='cpu')
model = UNet3D(base=ck['base'], ch_out=ck.get('ch_out', 1)).eval(); model.load_state_dict(ck['state_dict'])

def infer(path):
    img = nib.as_closest_canonical(nib.load(path))
    data = np.asanyarray(img.dataobj).astype(np.float32); aff = img.affine.astype(np.float64)
    Ta, lo, hi = common.target_affine(aff, data=data)
    x = common._resample(data, aff, Ta, order=1).astype(np.float32)
    pos = x[x > 0]; p = np.percentile(pos, 99.5) if pos.size else 1.0
    x = np.clip(x / (p if p > 0 else 1.0), 0, 1).astype(np.float32)
    with torch.no_grad():
        out = model(torch.from_numpy(x)[None, None])
        prob = torch.sigmoid(out).numpy()[0, 0] if out.shape[1] == 1 else (out.argmax(1) > 0).float().numpy()[0]
    mask = binary_fill_holes(largest_cc(prob_to_native(prob, Ta, aff, data.shape) > 0.5))
    return data, mask

def pack(data, mask):
    # crop to brain bbox (+margin), downsample to CAP, uint8-window the T1
    idx = np.where(mask)
    if len(idx[0]) == 0: idx = np.where(data > data.mean())
    lo = [max(0, idx[d].min() - 10) for d in range(3)]; hi = [min(data.shape[d], idx[d].max() + 11) for d in range(3)]
    sl = tuple(slice(lo[d], hi[d]) for d in range(3)); d = data[sl].astype(np.float32); m = mask[sl].astype(np.float32)
    f = max(1.0, max(d.shape) / CAP)
    if f > 1.0:
        d = ndzoom(d, 1.0 / f, order=1); m = ndzoom(m, 1.0 / f, order=0)
    p2, p98 = np.percentile(d[d > 0], 2), np.percentile(d[d > 0], 98)
    du8 = np.clip((d - p2) / (p98 - p2 + 1e-6) * 255, 0, 255).astype(np.uint8)
    mu8 = (m > 0.5).astype(np.uint8)
    b = lambda a: base64.b64encode(gzip.compress(a.transpose(2, 1, 0).tobytes(), 6)).decode()  # z,y,x order for JS
    return list(du8.shape), b(du8), b(mu8)

allt1 = sorted(glob.glob(f'{SRC}/*.nii')); held = allt1[220:220 + NSCAN * 9:9][:NSCAN]
scanned = []
for f in held:
    try:
        data, mask = infer(f); pct = 100 * mask.mean()
        scanned.append({'path': f, 'name': re.search(r'(sub-OAS\d+)', os.path.basename(f)).group(1), 'pct': pct})
        print(f'  scan {len(scanned)}/{len(held)} {scanned[-1]["name"]} {pct:.1f}%', flush=True)
    except Exception as e: print('  skip', e)
scanned.sort(key=lambda s: s['pct'])
# hard cases = brain-fraction extremes; fill the rest with evenly-spaced "normal" ones
k = max(3, NSHOW // 4)
picks = scanned[:k] + scanned[-k:]
mid = scanned[k:-k]
if mid: picks += [mid[i] for i in np.linspace(0, len(mid) - 1, max(0, NSHOW - 2 * k)).astype(int)]
seen = set(); picks = [p for p in picks if not (p['name'] in seen or seen.add(p['name']))]

subs = []
for tag, label_, path in ([('your scan', 'Your T1', f'{REPO}/T1_.nii.gz'), ('your scan · T2 (model is T1-trained)', 'Your T2', f'{REPO}/t2.nii.gz')]
                          if os.path.exists(f'{REPO}/T1_.nii.gz') else []):
    if os.path.exists(path): subs.append((path, label_, tag, None))
for p in picks:
    hard = p['pct'] < 9.5 or p['pct'] > 15.5
    subs.append((p['path'], p['name'], 'held-out OASIS' + (' · outlier' if hard else ''), p['pct']))

items = []
for path, name, tag, pct in subs:
    try:
        data, mask = infer(path); pp = 100 * mask.mean() if pct is None else pct
        dims, t1b, mkb = pack(data, mask)
        items.append({'name': name, 'tag': tag, 'pct': round(pp := (100 * mask.mean()), 1),
                      'hard': bool(pp < 9.5 or pp > 15.5), 'dims': dims, 't1': t1b, 'mask': mkb})
        print(f'packed {name} {items[-1]["pct"]}% dims={dims}', flush=True)
    except Exception as e: print('ERR', name, e)

DATA = json.dumps(items).replace('</', '<\\/')
meta = {'model': 'CAT12-taught 3D U-Net', 'dice': round(ck.get('valDice', 0), 3), 'n': len(items)}
tpl = open(f'{HERE}/qc_viewer_template.html').read()
open(OUT, 'w').write(tpl.replace('/*__META__*/', json.dumps(meta)).replace('/*__DATA__*/', DATA))
print(f'\nwrote {OUT} ({os.path.getsize(OUT)//1024} KB, {len(items)} subjects)')
