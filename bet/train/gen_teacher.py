#!/usr/bin/env python3
"""Generate teacher brain masks on OASIS T1s with FSL bet2 (offline teacher only — we ship only our
trained student weights, never this tool or its output). ~4s/subject → the full set in minutes on
12 cores. Usage: gen_teacher.py [N=all] [JOBS=10]
Requires a patched-libs dir (macOS libgfortran rpath fix) at $FSL_PATCHED_LIBS."""
import os, sys, glob, re, time, subprocess
from concurrent.futures import ProcessPoolExecutor
import nibabel as nib, numpy as np

SRC   = '/Users/super/Downloads/OASIS_T1s_Only'
OUT   = '/Users/super/Downloads/OASIS_bet_work'
FSLDIR = '/usr/local/fsl'; BET2 = f'{FSLDIR}/bin/bet2'
LIBS  = os.environ.get('FSL_PATCHED_LIBS', OUT + '/fsllibs')
ENV   = dict(os.environ, FSLDIR=FSLDIR, FSLOUTPUTTYPE='NIFTI_GZ', DYLD_LIBRARY_PATH=LIBS)
JOBS  = int(sys.argv[2]) if len(sys.argv) > 2 else 10
os.makedirs(OUT + '/mask', exist_ok=True)

def subjects():
    seen, uniq = set(), []
    for f in sorted(glob.glob(SRC + '/*.nii')):
        m = re.search(r'(sub-OAS\d+)', os.path.basename(f)); s = m.group(1) if m else os.path.basename(f)
        if s not in seen: seen.add(s); uniq.append((s, f))
    return uniq

def run(item):
    s, f = item
    out = f'{OUT}/mask/{s}_mask.nii.gz'
    if os.path.exists(out): return (s, 'skip', 0.0)
    pre = f'{OUT}/mask/_{s}'; t0 = time.time()
    try:
        r = subprocess.run([BET2, f, pre, '-m', '-f', '0.5'], env=ENV, capture_output=True, timeout=120)
        mk = pre + '_mask.nii.gz'
        if not os.path.exists(mk): return (s, 'ERR:no-mask ' + r.stderr.decode()[:40], time.time() - t0)
        im = nib.load(mk); d = (np.asarray(im.dataobj) > 0.5).astype(np.uint8)
        nib.save(nib.Nifti1Image(d, im.affine, im.header), out)
        for x in glob.glob(pre + '*'):
            try: os.remove(x)
            except OSError: pass
        return (s, 'ok', time.time() - t0)
    except Exception as e:
        return (s, 'ERR:' + str(e)[:50], time.time() - t0)

if __name__ == '__main__':
    uniq = subjects()
    if len(sys.argv) > 1 and sys.argv[1] != 'all': uniq = uniq[:int(sys.argv[1])]
    print(f'{len(uniq)} subjects, {JOBS} jobs, bet2 -> {OUT}/mask (libs {LIBS})', flush=True)
    t0 = time.time(); done = ok = 0
    with ProcessPoolExecutor(max_workers=JOBS) as ex:
        for s, st, dt in ex.map(run, uniq):
            done += 1; ok += (st in ('ok', 'skip'))
            if done % 50 == 0 or st.startswith('ERR'):
                print(f'[{done}/{len(uniq)}] {s} {st} {dt:.1f}s | ok={ok} | {(time.time()-t0)/60:.1f}m', flush=True)
    print(f'DONE {ok}/{len(uniq)} in {(time.time()-t0)/60:.1f}m', flush=True)
