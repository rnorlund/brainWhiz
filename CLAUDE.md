# brainWhiz — guide for Claude Code

This file orients Claude Code (and humans) so you can make changes confidently.
**brainWhiz** is a static, single-page Three.js viewer for multi-atlas "exploding-brain"
neuroimaging figures, plus a headless figure-montage tool. No build step, no framework.

## How to run / test
- **Open the app:** open `index.html` in Chrome/Safari (needs internet for the Three.js CDN).
  Pick an atlas via the dropdown or `index.html?atlas=aal`.
- **Live site:** GitHub Pages serves `main` at the repo's Pages URL.
- **Make a figure (headless):** `npm install ws` once, then
  `node make_figure.mjs example.bwz --root <folder-with-nii> --out fig.png`.
- **There is no compile/lint/test command.** To sanity-check the viewer's module JS:
  extract the `<script type="module">` block from `index.html` and run `node --check`.

## Architecture (where things live)
```
index.html         EVERYTHING for the viewer: HTML UI + CSS + one big ES module.
                   ~all viewer logic is here. Search by section comments:
                   "DATA OVERLAY", "DTI connectivity", "COLORMAPS", "SCRIPTING API",
                   "IN-APP PANEL BUILDER", "ATLAS PICKER", "SETTINGS PRESETS", axis labels.
colormaps.js       window.JHU_CMAPS = { name: [[r,g,b]…] } — 28 colormaps (shared, atlas-independent).
bundles/
  registry.js      window.ATLAS_REGISTRY = [{id,name,nroi,has:{dti,rs,neuro}}] — atlas list + badges.
  <id>/data.js     window.ATLAS_LABELS (per-ROI metadata) + window.ATLAS_GLB_B64 (meshes, base64 GLB).
  <id>/samples.js  window.ATLAS_SAMPLES = {roiId:[x,y,z,…]} MNI mm points (for .nii overlay sampling).
  <id>/conn.js     window.ATLAS_CONN = { dti?:{edges,max,...}, rs?:{...} }  (optional).
  <id>/neuro.js    window.ATLAS_NEURO = { terms:{term:{roiId:value}}, order:[...] } (baked task maps).
make_figure.mjs    headless montage: drives index.html via CDP + window.brainAPI; reads JSON or .bwz.
build_bundle.py    atlas (.nii + labels) -> a bundles/<id>/ bundle (meshes/samples/neuro/conn).
interpolate_conn.py estimate RS connectivity for atlases without data (project AICHA+JHU by overlap).
build_colormaps.py regenerate colormaps.js.
regen_registry.py  rebuild bundles/registry.js from the bundle folders (run after adding/rebuilding).
example.bwz, examples/   sample figure recipes; examples/*.nii.gz are shareable NeuroQuery maps.
BWZ_FORMAT.md      full .bwz reference (every field + every control id).
```

## How the viewer loads
1. `colormaps.js` + `bundles/registry.js` load statically.
2. The module reads `?atlas=` (default `jhu`), then **dynamically injects** the chosen
   bundle's `data.js`/`samples.js`/`conn.js`/`neuro.js` (works on `file://`, no fetch).
3. Globals are `window.ATLAS_*`. Switching atlas reloads the page with `?atlas=<id>`.

## Key globals/functions in index.html (for edits)
- `meshes` (array of `{mesh, base, meta}`), `byId` (roiId → record).
- `overlay = {on, vals, name, valsB, nameB, combine, fileA, fileB}` + `recolorOverlay()` / `recolorDual()`.
- `applyScheme(name)`, `setOpacities()`, `rebuildConn()`, `setExplode(v)`.
- `captureViewerCfg()` / `applyViewerCfg(cfg)` — snapshot & restore full viewer state (used by tiles + .bwz).
- `window.brainAPI` — headless control: `ready`, `applyConfig`, `applyCfg(cfg)`,
  `loadStatArray(b64,which,name)`, `renderTo(w,h,transparent)`, `colorbar()`, `setView`.
- `PRESET_IDS` — the list of control element ids saved in presets / `.bwz` `vals`.

## Common edits (recipes)
- **Add/replace a colormap:** edit `build_colormaps.py` (`NAMES`) → `python build_colormaps.py`.
  Or hand-edit `colormaps.js`. Add the name to `CMAP_ORDER` in index.html to surface it first.
- **Add a baked task term:** edit `NEURO_TERMS` in `build_bundle.py`, rebuild the bundle(s).
- **Add a new atlas:** `python build_bundle.py --atlas X.nii --labels X.txt --id myid --name "My (N)"`
  `[--conn-mats '/path/*.mat' --dti-field … --rs-field …] [--no-neuro]`, then `python regen_registry.py`.
  Atlases must be in MNI space. Re-run `regen_registry.py` after any bundle change.
- **Add a UI control that should persist in presets/.bwz:** give it an `id`, wire its listener,
  and add the id to `PRESET_IDS`. Document it in `BWZ_FORMAT.md`.
- **Change a default look:** edit the control's `value=` in the HTML, or the uniform defaults
  (`patternUniforms`, lights, `renderer.toneMappingExposure`, `envMapIntensity`).
- **Tune figure export:** `make_figure.mjs` (`composite()` + the `COMPOSITOR` canvas string) and
  the in-app `pbExport()` / `drawCbar` / `drawBivariate` / `drawDiverging` in index.html.

## Conventions & gotchas
- **Single file:** keep viewer logic in `index.html`; no bundler, ES module + import-map CDN.
- **Coordinate space:** atlases and overlays are **MNI152**; meshes are exported in three.js axes
  (`+X=Right, +Y=Superior, −Z=Anterior`) by `build_bundle.py` (applies the NIfTI affine).
- **Alpha renderer:** the WebGLRenderer uses `alpha:true`; `renderTo(...,true)` renders transparent
  so figure backgrounds apply. Don't remove `alpha:true` or figures get black panel boxes.
- **File overlays in the browser** can't be loaded by path (security) — they're picked/relinked.
  Headless `make_figure` loads them from `--root`.
- **Connectivity** exists only where measured (`jhu`,`aicha`=DTI; 7 atlases=RS). Interpolated RS\*
  comes from `interpolate_conn.py`; DTI is never interpolated (validated ~r=0.1, unreliable).
- **Concurrency:** `build_bundle.py`'s registry write isn't concurrency-safe — run builds serially,
  then `regen_registry.py` to be safe.
- **Headless testing pattern:** spawn `--headless=new` Chrome with `--use-angle=swiftshader`, drive
  via CDP WebSocket, poll `typeof window.brainAPI`, `await window.brainAPI.ready`, then evaluate.

## Data & licensing
Noncommercial (CC BY-NC 4.0, see `LICENSE`). Bundled atlases / NeuroQuery / ABC connectivity are
third-party data with their own terms — for noncommercial research; cite original sources.
