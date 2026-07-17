#!/usr/bin/env python3
"""Interactive QC for the HIGH-RES 3-class model. Runs bet_unet.pt (bg/CSF/GM/WM) at its native
conform resolution on the user's scans + held-out OASIS, and shows the GM+WM 'broccoli' surface
(the thing the 2mm envelope model couldn't trace) with CSF/brain toggles. Usage: qc_hires.py [out.html] [N]"""
import os, sys, glob, re, gzip, base64, json
os.environ.setdefault('BET_SHAPE', '192,224,192')   # must match the trained checkpoint (asserted below)
os.environ.setdefault('BET_VOX', '1.0')
import numpy as np, torch, nibabel as nib
from scipy.ndimage import label, binary_fill_holes, gaussian_filter, zoom as ndzoom
SMOOTH = float(os.environ.get('BET_SMOOTH', '0.7'))   # voxels; gentle boundary de-jag, keeps sulci (<1 vox)
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import common
from unet3d import UNet3D

HERE = os.path.dirname(os.path.abspath(__file__)); REPO = os.path.abspath(f'{HERE}/../..')
SRC  = '/Users/super/Downloads/OASIS_T1s_Only'
CACHE = '/Users/super/Downloads/OASIS_bet_work/cache_hires_1mm'   # to exclude trained subjects from QC
OUT  = sys.argv[1] if len(sys.argv) > 1 else f'{REPO}/bet_qc_hires.html'
NSHOW = int(sys.argv[2]) if len(sys.argv) > 2 else 14
CAP = 176

def largest_cc(m):
    lab, n = label(m)
    if n <= 1: return m
    s = np.bincount(lab.ravel()); s[0] = 0; return lab == s.argmax()

ck = torch.load(os.environ.get('BET_CKPT', f'{HERE}/bet_unet.pt'), map_location='cpu')
assert list(ck['shape']) == list(common.SHAPE) and abs(ck['vox'] - common.VOX) < 1e-6, \
    f"checkpoint {ck['shape']}@{ck['vox']} != env {common.SHAPE}@{common.VOX}"
NC = ck.get('ch_out', 1)
DEV = 'mps' if torch.backends.mps.is_available() else ('cuda' if torch.cuda.is_available() else 'cpu')
model = UNet3D(base=ck['base'], ch_out=NC).eval().to(DEV); model.load_state_dict(ck['state_dict'])
print(f"model: {NC}-class base={ck['base']} shape={ck['shape']} vox={ck['vox']} valDice={ck.get('valDice',0):.3f} dev={DEV}")

def infer(path):
    """conform to model grid, run, return (conformed T1 [0,1], label volume in conform space).
    Cleanup = keep only the largest connected brain component (same as the shipped worker) so
    disconnected false positives (eye/orbit specks, midline dots) don't show."""
    x, _, meta = common.conform(path)                # x float32 [0,1], SHAPE
    with torch.no_grad():
        out = model(torch.from_numpy(x)[None, None].to(DEV))
        if NC > 1:
            prob = torch.softmax(out, 1).cpu().numpy()[0]                     # (C,X,Y,Z)
            if SMOOTH > 0:
                for c in range(prob.shape[0]): prob[c] = gaussian_filter(prob[c], SMOOTH)
            lab = prob.argmax(0).astype(np.uint8)
        else:
            p = torch.sigmoid(out)[0, 0].cpu().numpy()
            if SMOOTH > 0: p = gaussian_filter(p, SMOOTH)
            lab = (p > 0.5).astype(np.uint8)
    keep = largest_cc(lab > 0)                        # drop islands not attached to the brain (eye/orbit specks)
    lab = (lab * keep).astype(np.uint8)
    return x, lab

def pack(x, lab):
    brain = lab > 0
    idx = np.where(brain)
    if len(idx[0]) == 0: idx = np.where(x > x.mean())
    lo = [max(0, idx[d].min() - 6) for d in range(3)]; hi = [min(x.shape[d], idx[d].max() + 7) for d in range(3)]
    sl = tuple(slice(lo[d], hi[d]) for d in range(3)); d = x[sl]; L = lab[sl]
    f = max(1.0, max(d.shape) / CAP)
    if f > 1.0:
        d = ndzoom(d, 1.0/f, order=1); L = ndzoom(L, 1.0/f, order=0)
    p2, p98 = np.percentile(d[d > 0], 2), np.percentile(d[d > 0], 98)
    du8 = np.clip((d - p2)/(p98 - p2 + 1e-6)*255, 0, 255).astype(np.uint8)
    b = lambda a: base64.b64encode(gzip.compress(np.ascontiguousarray(a.transpose(2,1,0)).tobytes(), 6)).decode()
    return list(du8.shape), b(du8), b(L.astype(np.uint8))   # dims, T1, label(0/1/2/3)

# subjects: user's scans first, then held-out OASIS (NOT in the training cache)
trained = {re.search(r'(sub-OAS\d+)', os.path.basename(f)).group(1) for f in glob.glob(f'{CACHE}/*.npz')}
subs = []
for label_, path, tag in [('Your T1', f'{REPO}/T1_.nii.gz', 'your scan'),
                          ('Your T2', f'{REPO}/t2.nii.gz', 'your scan (T2 — T1-trained model)')]:
    if os.path.exists(path): subs.append((label_, path, tag))
allt1 = sorted(glob.glob(f'{SRC}/*.nii'))
held = [f for f in allt1 if (m := re.search(r'(sub-OAS\d+)', os.path.basename(f))) and m.group(1) not in trained]
for f in held[::max(1, len(held)//max(1, NSHOW))][:NSHOW]:
    subs.append((re.search(r'(sub-OAS\d+)', os.path.basename(f)).group(1), f, 'held-out OASIS'))

items = []
for name, path, tag in subs:
    try:
        x, lab = infer(path)
        gmwm = 100*np.mean(lab >= 2); brain = 100*np.mean(lab > 0)
        dims, t1b, lb = pack(x, lab)
        items.append({'name': name, 'tag': tag, 'pct': round(gmwm, 1), 'brain': round(brain, 1),
                      'hard': bool(gmwm < 8 or gmwm > 16), 'dims': dims, 't1': t1b, 'lab': lb})
        print(f'  {name}: GM+WM {gmwm:.1f}%  brain {brain:.1f}%  dims={dims}', flush=True)
    except Exception as e: print('  ERR', name, e)

DATA = json.dumps(items).replace('</', '<\\/')
meta = {'model': f'{NC}-class 1mm U-Net (CAT12-taught)', 'dice': round(ck.get('valDice', 0), 3), 'n': len(items)}
tpl = open(f'{HERE}/qc_hires_template.html').read()
open(OUT, 'w').write(tpl.replace('/*__META__*/', json.dumps(meta)).replace('/*__DATA__*/', DATA))
print(f'\nwrote {OUT} ({os.path.getsize(OUT)//1024} KB, {len(items)} subjects)')
