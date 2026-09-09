# Handoff

**Updated:** 2026-09-09 — end of M0.

## State

**M0 is done and its exit criterion is demonstrated, not claimed.** The app builds, launches,
renders the real `board/root.board.json` as a pannable pixel-art board, and `npm run verify` is
green. Everything on screen is a placeholder rectangle, which is the intended M0 state.

Evidence, from `npm run smoke` (writes four PNGs, drives the app with real key events):
- Window opens at zoom 3x showing the tiled solder-mask substrate. WASD pans it (23% of pixels
  changed between the before/after captures). 2/3/4 change zoom.
- `devicePixelRatio = 1` on a machine whose OS scaling is **200%**.
- The rendered board area contains **exactly four unique colours** — `#0E1A14`, `#16261D`,
  `#7A5423`, `#E9E4D6` — and all four are exact `skynet.gpl` entries. Identical at 2x, 3x and 4x.
  Any bilinear filter, fractional transform or antialiasing anywhere in the stack would have
  produced intermediate values. Nothing shimmers.
- 165 FPS with 12 nodes.

## Done

- **Dependency tree fixed.** Electron 44.3.0 (33 is EOL). `better-sqlite3` dropped for Node's
  built-in `node:sqlite` — verified `DatabaseSync` **and** `fts5` both work in Electron 44's
  runtime, so `skynet.db` and the Codex index need no native modules. `node-pty` and `keytar`
  moved to `optionalDependencies` so a failed `node-gyp` build no longer rolls back the whole
  install.
- **M0 skeleton.** electron-vite + React 18 + TS strict + Pixi v8. `contextIsolation`,
  `sandbox`, `nodeIntegration: false`, `webSecurity`, a CSP, `will-navigate` and
  `setWindowOpenHandler` denials, and a remote-request block on the main window.
- **Typed IPC.** One allowlist in `packages/shared/ipc.ts`; the preload is built by iterating it,
  so there is no generic `invoke(channel)` escape hatch, and a channel with no handler is a
  typecheck failure.
- **The placeholder sprite path**, which is what lets M0–M4 ship with zero art. The renderer asks
  `SpriteStore` for a key, never a path; a key the atlas cannot supply draws as a mask-light
  rectangle with the node's designator in silkscreen.
- **Silkscreen text with guaranteed binary alpha** — glyphs are rasterised from Departure Mono
  then alpha-thresholded and forced to one exact palette colour, so canvas antialiasing cannot
  leak a soft pixel onto the board.
- **Vendor inventory.** All four packs audited; every sheet's real cell/margin/spacing measured
  and written into its `SOURCE.md` and into `manifest.json`.
- **`tools/sheet-contact.mjs`** — renders a vendor sheet with the cell grid and a coordinate
  ruler drawn over it. This is how cell coordinates get picked from now on. Do not guess them.
- **`tools/smoke-shot.mjs`** — launches the built app, screenshots it, drives pan/zoom, exits.
  The seed of the M5 golden-image diff.
- 51 unit tests: camera integer-pixel guarantees, palette-vs-`.gpl`-vs-board-JSON agreement,
  and `types.ts`-vs-JSON-Schema agreement.
- Docs corrected in place where reality contradicted them (`docs/01`, `docs/02`, `docs/05`,
  `assets/vendor/README.md`), and eight decisions appended to `docs/DECISIONS.md`.

## Next

**M1 — board data to pixels.** In order:

1. Move JSON Schema validation into the main process so `board-store.ts` returns a *validated*
   `Board`, and a malformed file shows the schema error on the canvas. The plumbing for the error
   path already works — `App.tsx` renders a `BOARD NOT LOADED` panel and it has been seen on
   screen.
2. Render `note.silk` and `group.zone`, which M0 skips.
3. `BoardGraph` + hand-routed traces from `edges[].waypoints`.
4. Selection, the inspector panel, the breadcrumb.
5. First real click target: `store.repo` → open in Explorer. That is M1's exit criterion.

## Landmines

- **`pixi.js/unsafe-eval` must stay imported** at the top of `BoardCanvas.tsx`, before any
  renderer exists. Remove it and the canvas dies under our CSP with
  `Current environment does not allow unsafe-eval`. That is exactly how the first M0 run failed.
- **`npm install` blocks install scripts.** npm 11 gates them behind `allowScripts` in
  `package.json`. `electron` and `esbuild` are approved there; without that the Electron binary
  never downloads and `node_modules/electron/dist/` stays empty with no obvious error.
- **The preload must build as CJS.** `package.json` is `"type": "module"`, but a sandboxed preload
  cannot load an ES module. `electron.vite.config.ts` forces `format: 'cjs'` and
  `index.cjs`; `src/main/index.ts` points at that exact filename. Changing one without the other
  gives you a window with no bridge and a silent failure.
- **Cell coordinates in `manifest.json` are still illustrative.** The `sheets` block is now
  measured and trustworthy; the two example sprite entries are not, and are disabled by their `$`
  prefix. Run `npm run sheet` before trusting any `cell: [x, y]`.
- **Kenney's monochrome white is `rgb(249,250,251)`, not `#FFFFFF`.** The old remap table was
  written against `255,255,255` and would have thrown at bake time. Take a colour census; do not
  eyeball a source colour.
- `validate-board.mjs` needs `ajv/dist/2020.js`, not `ajv` — the schema is draft 2020-12.
- `assets/atlas/` is git-ignored. A fresh clone has no art until `npm run assets:bake`, which
  `npm run verify` does automatically.
- **`node-pty` still has no working build on this machine** (node-gyp 9 + Python 3.12 =
  `No module named 'distutils'`). M3 needs the embedded xterm tab; the `popout` launch mode does
  not need a PTY, so M3 can ship its exit criterion without solving this. Solve it when the
  embedded terminal is actually built, not before.
