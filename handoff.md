# Handoff

**Updated:** 2026-09-09 — M0 done, M1 substantially done, M6's editing pulled forward.

## State

The app builds, launches, renders `board/root.board.json` with traces and silkscreen, resolves
every node's target against the real filesystem, opens real folders in Explorer and VS Code, and
lets you edit any node through a form with a native file picker. Every edit is validated,
snapshotted and undoable. Drag pans the board; drag in Edit Board mode moves components. Any node
can take an image, which is re-drawn in the room's six colours. `npm run verify` is green:
208 tests.

Everything on the board is still a placeholder rectangle. That is intended — no atlas exists yet.

## Evidence, not claims

`npm run smoke` builds, launches the app, drives it with real key events, screenshots it, and
exercises the command bus over the real IPC bridge. Latest run:

```
devicePixelRatio = 1                            (on a machine at 200% OS scaling)
drag-pan at 4x: 25.94% of the board area changed
node drag moved 1 node(s): u1_jarvis 28,17 -> 32,19
node drag undo: ok=true  every node back at origin=true
edit applied: ok=true changed=1 snapshot=yes    marker written to disk: true
undo: ok=true  marker gone: true                file byte-identical: true
off-board move refused: true                    board unchanged by refusal: true
unapproved delete blocked: true needsApproval=true   board unchanged: true
```

Colour census, with two mosaic face images on screen: the rendered board area contains **7 unique
colours, every one an exact `skynet.gpl` entry** — zero antialias blends, zero colour fringes. The
HUD and inspector contain zero colour fringes and only greyscale glyph-edge blends. All four room
signals appear at once on the root board, which is the relation colour working. 165 FPS.

## Done this session

**Asset / licence housekeeping**
- Deleted the two licence-untraceable OGA files, with William's authorisation. The quarantine
  list in `validate-assets.mjs` is kept as a tripwire in case a re-download restores them.

**Palette**
- MinecraftOS signal `#57C25A` → `#A8E85C`, DeductionOS `#E0A22E` → `#FFD866`. They had been
  byte-identical to `ok` and `warn`. A test now enforces a minimum distance from every status
  colour, so the collision cannot come back silently.
- **Relation colour**: an edge or `group.zone` may name another board in `relation`, and its
  inner strand / outline is drawn in that room's signal. Root's four JARVIS `supervises` wires
  each carry their destination room's colour. Costs the sprite colour budget nothing.

**M1 — board data to pixels**
- Real JSON Schema validation in the main process on every load *and* every write.
- Copper traces: orthogonal router, per-kind treatment (dashed `depends`, thin `reads`, inner
  signal strand on `supervises`), vias at bends.
- `note.silk` and `group.zone` render. Selection brackets, broken-target stipple.
- Click / double-click / Tab / Shift+Tab / Space / Escape. Focus mode (F).
- **Real OS effects**: `store.repo` and `store.folder` open in Explorer or VS Code;
  `link.url` and `store.cloud` open in the browser; `file.document` opens in its default app;
  `file.exe` launches after a confirmation showing the resolved path.

**The two interfaces William asked for**
- **Target picker** — every field that names a file, folder, glob, URL or board file gets a
  Browse button (native OS dialog) and a live verdict that re-checks as you type. Picking a
  concrete file for a glob field generalises it to `*.<ext>` and says so.
- **Node editor** — a form generated from `packages/shared/node-fields.ts`, which a test holds
  against the JSON Schema, so it offers exactly the fields the schema accepts and requires
  exactly what the schema requires. Shows a pending-changes diff before saving.
- **Command bus** in the main process with exact inverses, snapshots, and Ctrl+Z / Ctrl+Y.

**UI scale, drag, labels and face images (this session)**
- **Chrome scale.** The DOM chrome now carries its own integer `--ui-scale`, derived from the OS
  scale factor. Forcing `devicePixelRatio` to 1 for the board had halved the physical size of
  every panel; the board and the chrome now scale independently and both stay pixel-exact.
- **Click and drag.** Left-drag on empty substrate pans, middle-drag pans anywhere, and
  left-drag on a component moves it in Edit Board mode with a snapped, collision-checked ghost.
  A press under 4px is still a click. Moves go through the command bus, so they undo.
- **`E` and `F2` split.** `E` is Edit Board mode; `F2` opens the node form. They shared a flag,
  which meant opening a form made every component draggable.
- **Names on the board.** `U1 JARVIS`, not `U1`. Wraps on spaces, after hyphens and at camelCase,
  so `TruthQuestRetro` prints as `S1 TRUTH / QUEST / RETRO` instead of being dropped.
- **Node face images.** Any node can take an `image`; it is downsampled to the footprint and
  ordered-dithered onto the room's six colours, so it reads as printed component marking rather
  than a pasted photo. Cached in userData, keyed by path + mtime + footprint + theme.
- **Text rendering.** `-webkit-font-smoothing` is a no-op on Windows; the Chromium switches
  `disable-lcd-text` and `disable-font-subpixel-positioning` removed every colour fringe.

**Infrastructure**
- Board JSON has an enforced canonical form; `validate:board` fails if a file drifts, so an edit
  is a one-line diff instead of a whole-file reformat.
- `.gitattributes` now pins LF in the working tree.
- Settings at `%APPDATA%/SkynetOS/settings.json` — dev roots, elevation and stream-mode flags.
  Deliberately has **no** IPC writer: docs/07 says settings are user-only.

## Next

**Finish M1, then M2.** In order:

1. **Descend into a room.** `drive.room` click still reports "M2". The board loader, the theme
   and the breadcrumb are all already per-board — this is mostly the iris transition and a
   navigation stack.
2. **The real trace router** (M2). The current one has no obstacle avoidance and it shows: the
   `s1_repo_skynet -> j1_github` run passes straight through U2 on the root board. Orthogonal A*
   on the 16px grid, avoiding node footprints, with bundling.
3. Seeded procedural substrate per room, and the palette-swap shader.

## Landmines

- **`pixi.js/unsafe-eval` must stay imported** at the top of `BoardCanvas.tsx`, before any
  renderer exists. Remove it and the canvas dies under our CSP.
- **`npm install` blocks install scripts.** npm 11 gates them behind `allowScripts` in
  `package.json`; `electron` and `esbuild` are approved there. Without it the Electron binary
  never downloads and `node_modules/electron/dist/` is silently empty.
- **The preload must build as CJS.** `package.json` is `"type": "module"` but a sandboxed preload
  cannot load an ES module. `electron.vite.config.ts` forces `index.cjs` and `src/main/index.ts`
  points at that exact name. Change one without the other and you get a window with no bridge.
- **Board files must stay canonical.** If `validate:board` complains, run the file through
  `JSON.stringify(…, null, 2) + '\n'` — do not relax the check. It is what keeps board diffs
  reviewable.
- **The trace router has no obstacle avoidance.** A trace whose endpoints line up across a third
  node will run straight through it. Known, visible on the root board, fixed at M2.
- **Cell coordinates in `manifest.json` are still illustrative.** The `sheets` block is measured
  and trustworthy; the two example sprite entries are not, and are disabled by their `$` prefix.
  Run `npm run sheet` before trusting any `cell: [x, y]`.
- **Kenney's monochrome white is `rgb(249,250,251)`, not `#FFFFFF`.** Census a source sheet; do
  not eyeball its colours.
- **`sendInputEvent` takes DIP, the renderer works in CSS px.** Main sets
  `zoomFactor = 1/scaleFactor`, so on a 200% display one DIP is TWO renderer CSS pixels. A
  synthetic grab at DIP 192 lands at CSS 384. Never compute a test grab coordinate from an
  assumed camera position — snapshot the data, gesture, and read back what changed.
- **A drag test at zoom 2 proves nothing.** The root board is smaller than a large window at 2x,
  so the camera is centred and panning is correctly a no-op. Test panning at 3x or 4x.
- `validate-board.mjs` needs `ajv/dist/2020.js`, not `ajv` — the schema is draft 2020-12.
- `assets/atlas/` is git-ignored. A fresh clone has no art until `npm run assets:bake`, which
  `npm run verify` does automatically.
- **`node-pty` still has no working build here** (node-gyp 9 + Python 3.12 = no `distutils`).
  M3's `popout` launch mode does not need a PTY, so M3 can hit its exit criterion without
  solving this. Solve it when the embedded terminal is actually built.

## Waiting on William

1. **`REPLACE_ME` / `REPLACE_WITH_` placeholders** in the board data — GitHub org, the JARVIS /
   Observer / SITW conversation URLs, the Documents path for the manuscript. Those nodes render
   as broken right now, correctly. The editor can fix them in place: select the node, press E,
   Browse or paste, Save.
2. **Which rooms are actually related.** Only MinecraftOS ↔ GameOS is declared, because the board
   data justifies it. Everything else would be a guess.
3. `C:/dev` has 13 repos; the boards reference 4. M6's first-run scan covers the rest.
4. **Face images are wired but no board node uses one yet.** Select a node, `F2`, Browse on
   "Face image", pick any picture, Save. It is downsampled and dithered to the room's palette.
   I tested it with a generated image in a temp directory and then unbound it, because leaving a
   node pointed at a temp file would render it broken.
