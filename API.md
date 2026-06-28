# brainWhiz API & scripting reference

brainWhiz is a single static page (`index.html`). Everything below works with no build step.

---

## 1. URL parameters

| Param | Example | Effect |
|---|---|---|
| `atlas` | `index.html?atlas=aal` | Load a bundled atlas by id (default `jhu`). |
| `demo` | `index.html?demo=language` | Run a gallery demo on load (see §5). |

Combine: `index.html?atlas=jhu&demo=fibers_dti`.

---

## 1b. Embedding in another web page (iframe)

brainWhiz embeds like NiiVue — drop an `<iframe>` and configure it entirely by URL. `?embed=1`
hides all chrome (just the 3D viewport) and **bypasses the password gate** (an embed is an
intentional share). Point the data params at any CORS-readable file (same-origin or a host that
sends `Access-Control-Allow-Origin`).

```html
<!-- e.g. NeuroSynth/NeuroQuery showing a meta-analytic map on a 3D brain -->
<iframe width="640" height="420" style="border:0"
  src="https://rnorlund.github.io/brainWhiz/index.html?embed=1&atlas=jhu&overlay=https://example.org/language_z.nii.gz&cmap=hot&thr=0.3&view=left">
</iframe>
```

| Param | Example | Effect |
|---|---|---|
| `embed` | `embed=1` | Hide panels/topbar (viewport only); ungated. |
| `atlas` | `atlas=jhu` | Bundled atlas (default `jhu`). |
| `overlay` | `overlay=<url>` | Load a remote stat NIfTI as the overlay. |
| `cmap` `cmin` `cmax` `thr` | `cmap=hot&thr=0.3` | Overlay colormap, min/max, threshold. |
| `underlay` | `underlay=<url>` | Slice underlay (subject T1 / template). |
| `surface` | `surface=<url>` | Load a `.gii`/FreeSurface surface as the mesh. |
| `tracts` | `tracts=<url>` | Load `.trk`/`.tck` streamlines. |
| `mesh` | `mesh=<label.nii>` | Build an atlas/surface in-browser from a volume. |
| `scheme` | `scheme=lobe` | Region color scheme. |
| `explode` | `explode=0.6` | Exploded-brain amount. |
| `bg` | `bg=000000` | Background color. |
| `mode` | `mode=slice` | `mesh` (default) / `slice` / `mosaic`. |
| `view` | `view=left` | Camera preset. |
| `demo` | `demo=language` | Run a built-in demo (combinable with `embed=1`). |

Notes: remote files must be **CORS-readable** (or same-origin). For a fully self-contained,
offline embed instead, export a **living figure `.html`** (Figure ▸ Export interactive .html) and
host that single file. The gallery (`gallery.html`) is the human-facing index of `?demo=` links.

### Live control via `postMessage` (no reload)

A host page can drive an embedded brainWhiz **after** load — swap the overlay, move the camera,
change the colormap — without reloading the iframe (the NiiVue-style integration NeuroSynth/journals
want). Post `{brainWhiz:true, cmd:'…', …}` to the iframe; brainWhiz posts a reply back.

```html
<iframe id="bw" src="https://rnorlund.github.io/brainWhiz/index.html?embed=1&atlas=jhu"></iframe>
<script>
  const bw = document.getElementById('bw');
  // brainWhiz posts {brainWhiz:true, type:'ready', atlas} when the scene is loaded:
  window.addEventListener('message', e => {
    if (e.data?.brainWhiz !== true) return;
    if (e.data.type === 'ready')  bw.contentWindow.postMessage(
      {brainWhiz:true, cmd:'loadOverlay', url:'https://example.org/zmap.nii.gz', cmap:'hot', thr:3}, '*');
    if (e.data.type === 'reply')  console.log(e.data.cmd, e.data.ok, e.data.result);
  });
  // later, react to user input on YOUR page:
  bw.contentWindow.postMessage({brainWhiz:true, cmd:'setView', view:'right'}, '*');
</script>
```

Every command is `{brainWhiz:true, cmd, …args, id?}`. brainWhiz replies
`{brainWhiz:true, type:'reply', id, cmd, ok, result, error}` to the sender (echo back `id` to match).

| `cmd` | Args | Effect / `result` |
|---|---|---|
| `ping` | — | `"pong"` (liveness check). |
| `loadOverlay` | `url`, `cmap?`, `cmin?`, `cmax?`, `thr?` | Fetch + show a remote stat NIfTI. |
| `setRegionValues` | `values` ({roiId:val}), `name?` | Color regions by per-ROI value (loadings/scores/activations). |
| `setColormap` | `cmap` | Change overlay colormap. |
| `setRange` | `cmin?`, `cmax?` | Overlay min/max. |
| `setThreshold` | `thr` | Overlay threshold. |
| `clearOverlay` | — | Remove the overlay. |
| `setView` | `view` | Camera preset (`left`/`right`/`superior`/…). |
| `setMode` | `mode` | `mesh` / `slice` / `mosaic`. |
| `setExplode` | `amount` | Exploded-brain amount (0–1+). |
| `setScheme` | `scheme` | Region color scheme. |
| `setBackground` | `color` | Background color. |
| `loadUnderlay` | `url` | Slice underlay NIfTI. |
| `loadSurface` / `loadTracts` | `url` | Load a `.gii`/FreeSurfer surface or `.trk`/`.tck`. |
| `runDemo` | `demo` | Run a built-in demo by id. |
| `applyConfig` | `config` | Apply a viewer-config object (see §2). |
| `screenshot` | — | PNG data-URL of the current view. |
| `colorbar` | — | Active colorbar descriptor (for a legend), or `null`. |
| `getState` | — | `{atlas, mode, overlay, explode, scheme}`. |

CORS still applies to any `url` you pass. The bridge works for any embed (with or without `?embed=1`),
but `?embed=1` is what hides the chrome for a clean inline view.

---

## 2. `window.brainAPI` (headless / console control)

`window.brainAPI.ready` resolves when the scene is loaded. Then:

| Method | Description |
|---|---|
| `ready` | Promise that resolves when meshes are loaded. |
| `applyConfig(cfg)` / `applyCfg(cfg)` | Apply a captured viewer config (the `vals`/camera/regions/overlays snapshot). |
| `projectJSON()` | Return a self-contained **project** object (embeds overlay/underlay bytes + panels + settings). |
| `loadProject(p)` | Restore a project object from `projectJSON()`. |
| `loadStatArray(b64, which, name)` | Load an overlay NIfTI from base64 bytes (`which` = `'A'`). |
| `setRegionValues(vals, name)` | Color regions from a `{roiId: value}` map (factor loadings, scores, per-ROI activations). Set colormap/range via controls afterwards. |
| `setUnderlayBytes(b64, name)` | Set the slice underlay from base64 NIfTI bytes (`null` → MNI template). |
| `setView(name)` | `'left' \| 'right' \| 'superior' \| 'inferior' \| 'anterior' \| 'posterior'`. |
| `renderTo(w, h, transparent, zoom)` | Return a PNG data-URL of the current 3D scene at a given size. |
| `colorbar()` | Return the active overlay colorbar descriptor (for figure legends), or `null`. |
| `screenshot()` | PNG data-URL of the current canvas. |
| `addArc(i, j)` / `clearArcs()` / `arcCount()` | Programmatic connectivity arcs between region ids. |

Headless pattern: launch Chrome `--headless=new --use-angle=swiftshader`, drive via the DevTools
WebSocket, poll `typeof window.brainAPI`, `await window.brainAPI.ready`, then evaluate.

---

## 3. Bringing in data (drag-and-drop or buttons)

Drop a file anywhere on the 3D viewport. The drop zone splits into **bands**; the band you drop on decides:

| Band | Accepts | Result |
|---|---|---|
| **Background** (top, Slices/Mosaic view) / **Build mesh** (top, Mesh view) | `.nii/.nii.gz` | Slice underlay, or (in Mesh view) build a brain surface / region atlas. |
| **Overlay** (middle) | `.nii/.nii.gz`, `.csv/.tsv` | Stat map overlay, or per-region values. Stack several. |
| **Build atlas / surface** (bottom) | label `.nii` (+ labels `.txt`), continuous `.nii` | Browser-side atlas (marching/Surface-Nets) or single brain surface — no Python. |
| any band | `.gii`, `.srf`/`.asc`, `lh.pial`/`white`/… , `.trk`, `.tck` | GIFTI / FreeSurfer surface, or TRK/TCK streamlines. |
| any band | `.bwz`, `.bwzproj` | Figure recipe / self-contained project. |

### Supported formats
- **Volumes:** NIfTI-1 (`.nii`, `.nii.gz`), 3D and **4D timeseries**; int8/uint8/int16/uint16/int32/float32/float64.
- **Surfaces:** GIFTI `.gii` (ASCII / Base64 / GZip-Base64), FreeSurfer ASCII (`.srf`/`.asc`) and binary (`lh.pial`, …).
- **Tractography:** TrackVis `.trk`, MRtrix `.tck`.
- **Per-region values:** `.csv`/`.tsv` (auto-matched by region count, id column, or names).
- **Recipes:** `.bwz` (lightweight, references files by name), `.bwzproj` (self-contained, embeds data).

A label `.nii` for an atlas may carry a labels file (`id|abbr|name`, `id,name`, whitespace, or CAT12 `;`-CSV).
All coordinates are **MNI152** unless noted; meshes use three.js axes (+X=Right, +Y=Superior, −Z=Anterior).

---

## 4. Exports

- **PNG** — top bar 📷.
- **Record MP4 / WebM** — top bar ⏺ (records *only* the 3D viewport; MP4 default for PowerPoint/Slides/Keynote).
- **Living interactive figure (`.html`)** — Figure ▸ Export interactive .html. One self-contained file a reader can rotate/zoom/explode (three.js inlined when served).
- **Keyframe flythrough → MP4** — Keyframe director: add keyframes (camera/explode/overlay/4D/caption), Preview or Record MP4 with captions baked in.
- **Multi-panel figures** — 🗔 Panels builder → PNG / PDF / SVG, or a `.bwz` recipe.

---

## 4b. Shading, materials & volume

All clean-room (our own GLSL / procedural matcaps — no third-party shader code or assets) and
persisted in presets / `.bwzproj`.

**Shading menu** (`#shading`) — 45 looks, each with a thumbnail in the dropdown:
- *Base:* Standard, Matcap, Cartoon (cel-shade + black inked sulci).
- *Lighting:* Gooch, Matte, Glossy, Phong, Metal, Anisotropic, Hemispheric.
- *Material FX:* Subsurface, Velvet, Pearl, Chrome, Glass, Wax, Clay, Iridescent.
- *Imaging / NPR:* X-ray, Curvature, Curvature 2-tone, Ambient occlusion, Normals, Blueprint,
  Contour, Spectral, Thermal, Hatching, Hologram.
- *Materials (matcap)*, value `matcap:<Name>`: Clay, Skin, Pearl, Jade, Bronze, Chrome, Gold, Glass,
  Wax, Basalt, Copper, Pewter, Ruby, Emerald, Sapphire, Porcelain (environment-lit: metals reflect,
  glass refracts, gems sparkle, pearl iridesces).

**Ink outline** — `#outlineOn` (checkbox) + `#outlineW` (width): constant-width inverted-hull black
outline; composes with any shading.

**Base-brain color** — `#ovBaseColor` (+ "🌚 dark"): color of uncolored regions when an overlay is
active. Darken it so a light colormap pops on a white figure background.

**Functional sparkle (fMRI)** — `#fxSparkle` (checkbox) + `#sparkAmt` / `#sparkSpeed` / `#sparkTw`:
active overlay regions glimmer/twinkle; animates continuously while on.

**Volume render** (`#volOn`) — `#volMode`: `0` MIP · `1` Accumulate · `2` MinIP · `3` X-ray/DRR ·
`4` Isosurface (lit); `#volCmap`, `#volThr`, `#volOp`, `#volSteps`. Fade the brain (glass/opacity) to
see the voxels inside.

**Visual dropdowns** — the colormap selects (`#cmap`, `#connCmap`) show a gradient swatch and the
`#shading` select a brain thumbnail beside each option (a generic `richSelect()` over the native
`<select>`, which stays the source of truth).

---

## 5. Demo registry (`?demo=<id>`)

`index.html?demo=<id>` runs a scripted setup. The gallery (`gallery.html`) links to these. Current ids:

`language`, `lobe`, `rainbow`, `explode`, `glass`, `overlay`, `taskmap`, `slices`, `mosaic`,
`crop`, `fibers_white`, `fibers_dti`, `tracts_hull`, `volume`, `fmri4d`, `surface`, `tractfile`,
`potatohead`, `projector`, `living`, `keyframe`.

`window.__DEMOS` exposes `[{id,title,desc,tags}]` for tooling/galleries.

---

## 6. Building atlases offline (optional, Python)

For curated bundles shipped in the dropdown:
```
python build_bundle.py --atlas X.nii --labels X.txt --id myid --name "My (N)" [--no-neuro]
python regen_registry.py
```
The in-app **Build atlas** band does the same thing live in the browser (no Python needed).

---

## 7. Editions

- **Research edition** (this repo) — bundles atlases / NeuroQuery maps / connectivity / templates for noncommercial research.
- **Engine edition** (`engine/`, generated by `node build_engine.mjs`) — the same app **without third-party data** (ships only a procedurally-generated synthetic atlas), for commercial use.
