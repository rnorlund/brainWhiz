# 🧠 brainWhiz

**Interactive, multi-atlas "exploding-brain" viewer for neuroimaging figures.**
Render any brain parcellation in 3D, color regions by functional/statistical data,
draw DTI connectivity, and compose publication-ready figure panels — all in the browser.

### ▶ **[Live demo](https://rnorlund.github.io/brainWhiz/)**  ·  `index.html?atlas=aal`

![hero](docs/img/hero.png)

---

## Highlights

- **6 bundled atlases**, switchable from a dropdown — JHU, AAL, Brodmann, AICHA, Catani, Fox.
- **Every ROI is its own 3D object** — explode, rotate, isolate, recolor, fade.
- **Functional / statistical overlays** — 20 baked NeuroQuery task maps *or* load your own MNI `.nii/.nii.gz`; regions colored by their mean value.
- **28 colormaps** (perceptual + colorblind-safe + diverging) and a "gray brain + one color" activation style.
- **DTI structural connectivity** averaged across 293 ABC participants — cylinders sized by tract strength, colormapped, with optional **pulsing flow**.
- **Figure tooling** — an in-app panel builder *and* a scriptable headless montage pipeline for reproducible multi-panel figures.

| Functional overlay (gray brain + activation) | AICHA atlas (384 ROIs) |
|---|---|
| ![overlay](docs/img/overlay.png) | ![aicha](docs/img/atlas_aicha.png) |

---

## Quick start

**Online:** just open the **[live demo](https://rnorlund.github.io/brainWhiz/)**.

**Local:** open `index.html` in Chrome/Safari (needs internet for the Three.js CDN).
Switch atlas with the **Atlas** dropdown or the URL: `index.html?atlas=jhu` (`aal`, `bro`, `aicha`, `catani`, `fox`).

> Loading a statistical `.nii/.nii.gz` works fully offline via the file picker — no server needed.

---

## Atlases

| id | atlas | ROIs | connectivity | task maps |
|----|-------|-----:|:---:|:---:|
| `jhu` | JHU (Johns Hopkins) | 189 | ✅ | ✅ |
| `aal` | AAL | 116 | – | ✅ |
| `bro` | Brodmann | 82 | – | ✅ |
| `aicha` | AICHA | 384 | ✅ | ✅ |
| `catani` | Catani tracts | 27 | – | ✅ |
| `fox` | Fox | 10 | – | ✅ |

All atlases are in MNI152 space, so overlays and connectivity align across them.

---

## Features in detail

**Regions & layout** — explosion (amount / distance / speed) + looping animation; orbit, zoom, pan; sagittal-left default; Top/Side/Front presets; auto-rotate; axis lines & letters with adjustable color and width.

**ROI chart** — collapsible groups by lobe; show/hide; per-ROI color pickers; search; **saved region sets** (localStorage) plus built-in **canonical motor** and **canonical LH-language** sets.

**Coloring** — schemes: by lobe, hemisphere, rainbow, random, single; or **color by value** (overlay) with 28 colormaps. Atlases whose labels don't map to lobes (e.g. Brodmann) auto-default to a distinct per-ROI scheme.

**Overlays** — pick a baked **NeuroQuery** task term, or load an MNI `.nii/.nii.gz`; each ROI is colored by its **mean value** (sampled from ~180 MNI points/ROI). Style = *gray brain + one color* (activation pops) or *full colormap*; editable range, threshold, invert, |abs|, live colorbar.

**Connectivity** — averaged DTI streamline strength; cylinder radius ∝ strength; color by strength (any colormap) or single color; **pulse** mode animates a bead of light traveling each connection.

**Render** — vividness (saturation), rim/fresnel glow, Standard vs **Matcap** shading, soft studio environment; surface styles: solid, flat, **wireframe (adjustable thickness)**, and procedural **checkerboard / stripes / grid / dots / hatch** with *darken* or *transparent* (perforated lattice) fill; per-tier opacity (colored / gray / all); any background color; **save/load presets**.

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
figure_example.json   example figure spec
```

---

## Notes & credits

- Task maps use **NeuroQuery** (the modern successor to Neurosynth); edit `NEURO_TERMS` in `build_bundle.py` to change them.
- DTI connectivity is averaged from ABC-participant `.mat` files (`dti_jhu` / `dti_AICHA` fields).
- Lobe grouping is a name-based heuristic for coloring, not a formal parcellation.

🤖 Built with [Claude Code](https://claude.com/claude-code)
