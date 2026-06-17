import scipy.io as sio, numpy as np, glob, os, json

MATS = sorted(glob.glob('/Users/super/Documents/praneshPaperDTI/mats/*.mat'))
N = 189
acc = np.zeros((N, N)); cnt = np.zeros((N, N)); used = 0; skipped = []

for f in MATS:
    try:
        m = sio.loadmat(f)
        if 'dti_jhu' not in m: 
            skipped.append(os.path.basename(f)); continue
        r = np.array(m['dti_jhu'][0,0]['r'], dtype=float)
        if r.shape != (N, N):
            skipped.append(os.path.basename(f)+f"({r.shape})"); continue
        mask = np.isfinite(r)
        acc[mask] += r[mask]; cnt[mask] += 1; used += 1
    except Exception as e:
        skipped.append(os.path.basename(f)+f"[{type(e).__name__}]")

avg = np.divide(acc, cnt, out=np.zeros_like(acc), where=cnt>0)
avg = 0.5*(avg+avg.T)          # symmetrize
np.fill_diagonal(avg, 0)
print(f"averaged {used}/{len(MATS)} mats; skipped {len(skipped)}")
if skipped[:10]: print("skip sample:", skipped[:10])

# upper-triangle edges, sorted by strength
edges = []
for i in range(N):
    for j in range(i+1, N):
        w = avg[i,j]
        if w > 0:
            edges.append([i+1, j+1, round(float(w),3)])   # roi ids are 1-based
edges.sort(key=lambda e:-e[2])
ws = [e[2] for e in edges]
print(f"{len(edges)} edges; weight max {max(ws):.2f} median {np.median(ws):.3f} p90 {np.percentile(ws,90):.2f}")

with open('conn.js','w') as fh:
    fh.write("window.JHU_CONN = ")
    json.dump({"n_subjects":used,"max":round(max(ws),3),
               "edges":edges}, fh)
    fh.write(";\n")
print("wrote conn.js", os.path.getsize('conn.js')/1e6, "MB")
