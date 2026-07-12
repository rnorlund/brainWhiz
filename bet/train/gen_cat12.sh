#!/bin/bash
# Generate CAT12 teacher labels (native p0 = brain + CSF/GM/WM) on OASIS T1s, in parallel.
# Offline teacher only — we ship our own distilled weights. Usage: gen_cat12.sh [N=150] [JOBS=3]
SRC=~/Downloads/OASIS_T1s_Only
WORK=~/Downloads/OASIS_bet_work
OUT=$WORK/cat_masks
N=${1:-150}; JOBS=${2:-3}
MAT=/Applications/MATLAB_R2024a.app/bin/matlab
SEG=/Users/super/Documents/jhu_brain_atlas/bet/train/cat12_seg.m
mkdir -p "$OUT" "$WORK/cat_batch"

one() {
  f="$1"; sub=$(basename "$f" | grep -oE 'sub-OAS[0-9]+')
  [ -f "$OUT/${sub}_p0.nii.gz" ] && { echo "skip $sub"; return; }
  wd="$WORK/cat_batch/$sub"; rm -rf "$wd"; mkdir -p "$wd"; cp "$f" "$wd/t1.nii"
  ( cd "$wd" && CAT_INPUT="$wd/t1.nii" "$MAT" -nodisplay -batch "run('$SEG')" > "$wd/log.txt" 2>&1 )
  if [ -f "$wd/mri/p0t1.nii" ]; then gzip -c "$wd/mri/p0t1.nii" > "$OUT/${sub}_p0.nii.gz"; echo "ok $sub ($(ls $OUT/*_p0.nii.gz|wc -l|tr -d ' '))"; else echo "FAIL $sub"; fi
  rm -rf "$wd"
}
export -f one; export SRC WORK OUT MAT SEG

t0=$(date +%s)
ls $SRC/*.nii | head -$N | xargs -P $JOBS -I{} bash -c 'one "$@"' _ {}
echo "CAT12 BATCH DONE: $(ls $OUT/*_p0.nii.gz 2>/dev/null | wc -l | tr -d ' ') masks in $(( ($(date +%s)-t0)/60 ))m"
