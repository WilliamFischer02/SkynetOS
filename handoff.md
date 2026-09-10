# Handoff

**Updated:** 2026-09-09 — M0 through M3 done. M6's editing pulled forward.

## State

The app builds, launches, and renders any board with auto-routed copper, silkscreen and a minimap.
Click a room drive and you descend into it through an iris wipe; Backspace brings you back. Every
node resolves its target against the real filesystem, opens real folders in Explorer and VS Code,
and can be edited through a form with a native file picker. Every edit is validated, snapshotted
and undoable. Drag pans; drag in Edit Board mode moves components. Any node can take an image,
which is re-drawn in the room's six colours. **Clicking an agent chip launches a real Claude Code
session in its repo, on that chip's own conversation.** `npm run verify` is green: **259 tests**.

Everything on the board is still a placeholder rectangle. That is intended — no atlas exists yet.

## Evidence, not claims

`npm run smoke` builds, launches the app, drives it with real key events, screenshots it, and
exercises the command bus over the real IPC bridge. Latest run:

```
devicePixelRatio = 1                            (on a machine at 200% OS scaling)
descend: "SKYNETOS" -> "SKYNETOS/MINECRAFTOS"   changed=true
room HUD: 27 NODES / 15 TRACES / ROUTED 15
ascend:  back to "SKYNETOS"                     returned=true
[router] 7 auto-routed, 0 fell back      root
[router] 15 auto-routed, 0 fell back     inside MinecraftOS
[router] 7 auto-routed, 0 fell back      re-routed BECAUSE a node moved
first launch:  resumed=false  conversation=51059e3a  flag=--session-id
second launch: resumed=true   conversation=51059e3a  flag=--resume
SAME CONVERSATION ACROSS LAUNCHES: true
  ...and on the NEXT cold start, the first launch already resumed 51059e3a from skynet.db
session:start on a non-agent node refused: agent.jarvis IS NOT A CLAUDE CODE AGENT
service:start on a non-service node refused: agent.code IS NOT A SERVICE
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

**M2 — rooms, routing, minimap (this session)**
- **Room descent and return.** Click or Space a `drive.room` and you descend; Backspace comes
  back; the breadcrumb shows the path. Navigation is a stack, not `board.parent`, because "back"
  means the way you came in.
- **8-step iris wipe**, drawn on its own DOM canvas so it survives the Pixi teardown that happens
  mid-transition. A captured mid-wipe frame is exactly one colour — hard-edged, no alpha ramp.
- **A\* auto-router** with a turn penalty, obstacle halo and deterministic tie-break. Every trace
  on all five boards routes with zero fallbacks, and none cuts through a component it does not
  terminate at. This fixes the visible M1 bug where `s1_repo_skynet -> j1_github` ran straight
  through U2.
- **The DOM chrome takes the room's colours**, so a room reads as somewhere you went rather than
  a popup over the mainboard.
- **Minimap**, bottom-right, live viewport box, click to jump. Reads the camera from a ref in its
  own rAF loop rather than through React state.
- Zone outlines now break around their own labels, which were being struck through.

**M3 — real sessions (this session)**
- **Clicking an agent chip opens Windows Terminal in its repo, resumed on its own conversation.**
  SkynetOS *assigns* the conversation id (`claude --session-id <uuid>`) instead of scraping it
  from stream-json, because a popout's stdout is not ours to read. Every later launch uses
  `--resume`. `docs/01` corrected.
- `skynet.db` via Node's built-in `node:sqlite` — sessions and a telemetry events table, WAL,
  hand-rolled migrations tracked in `user_version`. No native build step anywhere.
- Session dock, bottom-left: every live session across every room, with the room named when it
  is not this one. Kill from the dock. Services too.
- `service.process` start/stop, with a 200-line output tail. Owned rather than detached: killed
  with the whole tree on quit, because a dev server that outlives the app is a port you cannot
  rebind.
- Reap-then-restore at launch, plus a 5s sweep, so the dock never claims something is running
  when it is not — and never orphans an agent that really is.
- Elevated launch via `Start-Process -Verb RunAs` with a UAC prompt every time; SkynetOS itself
  stays non-elevated.

**Infrastructure**
- Board JSON has an enforced canonical form; `validate:board` fails if a file drifts, so an edit
  is a one-line diff instead of a whole-file reformat.
- `.gitattributes` now pins LF in the working tree.
- Settings at `%APPDATA%/SkynetOS/settings.json` — dev roots, elevation and stream-mode flags.
  Deliberately has **no** IPC writer: docs/07 says settings are user-only.

## Next

**One manual check, then M4.**

The check: **click the CC-SKYNET chip.** A Windows Terminal tab should open in `C:/dev/SkynetOS`
running `claude --session-id <uuid>`; close it, click again, and it should say RESUMED and reopen
the same conversation. I did not automate this, deliberately — spawning a real session would have
started a real conversation in a real repo and spent your usage on a test you did not ask for.
Everything either side of the spawn is verified; the spawn is three lines.

Then **M4 — files, artifacts, drag-out**:

1. `file.artifact` glob resolution is already written and tested; wire the cartridge to it.
2. `webContents.startDrag` so a `.jar` drags out of SkynetOS into the Minecraft launcher. Read
   the CLAUDE.md landmine first: on Windows `startDrag` kills in-app drop targets for the same
   gesture, so drag-out needs a different DOM handle from drag-to-move.
3. chokidar watchers for staleness — with the 5s polling fallback on non-local paths.
4. Drop-in ingestion: drag a file from Explorer into a room, get the right node kind pre-filled.

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
- **The router does not bundle parallel runs.** Several traces between the same two clusters
  route independently and can end up alongside each other without a ribbon clamp. Cosmetic;
  docs/01 wants bundling eventually.
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
- **`node-pty` still has no working build here** (node-gyp 9 + Python 3.12 = no `distutils`), so
  the `embedded` launch mode refuses with a legible message instead of silently opening a popout.
  M3's exit criterion never needed it. Solve it when the embedded terminal is actually built, and
  flip `npmRebuild` back on in `electron-builder.yml` at the same time.
- **A second click on a running chip does not raise its terminal window.** It reports the running
  session rather than spawning a second one — correct, because two Claude Code processes on the
  same conversation would fight over the same session file — but "focus it" in docs/03 currently
  means "tell you about it". Raising a detached `wt.exe` window needs a Win32 call.
- **`session:list` is authoritative only for sessions this app started.** A `claude` you launched
  yourself in a terminal is invisible to the dock, by design.

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
