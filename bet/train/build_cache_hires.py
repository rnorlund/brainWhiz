#!/usr/bin/env python3
"""Build the HIGH-RES 3-class training cache from CAT12 native p0 masks + OASIS T1s.
Target = tissue labels (0 bg / 1 CSF / 2 GM / 3 WM) at 1mm on the proven 192x224x192mm FOV, so the
student learns to carve the CSF and trace the GM/WM 'broccoli' (vs the shipped 2mm envelope model).
Transfer the resulting npz cache to Spark for training. Usage: build_cache_hires.py [WORKERS=2]"""
import os, sys
os.environ.setdefault('BET_SHAPE', '192,224,192')   # 1mm, same physical FOV as the 2mm model (=192x224x192mm)
os.environ.setdefault('BET_VOX', '1.0')             # set BEFORE importing common so its globals pick these up
import glob, re, numpy as np
from concurrent.futures import ProcessPoolExecutor, as_completed
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import common

SRC   = '/Users/super/Downloads/OASIS_T1s_Only'
CATM  = '/Users/super/Downloads/OASIS_bet_work/cat_masks'
OUT   = '/Users/super/Downloads/OASIS_bet_work/cache_hires_1mm'
WORK  = int(sys.argv[1]) if len(sys.argv) > 1 else 2
os.makedirs(OUT, exist_ok=True)

def t1_for(sid):
    m = sorted(glob.glob(f'{SRC}/{sid}_*T1w.nii'))
    return m[0] if m else None

def build(sid):
    outp = f'{OUT}/{sid}.npz'
    if os.path.exists(outp): return f'{sid} exists'
    t1 = t1_for(sid)
    if not t1: return f'{sid} NO-T1'
    p0 = f'{CATM}/{sid}_p0.nii.gz'
    x, y, meta = common.conform(t1, p0)                          # x~[0,1] float, y in {0,1,2,3}
    y = y.astype(np.uint8)
    # coverage QC: brain (y>0) voxels touching a box face => the FOV clipped the head
    b = (y > 0); faces = b[0].sum()+b[-1].sum()+b[:,0].sum()+b[:,-1].sum()+b[:,:,0].sum()+b[:,:,-1].sum()
    clip = 100.0 * faces / max(b.sum(), 1)
    np.savez_compressed(outp, x=x.astype(np.float16), y=y)
    frac = {c: int((y == c).sum()) for c in (1, 2, 3)}
    return f'{sid} brain={100*b.mean():.1f}% clip={clip:.2f}% CSF/GM/WM={frac[1]},{frac[2]},{frac[3]}'

def main():
    sids = sorted({re.search(r'(sub-OAS\d+)', os.path.basename(f)).group(1)
                   for f in glob.glob(f'{CATM}/*_p0.nii.gz')})
    print(f'{len(sids)} subjects with CAT12 masks -> {OUT}  (SHAPE={common.SHAPE} VOX={common.VOX}, {WORK} workers)', flush=True)
    done = 0
    with ProcessPoolExecutor(max_workers=WORK) as ex:
        futs = {ex.submit(build, s): s for s in sids}
        for fu in as_completed(futs):
            done += 1; print(f'[{done}/{len(sids)}] {fu.result()}', flush=True)
    print('CACHE DONE:', len(glob.glob(f'{OUT}/*.npz')), 'npz in', OUT, flush=True)

if __name__ == '__main__':   # required for macOS 'spawn' — workers import this module, must not re-run main
    main()
