#!/usr/bin/env python3
"""Generate teacher brain masks on OASIS T1s with AFNI 3dSkullStrip (offline teacher only —
we ship only our trained student weights, never this tool or its output). Deduped by subject,
run in parallel. Usage: gen_teacher.py [N=600] [JOBS=8]"""
import os, sys, glob, re, time, subprocess
from concurrent.futures import ProcessPoolExecutor
import nibabel as nib, numpy as np

SRC = '/Users/super/Downloads/OASIS_T1s_Only'
OUT = '/Users/super/Downloads/OASIS_bet_work'
SS  = os.path.expanduser('~/abin/3dSkullStrip')
N    = int(sys.argv[1]) if len(sys.argv) > 1 else 600
JOBS = int(sys.argv[2]) if len(sys.argv) > 2 else 8
os.makedirs(OUT + '/mask', exist_ok=True)

def subjects():
    seen, uniq = set(), []
    for f in sorted(glob.glob(SRC + '/*.nii')):
        m = re.search(r'(sub-OAS\d+)', os.path.basename(f))
        s = m.group(1) if m else os.path.basename(f)
        if s not in seen:
            seen.add(s); uniq.append((s, f))
    return uniq

def run(item):
    s, f = item
    out = f'{OUT}/mask/{s}_mask.nii.gz'
    if os.path.exists(out):
        return (s, 'skip', 0.0)
    tmp = f'{OUT}/mask/_{s}.nii'
    t0 = time.time()
    try:
        subprocess.run([SS, '-input', f, '-prefix', tmp, '-mask_vol', '-overwrite'],
                       capture_output=True, timeout=360, cwd=OUT + '/mask')
        im = nib.load(tmp)
        d = (np.asarray(im.dataobj) > 0.5).astype(np.uint8)
        nib.save(nib.Nifti1Image(d, im.affine, im.header), out)
        for x in glob.glob(f'{OUT}/mask/_{s}*'):
            try: os.remove(x)
            except OSError: pass
        return (s, 'ok', time.time() - t0)
    except Exception as e:
        return (s, 'ERR:' + str(e)[:50], time.time() - t0)

if __name__ == '__main__':
    uniq = subjects()[:N]
    print(f'{len(uniq)} subjects, {JOBS} jobs -> {OUT}/mask', flush=True)
    t0 = time.time(); done = ok = 0
    with ProcessPoolExecutor(max_workers=JOBS) as ex:
        for s, st, dt in ex.map(run, uniq):
            done += 1; ok += (st in ('ok', 'skip'))
            if done % 10 == 0 or st.startswith('ERR'):
                print(f'[{done}/{len(uniq)}] {s} {st} {dt:.0f}s | ok={ok} | {(time.time()-t0)/60:.1f}m', flush=True)
    print(f'DONE {ok}/{len(uniq)} in {(time.time()-t0)/60:.1f}m', flush=True)
