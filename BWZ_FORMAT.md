# brainWhiz `.bwz` figure-recipe format

A **`.bwz`** file is plain JSON describing a whole multi-panel brain figure: the grid, and
for every panel its atlas, overlay(s), colors, camera, visible regions, and render settings.
It is **human-editable** and **Claude-editable** — open the repo in Claude Code and ask it to
tweak a `.bwz`, or hand-edit in any text editor.

A `.bwz` + the referenced `.nii` files = a fully reproducible figure.

---

## Top level

```jsonc
{
  "bwz": 1,                       // format version (required)
  "app": "brainWhiz",             // optional tag
  "grid": "2x2",                  // "ROWSxCOLS" — any dimensions up to 12×12 (e.g. "1x2", "3x5", "4x4")
  "figure": { ... },              // figure-wide layout/style (see below)
  "panels": [ panel, panel, ... ] // one entry per grid cell; use null for an empty cell
}
```

### `figure`
| key | type | meaning |
|-----|------|---------|
| `brain` | px | width of each brain image (height = brain × 0.78) |
| `titleSize` | px | panel title font size (0 = no titles) |
| `titleFont` | css | `"system-ui"`, `"Georgia, serif"`, `"'Courier New', monospace"`, … |
| `titleColor` | hex | title color (use `#fff` on dark backgrounds) |
| `colorbarSize` | px | per-panel legend height (0 = no legends) |
| `gap` | px | spacing between panels |
| `bg` | hex | figure background (e.g. `#ffffff` or `#000000`) |

---

## A `panel`

```jsonc
{
  "label": "Motor",               // title text ("" = no title for this panel)
  "atlas": "jhu",                 // bundle id: jhu aal aicha bro catani fox ho
                                  //   aalcat aal3 anatomy3 neuromorph hammers lpba40 cobra xtract arterial
  "mode": "mesh",                 // "mesh" (3D) | "slice" (ortho 2x2) | "mosaic" (lightbox)
  "overlays": [ overlay, ... ],   // the overlay STACK (see below) — 0..N data overlays
  "active": 0,                    // index of the overlay shown on the 3D mesh
  "sliceMM": [0, -18, 50],        // slice/mosaic crosshair (MNI mm) for mode:"slice"
  "sliceKind": "voxel",           // mode:"slice" — "voxel" heatmap or "mesh" cross-sections
  "mosaic": { "plane":"axi", "n":16, "cols":6, "labels":true },   // mode:"mosaic" settings
  "camP": [-330, 12, 4],          // optional camera position (omit = default left-sagittal)
  "camT": [0, 0, 0],              // optional camera target
  "vis":  [12,13,25,26],          // optional: only these ROI ids visible (omit = all)
  "vals": { ...controls... }      // NON-overlay viewer controls (render/appearance/axes/conn)
}
```

### An `overlay` (entry in `panel.overlays`)
```jsonc
{
  "name": "Motor",                       // editable label shown in the Overlays list
  "kind": "task",                        // "task" (baked NeuroQuery) | "file" (your .nii)
  "term": "motor",                       // kind:"task" — the NeuroQuery term
  "fileName": "maps/motor.nii.gz",       // kind:"file" — path resolved by make_figure --root
  "visible": true,                       // shown in the slice/mosaic blend
  "tfce": false,                         // TFCE-enhance this overlay in slices/mosaic
  "s": {                                 // this overlay's appearance
    "style": "solid",                    // "solid" (gray brain + one color) | "cmap"
    "color": "#ff3b30",                  // solid color
    "cmap": "hot",                       // colormap for style:"cmap"
    "cmin": "0", "cmax": "6.4",          // 3D-mesh value range (per-ROI means)
    "cthresh": "0.25",                   // threshold (fraction of range, or raw — see cthreshMode)
    "cthreshMode": "frac",               // "frac" | "raw"
    "cmapInvert": false, "cmapAbs": false,
    "opacity": "1"                       // blend opacity in the slice/mosaic view
  }
}
```

- **3D mesh** shows the single `active` overlay (each region colored by its mean value).
- **Slices & mosaic** blend *all* `visible` overlays, each in its own color/colormap/threshold
  over the MNI152 template (voxel range, alpha ramps from the threshold up).
- **File overlays** (`kind:"file"`) need the `.nii`; `make_figure.mjs --root <folder>` resolves
  `fileName`. In the browser, file panels prompt you to relink. Task overlays need no file.
- Overlays must be **MNI152-space**. Legacy single-map `.bwz` (with `vals.taskMap`/`fileA`) still loads.

---

## `vals` — non-overlay viewer controls

Values are strings for sliders/inputs and booleans for checkboxes. (Overlay appearance now
lives per-overlay in `overlays[].s` above; `vals` holds the rest.)

### Region coloring (when no overlay is active)
| id | values | meaning |
|----|--------|---------|
| `scheme` | `lobe` `hemi` `rainbow` `random` `single` | categorical region coloring |
| `singleColor` | hex | color for `scheme:"single"` |

### Region opacity / emphasis
| id | values | meaning |
|----|--------|---------|
| `opacity` | 0.1–1 | all-regions master opacity |
| `coloredOp` | 0–1 | opacity of colored (saturated) regions |
| `grayOp` | 0–1 | opacity of gray/uncolored regions |
| `satCut` | 0–0.6 | saturation cutoff defining "colored" vs "gray" |

### Render / appearance
| id | values | meaning |
|----|--------|---------|
| `smooth` | 0–12 | mesh smoothing (Taubin passes) — rounds faceted marching-cubes meshes without shrinking; 0 = original |
| `surfStyle` | `Solid` `Flat shaded` `Wireframe` `Wireframe + fill` `Checkerboard` `Stripes` `Grid lines` `Dots` `Hatch` | surface render style |
| `patScale` | number | pattern cell size |
| `patStr` | 0–1 | pattern strength |
| `patMode` | `0` `1` | pattern fill: darken (0) / transparent cutout (1) |
| `wireWidth` | number | wireframe thickness |
| `shading` | `Standard` `Matcap` | lit vs studio matcap |
| `vivid` | 1–2.5 | color vividness (saturation boost) |
| `rim` | 0–1.5 | fresnel rim-glow strength |
| `rimColor` | hex | rim color |
| `bg` | hex | viewer background (figure bg is set in `figure.bg`) |

### Explosion / camera / axes
| id | values | meaning |
|----|--------|---------|
| `explode` | 0–1 | explosion amount |
| `distance` | 0–5 | explosion spread distance |
| `animSpeed` | 0.1–3 | explosion animation speed |
| `autoRotate` | bool | auto-rotate |
| `rotSpeed` | -4–4 | rotate speed |
| `spin` | bool | slow idle spin |
| `zoomSpeed` | 0.15–3 | mouse-wheel zoom sensitivity |
| `axisLines` | bool | show L/R·A/P·D/V axis lines |
| `axisLetters` | bool | show axis letters |
| `axisColor` | hex | axis color |
| `axisWidth` | number | axis line thickness |

### Connectivity
| id | values | meaning |
|----|--------|---------|
| `connOn` | bool | show DTI/RS connectivity (only atlases with data: jhu, aicha = DTI+RS; aal, aalcat, bro, catani, fox = RS; several = interpolated RS\*) |
| `connType` | `dti` `rs` | modality |
| `connTh` | number | min edge strength (units depend on modality) |
| `connScale` | number | line thickness scale |
| `connAll` | bool | connect hidden regions too |
| `connColorMode` | `strength` `single` | color edges by strength (colormap) or one color |
| `connCmap` | name | connectivity colormap |
| `connColor` | hex | single-color edges |
| `connPulse` | bool | animate a pulse along edges |
| `connPulseSpeed` | number | pulse speed |
| `connPulseColor` | hex | pulse color |

---

## Rendering a `.bwz`

```bash
npm install ws                                   # one-time
node make_figure.mjs figure.bwz                  # task-only figure
node make_figure.mjs figure.bwz --root maps/     # resolve .nii file overlays in maps/
node make_figure.mjs figure.bwz --out out.png    # choose output path
```

See [`example.bwz`](example.bwz) and [`examples/`](examples/) for ready-to-run recipes.

## Minimal example

A 1×2: a 3D mesh of "motor" (red), and a 3D mesh showing two overlays at once
(motor red + language blue) with motor active on the brain.

```json
{
  "bwz": 1, "grid": "1x2",
  "figure": { "brain": 480, "titleSize": 24, "titleColor": "#111", "bg": "#ffffff" },
  "panels": [
    { "label": "Motor", "atlas": "jhu", "mode": "mesh", "active": 0,
      "overlays": [
        { "name": "Motor", "kind": "task", "term": "motor", "visible": true,
          "s": { "style": "solid", "color": "#d62728", "cthresh": "0.12" } }
      ] },
    { "label": "Motor + Language", "atlas": "jhu", "mode": "mesh", "active": 0,
      "overlays": [
        { "name": "Motor",    "kind": "task", "term": "motor",    "visible": true, "s": { "style":"solid", "color":"#d62728", "cthresh":"0.12" } },
        { "name": "Language", "kind": "task", "term": "language", "visible": true, "s": { "style":"solid", "color":"#1f77b4", "cthresh":"0.12" } }
      ] }
  ]
}
```

A mosaic (lightbox) of a file overlay — run with `--root <folder containing the .nii>`:

```json
{
  "bwz": 1, "grid": "1x1",
  "figure": { "brain": 900, "titleSize": 22, "titleColor": "#fff", "bg": "#000000" },
  "panels": [
    { "label": "Axial mosaic", "atlas": "jhu", "mode": "mosaic",
      "mosaic": { "plane": "axi", "n": 16, "cols": 6, "labels": true },
      "overlays": [
        { "name": "Activation", "kind": "file", "fileName": "motor.nii.gz", "visible": true,
          "s": { "style": "cmap", "cmap": "hot", "cthresh": "0.3" } }
      ] }
  ]
}
```
