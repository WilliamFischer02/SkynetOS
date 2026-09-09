# Handoff

**Updated:** 2026-09-09 — M0 done, M1 substantially done, M6's two interfaces pulled forward.

## State

The app builds, launches, renders `board/root.board.json` with traces and silkscreen, resolves
every node's target against the real filesystem, opens real folders in Explorer and VS Code, and
lets you edit any node through a form with a native file picker. Every edit is validated,
snapshotted and undoable. `npm run verify` is green: 164 tests.

Everything on the board is still a placeholder rectangle. That is intended — no atlas exists yet.

## Evidence, not claims

`npm run smoke` builds, launches the app, drives it with real key events, screenshots it, and
exercises the command bus over the real IPC bridge. Latest run:

```
devicePixelRatio = 1                            (on a machine at 200% OS scaling)
edit applied: ok=true changed=1 snapshot=yes
marker written to disk: true
undo: ok=true  marker gone: true
file byte-identical to before the edit: true
off-board move refused: true                    board unchanged by refusal: true
unapproved delete blocked: true needsApproval=true   board unchanged: true
```

Colour census of the rendered board area: **11 unique colours, every one an exact `skynet.gpl`
entry**, no intermediate values. All four room signals appear at once on the root board — that is
the relation colour working. Nothing shimmers; 165 FPS.

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

**Infrastructure**
- Board JSON has an enforced canonical form; `validate:board` fails if a file drifts, so an edit
  is a one-line diff instead of a whole-file reformat.
- `.gitattributes` now pins LF in the working tree.
- Settings at `%APPDATA%/SkynetOS/settings.json` — dev roots, elevation and stream-mode flags.
  Deliberately has **no** IPC writer: docs/07 says settings are user-only.

## Next

**Finish M1, then M2.** In order:

1. **Descend into a room.** `drive.room` click currently reports "M2". The board loader, the
   theme swap and the breadcrumb all already work per-board — this is mostly the iris transition
   and a navigation stack.
2. **The real trace router** (M2). The current one has no obstacle avoidance, and it shows: the
   `s1_repo_skynet → j1_github` run passes straight through U2 on the root board. Orthogonal A*
   on the 16px grid, avoiding node footprints, with bundling.
3. Seeded procedural substrate per room, and the palette swap shader.

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
