#!/usr/bin/env node
// build_engine.mjs — regenerate the commercial "Engine Edition" into ./engine
//
// The Engine Edition is the SAME brainWhiz app MINUS all bundled neuroimaging data
// (atlases / NeuroQuery maps / connectivity / MNI152 template), so it can be sold without
// redistributing third-party research datasets. Users bring their own atlas (build_bundle.py),
// overlays (.nii / .csv), and slice underlay (subject T1).
//
// `engine/` is a PURE DERIVATIVE — never hand-edit it. After updating the main app, just run:
//     node build_engine.mjs
// and it is regenerated to match. The main repo (with all atlases) is left untouched.

import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const OUT  = path.join(ROOT, 'engine');

// Files/dirs copied verbatim (kept byte-identical to main so sync is trivial).
const COPY = [
  'index.html', 'colormaps.js', 'shading_thumbs.js', 'vendor',
  'build_bundle.py', 'build_colormaps.py', 'regen_registry.py', 'interpolate_conn.py',
  'make_figure.mjs', 'BWZ_FORMAT.md', 'brainwhiz_logo.png', 'favicon.png',
];

async function exists(p){ try{ await fs.access(p); return true; }catch{ return false; } }
async function copyAny(src, dst){
  const st = await fs.stat(src);
  if(st.isDirectory()){
    await fs.mkdir(dst, {recursive:true});
    for(const name of await fs.readdir(src)) await copyAny(path.join(src,name), path.join(dst,name));
  } else {
    await fs.mkdir(path.dirname(dst), {recursive:true});
    await fs.copyFile(src, dst);
  }
}

const THIRD_PARTY = `# Third-party components in brainWhiz (Engine Edition)

The brainWhiz application code is © Roger Newman-Norlund (see LICENSE). It bundles these
third-party open-source libraries, each under its own permissive license (commercial use OK):

- **three.js** 0.160 (+ examples/jsm: OrbitControls, GLTFLoader, RoomEnvironment, PMREMGenerator)
  — MIT License — https://github.com/mrdoob/three.js
- **fabric.js** 5.3.0 — MIT License — https://github.com/fabricjs/fabric.js
- **jsPDF** 2.5.1 — MIT License — https://github.com/parallax/jsPDF
- **pako** 2.1.0 — MIT License — https://github.com/nodeca/pako
- **Colormaps** (\`colormaps.js\`) — generated from Matplotlib colormaps (Matplotlib is BSD-3-Clause;
  the *viridis/plasma/inferno/magma/cividis* family is released CC0 / public domain), plus two
  original colormaps (\`actc\`, \`fire\`).

The Matcap shading texture and the rendering shaders are generated procedurally in-app (no
third-party asset). The brainWhiz logo and favicon are © Roger Newman-Norlund.

NOTE: The Engine Edition ships **no third-party** neuroimaging datasets. The only included data is
a **procedurally-generated synthetic atlas + template** (\`bundles/synth\`, \`bundles/_mni152.js\`)
created by \`make_synth_atlas.py\` — 100% original, license-free, and clearly labelled "Synthetic"
(it is an abstract demo parcellation, NOT real anatomy). All real atlases/parcellations/templates/
task maps/connectivity remain the property of their authors under their own licenses — bring your
own (build a bundle with build_bundle.py, or load .nii / .csv overlays and a subject T1 underlay).
You are responsible for the licensing of any data you load.
`;

const README = `# brainWhiz — Engine Edition

The same brainWhiz viewer/figure tool, shipped **without any third-party neuroimaging data** so it
can be used and distributed commercially. It includes one **procedurally-generated synthetic atlas**
(license-free demo, clearly labelled "Synthetic" — not real anatomy) so it works out of the box;
you supply your own real data.

## Getting started (bring your own data)
- **Atlas / parcellation:** build a bundle from your MNI-space label NIfTI with
  \`python build_bundle.py --atlas X.nii --labels X.txt --id myid --name "My (N)" --no-neuro\`,
  run \`python regen_registry.py\`, then open \`index.html?atlas=myid\`.
- **Overlays:** in the app, **Overlays ▸ ➕ Load .nii** (MNI stat map) or **➕ Load .csv**
  (one value per region).
- **Slice background:** load a subject T1 (or your own template) as the underlay in the Slices panel.

With no atlas loaded the app boots to an empty state with these instructions.

## Licensing
- The application code is © Roger Newman-Norlund — see \`LICENSE\` (commercial terms).
- Bundled open-source libraries are listed in \`THIRD_PARTY.md\` (all permissive: MIT/BSD/CC0).
- **No third-party datasets are included.** Any atlas/template/overlay you load is governed by its
  own license — your responsibility.

## Regeneration
This folder is generated from the main brainWhiz repo by \`build_engine.mjs\` — do not edit it by
hand. After updating the main app, run \`node build_engine.mjs\` to refresh it.
`;

const LICENSE = `brainWhiz — Engine Edition
Copyright (c) 2026 Roger Newman-Norlund. All rights reserved.

This is a COMMERCIAL edition. The brainWhiz application code (index.html, the build/tooling
scripts, colormaps, and documentation authored by the copyright holder) is proprietary and may
be licensed for commercial use under terms set by the copyright holder. Contact
rnorlund@mailbox.sc.edu for licensing.

Bundled third-party open-source libraries remain under their own licenses (MIT/BSD/CC0) — see
THIRD_PARTY.md; their notices are retained.

This edition ships NO neuroimaging datasets. Any atlas, template, parcellation, task map, or
overlay loaded into the software is the property of its respective authors under its own license,
and is the user's responsibility — nothing here grants rights to any such data.

Provided "AS IS", without warranty of any kind. Not a medical device; not for clinical use.

[Replace this file with your final EULA / commercial license text before distribution.]
`;

(async ()=>{
  // 1. wipe + recreate engine/
  await fs.rm(OUT, {recursive:true, force:true});
  await fs.mkdir(OUT, {recursive:true});

  // 2. copy the app verbatim
  const copied = [];
  for(const item of COPY){
    const src = path.join(ROOT, item);
    if(await exists(src)){ await copyAny(src, path.join(OUT, item)); copied.push(item); }
  }

  // 3. bundles/: NO third-party data. Ship ONLY the procedurally-generated synthetic atlas +
  //    synthetic template (both 100% original / license-free) so the engine isn't empty.
  await fs.mkdir(path.join(OUT, 'bundles'), {recursive:true});
  let registry = [];
  const synthDir = path.join(ROOT, 'bundles', 'synth');
  const synthTpl = path.join(ROOT, 'bundles', '_mni152_synth.js');
  if(await exists(synthDir) && await exists(synthTpl)){
    await copyAny(synthDir, path.join(OUT, 'bundles', 'synth'));               // synth atlas meshes
    await fs.copyFile(synthTpl, path.join(OUT, 'bundles', '_mni152.js'));      // synth slice template (app expects this name)
    // pull the 'synth' entry out of the main registry so badges/nroi match
    const txt = await fs.readFile(path.join(ROOT,'bundles','registry.js'),'utf8');
    const reg = new Function('return (function(){var window={};'+txt+';return window.ATLAS_REGISTRY||[];})()')();
    const synth = reg.find(a=>a.id==='synth');
    if(synth) registry = [synth];
  } else {
    console.warn('  ! bundles/synth not found — run `python3 make_synth_atlas.py` first. Shipping empty registry.');
  }
  await fs.writeFile(path.join(OUT, 'bundles', 'registry.js'),
    '// Engine Edition: only the procedurally-generated synthetic atlas (license-free). Add your own cleared atlases here.\nwindow.ATLAS_REGISTRY='+JSON.stringify(registry)+';\n');

  // 4. edition docs / license
  await fs.writeFile(path.join(OUT, 'THIRD_PARTY.md'), THIRD_PARTY);
  await fs.writeFile(path.join(OUT, 'README.md'), README);
  await fs.writeFile(path.join(OUT, 'LICENSE'), LICENSE);

  // 5. manifest
  const EXCLUDED = [
    'bundles/<id>/{data,samples,conn,neuro}.js  (all 16 atlases)',
    'bundles/_mni152.js  (MNI152 template)',
    'examples/*  (sample data / recipes)', 'NOTICE.md / LICENSE (research edition)',
  ];
  console.log('Engine Edition regenerated -> engine/');
  console.log('  copied verbatim: ' + copied.join(', '));
  console.log('  bundles: synthetic atlas ('+(registry[0]?registry[0].name:'none')+') + synthetic template only');
  console.log('  added: LICENSE (commercial), THIRD_PARTY.md, README.md');
  console.log('  EXCLUDED (not shipped):');
  for(const e of EXCLUDED) console.log('    - ' + e);
})().catch(e=>{ console.error('build_engine failed:', e); process.exit(1); });
