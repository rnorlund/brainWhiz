# Third-party components in brainWhiz (Engine Edition)

The brainWhiz application code is © Roger Newman-Norlund (see LICENSE). It bundles these
third-party open-source libraries, each under its own permissive license (commercial use OK):

- **three.js** 0.160 (+ examples/jsm: OrbitControls, GLTFLoader, RoomEnvironment, PMREMGenerator)
  — MIT License — https://github.com/mrdoob/three.js
- **fabric.js** 5.3.0 — MIT License — https://github.com/fabricjs/fabric.js
- **jsPDF** 2.5.1 — MIT License — https://github.com/parallax/jsPDF
- **pako** 2.1.0 — MIT License — https://github.com/nodeca/pako
- **Colormaps** (`colormaps.js`) — generated from Matplotlib colormaps (Matplotlib is BSD-3-Clause;
  the *viridis/plasma/inferno/magma/cividis* family is released CC0 / public domain), plus two
  original colormaps (`actc`, `fire`).

The Matcap shading texture and the rendering shaders are generated procedurally in-app (no
third-party asset). The brainWhiz logo and favicon are © Roger Newman-Norlund.

NOTE: The Engine Edition ships **no third-party** neuroimaging datasets. The only included data is
a **procedurally-generated synthetic atlas + template** (`bundles/synth`, `bundles/_mni152.js`)
created by `make_synth_atlas.py` — 100% original, license-free, and clearly labelled "Synthetic"
(it is an abstract demo parcellation, NOT real anatomy). All real atlases/parcellations/templates/
task maps/connectivity remain the property of their authors under their own licenses — bring your
own (build a bundle with build_bundle.py, or load .nii / .csv overlays and a subject T1 underlay).
You are responsible for the licensing of any data you load.
