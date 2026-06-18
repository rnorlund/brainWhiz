# Contributing to brainWhiz

Thanks for your interest! brainWhiz is a static, single-page Three.js app plus Python/Node
tooling — no build step. See **[CLAUDE.md](CLAUDE.md)** for the architecture and common-edit recipes
(it's written so you can open the repo in Claude Code and make changes confidently).

## Quick orientation
- The whole viewer is **`index.html`** (HTML + CSS + one ES module). Section comments mark each area.
- Atlases live in **`bundles/<id>/`**; the list is **`bundles/registry.js`**.
- `build_bundle.py` adds atlases; `make_figure.mjs` renders figures; see **[BWZ_FORMAT.md](BWZ_FORMAT.md)**.

## Dev / test
- No compile step. To sanity-check the viewer JS: extract the `<script type="module">` block and run `node --check`.
- Headless render check: `npm install ws` then `node make_figure.mjs example.bwz --out /tmp/test.png`.
- CI (`.github/workflows/ci.yml`) runs syntax checks + a headless render on every push/PR.

## Conventions
- Keep viewer logic in `index.html` (no bundler). Libraries are vendored in `vendor/` for offline use.
- New persisted UI control → give it an `id`, wire it, add the id to `PRESET_IDS`, and document it in `BWZ_FORMAT.md`.
- Atlases/overlays must be **MNI152** space. Run `regen_registry.py` after any bundle change.

## Pull requests
- Keep changes focused; describe what you tested. Be mindful that bundled atlas/connectivity data
  carries third-party terms — don't add data you can't redistribute for noncommercial research.
- License: contributions are under the project's **CC BY-NC 4.0** (noncommercial) license.
