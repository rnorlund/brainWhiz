# brainWhiz

Interactive multi-atlas **exploding-brain** viewer (Three.js) with DTI connectivity,
functional/statistical overlays, NeuroQuery task maps, and scriptable figure-panel tooling.

## Open
Open `index.html` in a browser (Chrome/Safari). Pick an atlas from the **Atlas** dropdown
or via URL: `index.html?atlas=aal`. Bundled atlases: JHU, AAL, Brodmann, AICHA, Catani, Fox.

## Features
- Per-ROI 3D meshes; explosion (amount/distance/speed), rotation, sagittal-left default.
- ROI chart: show/hide, per-ROI colors, color schemes, search, saved region sets,
  canonical motor & LH-language sets.
- Data overlays: NeuroQuery task maps (baked) + load any MNI `.nii/.nii.gz`; color by
  mean ROI value with 28 colormaps (incl. colorblind-safe) or gray-brain + single color.
- DTI connectivity (averaged across ABC participants): cylinders sized by strength,
  colormap or single color, optional pulsing.
- Render: vividness, rim glow, matcap/standard shading, surface styles (solid, flat,
  wireframe with thickness, checkerboard/stripes/grid/dots/hatch with darken or transparent fill),
  per-tier opacity (colored/gray/all), axis lines & letters (color/width), backgrounds, presets.
- **Figure tooling**: in-app panel builder (corner grid + tiles + colorbar) and a
  scriptable montage pipeline `make_figure.mjs` driven by `window.brainAPI`.

## Build bundles
```
python build_bundle.py --atlas X.nii --labels X.txt --id myatlas --name "My Atlas" \
  [--conn-mats '/path/*.mat' --conn-field dti_field] [--no-neuro]
```

## Make a figure
```
npm install ws        # one-time
node make_figure.mjs figure_example.json
```

🤖 Generated with [Claude Code](https://claude.com/claude-code)
