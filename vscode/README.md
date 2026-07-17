# brainWhiz NIfTI Viewer (VS Code)

Open a `.nii` or `.nii.gz` file in VS Code and see it — no setup, no network.

- **Orthogonal slices** (axial / coronal / sagittal) with click/drag crosshair, scroll-to-scrub, per-plane sliders, window/level, and colormaps.
- **3D surface** — a folded-brain isosurface (Surface Nets), orbit/zoom.
- **Header details** — full NIfTI-1 header (dims, voxel size, datatype, orientation, sform/qform, affine, scl/cal, intent, description…), one-click copy.
- **4D** — frame slider for timeseries.

Self-contained: its own NIfTI parser, `.nii.gz` inflate via the browser's `DecompressionStream`, and a **locally vendored Three.js** — so it runs entirely in the webview with a strict CSP and works over **SSH / WSL / containers** (view data on a cluster from your editor).

## Install (share with others — no account needed)
Ship them the `brainwhiz-nii-viewer-<version>.vsix` and either:
- **VS Code UI:** Extensions panel → `⋯` (top-right) → **Install from VSIX…** → pick the file, or
- **CLI:** `code --install-extension brainwhiz-nii-viewer-0.1.0.vsix`

Then reload. To make it the default `.nii` viewer, right-click a `.nii` → **Open With… → Configure default editor for '*.nii'… → brainWhiz NIfTI Viewer** (or add to `settings.json`):
```json
"workbench.editorAssociations": { "*.nii": "brainwhiz.niiViewer", "*.nii.gz": "brainwhiz.niiViewer" }
```

## Develop
1. Open this `vscode/` folder in VS Code → press **F5** → an Extension Development Host opens.
2. Open any `.nii`/`.nii.gz` there. `node _smoke_test.mjs` runs a headless render check.

## Publish (so anyone can search + install)
```
npm i -g @vscode/vsce
vsce package                 # -> brainwhiz-nii-viewer-<version>.vsix  (shareable now)
vsce login <publisher>       # needs an Azure DevOps PAT (Marketplace: Manage scope)
vsce publish                 # VS Code Marketplace
npx ovsx publish *.vsix -p <token>   # Open VSX (Cursor / VSCodium / Windsurf)
```

## Roadmap
- Overlays (stat map on slices, colormap + threshold)
- In-browser **BET / tissue segmentation** (the brainWhiz ONNX model)
- More formats (`.mgz`, GIfTI meshes)

Part of **brainWhiz**. Noncommercial (see repo `LICENSE`); bundled data/atlases carry their own terms.
