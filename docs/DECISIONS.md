# Decisions

Append-only. Newest at the bottom. One entry per real decision: what, alternatives rejected, why.

---

## 2026-09-09 — Electron over Tauri
**Decision:** Electron 33+ for the shell.
**Rejected:** Tauri v2 (smaller binary, Rust core), Neutralino, a pure web app.
**Why:** Native drag-out of a real `.jar` (`webContents.startDrag`), an embeddable persistent claude.ai webview, in-process PTY, and one language across the whole build. Binary size is not a constraint for a single-user desktop tool. Port path preserved by keeping all OS calls behind `services/`.

## 2026-09-09 — Board data is git-tracked JSON, one file per room
**Decision:** `board/**/room.board.json`, validated by `schema/board.schema.json`.
**Rejected:** SQLite board storage; a single monolithic JSON.
**Why:** Every layout change — mine or an agent's — becomes a reviewable diff, and `git checkout board/` is a universal undo. One file per room keeps diffs small and matches the folder-as-room mental model.

## 2026-09-09 — JARVIS is one identity with two bodies
**Decision:** A persistent claude.ai conversation (the Face) plus headless Claude Code runs (the Hands), sharing a markdown Codex.
**Rejected:** A single long chat with everything in context; a fully custom agent on the API.
**Why:** Chat context compacts and can't call local tools; headless can call tools but isn't a place to think. Externalizing memory into reviewable markdown makes both bodies cheap to prime and makes the whole thing survivable across model and product changes.

## 2026-09-09 — Kitbash from downloaded sheets, bake to a recolored atlas
**Decision:** Vendor packs live unedited in `assets/vendor/`. `assets/sprites/manifest.json` declares each sprite key as a cell reference, a kitbash composite, or an authored PNG. `npm run assets:bake` recolors everything to the locked palette and packs one atlas, which is the only art the app loads.
**Rejected:** Using vendor PNGs directly at runtime; committing hand-edited copies of vendor sheets; five per-room atlases.
**Why:** Recoloring at bake time is what makes art from multiple packs cohere, and it means the purity validator can stay strict without banning source material. Three reserved theme-key colors plus an exact-match swap shader let one atlas serve every room. Swapping a kitbash for hand-drawn art later is a one-line manifest change with no code impact.

## 2026-09-09 — Electron 44, not Electron 33, and `node:sqlite` instead of better-sqlite3
**Decision:** Pin Electron `^44.3.0`. Drop `better-sqlite3` in favour of Node's built-in `node:sqlite`.
**Rejected:** Electron 33 as written in `docs/01`; better-sqlite3 rebuilt against Electron's ABI with `@electron/rebuild`; `node-sqlite3-wasm`; shipping a Python + MSVC toolchain requirement.
**Why:** Electron 33 is end-of-life; only the latest three majors get security patches, so `^33` ships an unpatched Chromium on a machine that spawns shells. Separately, `npm install` on this machine **rolled the entire dependency tree back** because better-sqlite3, node-pty and keytar all invoke `node-gyp`, and node-gyp 9 fails on Python 3.12+ with `ModuleNotFoundError: No module named 'distutils'`. Electron 44 bundles Node 24.20 with SQLite 3.53.4 compiled in; I ran both a `DatabaseSync` round-trip and an `fts5` virtual-table query against the actual Electron binary and both work. That covers `skynet.db` *and* the Codex FTS5 index from `docs/04` with zero native modules. `node-pty` and `keytar` stay in `optionalDependencies` — nothing imports them before M3/M7 — so a failed native build no longer blocks the whole install.

## 2026-09-09 — Cancel the OS display scale instead of constraining the zoom
**Decision:** On window ready and on every `moved`, call `webContents.setZoomFactor(1 / display.scaleFactor)` so the renderer's `devicePixelRatio` is exactly 1.
**Rejected:** `docs/02` anti-mush rule 9 as originally written — "snap to the nearest workable integer" zoom.
**Why:** At Windows' 125% there is no workable integer near the documented zooms: `1.25 × N` is whole only for N ∈ {4, 8, 12}, which excludes zoom 2 and zoom 3 entirely. Constraining the zoom cannot solve the general case; cancelling the scale solves every case in one line. Confirmed on this machine, which runs at **200%**: the M0 smoke capture reports `devicePixelRatio = 1` and the rendered board contains exactly four unique colours — `#0E1A14`, `#16261D`, `#7A5423`, `#E9E4D6`, all exact palette entries — at zoom 2x, 3x and 4x. Any resampling anywhere in the stack would have produced intermediate values. `docs/02` rule 9 rewritten to match.

## 2026-09-09 — `pixi.js/unsafe-eval`, so the CSP stays strict
**Decision:** Import `pixi.js/unsafe-eval` before any renderer is created.
**Rejected:** Adding `'unsafe-eval'` to the renderer CSP.
**Why:** PixiJS v8 builds its uniform-upload and batch-shader code with `new Function()`. Under the `script-src 'self'` CSP that `docs/07` requires, that throws and the canvas never initialises — the first M0 run failed exactly this way. The subpath is named backwards: `pixi.js/unsafe-eval` is the build **for** environments that **forbid** unsafe-eval, swapping in precompiled non-eval implementations. Relaxing the CSP on an app that spawns shells, to save one import, is the wrong trade. Cost: ~76 KB of extra renderer bundle.

## 2026-09-09 — Kenney 1-Bit monochrome is the base silhouette grammar
**Decision:** `kenney_1-bit-pack/Tilesheet/monochrome-transparent.png` sets the grammar every other sprite conforms to. Grid verified as cell 16×16, margin 0, spacing 1×1, 49 × 22 cells.
**Rejected:** Kenney's coloured 1-bit sheet; the OpenGameArt sci-fi interior sheet; Kenney UI Pack: Sci-fi.
**Why:** The monochrome sheet contains exactly **two** colours — transparent and `rgb(249,250,251)` — so a layer-level `tint` forces any cell to a single palette token and is palette-clean *by construction*; it cannot fail the purity validator. Every alternative needs a remap table for no benefit once everything is recoloured anyway. The OGA sci-fi sheet is 30 colours with interior shading and 2px outlines, and three of its sheets have no alpha channel at all; mixing it in produces the ransom-note effect `docs/05` warns about. Kenney's UI pack is 740 loose glossy PNGs with semi-transparent edges — DOM chrome only, never the atlas.

## 2026-09-09 — Three components will be drawn by hand, not kitbashed
**Decision:** `component.hdd.*`, `component.ssd_room.*` and `component.cpu_jarvis.*` stay labelled placeholder rectangles until William draws them or commissions them.
**Rejected:** Kitbashing them from the packs on disk.
**Why:** I rendered every vendor sheet as a ruled contact sheet and looked at it. **There are no circuit-board components in any pack in `assets/vendor/`** — it is roguelike terrain, characters, weapons, furniture and dungeon tiles. Traces, vias, pads, packages and connectors can be built out of structural and interior cells. An HDD platter with an actuator arm, an M.2 shield can with an engraved room name, and a socketed CPU with a gold pad array cannot, and the kickoff brief is explicit that a labelled rectangle beats a bad kitbash.

## 2026-09-09 — The placeholder gets a 1px silk outline
**Decision:** The missing-sprite placeholder is a flat mask-light rectangle **plus** a 1px silk outline and a copper-dark bottom/right bevel. Three colours.
**Rejected:** The literal spec in `docs/05` — "a flat `@mask-light` rectangle".
**Why:** The substrate is mask-dark speckled with mask-light, so a flat mask-light rectangle on it has no readable edge. Silk is already the sanctioned colour for "component outlines" in `docs/02`, and three colours is well inside the six-colour budget. Verified on screen: the M0 capture shows every node's footprint and designator clearly against the substrate.

## 2026-09-09 — `additionalProperties: false` on the node schema
**Decision:** Close `$defs/node` in `schema/board.schema.json`, matching `$defs/edge`.
**Rejected:** Leaving it open.
**Why:** Open, a misspelled field (`cdw` for `cwd`) validates clean and the node silently fails to resolve at runtime — precisely the class of bug the schema exists to catch, on a project whose first prime directive is "bind to reality". All five seeded board files still pass, so nothing was relying on an undeclared field. `test/board-types.test.ts` asserts the schema stays closed and that `packages/shared/types.ts` declares the same kinds.

## 2026-09-09 — Two vendor files quarantined for an untraceable licence
**Decision:** `validate-assets.mjs` fails the build if `assets/sprites/manifest.json` references either `2015-02-24 (retro platformer)[tilesheet]1.png` or `...2.png`. The files are not deleted.
**Rejected:** Using them; deleting them.
**Why:** Their filenames are browser download timestamps, so the link back to the original work is gone, and neither matches any block in the pack's `LICENSE.TXT` — every other file in that folder does. The collection also contains 5 **OGA-BY** entries among its 168 works, and OGA-BY requires attribution. An untraceable file cannot be shown to fall outside those five. This is going on stream. Deleting from `assets/vendor/` is William's call on his own download, so they stay on disk and are simply unusable.
