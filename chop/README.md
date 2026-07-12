# chop/ — segment an individual brain into any atlas's regions

Clean-room, dependency-free "inverse-normalization" label propagation for brainWhiz. Given a
subject brain (skull-stripped by `bet/`) and one of the bundled atlases, produce that atlas's
parcellation **in the individual's native space**.

**Mechanism (exactly the requested one):** register the subject → MNI152 (the template already
bundled in brainWhiz), **invert** that transform, and apply the inverse to the MNI-space atlas
labels → atlas boundaries warped back onto the individual's brain. Works for **any** atlas.

**Licensing:** original implementations of standard, patent-free registration math — normalized
mutual information / cross-correlation metrics, gradient-free affine optimization (Nelder-Mead /
Powell), and (later) Thirion-style diffusion ("demons") or B-spline free-form deformation for the
nonlinear step. No ANTs, FSL/FNIRT, SPM, or SynthMorph code/models. Nothing to cite or license.

## Pipeline
1. **Affine (12-DOF)** subject↔MNI152, multi-resolution (coarse→fine), maximizing NMI. `chop.js`.
2. **Invert** the transform (`invert4x4`; for nonlinear, invert the displacement field).
3. **Resample atlas labels** into the native grid — nearest-neighbor so labels stay integer
   (`resampleLabels`).
4. *(later)* **Nonlinear refinement** (demons / FFD) for individualized gyral boundaries.

Output: a native-space label volume (a `.nii` parcellation) + per-region stats — loadable by
brainWhiz exactly like a bundled atlas, but in the subject's own space.

## Files
- `chop.js` — deterministic pieces implemented now: 4×4 matrix math (`mul4`, `invert4x4`,
  `applyAffine`) and `resampleLabels(atlas, target, transform)` (nearest-neighbor). Registration
  (`registerAffine`) scaffolded with the metric + optimizer outline.
- `test_chop.mjs` — *(planned)* round-trip resample + registration-on-synthetic checks.

## Status
Scaffold + deterministic resampler/matrix math. Registration optimizer is the main work ahead.
Depends on `bet/` for the brain mask (register brain-to-brain for robustness).

## Honest caveats
Clean-room in-browser affine is coarse vs ANTs SyN; nonlinear is the hard part. Frame as fast
visualization / QC / teaching until validated. Downsample + Web Worker / WebGPU for speed.
