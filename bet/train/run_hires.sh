#!/usr/bin/env bash
# High-res 3-class BET training on Spark GB10. Launched via a short tmux command (SSH drops on long
# ones); logging + env are kept inside here so the launch line stays minimal. Survives logout via linger.
cd /home/allt_ai_1/betseg
exec > train_hires.log 2>&1   # fresh log each launch (so restarts don't leave a stale traceback)
echo "=== start $(date) | $(ls cache_hires_1mm/*.npz 2>/dev/null | wc -l) npz ==="
export BET_SHAPE=192,224,192 BET_VOX=1.0 BET_CACHE=/home/allt_ai_1/betseg/cache_hires_1mm
# EPOCHS=100 BATCH=4 BASE=16 WORKERS=8 NCLASS=4 (bg/CSF/GM/WM)
exec /home/allt_ai_1/reprintrisk/.venv/bin/python train.py 100 4 16 8 4
