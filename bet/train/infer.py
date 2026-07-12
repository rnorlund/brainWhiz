#!/usr/bin/env python3
"""Run the trained BET U-Net on a T1 and write a skull-stripped brain + QC montage. CPU/MPS.
Usage: infer.py <t1.nii[.gz]> [out_prefix]"""
import os, sys, numpy as np, torch, nibabel as nib
from scipy.ndimage import label, binary_fill_holes, map_coordinates
sys.path.insert(0, os.path.dirname(__file__))
from common import conform, SHAPE
from unet3d import UNet3D

HERE = os.path.dirname(os.path.abspath(__file__))
def largest_cc(m):
    lab, n = label(m)
    if n <= 1: return m
    sizes = np.bincount(lab.ravel()); sizes[0] = 0
    return lab == sizes.argmax()

def prob_to_native(prob, Ta, aff, shape):
    nx, ny, nz = shape
    gi, gj, gk = np.meshgrid(np.arange(nx), np.arange(ny), np.arange(nz), indexing='ij')
    nv = np.stack([gi.ravel(), gj.ravel(), gk.ravel(), np.ones(gi.size)], 0)
    world = np.asarray(aff) @ nv
    cc = (np.linalg.inv(np.asarray(Ta)) @ world)[:3]
    return map_coordinates(prob, cc, order=1, cval=0.0).reshape(shape)

def run(t1, prefix=None):
    ck = torch.load(f'{HERE}/bet_unet.pt', map_location='cpu')
    m = UNet3D(base=ck['base']).eval(); m.load_state_dict(ck['state_dict'])
    x, _, meta = conform(t1)
    with torch.no_grad():
        p = torch.sigmoid(m(torch.from_numpy(x)[None, None])).numpy()[0, 0]
    img = nib.load(t1); native = np.asanyarray(img.dataobj).astype(np.float32)
    pn = prob_to_native(p, meta['Ta'], meta['aff'], native.shape)
    mask = pn > 0.5
    mask = largest_cc(mask); mask = binary_fill_holes(mask)
    prefix = prefix or (f"{HERE}/" + os.path.basename(t1).replace('.nii', '').replace('.gz', ''))
    brain = np.where(mask, native, 0).astype(np.float32)
    nib.save(nib.Nifti1Image(brain, img.affine, img.header), prefix + '_unetbrain.nii.gz')
    pct = 100 * mask.mean(); print(f'brain {pct:.1f}% valDice(train)={ck.get("valDice"):.4f} -> {prefix}_unetbrain.nii.gz')
    # QC montage
    try:
        from PIL import Image; from scipy.ndimage import binary_erosion
        g = np.clip((native - np.percentile(native, 2)) / (np.percentile(native, 98) - np.percentile(native, 2) + 1e-6), 0, 1)
        nz = native.shape[2]; zs = [int(f * nz) for f in (0.25, 0.35, 0.45, 0.55, 0.65, 0.75)]; tiles = []
        for z in zs:
            sl = g[:, :, z].T[::-1]; e = (mask[:, :, z] ^ binary_erosion(mask[:, :, z])).T[::-1]
            rgb = np.stack([sl]*3, -1); rgb[e] = [1, .2, .2]; tiles.append((rgb*255).astype(np.uint8))
        h, w = tiles[0].shape[:2]; row = np.concatenate(tiles, 1)
        Image.fromarray(row).save(prefix + '_betqc.png'); print('wrote', prefix + '_betqc.png')
    except Exception as e: print('qc fail', e)

if __name__ == '__main__':
    run(sys.argv[1], sys.argv[2] if len(sys.argv) > 2 else None)
