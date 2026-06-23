# brainWhiz — Engine Edition

The same brainWhiz viewer/figure tool, shipped **without any third-party neuroimaging data** so it
can be used and distributed commercially. It includes one **procedurally-generated synthetic atlas**
(license-free demo, clearly labelled "Synthetic" — not real anatomy) so it works out of the box;
you supply your own real data.

## Getting started (bring your own data)
- **Atlas / parcellation:** build a bundle from your MNI-space label NIfTI with
  `python build_bundle.py --atlas X.nii --labels X.txt --id myid --name "My (N)" --no-neuro`,
  run `python regen_registry.py`, then open `index.html?atlas=myid`.
- **Overlays:** in the app, **Overlays ▸ ➕ Load .nii** (MNI stat map) or **➕ Load .csv**
  (one value per region).
- **Slice background:** load a subject T1 (or your own template) as the underlay in the Slices panel.

With no atlas loaded the app boots to an empty state with these instructions.

## Licensing
- The application code is © Roger Newman-Norlund — see `LICENSE` (commercial terms).
- Bundled open-source libraries are listed in `THIRD_PARTY.md` (all permissive: MIT/BSD/CC0).
- **No third-party datasets are included.** Any atlas/template/overlay you load is governed by its
  own license — your responsibility.

## Regeneration
This folder is generated from the main brainWhiz repo by `build_engine.mjs` — do not edit it by
hand. After updating the main app, run `node build_engine.mjs` to refresh it.
