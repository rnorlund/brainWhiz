#!/usr/bin/env python3
"""Export the trained BET U-Net to ONNX for in-browser inference (onnxruntime-web).
Fixed input shape (matches the conform grid) → small, fast graph. Usage: export_onnx.py"""
import os, sys, torch
sys.path.insert(0, os.path.dirname(__file__))
from unet3d import UNet3D

HERE = os.path.dirname(os.path.abspath(__file__))
CK = f'{HERE}/bet_unet.pt'
OUT_DIR = os.path.abspath(f'{HERE}/../model'); os.makedirs(OUT_DIR, exist_ok=True)
OUT = f'{OUT_DIR}/bet_unet.onnx'

ck = torch.load(CK, map_location='cpu')
m = UNet3D(base=ck['base']).eval(); m.load_state_dict(ck['state_dict'])
shape = ck['shape']
x = torch.randn(1, 1, *shape)
torch.onnx.export(m, x, OUT, input_names=['t1'], output_names=['logit'],
                  opset_version=17, do_constant_folding=True)
print(f'exported {OUT}  (base {ck["base"]}, shape {shape}, valDice {ck.get("valDice"):.4f})')
# tiny sidecar so the app knows the grid without hardcoding
import json
json.dump({'shape': shape, 'vox': ck['vox'], 'valDice': ck.get('valDice'), 'base': ck['base']},
          open(f'{OUT_DIR}/bet_unet.json', 'w'))
print('sizes:', os.path.getsize(OUT) // 1024, 'KB')
