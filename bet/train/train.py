#!/usr/bin/env python3
"""Train the 3D U-Net brain extractor on cached (T1, teacher-mask) pairs. CUDA (Spark GB10) > MPS > CPU.
Parallel DataLoader workers do augmentation so the GPU isn't starved. Saves best-Dice weights to
bet_unet.pt, a loss/Dice curve, and periodic val QC montages. Usage: train.py [EPOCHS=60] [BATCH=12] [BASE=16] [WORKERS=8]"""
import os, sys, glob, re, time, random, json
import numpy as np, torch, torch.nn as nn, torch.nn.functional as F
from torch.utils.data import Dataset, DataLoader
from scipy.ndimage import gaussian_filter, zoom
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)) or '.')
from unet3d import UNet3D

HERE = os.path.dirname(os.path.abspath(__file__)) or '.'
CACHE = os.environ.get('BET_CACHE', '/Users/super/Downloads/OASIS_bet_work/cache')
EPOCHS  = int(sys.argv[1]) if len(sys.argv) > 1 else 60
BATCH   = int(sys.argv[2]) if len(sys.argv) > 2 else 12
BASE    = int(sys.argv[3]) if len(sys.argv) > 3 else 16
WORKERS = int(sys.argv[4]) if len(sys.argv) > 4 else 8
NCLASS  = int(sys.argv[5]) if len(sys.argv) > 5 else 1   # 1=binary brain; 4=bg/CSF/GM/WM compartments
DEV = 'cuda' if torch.cuda.is_available() else ('mps' if torch.backends.mps.is_available() else 'cpu')

def load_all():
    out = []
    for f in sorted(glob.glob(f'{CACHE}/*.npz')):
        sub = re.search(r'(sub-OAS\d+)', os.path.basename(f)).group(1)
        d = np.load(f); out.append((sub, d['x'].astype(np.float16), d['y'].astype(np.uint8)))
    return out

def _shift(a, s):                                                              # zero-fill translation (NO wrap)
    out = np.zeros_like(a)
    src = tuple(slice(max(0, -s[d]), a.shape[d] - max(0, s[d])) for d in range(3))
    dst = tuple(slice(max(0, s[d]), a.shape[d] - max(0, -s[d])) for d in range(3))
    out[dst] = a[src]; return out

def _bias(shape, strength):                                                    # smooth multiplicative inhomogeneity
    lo = (np.random.randn(4, 4, 4).astype(np.float32)) * strength
    f = zoom(lo, (shape[0] / 4, shape[1] / 4, shape[2] / 4), order=1)[:shape[0], :shape[1], :shape[2]]
    return np.exp(f).astype(np.float32)

def _renorm(x):                                                                # back to ~[0,1] like the inference conform
    x = np.clip(x, 0, None); pos = x[x > 0]
    p = np.percentile(pos, 99.5) if pos.size else 1.0
    return np.clip(x / (p if p > 0 else 1.0), 0, 1).astype(np.float32)

# Contrast-invariant augmentation: the brain MASK is the same anatomy no matter how tissues are
# rendered, so we throw wildly varied intensity transforms at x (gamma, inversion≈T2/FLAIR, bias,
# blur, noise) while keeping y fixed → the net learns to find the brain regardless of contrast.
def augment(x, y):
    if random.random() < 0.5: x = x[::-1].copy(); y = y[::-1].copy()          # LR flip (RAS x)
    if random.random() < 0.6:                                                  # zero-fill translation
        s = (random.randint(-4, 4), random.randint(-4, 4), random.randint(-4, 4))
        x = _shift(x, s); y = _shift(y, s)
    x = x.astype(np.float32)
    if random.random() < 0.5:                                                  # wide gamma
        x = np.power(np.clip(x, 0, 1), random.uniform(0.5, 2.2))
    if random.random() < 0.3:                                                  # foreground inversion (T1→T2-ish flip of tissue brightness)
        fg = x > 0.03
        if fg.any(): mx = float(x[fg].max()); x[fg] = mx - x[fg]
    if random.random() < 0.4: x = x * _bias(x.shape, random.uniform(0.2, 0.5))  # scanner intensity inhomogeneity
    if random.random() < 0.25: x = gaussian_filter(x, sigma=random.uniform(0.4, 1.1))  # resolution/SNR
    if random.random() < 0.4: x = x + np.random.randn(*x.shape).astype(np.float32) * random.uniform(0.01, 0.06)  # noise
    if random.random() < 0.5: x = x * random.uniform(0.8, 1.25) + random.uniform(-0.06, 0.06)  # brightness/contrast
    x = _renorm(x)
    return np.ascontiguousarray(x, np.float32), np.ascontiguousarray(y, np.float32)

class BetDS(Dataset):
    def __init__(self, items, train): self.items = items; self.train = train
    def __len__(self): return len(self.items)
    def __getitem__(self, i):
        _, xf, yf = self.items[i]; x = xf.astype(np.float32); y = yf.astype(np.float32)
        if self.train: x, y = augment(x, y)
        return torch.from_numpy(x)[None], torch.from_numpy(y)[None]

def dice_loss(logit, y):                                   # binary
    p = torch.sigmoid(logit); inter = (p * y).sum((2, 3, 4)); s = p.sum((2, 3, 4)) + y.sum((2, 3, 4))
    return (1 - (2 * inter + 1) / (s + 1)).mean()

def dice_mc(logit, y_long):                                # multi-class (foreground classes)
    C = logit.shape[1]; p = torch.softmax(logit, 1)
    oh = F.one_hot(y_long.clamp(0, C - 1), C).permute(0, 4, 1, 2, 3).float()
    inter = (p * oh).sum((2, 3, 4)); s = p.sum((2, 3, 4)) + oh.sum((2, 3, 4))
    return (1 - ((2 * inter + 1) / (s + 1))[:, 1:].mean())

@torch.no_grad()
def val_dice(model, vl):                                   # brain Dice (foreground) — comparable across modes
    model.eval(); ds = []
    for X, Y in vl:
        X = X.to(DEV); Y = Y.to(DEV); out = model(X)
        p = (torch.sigmoid(out) > 0.5).float() if out.shape[1] == 1 else (out.argmax(1, keepdim=True) > 0).float()
        yb = (Y > 0).float()
        inter = (p * yb).sum((2, 3, 4)); s = p.sum((2, 3, 4)) + yb.sum((2, 3, 4))
        ds += ((2 * inter + 1) / (s + 1)).cpu().numpy().tolist()
    return float(np.mean(ds))

def qc(model, val_items, epoch):
    try:
        from PIL import Image; from scipy.ndimage import binary_erosion
        model.eval(); _, xf, yf = val_items[0]; x = xf.astype(np.float32); y = yf.astype(np.float32)
        with torch.no_grad():
            out = model(torch.from_numpy(x)[None, None].to(DEV)); mc = out.shape[1] > 1
            lab = out.argmax(1).cpu().numpy()[0] if mc else (torch.sigmoid(out) > 0.5).cpu().numpy()[0, 0].astype(np.uint8)
        COL = {1: [.3, .5, 1], 2: [.2, 1, .3], 3: [1, .4, .3]}   # CSF blue / GM green / WM red
        nz = x.shape[2]; cols, rows = 6, 2; n = cols * rows; tiles = []
        for i in range(n):
            z = int((0.18 + 0.64 * i / (n - 1)) * nz); sl = x[:, :, z].T[::-1]; rgb = np.stack([sl] * 3, -1)
            L = lab[:, :, z].T[::-1]
            if mc:
                for c, col in COL.items(): m = (L == c); rgb[m ^ binary_erosion(m)] = col
            else:
                m = (L > 0); rgb[m ^ binary_erosion(m)] = [1, .2, .2]
                gt = (y[:, :, z] > 0).T[::-1]; rgb[gt ^ binary_erosion(gt)] = [.1, 1, .1]
            tiles.append((np.clip(rgb, 0, 1) * 255).astype(np.uint8))
        h, w = tiles[0].shape[:2]; canv = np.zeros((rows * h, cols * w, 3), np.uint8)
        for i, t in enumerate(tiles): r, c = divmod(i, cols); canv[r*h:(r+1)*h, c*w:(c+1)*w] = t
        Image.fromarray(canv).save(f'{HERE}/qc_epoch{epoch:03d}.png')
    except Exception as e: print('qc fail', e, flush=True)

def main():
    data = load_all(); rng = random.Random(42); rng.shuffle(data)
    nval = max(4, int(0.15 * len(data))); val = data[:nval]; train = data[nval:]
    print(f'device {DEV} | {len(data)} subjects -> train {len(train)} val {len(val)} | base {BASE} batch {BATCH} workers {WORKERS} epochs {EPOCHS}', flush=True)
    pin = (DEV == 'cuda')
    tl = DataLoader(BetDS(train, True), batch_size=BATCH, shuffle=True, num_workers=WORKERS, pin_memory=pin, persistent_workers=False, drop_last=True, timeout=120 if WORKERS>0 else 0)
    vl = DataLoader(BetDS(val, False), batch_size=BATCH, shuffle=False, num_workers=max(2, WORKERS // 2), pin_memory=pin, persistent_workers=False, timeout=120 if WORKERS>0 else 0)
    model = UNet3D(base=BASE, ch_out=NCLASS).to(DEV)
    opt = torch.optim.Adam(model.parameters(), 1e-3)
    sched = torch.optim.lr_scheduler.CosineAnnealingLR(opt, EPOCHS)
    best = 0.0; hist = []
    for ep in range(EPOCHS):
        model.train(); t0 = time.time(); tot = 0.0; nb = 0
        for X, Y in tl:
            X = X.to(DEV, non_blocking=True); Y = Y.to(DEV, non_blocking=True)
            opt.zero_grad()
            with torch.autocast(device_type='cuda', dtype=torch.bfloat16, enabled=(DEV == 'cuda')):
                out = model(X)
                if NCLASS > 1:
                    yl = Y.squeeze(1).long()
                    loss = F.cross_entropy(out, yl) + dice_mc(out, yl)
                else:
                    yb = (Y > 0).float()
                    loss = 0.5 * F.binary_cross_entropy_with_logits(out, yb) + 0.5 * dice_loss(out, yb)
            loss.backward(); opt.step(); tot += float(loss.detach()); nb += 1
        sched.step(); vd = val_dice(model, vl); hist.append((tot / max(nb, 1), vd))
        print(f'ep {ep+1}/{EPOCHS} loss {tot/max(nb,1):.4f} valDice {vd:.4f} best {best:.4f} {(time.time()-t0)/60:.2f}m', flush=True)
        if vd > best:
            best = vd
            torch.save({'state_dict': model.state_dict(), 'base': BASE, 'depth': 4, 'ch_out': NCLASS, 'shape': [96, 112, 96], 'vox': 2.0, 'valDice': best}, f'{HERE}/bet_unet.pt')
        if (ep + 1) % 5 == 0 or ep == EPOCHS - 1: qc(model, val, ep + 1)
    json.dump(hist, open(f'{HERE}/train_hist.json', 'w'))
    try:
        import matplotlib; matplotlib.use('Agg'); import matplotlib.pyplot as plt
        h = np.array(hist); fig, ax = plt.subplots(1, 2, figsize=(9, 3))
        ax[0].plot(h[:, 0]); ax[0].set_title('train loss'); ax[1].plot(h[:, 1]); ax[1].set_title(f'val Dice (best {best:.4f})')
        plt.tight_layout(); plt.savefig(f'{HERE}/train_curve.png')
    except Exception as e: print('curve fail', e, flush=True)
    print(f'DONE best valDice {best:.4f} -> {HERE}/bet_unet.pt', flush=True)

if __name__ == '__main__': main()
