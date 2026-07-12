#!/usr/bin/env python3
"""Cache conformed (T1, teacher-mask) pairs as per-subject .npz for fast training. Re-runnable:
skips already-cached subjects, so run repeatedly as gen_teacher.py produces more masks.
Usage: preprocess.py [JOBS=6]"""
import os, sys, glob, re, time
from concurrent.futures import ProcessPoolExecutor
import numpy as np
sys.path.insert(0, os.path.dirname(__file__))
from common import conform

SRC = '/Users/super/Downloads/OASIS_T1s_Only'
WORK = '/Users/super/Downloads/OASIS_bet_work'
CACHE = os.environ.get('BET_CACHE', WORK + '/cache')          # override for CAT12 teacher (e.g. cat_cache)
MASK_GLOB = os.environ.get('BET_MASK_GLOB', f'{WORK}/mask/*_mask.nii.gz')   # FSL default; CAT12: cat_masks/*_p0.nii.gz
JOBS = int(sys.argv[1]) if len(sys.argv) > 1 else 6
os.makedirs(CACHE, exist_ok=True)

def t1_for(sub):
    g = sorted(glob.glob(f'{SRC}/{sub}_*.nii'))
    return g[0] if g else None

def one(mask_path):
    sub = re.search(r'(sub-OAS\d+)', os.path.basename(mask_path)).group(1)
    out = f'{CACHE}/{sub}.npz'
    if os.path.exists(out): return (sub, 'skip')
    t1 = t1_for(sub)
    if not t1: return (sub, 'no-t1')
    try:
        x, y, meta = conform(t1, mask_path)
        if y is None or y.mean() < 0.02 or y.mean() > 0.6: return (sub, f'bad-mask {y.mean():.3f}')
        np.savez_compressed(out, x=x.astype(np.float16), y=y.astype(np.uint8))
        return (sub, 'ok')
    except Exception as e:
        return (sub, 'ERR:' + str(e)[:50])

if __name__ == '__main__':
    masks = sorted(glob.glob(MASK_GLOB))
    print(f'{len(masks)} teacher masks found; caching -> {CACHE}', flush=True)
    t0 = time.time(); n = {}
    with ProcessPoolExecutor(max_workers=JOBS) as ex:
        for sub, st in ex.map(one, masks):
            k = st.split()[0].split(':')[0]; n[k] = n.get(k, 0) + 1
    print('counts:', n, f'| {(time.time()-t0)/60:.1f}m', flush=True)
    print('cached total:', len(glob.glob(f'{CACHE}/*.npz')), flush=True)
