#!/usr/bin/env python3
"""Build a self-contained HTML QC gallery for the shipped BET model: run it on the user's T1/T2 +
held-out OASIS subjects, render axial/coronal/sagittal strips with the extraction boundary, and
embed everything as base64 so the page opens anywhere. Usage: qc_gallery.py [out.html] [N_held_out]"""
import os, sys, glob, re, io, base64, html
import numpy as np, torch, nibabel as nib
from scipy.ndimage import label, binary_fill_holes, binary_erosion, map_coordinates
from PIL import Image
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import common
from unet3d import UNet3D

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(f'{HERE}/../..')
SRC = '/Users/super/Downloads/OASIS_T1s_Only'
CATM = '/Users/super/Downloads/OASIS_bet_work/cat_masks'
OUT = sys.argv[1] if len(sys.argv) > 1 else f'{REPO}/bet_qc.html'
NHELD = int(sys.argv[2]) if len(sys.argv) > 2 else 12

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
    pn = prob_to_native(prob, Ta, aff, data.shape)
    mask = binary_fill_holes(largest_cc(pn > 0.5))
    return data, mask

def strip(data, mask, axis, nsl=6, tile=120):
    ax = np.where(mask.any(axis=tuple(a for a in range(3) if a != axis)))[0]
    if len(ax) == 0: ax = np.array([mask.shape[axis] // 2])
    lo, hi = ax.min(), ax.max(); zs = np.linspace(lo + 0.12 * (hi - lo), hi - 0.12 * (hi - lo), nsl).astype(int)
    lo2, hi2 = np.percentile(data[data > 0], 2), np.percentile(data[data > 0], 98)
    tiles = []
    for z in zs:
        if axis == 2: sl = data[:, :, z]; m = mask[:, :, z]
        elif axis == 1: sl = data[:, z, :]; m = mask[:, z, :]
        else: sl = data[z, :, :]; m = mask[z, :, :]
        sl = np.flipud(sl.T); m = np.flipud(m.T)
        g = np.clip((sl - lo2) / (hi2 - lo2 + 1e-6), 0, 1); rgb = np.stack([g, g, g], -1)
        e = m ^ binary_erosion(m); rgb[e] = [1.0, 0.30, 0.30]
        im = Image.fromarray((rgb * 255).astype(np.uint8))
        h = tile; w = max(1, int(im.width * tile / im.height)); tiles.append(im.resize((w, h)))
    W = sum(t.width for t in tiles) + 2 * (len(tiles) - 1); canv = Image.new('RGB', (W, tile), (8, 11, 16)); x = 0
    for t in tiles: canv.paste(t, (x, 0)); x += t.width + 2
    return canv

def montage_b64(data, mask):
    rows = [strip(data, mask, 2), strip(data, mask, 1), strip(data, mask, 0)]
    W = max(r.width for r in rows); H = sum(r.height for r in rows) + 4 * (len(rows) - 1)
    canv = Image.new('RGB', (W, H), (8, 11, 16)); y = 0
    for r in rows: canv.paste(r, (0, y)); y += r.height + 4
    buf = io.BytesIO(); canv.save(buf, 'JPEG', quality=82); return base64.b64encode(buf.getvalue()).decode()

# subject list: user's scans + held-out OASIS (indices well past the ~150 used for teacher/training)
allt1 = sorted(glob.glob(f'{SRC}/*.nii'))
held = allt1[220::max(1, (len(allt1) - 220) // NHELD)][:NHELD]
subs = []
if os.path.exists(f'{REPO}/T1_.nii.gz'): subs.append((f'{REPO}/T1_.nii.gz', 'Your T1', 'your scan'))
if os.path.exists(f'{REPO}/t2.nii.gz'): subs.append((f'{REPO}/t2.nii.gz', 'Your T2', 'your scan · T2 (model is T1-trained)'))
for f in held:
    sub = re.search(r'(sub-OAS\d+)', os.path.basename(f)); subs.append((f, sub.group(1) if sub else os.path.basename(f), 'held-out OASIS'))

cards = []; pcts = []
for path, name, tag in subs:
    try:
        data, mask = infer(path); pct = 100 * mask.mean(); pcts.append(pct)
        b64 = montage_b64(data, mask)
        chip = 'ok' if 8 <= pct <= 18 else 'watch'
        cards.append((name, tag, pct, chip, b64)); print(f'{name}: {pct:.1f}%', flush=True)
    except Exception as e:
        print(f'{name}: ERR {e}', flush=True)

mean_pct = np.mean(pcts) if pcts else 0
CARDS = '\n'.join(
    f'''<article class="card">
      <header><h2>{html.escape(n)}</h2><span class="pct">{p:.1f}%</span>
        <span class="chip {c}">{'in range' if c=='ok' else 'check'}</span></header>
      <div class="tag">{html.escape(t)}</div>
      <img alt="{html.escape(n)} extraction" src="data:image/jpeg;base64,{b}">
    </article>''' for (n, t, p, c, b) in cards)

DOC = f'''<div class="wrap">
  <header class="top">
    <div><div class="eyebrow">brainWhiz · brain-extraction QC</div>
      <h1>Extraction quality review</h1>
      <p class="sub">Shipped model run on your scans plus held-out OASIS subjects. Red outline = the extracted
      brain boundary. Each card shows <b>axial / coronal / sagittal</b> strips through the brain. Inspect the
      temporal poles, cerebellum, and brain stem for spill; the boundary should hug cortex and drop skull, eyes and neck.</p></div>
    <dl class="stats">
      <div><dt>Model</dt><dd>CAT12-taught 3D U-Net</dd></div>
      <div><dt>Train Dice</dt><dd>{ck.get('valDice',0):.3f}</dd></div>
      <div><dt>Subjects</dt><dd>{len(cards)}</dd></div>
      <div><dt>Mean brain</dt><dd>{mean_pct:.1f}%</dd></div>
    </dl>
  </header>
  <div class="legend"><span><i class="sw red"></i>extracted boundary</span>
    <span><i class="sw"></i>rows: axial · coronal · sagittal</span>
    <span class="chip ok">in range</span> healthy brain fraction (~8–18%)
    <span class="chip watch">check</span> inspect closely</div>
  <section class="grid">{CARDS}</section>
</div>'''

STYLE = '''
:root{--bg:#0b0e13;--panel:#141a22;--panel2:#0e131a;--line:#232c38;--txt:#c7d0dc;--mut:#7c8899;
  --accent:#4fb0cf;--red:#ff4d4d;--ok:#2fbf9f;--watch:#e0a83e;--radius:12px}
:root[data-theme="light"]{--bg:#eef1f5;--panel:#fff;--panel2:#f3f6fa;--line:#d3dae3;--txt:#1e2732;--mut:#5a6675;--accent:#1f7fa0}
@media(prefers-color-scheme:light){:root{--bg:#eef1f5;--panel:#fff;--panel2:#f3f6fa;--line:#d3dae3;--txt:#1e2732;--mut:#5a6675;--accent:#1f7fa0}}
:root[data-theme="dark"]{--bg:#0b0e13;--panel:#141a22;--panel2:#0e131a;--line:#232c38;--txt:#c7d0dc;--mut:#7c8899;--accent:#4fb0cf}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--txt);font:15px/1.55 system-ui,-apple-system,Segoe UI,Roboto,sans-serif}
.wrap{max-width:1200px;margin:0 auto;padding:32px 24px 64px}
.top{display:flex;justify-content:space-between;gap:32px;flex-wrap:wrap;align-items:flex-start;
  border-bottom:1px solid var(--line);padding-bottom:22px;margin-bottom:22px}
.eyebrow{text-transform:uppercase;letter-spacing:.14em;font-size:11px;color:var(--accent);font-weight:600}
h1{font-size:30px;margin:6px 0 8px;letter-spacing:-.02em;text-wrap:balance}
.sub{color:var(--mut);max-width:62ch;margin:0;font-size:13.5px}
.stats{display:grid;grid-template-columns:repeat(2,auto);gap:14px 26px;margin:0}
.stats dt{font-size:10.5px;text-transform:uppercase;letter-spacing:.1em;color:var(--mut)}
.stats dd{margin:1px 0 0;font:600 17px/1.2 ui-monospace,SFMono-Regular,Menlo,monospace;font-variant-numeric:tabular-nums}
.legend{display:flex;gap:18px;flex-wrap:wrap;align-items:center;font-size:12px;color:var(--mut);margin-bottom:18px}
.legend span{display:inline-flex;gap:6px;align-items:center}
.sw{width:13px;height:13px;border-radius:3px;background:var(--mut);display:inline-block}
.sw.red{background:var(--red)}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(340px,1fr));gap:16px}
.card{background:var(--panel);border:1px solid var(--line);border-radius:var(--radius);overflow:hidden}
.card header{display:flex;align-items:center;gap:8px;padding:11px 13px 4px}
.card h2{font-size:14px;margin:0;flex:1;font-weight:600;letter-spacing:-.01em;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.pct{font:600 14px/1 ui-monospace,Menlo,monospace;font-variant-numeric:tabular-nums;color:var(--accent)}
.chip{font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.05em;padding:2px 7px;border-radius:999px;white-space:nowrap}
.chip.ok{background:color-mix(in srgb,var(--ok) 20%,transparent);color:var(--ok)}
.chip.watch{background:color-mix(in srgb,var(--watch) 22%,transparent);color:var(--watch)}
.tag{padding:0 13px 8px;font-size:11px;color:var(--mut)}
.card img{display:block;width:100%;background:#080b10;border-top:1px solid var(--line)}
'''
open(OUT, 'w').write(f'<style>{STYLE}</style>\n{DOC}')
print(f'\nwrote {OUT} ({os.path.getsize(OUT)//1024} KB, {len(cards)} subjects)')
