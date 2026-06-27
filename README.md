# 🧠 brainWhiz

**Interactive, multi-atlas "exploding-brain" viewer for neuroimaging figures.**
Render any brain parcellation in 3D, color regions by functional/statistical data,
draw DTI connectivity, and compose publication-ready figure panels — all in the browser.

### ▶ **[Live demo](https://rnorlund.github.io/brainWhiz/)**  ·  `index.html?atlas=aal`

![hero](docs/img/hero.png)

> **Why "brainWhiz"?** There's a well-known finding ([McCabe & Castel, 2008, *Cognition*](https://doi.org/10.1016/j.cognition.2007.07.017))
> that simply *adding a brain image* to a write-up makes the reasoning seem more credible — it
> measurably nudged people toward believing (and editors toward publishing). It's the neuroscience
> equivalent of squirting **Cheez Whiz on a cracker**: same cracker, but suddenly far more
> appetizing. brainWhiz is the can of Cheez Whiz for your data — point it at your results and get a
> figure that makes the whole thing go down easier. (Use the garnish responsibly. 🧠🧀)

---

## Highlights

- **16 bundled atlases**, switchable from a dropdown (JHU, AAL/AAL3, AICHA, Harvard-Oxford, Brodmann, …).
- **Bring your own data — no install:** drag-and-drop NIfTI (`.nii/.nii.gz`, 3D **and 4D**), **GIFTI** & **FreeSurfer** surfaces, **TRK/TCK** tractography, per-region **CSV**, figure recipes (`.bwz`).
- **Build an atlas in the browser** from a label `.nii` (+ labels `.txt`) — Surface-Nets meshing, no Python. A T1 → a smooth brain surface, also in-browser.
- **Every ROI is its own 3D object** — explode, rotate, isolate, recolor, fade.
- **Overlay stack** — task maps *and* your own MNI maps, each with color/colormap/threshold/|abs|/TFCE, plus **✂ crop-to-background** to hide out-of-brain artifacts; one drives the 3D brain, all blend in slices/mosaic.
- **4D timeseries** — scrub/▶ play a 4D overlay; the 3D mesh and 2D slices animate while you orbit.
- **Volume rendering** — GLSL raymarch (MIP / accumulate) of a map as glowing voxels **inside a glass brain**.
- **White-matter tracts** — solid hulls *or* synthesized **fiber strands** (white, or DTI-orientation colored).
- **Three view modes** — 3D mesh, ortho slices, mosaic/lightbox — with **28 colormaps** and TFCE.
- **DTI connectivity** averaged across ABC participants — strength-sized cylinders, colormaps, pulsing flow, and arced 3D arrows.
- **Projector** — cast an image / video / **webcam** onto the cortex; surface-conforming, shaped, **outlined decals**.
- **🥔 PotatoHead** — paint realistic face features on a T1-derived head (MRI re-identification / privacy demo).
- **Outputs** — PNG, **MP4/WebM recording**, a **🔗 living interactive `.html`** figure (rotate/zoom/explode), a **🎬 keyframe director → narrated MP4**, and multi-panel figure builder (PNG/PDF/SVG/`.bwz`).

| Functional overlay (gray brain + activation) | AICHA atlas (384 ROIs) |
|---|---|
| ![overlay](docs/img/overlay.png) | ![aicha](docs/img/atlas_aicha.png) |

---

## 🖼 Gallery

A **circular, interactive gallery** of 16 things brainWhiz can do: **[gallery.html](https://rnorlund.github.io/brainWhiz/gallery.html)**.
A central brainWhiz render is ringed by live demo plates — click any to launch that exact demo
(`index.html?demo=<id>`). Thumbnails, the keyframe-flythrough video, and the `?demo=` recipes live in
[`exampleFiles/`](exampleFiles/). Full scripting reference: **[API.md](API.md)**.

---

## 🔗 Embed it (like NiiVue)

Put a live, rotatable brainWhiz view in any web page — a NeuroSynth/NeuroQuery result, a lab
site, an online journal article. Add `?embed=1` to hide all chrome (just the 3D viewport) and
point the params at your data:

```html
<iframe width="640" height="420" style="border:0"
  src="https://rnorlund.github.io/brainWhiz/index.html?embed=1&atlas=jhu&overlay=https://example.org/language_z.nii.gz&cmap=hot&thr=0.3&view=left">
</iframe>
```

Configure entirely by URL: `overlay`/`underlay`/`surface`/`tracts`/`mesh` (remote, CORS-readable),
`cmap` `cmin` `cmax` `thr`, `scheme`, `explode`, `mode` (`mesh`/`slice`/`mosaic`), `view`, `bg`,
or a built-in `demo=`. For a fully self-contained, offline embed, export a **living figure `.html`**
(Figure ▸ Export interactive .html) and host that one file.

Want the host page to drive it **live** (swap overlay, move camera, change colormap) with no
reload? brainWhiz speaks `postMessage` both ways — `{brainWhiz:true, cmd:'loadOverlay', url:…}`.
Full URL + `postMessage` reference: **[API.md §1b](API.md)**.

---

## Quick start

![quickstart](docs/img/quickstart.gif)

**Online:** just open the **[live demo](https://rnorlund.github.io/brainWhiz/)**.

**Local:** open `index.html` in Chrome/Safari (needs internet for the Three.js CDN).
Switch atlas with the **Atlas** dropdown or the URL: `index.html?atlas=jhu` (`aal`, `bro`, `aicha`, `catani`, `fox`).

> Loading a statistical `.nii/.nii.gz` works fully offline via the file picker — no server needed.

---

## Atlases (16 bundled)

| id | atlas | ROIs | connectivity | task maps |
|----|-------|-----:|:---:|:---:|
| `jhu` | JHU (Johns Hopkins) | 189 | ✅ | ✅ |
| `aicha` | AICHA | 384 | ✅ | ✅ |
| `anatomy3` | SPM Anatomy v3 | 186 | – | ✅ |
| `aal3` | AAL3 | 161 | – | ✅ |
| `aalcat` | AAL (categorized) | 150 | – | ✅ |
| `neuromorph` | Neuromorphometrics | 134 | – | ✅ |
| `ho` | Harvard-Oxford | 117 | – | ✅ |
| `aal` | AAL | 116 | – | ✅ |
| `bro` | Brodmann | 82 | – | ✅ |
| `lpba40` | LPBA40 | 56 | – | ✅ |
| `cobra` | COBRA (subcortical/cerebellar) | 52 | – | ✅ |
| `xtract` | XTRACT white-matter tracts | 42 | – | ✅ |
| `arterial` | Arterial territories | 32 | – | ✅ |
| `hammers` | Hammers | 95 | – | ✅ |
| `catani` | Catani tracts | 27 | – | ✅ |
| `fox` | Fox | 10 | – | ✅ |

All atlases are in MNI space. **Connectivity** exists only for `jhu` and `aicha` — those are the only atlases with DTI matrices in the source ABC participant data (`dti_jhu`/`dti_AICHA`). Overlays and task maps work for every atlas (sampled/resampled into each atlas's own grid).

---

## Features in detail

**Regions & layout** — explosion (amount / distance / speed) + looping animation; orbit, zoom, pan; sagittal-left default; Top/Side/Front presets; auto-rotate; axis lines & letters with adjustable color and width.

**ROI chart** — collapsible groups by lobe; show/hide; per-ROI color pickers; search; **saved region sets** (localStorage) plus built-in **canonical motor** and **canonical LH-language** sets.

**Coloring** — schemes: by lobe, hemisphere, rainbow, random, single; or **color by value** (overlay) with 28 colormaps. Atlases whose labels don't map to lobes (e.g. Brodmann) auto-default to a distinct per-ROI scheme.

**Overlays** — build a stack of renameable overlays (each a baked **NeuroQuery** term or your own MNI `.nii/.nii.gz`). On the 3D mesh, the **active** overlay colors each ROI by its **mean value** (style = *gray brain + one color* or *full colormap*; editable range, threshold, invert, |abs|, live colorbar). In **Slices** and **Mosaic**, every visible overlay is **blended** in its own color/colormap/threshold over the MNI152 template (voxel-accurate, anatomy shows through), with optional **TFCE** cluster enhancement per overlay.

**Slices & Mosaic** — ortho viewer (axial/sagittal/coronal + 3D, click/drag to navigate, per-plane zoom; voxel heatmap or solid mesh cross-sections) and a publication-style **mosaic / lightbox** of evenly-spaced slices (choose plane, count, columns). Drop either into a figure panel.

**Connectivity** — averaged DTI streamline strength; cylinder radius ∝ strength; color by strength (any colormap) or single color; **pulse** mode animates a bead of light traveling each connection.

**Render** — vividness (saturation), rim/fresnel glow, Standard vs **Matcap** shading, soft studio environment; surface styles: solid, flat, **wireframe (adjustable thickness)**, and procedural **checkerboard / stripes / grid / dots / hatch** with *darken* or *transparent* (perforated lattice) fill; per-tier opacity (colored / gray / all); any background color; **save/load presets**.

**Loading data (drag-and-drop)** — drop files onto the viewport; the drop zone splits into **Background / Overlay / Build-atlas** bands (in Mesh view the top band is **Build mesh**). Accepts NIfTI, GIFTI, FreeSurfer, TRK/TCK, CSV, `.bwz`, `.bwzproj` — see [API.md §3](API.md).

**Browser-side atlas & surface building** — drop a **label `.nii`** (+ optional labels `.txt`) and brainWhiz extracts a full parcellation in-browser (Gaussian-smoothed **Surface Nets**, lobe-colored, named) — no `build_bundle.py` needed. A **continuous T1** builds one smooth brain surface (matcap).

**Surfaces & tractography** — load **GIFTI** (`.gii`) and **FreeSurfer** surfaces directly; load **TRK/TCK** streamlines rendered as fine DTI-orientation-colored lines. White-matter tract atlases (XTRACT/Catani) render as solid hulls **or** synthesized **fiber strands** (group-average look, individual fibers; white or DTI-colored), with a fiber-density control.

**4D timeseries** — drop a 4D overlay and a **▶ frame player** appears; the 3D mesh colors and the 2D slices animate frame-by-frame (stable range) while you orbit/zoom.

**Volume rendering** — raymarch the active overlay as a 3D `Data3DTexture` (**MIP** or **accumulate**, threshold/opacity/colormap/quality); pair with the **glass brain** to see glowing voxels inside the shell. 4D volumes animate on playback.

**Projector** — project an image, video, or **webcam** onto the cortex (wrap, project-from-view, or **decal stamp**). Decals conform to the surface, take **shapes** (circle/heart/star/…), and support **editable size/rotation + an outline** (color & thickness).

**🥔 PotatoHead (privacy demo)** — paint realistic, surface-conforming face features (eyes, brows, nose, mouth, glasses, ears) onto a T1-derived head, plus 3D hair — a hands-on demonstration of the MRI face-reconstruction re-identification risk (cf. Schwarz et al., *NEJM* 2019).

**Shareable outputs** — **PNG**; **MP4/WebM** screen recording of the 3D viewport; a **🔗 living interactive `.html`** figure (self-contained, rotate/zoom/explode — for journal supplementary); and a **🎬 keyframe director** that interpolates camera/explode/overlay/4D/caption keyframes and records a captioned MP4 flythrough.

**Access** — the public site is behind a lightweight password gate (deterrent; the app is client-side). Local use and the Engine edition are never gated.

---

## Figure panels

### In-app builder
Click **🗔 Panels** (bottom bar). A grid appears top-right; click a tile to drop the current view into it, then **Export PNG**. Toggle labels and a shared colorbar.

### Scriptable montage (reproducible)
![figure](docs/img/figure_example.png)

```bash
npm install ws            # one-time
node make_figure.mjs figure_example.json
```

Each panel sets its own atlas, view, overlay, colors, explosion, etc. (`figure_example.json` included).

### Shareable figure recipes (`.bwz`)
A **`.bwz`** file is a portable, human-/Claude-readable JSON that captures a whole figure —
grid, per-panel atlas, overlay (task term *or* `.nii` filename), combine mode, colors,
camera, visible regions, and all render + figure settings.

- In the 🗔 panel builder: **💾 .bwz** saves the recipe; **📂 .bwz** re-imports it (task panels
  recreate instantly; file panels offer a "relink" to locate the `.nii`).
- Render a `.bwz` reproducibly (resolving `.nii` files from a folder):
  ```bash
  node make_figure.mjs figure.bwz --root /path/to/nii-folder --out figure.png
  ```
- Because it's plain JSON ([`example.bwz`](example.bwz) included), you can ask **Claude**:
  *"write a brainWhiz .bwz for a 2×2 of motor, language, motor−language, and a working-memory map"* —
  then render it. Share `.bwz` + the `.nii` files and anyone recreates your exact figure.

The viewer exposes **`window.brainAPI`** for headless control:

```js
await window.brainAPI.ready;
await window.brainAPI.applyConfig({
  atlas: "jhu", view: "left", task: "motor",
  explosion: { amount: 0.3, distance: 1.5 },
  controls: { ovStyle: "solid", ovColor: "#d62728", vivid: 1.6, cthresh: 0.2 },
  uiHidden: true
});
const png = window.brainAPI.renderTo(640, 480);   // clean PNG data URL (no UI)
const bar = window.brainAPI.colorbar();           // {name,min,max,cmap,...}
```

---

## Build a new atlas bundle

```bash
python build_bundle.py \
  --atlas /path/to/parcellation.nii[.gz] \
  --labels /path/to/labels.txt \
  --id myatlas --name "My Atlas (N)" \
  [--conn-mats '/path/to/*.mat' --conn-field dti_field] \
  [--no-neuro]
```

Handles common label formats (`idx|abbr|name`, `idx,name`, FreeSurfer LUT, whitespace).
Outputs `bundles/<id>/{data.js, samples.js, conn.js?, neuro.js?}` and updates `bundles/registry.js`.
Requires `nibabel numpy scikit-image trimesh fast_simplification scipy` (+ `neuroquery nilearn` for task maps).

### Your own atlas + per-region values (CSV)

Have a parcellation **brainWhiz doesn't ship** and a CSV of one value per region (factor
loadings, scores, betas…)? It's a two-step flow — build the bundle once (offline), then drop
the CSV onto it in the browser (no rebuild needed when the values change):

```bash
# 1. one-time: turn your parcellation into a bundle (meshes can't be made in-browser)
python build_bundle.py \
  --atlas my_parc.nii.gz --labels my_labels.txt \
  --id myatlas --name "My Parc (N)" --no-neuro
python regen_registry.py            # make the viewer list it
```

```
# 2. in the viewer: open  index.html?atlas=myatlas  →  Overlays ▸ ➕ Load .csv
```

The CSV loader maps values onto regions automatically:

- a **region name / abbr** column → matched by name (must match the `--labels` names),
- an **id / roi** column → matched by id,
- otherwise, if the **row count equals the region count** → mapped in region-id order.

So the safest CSV is either `id,value` (or `region,value`) with a header, or a single column
of exactly *N* values in the same order as your labels file. The same CSV loads onto any
**already-bundled** atlas too (it even offers to switch atlas if the row count matches a
different one). Per-region CSV data colors the **3D mesh + mesh-region slices** (it has no
voxel volume, so it doesn't appear in the voxel slice view).

---

## Project structure

```
index.html            the viewer (loads a bundle by ?atlas=)
colormaps.js          28 colormaps (shared)
bundles/
  registry.js         list of available atlases
  <id>/data.js        per-ROI meshes (GLB, base64) + labels
  <id>/samples.js     per-ROI MNI sample points (for .nii overlays)
  <id>/conn.js        averaged DTI connectivity (optional)
  <id>/neuro.js       baked NeuroQuery task maps (optional)
build_bundle.py       atlas -> bundle converter
build_colormaps.py    regenerate colormaps.js
make_figure.mjs       headless multi-panel figure montage
make_gif.mjs          headless rotating Quickstart GIF (needs ffmpeg)
figure_example.json   example figure spec
```

---

## Examples (included)

Ready-to-run recipes in [`examples/`](examples/) + shareable sample stat maps:

| file | what it makes |
|------|----------------|
| [`example.bwz`](example.bwz) | 1×2: motor + language (3D meshes) |
| [`examples/fig_tasks_2x2.bwz`](examples/fig_tasks_2x2.bwz) | 2×2 of task maps (no files needed) |
| [`examples/fig_files.bwz`](examples/fig_files.bwz) | multi-overlay slice blend — motor (red) + language (blue); run with `--root examples` |
| `examples/neuroquery_{motor,language,working_memory}.nii.gz` | sample MNI stat maps to load as overlays |

```bash
node make_figure.mjs examples/fig_tasks_2x2.bwz --out tasks.png
node make_figure.mjs examples/fig_files.bwz --root examples --out files.png
```

| `fig_tasks_2x2.bwz` | `fig_files.bwz` (file overlays) |
|---|---|
| ![tasks](docs/img/sample_tasks.png) | ![files](docs/img/sample_files.png) |

## Offline / firewalled use
brainWhiz works **fully offline** with no CDN: the libraries are vendored in `vendor/`.
- **Served** (GitHub Pages, or run `python -m http.server` in the folder and open `localhost:8000`) →
  it loads the bundled libraries and needs **no internet** (the toolbar badge shows the mode).
- **Double-clicking `index.html`** (a `file://` path) uses the CDN instead (local ES modules are
  blocked by browser CORS on `file://`), so that route needs internet. To run offline, serve the folder.

## Requirements
- **Viewer:** any modern browser (Chrome/Safari/Firefox). Served → no internet needed; `file://` double-click → needs internet (CDN).
  Loading your own `.nii/.nii.gz` overlay works either way via the file picker.
- **Figure tool (`make_figure.mjs`):** Node.js + `npm install ws` + Chrome/Chromium installed.
- **Building atlas bundles (`build_bundle.py`):** Python with `nibabel numpy scikit-image trimesh
  fast_simplification scipy` (+ `neuroquery nilearn` for task maps). Overlays/atlases must be **MNI152**.

## Editing the project (Claude Code friendly)
Clone the repo and open it in **Claude Code** — [`CLAUDE.md`](CLAUDE.md) orients the assistant on
the architecture and common edits, and [`BWZ_FORMAT.md`](BWZ_FORMAT.md) documents every figure option.
You can literally say *"add an atlas / new colormap / a 3×2 figure of these contrasts"* and it has the
context to do it. `.bwz` files are plain JSON, so they're easy to hand-edit or have Claude generate.

## Data sources & citation
- **Atlases** (JHU, AAL, AICHA, Brodmann, Harvard-Oxford, Neuromorphometrics, Hammers, LPBA40, COBRA,
  Anatomy v3, AAL3, Catani, XTRACT, Fox, arterial) — © their respective authors; cite the original atlas.
- **Task maps** — [NeuroQuery](https://neuroquery.org) (open).
- **DTI/rsfMRI connectivity** — averaged from ABC-study participant data.
- Please cite the original atlas/NeuroQuery sources in any publication. To cite the tool, see
  [`CITATION.cff`](CITATION.cff).

**DOI / archiving (Zenodo).** Tagged releases (e.g. [`v1.0`](https://github.com/rnorlund/brainWhiz/releases/tag/v1.0))
are citable archives. To mint a permanent DOI, enable the repo in [Zenodo](https://zenodo.org/account/settings/github/)
(GitHub login → flip the switch for `brainWhiz`), then publish/re-publish a release — Zenodo archives it and
issues a DOI. Add that DOI to `CITATION.cff` (`doi:` field) and the badge here once issued.

## Editions — Research vs. Engine

This repo contains **two editions**:

- **Research edition** (the repo root) — ships all 16 atlases + NeuroQuery task maps + ABC
  connectivity + the MNI152 template. CC BY-NC 4.0 (noncommercial). This is what you use to test
  and make figures.
- **Engine edition** (`engine/`) — the *same app with no third-party data*, for commercial use.
  It ships only a **procedurally-generated synthetic atlas + template** (`make_synth_atlas.py`,
  100% original / license-free, clearly labelled "Synthetic" — not real anatomy) so it works out
  of the box; users bring their own real atlas (`build_bundle.py`), overlays (`.nii`/`.csv`), and
  slice underlay. See [`engine/README.md`](engine/README.md) and [`engine/THIRD_PARTY.md`](engine/THIRD_PARTY.md).

`engine/` is **generated** — never hand-edit it. After changing the main app, resync with:

```bash
node build_engine.mjs              # regenerate engine/ (app minus data, + synthetic atlas)
python build_bundle.py ...         # (only if you want to refresh the synthetic atlas:)
python make_synth_atlas.py         #   regenerates bundles/synth + the synthetic template
```

Why an engine edition? Every code dependency is permissive (three.js/fabric.js/jsPDF/pako = MIT,
colormaps = matplotlib BSD/CC0), so the *software* is fully ownable; the only commercial blockers
are the bundled research **datasets**, which the engine edition simply doesn't ship.

## License

© 2026 Roger Newman-Norlund. **All rights reserved except as granted.** **Noncommercial use
only** — licensed under [Creative Commons Attribution-NonCommercial 4.0 International
(CC BY-NC 4.0)](LICENSE), reinforced by the explicit terms in [`NOTICE.md`](NOTICE.md).

Free for research, education, personal, and other noncommercial purposes (incl. academic papers
and figures), **with attribution** and notices kept intact. **Not permitted without a separate
written commercial license:** any commercial use — in/for a product, a paid or hosted/SaaS or
ad-supported service, or a consulting deliverable — plus sublicensing, resale, relicensing, or
stripping notices. For commercial licensing, contact **Roger Newman-Norlund
(rnorlund@mailbox.sc.edu)**.

The bundled atlases, NeuroQuery maps, and ABC-derived DTI/rsfMRI connectivity are **third-party
data under their own terms**, included for noncommercial research use only — comply with and
cite the original sources. Provided **"as is", no warranty**; not a medical device; not for
clinical use.

## Notes & credits

- Task maps use **NeuroQuery** (the modern successor to Neurosynth); edit `NEURO_TERMS` in `build_bundle.py` to change them.
- DTI connectivity is averaged from ABC-participant `.mat` files (`dti_jhu` / `dti_AICHA` fields).
- Lobe grouping is a name-based heuristic for coloring, not a formal parcellation.

🤖 Built with [Claude Code](https://claude.com/claude-code)
