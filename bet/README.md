# bet/ — brain extraction (skull stripping)

Clean-room, dependency-free brain extraction for brainWhiz. Drag in a T1/T2 (any NIfTI),
get a brain mask + masked volume + a brain surface mesh.

**Licensing:** every algorithm here is implemented from scratch from standard, patent-free
image-processing methods (Otsu thresholding, 3-D connected components, morphological
erosion/dilation/closing, hole-filling, active-surface refinement). No FSL/BET, ANTs,
FreeSurfer/SynthStrip, or SPM code or models are used or required — nothing to cite, credit,
or license. Pure JavaScript on the voxel array.

## Approach (pipeline)
Operates on a volume `{data: TypedArray, dims:[nx,ny,nz]}` (voxel index = `x + nx*(y + ny*z)`):
1. **Threshold** — Otsu (or robust percentile) to split head from air.
2. **Largest connected component** (3-D, 6-connectivity) → the head blob.
3. **Erode → largest-CC → dilate** — erosion breaks the thin skull↔brain neck; keep the
   biggest piece (brain); dilate back. The classic morphological brain-extraction core.
4. **Hole-fill + close** — flood-fill background from the border; unreached interior = holes
   (ventricles, vessels) → filled.
5. *(optional)* **active-surface refinement** — a tessellated sphere evolving under a
   smoothness force + intensity/edge force (BET's *idea*, which is unpatented active-contour
   math, written fresh) for a smoother, tighter mask.

## Files
- `bet.js` — pure functions (no DOM), Web-Worker- and Node-friendly: `otsu`, `connectedComponents3D`,
  `largestComponent`, `erode3D`, `dilate3D`, `fillHoles3D`, `extractBrain(vol, opts)`.
- `bet.worker.js` — *(planned)* worker wrapper so stripping runs off the UI thread.
- `test_bet.mjs` — *(planned)* synthetic-volume + real-T1 checks.

## Integration into brainWhiz (planned)
`index.html` → "🧠 Brain extraction" panel → on T1 drop, run `extractBrain` in a Web Worker →
feed the mask to the existing `buildSurfaceFromNifti` (marching cubes) for the mesh, set the
masked volume as the slice underlay, and offer a `.nii` mask export.

## Status
Core pipeline implemented in `bet.js`. Not yet wired into the UI. Accuracy target: good enough
for visualization / QC / teaching; validate before research claims.
