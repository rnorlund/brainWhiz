#!/bin/bash
# Wait for enough teacher masks, then cache + train v0 + export ONNX. Logs to auto_train.log.
set -e
REPO=/Users/super/Documents/jhu_brain_atlas
MASKS=/Users/super/Downloads/OASIS_bet_work/mask
NEED=${1:-120}; EPOCHS=${2:-40}
cd "$REPO"
echo "auto_train: waiting for >=$NEED teacher masks…"
while [ "$(ls $MASKS/*_mask.nii.gz 2>/dev/null | wc -l | tr -d ' ')" -lt "$NEED" ]; do sleep 60; done
echo "auto_train: $(ls $MASKS/*_mask.nii.gz | wc -l | tr -d ' ') masks ready — caching"
python3 bet/train/preprocess.py 6
echo "auto_train: training v0 ($EPOCHS epochs)"
python3 bet/train/train.py "$EPOCHS" 2 16
echo "auto_train: exporting ONNX"
python3 -m pip install --quiet onnx >/dev/null 2>&1 || true
python3 bet/train/export_onnx.py
echo "auto_train: DONE"
