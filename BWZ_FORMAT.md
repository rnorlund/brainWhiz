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
  "grid": "2x2",                  // "ROWSxCOLS" (e.g. "1x2", "2x2", "3x2", "4x4")
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
  "label": "Motor − Language",    // title text ("" = no title for this panel)
  "atlas": "jhu",                 // bundle id: jhu aal aicha bro catani fox ho
                                  //   aalcat aal3 anatomy3 neuromorph hammers lpba40 cobra xtract arterial
  "fileA": "maps/motor.nii.gz",   // optional: Map-A overlay from a file (path relative to --root)
  "fileB": "maps/lang.nii.gz",    // optional: Map-B overlay from a file
  "camP": [-330, 12, 4],          // optional camera position (omit = default left-sagittal)
  "camT": [0, 0, 0],              // optional camera target
  "vis":  [12,13,25,26],          // optional: only these ROI ids visible (omit = all)
  "vals": { ...controls... }      // all viewer control values (see table below)
}
```

- **Task-map overlays** are set inside `vals` (`taskMap`, `taskMapB`) — no files needed.
- **File overlays** use `fileA`/`fileB`; `make_figure.mjs --root <folder>` resolves them.
  (In the browser, file panels prompt you to "relink" the file.)
- Overlays must be **MNI152-space** `.nii`/`.nii.gz`; each ROI is colored by its mean value.

---

## `vals` — viewer control reference

Values are strings for sliders/inputs and booleans for checkboxes (both are accepted).

### Overlay / data coloring
| id | values | meaning |
|----|--------|---------|
| `taskMap` | term or `""` | Map A: baked NeuroQuery term (motor, language, working memory, attention, visual, auditory, face, fear, reward, pain, emotion, semantic, reading, memory, spatial, inhibition, movement, finger tapping, speech production, decision making) |
| `taskMapB` | term or `""` | Map B term (for combine) |
| `ovCombine` | `none` `conj` `sub` | single map / conjunction (A∧B) / subtraction (A−B) |
| `ovStyle` | `solid` `cmap` | gray-brain + one color, or full colormap (single-map only) |
| `ovColor` | hex | Map-A / activation color |
| `ovColorB` | hex | Map-B color (combine modes) |
| `ovAndOnly` | bool | conjunction: show only where **both** A and B pass threshold |
| `cmap` | name | colormap for `cmap` style (viridis, jet, turbo, cividis, RdBu_rev, …28 total) |
| `cmin` `cmax` | number | value range (single-map) |
| `cthresh` | 0–1 | threshold as a fraction of range |
| `cmapInvert` | bool | invert colormap |
| `cmapAbs` | bool | use \|value\| |
| `scheme` | `lobe` `hemi` `rainbow` `random` `single` | categorical region coloring (when no overlay) |
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

```json
{
  "bwz": 1, "grid": "1x2",
  "figure": { "brain": 480, "titleSize": 24, "titleColor": "#111", "bg": "#ffffff" },
  "panels": [
    { "label": "Motor", "atlas": "jhu",
      "vals": { "taskMap": "motor", "ovStyle": "solid", "ovColor": "#d62728", "cthresh": "0.12" } },
    { "label": "Motor − Language", "atlas": "jhu",
      "vals": { "taskMap": "motor", "taskMapB": "language", "ovCombine": "sub",
                "ovColor": "#d62728", "ovColorB": "#1f77b4", "cthresh": "0.1" } }
  ]
}
```
