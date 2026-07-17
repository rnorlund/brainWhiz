#!/usr/bin/env bash
# Spark-side: wait until all 154 npz have finished transferring, then launch training. rsync --partial
# writes to hidden temp names and renames on completion, so counting *.npz only sees finished files.
cd /home/allt_ai_1/betseg
echo "=== waiting for cache $(date) ===" > wait.log
until [ "$(ls cache_hires_1mm/*.npz 2>/dev/null | wc -l)" -ge 154 ]; do sleep 20; done
sleep 15   # let the final rename settle
echo "=== 154 npz present, launching train $(date) ===" >> wait.log
bash run_hires.sh
