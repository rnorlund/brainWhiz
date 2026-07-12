#!/usr/bin/env python3
"""Train the 3D U-Net brain extractor on cached (T1, teacher-mask) pairs (Apple MPS).
Saves best-Dice weights to bet/train/bet_unet.pt, a loss/Dice curve, and periodic val QC montages.
Usage: train.py [EPOCHS=40] [BATCH=2] [BASE=16]"""
import os, sys, glob, re, time, random, json
import numpy as np, torch, torch.nn as nn, torch.nn.functional as F
sys.path.insert(0, os.path.dirname(__file__))
from unet3d import UNet3D

HERE = os.path.dirname(os.path.abspath(__file__))
CACHE = os.environ.get('BET_CACHE', '/Users/super/Downloads/OASIS_bet_work/cache')
EPOCHS = int(sys.argv[1]) if len(sys.argv) > 1 else 40
BATCH  = int(sys.argv[2]) if len(sys.argv) > 2 else 2
BASE   = int(sys.argv[3]) if len(sys.argv) > 3 else 16
DEV = 'cuda' if torch.cuda.is_available() else ('mps' if torch.backends.mps.is_available() else 'cpu')

def load_all():
    files = sorted(glob.glob(f'{CACHE}/*.npz'))
    data = []
    for f in files:
        sub = re.search(r'(sub-OAS\d+)', os.path.basename(f)).group(1)
        d = np.load(f); data.append((sub, d['x'].astype(np.float16), d['y'].astype(np.uint8)))
    return data

def dice_loss(logit, y):
    p = torch.sigmoid(logit); inter = (p * y).sum((2, 3, 4)); s = p.sum((2, 3, 4)) + y.sum((2, 3, 4))
    return (1 - (2 * inter + 1) / (s + 1)).mean()

def _shift(a, s):                                                              # zero-fill translation (NO wrap)
    out = np.zeros_like(a)
    src = tuple(slice(max(0, -s[d]), a.shape[d] - max(0, s[d])) for d in range(3))
    dst = tuple(slice(max(0, s[d]), a.shape[d] - max(0, -s[d])) for d in range(3))
    out[dst] = a[src]; return out

def augment(x, y):
    if random.random() < 0.5: x = x[::-1].copy(); y = y[::-1].copy()          # LR flip (RAS x)
    if random.random() < 0.6:                                                  # small translation (robust to bbox jitter)
        s = (random.randint(-4, 4), random.randint(-4, 4), random.randint(-4, 4))
        x = _shift(x, s); y = _shift(y, s)
    if random.random() < 0.7:                                                  # intensity gamma + scale
        g = random.uniform(0.7, 1.5); s = random.uniform(0.85, 1.15)
        x = np.clip((x ** g) * s, 0, 1.5).astype(np.float32)
    if random.random() < 0.3: x = np.clip(x + random.uniform(-0.05, 0.05), 0, 1.5).astype(np.float32)
    return x, y

def batch(items, train):
    xs, ys = [], []
    for _, x, y in items:
        x = x.astype(np.float32); y = y.astype(np.float32)
        if train: x, y = augment(x, y)
        xs.append(x[None]); ys.append(y[None])
    X = torch.from_numpy(np.stack(xs)).to(DEV); Y = torch.from_numpy(np.stack(ys)).to(DEV)
    return X, Y

@torch.no_grad()
def val_dice(model, val):
    model.eval(); ds = []
    for i in range(0, len(val), BATCH):
        X, Y = batch(val[i:i + BATCH], False); p = (torch.sigmoid(model(X)) > 0.5).float()
        inter = (p * Y).sum((2, 3, 4)); s = p.sum((2, 3, 4)) + Y.sum((2, 3, 4))
        ds += ((2 * inter + 1) / (s + 1)).cpu().numpy().tolist()
    return float(np.mean(ds))

def qc(model, val, epoch):
    try:
        from PIL import Image; from scipy.ndimage import binary_erosion
        model.eval(); _, x, y = val[0]
        with torch.no_grad():
            p = (torch.sigmoid(model(torch.from_numpy(x.astype(np.float32))[None, None].to(DEV))) > 0.5).cpu().numpy()[0, 0]
        x = x.astype(np.float32); nz = x.shape[2]; cols, rows = 6, 2; n = cols * rows; tiles = []
        for i in range(n):
            z = int((0.18 + 0.64 * i / (n - 1)) * nz); sl = x[:, :, z].T[::-1]
            rgb = np.stack([sl] * 3, -1)
            pt = (p[:, :, z] > 0.5).T[::-1]; gt = (y[:, :, z] > 0.5).T[::-1]
            rgb[gt ^ binary_erosion(gt)] = [0.1, 1, 0.1]      # teacher = green
            rgb[pt ^ binary_erosion(pt)] = [1, 0.2, 0.2]      # student = red
            tiles.append((np.clip(rgb, 0, 1) * 255).astype(np.uint8))
        h, w = tiles[0].shape[:2]; canv = np.zeros((rows * h, cols * w, 3), np.uint8)
        for i, t in enumerate(tiles): r, c = divmod(i, cols); canv[r*h:(r+1)*h, c*w:(c+1)*w] = t
        Image.fromarray(canv).save(f'{HERE}/qc_epoch{epoch:03d}.png')
    except Exception as e: print('qc fail', e, flush=True)

def main():
    data = load_all()
    rng = random.Random(42); rng.shuffle(data)
    nval = max(4, int(0.15 * len(data))); val = data[:nval]; train = data[nval:]
    print(f'device {DEV} | {len(data)} subjects -> train {len(train)} val {len(val)} | base {BASE} batch {BATCH} epochs {EPOCHS}', flush=True)
    model = UNet3D(base=BASE).to(DEV)
    opt = torch.optim.Adam(model.parameters(), 1e-3)
    sched = torch.optim.lr_scheduler.CosineAnnealingLR(opt, EPOCHS)
    best = 0.0; hist = []
    for ep in range(EPOCHS):
        model.train(); random.shuffle(train); t0 = time.time(); tot = 0.0; nb = 0
        for i in range(0, len(train), BATCH):
            X, Y = batch(train[i:i + BATCH], True)
            opt.zero_grad(); out = model(X)
            loss = 0.5 * F.binary_cross_entropy_with_logits(out, Y) + 0.5 * dice_loss(out, Y)
            loss.backward(); opt.step(); tot += float(loss.detach()); nb += 1
        sched.step(); vd = val_dice(model, val); hist.append((float(tot / max(nb, 1)), vd))
        print(f'ep {ep+1}/{EPOCHS} loss {tot/max(nb,1):.4f} valDice {vd:.4f} best {best:.4f} {(time.time()-t0)/60:.1f}m', flush=True)
        if vd > best:
            best = vd
            torch.save({'state_dict': model.state_dict(), 'base': BASE, 'depth': 4, 'shape': [96, 112, 96], 'vox': 2.0, 'valDice': best}, f'{HERE}/bet_unet.pt')
        if (ep + 1) % 5 == 0 or ep == EPOCHS - 1: qc(model, val, ep + 1)
    json.dump(hist, open(f'{HERE}/train_hist.json', 'w'))
    # curve
    try:
        import matplotlib; matplotlib.use('Agg'); import matplotlib.pyplot as plt
        h = np.array(hist); fig, ax = plt.subplots(1, 2, figsize=(9, 3))
        ax[0].plot(h[:, 0]); ax[0].set_title('train loss'); ax[1].plot(h[:, 1]); ax[1].set_title(f'val Dice (best {best:.4f})')
        plt.tight_layout(); plt.savefig(f'{HERE}/train_curve.png')
    except Exception as e: print('curve fail', e, flush=True)
    print(f'DONE best valDice {best:.4f} -> {HERE}/bet_unet.pt', flush=True)

if __name__ == '__main__': main()
