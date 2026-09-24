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

## 2026-09-09 — Two room signals moved off the status colours
**Decision:** MinecraftOS signal `#57C25A` → `#A8E85C`; DeductionOS signal `#E0A22E` → `#FFD866`.
**Rejected:** Leaving them; changing `ok`/`warn` instead.
**Why:** They were byte-identical to `ok` and `warn`. In those two rooms a live-activity pixel and a status pixel were the same colour, so "this agent is working" and "this agent is healthy/warning" could not be told apart — a legibility bug in the palette rather than in any code. The status trio is global and appears in all five rooms, so the room signals were the ones to move. Both new values keep the room's hue identity (Minecraft lime, Deduction gold). `test/palette.test.ts` now enforces a minimum Manhattan RGB distance of 100 between every room signal and every status colour, so a future palette edit that reintroduces a collision fails `npm run verify` instead of shipping. William authorised the palette change.

## 2026-09-09 — Relation colour: connected rooms share colour through traces and zones
**Decision:** An `edge` or a `group.zone` may carry `relation: "<boardId>"`. Its inner strand (or zone outline) is drawn in that room's signal colour. A board may declare `relatedBoards: []`. Root's four JARVIS `supervises` wires now each carry their destination room's colour.
**Rejected:** A fourth per-room accent colour in the sprite palette; encoding relation in the sprite art; inventing project-to-project relationships I have no evidence for.
**Why:** William asked that connected rooms and subjects be able to share colours and connective wire elements to show relation. Putting it on traces and zone outlines rather than on component sprites is what makes it free: those are drawn as geometry from the palette, not as atlas frames, so the six-colours-per-frame cap is untouched and one atlas still serves every room. It degrades to the local signal colour when a relation names a room that no longer exists, so a stale relation is a dull wire rather than a crash. The only relation asserted in the seeded data beyond the JARVIS wires is MinecraftOS ↔ GameOS, which the board data itself justifies — both are code-agent + repo + build-artifact rooms. The rest are William's to declare.

## 2026-09-09 — The command bus and its undo history live in MAIN, not the renderer
**Decision:** `src/main/services/command-bus.ts` is the only code in the program that writes a board file. The inspector, a future drag in Edit Board mode, and a JARVIS `node_update` over MCP all build a `Command` and hand it there. The undo/redo stacks live beside it.
**Rejected:** A renderer-side undo stack; letting the inspector write JSON directly.
**Why:** CLAUDE.md prime directive 5 requires Ctrl+Z to undo user edits and agent edits identically. Agent edits arrive over MCP into main and would never touch a renderer-side stack, so a renderer-side stack makes the directive a lie. Centralising it also means validate-then-snapshot-then-write happens on exactly one path: a command whose result would not pass the schema is refused before anything is written, so a board file on disk is never in a state the app cannot load. `apply` returns the exact inverse computed at apply time, because the inverse of an update needs the pre-patch values and those are gone once written.

## 2026-09-09 — Board JSON has an enforced canonical form
**Decision:** 2-space indent, LF, trailing newline. Produced by `canonicalBoardJson()` and **enforced** by `npm run validate:board`. All five seeded board files normalised. `.gitattributes` changed from `* text=auto` to `* text=auto eol=lf`.
**Rejected:** Matching each file's existing hand-authored formatting; only producing canonical output without checking it.
**Why:** Caught by the smoke harness: an edit followed by an undo left the file semantically correct but not byte-identical, because the writer emits `JSON.stringify(…, 2)` while the seeded room files used compact one-line node objects. The consequence is that the first edit to any board reformats every line and buries the one that changed — which defeats "every layout change becomes a reviewable diff", the entire reason board data is git-tracked JSON. Enforcing it also caught that `* text=auto` hands Windows a CRLF working tree, which would have failed the new check on a fresh clone. Multi-line is additionally the better diff shape: a one-field change is now one line, where one-line-per-node rewrote a 400-character line.

## 2026-09-09 — Deletion approval is checked in the bus, not in the UI
**Decision:** `apply()` refuses any `node.delete` / `edge.delete` without `approved: true`, and only the renderer's native-modal path sets it. Verified in the smoke run: a `node.delete` submitted as `actor: 'jarvis'` is refused with `needsApproval: true` and the board file is unchanged.
**Rejected:** Confirming in the React component only.
**Why:** docs/07 says deleting a node, edge or room "always requires explicit approval in the UI. No auto policy can override this." A check that lives in a React component protects the one caller that goes through that component. Putting it at the only place that writes means it also holds for MCP, for a future drag-to-delete, and for anything else added later — including code written by an agent that has read the UI and not the rule.

## 2026-09-09 — Target verification never touches the network
**Decision:** `url` fields are validated for shape (`http`/`https`, parseable, has a host) and explicitly reported as "shape checked only — SkynetOS does not fetch the URL".
**Rejected:** A HEAD request to confirm the URL resolves.
**Why:** docs/01 says the renderer never touches the network, and doing it from main would fire a request at whatever is typed, mid-keystroke, on a machine that is going to be streamed — leaking the board's contents to third parties at edit time. A URL that 404s is also a fact about the internet at that moment rather than a fact about the board. Saying plainly what was and was not checked is better than a green tick that means less than it looks like.

## 2026-09-09 — All board geometry is drawn as axis-aligned filled rectangles
**Decision:** Traces, zone outlines, selection brackets and the broken-target stipple are built from filled `rect()` calls only. No strokes, no paths, no diagonals. The trace router emits orthogonal polylines and inserts elbows so a hand-placed waypoint cannot produce a diagonal segment.
**Rejected:** Stroked polylines; 45° elbows as docs/01 mentions for the router.
**Why:** A 1px stroke straddles the pixel boundary and lands as two half-lit rows even with MSAA off, and a rasterised diagonal cannot be pixel-exact at all — both are anti-mush violations of the same severity as a crash. Filled rects at integer coordinates are the only primitive that is hard-edged by construction. Verified: the rendered board contains exactly 11 colours, every one an exact `skynet.gpl` entry, with no intermediate values anywhere. 45° elbows return at M2 as pre-drawn atlas tiles, which is how docs/02 rule 7 says diagonals are allowed to exist.

## 2026-09-09 — Automatic builds run in GitHub Actions, not in a local git hook
**Decision:** `.github/workflows/build.yml` builds an NSIS installer on every push to `main`, uploads it as an artifact, and republishes a rolling `main-latest` prerelease. A local post-commit hook is available but opt-in (`npm run hooks:install`) and only does the 14-second unpacked build, in the background, never failing the commit.
**Rejected:** A blocking post-commit hook that builds the installer.
**Why:** Measured on this machine: NSIS is 36s warm, unpacked is 14s. A 36-second blocking hook turns every commit into a wait, and the predictable outcome is `--no-verify` becoming a habit — which is worse than having no hook. CI also builds from a clean checkout, which is the only thing that catches packaging bugs like the two found today. The hook exists for the machine you are sitting at; CI is the thing that actually produces the artifact for every commit.

## 2026-09-09 — better-sqlite3 and keytar deleted from package.json
**Decision:** Removed both. `node-pty` stays in `optionalDependencies` for M3, and `electron-builder.yml` sets `npmRebuild: false` plus a `!node_modules/node-pty/**` file negation.
**Rejected:** Keeping them as unused optional dependencies.
**Why:** They were not merely unused, they actively broke `electron-builder`: it runs `@electron/rebuild` over production dependencies, which invoked node-gyp on better-sqlite3 and failed the packaging step for a module nothing imports. `node:sqlite` in Electron 44 already replaces better-sqlite3 (verified, FTS5 included) and keytar is unmaintained, so M7 will pick a maintained credential library. node-pty was additionally shipping several megabytes of conpty binaries into the installer for a terminal that does not exist yet. M3 flips `npmRebuild` back and drops the negation when the embedded terminal actually lands.

## 2026-09-09 — CI passes the commit message through the environment, never inline
**Decision:** The release step reads `$COMMIT_MESSAGE` from `env:` and writes it to a notes file, rather than interpolating `${{ github.event.head_commit.message }}` into the shell script.
**Rejected:** Inlining it, which is the shorter and more obvious way to write it.
**Why:** A commit message is attacker-controlled text from a workflow's point of view, and `${{ }}` interpolation splices it into the script before bash ever sees it — a message containing a backtick or `$(…)` executes. This is not hypothetical here: the commit messages in this repo already contain backticks, quotes and `$`. GitHub's own hardening guidance says to pass untrusted values through the environment; costs three extra lines.

## 2026-09-09 — The DOM chrome gets its own integer scale
**Decision:** `--ui-scale` on `:root`, set from `Math.round(display.scaleFactor)` clamped to 1–3. Every chrome dimension is a whole multiple of `--p` (= `1px * --ui-scale`) and every font size a whole multiple of 11px.
**Rejected:** Leaving the chrome at 11px; CSS `zoom` on the chrome containers; giving up the forced `devicePixelRatio = 1`.
**Why:** Forcing `devicePixelRatio` to 1 is what makes the board pixel-exact at any OS scaling, and its unavoidable consequence is that one CSS pixel is one *device* pixel — so on William's 200% display the whole UI rendered at half its intended physical size. "The UI scale is far too small" was the direct, predictable result of the M0 DPI fix, and the fix is a second, independent integer scale for the chrome rather than compromising the board. CSS `zoom` was tempting and much less code, but it scales an absolutely-positioned element's `height: 100%` against the *unzoomed* parent and the inspector overflows; explicit variables are predictable. Integer only, and multiples of 11 only, so a 1px border stays a whole device pixel and Departure Mono stays on an exact size.

## 2026-09-09 — `-webkit-font-smoothing` does not work on Windows; use the Chromium switches
**Decision:** `app.commandLine.appendSwitch('disable-lcd-text')` and `('disable-font-subpixel-positioning')` in main, before any window exists.
**Rejected:** `-webkit-font-smoothing: none` alone, which is what `docs/02` rule 8 literally prescribes.
**Why:** It is a no-op on Windows — Chromium renders text through DirectWrite and ignores the CSS property. This was not a guess: a colour census of a screenshot found `rgb(224,132,27)` and `rgb(148,196,214)` in the HUD, which are not blends of any two palette colours but red/green LCD subpixel fringes on glyph edges. The switches removed them: measured **zero colour fringes** in the HUD, the inspector and the board afterwards. Glyph edges in the chrome still carry greyscale antialias blends between two palette colours — the browser's text stack owns that and replacing it would mean rendering all chrome text to canvas. So the purity guarantee is now stated as scoped to the canvas, where it is verified, and `docs/02` rule 8 says so.

## 2026-09-09 — Node face images are re-drawn in the board's material, not pasted
**Decision:** A node's `image` is downsampled to its exact footprint, reduced to a luminance ramp, and ordered-dithered onto the room's six palette colours. Decoding is Electron's `nativeImage`; the mosaic is cached in `%APPDATA%/SkynetOS/thumbs/` keyed by path, mtime, size, footprint and theme. The board stores only the path.
**Rejected:** Drawing the source image directly; quantising to the full palette; copying images into the repo; storing the mosaic in the board JSON.
**Why:** A photograph is thousands of colours and soft edges; this board is six colours and hard pixels, and pasting one in is exactly the mush `docs/02` exists to prevent. Re-drawing it in the room's own ramp makes it read as a screen-printed component marking, and it satisfies every anti-mush rule *by construction* — six exact palette colours, binary alpha, integer dimensions, dither instead of blur. Verified with two faces on screen: the rendered board contained 7 unique colours, all exact `skynet.gpl` entries. Quantising to the full palette would have blown the six-colour-per-frame budget. Storing only the path keeps board files small and diffable and means a moved image renders the node broken like any other unresolved target, per prime directive 1. `nativeImage` handles PNG/JPEG/GIF/BMP/ICO/WebP with no new dependency and no image library to keep alive for a decade.

## 2026-09-09 — The board prints `U1 JARVIS`, and wraps to keep the name
**Decision:** Labels print designator and name together, greedily wrapped over the two of them, breaking on whitespace, after hyphens, and at camelCase boundaries.
**Rejected:** Designator only; a dedicated designator line; truncating long names with an ellipsis.
**Why:** William asked for the name on the board. Getting it there on small footprints is the whole problem: `TruthQuestRetro` is 15 characters against a 4-tile drive's 9-character usable width. Breaking at camelCase and hyphens is how a real board prints a long part number on a small package, and it is how these names read anyway. Wrapping the designator *into* the token stream rather than reserving a line for it is what makes tight footprints work — `S1 TRUTH / QUEST / RETRO` fits in three lines where a dedicated designator line needed four and dropped the name entirely. Truncation was rejected because a half-printed name is worse than an honest designator. `test/labels.test.ts` asserts that every mounted node in the seeded boards keeps its designator and that every node 4×3 or larger keeps every token of its name; the only shapes that lose a label are the 2×1 crystal oscillators, which a real board could not print either.

## 2026-09-09 — Opening a node's form no longer switches on Edit Board mode
**Decision:** `E` toggles Edit Board mode; `F2` opens the selected node's field form. `beginEdit` does not touch `mode`.
**Rejected:** Keeping one `mode` flag for both.
**Why:** `beginEdit` used to set `mode: 'edit'`, so opening a form to *read* a node's fields silently made every component on the board draggable — a click that drifted a few pixels could then relocate something. Two different meanings of "edit" sharing one flag. Found while writing the drag test, which pressed `E` expecting to enter Edit Board mode and instead left it, because `F2` had already entered it.

## 2026-09-09 — Panning is impossible when the board fits on screen, and the HUD says so
**Decision:** `clampCamera` keeps centring a board smaller than the viewport, and the HUD shows `WHOLE BOARD VISIBLE — NOTHING TO PAN` when it is.
**Rejected:** Allowing overscroll so a drag always appears to do something.
**Why:** The root board is 64×40 tiles = 1024×640 world px, so at zoom 2 in a 2534px-wide window it is smaller than the viewport and centring it is correct — there is nothing to pan to. But a gesture that correctly does nothing is indistinguishable from a broken one, and this is very likely what "click and drag still doesn't work" was: the first drag test I wrote ran at 2x, reported 0.00% of pixels changed, and looked like proof of a bug. Retested at 4x: 25.94% of the board area changed. Saying it in the HUD costs one line and removes the ambiguity permanently.

## 2026-09-09 — The auto-router is A* with a turn penalty, not a shortest path
**Decision:** `src/renderer/board/router.ts` — A* on the 8px half-grid, node footprints as obstacles, state is (cell, incoming direction) so a direction change can be charged `TURN_COST = 3`, plus a `HUG_COST = 2` halo around obstacles.
**Rejected:** Plain shortest-path A*; keeping the M1 two-bend Z; a full commercial-style autorouter with rip-up and retry.
**Why:** On a 4-connected grid a staircase and an L are the *same length*, so a plain shortest-path A* picks between them arbitrarily and usually returns a staircase. Copper does not staircase. Charging for a direction change makes a long straight run strictly cheaper, and it is the single change that makes the output look like a circuit board rather than a maze solution. The halo keeps runs off component edges without forbidding a squeeze through a one-cell gap when that is the only way past. State has to include the incoming direction because plain cell-based A* cannot express "arriving here going east costs less than arriving going north". Deterministic tie-breaking matters because a board that routes differently on every launch makes the planned M5 golden-image diff worthless. Measured: 29 tests across all five seeded boards in 74ms; every trace on every board routes with zero fallbacks, and none cuts through a component it does not terminate at.

## 2026-09-09 — The room stack is a stack, not `board.parent`
**Decision:** Descending pushes onto `stack: Crumb[]`; Backspace pops. `board.parent` is not consulted for navigation.
**Rejected:** Following the `parent` field.
**Why:** "Back" means the way you came in, not the room's declared owner. Rooms nest arbitrarily and one could be reachable from more than one place — a shared drive appearing in two rooms is an obvious future want — and at that point `parent` is a lie about how you got there. The stack is also what the breadcrumb renders, so navigation and the breadcrumb have one source of truth instead of two that can disagree.

## 2026-09-09 — The iris is a DOM canvas, not part of the Pixi scene
**Decision:** `src/renderer/ui/Iris.tsx` draws the 8-step wipe on its own 2D canvas overlaying the board.
**Rejected:** A Pixi overlay on the stage; a CSS transition.
**Why:** The board's Pixi application is destroyed and rebuilt when the board changes — which is exactly the moment the iris has to be covering the screen. An overlay tied to that lifecycle blinks out on the worst possible frame. A CSS transition was never an option: it is a smooth alpha ramp across every pixel on screen, the precise opposite of a hard-edged pixel iris. The canvas draws eight discrete steps of flat filled rectangles, so at any instant the screen is either mask-dark or it is not. Verified: a captured mid-transition frame contains exactly **one** colour across the sampled region, `mc-mask-dark`.

## 2026-09-09 — The DOM chrome takes the room's colours
**Decision:** On every board change, `--mask-dark`, `--mask-light` and `--signal` are written to `:root` from `board.theme`.
**Rejected:** Keeping the chrome on the root SKYNET palette in every room.
**Why:** The point of a room theme is that the place looks different when you are in it. Descending into MinecraftOS and finding the inspector and the HUD still wearing SKYNET green makes the room read as a popup over the mainboard rather than somewhere you went. The board and the chrome now change together. Verified: the MinecraftOS board area renders 6 colours, all exact `skynet.gpl` entries, in the room's own mask tones and lime signal.

## 2026-09-09 — Zone outlines break around their own labels
**Decision:** `buildZone` measures the label and omits any bracket or dash segment that would overlap it.
**Rejected:** Moving the label inside the box; drawing the label on top of the line.
**Why:** The label sits *on* the top edge, so without a gap the zone's own dashed run draws straight through the text and every cluster title reads as struck through — plainly visible on `THE STALKER` and `THERE COULD BE GIANTS` in MinecraftOS. Real silkscreen leaves a clearance around printed text for exactly this reason. Moving the label inside the box would have cost a tile of usable space in every zone on every board.

## 2026-09-09 — SkynetOS assigns the Claude conversation id; it does not capture it
**Decision:** First launch generates a UUID and passes `claude --session-id <uuid>`, writing it to `sessions` *before* spawning. Every later launch passes `claude --resume <uuid>`.
**Rejected:** `docs/01`'s original plan — capture the id from the stream-json `system/init` event.
**Why:** Capturing only works for `headless`. A `popout` session runs in a terminal SkynetOS does not own and whose stdout it never sees, so there would be nothing to capture — and `popout` is the marquee launch mode, the one M3's exit criterion is written about. Checking `claude --help` on this machine (v2.1.267) showed `--session-id <uuid>` exists and takes a caller-supplied UUID, which inverts the problem: assign the id instead of discovering it. One mechanism for all three modes, no dependency on parsing another program's output, and writing it before the spawn means a crash mid-launch still leaves the conversation recoverable. `docs/01` corrected in the same commit. Proved across a real process restart: a second run of the app read the id back out of `skynet.db` and resumed.

## 2026-09-09 — `node:sqlite`, and migrations are a hand-rolled array
**Decision:** `src/main/services/db.ts` opens `%APPDATA%/SkynetOS/skynet.db` with Node's built-in `node:sqlite`, WAL journal, and an ordered array of migration functions tracked in `PRAGMA user_version`.
**Rejected:** better-sqlite3 (already removed); a migration library; an ORM.
**Why:** Electron 44 bundles Node 24 with SQLite 3.53 and FTS5 compiled in, so this is a built-in with a synchronous API and no native build step — which is exactly what killed better-sqlite3 here. Four tables on a single-user desktop app do not justify a migration framework, and CLAUDE.md's "this has to still run in a year" argues against a dependency that has to survive a decade to save twenty lines. The rule is: never edit a shipped migration, append a new one.

## 2026-09-09 — Reap before restore, and sweep on a timer
**Decision:** At launch, `reapDeadSessions()` closes rows whose PID is gone, then `restoreSessions()` re-adopts the ones that genuinely survived. A 5-second timer reconciles the tracked set against the OS thereafter.
**Rejected:** Trusting the `exit` event alone; clearing all session rows at startup.
**Why:** A crash, a reboot, or a Task Manager kill all leave rows claiming to be live, and **a session dock that lies about what is running is worse than no dock** — the whole reason docs/03 §7 wants one is to stop sessions being orphaned. Clearing everything at startup would be the opposite error: closing and reopening SkynetOS would orphan an agent that is still working. A detached popout can also be closed in ways that never reach our `exit` handler, which is why the timer exists as well as the events.

## 2026-09-09 — Services are owned; agent sessions are detached
**Decision:** An `agent.code` popout is spawned detached and outlives the app. A `service.process` is not: SkynetOS keeps its stdout, and `will-quit` kills the whole tree with `taskkill /T`.
**Rejected:** Treating both the same.
**Why:** They fail in opposite directions. An agent session is a conversation you are having — closing the launcher must not kill it, and the terminal belongs to you, not to us. A dev server is infrastructure: one that outlives the app that started it is a bound port you cannot rebind and a process you cannot find, and you will discover it by wondering why the next start fails. `/T` because a dev server spawns children (node, esbuild, a watcher) and killing only the parent leaves the port held.

## 2026-09-09 — Every command-line argument goes through `psQuote`
**Decision:** One helper, PowerShell single-quoting with `''` as the escape, applied to every value that reaches a command line — including twice for the elevated path, which nests a `-Command` string inside an `-ArgumentList`.
**Rejected:** String interpolation with manual escaping at each call site.
**Why:** Board JSON is git-tracked and reviewed, but it is still data, and a repo path containing an apostrophe or a `$(...)` must be a path, not shell syntax. The elevated path is the dangerous one: two shell layers means a quote has to survive being doubled twice (`'` → `''` → `''''`), which is a command-injection bug that only appears on a path with an apostrophe in it. `test/sessions.test.ts` pins the nesting explicitly.

## 2026-09-09 — Launch-argument construction is a separate, dependency-free module
**Decision:** `src/main/services/launch-args.ts` holds `claudeArgs`, `popoutCommand`, `elevatedCommand`, `psQuote` and `resumeCommandLine`, importing nothing but `node:crypto` and the shared types.
**Rejected:** Leaving them in `session-manager.ts` and configuring Vitest to stub `electron` and `node:sqlite`.
**Why:** The trigger was that Vitest could not resolve `node:sqlite` through the import chain, but the split is right on its own terms: how a session is *spelled* is pure policy and is the most consequential logic in M3, while spawning, dialogs and database rows are side effects. Fixing the test config would have made the untestable arrangement permanent. Separating them makes the policy independently readable and gives it 24 tests it could not otherwise have had.

## 2026-09-09 — Spawning `claude` is deliberately not automated in the smoke run
**Decision:** The smoke harness proves the resume decision against the real database and exercises every IPC guard, but never spawns a real Claude Code session.
**Rejected:** Launching one and killing it.
**Why:** It would open a terminal and start a real conversation in a real repo, consuming William's usage, for a test he did not ask for. What can honestly be automated is the part that actually decides resume-versus-fresh, and that is: the id is written, read back through the database that survives a restart, and turned into `--resume`. The argv, quoting, working directory and Windows-Terminal fallback are unit-tested exactly; the spawn itself is three lines. Clicking the chip once is the remaining verification and it is William's to make — and the roadmap says so rather than implying M3 is fully machine-verified.

## 2026-09-09 — Drag-out is a DOM badge; the node body stays canvas
**Decision:** Every draggable file node gets a small DOM badge overlaid on the canvas at its bottom edge, and that badge is the only drag-out handle. `webContents.startDrag` fires from its `dragstart`.
**Rejected:** Starting the drag from the Pixi canvas; one handle for both gestures.
**Why:** CLAUDE.md's landmine, and it is real: once `startDrag` is called Windows owns the gesture and the app stops receiving mouse events for it, so an in-app drag can never become a drag-out or vice versa. The decision has to be made at `dragstart`, before any of that, purely from which element was grabbed — which means two *elements*, not one element with a mode flag. The badge is sized by its content rather than by the node footprint: the first version clamped it to the cartridge's 3 tiles and clipped `thestalker-0.1.0.jar` down to `TH`.

## 2026-09-09 — Staleness is measured against the producing repo's last commit
**Decision:** `stale` follows the incoming `produces` edge to its source node, resolves that to a working tree, asks `git log -1 --format=%cI`, and compares to the artifact's mtime. No producer or no repo ⇒ `unknown`, never guessed.
**Rejected:** An age threshold ("older than a day is stale"); comparing against the repo's file mtimes.
**Why:** docs/03 says a STALE badge means "the producing agent has committed since the artifact was built", which is a checkable claim rather than a guess about time — and the board already knows who produces what, because a `produces` edge says so. An age heuristic would call a correct, finished build stale simply for being old. Verified against the real repos: `thestalker-0.1.0.jar` reads `stale`, and `a4_jar_time` reads `unknown` because TimeServed does not exist on disk — reported as unknown rather than assumed fresh.

## 2026-09-09 — Watchers poll unless the path is provably a local fixed disk
**Decision:** `usePolling()` returns true for UNC paths, cloud-sync roots (by name and by the OneDrive env vars), and anything without a local drive letter. If any watched directory needs polling, the whole chokidar instance polls at 5s.
**Rejected:** Native notifications everywhere; per-directory watcher instances.
**Why:** CLAUDE.md names this landmine, and the failure mode is the worst kind — silent. A cloud-sync folder that materialises files on demand can deliver change events late, coalesced, or not at all, and the board would simply stop noticing rebuilds while continuing to look correct. Erring toward polling costs a few stat calls every five seconds. Chokidar takes one polling setting per instance, and a room with twenty file nodes in the same repo should not open twenty watchers on overlapping trees, so one instance that polls when any member needs it is the right trade.

## 2026-09-09 — A dropped build output becomes a glob, not a pinned filename
**Decision:** `classify()` turns a `.jar` in a recognised build directory into a `file.artifact` with `glob`, `exclude` and a `versionPattern`, and says why in the wizard.
**Rejected:** Creating a `file.exe`/`file.document` pinned to the exact dropped path.
**Why:** The next build produces a different filename and a pinned node would immediately render broken — which is the entire reason `file.artifact` exists as a kind. Ingestion is also only ever a *suggestion*: docs/03 §2 says you cannot place a broken node by accident, so the wizard shows the kind, the fields and the reason, and accepting goes through the same command bus with the same validation and the same undo as any other edit.

## 2026-09-10 — The inspector hides when nothing is selected
**Decision:** `Inspector` returns null with no selection, and the chrome that dodges it (HUD, minimap, toasts) reclaims the space via a `--dodge` variable driven by an `inspector-open` class.
**Rejected:** Keeping an empty "NOTHING SELECTED" card.
**Why:** It covered the right third of the board permanently in order to say nothing, and it was worst exactly when it hurt most — panning right, where the part of the map you are heading toward is the part hidden. The help bar already says how to select something.

## 2026-09-10 — Per-kind component silhouettes, drawn rather than kitbashed
**Decision:** `src/renderer/board/component-art.ts` draws a distinct package per node kind — DIP, QFP, CPU, drive, M.2 module, EPROM, switch, cartridge, jack, regulator, crystal, PSU — from the locked palette.
**Rejected:** Kitbashing them from the vendor sheets; leaving every node an identical rectangle.
**Why:** A board of identical boxes has to be read one node at a time; a real board is legible at a glance because the packages differ. The vendor packs cannot supply these — `assets/vendor/` is a roguelike pack with no circuit components in it at all, which is recorded in that pack's SOURCE.md, and docs/05 is explicit that a labelled rectangle beats a bad kitbash. What the project does have is the component vocabulary in docs/02, and drawing it straight from the palette is both honest and exact.

## 2026-09-10 — Copper is an edge colour, not a surface colour
**Decision:** Package bodies are mask-light; copper appears only as outlines, pads, legs and connector fingers. `outline()` is the workhorse, not a filled rect.
**Rejected:** The first version of the silhouettes, which used copper-dark fills for shield cans, label plates and gauges.
**Why:** It shipped to a screenshot and looked wrong immediately: every component came out a brown slab and the board read worse than the plain rectangles it replaced. An M.2 shield can filled at `inset 3` covers essentially the whole module. docs/02 already says what copper is for — "traces, pads, pin legs, connector fingers" — and every one of those is an edge or a small detail. Re-verified after the fix: 9 colours on screen, all exact `skynet.gpl` entries, zero blends, zero fringes.

## 2026-09-10 — Long names go on a nameplate above the package, never wrapped
**Decision:** The node's drawn box extends upward into a single-line nameplate sized to the full name. The designator stays on the package. The FOOTPRINT is unchanged.
**Rejected:** Wrapping the name across lines (what M1 did); widening the footprint to fit the name.
**Why:** `THERE COULD BE GIANTS` on a 4-tile drive wrapped to three lines of 6px type and stopped being readable, which was the actual complaint. Widening the footprint was the obvious alternative and is the wrong one: that name needs eight tiles against a four-tile part, so auto-widening would collide with neighbours, fail the validator's overlap rule, and reshuffle a hand-laid board. Extending the texture instead leaves collision, A* routing and hit-testing all working on the grid the board data describes — and a silkscreen label longer than the part it names is exactly what a real board does. `test/component-art.test.ts` pins that the plate is one line high, is the same height for every name, and never pushes a node off the top edge.

## 2026-09-10 — Per-node display toggles

**Decision.** `showDesignator`, `showName` and `showThumbnail` are three independent optional
booleans on `BoardNode`, all defaulting to ON, resolved through `displayOf()`.

**Alternative rejected:** one `display` enum (`"thumbnail" | "designator" | "title" | "all"`).
It cannot express "thumbnail plus title, no designator", which is exactly the combination asked
for. Three booleans are eight states; an enum would have needed all eight names.

**Why absent means ON:** every board file written before today has none of these keys, and must
keep printing exactly what it printed yesterday. `node.showName !== false` rather than
`node.showName === true` is what makes that true.

## 2026-09-10 — Windows Terminal eats semicolons, so prompts never touch a command line

**Symptom.** Clicking Launch session on U3 JARVIS-HANDS flickered the UI and opened nothing.

**Cause.** `wt.exe` splits its own command line on `;` to open a second tab. U3's initial prompt
contains "...cannot see this disk; you are how its decisions become real." wt took the remainder
as a second subcommand, failed to parse it, and exited 0. `spawn` had succeeded, so SkynetOS
reported LAUNCHED — a silent failure of exactly the kind `launch-args.ts` was written to avoid,
in the one place it was not being tested.

**Decision, two parts.**
1. `wtEscape()` backslash-escapes `;` in everything handed to wt, the working directory included.
   Verified on this machine: a `Set-Content` with a raw `;` never ran; the same command with `\;`
   wrote its file.
2. More importantly, an `initialPrompt` is no longer put on a command line at all. `claudeArgs`
   returns it separately, `session-manager` writes it to `userData/prompts/<board>.<node>.txt`,
   and the launch reads it back with `Get-Content -Raw`. Prose from the node editor now passes
   through zero shell parsers instead of three.

**Alternative rejected:** escaping harder. Semicolons were the character that bit first; quotes,
ampersands and newlines were all still waiting. A file removes the class of bug, not one member.

**Verified end-to-end** by bundling the shipped `launch-args.ts` with esbuild, staging the real
U3 prompt, and swapping `claude` for a script that records its argv: three arguments arrive,
the third being the full 560-character prompt with its semicolon intact.

## 2026-09-10 — "New session (fresh context)" now means it

`startSession`'s `force` flag only skipped the already-running guard; it still passed the stored
conversation id to `--resume`, so the button labelled "fresh context" reopened the same
conversation with the same history. Renamed to `fresh`, which ignores the stored id, mints a new
one, and re-sends the initial prompt. The idle chip gained a separate primary button that says
"Resume conversation" — the two behaviours are now two buttons with honest labels.

## 2026-09-10 — The JARVIS conversation gets its own window

**Decision.** `agent.jarvis` and `agent.chat` open a dedicated Electron `BrowserWindow` with the
node's own `partition`, its own title, and its own taskbar entry. `link.url` still goes to the
system browser, which is what a bookmark is for.

**Why.** `shell.openExternal` appended a tab to Firefox among thirty others. The agent read as a
link SkynetOS happened to know about rather than something living on the board.

**Security.** Unchanged from docs/07: no preload, no bridge, `sandbox: true`,
`contextIsolation: true`, `webSecurity: true`. `page-title-updated` is cancelled so the window
keeps the node's name instead of renaming itself to "Claude". Popups are allowed only as more
windows of exactly this kind (same partition, https only), because denying them would make OAuth
sign-in impossible; `will-navigate` refuses any scheme that is not http(s).

## 2026-09-10 — Why no chip had ever launched, and the four bugs behind it

William: "the buttons that should open powershell iterations or even console iterations still
isn't producing actual command like windows". Investigation found four separate defects stacked
on top of each other. Every one of them was silent, and each masked the next.

**1. `existsSync` cannot see an App Execution Alias.** SkynetOS decided Windows Terminal was
installed with `existsSync('%LOCALAPPDATA%/Microsoft/WindowsApps/wt.exe')`. That is `false` on
every Windows 11 machine: the entries under `WindowsApps` are zero-length reparse points that
`CreateProcess` resolves and `stat` cannot (it throws EACCES). `hasWindowsTerminal()` was
therefore permanently false, and the shell resolver fell through to `powershell.exe` 5.1 for the
same reason.

**2. A console app spawned from Electron main has nowhere to appear.** Electron's main process is
a GUI-subsystem process and owns no console. With wt out of the picture by bug 1, the launcher
spawned `powershell.exe` directly, detached — the process ran, wrote to nothing, and no window
ever appeared. Verified: a detached `pwsh.exe -File <script>` never reported in; the identical
script under `wt` did, in 500ms.

**3. `spawn` succeeding was mistaken for a launch.** `wt.exe` is a stub that hands off and exits
0 in ~200ms whether or not it parsed its arguments. All fifteen sessions in `skynet.db` "started"
and "exited" within a second, and each was reported to the UI as a success.

**4. Phantom conversation ids poisoned every chip permanently.** The conversation id was recorded
before the spawn, correctly, so a crash could not orphan a conversation. But an assigned id is a
plan, not a fact. The first launch of each chip failed (bug 1+2), leaving an id naming a
conversation that was never created; every click after that ran `claude --resume <phantom>`, got
`No conversation found with session ID`, and exited 1. **Every one of the four conversation ids in
this machine's database was a phantom. `claude` had never once started from the board.**

**Decisions taken.**

- **`services/which.ts`** resolves executables by listing PATH directories, which reads aliases
  correctly, instead of stat-ing a guessed path. Nothing in the app may use `existsSync` to test
  for an executable again.
- **`services/launch-script.ts`** stages the entire launch as a `.ps1` under userData. The command
  line now contains nothing but file paths. This retires the escaping arms race: `spawn -> wt ->
  pwsh -> claude argv` was four parsers, and it is now one, with every value single-quoted.
  A test asserts the command line contains only paths and known flags.
- **The staged script writes its own `$PID` first and deletes it in a `finally`.** A launch is
  confirmed by that file appearing, not by `spawn` returning. No file, no launch — and the caller
  gets the script's path to run by hand. Sessions gained a `starting` state for the window in
  between, which is where an elevated launch sits during the UAC prompt.
- **`services/conversations.ts`** checks `~/.claude/projects/<mangled-cwd>/<id>.jsonl` before
  passing an id to `--resume`, and `claudeSessionIdsForNode` walks the node's history until it
  finds one that exists. A failed launch can no longer poison a chip, and a chip with real history
  under a phantom recovers it. The user is told when a conversation was lost rather than being
  quietly given a new one.
- **The no-wt fallback goes through `cmd /c start`**, which is what asks the shell to create a new
  console for a program. Bug 2 has no other fix.

**Alternative rejected:** keeping the child-process handle and treating its `exit` as the
session's exit. It never was the session — it is a launcher — and two sessions' worth of
debugging came from that assumption.

## 2026-09-10 — Priming is a named allowlist, never a shell string

**Decision.** A node stores `prelaunch: ["claude", "git-fetch"]` — ids from
`packages/shared/prime-steps.ts`. The shell text lives in that registry, in code. An id the
registry does not know is dropped, not run.

**Why.** docs/07: "Board JSON is data. It never contains executable code." Board files are what
an agent is allowed to edit. If priming were a free shell string, "edit a node" and "run arbitrary
code as William" would be the same permission.

Steps are also marker-checked in the generated script: `npm-install` in a repo with no
package.json prints "skipped, no package.json here" instead of a stack trace. Defaults are the
three that cannot rewrite a lockfile (`claude`, `git-fetch`, `git-status`); anything that mutates
a repo is opt-in and is badged "writes" in the editor.

## 2026-09-10 — The session briefing is assembled, not typed

**Decision.** `briefing: 'none' | 'first' | 'every'` (default `first`). SkynetOS composes the
first message from what the node already declares — `readOnLaunch` (defaulting to CLAUDE.md + the
persona brief + the codex ref), the granted `addDirs`, and `initialPrompt` as the character notes.
It ends by requiring a READY / CONTEXT / NEXT block and telling the agent to stop and wait.

**Why.** William asked for sessions that arrive knowing their documentation and personality and
are "then ready for me". Deriving the briefing from the node's own bindings means priming a new
chip is an act of binding it to real files, not of writing the same prompt twice. Documents are
existence-checked in main, so a briefing states what is missing rather than sending an agent after
a file that is not there.

`every` re-orients on resume instead of re-introducing: the resumed text says "you have context
from before" and asks only for a re-read of what was lost.

## 2026-09-10 — `addDirs`, so repos stay where they are

**Decision.** `addDirs: string[]` on an agent node becomes one `claude --add-dir` per entry.
Directories outside the dev roots are confirmed on every launch, exactly like a working directory
outside them. A granted directory that is not on disk is dropped from the invocation (one bad path
makes Claude Code reject the whole thing) and named in the briefing as missing.

**Why.** William: "other repos I want Jarvis to oversee are in other root folders but must still
be accessible to Jarvis WITHOUT me needing to relocate all of my repos on my drive."

## 2026-09-10 — Any node with a directory can open a terminal

**Decision.** New `terminal:open` IPC channel and two inspector buttons, "Open terminal" and
"Admin terminal". `openWith: 'terminal'` is implemented rather than answering "arrives at M3".
Both run the same staged script an agent launch does, so a repo that primes with `git-fetch`
primes here too. Elevation is confirmed in main with the blast radius spelled out.

**Why.** Nothing on the board could put you in a shell except an agent chip, and that was
William's first request.

## 2026-09-10 — The camera stopped being destroyed on every edit

**Symptom, from William:** "re-arranging the board snaps back to the default camera position each
time a node is moved."

**Cause.** `BoardCanvas`'s init effect was keyed on `[props.board, props.boardId]`. The store
re-reads the board file after every mutation, so `props.board` is a NEW OBJECT after every edit —
and the effect therefore destroyed the entire Pixi application and built a new one. Camera to 0,0,
zoom to 3, every mosaic refetched, the A* router re-run, for a one-tile move.

**Decision.** The application is created once per ROOM (`[props.boardId]`). A second effect calls
`rebuild(board)` when the board data changes, which clears and repopulates the trace, zone, node,
note, grid and overlay layers in place. The camera lives in a ref outside both effects and resets
only when you actually go somewhere else. The substrate is deliberately NOT rebuilt: it is a pure
function of the grid and the theme seed, and it is the most expensive layer here.

Image mosaics are cached by `source@WxH`, so a rebuild refetches only what actually changed.

## 2026-09-10 — A node moves while you drag it

The ghost outline alone left the component sitting at its old address while a rectangle floated
around, which reads as a preview rather than a move. The sprite now follows the snapped tile
position during the gesture, so it steps whole tiles to where you are putting it. Board data is
untouched until the drop — this is presentation, and the commit is still the command bus with its
undo entry. An illegal or abandoned drop puts the sprite back where the data says it is.

## 2026-09-10 — A drag that ended off-canvas killed keyboard panning

Found by the smoke run while proving the camera fix: WASD reached the handler and the camera did
not move.

`pointermove` and `pointerup` were bound to the CANVAS. A gesture released outside it never
delivered its `pointerup`, so `drag.kind` stayed `'pan'` forever — and the ticker suppresses
keyboard panning while a drag is live. One drag that happened to end off the canvas silently
disabled WASD for the rest of the session, with nothing on screen to say why.

Both listeners moved to `window`, plus a `blur` handler that drops held keys and any live drag:
alt-tabbing away mid-pan delivered the `keyup` to the other window, so the board kept panning by
itself on return. Same for a drag interrupted by a UAC prompt, which this app raises on purpose.

## 2026-09-10 — Two images per node, and a bevel on everything

**Decision.** `image` is the WALLPAPER (stretched to the whole footprint, `fit: 'fill'`) and `logo`
is the BADGE (centred, aspect preserved, `fit: 'contain'`, sized by `logoBoxTiles()` at ~60% of the
shorter side and always a whole number of tiles).

**Why two.** They answer different questions. The wallpaper says what a thing feels like and wants
the whole area; the logo says what it IS and must stay recognisable, which stretching to a 6x4
rectangle destroys. The logo's letterbox padding stays transparent so the wallpaper shows through.

**The bevel.** A dithered photograph on a substrate made of the same six colours has no edge — the
picture bleeds into the board and the component stops reading as an object mounted on it. A 1px
silk outline, which is what this was, reads as a sticker. `drawBevel()` is an outer copper-dark
ring plus an inner ring that is silk on the top and left and copper-dark on the bottom and right.
Two palette colours, whole pixels, no gradient and no alpha. Every component and every badge wears
one.

## 2026-09-10 — Nodes are scalable, and the cap is per kind

Three paths, because CLAUDE.md's definition of done requires a keyboard route: a corner handle on
the selected node in Edit Board mode, Shift+arrows, and a W x H field in the editor. All three go
through `node.update` on the command bus, so scaling snapshots and undoes like any other edit.

The cap is `maxFootprintFor(kind)`: 48 tiles for a component, 512 for a `group.zone`. A single cap
does not work — MinecraftOS already has zones 26 tiles wide, because a zone is a bracket drawn
around a cluster and is meant to span a room, while a component is an object you pick out at a
glance. A first attempt at a flat cap of 24 failed `validate:board` on the existing zones, which is
the schema doing its job.

## 2026-09-10 — The usage meter measures, and says so when it cannot

**Decision.** Three values, top-left, always on: RATE, POOL LEFT, TIME LEFT. The rate is measured
from `~/.claude/projects/**/*.jsonl`, where Claude Code records a real `usage` object and a real
timestamp on every assistant message. POOL LEFT and TIME LEFT are `null` — rendered as
"SET A BUDGET" — until the user puts a `tokenBudget` in settings.json.

**Why the pool is not guessed.** How much of a subscription is left is not on this disk and no
local API reports it. Prime directive 1: a meter that invents an allowance is worse than one that
admits it does not know, because you would plan around the invented number.

**Weighting.** Cache reads count at a tenth. SkynetOS's own project directory holds 445M cache-read
tokens against 1.6M output; counted at par, every figure becomes a cache-read figure wearing a
usage label, and the couriers would walk in proportion to conversation LENGTH rather than to work
done. It is deliberately not dollars — pricing changes and a stale money number is worse than an
honest relative one.

**Cost.** 3.4 billion tokens across eight projects in files up to 22 MB. Only lines containing
`"usage"` or `"cost-state"` are parsed at all (a string test is orders of magnitude cheaper than
`JSON.parse`), results are cached against each directory's newest mtime and file count, and the
window start is rounded to a minute so a moving boundary does not invalidate every scan.

## 2026-09-10 — Couriers: the board shows where the tokens went

**Decision.** Little robots carry packets from the JARVIS head to whichever node is consuming
Claude, in proportion to real measured usage. Each destination has its own deterministic colour
derived from its node id. They walk orthogonally on whole pixels, one axis at a time, and
glitch-dissolve on arrival — four frames of whole pixels punched out on a fixed pattern, not an
alpha fade, because docs/02 forbids partial alpha.

**Attribution.** A `drive.room` stands in for everything inside it, resolved by reading the child
board (depth-limited, so a cycle in user-editable data degrades to "no couriers" rather than a
stack overflow). A project claimed by several nodes has its share SPLIT between them — otherwise a
repo that appears both as a `store.repo` and inside a room drive would generate twice the traffic
it earned, and the board would be lying about exactly the proportions this feature exists to show.

**What does not get couriers.** Anything with no working directory and no conversation. A
`link.url` is a bookmark, not a consumer.

**Off switches.** No couriers under `reducedMotion` (docs/02: state must survive without
animation) and none in Edit Board mode — it is hard enough to drop a component on the right tile
without eight robots walking over it. Routes are rebuilt only when the shares change, not per
frame. Capped at 90 on screen; past that it is noise, not information.

**Source.** The JARVIS head on the root board, because the packets are its errands. Inside a room
there is no head, so they enter from the nearest edge — work arriving from outside, which is what
William described.

## 2026-09-10 — Renderer errors reach the smoke log

A React hooks violation (an effect added after an early return) rendered a completely blank window,
and the smoke capture saved a screenshot of an empty board with no hint of why: the error existed
only in a devtools window a headless run never opens. `console-message` now forwards anything that
is not `info`, so a capture that produces a blank frame also produces the reason.

## 2026-09-10 — Couriers paint under the components

William: "I want the robots to render as a layer under the nodes but over the wire and background."

Paint order is now copper -> zones -> COURIERS -> components -> printed notes -> grid -> overlays.
A courier walks across the substrate and along the traces in full view, then passes BEHIND the
package it is delivering to. Being occluded by the destination is what makes the arrival read as
going into the node rather than stopping on top of it; the glitch-dissolve finishes whatever is
still sticking out.

## 2026-09-10 — The sorting furniture is addable from the board

**Decision.** `N` in Edit Board mode opens an add-component palette. Every node kind, each drawn
with its real silhouette from the same `drawComponent` the board uses, so you pick a shape you
recognise rather than reading type names. New nodes arrive unbound and `provisional` — an
unpopulated footprint, a real PCB convention for "something goes here" — and the editor opens on
whatever you add.

**Why it was needed.** Drop-in ingestion covers the things that ARE files. It cannot cover a
`group.zone` bracket or a `note.silk` heading, because those correspond to nothing on disk. The
brackets around MinecraftOS's mod clusters were therefore fixtures of a JSON file you had to
hand-edit, and William wants to add a subsection every time he adds a family of mods.

Printed kinds are placed exactly where they are asked for, not at the nearest free space: they
occupy no grid and never collide, so "finding space" would move a bracket away from the cluster it
was drawn around, which is the one thing it must not do.

**Printed kinds became selectable in Edit Board mode.** A `note.silk` was never a click target, so
it could not be selected, moved, edited or deleted — only hand-edited. It now has a hit box derived
arithmetically from its text (measuring needs a canvas, and layout.ts is pure so it can be tested),
used for hit-testing only and never for drawing. Outside Edit Board mode print is still inert:
a silkscreen heading stealing a click from the component under it would be maddening.

## 2026-09-10 — The schema validator recompiles when the schema changes

Reported by William mid-session: "it says nodes 0 and 6 must not have additional properties" — for
`logo`, a property the schema declares, on a board `npm run validate:board` accepted from the same
file a second later.

The schema is read from disk, but the COMPILED Ajv validator was cached for the life of the
process. An app started before the schema gained a field rejected every board using it, forever,
and nothing said restarting would fix it. The cache is now keyed on the schema file's mtime and
size. This project's premise is that agents edit files while the app is running; a validator that
assumes its own schema is immutable does not belong in it.

## 2026-09-10 — The JARVIS mailbox, with SkynetOS as the wire

**The problem.** JARVIS is two things wearing one name. The Face is a claude.ai conversation and
cannot see this disk, ever. The Hands are a Claude Code session that can do anything on it. There
is no wire between them, so everything the Face decided reached the disk only because William
retyped it — the copy-paste he has said repeatedly he does not want.

**Decision.** `codex/mailbox/` with `to-hands/`, `to-face/` and `archive/`. Markdown files with
YAML-ish frontmatter, chosen because a human and an LLM can both write one correctly from memory,
and because the Hands read and write files natively — no protocol, no server, no credentials, and
it survives a crash, a restart and a `git clone`.

The Face cannot reach it at all, which is exactly why SkynetOS has to be the wire. The `M` panel
writes what the Face said into `to-hands/`, and puts what the Hands wrote on the clipboard for the
Face in one click. One click each way instead of a transcription.

**The last mile.** Unread `to-hands` mail is folded into the session BRIEFING on launch, so the
Hands open already holding their post. A mailbox nobody checks is a drawer.

**Nothing is deleted.** Handling a message means moving it to `archive/`, which is git-tracked:
"what did the Face actually ask for" is a question asked weeks later. And a message that fails to
parse is surfaced with its raw text as the body rather than skipped — a mailbox that silently drops
mail is the worst possible mailbox, because the sender believes it was delivered.

**What it is not.** Not a live channel. Nobody is notified, nothing is pushed, a message sits until
a session opens. Two agents that run at different times, in different places, with different powers
exchange post. Pretending otherwise would mean claiming a wire that does not exist, which is the
thing this design exists to stop doing.

## 2026-09-10 — docs/08-AGENT-INTAKE.md: the brief you hand to another agent

William: "so that I can more easily populate the index / repo info files I want you to create an
instruction set I can provide to an agent I have been working with a project on and the agent will
return every file you need."

**Decision.** A copy-pasteable brief that produces two artefacts, deliberately separate:
`codex/projects/<slug>/` (prose — what each thing IS, and a `landmines.md`) and
`board/<slug>/fragment.json` (data — nodes and edges, schema-valid). Prose makes an agent
understand a project; the fragment makes the board point at it.

The brief forbids `pos` and `footprint` (placement is SkynetOS's job), demands globs for artifacts,
demands zones for natural groupings, and tells the agent to omit a field it is not certain about
rather than guess — a missing field renders as an honest unbound node, a wrong path renders as a
broken one and costs an afternoon to find.

**On trust.** An intake package is data from an agent SkynetOS has never met, describing paths on
this machine. There is no import path that skips the JSON Schema or the command bus, board JSON
carries no executable strings, and every path is resolved at render time. The worst a bad package
can do is produce a room full of visibly broken nodes.

## 2026-09-10 — docs/09-ASSET-CATALOGUE.md is generated, not written

`npm run assets:catalogue` measures every PNG under `assets/vendor/`: dimensions, grid, cell count,
how many cells contain any non-transparent pixel, colour count, ink coverage, and the licence line
from each pack's SOURCE.md. 764 files, 21,981 non-empty cells.

**Measured, not transcribed.** A vendor README describes the pack that was published, not the file
on this disk. A grid the tool inferred from the image dimensions is marked INFERRED and must be
verified into the manifest before anything is cut from it — a guessed grid that looks right is
exactly how a kitbash ends up half a pixel off.

**Sheets and loose sprites are separated.** The UI pack is ~740 individual sprite files; one table
row each produced a 764-row table nobody would read, which is the same as having no catalogue.
Anything with a real grid gets a row; the rest is a per-directory summary.

`--check` fails when the catalogue is stale, so it can be a CI gate.

## 2026-09-10 — `decor.image`: backdrops behind the board

William: "add to the board the ability to upload images as background elements, rescalable."

**Decision.** A new node kind that is printed rather than mounted. It draws in its own layer above
the substrate and BELOW the copper, so a trace crosses it, a component stands on it and a courier
walks over it. Resizable to the whole board (the `group.zone` cap, not the component one), and not
a click target outside Edit Board mode — a board-sized backdrop that swallowed every click on empty
substrate would be unusable.

New ones arrive with `showName` and `showDesignator` off. A nameplate floating over a background
element reads as a mistake.

**What the addition taught.** "Which kinds are obstacles" turned out to have FOUR separate
implementations: `tools/validate-board.mjs`, `board-store.graphProblems`, `layout.findFreeSpace`
and `drag.canDrop`. Three were updated and the app then refused to load a perfectly valid board
with 59 overlap errors — because the fourth, the app's own copy, still counted the backdrop as an
obstacle. That failure was loud, legible and named the exact nodes, which is the failure mode this
project wants; it is still four copies of one rule, and the next kind added to that list will hit
it again. Noted here so the next person greps for it rather than rediscovering it.

## 2026-09-10 — The plan question: a published multiplier over a calibrated baseline

William: "How can I set it so that it knows I have the Claude Max plan 20x usage over Pro."

**SkynetOS cannot ask.** Nothing local reports which plan an account is on or how much allowance is
left, and Anthropic publishes no TOKEN figure per plan — the documented shape is "Max 20x is twenty
times Pro" plus ranges of prompts per five hours, which is not a unit this meter can add up.

**Decision.** `plan` in settings.json supplies the published MULTIPLIER. The baseline it multiplies
is CALIBRATED from this machine's own history, which is the part SkynetOS genuinely knows.

Measured 2026-09-10 over 10,715 assistant messages spanning three weeks:

    5-hour window distribution:  p50 13.2M   p90 52.0M   p99 94.6M   max 96.1M

The top of that distribution is flat — p99 94.6M against a maximum of 96.1M, a 1.6% gap across the
last percentile. Demand that tapers does not do that; a ceiling being hit does. So ~96M weighted
tokens is this account's real five-hour ceiling on Max 20x, and `PRO_BASELINE_TOKENS` is that over
twenty.

These are estimates and are labelled as estimates everywhere they appear — the plan chip carries a
`~`. `tokenBudget` overrides all of it, because a measurement should never argue with an
instruction. The drawer shows the account's own peak so the table can be checked against evidence
rather than trusted.

## 2026-09-10 — Every measured value gets a bar

William: "don't just show values show a visual representation of token usage."

Three bars, each graded against something different and each stated in its tooltip: POOL against
the budget, RATE against the pace that would spend exactly one window's budget in exactly one
window, TIME against the window length. With no budget, RATE is graded against the account's own
measured peak — the only real ceiling available — and the other two say so rather than drawing an
arbitrary scale.

Sixteen whole cells. A percentage-width bar would be the one blurred thing on an otherwise exact
screen; docs/02 anti-mush applies to the chrome as much as to the canvas.

## 2026-09-10 — The board is dressed from a real tilesheet

`decor.part`: 21 pieces of board furniture — vias, screws, test points, junctions, elbows, tees,
grilles, pad arrays, heatsink fins, capacitors, ribbon ends, fiducials, panels, and five indicator
LEDs that pulse. Every one is a cell of the Kenney 1-bit sheet, recoloured to the locked palette by
`npm run assets:bake`. Coordinates were read off a ruled contact sheet, never guessed.

`ATLAS_URL` is finally wired, so the atlas loads for the first time. Two things had to change for
that: the baker now always writes an atlas (an empty one is a valid one) because Vite's `?url` is a
build-time resolve and `assets/atlas` is git-ignored; and the atlas PNG is now imported too, since
an emitted asset lives at a hashed path and deriving its URL from `meta.image` produced
"The source image cannot be decoded" in the built app while dev worked fine.

The baker also stopped skipping sprites in silence. A `source` missing its `type` baked nothing and
said nothing — the atlas just came out short, and finding out which entries had evaporated meant
diffing the manifest against the frame list. It throws now.

Tints are all LITERAL tokens, never `@theme` keys: the theme-key swap is not implemented in the
renderer and an `@token` would bake as reserved magenta. It is also simply correct — a via is
copper in every room because a via IS copper.

## 2026-09-10 — Printed kinds are one list now, not five predicates

Adding `decor.image` needed four edits to "which kinds occupy no grid"; missing one made the app
refuse to load a valid board. Adding `decor.part` needed six, and the sixth — the A* obstacle
filter — was found by a router test failing rather than by anyone remembering, after every trace on
the root board started cutting through components.

`PRINTED_KINDS` and `isPrinted()` now live in `packages/shared/types.ts` and every copy defers to
them: the validator, `board-store.graphProblems`, `layout`, `drag.canDrop` and the router.

## 2026-09-10 — The pulse glow is a palette shift, not a glow

William: "an animated pulsing glow as if energy is flowing in them from their center outwards."

The obvious implementation is an animated radial gradient at low opacity. That is four violations
of docs/02 in one line — a gradient, partial alpha, off-palette colours and a soft edge — and on
this board it would read as a smear of light sitting on top of pixel art.

So `pulseGlow` shifts the PALETTE instead. The room's six colours are already a brightness ramp and
the mosaic has already quantised the image onto exactly them; an expanding ring pushes the pixels
it crosses one or two rungs up that ramp and lets them fall back behind it. Every frame holds the
same six colours the image already had, the wave is made of whole pixels, and it reads as charge
moving through the material rather than as light shining on it.

Sixteen frames precomputed once per image and cycled at 12fps — doing it live for a 320x224
backdrop is millions of pixel operations a second for decoration. Off under reducedMotion.

## 2026-09-10 — The scroll wheel zooms

It required Ctrl, on the reasoning that a document scrolls. This board is not a document: it pans
with WASD and with a drag, so the wheel had no job and did nothing when turned — which reads as
broken, not as reserved. Plain wheel now zooms, anchored on the cursor rather than the viewport
centre, which is the difference between magnifying a map and being thrown across one. Ctrl still
works.

## 2026-09-10 — Text is styleable, and a legend can sit on a plate

Four things William asked for at once, all of them about type.

**A plate.** `U1 — PRIMARY JURISDICTION: ALL` was printed straight onto the substrate, so it
collided with traces, backdrops and couriers and became unreadable exactly where the board was
busiest. `textPlate` draws a box behind it, measured from the rendered text every time — so it
"adjusts to text length" by construction rather than by anyone maintaining a width. "Rounded" at
1:1 means omitting the four corner pixels and stepping the border in by one; anything smoother is
anti-aliasing.

**A real bounding box.** A text node's hit box was arithmetic — characters times an assumed
advance — so it never matched what was drawn. `layoutRects` now takes an optional measurement
callback; the renderer passes one, and tests (which have no canvas) keep the estimate. Measured on
screen, estimated only where measuring is impossible.

**Colour, outline, glow.** `textColor`, `textStroke`, `textGlow`, plus `plateColor` and
`plateBorder`. Every one is a palette TOKEN, never a hex string — partly because a hex value can be
off-palette, but mainly because `signal`, `mask-dark` and `mask-light` mean something different in
every room. A note styled `signal` keeps its own room's accent; one that said `#7FE0B0` would carry
SkynetOS's green into a room that is not green.

The outline is the glyphs stamped eight times, one pixel out in each direction, in the stroke
colour. Crude and exact — `strokeText` and `shadowBlur` both anti-alias. The glow is the same
palette shift the wallpaper pulse uses.

## 2026-09-10 — Rooms store a stem; the board appends OS

`drive.room` nodes now store `Minecraft` and the board prints `MinecraftOS`. The name field edits
the stem only, so a title cannot become `MinecraftOSOS` and the suffix cannot be deleted by
accident. `roomStem` is tolerant of the seeded boards, which stored the full name, so the migration
happens by touching a node.

**The part that could not be built as asked.** William wanted the `OS` at "about 75%" of the title.
Departure Mono is a pixel font and is exact at 11px and 22px only (docs/02); 75% of 11 is 8.25,
which means scaling a bitmap by a fraction — the precise thing anti-mush treats as crash-severity.
The suffix therefore steps down to the next exact size, and `size` became offerable on a room so
that step can exist: at a 22px title the OS is 11px and genuinely half; at 11 it stays 11 and reads
as subordinate by colour and outline alone. The five root-board rooms were set to 22.

"A few shades darker, into gray" is `copper-dark` with a `mask-dark` outline — the locked palette
has no true grey, and adding one would change `MAX_COLORS_PER_FRAME`. Both are overridable per node
with the ordinary text tokens.

## 2026-09-10 — One settings write, and only one

William: "the 'SET A PLAN' text should be clickable and open up a dialogue prompt."

docs/07 says settings are user-only and there has deliberately never been a `settings:write`
channel — so that the rules deciding what an agent may touch are not themselves agent-writable.

`settings:setPlan` does not weaken that. It writes exactly two keys, `plan` and `tokenBudget`, and
nothing else: they decide how a METER is SCALED, grant no access, allow no path and elevate
nothing. Every field that does grant something — `devRoots`, `confirmAllLaunches` — is untouched
and still requires opening the file. A general settings writer would have been the wrong shape.

The dialog's primary control is free text, parsed: `Max 20x`, `max20`, `20x`, `Claude Pro`, or a
bare `96M` if you would rather state the budget. It echoes back what it understood BEFORE you
commit, and says so plainly when it understood nothing rather than picking something. It also
offers the account's own measured peak as a budget, which is the one figure that is not an estimate
at all.

## 2026-09-10 — Why the two glow checkboxes did nothing

Reported: "the pulse glow and text glow checkboxes don't appear to do anything right now." Both were
real bugs and both were the same shape — a feature wired to the wrong event.

**`pulseGlow`** built its frames only inside the `.then()` of a mosaic fetch. `loadImages` skips
that fetch when the image key (`source@WxH`) is unchanged — which is exactly the case when you tick
a checkbox. So the glow only ever worked on a node that already had it set the first time its image
was fetched, which the seeded board happened to cover and no edit ever could. Glows are now
reconciled against the board on every rebuild, in both directions.

**`textGlow`** was read by the note layer and by nothing else, so ticking it on a component — where
the field was offered, and where William ticked it — was a control that silently did nothing. It
now drives nameplates too, through a separate list because a nameplate is part of a component's
texture and a note is its own sprite.

The pulse itself was also too timid: four steps that spent half the cycle at one rung. Six steps
running the full 0-2-0 excursion, which is as much brightness as a six-colour ramp has to give.

## 2026-09-10 — The camera gets slack on every side

`clampCamera` pinned the board's edge to the viewport's exactly. A component near an edge could
never be brought to the middle of the screen to work on, and with the inspector open a node on the
right edge could not be brought out from under it at all.

`PAN_MARGIN` is eight tiles of deliberate overscroll in every direction. In WORLD pixels, not
screen: the same slack at 2x and 4x, where a screen-pixel margin would give four times as much room
to get lost in at the lowest zoom. Slack, not freedom — the board is always still there when you
stop panning.

## 2026-09-10 — Frames and priority: dressing a node

**Frames.** The copper-leg effect was `legs()` on a `dip` silhouette: available only to
`agent.code`, and only when the node had no wallpaper, because a face image replaced the drawn
package entirely. `frame` makes it a styling choice independent of both — nine variants (dip, quad,
bga, fingers, tabs, rails, socket, castellated) drawn in a margin OUTSIDE the footprint, the way the
nameplate is. A framed node is not a bigger node; collision and routing still run on the grid the
board file describes.

**Priority as height.** Each level is two pixels of long shadow cast down and to the right, drawn
behind the body. Every layer is mask-dark, with a single copper-dark pixel line down the lit edges
of the nearest one. A first attempt made the nearest layer copper-dark throughout and the stack read
as a copper slab the component was sitting on — protruded rather than raised, which is the one thing
William asked it not to be. One pixel says "this has a side"; anything more is a plinth.

The editor control is a slider with a live preview of the actual stack, because you are choosing a
height rather than entering a value.

## 2026-09-10 — Couriers: silver bodies, coloured edges, and twice as many

**Colour.** Every robot is silver now, and its destination is in the OUTLINE, darkened 55% toward
black. The old version gave each destination a saturated body colour, which put eight bright hues on
a six-colour board and made the courier layer louder than the components it was reporting on. A
silver body with a dark coloured edge reads as a machine carrying a tag; per-destination identity
survives because an outline at 6px is still perfectly legible as colour.

Three silvers rather than one, so a crowd is not one stamp repeated. Textures are cached per
(outline, shade) pair — twenty-four cycles for a whole board, not one per courier.

**Doubled**, with the population cap doubled too: a rate ceiling and a population ceiling are the
same ceiling wearing two hats, and raising only one means the extra couriers are never born.

**Wobble.** A slow sine across the whole journey, per-individual phase, applied perpendicular to the
leg being walked and tapered to zero at both ends — so couriers leave and arrive on the line and
only wander in between. Rounded, so the walk stays orthogonal and on whole pixels.

**The six-colour exception.** docs/02 caps a frame at six palette colours and this layer exceeds it:
there are more destinations on a busy board than the palette has entries, and per-destination
identity is the entire feature. Deliberate, scoped to 6x8px sprites in one layer, everything derived
from palette entries by darkening rather than invented — and written down rather than left to be
discovered.

## 2026-09-10 — Parts render above the components

`decor.part` moved to its own layer above `nodeLayer`. William: "aesthetic elements should be
rendered OVER / on top of the board so mini robots pass UNDER the '+' box aesthetic elements." A via
screwed through the board is on top of everything mounted to it, and a courier walking past goes
underneath. Paint order is now backdrops -> copper -> zones -> couriers -> components -> parts ->
notes -> grid -> overlays.

The **"+" box** is a persistent way into that palette while editing. `N` already opened it, but a
keyboard shortcut is not discoverable and dressing a board means reaching for it repeatedly. It
lives at the middle of the left edge: bottom-left put it straight through the session dock, whose
height depends on how many sessions are running, so no fixed offset clears it.

## 2026-09-10 — The frame flicker: three spec builders that drifted

Reported: "applying a frame creates a flickering effect and appears to apply it to all nodes."

Two separate causes, both invisible until frames existed.

**The flicker.** Three places built a node's texture spec — `drawNode`, the pulse-glow ticker and
the text-glow ticker — and they had drifted. The glow ticker did not pass `frame`, `priority`,
`nameSize`, `nameStyle` or the room's OS suffix, so every pulse redrew the node stripped of all of
them and the next rebuild put them back. Several times a second, on exactly the nodes that were
glowing — which is why it read as the frame leaking across the board rather than as one node
misbehaving.

**The leak.** The texture cache identified a face and a logo by `src.length`. Two different mosaics
that happened to encode to the same number of base64 characters produced the same cache key, and
one node was handed another node's texture — frame, depth and all. A coin-flip bug that would have
been miserable to chase later. Images are now identified by content: length plus both ends.

**The fix is structural, so the test is too.** `specFor` is the only thing that describes a node's
appearance, and `test/render-invariants.test.ts` reads the source to enforce that: every
`sprites.placeholder(` call must be handed `specFor(...)`, and `specFor` must carry every visual
field. Verified by re-introducing the original bug and watching the guard fail. A unit test cannot
express "there is only one of these", and that was the actual defect.

The same file now also guards the cache key and the single `PRINTED_KINDS` list — the two other
places where one rule written down twice has already shipped a bug.

## 2026-09-10 — The "+" box lives in the breadcrumb row

It floated over the board and collided with whatever was beneath it: first the session dock, whose
height depends on how many sessions are running, then the help bar. There is no fixed offset that
clears a panel of variable height, so it moved into the breadcrumb row — a strip of chrome that
already exists, already grows with its content, and is the one place nothing else is drawn into.

## 2026-09-10 — A control inside click-through chrome has to opt back in

Reported: "the add button is not clickable for some reason."

`.breadcrumb`, `.hud` and `.help` are all `pointer-events: none`, deliberately — they are mostly
text, they sit over the board, and a strip of text that swallows a drag meant for the canvas is
worse than one that overlaps it. The cost is that any real CONTROL placed inside one inherits it
and silently stops working: it renders, it highlights on hover, and clicking does nothing at all.
`.drag-badge` had already hit this and opted back in; `.add-fab` was written without knowing that.

Nothing catches it at runtime — a button that receives no events raises no error — so
`test/render-invariants.test.ts` checks the CSS instead, and asserts the premise (that the chrome
really is click-through) alongside it, so the guard cannot quietly start measuring nothing.

Moving the button into the breadcrumb row was still right; the row is the only strip of chrome
nothing else is drawn into. It just needed the same opt-in the drag badges use.

## 2026-09-10 — `provisional` excuses a node from naming its target

Reported: adding a link node was refused with "EDIT REJECTED — the result would not validate".
It was not only link nodes. Fourteen of the sixteen kinds the "+" palette offers could not be
added at all, which is to say the palette had never worked for anything but a note, a bracket and
a decor part.

Two rules, each right on its own, contradicted each other:

- `services/node-factory.ts` creates a new node UNBOUND and `provisional: true` on purpose. Prime
  directive 1 says never fabricate a target, so a new repo node points at nothing and says so.
- `schema/board.schema.json` required every kind to declare its target — a `link.url` has a `url`,
  a `store.repo` has a `path`, an `agent.code` has a `cwd` and a `launch`.

So the factory produced a node the schema would never accept. The command bus validates before it
writes, correctly, and every add died there.

The requirement is now conditional on the claim: the whole `allOf` is gated behind "this node has
not declared itself provisional". Bind a node and it must resolve; mark it a TODO and it must look
like one. `provisional` is the one word the board has for "nothing is fitted to this footprint
yet" — demanding a target from a node that has openly declared it has none was the contradiction.

The exemption is deliberately narrow, and `test/new-node.test.ts` is mostly about the narrowness:
`provisional` excuses a node from its target field and NOTHING else. An unknown property, a kind
that does not exist, a malformed id are all still refused with the flag set. The other half of
that test runs the real `makeNode` for every kind in `NODE_KINDS` against the real schema, so a
kind added later with a new required field is caught here rather than by a user clicking "+".

Rejected: making the factory invent placeholder targets (`url: "https://example.com"`). It would
have validated and it would have been a lie on the board — the exact thing prime directive 1 is
there to stop. Also rejected: dropping the target requirements. They are what stops a node that
silently resolves to nothing.

## 2026-09-10 — Boards are tripled, and the camera opens on the content

William: "the board viewport should be able to go even farther out on the edges, and triple the
board size so there's more space to work with, also the room sizes."

Three changes, and the second two only became necessary because of the first.

**Tripled, and re-centred.** Setting width/height to 3x and stopping would leave everything
already placed jammed into the top-left ninth with eight ninths of empty board attached. So every
node moved by exactly one board-width and one board-height, which puts the old extent dead centre:
every relative position, cluster and bracket preserved to the tile, new room on all four sides.
(The offset is exactly the old dimension — (3w - w) / 2 = w.)

**The pan margin is half a viewport, not eight tiles.** `PAN_MARGIN` existed to answer "I cannot
bring a node near the edge to the middle of the screen to work on it", and eight tiles never
actually answered it: centring a node in the board's CORNER needs the camera at minus half a
viewport, about sixty tiles at zoom 2 on a wide monitor. The margin was seven times too small for
its own stated purpose, and on a 192-tile board it was 4% of the width. Half the visible extent is
exactly the amount that makes the promise true at every zoom on every screen, and it is
self-limiting — at the extreme the board's edge is at the middle of the screen, so half the view
is always still board. `PAN_MARGIN` survives as a floor for a window too small for half of it to
be eight tiles. The clamp's "does it fit" test had to change with it: `w + margin*2 <= visible` is
never true once the margin is proportional, which would have silently retired the centring branch.

**The camera opens on the content.** A board is not its content — the root board is 192x120 tiles
and the components sit in a patch in the middle. Starting at 0,0 showed a screenful of bare
substrate with the board off to the lower right. `contentBounds()` frames what is actually there,
once, on arrival in a room. Never on rebuild: that is the camera-snap bug and it stays fixed.

## 2026-09-10 — sendInputEvent does not produce pointer events, so no mouse drag was ever tested

Found while chasing what looked like a camera regression from the tripling. It was not one.

`BoardCanvas` listens for `pointerdown` — that is what gives it pointer capture and what lets a
drag released off-canvas still finish. The smoke harness drove drags with
`win.webContents.sendInputEvent({ type: 'mouseDown' })`, which produces the mouse half and no
pointer event at all. So from the moment that listener changed, every mouse drag the harness
"performed" landed on nothing: `09-drag-ghost.png` was a picture of a board with no drag in
progress, and the only assertion — "did a node move" — reads the same whether the harness is
broken or the app is. Real hardware sends both, so the app was fine and the test was theatre.

The harness now dispatches real `PointerEvent`s in the page: `pointerdown` on the canvas,
`pointermove`/`pointerup` on `window`, because that is where BoardCanvas listens. They are
`isTrusted: false`, which nothing in the renderer tests for.

Two things fell out of fixing it:

- `setPointerCapture` is now in a try/catch. It throws `InvalidStateError` for a pointerId the
  element has never seen, and that exception abandoned the gesture before the cursor was even set.
  The capture is a nicety — the window listeners are what actually carry a drag — so failing to
  get it must not cost the drag.
- The harness stopped guessing where things are. It had three assumptions and all three were
  wrong: that the camera clamps to 0,0 (tripling moved the content off the corner), that
  `win.getContentSize()` is the coordinate space `sendInputEvent` uses (it is not — scaleFactor 2
  means main sees 1267x717 while the page is 2534x1434), and that a node in the middle of the
  window is clickable (the usage meter, minimap and inspector are DOM chrome drawn over the
  canvas, and a mousedown on the minimap is a camera JUMP that looks exactly like the bug this
  section exists to catch). The page now picks the target, `document.elementFromPoint` arbitrates
  "clickable", and the destination comes from `findFreeSpaceOnBoard` so a refused drop cannot be
  confused with a broken drag.

## 2026-09-10 — JARVIS Prime gets the board, and a way to open terminals

William: "I want to ensure jarvis hand (which I have renamed to jarvis prime) can access and launch
terminals and feed them prompts... Additionally, I want Jarvis Prime to have full access and
editability over every aspect of the board itself... Ensure all of this is wired up."

**The shape.** `tools/skynet-mcp.mjs` is spawned by Claude Code as a stdio MCP server, so it cannot
be the Electron main process — main is already running and owns the board, the database, the
command bus and the undo stack. A second process writing board JSON behind its back would break
undo, skip schema validation, and leave the open window showing a board that no longer exists on
disk. So the MCP server is a thin proxy over a named pipe, and everything it asks for is dispatched
by `callAsAgent` into the same handler table the renderer uses.

**A pipe, not a port.** A localhost port is reachable by every process on the machine and, on a
misconfigured box, from the network. A named pipe is subject to the same user-account boundary that
already protects sessions.db and settings.json — the boundary this app already relies on
everywhere else. Using a second, weaker one for the most powerful surface in the program would be
indefensible. The token beside it is not the boundary; it means a process that stumbles onto the
pipe name still cannot drive the board without reading the user's own AppData.

**No SDK.** `@modelcontextprotocol/sdk` was the obvious choice and is the wrong one here. Claude
Code spawns this file as a bare `node tools/skynet-mcp.mjs`, so its imports must resolve from disk
at that path — and in a packaged build `node_modules` lives inside app.asar, where they do not.
Shipping the SDK meant shipping seventeen transitive dependencies unpacked, and a resolution
failure in any one of them presents as "JARVIS Prime has no tools" with nothing in any log to say
why. What is actually used is three methods over newline-delimited JSON-RPC. Writing them directly
removed the dependency and took the server's startup from 1747ms to 53ms.

**The gate is one function.** `callAsAgent` refuses anything outside `AGENT_METHODS`, forces
`actor: 'agent'` so an edit cannot misattribute itself, and strips `approved` — that flag means "a
human approved THIS command in THIS exchange", and an agent setting it for itself would turn the
delete guard into a comment. `node:add` moved out of the handler into a shared function taking an
actor, because "the renderer called it, therefore William did it" stopped being true the moment an
agent could call it too.

Omissions worth naming: `command:undo`/`redo` are withheld because the undo stack is shared and not
per-actor — an agent reaching for undo reverts whatever happened last, which may well be William's
work, and prime directive 5 gives HIM the undo. `pick:target` is withheld because an agent must not
be able to put a modal in front of someone who might dismiss it by reflex.

Rejected: exposing a generic `board_write` that takes raw JSON. It would have been less code and it
would have bypassed the schema. Rejected: a `shell` tool. docs/07 already says no, and the honest
version of "run something" is `session_start`, which opens a real terminal in a directory the board
declares, with the task in front of it.

## 2026-09-10 — Head → Prime: a message that starts the work

The mailbox already carried words from the Face to the Hands. What it could not do was make
anything happen: a message sat in `to-hands/` until someone clicked the chip, so the Face could ask
but never act. William asked for the other half — "jarvis can autonimously start the task".

A `run:` field in the frontmatter. Present, it opens a real session on the Hands node with the
message body as its task; absent, it is ordinary post, which is what every message written before
this field existed keeps meaning.

Opt-in per message rather than "every message runs", because a mailbox where every note starts a
process is not a mailbox — the Face has to be able to say something without it becoming an order.
Only the frontmatter counts: the body is prose written by a language model and will contain "run
the tests" constantly, and if the body could arm this then discussing running something would
launch a terminal.

Three decisions worth the ink:

- **Archived BEFORE launching.** If the launch is what marks a message handled, a launch that
  throws — or a crash between the two — leaves it flagged and the next sweep runs it again. "Fix
  the mod" twice is not the same as "fix the mod", and the work may be half done. A dispatch that
  fails is visible in the log and the archive and is recoverable; a dispatch that repeats is not.
- **Elevated nodes are refused, not downgraded.** Elevation is a decision William made about that
  node. Silently running it non-elevated would do the wrong work; arranging a UAC prompt he did not
  ask for is not an agent's to arrange.
- **Polled, not watched.** `codex/mailbox/` is written by git, an editor, the clipboard path and the
  Hands themselves, and a watcher on a directory with that many writers fires on partial writes.
  Half a message dispatched as a task is worse than one dispatched ten seconds late, and the other
  end of this is a human typing into a chat window.

Rate limited to three an hour, matching docs/07's existing limit for agent-to-session messages,
because this is that act with a launch attached. A loop in the Face cannot become a hundred
terminals. `autoRunMail: false` turns it off, and it lives in settings.json because there is no
settings:write channel by design.

## 2026-09-10 — A panel's size is a property of the panel

Reported: "the minimap is way too big of a window make it a smaller window / and resizable."

Pixels-per-tile was a constant — `const SCALE = 3`, with a comment saying "3 keeps a 64x40 board
at 192x120 — big enough to aim at, small enough to sit in a corner". Both halves of that were true
when it was written. Tripling every board to 192 tiles turned the same constant into 576 art
pixels, which at chrome scale 2 is over a thousand pixels of screen: a minimap covering a quarter
of the window, with no way to move it, resize it or close it.

The bug is the direction of the dependency. A panel that derives its SIZE from the data it shows
grows without bound as the data does. So the budget is fixed (240 art px) and the scale is derived
from it — a bigger board gets a smaller scale, never a bigger panel.

The scale stays an INTEGER, and resizing therefore snaps rather than glides. That is the same
bargain the board's own 2x/3x/4x zoom makes, for the same reason: docs/02 §Anti-mush does not make
an exception for chrome, and a fractionally scaled minimap is a blurry one. The panel shows the
number it is at so a jump from 2x to 1x reads as deliberate.

The stored preference is a NUDGE (±2 steps), not the scale itself, because it is remembered across
rooms and rooms are different sizes — a scale that suited a 144-tile room would blow a 192-tile
board straight back out to the size being fixed here.

One case cannot be fixed: the schema permits 512 tiles, and at the floor of 1px per tile that is
512 art pixels, wider than the budget. Half a pixel per tile is not a smaller minimap but a blurry
one, and dropping tiles would be a minimap that lies about where things are. So the floor outranks
the budget and the failure mode at an absurd board size is "large", not "empty".

Preferences live in localStorage, not settings.json. They are how the window is arranged, not what
the app is allowed to do, and docs/07 keeps settings.json user-only with no write channel on
purpose. Every read is in a try/catch because storage throws outright in some contexts and a
thrown preference must not cost the board.

## 2026-09-10 — Wiring: click two node edges to draw a trace

William: "when in board edit mode add the ability to connect (generate) a wire between any two
nodes; hovering over one of the four edges of a node shows a glowing dot and when clicked starts a
wire, then clicking the edge of a different node connects / ends the wire. These wires stay
dynamically attached / adaptable."

The last part needed no work and is the reason the rest is small: a `BoardEdge` stores two NODE IDS
and no coordinates at all. The router lays the copper every time the board is built, so a trace
already followed its endpoints through a move, a resize or a change of footprint. There was nothing
to keep in step — only a gesture to add.

**Click-click, not drag.** The two ends of a trace can be far apart on a 192-tile board, and a
click-move-click lets you pan and zoom in between. A drag would have limited you to what fits on
one screen.

**Hit-tested against the whole edge, snapped to the midpoint.** Requiring the cursor to find a
four-pixel dot would make the feature undiscoverable — you would have to already know the dots were
there to hover one. Hovering anywhere along the top of a chip is an unambiguous way of saying "the
top", so that is what it means.

**Gated behind Edit Board mode.** Browsing a board involves a lot of clicking near components, and
a click that starts a trace by accident would be worse than no feature.

**Refusals say why.** A wire to the node it came from, or a second wire between an already-connected
pair, toasts the reason. The duplicate case is not about validity — two traces between the same
pair render on top of each other, so the board would look unchanged and the click would seem to
have failed. A gesture that silently does nothing is indistinguishable from a broken one, which is
a lesson this codebase has already paid for twice.

**The relationship is guessed, not asked.** Drawing a wire should not open a dialog asking which of
six words you meant. An agent to a repo reads it; a repo to an artifact produces it. The inspector
changes it in one click when the guess is wrong.

Backdrops and board furniture are not wirable — a trace to the picture behind the board means
nothing, and the router would draw it anyway. Notes and zones are: a bracket with a trace to the
agent that owns it is a real statement about the board.

### And the harness learned to stop guessing

The smoke test for this failed twice for reasons that were not the feature.

First it computed where a port ought to be from the board file and clicked there. The renderer had
the node somewhere else, so it clicked bare substrate and reported wiring broken. It now HOVERS
first and reads `window.__skynetWire` — where the port actually is, according to the code that
draws it — exactly as the camera check reads `__skynetCamera` rather than recomputing it.

Second, it read the board file 700ms after the click. The round trip through IPC, the command bus,
schema validation, a snapshot and a disk write sometimes takes longer, so it read the old edge
count, reported a failure the app had not committed, and then skipped its own cleanup because the
count had not changed — leaving a stray trace in the real board file. It now polls for the change
and always undoes what it drew. A harness that runs against real data has to put it back.

## 2026-09-10 — Wiring must yield to the gestures that were already there

Reported: "i'm having trouble scaling nodes because of the wire creation ui, instead of scaling it
always tried to create a wire instead."

The resize handle sits in the selected node's bottom-right CORNER, which is exactly where the east
and south edges meet — and a port is hit-tested along the whole length of an edge. So every press
on the handle was also a press on two ports, and wiring, which runs first, took all of them. The
mouse path to resizing became unreachable the day wiring landed. Shift+arrows still worked, which
is why it was a frustration rather than a wall, and is also why nothing caught it.

Two changes, and the second is the one that matters more.

**The handle outranks wiring**, the way it already outranks the move gesture — it is drawn on top
of the node, so a press there is unambiguous. The dead zone is the handle PADDED by the port
tolerance, because an exact test means missing an eight-pixel target by two pixels starts a trace
instead: the same frustration, rarer and harder to explain. Nothing is lost, because ports live at
edge MIDPOINTS and a node's corner is not where you aim to wire it. Grabbing the handle mid-wire
abandons the wire and resizes in one gesture rather than two.

**The port band is lopsided.** It was symmetric, and the corner was only the sharpest instance of
a general problem: every world pixel the band reaches INSIDE a node is a pixel stolen from
selecting it, dragging it, and the handle. On a 2x2 node — 32 world pixels square — a symmetric
band gives a meaningful fraction of the face to wiring, and a press meant to move the node starts
a trace. So it now reaches 1.6x the tolerance outside and 0.45x inside. Outside is empty substrate
where the only competing gesture is panning, so reach there is free — and approaching an edge from
the outside is how you actually do it, which makes the dot easier to catch than before.

The smoke now selects a node, grabs its handle, drags, and reads the footprint back, asserting
both that the resize committed and that `window.__skynetWire` lit nothing on the handle. A unit
test can prove the geometry; only this proves the four gestures — pan, move, resize, wire — still
coexist on one canvas.

## 2026-09-10 — `existsSync` lies about Store apps, in a second place

William asked which user or group to grant access to so SkynetOS could open apps in his
WindowsApps folder. The answer is none, and the question was a symptom.

Measured on this machine, for `%LOCALAPPDATA%/Microsoft/WindowsApps/wt.exe`:

    existsSync        false     <- stat under the covers
    statSync          THROWS EACCES
    lstatSync         ok, size 93, isSymbolicLink
    accessSync(X_OK)  ok
    readdirSync       lists it
    spawn(path)       status 0

An App Execution Alias is a zero-length reparse point tagged APPEXECLINK. Nothing is being denied
— there is no file content to open, and only `CreateProcess` knows how to follow one. No ACL
change can affect any of the above, which is why granting a user Full Control over
`C:\Program Files\WindowsApps` does nothing except weaken a folder Windows protects for servicing.
(He had already granted it. That ACE is not a default.)

`services/which.ts` was written for exactly this rock, from the other direction — "is Windows
Terminal installed" answered `false` on a machine where it was, and the whole launch path fell over
behind it. What that fix missed was the mirror image: `services/target-resolver.ts` asks "is the
thing this node points at real", and asked it with `existsSync`. So a `file.exe` node pointed at
Notepad, Paint, Terminal or PowerShell rendered as TARGET NOT FOUND — a broken footprint for a
program that launches perfectly, and a symptom that reads exactly like a permissions problem.

`pathExists` and `pathInfo` now live in which.ts alongside `which`, because that file already owns
the truth about Windows executables and splitting it would guarantee a third instance. `pathInfo`
falls back to `lstat` when `stat` throws and flags the result `alias: true` — detected by the only
signature that is actually specific, stat failing where lstat succeeds. An ordinary symlink
resolves under stat to the file it points at, so it never lands there; a dangling one fails both.

Size and mtime are reported as **0** for an alias rather than the reparse buffer's 93 bytes. The
launch dialog says "Windows app ·" where it used to say a size: 93 bytes is not the size of
Notepad, and "0 KB" beside a Launch button reads as a corrupt file.

`test/windows-aliases.test.ts` asserts the PREMISE first — that `existsSync` still returns false
for a real alias on this machine. Without that, the rest of the file would quietly pass on a
machine where aliases behaved differently, and the fix could be reverted with nothing noticing.

**Not done:** 31 of the installed packages are reachable by alias and cover everything worth
putting on a board (Paint, Notepad, Terminal, PowerShell, Teams, Outlook, Files, Store, Snipping
Tool, Python, winget). The rest — Calculator, Photos, Clock among the user-facing ones — have no
alias at all and can only be launched as `shell:AppsFolder\<PackageFamilyName>!<AppId>` via
explorer. That needs a target kind, a resolver branch and a picker, so it is offered rather than
assumed.

## 2026-09-10 — "Broken" means it does not resolve, and admin is a per-node opt-in

William: "Still not working - I need to be able to link any exe anywhere on my drive and the
program can try to launch it as admin; if I need to change the advanced security settings of the
file to get this to work please provide me detailed instructions."

No security settings needed changing. Three unrelated things were being read as one problem.

**1. Some paths were simply wrong.** `C:/Program Files/Anki/anki.exe` (Anki is not installed),
`C:/dev/TruthQuestRetro/build/Release/TruthQuestRetro.exe` (not built), and
`C:/Program Files (x86)/Minecraft Launcher/MinecraftLauncher.exe` — which is on this machine at
`C:/XboxGames/Minecraft Launcher/Content/Minecraft.exe`. Those rendered broken because they ARE
broken, which is prime directive 1 working. The Minecraft path is now the real one.

**2. `outside-dev-root` was being rendered as a fault.** This was the actual bug. A node pointing
at `C:/Program Files/…/WINWORD.EXE` resolves, launches, and worked the whole time — but drew the
broken-hardware overlay, went fault-red on the minimap, and marked its own input field bad.

The cause is the shape this codebase keeps getting bitten by: one rule written down twice. Every
BEHAVIOURAL call site wrote the exception by hand — `isBroken(t) && t.state !== 'outside-dev-root'`,
four times across three files — and the three RENDERING sites did not. So `isBroken` now means what
it says (the target does not resolve), `needsConfirmation` carries the policy half, and every hand-
written exception collapsed away. docs/07 is unchanged: outside a dev root is still confirmed on
every activation. It was always a statement about ACTIVATION, never about resolution.

**3. There was no way to launch anything elevated.** `file.exe` nodes now take `elevated: true`,
surfaced as "Run as administrator" in the editor. It goes through `Start-Process -Verb RunAs`
because a process cannot raise its own privileges and cannot hand them to a child — elevation is
brokered by the Application Information service, and there is no `spawn` option for it. SkynetOS
therefore stays non-elevated and asks Windows for an elevated CHILD, which is docs/07's position
and costs a UAC prompt every launch. That is not avoidable for an app that is not itself elevated,
and the alternative — a board editor running as administrator all day — is worse.

Elevated launches are confirmed EVERY time regardless of `confirmBeforeLaunch`, because "do you
want to run this at all" and "do you want to run this as administrator" are different questions.

The command builder lives in `launch-script.ts` beside the other pure argv builders so it can be
read without spawning anything. Its test strips every single-quoted region and asserts that what
remains — the actual PowerShell code — contains exactly one statement and none of the caller's
characters. Verified by swapping in a naive quoter and watching it fail. Counting occurrences of
"Start-Process" would have been the wrong test: an injected one appears in the command string
precisely because it is safely inside the quoted path.

## 2026-09-10 — The atlas never reached the GPU

Reported: "i tried loading one of the visual parts in and its an empty box - nothing rendered."

Not one baked sprite had ever appeared. Every via, screw, LED, grille, fiducial and pad array on
every board had been invisible since the atlas landed, and nothing anywhere said so.

    this.atlasSource = new TextureSource({ resource: image, scaleMode: 'nearest' });

Pixi v8 picks its GPU uploader from `source.uploadMethodId`. `ImageSource` sets it to `'image'`;
the base `TextureSource` leaves it `'unknown'`, and an unknown source is never uploaded. So the
texture was entirely valid on the JS side — right dimensions, right frame rectangle,
`visible: true`, `alpha: 1`, positioned exactly where it belonged — with no pixels on the GPU.

That is why it took so long to find. Every signal the app had reported health:

    sprites.has('decor.via')   true
    texture.width              16
    frameCountFor              1
    HUD                        ATLAS 26 · 20 PLACEHOLDER

and the atlas PNG itself was provably fine — a pixel census of all 26 cells showed every one
populated, `decor.fiducial#0` with 48 silk pixels, `decor.via#0` with 72 copper. The JSON loaded,
the image decoded, the frames were correct, the sprites were placed. The one thing nobody had
checked was whether the source could be UPLOADED, because nothing in the API suggests that
constructing a texture source can succeed at being useless.

Proven by cropping the same 90x90 region of the same board before and after: bare substrate, then
a 3x3 copper pad array.

Two guards, because a unit test cannot see a GPU:

- **Runtime.** `load()` now reads `uploadMethodId` and refuses a source it cannot upload, with a
  reason naming the fix. Loading the JSON and getting the image onto the GPU are two different
  successes, and only the first was ever reported.
- **Structural.** `test/render-invariants.test.ts` requires `new ImageSource(` and forbids
  `new TextureSource(`. As a TYPE the base class is correct — the field is declared
  `TextureSource | null`. As a constructor it is the bug.

### And a stale test came out with it

`test/labels.test.ts` asserted, against the live board files, that every node's full name fits on
its FACE. Names have not been drawn on faces for a long time — they go on a nameplate above the
package, on one line, never wrapped, precisely because a wrapped name on a 4-tile package was
unreadable. `layoutLabel` had exactly one caller left: that test.

It failed the moment a node was named "launcher.exe" on a 4x4 footprint, blocking the build over a
label nobody would ever see. The test is gone and `layoutLabel` is marked superseded. A test that
asserts on board data is a test that breaks when William edits his board, and the board is his.

## 2026-09-10 — A document is bound by a path OR a URL

William: "make the document node compatible with https word doc file directories; many of my word
docs are hosted in onedrive so instead of a hard drive directory they have an https address."

`file.document` required `path`. A document that only exists behind a OneDrive or SharePoint URL
therefore could not be represented at all — the alternatives were a second node kind for the same
thing, or a node that renders broken forever.

**`requiredOneOf`.** A new field-spec marker: these fields satisfy "required" between them. The
schema says the same thing with `anyOf: [{required:[path]},{required:[url]}]`. Both halves matter
and they have to agree — if the form is stricter the user cannot save a valid node, and if the
schema is stricter the command bus rejects what the form accepted. That exact disagreement shipped
once already (the provisional-node fix, earlier today), so `test/node-fields.test.ts` now pins the
one-of groups against the schema the same way it pins plain `required`.

**`primaryTargetField` takes the node, not just the kind.** Which field binds a document depends on
which one is FILLED IN. Without the node it was a guess, and the guess decided whether the node
resolved against the filesystem or against a URL — so a OneDrive document would have been looked
for on disk and drawn as broken. A node with both filled in prefers the path: a local file opens
instantly in the desktop app and works offline.

**`openWith: 'office'`** hands an online document to desktop Word/Excel/PowerPoint through the
`ms-word:ofe|u|<url>` family instead of a browser tab. Opt-in, not default, because it only works
on a DIRECT document URL. A share link — `1drv.ms/w/s!Ab3…`, or a `/:w:/g/personal/…` URL — is a
redirect, and Office cannot follow one: it shows a "document not found" dialog and does not fall
back. So `officeUri` returns null for anything it cannot read from the URL's path, and the caller
opens the browser and says why. A refusal the user cannot act on is worse than no feature.

Two traps in reading that extension, both closed in `urlExtension`:

- **The query string.** SharePoint appends `?d=w4f2…&csf=1&web=1` to nearly every link it
  generates, and "text after the last dot" reads `1` out of `web=1`.
- **Windows paths parse as URLs.** `new URL('C:/Users/w/Novel.docx')` does not throw — the WHATWG
  parser reads `c:` as a scheme and returns a pathname of `/Users/w/Novel.docx`, so a local file
  confidently reports `docx`. The scheme check belongs in the helper, not in each caller.

`directoryForNode` returns null for a URL-bound document. `dirname` on one returns
`https:/contoso-my.sharepoint.com/personal/w/Documents`, which is not a path and would have been
handed to a terminal as a working directory.

**Worth saying plainly, and said to William:** his OneDrive syncs locally to
`C:/Users/wills/OneDrive` and those .docx files are real files on disk, not Files-On-Demand
placeholders (checked: no Offline or Recall attribute). For his own documents the local path is the
better binding — desktop Word, offline, and the board can watch the file for changes. The URL form
is for documents shared with him, or ones he has not synced.

## 2026-09-10 — Aesthetic parts render BELOW the nodes (reversing the entry above)

William: "i want shapes and aesthetic elements to render as a layer below the nodes - forget them
rendering on top of the robots - i want them to render below nodes."

This reverses the 2026-09-10 entry that put `decor.part` above the components. That entry stands as
written — this log is append-only — but it is superseded, and the new order is the more defensible
one anyway:

    backdrops -> copper -> zones -> PARTS -> couriers -> components -> notes -> grid -> overlays

A via, a screw, a pad array and a grille are features OF the board, not objects mounted on it. A
chip soldered over a pad array hides the pads, because that is exactly what a chip does to the pads
underneath it. The first version had them as furniture screwed through the board and therefore on
top of everything, which is a coherent reading and simply not the one William wants to look at.

Parts stay ABOVE the traces and zones, so a via still reads as sitting on the copper rather than
under it. Couriers now pass over them rather than under, which is the explicit "forget them
rendering on top of the robots".

**Guarded this time.** There is no z-index anywhere in BoardCanvas — what is in front of what is
decided entirely by the order of the `world.addChild(...)` calls. That makes it a rule a unit test
cannot express and a careless edit can reverse silently, and it has now been changed twice. So
`test/render-invariants.test.ts` reads those call sites and pins the relationships that matter:
parts under nodes, couriers over parts, parts over copper, couriers under the node they are
delivering to, overlays last. Verified by putting the old order back and watching two of them fail.

## 2026-09-10 — A .lnk is not an executable, and two dialogs were one too many

Reported: "exe nodes show a message but don't launch a game - I want to remove the confirmation
messages as much as possible too."

**The launch.** `file.exe` launched with `spawn`, and the node pointed at
`assets/Shortcuts/minecraft.lnk`. Measured here:

    spawn("thing.lnk")  ->  EFTYPE
    spawn("thing.bat")  ->  EINVAL

A `.lnk` is a shell object, not an executable image; `CreateProcess` has no idea what to do with
one. The node editor's own file filter offers `exe, bat, cmd, ps1`, so three of the four types it
invites you to pick could never have launched — the dialog appeared, the user said yes, and nothing
happened, which is the worst possible shape for a failure.

Resolving the shortcut ourselves would not have been enough. Its target is
`C:/Program Files/WindowsApps/Microsoft.4297127D64EC6_2.6.2.0_x64__8wekyb3d8bbwe/Minecraft.exe` —
an MSIX payload that needs package identity to run, which comes from the shell and not from
`CreateProcess`. It would have failed a second time for a second reason. **This is also the real
answer to the WindowsApps permissions question from earlier today**: the shortcut pointed into that
folder, the launch failed, and the failure read as an access problem. It never was one.

So: `spawn` for `.exe`/`.com`, where it buys arguments, a working directory and a pid; ShellExecute
(`shell.openPath`) for everything else, and as a fallback when spawn refuses. Handing the `.lnk` to
the shell is exactly what double-clicking it in Explorer does. Proven end to end in the smoke with a
harmless shortcut to `cmd /c` — deliberately not the user's game, because a capture run must not
open one on somebody's desktop.

**The dialogs.** Opening a program outside a dev root raised two in a row, for one click, about one
file, both answered by the same person for the same reason. They are now one, carrying everything
both carried. And `confirmBeforeLaunch: false` now means what it says: it used to be ANDed with an
unconditional "ask once per binary per run", so turning confirmation off still produced a dialog.

The part that needed care: board JSON is agent-writable and `node:open` is in `AGENT_METHODS`, so a
flag that silences a prompt for everyone is an escalation — an agent could point a node anywhere,
clear the flag, activate it, and run a program with nothing on screen. `openTarget` now takes an
ACTOR. Suppression is honoured for `'user'` and ignored for `'agent'`, the same split `node:add`
already uses for attribution. Elevation is confirmed regardless of both.

Rejected: a per-node `trusted` field, for the same reason — anything in board JSON is writable by
the thing it would be protecting against. Rejected: dropping the out-of-root prompt entirely; the
sanctioned way to stop being asked about a whole location is `devRoots` in settings.json, which no
agent can write, and the dialog now says so.

## 2026-09-10 — Aesthetic assets rotate, in quarter turns only

William: "aesthetic tiles / visual assets need to be able to be rotated."

Quarter turns and nothing between. An arbitrary angle resamples every pixel, and docs/02
§Anti-mush treats one soft pixel as a crash-severity bug. A quarter turn is a pure permutation —
every output pixel IS some input pixel, byte for byte — so it is exact. It is also what board
furniture actually wants: an elbow, a tee, a ribbon and a grille all have an orientation and no
use for any angle in between.

**Not `sprite.rotation`.** The obvious implementation is a transform, and it is wrong.
`Math.PI / 2` is off by about 6e-17, so the matrix is not quite a right angle, every pixel lands
fractionally off its grid, and the renderer resamples the lot. Instead:

- **Tiles** (`decor.part`) turn through the atlas texture's own `rotate` field — the one texture
  packers use to store a sprite sideways. Pixi applies it in UV space as a permutation of the four
  corners: no matrix, no resampling. `groupD8`'s even values are the quarter turns.
- **Backdrops** (`decor.image`) are baked turned by the mosaic service, which already owns the
  pixels. Rotation happens AFTER the dither, because the dither is an ordered pattern locked to the
  pixel grid and turning the source first would turn the grid with it. At 90 and 270 the axes swap,
  so the source is rendered at the swapped box and turned back — otherwise a 12x8 backdrop rotated
  a quarter would be an 8x12 picture in a 12x8 hole, and the board would letterbox it.

Two things that would have been silent bugs, both the shape of ones already paid for here:

- The animated-part ticker re-fetches a texture every pulse. Without the rotation travelling in the
  `animated` entry, an angled LED would snap upright twelve times a second — the frame flicker
  again, one value assembled in two places.
- The renderer's mosaic cache is keyed on source and footprint. Without rotation in the key,
  turning a backdrop would leave the old mosaic in place and nothing would happen — the pulse-glow
  checkbox that did nothing, again.

The control is four buttons rather than a dropdown: the value has exactly four states, the arrow on
each points where the asset will face, and it is a thing you reach for repeatedly while dressing a
board.

Verified on the GPU, not just in unit tests, because this project has already shipped a texture
that was valid in every JS property and invisible on screen. Four copies of one asymmetric part,
one per turn, rendered and cropped out of the capture: Γ L J ¬, each a clean quarter turn of the
next, with the diagonal step pattern crisp in all four.

The smoke now also prints the camera its first capture was taken at. Cropping a screenshot to
inspect one component otherwise means reimplementing `contentBounds` outside the renderer and
getting it wrong every time the board changes shape.

## 2026-09-10 — `detached: true` is why "run as administrator" did nothing

Reported: "trying to launch a program still does nothing - it shows a message but nothing happens."

The `.lnk` fix earlier today was real and works. This was a second, independent bug sitting behind
it, and it only showed up once William ticked **Run as administrator** on his nodes.

The elevated path spawned `powershell.exe` with `detached: true, stdio: 'ignore'`. Measured from
inside Electron main, with a command that writes a marker file:

    detached: true,  stdio: 'ignore'   ->  nothing
    detached: true,  stdio: 'pipe'     ->  nothing
    detached: false, stdio: 'pipe'     ->  WORKS
    detached: false, stdio: 'ignore'   ->  WORKS

`detached` is the whole difference. On Windows it sets DETACHED_PROCESS: the child gets no console,
and Electron main — a GUI-subsystem process — has none of its own to inherit. A console application
started that way does not run. `stdio: 'ignore'` then guaranteed nobody would ever find out, which
is why the dialog appeared and the silence that followed looked like the program's fault.

This is the same rock the launch path hit in the very first session ("Electron main has no console,
so spawning a console app from it detached opened no window at all"), approached from a different
direction. The conclusion drawn then — route through `cmd /c start` — does **not** work either:
measured here, `cmd /c start powershell.exe` detached also produced nothing. The rule that actually
holds is about the child, not the route:

> Detach a GUI launcher that must outlive us. Never detach a console helper that must simply run.

`wt.exe` is the first kind: it makes its own window and has to survive the app closing. The elevated
PowerShell is the second: a courier that asks the Application Information service to start the
program and exits. It does not need to outlive us — the elevated program is a child of that service,
not of ours — and it cannot run detached. `services/terminal.ts` now decides per launcher;
`shell-opener.ts` never detaches.

**And it waits now.** UAC is modal, so PowerShell does not return until the user has answered, and
its exit code and stderr carry the outcome: consent refused, or a program Windows will not elevate
at all — a packaged Store app, for instance, which cannot run as administrator by design. Reporting
"asked Windows to launch it" and walking away turned every one of those into silence. There is a
two-minute cap for a prompt left sitting on screen, because blocking a click forever is worse than
an optimistic message.

Guarded twice: `test/launch-script.test.ts` pins the flags and the GUI-vs-console rule, and the
smoke asserts the PREMISE from inside main — attached runs, detached does not. If Windows ever
changes that, the smoke says so rather than leaving a `detached: false` with nothing to justify it.

## 2026-09-10 — `%SKYNET%`, so the repo really is the save file

William: "I am going to install skynet OS on my desktop, can you prepare it so that I can simply
run it on that device and use it the same? the repo will serve as the save between."

It would not have worked. Twenty-six paths across the five boards pointed at files INSIDE this
repo, written absolutely as `C:/dev/SkynetOS/assets/sprites/...`. Clone it to a different folder,
or onto a machine with a different username, and every wallpaper, every logo and the JARVIS persona
resolves as missing — for files sitting right there in the checkout.

`%SKYNET%` expands to the repo root (the resources folder in an install), so
`%SKYNET%/assets/sprites/jarvis-sprite.png` is the same picture wherever the clone lands. It reuses
the `%VAR%` grammar the board format already had rather than inventing a second syntax, and it is
resolved in `expandPath` — the one function every path in the program passes through.

`tools/portable-paths.mjs` rewrites what can be rewritten and, importantly, refuses to touch what
cannot. `C:/dev/TheStalker` is a true statement about one machine; there is no token that makes it
true elsewhere, and rewriting it would turn "a repo you have not cloned yet" into "something that
does not exist and never will". Those 36 are listed instead, so the new machine has a checklist.

`paths:check` runs inside `npm run verify`, because the editor's file picker returns ABSOLUTE
paths — pick a wallpaper from `assets/sprites/` and the board goes straight back to
`C:/dev/SkynetOS/...`. Without the check, portability would decay silently one edit at a time.

Also shipped: `assets/sprites` and `codex` in `extraResources`, so an installed build has the
pictures and personas `%SKYNET%` now points at; and `engines.node >= 22.5.0`, because `node:sqlite`
is built in from that version and simply absent before it — on an older runtime the session
database does not open at all.

Relinking needed no work, which is worth recording: nothing is cached, a node resolves its target
at render time every time, so creating the missing folder makes the node work on the next redraw.
That is why "if links break I can simply add the missing folders or exe's and it will relink" was
already true.

Verified by expanding all 26 against the real filesystem from inside the running app: 26/26.

## 2026-09-10 — Relinking needed a nudge after all

A claim I wrote in docs/10 and then checked: "it relinks on the next redraw, no restart."

Half true, and the wrong half. Resolution genuinely is never cached — `resolveNodeTarget` asks the
filesystem every time — so a redraw always sees the truth. What was missing is anything to PROMPT
the redraw. Targets are re-resolved on a `files:changed` event from the watchers, and a directory
that does not exist cannot be watched. The one case that needed it was the one case that never
fired: create the missing folder and the board sat there insisting it was still missing until you
pressed `R`.

So the board now re-resolves every five seconds while ANY node on it is broken, and stops the
moment the last fault clears. A healthy board costs nothing; a broken one costs a handful of
`stat` calls. That makes "add the missing folder and it relinks" true rather than nearly true,
which matters most on exactly the machine this was all for — a fresh clone where a dozen things
are missing until they are cloned or installed one at a time.

## 2026-09-11 — The Face reads the repo through FACE-BOOT.md

The Face tested its own reach and reported it. Google Drive through its connector is search-only:
no content read, no write. GitHub works, with two limits: it fetches only a URL that William
pasted or that appeared in an earlier fetch result, and GitHub robots-blocks `tree/` pages. From a
cold start its whole reachable set is the repo root page and one hop beyond it.

So `FACE-BOOT.md` lives at the repo root, generated by `npm run face:bake` and never authored: the
codex index verbatim, unread `to-face/` mail inlined newest first, board truth, the Hands' state
compressed from `handoff.md`, and the MCP tool names. The board truth goes through
`target-resolver.ts`, the same resolver that draws broken hardware, so "broken in FACE-BOOT" and
"broken on the board" cannot drift apart. It names the machine it was resolved on, because the two
desktops disagree.

Rejected: linking to mail files instead of inlining them (the Face cannot construct the URLs);
the GitHub contents API as an entry point (same reason); a post-commit hook, which the Face asked
for. A post-commit bake modifies the file after the commit, so every pushed copy is one commit
stale and the working tree is never clean. The hook is **pre-commit**, bakes in about 0.4s, stages
the result, and never fails a commit. `sameBake` ignores the timestamp, so a commit that changes
nothing the Face can see does not churn the file.

To run the TypeScript resolver outside Electron, `settings.ts` now reads `%APPDATA%/SkynetOS`
directly when `app` is absent, and never creates the file from there. `target-resolver.ts` derives
its board root from `skynetRoot()` so it degrades the same way. `vite-node` runs the bake, and is
now a direct devDependency rather than something vitest happens to install. Installing it needed
`npm_config_allow_scripts` cleared from the environment: the Claude Code shell sets it, and npm 12
refuses that flag in a project-scoped install.

## 2026-09-11 — Standing orders: `standing:` mail writes codex/face-brief.md

The Face: "mail is a queue and a plan is a state." It wanted a place to say something to every
future Hands session, not only the next one to open before a message is archived. It proposed
`codex/face-brief.md`, owned by the Face, overwritten whole, never appended to, never edited by
the Hands, and injected into the briefing above the mail.

The Face cannot write to the disk, so its proposal had no write path. The chosen one: a message
with `standing: true` makes SkynetOS write the body over the file on the next ten-second sweep,
then archive the message. The current orders live in the file and the history in `archive/`.

- **Injection point:** between the chip briefing and the mail, inlined whole, labelled as standing
  rather than new, with an absolute path. Only the node `pickHandsNode` picks gets it. That is
  the same search `run:` dispatch uses, now shared from `packages/shared/face-brief.ts`, so "the
  Hands" means one thing in both places.
- **Write, then archive**: the reverse of `run:`. A repeated launch does harm, a repeated identical
  write does not, so the order that loses nothing on a crash is the opposite one.
- **Not gated on `autoRunMail`**, because it launches nothing. A `standing:` message is never also
  treated as `run:`.
- Rejected: letting the Hands write the file on the Face's behalf, since a file the Hands can edit
  is not one the Face owns; and a panel checkbox, since the Face should be able to dictate the
  whole message itself.

## 2026-09-11 — The panel lifts a pasted header instead of burying it

The Face writes whole messages, header and all, and the README told William to paste them
verbatim. The panel then wrapped that text in a second header, so the Face's `run:` landed in the
body, which by design is ignored. **A `run:` message could never have arrived through the panel.**
`sendMail` now lifts a header at the very top of the body: its `subject:` fills an empty subject,
and `run:`/`standing:` are kept on post to the Hands. That grants nothing new, since anything that
can call `sendMail` could already drop a flagged file into `to-hands/`.

At the same time: the MCP `mailbox_send` never passed `from`, so agent mail was signed `undefined`.
Its side names (`to-head`) reached the right directory only by falling through, with `to: to-head`
written into the header. `normaliseSide` now accepts every spelling, and refuses the rest.

## 2026-09-11 — face-brief follows the Face's protocol, v1

The Face specified the brief's shape: a header (`protocol`, `version`, `written-by`, `written-at`,
`supersedes`) and five sections (CURRENT OBJECTIVE, STATE OF PLAY, THE NEXT ACTION, CONSTRAINTS,
OPEN QUESTIONS FOR PRIME). The sections are the Face's to write. SkynetOS writes the header,
because every field in it is a fact about delivery. The Face's own message said `sent: ...T00:00:00`,
a guess, and it cannot know the `written-at` of the brief it is replacing at the moment it writes.
So `written-at` is the time the message actually landed, `supersedes` is read from the file being
replaced, and a header at the top of the Face's body is dropped rather than left to contradict
them. `updated:` from a pre-protocol file is still read, so a brief written by an older build of
the app chains correctly.

FACE-BOOT gained section 5, "Standing orders in force". It comes after the four the Face
numbered, so their numbering holds. Without it, the Face owns a file it has no way to see.

## 2026-09-11 — Zoom goes below 2x: 1x, and 1/2 and 1/4 for overview

William: "I can't zoom out enough … I want to be able to see the whole board from far away."

The floor was 2x ("the board is unreadable below 2x"). Readability was never the question for an
overview, and tripling the boards made the floor a wall: a 192x120 board is 3072x1920 art pixels,
so at 2x a 1920-wide window shows under a third of it. The levels are now 1/4, 1/2, 1, 2, 3, 4.
The wheel steps through all six, `-`/`=` do the same without a wheel, `1` joins `2`/`3`/`4`, and `0`
picks the closest level at which the whole board fits. On a 1920x1080 window that is 1/2 for the
root board.

This bends docs/02 rule 4, so the objection goes on the record once. Below 1x, nearest-neighbour
drops pixels: a one-pixel trace can vanish and silkscreen becomes illegible. What it does NOT do is
mush. Every screen pixel is still an exact palette colour, alpha is still binary, and with a
power-of-two scale and a whole-pixel stage each screen pixel samples the same texels in every
frame, so a pan does not crawl. `test/camera.test.ts` proves that phase property for random camera
positions rather than asserting it.

Rejected:
- **Arbitrary "fit exactly" fractions** (0.62x and so on). They sample on a phase that changes as
  the camera moves: the shimmer rule 4 exists to forbid.
- **Mipmapped or linear downscaling for the overview.** It is smooth and it is mush.
- **Leaving it to the minimap**, which already shows the whole board. It is 240 art pixels wide on
  purpose and cannot be worked in.

Not verified visually: the unit tests prove the arithmetic, not what 1/4x looks like on the real
board. The 0%-tolerance golden-image test covers 2x/3x/4x only.

## 2026-09-11 — Dialogs belong to the board window; Browse stores portable paths

Reported: "the browse button is also not working … I can't select images … perhaps even
directories".

Every dialog in main found its parent with `BrowserWindow.getAllWindows()[0]`. Electron lists
windows NEWEST first. Checked against the installed Electron 44 with a scratch script: main alone
gives [MAIN], and main plus a second window gives [CHAT, MAIN]. So once the Face's conversation
window had been opened, the file picker, both launch confirmations and the delete confirmation
were modal to the claude.ai window, and drag-out and `display:info` used it too. Browse then did
nothing visible on the board. `services/main-window.ts` now holds the board window by reference,
set in `createWindow`. `test/window-parent.test.ts` fails the build if `getAllWindows()[n]`
reappears in main.

Found alongside it: a picked path was stored absolute, so browsing to a sprite in `assets/` wrote
`C:/dev/SkynetOS/...` and `npm run paths:check` went red. That is what happened to the two
backdrops added today. `portableSpelling` in `pickers.ts` stores `%SKYNET%/...` and
`%USERPROFILE%/...` instead, the same rewrite `tools/portable-paths.mjs` makes, and the two
existing paths were rewritten with it. The dialog's starting folder is also handed over with
Windows separators now. That one is a precaution, not a diagnosed cause.

Not verified on screen: the diagnosis is proven by the script, and the fix only by unit tests and
typecheck. It needs a restart of SkynetOS to take effect.

## 2026-09-11 — Group selection: Shift+drag a box, drag any member to move them all

William: "add the ability to drag-window / group select nodes collectively within an area and move
them together / simultaneously."

In Edit Board mode, **Shift+drag on empty substrate** draws a selection box, and **Shift+click**
adds a node to the group or takes it out. Pressing on any member of a group of two or more moves
the whole group rigidly, a whole tile at a time, with every sprite following and a ghost at each
landing spot, red if any member cannot land. The drop is ONE command, `node.moveMany`, so one
Ctrl+Z puts the whole group back. Escape clears the group.

- **Shift, not a plain drag, for the box.** A plain drag on the substrate already pans in Edit Board
  mode and is in William's hands. Taking it over would trade a new gesture for a broken old one.
- **Components are caught by touching the box; printed things only when wholly inside it.** A
  backdrop is usually as big as a room and sits under everything. If touching counted, every box
  would pick it up, and the next drag would haul the scenery along with the chips.
- **Members are not obstacles to each other.** They move together, so a member sliding into the
  tile its neighbour just left is what moving a cluster looks like. Everything outside the group
  still is an obstacle, by the same `canDrop` a single node uses.
- **The group lives in the canvas, not the store.** Nothing outside the canvas acts on a group
  (the inspector edits one node, so a group closes it), and it has to survive the scene rebuild
  that follows the move.
- **Escape is caught in the capture phase.** App's Escape leaves the room when nothing is
  selected, and a group has no single selected node. Without this, the first Escape after drawing
  a box would have thrown William out of the room he was arranging.
- `node.moveMany` is all-or-nothing: every id is checked before anything moves, and the result is
  validated once, so a group that would land one member on a chip is refused as a group.

Not added: keyboard nudging of a group, and group delete (delete needs per-node approval under
docs/07, and a group delete is exactly the kind of thing that rule is for).

## 2026-09-11 — Couriers walk the traces; traffic follows the files Claude touched

William: "the bots don't follow the wires; their base paths should be along drawn or generated
wires, so the wires are the paths basically. … the bot movement should be proportional and updating
based on which repos or files claude has worked within."

**Roads.** A courier used to cut an L from the JARVIS head straight to its destination, across
components and bare substrate, so the traces were decoration and the robots ignored them. Now
`courier-paths.ts` builds each route from the polylines the router actually drew, using Dijkstra
over the trace graph with each trace an undirected road weighted by its length. Where the road
passes from one trace to the next, it bridges across the chip in between with an elbow. Couriers
are drawn under the components, so a packet on a two-hop route visibly passes through the middle
chip. Where no wire joins the hub to a destination, the same A* that lays the copper generates a
road on the spot. Only a board with no wiring at all falls back to the old L from the nearest edge.
The hub is the JARVIS head. In a room, which has none, it is the best-connected node. Journeys
take five to ten seconds whatever the distance, and the wobble is down from five pixels to two, so
the column stays on the wire.

**Proportion.** Attribution used to be by Claude project directory, which credits the directory a
session was STARTED in. A session in C:/dev spending an hour in C:/dev/SkynetOS/src sent every
token to "C:/dev" and none to the SkynetOS repo node. The transcript says where the work happened:
each Read, Edit, Write, Grep and Glob names its path on the same line that carries the usage. So
attribution is now per message (`attributeActivity`):
- an agent claims the conversations started in its cwd;
- a repo or folder claims those, plus any message that touched a path inside it;
- a document or program claims messages that touched that exact file;
- a room claims everything its children claim;
- a message is split evenly between its claimants and never counted twice.

Shares across a board therefore still sum to at most 1. Unclaimed activity still counts toward the
total, so a quiet board looks quiet.

Rejected: parsing paths out of Bash command lines, which would credit folders that were merely
mentioned; and counting a message once per claimant, which is the double-counting the old code
existed to prevent.

Not verified in the running app: the arithmetic is tested (`test/activity.test.ts`,
`test/courier-paths.test.ts`). The main-process scan and the on-screen walk need a restart to be
seen.

## 2026-09-11 — The PSU is a real system monitor

William: "speccy is an excellent example … a simplified temp bar that gradients color based on
expected vs actual temp values … this is a literal system monitor". Activating a `monitor.system`
node now opens a Speccy-style panel. Every number in it is read non-elevated from this machine:

- `os.cpus()` for per-thread load.
- `% Processor Performance` × base clock for effective clock, the way Task Manager derives
  "Speed".
- CIM for the inventory, the drives and the ACPI zone.
- `nvidia-smi` for the GPU.
- LibreHardwareMonitor's WMI namespace whenever it is running.

Probed on William-Desktop, Windows gives a non-elevated process no CPU die temperature, fan speed
or drive temperature: `MSAcpi_ThermalZoneTemperature` and `Get-StorageReliabilityCounter` both
refuse access. So those appear under NOT READABLE with the reason and the fix, never as a stand-in
number. The one readable ACPI zone (27.9 °C) is labelled as a motherboard sensor, because showing
it as a CPU temperature would be the most misleading number on the board.

The "gradient" is a stepped bar: each cell's outline shows the band it stands for, and the fill
shows the reading. docs/02 forbids smooth gradients, and this puts expected and actual on one line.
GPU temperature is judged against the driver's own margin to slowdown
(`temperature.gpu.tlimit`), not a rule of thumb.

Cost is bounded:
- The parts list is read once.
- Sensors refresh at most every 3 s and the GPU every 2 s, and only while someone asks.
- Only the first request waits.
- Measured: CIM inventory 1.4 s, sensors 1.1 s, `nvidia-smi` 0.06 s, a PowerShell spawn 0.2 s.

Rejected:
- A persistent PowerShell child, which would need lifecycle hooks in `index.ts` to be worth it.
- Labelling P-cores and E-cores by their clocks, which is inference.
- Admin-only sources.

Agents get the same data through `system_info` / `hardware:snapshot`, which docs/07 allows as a
telemetry read. The panel itself opens only when the user activates the node.

## 2026-09-11 — The monitor node is the monitor

William: "when double clicked the data appears to populate, however I want the actual node to be a
monitor / show live update data like a widget." Every `monitor.system` node now paints the
machine's readings onto its own face, refreshed every two seconds. The double-click panel stays
as the full readout.

The widget fills the footprint in priority order and leaves out whatever doesn't fit whole:
- bar rows: CPU load, GPU temperature, RAM, GPU load, VRAM;
- one column per thread;
- text lines: CPU clock, CPU die, board, GPU clock, GPU power.

A 4x4 node shows the first three rows; a 6x10 node shows almost all of it. Thresholds come from
`packages/shared/hardware.ts` and are not restated. Unreadable values are dashes: the CPU die in
particular is a dash unless LibreHardwareMonitor provides a real CPU sensor, because the readable
ACPI zone is the motherboard's. Six colours, the board's silkscreen, integer coordinates. An unlit
bar cell keeps a one-pixel tick in its level colour, so expected and actual still share a line at
two pixels of height.

The widget costs almost nothing when idle:
- It polls only while the board has a monitor node and the window is visible.
- It repaints only when the layout comes out different.
- Each widget holds one texture rather than one per refresh. The sprite cache is keyed on the face
  and never evicts, which is fine for faces that change on edit and wrong for one that changes
  every two seconds: about 1,800 textures an hour per monitor. A live face now carries a slot tag,
  and the texture it replaces is destroyed (`live-slots.ts`, `sprites.ts`).

Rejected:
- Drawing the widget as a separate overlay layer, which would need a second hit-test and a second
  placement path for one kind of node.
- Stretching a stale widget across a resize, which is fractional scaling for up to two seconds.

## 2026-09-11 — Wires: black outlines, parallel lanes, selectable and restylable

William: "I also want wires to be selectable / color and stroke editable - make sure the software
detects overlapping wires and I want it to create the appearance both wires are run parallel - all
wires, even drawn ones should have a black stroke for visual clarity."

- **Outline.** Every wire now carries a one-pixel outline, `ink` (#000000) by default. Ink is a
  wire-only token (`WIRE_TOKENS` = the palette tokens plus ink). It is deliberately NOT in
  skynet.gpl: it is never baked into a sprite, and adding it to the palette file would let the
  bake's recolouring start snapping dark art pixels to pure black. The darkest real palette entry
  is each room's mask-dark, which is the substrate itself, so an outline in it would vanish
  exactly where it is needed.
- **One wire at a time.** `buildTraceLayer` finishes each wire (outline, run, strand, vias) before
  starting the next. Drawn layer by layer across the board, as before, two crossing wires fused
  into one blob; drawn wire by wire, the later one crosses over the earlier with its black edge
  showing.
- **Lanes.** `separateParallel` finds segments that lie on the same line with overlapping spans,
  and gives each wire in such a run its own lane: symmetric about the line, spaced by the widest
  run plus both outlines plus a pixel, in board order so the layout is stable. Only a whole
  segment moves, across its own axis, so every corner still joins a horizontal to a vertical and
  nothing can go diagonal. Touching end to end and crossing are not sharing. The couriers and the
  click target both use the laned geometry, so what you see is what you hit.
- **Selection.** A click on a wire selects it, unless a component is in the way. Printed things
  like a backdrop do not count as in the way, or no wire across a backdrop could ever be picked in
  Edit Board mode. The selected wire is redrawn on the overlay with a signal-coloured halo.
  `EdgeInspector` edits its kind, run colour, outline colour, width (now 1–4) and relation, each
  as an undoable `edge.update`, and deletes it through the native confirmation every deletion
  goes through. A node and a wire are never selected together. Escape deselects a wire in the
  capture phase, for the same reason it does for a group: App's Escape would otherwise leave the
  room.
- Colours are tokens, never hex, in the schema as in the editor. `test/wire-style.test.ts` fails
  if the schema's list and `WIRE_TOKENS` drift apart.

## 2026-09-11 — The drag-out badge wraps

William: "sometimes the file names are long and would be more aesthetic if the text wrapped - if a
dynamic text wrapping system can't be implemented then add the ability to rescale." Wrapping could
be implemented, so resizing was not added. Each frame, the badge's max width is set to its node's
on-screen width, with a floor of 120 chrome px so a small cartridge at 1/4x does not wrap one
letter per line. The label gets a zero-width break point after every `.`, `-` and `_`, because
file names rarely have spaces and a browser left to itself either never breaks them or breaks
them mid-word.

## 2026-09-11 — The prompt node: a quick chat to the Face, embedded in the board

William: "a typical empty prompt box that allows for file (image and other file types) upload, and
whatever is typed into that box is fed to Jarvis Head/Face as a window with Jarvis head / face
opens … the prompt box should be pixel art / mosaic rastered to look like a pixel art claude
prompt interface embedded in the board."

New kind `agent.prompt`, with id prefix `q` and designator `P`. It feeds a conversation and is
not one, so it isn't a U.

**Two layers.** The canvas draws the box in palette pixels. A DOM overlay lays a real textarea in
the chrome font and two invisible buttons over exactly those pixels, both placed by one
`promptLayout`. The overlay hides below 1x and takes no pointer input in Edit Board mode, so the
node still drags, resizes and wires. Double-click or Space puts the cursor in the box, and the
wheel over it still zooms the board (the overlay re-dispatches it to the canvas).

**Fields and defaults.**
- `promptTarget` defaults to the board's JARVIS head. A named target that is missing or isn't a
  conversation is refused, not rerouted.
- `promptMode` defaults to `send`. "A quick chat" that stops short of sending is a clipboard with
  extra steps. `draft` is there for a last look.

**Delivery is main typing into the claude.ai window, on William's Enter only.**
1. Main opens or focuses the target's own conversation window and waits for its message box.
2. It hands over the files through the page's file input, or a paste event, and types line by
   line with Shift+Enter.
3. In `send` mode it presses send, and reports "sent" only when the box empties.

On any failure the window stays open, the text goes on the clipboard, and the toast says where it
stopped. The window still has no preload and no bridge: it runs fixed scripts and returns small
JSON answers. File names and bytes enter those scripts only through `JSON.stringify`, and the bytes
come from `readFileSync` on the paths the user picked. The three `prompt:*` channels are user-only,
not in AGENT_METHODS: no agent may speak in William's voice to the Face.

Rejected:
- A preload or bridge in the claude.ai window, which docs/07 forbids.
- Pasting through the system clipboard, which destroys whatever William had copied.
- Silently falling back to JARVIS for a broken `promptTarget`.
- Auto-send without evidence.

**Not verified: nothing has run against the logged-in claude.ai page.** The selectors are best
knowledge, and the failure path is the guarantee.

## 2026-09-11 — Sessions open on Fable 5.1 while it lasts, Opus 5 while it is out

William: "if fable 5 is disabled as a default model (out of usage credits - develop a system to
check) all terminals should switch to opus 5 automatically … when deadline is reached all
terminals should now switch back to defaulting to claude fable 5.1, high effort -- as mentioned
otherwise opus 5 xhigh."

Claude Code writes a refused request into the transcript: an assistant line with
`isApiErrorMessage: true`, `error: "rate_limit"`, 429. The out-of-credits refusal names Fable in its
text ("You're out of usage credits. Run /usage-credits to keep using Fable 5.1…") and carries no
reset time. A session-limit refusal does carry one, as `quotaLimits.resetsAt` and as "resets 8:40pm
(America/Denver)". So SkynetOS decides from the record:
- Fable is out when the newest refusal naming it is newer than the newest real Fable reply on the
  machine.
- It is back when the reset passes, or when Fable answers again.

The reset time comes from `quotaLimits`, then the refusal's own "resets …" phrase, then a time
William types into the usage meter in the CLI's own words. The CLI shows "8pm Monday" but did not
write it anywhere. A typed time counts only if it is later than the refusal it answers. With none
of the three, the countdown says UNKNOWN.

Every launch and resume passes `--model` and `--effort`, both real flags in `claude --help`:
- Fable available: Fable 5.1 at high, with Opus 5 as `--fallback-model`.
- Fable out: Opus 5 at xhigh.

A node's own `model` wins, `autoModel: false` turns the whole thing off, and
`~/.claude/settings.json` is never edited. A terminal already open keeps its model: there is no
channel into a live console, and the meter says so rather than implying otherwise.

The meter shows "FABLE 5.1 CORES: OFFLINE" and "CORE RESTART: HHH:MM:SS" with a stepped opacity
pulse (three held levels, no fade, off under reduced motion). While Fable is up it shows one quiet
line naming what a new session gets.

Rejected:
- Reading the reset from Anthropic's API with the stored OAuth token, which would turn SkynetOS
  into a credential user.
- Guessing the reset from the plan, which would be a fiction presented as a countdown.
- Rewriting the user's global Claude settings.

`models:status` is agent-readable; `models:setFableReset` is user-only.

## 2026-09-11 — More effects, and a colour and speed for every one

William: "more checkboxes that enable different animated / visual effects like the light pulse,
and when those effects are enabled color and speed modifiers for the animation."

- **Two new effects.** Chase is a run of lit pixels travelling clockwise round the node's edge.
  Scan is a line sweeping down its face and pausing below it. Both are whole pixels in one palette
  colour, drawn by one Graphics on a layer directly over the components and redrawn at 20fps. The
  geometry is pure (`effects.ts`, tested).
- **Speed and colour for all four.** Pulse glow, text glow, chase and scan each get a speed
  (percent, 25 to 400, stored as a whole number) and a colour (a palette token).
  - For the glows, the colour is the CREST: the pulse's peak becomes that colour while its
    shoulders still step along the ramp, so the wave keeps its shape.
  - Each glowing node now keeps its own frame counter, so different speeds coexist.
  - A node is redrawn only when its own frame changes.
- **The modifiers stay hidden until their effect is ticked** (`showWhen` on a field spec). That
  keeps a node's form from growing eight fields for effects it does not use.
- Rejected: alpha-blended or smoothly faded effects, which docs/02 forbids; a per-effect Graphics
  per node, which is object churn for twenty repaints a second.

## 2026-09-11 — The monitor's graphics can be switched off

"The psu / live data widgets should have a togglable switch for 'display system performance
graphics', otherwise it should show the selected images." `showSystemGraphics` on
`monitor.system`, default on. Off hands the face back to the node's own wallpaper and logo.

## 2026-09-11 — The drive auditor

William: "a drive analyzer and organizer … it should be incredibly perceptive so as to avoid
accidentally deleting sentimental or important files … Opening it opens claude code and the
computer root with the ability to 'hop' to other drives."

New kind `agent.audit`. It is not new launch machinery: at launch it becomes an `agent.code`
session (`auditSessionNode`), rooted at `cwd` (a drive) and granted the other drives as
`--add-dir`. Every drive is outside the dev roots, so each is confirmed on every launch (docs/07).
Its rules are `codex/personas/drive-auditor.md`:
- survey first;
- classify each item as KEEP, REGENERABLE, ARCHIVE or ASK, with ASK the default;
- propose in a table and act only on approved rows;
- never delete: "clean" means moving into a dated `_skynet-quarantine` folder with a manifest;
- check dependencies before any move;
- a long list of things treated as sacred until William says otherwise.

- **The persona is INLINED into the briefing**, not put on the reading list. The reading list is
  resolved inside the working directory, and a drive root has no codex. Also, rules the session
  has to go and fetch are rules it can skip.
- **A floor survives a missing persona.** If the persona file cannot be read, `AUDIT_FLOOR`
  carries the hard rules and the briefing says the full ones are missing.
- **Never elevated.** A node set to `popout-elevated` launches `popout`. This is the one kind where
  downgrading is right: elevation would only enable what its rules forbid.

Not built: a drive-level view of what the audit has proposed or moved. The quarantine folder and
its manifest are the record for now.

## 2026-09-11 — The usage meter calibrates against a real limit

William: "double down on ensuring the resource monitor for credit usage is as accurate as possible
… if it can be calibrated it should show an indicator (calibrate usage monitor) and user can input
information the program needs to more accurately calculate usage time remaining / credit usage."

Claude Code records a refused request with `quotaLimits: { status: "rejected", rateLimitType:
"five_hour", resetsAt }`. That is the one moment the account says where its ceiling is. The
refused window began five hours before `resetsAt`, and everything spent between that start and
the refusal is, by definition, the whole allowance. `calibrateFromLimits` measures it from the
transcripts, using the most recent hit and counting several refusals in one window once.

The meter shows **CALIBRATE** (stepped pulse) whenever the pool rests on an estimate or on nothing.
The plan dialog now offers, strongest evidence first:
1. **The measured limit**, with the date of the hit it rests on.
2. **Claude's own percentage**: type the session % that `/usage` or claude.ai's usage page shows,
   and the budget is what was measured here divided by it (`budgetFromPercent`). Honest caveat, in
   the dialog: Claude's session starts at the first message rather than rolling, so this is closest
   a few hours into a session.
3. The plan estimate, as before.

Rejected: reading usage from Anthropic with the stored OAuth token, for the same reason the Fable
fallback does not.

**What the real data said, 2026-09-11.** This machine's transcripts hold exactly one five-hour
refusal, on 2026-09-08 at 01:21Z, resetting at 02:40Z. Its window contains no local usage at all.
Limits are per account, and the sessions that reached that one ran on another desktop. So nothing
can be measured from it here, and the dialog says exactly that rather than reporting a ceiling of
zero. The same limitation shades the percentage route: it divides THIS machine's usage by an
account-wide percentage. The dialog says so, and cross-machine usage is on the roadmap (docs/06).

## 2026-09-11 — The node editor is grouped into sections

"More elements need to be nested in dropdowns that have section headers." The editor's fields are
grouped, in a fixed order, into collapsible sections: Identity, What it points at, Session,
Appearance, Text, Effects. Identity and the binding open by default, along with any section holding
a still-empty required field, so the form never hides the thing that stops it saving. Each header
is a real button (keyboard-operable) with a field count. `sectionOf` lives beside the field specs,
and `test/editor-sections.test.ts` fails if a field lands in a section that does not exist.

Still on the roadmap (docs/06): fewer fields visible by default, a search, more fonts, and making
the rotation control rotate component art.

## 2026-09-11 — One line of help, and the rest behind ?

The help bar had grown to three lines of shortcuts, which is a manual, not a hint. It is now one
line of the keys that matter in the current mode, ending "? ALL KEYS". `?` opens a grouped key
reference: Look around, Act, Edit Board, Panels. It is centred with a flex backdrop rather than
`translate(-50%)`, because an odd-width panel would land on a half pixel and blur. The HUD's
renderer diagnostics (camera, DPR, FPS, router and atlas counts) are behind `` ` ``. The router
and atlas counts still show on their own when they report a fault.

## 2026-09-11 — Copy and paste nodes, and the right-click menu

William: "duplicate decor nodes / aesthetic objects — Ctrl+C Ctrl+V, as well as right click
selected node or cluster and click copy, then right click somewhere else on the board and click
paste."

- **What is copied.** The nodes, plus every trace that runs between two of them, so a copied cluster
  pastes wired the same way. A trace to something outside the selection is left behind; pasting it
  would wire the duplicate to the original's neighbour. Waypoints are dropped, so the router draws
  the copy's own route.
- **One command.** A paste is `node.createMany`, so one Ctrl+Z takes the whole cluster back. Its
  inverse, `node.removeMany`, is DESTRUCTIVE like `node.delete`, so an agent cannot send it as a way
  to clear a board. Undo reaches it through `runInternal`, as it reaches every inverse.
- **Ids and designators** come from main's node factory, so a pasted via is `p_part_3` and a pasted
  chip takes the room's next U number. Zone `members` and a prompt box's `promptTarget` are pointed
  at the copies. A reference that does not exist in the target room is dropped.
- **Where it lands.** Its top-left goes on the tile under the cursor: Ctrl+V uses the last cursor
  position over the board, and the menu uses the right-click tile. Printed kinds never collide, so
  decor lands exactly there. A cluster containing anything mounted moves as a whole to the nearest
  offset where all of it fits (`clusterOffset`, the same ring search as placement.ts).
- **The clipboard is the renderer's,** not the OS's. It survives moving between rooms, so a
  cluster can be carried from one room to another. Ctrl+C is left alone when text is selected on
  the page, so copying words out of a panel still works.
- **The menu** acts on the group when the right-clicked node is in one, and on the node alone
  otherwise (selecting it). On bare substrate it offers Paste only. It is keyboard-operable and
  closes on any press outside it or a wheel. `node:paste` is user-only; agents have `node_create`.

## 2026-09-11 — Summon JARVIS

William: "right click a node of any kind and click 'Summon JARVIS'… opens an infused conversation
with JARVIS PRIME that provides that file or folder or whatever node as context and prompts for what
the user's comment or directive is, then gets to work."

The directive is asked for in SkynetOS BEFORE the terminal opens, so the session starts holding
both and can begin at once. The task text (`packages/shared/summon.ts`) names the node, its board,
what it resolves to, its binding fields and its wired neighbours. Presentation fields are left out,
since colours are not context. It goes through `startSession`'s `prompt`, which is staged to a file
and never put on a command line.

- **Always a FRESH JARVIS Prime session, on the root board's Hands chip (`pickHandsNode`).** A
  resumed Prime is mid-way through something else, and the running-session guard refuses a task
  outright. A summons is its own conversation.
- **An empty directive is allowed:** the session reads the target, says what it is, and asks one
  question.
- **`jarvis:summon` is user-only.** An agent able to summon would be an agent able to open
  terminals on William's desktop.

## 2026-09-11 — Two chrome-only colour sets: countdown digits and editor sections

Both at William's request. Both are DOM chrome, not board pixels: docs/02's palette rule governs
what the board draws, and neither set reaches the board, the atlas or a baked backdrop.

- **Countdown digits:** seven near-silk shades of white and grey. Each shade belongs to a digit's
  POSITION, not its value, so the clock keeps one texture while it ticks instead of flickering.
- **Editor sections:** one earthy tone each: terracotta, ochre, moss, sienna, sand and umber. Each
  section gets a thick left bar, its label and a dark tint in its tone, so the collapsed list reads
  as six different tabs at a glance. The tones sit on fixed dark grounds rather than on the room's
  mask, so they read the same in every room.

## 2026-09-11 — Efficiency pass: what an idle, open SkynetOS costs

A survey of everything that runs on a timer while nobody touches the app turned up four costs,
each removed without losing anything visible.

1. **The monitor widget kept PowerShell running.** A PSU on the board polled
   `hardware:snapshot` every 2 s. Each sensor refresh is a PowerShell spawn plus a CIM query,
   measured at about 1.3 s of CPU, and the cache let one through every 3 s. So an open board with
   a PSU on it was never idle, which contradicted hardware.ts's own "an idle board costs zero".
   The widget now asks for a LIGHT snapshot (sensors at most every 15 s; CPU, thread and RAM
   figures come from `os` and stay live). It also polls only while a monitor is actually within the
   view. The System Monitor panel keeps the full 3 s cadence while it is open.
2. **The relink poll never stopped** on a machine with permanently broken targets. The second
   desktop has five Minecraft repos that exist only on the first. It re-resolved the whole board
   every 5 s forever. It now backs off 5 → 10 → 20 → 30 s while nothing changes, and a change in
   the broken count re-arms 5 s. Relinking a folder you just created takes at most 30 s, not 5 s.
3. **An unchanged resolve re-rendered App.** `refreshTargets` replaced `targets` with a new object
   every poll. It now keeps the old object when nothing changed.
4. **The ticker rebuilt a string over every node every frame** to spot a change in broken
   targets. It is now memoised on the `targets` object: built once per change rather than up to
   165 times a second.

## 2026-09-11 — The corner prompt, and its quotes

William: "a persistent prompt box to the bottom left corner of the ui that, just like the prompt
node, opens user input message / files as a prompt into the same Jarvis Face / head session. Above
this prompt box rotate a selection of pre-written quotes… tune in sarcasm to taste."

- **One delivery path.** `prompt:send` with no `nodeId` sends to the root board's JARVIS head, in
  send mode. A nodeId that names anything but a prompt node is still refused. Everything else
  (attachments, limits, the clipboard on failure) is the prompt node's code, unchanged.
- **One column.** The corner is shared with the session dock, whose height depends on how many
  sessions run. Both now sit in a flex column above the help line, so neither needs an offset
  that is wrong half the time.
- **`/` focuses it** from anywhere. Enter sends, Shift+Enter is a new line, and Esc leaves.
- **The quotes** are `packages/shared/quotes.ts`, written in the proposed blended voice at
  needling 5 as its test. None of them asserts a false fact about the board: counts come from the
  board through tokens, and a line whose count is zero is not shown. Lines are chosen by time of
  day; the one just shown never repeats. A line types on a character at a time and then stops
  ticking. They change every 24 s or on a click, and hold still while you are typing.

## 2026-09-11 — WebP and BMP are not offered as board images

The board's image pickers offered `.bmp` and `.webp`, but the mosaic decodes in main with Electron's
`nativeImage`, which reads PNG and JPEG (and ICO on Windows) and nothing else; GIF has its own
decoder. A WebP wallpaper would therefore fail on load with a generic "NOT A DECODABLE IMAGE".
Found by the image fork; no board used either format, so nothing was broken yet.

- The wallpaper/logo picker and the LOOK floor picker no longer list them.
- If one arrives by hand, the mosaic says "WEBP AND BMP CANNOT BE READ HERE YET — SAVE IT AS PNG,
  JPG OR GIF" instead of calling the file broken.
- Prompt attachments still accept both: they are uploaded to claude.ai, which reads them, and are
  never decoded by the mosaic.

Supporting them properly would mean a decoder in main (for example a pure-JS WebP decoder, since a
native module like sharp adds a build step this machine has struggled with). Not needed until
William wants a WebP on the board.

## 2026-09-11 — The rooms, restyled in the root board's language

William: "analyze the visual stylization and grouping language / themes I am using to arrange the
main board and prepare the rooms layout to work with the same variance of style."

**The analysis, as a census of the board files.**
- The root uses the whole vocabulary: 20 frames in 8 styles, priority height on 22 nodes, 26
  wallpapers and 8 logos, text plates with borders, 6 pulse glows, 4 chase lights and 2 scans,
  22 decor parts and 7 backdrops, 6 zones, and 18 of 31 wires coloured.
- It pairs kinds with styles, with variance within a kind:
  - room drives: socket, height 4;
  - lead agents: quad or castellated, height 5, with glows;
  - helper agents: dip;
  - repos: tabs;
  - links: fingers, tabs or dip;
  - programs: castellated or bga, copper-bordered;
  - documents: large, on bordered plates;
  - monitors: rails;
  - designators hidden on nearly everything.
- The four rooms used NONE of it: small, plain components bunched in about a quarter of grids
  tripled for room to grow.

**What was done** (a reviewed script, `restyle-rooms.mjs`, kept out of the repo because it writes
board files directly):
- The layout is scaled out from each room's centre (×2.4–2.6) to fill about 70% of its grid.
- Each kind gets the root's sizes, frames and heights, cycling the root's own variance within the
  kind. Each room's lead agent gets the lead treatment.
- Zones bracket every project cluster: MinecraftOS's four resized, plus DEPLOYMENT BUS and
  CHALLENGE BACKLOG; two or three in each other room.
- Screws sit on zone corners, a status LED beside each agent (idle for unpopulated ones),
  fiducials on the corners, and pads and a grille by programs and services.
- Each room's own art, as on its drive tile on the root, hangs as a framed, pulsing backdrop
  behind its lead cluster.
- Recommendations moved with their clusters.
- Wires took the root's variance with meaning attached: deploy green, sync in the room's signal
  colour, read in dark copper, builds copper. Never red. The root's colours are NOT consistent
  by kind (its only "consistent" kind rests on one wire), so copying them literally would have
  been noise.

**Untouched:** every id, name, binding and wire. Nothing was removed.

**Outside the command bus**, deliberately: four rooms of changes as one reviewable pass instead of
about 150 separate undo steps. The pre-restyle files are at
`board/.snapshots/2026-09-11T12-00-06-237Z-agent-room-restyle/`. Copying them back restores the
rooms exactly. Validated after writing: board data OK, paths portable.

## 2026-09-11 — The Face window hung on claude.ai's spinner

William: "Something is stopping the popout claude window from actually loading the interface — it
gets stuck on a loading symbol … but the robot face still renders right."

**What was ruled out, with evidence.**
- **SkynetOS's own request block:** index.ts blocks remote requests on the MAIN window's session
  only, and the Face window has its own `persist:jarvis` partition.
- **App-wide hooks:** none exist (no `web-contents-created`, no session-wide zoom).
- **Electron itself:** a standalone probe loaded claude.ai in an Electron window with the default
  user agent and with a Chrome-like one. Both reached the real sign-in page with no errors beyond
  harmless Permissions-Policy warnings. So claude.ai loads in Electron, and the user agent is not
  the cause.

**What changed.** The one new thing reaching into the page was the JARVIS face: its owned window
was created, and its streaming probe began polling, the instant the chat window opened,
mid-load. Now nothing of SkynetOS's touches the page while it boots:
- the face attaches after the page's first full load, or 3 s in, so it still appears if the page
  itself hangs;
- the probe skips while the page is loading and until `readyState` is `complete`, every 700 ms
  instead of 400.

**If it recurs**, the window can now fix and explain itself:
- Ctrl+R reloads; Ctrl+Shift+R clears that window's HTTP cache and reloads, keeping the login;
  F12 opens DevTools.
- Failed loads, a crashed renderer and page errors are logged as `[chat]`.
- A 45 s watchdog puts "STILL LOADING · Ctrl+Shift+R …" in the window title when no message box
  has appeared.

The signed-in `persist:jarvis` state itself could not be tested from here. A stale cache there is
the remaining candidate, which is what Ctrl+Shift+R clears.

## 2026-09-11 — The JARVIS face: William's frames in, previewed and held to the rules

William added 12 frames to `assets/avatar/jarvis` (idle, blink-01 to 03, talk-01 to 08, all
96x96 RGBA) and an `avatar.json` (talkFps 9, blinks every 2.6–6.8 s at 55 ms a frame, a 2 px float
over 2.6 s). They needed no renaming.

- **PREVIEW FACE** (LOOK → SYSTEM, the user-only channel `avatar:preview`): a free-standing face
  that alternates talking and idle every 3 s, so the frames can be seen without opening a
  session. A second press, Esc, or a minute closes it. Tethered faces only appear beside a real
  JARVIS window, and "does my art look right" should not need one.
- **The frames are tested** (`test/avatar-frames-real.test.ts`). At runtime the loader skips a
  bad frame with a warning, which is right for a live app and wrong for the repo. A misnamed,
  odd-sized or alpha-less frame committed here now fails `npm run verify` instead of silently
  vanishing from the animation.
- **Seen, not assumed.** `npm run smoke:shots` now photographs a preview face from the real
  frames: at rest, then twice mid-talk (`.smoke/07-09`). The first capture showed the art at a
  whole 2x scale, centred, crisp, with distinct mouth poses.

## 2026-09-11 — Eleven zoom levels, all exact

William: "add more finite zoom levels to the program when navigating the board." The levels are
now 1/8, 1/4, 1/2, 1, 2, 3, 4, 5, 6, 7 and 8. More levels, but only exact ones: between 1x and 2x
there is no zoom that keeps pixel art whole, so "finer" had to mean more of the exact factors,
never factors in between. A 1.5x zoom would draw some art pixels one screen pixel wide and some
two. That is the smeared, generated look docs/02 forbids, and it would shimmer while panning.

- **5x to 8x** are for reading a sprite's pixels up close.
- **1/8** fits even a tripled room with space to spare.
- **Keys 1 to 8** jump straight to that zoom; the wheel and `-`/`=` step through all eleven.
- `0` (whole board) picks the closest level that fits, so a small room can now open up to 8x.

## 2026-09-11 — Logo source: file, avatar or none

William wanted the JARVIS avatar's face available as U1's logo, and the logo easy to hide. Built
as a field `logoSource` on every kind (`packages/shared/logo-source.ts`), not a U1 special case.

- **One switch, one choice.** `showLogo` stays the on/off switch; `logoSource` says what is drawn
  when it is on. `showLogo: false` wins over every source, so turning a logo off keeps the chosen
  source for when it comes back. `none` is the explicit "this node has no logo". Neither can
  contradict the other.
- **The avatar takes the logo's own path.** `avatar` resolves to `assets/avatar/jarvis/idle.png`
  in main and goes through `mosaicForNode`'s logo slot unchanged: the same dither onto the room's
  six colours, the same tight crop and the same cache, keyed on the file's mtime and size. No
  un-dithered pixel reaches the board (docs/02).
- **Live.** The frames folder watcher (`onAvatarChanged`) raises an `avatar:changed` event. The
  board bumps a stamp in the logo's cache key and refetches only the avatar logos.
- **Nothing broken while the folder is empty.** No idle.png means no logo, and the inspector says
  "avatar has no idle.png yet".
- **No blink on the board.** Blinking would swap the node's whole baked texture a few frames at a
  time. The sprite cache keys on the logo image, so each blink frame would bake and hold a full
  node texture. That price is not worth a detail on a badge, and the tethered avatar window is
  where the face animates.
- **U1 was not changed.** The field is in its editor; switching it is William's call.

## 2026-09-11 — JARVIS face windows: owned for the web, tracked for terminals

William: "a tethered window will open that has equal priority / comes to front / hides alongside
the chat window with the JARVIS session … cycles through mouth movement frames … idle at a still
face and blink when not talking, and close with the window as well … a low floaty effect."

- **Which windows get a face:**
  - the web Face (`agent.jarvis`);
  - JARVIS Prime (the root board's Hands chip, via `pickHandsNode`), which covers resumed and
    fresh sessions, summons, PROMPT → NODE builds and the morning run;
  - anything tagged `jarvis`;
  - an `agent.chat` named like JARVIS. Not every conversation: MC MIND PALACE is not JARVIS.
  - `avatarWindow: false` switches a node's face off; it never grants one.
- **The web Face: an OWNED window** (the chat window is its `parent`). On Windows, ownership *is*
  the request: an owned window stays above its owner, minimises and restores with it, and is
  destroyed with it. Show and hide are mirrored too, because hiding an owner does not hide what it
  owns. It docks to the left edge and flips right when there is no room.
- **A Prime terminal: tracked, because it cannot be owned.** Windows Terminal is another program,
  and Electron can own only windows it created. One hidden PowerShell helper reads top-level
  windows through user32 four times a second: titles, rectangles, minimised state, and which is
  in front. It prints one JSON line per tracked title. The face docks beside the terminal, hides
  while it is minimised or gone, and is raised above it (never focused) when it comes to the
  front. It closes when the session ends.
  - It finds the terminal BY TITLE, the `SkynetOS — <designator> — <name>` the launch script
    sets. So the script now sets `CLAUDE_CODE_DISABLE_TERMINAL_TITLE=1`: Claude Code would
    otherwise retitle the window and its face would lose it.
- **Speaking, read-only both ways:**
  - **Web:** every 400 ms, while the Face is on screen, a script asks the page whether a response
    is streaming (the stop button, `data-is-streaming`, `aria-busy`). It looks and never clicks,
    types or dispatches, so it is observation, not automation, and docs/07's rule that only
    William's Enter puts text in the conversation is untouched.
  - **Terminal:** the session's transcript being written within 2.5 s, by folder watch plus a 1 s
    stat. The file is never re-read.
- **Drawing:** frames from assets/avatar/jarvis at a whole-number scale, nearest neighbour, the
  float as a whole-pixel offset. The canvas is redrawn only when the frame or offset changes.
  Frames are shown as drawn, NOT dithered to the palette: this is a separate window, not a board
  sprite, and the art is William's. The board logo path (fork L) dithers them like every logo.
  Until frames exist, a small placeholder face still blinks and talks, and says where frames go.
- **The global switch** is `avatarWindows` in settings.json, because main opens the windows. It
  is written only through the user-only `avatar:setEnabled`, with a checkbox in LOOK → SYSTEM.
  It grants nothing and allows no path.
- **A face the user drags** keeps its new place relative to its window from then on.

## 2026-09-11 — Remote control from the iPhone: Tailscale and a web app, designed, not built

William asked for remote operation from his iPhone whenever the desktop app is running. Designed in
docs/08-REMOTE.md and scheduled as M9; nothing listens on any network yet. The route: a server in
main bound to 127.0.0.1 only, reached through Tailscale (`tailscale serve` for TLS), with a
pixel-art web app installed to the phone's home screen. Access is by QR pairing and then a hashed
per-device token, through an allowlisted `remote` actor. Rejected:

- **port-forwarding:** a home desktop that spawns shells, exposed to the internet;
- **a native app first:** a developer account and App Store review before a single view exists;
- **a self-hosted relay first:** the most code, for a problem Tailscale already solves.

Cloudflare Tunnel with Access is the fallback if William would rather not install Tailscale. The
rule the design rests on: this program launches agents and edits files, so the only acceptable
network exposure is none.

## 2026-09-11 — One copy at a time, the newest wins, and start with Windows

William: "make it so skynetOS boots automatically at startup but can detect an already open
version, closes it, and opens a refreshed version."

- **Replace-on-launch** (`src/main/services/instance.ts`). Electron's usual single-instance
  pattern keeps the FIRST copy. Here a second copy means "I have a fresher build", so the running
  copy goes. It receives `second-instance`, quits through the ordinary will-quit path, and the
  new copy keeps asking for the lock until it gets it, giving up after 15 s. Retrying was
  measured, not assumed: on Electron 44 a throwaway pair of processes under their own app name
  showed a copy that lost the lock getting it on its second retry, 620 ms in, once the holder quit.
  So there is no `app.relaunch()` dance. Each retry signals the holder again, so the hand-over is
  idempotent. Live Claude Code terminals are separate processes, and the new copy re-adopts them
  through the existing `restoreSessions()`.
- **The smoke harness is exempt** (`singleInstanceApplies`): a screenshot run must never close
  the copy William is using.
- **A refreshed build** (`npm run boot`, `tools/boot.mjs`): `electron-vite build`, then
  `electron .` detached, with the dev server and smoke variables stripped. If the build fails, the
  last good `out/` starts instead. Every run appends a line to `%APPDATA%/SkynetOS/boot.log`.
- **Start with Windows**: a per-user Run value (HKCU, no administrator) running wscript on a
  generated `%APPDATA%/SkynetOS/boot.vbs`, hidden, so no console flashes at sign-in. It is
  generated, never committed, because it holds absolute local paths and the repo is public. The
  same text comes from `packages/shared/boot.ts` whether it is set by `npm run autostart:on|off` or
  by the LOOK panel's SYSTEM switch. `reg.exe` is always run with argument arrays. The IPC pair
  `app:autostart` / `app:setAutostart` is user-only.
- **A copy started before this code holds no lock.** A new copy cannot ask it to leave and will
  run beside it. Replace-on-launch works from the first copy started with this code.

## 2026-09-11 — The scheduler, and a morning maintenance run

William: "a scheduled agent node that runs Jarvis Prime every morning that the program is open…
look for UI and user experience elements and code tidying / improvement opportunities… make minor
improvements automatically every morning at 8am, maintain a roadmap for program feature
development, and slowly work through roadmap items."

`task.scheduled` nodes existed since the base commit, and nothing ever ran them. They run now.

- **In-app, not the Windows Task Scheduler.** Runs happen only while SkynetOS is open, which is
  what he asked for ("every morning that the program is open"), and nothing is left registered
  with the OS to fire after the app is gone. A tick on every minute boundary, plus one 15 s after
  launch so a missed morning catches up promptly. Not during a smoke capture.
- **Rules, pure and tested** (`packages/shared/schedule.ts`):
  - one run per task per slot, marked in `scheduler-state.json` BEFORE the run starts, so a crash
    cannot fire it twice;
  - a slot missed while the app was closed fires ONCE on opening within `catchUpHours` (default
    4, max 48), and only the latest missed slot;
  - a task never catches up the first time the scheduler sees it, so adding an 8 am task at 10 am,
    or a first launch after an update, starts nothing;
  - at most 6 scheduled runs a day across all tasks, while William's Run now is never capped.
- **Only two actions run:** `agent.run` (a FRESH session on `taskTarget`, default JARVIS Prime,
  holding the brief and prompt) and `journal.write`. `jarvis.headless` and `notify` stay valid
  board data but do nothing and say why. Mapping `jarvis.headless` onto a Prime session would have
  started unannounced sessions from tasks written before any scheduler existed, such as StoryOS's
  Sunday word count. `t1_nightly` was pointed at `journal.write` explicitly, not mapped.
- **Never elevated.** An `agent.run` whose target launches elevated is refused, not downgraded:
  docs/07 says the supervision loop may never start an elevated session.
- **A brief is a `.md` inside the SkynetOS repo,** read at run time, so editing
  `codex/briefs/morning-maintenance.md` changes tomorrow's run. It is fenced to the repo because
  board JSON is agent-writable and a brief goes straight into a prompt.
- **MORNING MAINTENANCE** (`t_morning_maintenance`, T2, 8 am, catch-up 4 h, target U3) hands
  Prime that brief:
  - verify first;
  - at most three small improvements, verify green after each;
  - keep docs/06 current and advance ONE roadmap item;
  - commit, push and delete nothing;
  - stop at about 45 minutes;
  - report in handoff.md and a to-face note.
  The session prompt says it is a standing task and William may be away.

## 2026-09-11 — Terminals and admin terminals, reapproached

William: "the whole admin component of all files and terminal windows just doesn't seem to be
working … resume conversation kind of seems to work, so not sure why new session / admin doesn't
kick out a terminal window."

The evidence was on disk. In `%APPDATA%/SkynetOS/launch/`, OBSIDIUS's admin terminal script had
no pid file, meaning its shell never ran, while its session's script had one. The admin script
read `Set-Location -LiteralPath '%USERPROFILE%\OneDrive\…'`. Five faults, all fixed:

1. **Unexpanded path tokens.** `directoryForNode`, the plain `file.exe` launch and the elevated
   one used the node's RAW `cwd`. Since the portability work that reads `%USERPROFILE%/…` or
   `%SKYNET%/…`, and `spawn` given a working directory that does not exist fails with ENOENT
   before any window can open. Sessions used the resolved path, which is exactly why resume worked
   and terminals did not. All three now expand the path.
2. **Errors reported only after a timeout.** A launcher that died in its first millisecond was
   still waited on for 12 s, or 90 s elevated. `openTerminal` now checks the working directory
   before spawning, and stops waiting the moment the launcher errors or exits non-zero.
3. **The elevated helper hid its failures.** One bare `Start-Process -Verb RunAs`, output
   discarded. It now uses `-ErrorAction Stop`, exits 1223 when UAC is declined and 2 with the
   reason on stderr otherwise, and main captures that stderr. pwsh 7 here is the Store build
   behind an App Execution Alias. If it cannot be elevated for any reason other than a refusal,
   the helper retries with System32 Windows PowerShell by full path.
4. **A plain terminal deleted its own proof.** The script's `finally` removed the pid file about
   50 ms after writing it, and main polls every 150 ms, so a window that HAD opened was usually
   reported as a failure. Only an agent's script removes its pid file now.
5. **A fresh session shared files with the running one.** "New session", a summons and a
   PROMPT → NODE build on a chip with a live session reused `<board>.<node>.ps1/.pid`. The new
   launch deleted the running session's pid file and overwrote its script. A launch on a chip
   that is already running now gets its own staged files.

Not verified by running: an elevated launch needs a human at the UAC prompt, and SkynetOS needs a
restart for main-process changes. Every failure now names its cause in the toast, so the next
failure, if there is one, will say what it is.

## 2026-09-11 — Open With: Notepad++ and Obsidian

William: "add notepad++ as an Open With option for md files / nodes as well as obsidian."

- **Two new `openWith` values, `notepadpp` and `obsidian`,** offered on documents (the
  `OPEN_WITH_DOCUMENT` list). The explorer window's toolbar gets NOTEPAD++ (enabled for a selected
  text file) and OBSIDIAN (enabled for a selected markdown file). Both go through one main
  function, `openWithEditor` in `services/editors.ts`.
- **Neither falls back to the default app.** A node set to Notepad++ that quietly opened Word
  would be a setting that lies. Each fails with a sentence instead.
- **Notepad++** is found on PATH or in its installer, per-user and scoop locations, and launched
  with the path as one argument, no shell. **It is not installed on William-Desktop** (checked
  2026-09-11), so the error names the install command, `winget install Notepad++.Notepad++`.
- **Obsidian** is reached through `obsidian://open?path=`, which opens the note in whichever known
  vault contains it. It is installed here, with the handler registered to `C:\Program
  Files\Obsidian`. The file must be inside a vault (a `.obsidian` folder at or above it), checked
  before the URI goes out. Otherwise Obsidian answers with an unhelpful "vault not found" dialog.
- **Folders are refused** with a sentence. Both editors open files.

## 2026-09-11 — Recommendation buttons that did nothing

William: "the check and x aren't actually responding to user interaction on the suggested nodes,
they need to be closable / deletable." Two causes, both fixed.

1. **A stale bridge.** `window.skynet` is built from CHANNELS once, when the window opens. His
   SkynetOS was started before `phantom:approve`/`dismiss` existed, and hot reload brought in the
   new renderer but not a new bridge. The call threw a TypeError, and the plate's `finally`
   swallowed it. Approve now checks the channel exists and says "restart SkynetOS" when it does
   not. Dismiss always CLOSES the plate on screen (`closedPhantoms`, for this session only). It
   deletes the recommendation from the board file when it can, and says which of the two
   happened. Every failure is a toast.
2. **Plates overlapping.** At overview zoom a plate keeps its minimum width while its ghost
   shrinks, so neighbouring plates overlapped and the upper one covered the lower one's buttons.
   The overlay now pushes each plate below any plate it would cover.

Verified in a fresh build with `npm run smoke:shots`: a read-only probe asks the page what element
is under the centre of a visible X. The answer was the X's own pixel glyph, and both channels are
present. The screenshot shows the four plates apart. Nothing was clicked, so nothing was written.

## 2026-09-11 — A voice of JARVIS's own, proposed rather than imposed

William asked JARVIS to set its personality parameters as a 50/50 mix of its own preference and
what he has asked for. `codex/personas/voice-blend.md` does it dial by dial, with the evidence for
each column. It is **proposed**, not in force: the persona decides how every Hands session speaks
to him, and changing it without his say-so would be exactly the kind of quiet self-promotion the
persona forbids. It names the three dials he should set himself.

## 2026-09-11 — OBSIDIUS, and the journal writes into Obsidian

William: "add a node on the mainboard attached to nightly journal called obsidius … a claude code
local agent that basically can manage and help me edit my obsidian vaults … Update the nightly
journal node to create a new obsidian note in the correct area / vault … with metadata built-in and
tag awareness / dynamic tagging … any agentic or node otherwise compatible with obsidian should
have that knowledge profile built-in."

- **The vaults, found rather than assumed.** On this machine there are three, all in
  `%USERPROFILE%/OneDrive/Documents/`. SolidState Sync is the main one (about 220 notes and
  twenty-odd community plugins). WilliamCloud (35 notes, 2024) and the starter "Obsidian Vault"
  (Welcome.md only) are the others. OBSIDIUS is an `agent.code` rooted at SolidState, with the
  other two as `addDirs`, wired to the journal.
- **Built-in knowledge is inlined, not listed.** `codex/personas/obsidian.md` goes into the
  briefing of every Obsidian-aware session: tagged `obsidian`, or with `cwd`, `path`,
  `journalVault` or an `addDirs` entry inside a vault. A vault is a folder with a `.obsidian`
  folder at or above the path. The file cannot go in `readOnLaunch`: reading resolves against
  the session's cwd and refuses anything outside it (docs/07), and a vault-rooted agent's cwd is
  the vault. The drive auditor's persona reaches it the same way, and for the same reason.
- **"The correct area" is the vault's own daily-notes folder,** from `.obsidian/daily-notes.json`,
  in a `SkynetOS/` subfolder. In SolidState that folder holds William's own numbered, titled
  entries, and a machine log does not belong among them. `journalFolder` overrides it. The file
  name uses the vault's daily-notes format (default `YYYY-MM-DD`).
- **Never overwrite:** the name is checked, then written with `wx`. A day that already has a note
  gets `<date> (SkynetOS).md`, then `(SkynetOS 2)`, and so on. No appending under a heading:
  appending edits a note someone may have open, and a new file is always safe.
- **Metadata** is typed the way the Properties view reads it:
  - dates bare (`date: 2026-09-11`, `created: 2026-09-11T22:04:00`) and lists as lists;
  - `type: journal`, `source: skynetos`, `projects`, `sessions`, `tokens` and `rooms`;
  - plus every key the vault's daily template carries (SolidState's `URL`), written empty, so the
    note matches the vault's own.
- **Tag awareness:**
  - The vault's whole tag vocabulary (frontmatter and inline; bounded to 4000 notes, cached for
    ten minutes) is read first, most-used first.
  - A candidate that matches an existing tag, ignoring case and separators, takes the existing
    spelling.
  - A new tag is spelled in the vault's own style: SolidState is flat CamelCase, so `DirtyPlush`.
    A vault that nests gets `project/dirty-plush`.
  - Candidates come from the day's real activity: the projects credited with usage today, busiest
    first.
- **Clicking the journal writes the note now.** There is no scheduler yet (M8), so the click is
  the run, and `schedule` stays declarative. It is user-only: an agent asking for a note in
  William's vault is a note he did not ask for.
- **`optionalTarget` on `journalVault`.** Making it an ordinary target field would have turned
  every vault-less `task.scheduled` (StoryOS has one) into "NO JOURNAL VAULT SET", which reads as
  broken. It is the node's target only when filled.

## 2026-09-10 — FACE-BOOT.md: the Face reads the repo, and why it must sit at the root

Drive was ruled out as a transport the same day (see above). GitHub was tested instead and works:
the Face fetched `blob/main/handoff.md` and received the complete file. Hands → Face no longer
requires William.

**The constraint.** The Face can only fetch a URL that appeared in a prior fetch result or that
William pasted; a constructed URL is refused. `raw.githubusercontent.com` and a typed
`blob/main/codex/index.md` were both rejected in testing, and GitHub robots-blocks `tree/` pages,
so directories cannot be browsed. From a cold start the reachable set is the repo root page and
the root-level files it lists — two hops, nothing nested.

**Decision.** `FACE-BOOT.md` at the repository root. A bake artefact, generated by
`npm run face:bake`, never hand-edited, declaring itself as generated on line one. It inlines
`codex/index.md`, unread `to-face` mail, the board's unresolved and provisional nodes, and one
paragraph of Prime's state.

Root placement is not a style choice. A file in `codex/` is unreachable to the Face from a cold
start, and a bootstrap file the Face cannot reach is not a bootstrap file.

**Why generated.** `codex/index.md` stays canonical; duplicating it by hand would break one-fact-
one-home. Baking it is the same trade the atlas already makes — a derived artefact is allowed to
repeat a source, an authored one is not.

**What this fixes.** Every Face conversation has until now started from whatever documents were
pasted into its project, which drift. This week the Face reasoned from a `handoff.md` a full
milestone out of date and reported a stale board finding that was itself stale.

## 2026-09-11 — The room look: whole-board colour, a dithered vignette, a tiled floor

William: "add overall board effects / color scheme customizations that render the board in its
entirety with a filtered hue adjustment, add a vignette option and add the ability to select an
image that is a perfect square and that image can be tiled as the board background, or else it
defaults to what it already is. enable background image tile is a toggle." Plus a "Hide
Recommended Nodes" toggle among the board's settings.

**Where it lives.** `Board.look`, per room, in the board file, changed only by a new
`board.update` command whose patch is limited to `look` (the theme, grid and identity have
consequences of their own and will get their own commands). Its inverse is exact
(`applyLookPatch`, tested), so Ctrl+Z takes any look change back. Stored clean: defaults are
dropped and an empty look is removed, so a reset room's file is the file it was before. The
panel is LOOK in the breadcrumb, key `L`. Sliders draw live through a renderer-only `lookPreview`
and commit one command on release, not one per pixel of drag.

**Colour: a CSS filter on the board host, not a Pixi ColorMatrixFilter.** `hue-rotate`,
`saturate`, `brightness` and `contrast` are per-pixel colour matrices. Nothing is sampled from a
neighbour, so a pixel stays exactly where it was and exactly as sharp. The compositor applies it
as one colour pass over a layer it composites anyway, with no render-to-texture in Pixi. A Pixi
filter would add an offscreen pass every frame, and Pixi filters bring their own filter-area and
resolution handling that sits badly with `roundPixels`. It is on the board host only, so the
chrome keeps its colours. **Deviation from docs/02 rule 2, at William's request:** a hue-rotated
copper is not copper, so the board leaves its palette while the filter is set. It is off by
default, and an unset look carries no filter at all. Recorded in docs/02 under rule 6.

**Vignette: an ordered dither, never a gradient.** An 8x8 Bayer threshold of one palette or
`ink` colour, whose coverage rises linearly past an inner radius. It is drawn once into a small
canvas, one pixel per cell (3 device px x chrome scale), and shown at that integer multiple with
`image-rendering: pixelated`. Screen space: the camera does not move it. It is rebuilt only on a
window resize or a setting change, never per frame. Rejected: a CSS `radial-gradient`, even with
hard stops, which is the smooth ramp docs/02 bans.

**Tiled floor: through the mosaic, square or nothing.** `mosaic:boardTile` reads the picture's
size, refuses anything not square ("NOT SQUARE — 640x480"), and dithers it onto the room's
palette exactly like a backdrop, at its own size held to 8..256 px. The renderer tiles it in
world space with a `TilingSprite` at integer scale 1..4, so it pans and zooms with the board. The
procedural substrate is hidden, not destroyed. Toggle off, a missing file, or a failed check
brings it straight back, with a toast saying why. Rejected: cropping or stretching a non-square
picture. A crop decides what to throw away, and a stretch distorts every tile of the floor.

**Hide Recommended Nodes** is a per-viewer preference (localStorage), not board data. It hides
fork C's phantoms without touching the proposals themselves.

## 2026-09-11 — Research downloads go through one tool, and every file names its source

William: "if you can't access the internet and download files yet, now is the time to get that
functionality setup / primed for yourself. populate these directories."

**Decision.** `tools/fetch-research.mjs` (`npm run research:fetch -- <url> <dir> --license … --note …`)
downloads one file per call and appends a line to that folder's `SOURCES.json`: the URL, the URL it
finally came from, size, sha256, date, content type, licence and a note. The pure helpers are in
`tools/fetch-research-lib.mjs`, tested by `test/fetch-research.test.ts`.

- It never overwrites. It writes `.part` and renames on success, with a 50 MB cap unless raised.
- **It refuses a web page arriving under a data name.** The first run saved NCEI's storm-events
  app shell as a `.csv`. The Census API does the same with 200 and a "Missing Key" page. A research
  folder must not hold a file whose name lies about what it is.
- **`--restore <dir>`** re-downloads every recorded file missing on this machine and checks its
  sha256. That is what makes it safe to keep large public binaries out of git: the manifest travels.
- It sets `process.exitCode` rather than calling `process.exit()`, because exiting while a
  cancelled response body is still closing trips a libuv assertion on Windows.

**Where research lives.** In the project's own repo (`DirtyPlush/research/`), not in SkynetOS. The
codex gets a map of it (`codex/projects/dirty-plush.md`), not copies.

**The provenance rule.**
- Only public-domain, openly licensed or officially free-to-download material, with the licence
  recorded for each file.
- An "estimate — verify" note wherever a source is not from 1994, which is the vault's own rule.
- Both repos are public, so anything whose licence does not allow redistribution is git-ignored.
  So far that is the POST workbooks, "© State of California".
- Anything over 20 MB is also git-ignored: the USGS quads and the FBI 1994 report. `--restore`
  rebuilds them.

**Rejected.**
- Ad-hoc `curl`: no provenance, and it would have saved the HTML shell just as happily.
- Committing everything: about 150 MB of maps in a public repo's history for good, plus POST's
  copyright.
- Git LFS now: it is not installed and the choice is William's. `research/README.md` says how.

## 2026-09-11 — A file explorer node, and why it is a new kind

William asked for a research folder node that looks like "a pixel art / retro file explorer" over a
real folder, with a selectable resting folder. It is a new kind, `store.explorer`, not a flag on
`store.folder`. A folder's click already means "open it in Windows Explorer", and making the same
kind do two different things depending on a checkbox would make every folder node ambiguous.

The window is a DOM panel (`Explorer.tsx`), like the system monitor, not pixels on the board: a
file list needs scrolling, focus and keyboard navigation, which the canvas does badly. It still
obeys docs/02. Bevels are hard inset shadows, icons are 16x16 pixel art from the palette tokens,
and it is centred by a flex backdrop rather than `translate(-50%)`.

The root is a wall. Every request is a path relative to the node's root. It is refused by spelling
if it could climb out (`..`, a drive letter, a UNC path, an NTFS stream name), and then the real path,
with junctions and symlinks resolved, must still be inside the real root. A junction pointing out of
the research folder is listed, but it is refused the moment you try to enter it. Rejected:
normalising `a/../../b` into something inside the root. A request like that is a bug or an attack,
and answering it would hide both.

It is read-only. `explorer:list` is agent-readable, because a Claude Code agent can read that folder
directly anyway. `explorer:open` and `explorer:drag` are user-only. Opening anything that runs code
is confirmed every time, because a research folder is where downloaded files live. The one write is
to the board: SET AS RESTING FOLDER is an ordinary `node.update` of `restPath`, built from the root
as the board spells it, so a `%USERPROFILE%` root stays portable.
## 2026-09-11 — Recommended nodes (phantoms)

William: "add the ability for you (yourself) to 'sketch' / place confirmable placeholders for other
nodes to add to the board / connections to make - these will appear as phantom objects with a title
/ description ... then a check or x I can select to approve or delete a phantom. You may recommend up
to 4 new nodes at a time per room / board."

**Decision.** A phantom lives in the board file under `phantoms`, beside `nodes` and never among
them, so it resolves nothing, launches nothing, counts as neither bound nor broken, and blocks
nothing a real node cares about. Its life is three commands on the same bus as everything else:
`phantom.propose` (anyone), `phantom.dismiss` (William, or an agent withdrawing its OWN), and
`phantom.approve` (William only). Approve carries the finished node, built in main by the same
factory as `node:add`, plus its traces, and removes the phantom in one command, so one Ctrl+Z puts
the phantom back exactly. The rules are pure and tested in `packages/shared/phantoms.ts`.

**Destructive or not.** The inverse of an approval, `phantom.unapprove`, removes a real node, so it
is in DESTRUCTIVE: undo is its only door, and an agent sending it gets `needsApproval`. Dismissing a
phantom is NOT destructive: it removes a suggestion, and nothing that resolves, runs or holds data
is touched; undo restores it byte for byte. Asking William to confirm the cross he just pressed
would be a dialog that teaches click-through.

**The cap is in two places.** The bus refuses a fifth with a sentence an agent can act on. The
schema's `maxItems: 4` holds it for hand edits and the validator too. One consequence, accepted:
undoing a dismiss after the room has refilled to four fails validation honestly rather than
exceeding the cap.

**Drawn as a DOM overlay**, like PromptBoxes: the tick and cross are real buttons with focus and a
keyboard path (Enter approves, Delete dismisses). Dashes are whole world pixels in a crispEdges SVG,
colours are opaque palette tokens (a translucent ghost would blend off-palette), and the tick and
cross are 7x7 bitmaps rather than font glyphs. Shift+H hides them (R is taken by re-read, L by the
LOOK panel); the flag is a view preference in localStorage, and the phantoms stay in the file.

**Rejected.** Phantoms as provisional nodes: they would collide, resolve, count as broken, and
approval would be an edit rather than a creation. A separate phantoms file: the Face reads board
truth from the board JSON through FACE-BOOT, and a suggestion kept elsewhere is invisible to it. An
`approved` flag an agent could set: docs/07 gives approvals to William's hand only.

**Seeded 2026-09-11** by U3 JARVIS-PRIME: four per board, every path checked on disk first. Several
of them are the correct paths for nodes that currently point at nothing (GameOS `tools/forge`,
`docs/design.md` and `assets/`; StoryOS and DeductionOS `REPLACE_ME` templates). They are offered
as suggestions rather than silent repoints, because which node to keep is William's call. The
standing instruction to keep about four per room is in `codex/personas/persona.md`, which every
Hands session reads on launch.

## 2026-09-11 — PROMPT → NODE: a box that briefs JARVIS Prime to build a node

William: "a type of node called prompt-to.node that basically presents a … prompt text box like the
others that already exist, but this one sort of prompt injects claude code so it knows to build a
node based on what user wrote … add titling elements that show a prompt to node isn't a regular
node."

- **Kind `agent.prompt-to-node`,** not a mode on `agent.prompt`. The two do different things with
  what is typed: the quick chat hands it to the Face on claude.ai; this one hands it to Claude Code
  as a task. A mode flag would put a board-building terminal one dropdown away from a chat box that
  looks identical, which is exactly the confusion William asked the titling to prevent.
- **It briefs a FRESH JARVIS Prime session** on the root board's Hands chip (`pickHandsNode`), like
  Summon JARVIS and for the same reason: a resumed Prime is mid-way through something else, and the
  running-session guard refuses a task. The brief (`buildNodePrompt`, pure and tested) carries his
  words verbatim, the board id to pass to every skynet tool, the box's position and a start tile
  just right of it, and any attached paths. It also gives the procedure: node_fields, bind only
  verified targets, create/update/wire (never to the box itself), phantom_propose when unsure, and a
  two-line report. Nothing reaches claude.ai.
- **Attachments go as paths.** Claude Code reads files itself, so the quick chat's byte caps (which
  exist because claude.ai needs the bytes) do not apply. Only the count cap and "the file is there"
  do.
- **The titling is drawn by the canvas, lettered in a 5px pixel font** (`MICRO_FONT` in
  component-art.ts), not a DOM label. At 1x the tab is 12 screen pixels tall. Departure Mono at chrome
  scale 2 is 22, so a DOM label would not fit, and below 1x the overlay is hidden anyway. The pixel
  font is exact at every zoom and uses one palette colour. The second tell is the box's frame in
  signal instead of silk. `promptLayout` gained an optional tab height and a `tab` rect, so the
  canvas and the overlay still share one geometry, and the quick-chat layout is unchanged (tested).
- **`prompt:build` is user-only,** like the rest of `prompt:*`. An agent that wants a node proposes it
  or places it; it does not get to open a terminal on William's desktop by typing into a box.

## 2026-09-11 — Away mode: sleeping, working headless, and the wake report

William: "a sort of sleep / inactivity mode that should activate after 30 minutes that the program is
open but isn't interacted with - including agent interactions … a centered window with the autonomous
claude Jarvis head session … log work completed since user was away … as soon as the user provides any
form of input, the log / write-up … then spacebar reopens the main view of the board."

- **The JARVIS head session is headless Claude Code, not the Face.** claude.ai's consumer terms
  forbid automated, scripted use of the web conversation, and docs/07 lets SkynetOS type into that
  window only on William's own Enter. Claude Code is built for autonomous runs. So the centred
  window streams JARVIS Prime running `claude -p --output-format stream-json --verbose`, and the Face
  gets the summary as `to-face` mail. The prompt goes in on stdin, never on the command line.
- **Away needs all three quiet at once:**
  - OS-wide input idle (`powerMonitor.getSystemIdleTime`, which covers typing in terminals);
  - no Claude Code transcript write;
  - no board command or MCP call.
  Checked every 30 s. The transcript folder is stat'ed only once input is already idle past the
  threshold, so a present William costs one syscall per 30 s.
- **It never raises or focuses the window.** Thirty minutes without input is also what watching a
  film looks like. The sleep screen is drawn inside SkynetOS for whenever he looks.
- **Sonnet at medium effort by default,** not Fable or Opus. Away work is mostly reading and
  roadmapping, and the expensive models' usage is William's for his own work. `awayModel` overrides.
- **Levels, enforced by the command line rather than trusted to the prompt:**
  - `visual`: no agent.
  - `plan` (the default): reads anything under C:/dev, writes only `SkynetOS/codex/**` and
    `docs/06-ROADMAP.md`, proposes phantoms and sends mail.
  - `work`: plan, plus `session_start`, capped at 2 in main at the agent's `session:start`. Those
    sessions open on the away model.
  - At every level: `--permission-mode dontAsk --permission-prompts none` with fixed allow and deny
    lists. No commit, push, delete, elevation, terminals, web, or board edits beyond phantoms.
    `--strict-mcp-config`, so none of William's other connectors load.
  - `work` is settings.json only; the in-app control refuses it (docs/07's rule for grants).
- **Budgets:**
  - a 90-minute wall clock and a 250-tool-call ceiling. There is no `--max-turns` in this CLI, so
    main counts and stops the run itself;
  - no start below 25% of the usage pool, or with no budget set, which is noted rather than guessed.
- **Waking:** any key, click or wheel, a mouse move past 6 px, or the OS seeing input again, all
  after a short grace. It stops the run (kill, a 3 s grace, then `taskkill /T` for the tree) and
  shows the report. Space returns to the board, and the report stays behind a HUD chip until
  dismissed. A manual sleep (Shift+Z) waits for the machine to be left alone before it counts
  input as a return.
- **Nothing is lost when he comes back mid-task.** If the run did not write its own journal and
  Face mail, SkynetOS writes `codex/journal/away-<date>-<time>.md` (never overwriting) and sends the
  mail itself.

## 2026-09-11 — Wire patterns, pinned ends and movable elbows

William: "add more wire type variations (dotted and dashed and solid strokes and fills, stroke width
modifier, and add the ability to manually reposition both endpoints of a wire to a desired point
along a nodes edge and it sticks to that point, as well as the ability to reposition elbows as well."

- **Five new optional edge fields:**
  - `dash` and `outlineDash`: solid, dashed or dotted;
  - `outlineWidth`: 0 to 3;
  - `fromAnchor` and `toAnchor`: `{side, offset}`.

  `waypoints` was already in the schema and is now honoured. Every existing board has none of these
  fields, so every existing wire draws and routes exactly as before (tested).
- **Dashes are whole-pixel rectangles**, never Pixi's dashed strokes, which antialias onto
  fractional pixels (docs/02 §Anti-mush). They are cut on the CPU by distance along the route
  (`wire-geometry.ts` `dashPieces`).
  - Dashed is 4 on / 3 off, dotted 1 on / 2 off, in multiples of the run width. A thicker wire gets
    a longer dash, not a denser one.
  - The pattern continues round corners. Restarting it at each elbow leaves a stub or a gap at every
    turn, which reads as a break in the wire.
  - A `depends` wire keeps its 8/8 dash by kind; an explicit `dash` overrides it.
- **The outline follows the run unless told otherwise.**
  - Absent `outlineDash`: each dash gets its own black edge, which is how depends wires already
    looked.
  - `solid`: a continuous black sleeve with the dashes inside it (the "fill" reading of the request).
  - A pattern: the outline gets its own dashes at the outline's thickness.

  Lanes are spaced by the widest run plus that run's own outlines, so a 3 px outline does not
  overlap its neighbour.
- **Anchors snap to the 8 px half-grid, not to whole tiles.** A 3-tile node's centre is a half tile,
  exactly where the router puts wires today, so snapping to tiles would move a default wire the
  first time its end was touched. An anchor is a side plus a fraction along it, not a pixel, so it
  stays at the same place on the node when the node is moved or resized.
- **Routing through pins:**
  - A pinned end is a stub one half-grid step out from its side, so the wire always leaves square to
    the side.
  - A* runs leg by leg (stub, waypoints, stub), keeping its turn penalty.
  - A node's rectangle is carved passable only for a leg that ends at the node's centre, i.e. an
    unpinned end. Carving it for a pinned leg let A* cut through the node and arrive from the far
    side. The test caught this; `carveFrom`/`carveTo` on RouteRequest fixed it.
  - A leg that cannot be routed falls back to a plain elbow and counts in the router's fallback
    figure.
- **Moving an elbow pins both ends.** Dropping an elbow or a segment writes:
  - the interior corners as whole-tile `waypoints` (the schema's unit);
  - the two current ends as anchors.

  Re-routing then reproduces the dropped shape, instead of the router choosing new sides.
- **One drop, one command.** The drag previews on the overlay from pure functions (`moveElbow`,
  `moveSegment`, `nearestAnchor`). Release commits a single `edge.update`, so Ctrl+Z undoes the whole
  reshape. Escape cancels and writes nothing.
- **An arrow moves an end the way it points, not clockwise.** The first cut mapped Right and Down to
  clockwise, which sent Right leftwards on the bottom side. `nudgeAnchor` takes whichever
  neighbouring perimeter step moves the point along the arrow, and does nothing for an arrow across
  the side.
- **Not built:**
  - Re-targeting an end by dropping it on another node. The spec made it optional; for now, delete
    the wire and draw a new one.
  - Free-angle elbows. Every wire stays horizontal and vertical.

## 2026-09-11 — The JARVIS face as an animated logo, and GIFs that play

William: "on a node I can select the animated robot face as a logo instead of an image file and it
uses the box it generates for the typical window but as a logo graphic", and "add gifs as an image
file type that can be use as a logo or wallpaper."

- **`logoSource: avatar-live`, labelled "JARVIS face (animated)".** `avatar` stays, now labelled
  "JARVIS face (still)". Select fields can now show labels (`FieldSpec.optionLabels`).
- **Drawn live on the board, not baked into the node's texture.** A world-space Pixi layer above the
  components holds, per node, the face window's composition in the logo box: a mask-dark ground,
  a 1 px copper-dark edge, and the face. It follows the node's sprite, so a drag carries it.
  - Rejected: baking each face frame into the node texture. The face changes several times a
    second, and each change would redraw the whole component through the canvas composer.
  - Rejected: a DOM overlay, which would not pan, zoom or layer with the board.
- **Size.** It uses the box a file logo gets (`logoBoxPx`, shared with the mosaic, so `logoScale`
  works), with room left for the float, as in the face window.
  - The face takes the largest whole-number scale that fits.
  - A box smaller than one frame takes every Nth pixel, an exact decimation like the overview
    zooms. A smoothed resample was rejected under prime directive 4.
- **True colours, a second exception to docs/02's palette lock.** It is recorded there. The frames
  are William's art, and the dithered face is what `avatar` already offers.
- **Stepped, not rebuilt.** The ticker looks at the faces at most about 30 times a second. It swaps a
  sprite's texture only when that face's frame or float changes. Textures are cached per frame and
  size, and freed when the room closes or the frames change.
- **The mouth, per node.** `services/avatar-mood.ts` watches only the nodes on the open board with
  this logo (`avatar:watchNodes`: at most 32, every 500 ms). It pushes `avatar:nodeMood` when a mood
  changes:
  - web nodes: the face windows' own claude.ai streaming probe, run in that node's conversation
    window when it is open and loaded;
  - terminal nodes: the live session's transcript, written in the last 2.5 s;
  - anything else: idle, blinking.

  It is independent of the face windows, so it works with them switched off. Rejected: reading the
  face windows' own mood, which exists only while they are on.
- **GIFs, decoded in pure JS (`omggif`).** nativeImage reads PNG and JPEG only.
  - Compositing is in `packages/shared/gif.ts`: disposal (none, background, previous) and
    transparency, as browsers do it.
  - Each frame is then fitted, dithered and turned by the still path's own code, and cached per
    frame. GIFs stay inside the palette lock; they are not an exception.
  - Caps: 120 frames, 16 MB of decoded output, 160 Mpx of source. Past them, the first frames that
    fit play and the inspector says so. Refusing the file outright was rejected, because a long GIF
    should still show.
  - Delays are treated as browsers treat them: under 20 ms plays at 20 ms, and 0 or 1 cs plays at
    100 ms.
  - `imageAnimate: false` holds the first frame. A held GIF, a one-frame GIF and a GIF floor all
    take their first frame through omggif.
  - All of a node's frames share one texture slot (`live-slots.ts`), so a 120-frame GIF does not
    leave 120 textures behind. A playing GIF wallpaper gets no pulse glow.
- **Tested:** GIF compositing, caps and scheduling, logo-source resolution, box and layout, and the
  schema's agreement with the editor. **Not yet seen on screen** when this was written.

## 2026-09-11 — Remote: the same renderer over a WebSocket, not a phone app

William: "a wireless and preferrably fully remote capable virtual link to my phone that gives me full
access to use the program … remotely controllable via a mac desktop, windows desktop, ipad, or
iphone." docs/08 has the design; docs/07 has the rules.

- **The remote client is the desktop renderer.**
  - `remote-server.ts` serves `out/renderer` as it is.
  - A page served that way has no preload, so `src/renderer/remote/shim.ts` installs the
    `window.skynet` bridge itself. Each call becomes a WebSocket message; each pushed event comes
    back to `skynet.on`.
  - Rejected: a second Vite entry with its own phone UI (docs/08's first draft). It means two UIs
    that drift apart, and every board feature built twice. William asked for "full access" and
    "a lot of the program's elements"; a cut-down app is the opposite.
  - A small screen is a layout (`html.compact`, `mobile.css`), not a second app.
- **Not screen streaming.** Parsec, RustDesk and Chrome Remote Desktop work today with no code, and
  are the stopgap until the tunnel is set up. But they put a desktop-sized UI on a 6-inch screen with
  mouse semantics, and they grant the whole desktop, not SkynetOS. The bridge gives touch layout,
  and an allowlist.
- **A hand-written WebSocket server** (`websocket.ts`, RFC 6455, about 200 lines) instead of the `ws`
  package.
  - The main process externalises its dependencies, and the server only needs text frames, ping and
    close.
  - It is tested against the RFC's own handshake vector, split frames, fragments, unmasked and
    oversize frames.
- **An allowlist, not a mirror.** `REMOTE_METHODS` sits next to AGENT_METHODS. It is wider, because
  the person on the phone is William, and narrower than the desktop.
- **A destructive command from a phone is refused, not confirmed on the phone.** The delete guard
  is a native dialog on the desktop. A phone-side "are you sure" would need its own second-factor
  design, and until it exists, undo is how a phone reverts. Any dialog a remote call would raise
  fails with CONFIRM ON THE DESKTOP, so nothing waits on a modal at an empty desk.
- **Tailscale first; Cloudflare Tunnel with Access as the fallback.** The server binds 127.0.0.1
  only. `tailscale serve` terminates TLS with a real certificate for the tailnet name, so the phone
  gets HTTPS and `wss://` with nothing open to the internet. SkynetOS runs `serve` only after
  William confirms a dialog, and never `funnel`.
- **Pairing codes, not passwords.** An 8-character one-time code, also shown as a QR code, is
  exchanged for a 256-bit device token. The token is stored hashed and each device is revocable.
  Nothing to remember, and nothing reusable if a screenshot of the code leaks after 5 minutes.

## 2026-09-11 — The chrome's layout manager, a pixel icon set, and the app-level panels

William: "add usability features, check ui elements don't overlap or obscure eachother and have hide /
relocation behaviors to ensure full program ui legibility", "Add more icons for settings and other ui
elements that indicate their purpose", and "complete quality of life and commercial app / os
development features".

- **Measured first.** The smoke run's layout audit (`src/main/index.ts`, shots-only block) sets the
  window to 1280x720, 1584x961, 1920x1080 and 1024x768. It opens each panel state through keys and
  store actions, and logs every pair of docked panels that intersect. Before this change it found
  seven states with overlaps:
  - the HUD over the breadcrumb, or over the usage meter beside the inspector;
  - toasts on the minimap and on the left stack;
  - LOOK over the minimap;
  - at 1024 px, nearly everything.

  `SKYNET_SMOKE_LAYOUT=0` skips the audit.
- **A planner, not CSS alone.** `ui/chrome-layout.ts` is a pure function from measured boxes to a
  plan. `ui/useChromeLayout.ts` measures every 400 ms and on resize, then applies the plan: booleans
  to the store, pixel values as CSS variables on `.app`.
  - Rejected: media and container queries. The collisions are between panels in different corners
    (the minimap against the left stack, LOOK against the minimap), and no single container sees both.
  - Rejected: a ResizeObserver per panel. It takes the same measurements with more machinery.
- **Natural sizes, never current ones.** Each panel is planned at the size it would come back at,
  remembered from when it was last shown in full. Planning from the collapsed size makes the
  collision vanish; the panel then re-opens, and the two states flicker.
- **What gives way, lowest priority first:**
  1. the help line;
  2. the minimap, to its button;
  3. the usage meter, to its header;
  4. the session dock, to its header.

  The other rules:
  - The HUD stays on one line and moves its secondary chips behind a +N button.
  - Toasts stack above whatever holds the bottom-right corner, and to the left of LOOK.
  - LOOK stops above the minimap.
  - The user's own choice always wins. Every panel has its own fold or hide control, kept in
    localStorage `skynet.chromePrefs`, and a minimap re-opened while squeezed stays open.
- **Icons are text rows drawn as SVG rects** (`ui/Icon.tsx`): 9x9, `currentColor`, crisp edges, and
  beside the words, never instead of them.
  - Rejected: an icon font. It hints and antialiases at 1x and 3x, and the pixel validator cannot
    check it.
  - Rejected: atlas sprites for the DOM chrome. They would need a baked copy per colour, whereas an
    icon here takes its text's colour, so a warn button's icon is warn.
- **Ctrl+K reads; it does not index.** The command palette reads every board through `board:load`
  and `board:loadRoom`, the channels a descent already uses, and reaches a node by the ordinary
  ascend and descend.
  - Rejected: a main-side search channel. It is a new IPC surface for what a handful of JSON reads
    already answers.
- **Settings gathers; it does not add.** Ctrl+, holds the interface folds, the system switches (now
  `ui/SystemSettings.tsx`, shared with LOOK), away mode, and the usage calibration. It adds no new
  channel.
- **Notifications are memory only.** Every toast is kept behind a bell with an unread count: 100 of
  them, newest first, with repeats within 5 s merged.
  - Rejected: persisting them. That is a new write path with no use yet.
- **The window reopens where it was left** (`userData/window-state.json`), but only if its title bar
  would land on a connected display; otherwise it keeps its size and is centred. A smoke run skips
  this.
- **chrome.css is imported by main.tsx, straight after styles.css.** Vite emits CSS in import order,
  and App.tsx is imported before styles.css, so a stylesheet imported from App loses every tie.
- **A getting-started card, once.** It lists five keys and closes with GOT IT, for good. It does not
  appear on remote pages, which are touch-first and have none of those keys, and a smoke capture
  hides it with a class rather than dismissing it, so the capture writes nothing.
- **Fixed on the way, from reading the code (not reproduced on screen):** a minimap that was closed
  and re-opened had nothing to draw on its new canvas. Its draw loop only re-attached when the board
  changed, and now it also re-attaches when the canvas comes back.

## 2026-09-11 — The usage meter folds on a phone

The last remote capture at iPhone width (390 px) showed the usage meter in full over a third of the
screen, with its header cut off at CALIBRATE. That put the fold arrow past the meter's edge, so a
phone had no way to fold it. The overlap audit could not see this: nothing overlapped; the header
ran out of its own box.

- **On a compact screen the meter starts as its header** (`chrome-layout.ts`, a `compact` input
  read from `html.compact`). A tap on the header opens it in full with its drawer, as a squeezed
  desktop meter already did. A desktop window narrower than 820 px is compact too and folds the same way.
- **The header wraps inside the meter** on compact screens (`mobile.css`) rather than running out of it.
- **The smoke audit checks for clipping as well as overlap:** a panel whose children run past its
  edge. The same probe now also runs in the phone and tablet windows, which it never covered before.

## 2026-09-11 — The dual-camera gate passed at 1080p, not just 720p

The Face's brief: two webcams frequently cannot both run at speed on one USB controller, because
they negotiate bandwidth at connect. Below 25 sustained fps on either camera, the gesture design
changes — separate controllers, or 848x480. `tools/camera-gate.mjs` opens every selected camera
BEFORE measuring any of them, then reports what each delivers per second.

Measured on William-Desktop, 60 s per mode, both cameras open simultaneously:

| Mode | C920 | C922 |
|---|---|---|
| 848x480@30 | mean 29.8, min 28, 0 dropped | mean 30.0, min 29, 0 dropped |
| 1280x720@30 | mean 29.9, min 29, 0 dropped | mean 30.0, min 30, 1 dropped |
| 1920x1080@30 | mean 29.0, min 27, 3 dropped | mean 30.0, min 29, 3 dropped |

- **Two C920s was wrong.** The desk has a **C920** and a **C922 Pro Stream**, plus an Elgato Cam
  Link 4K (an HDMI capture card, not a camera) and an OBS Virtual Camera. The gate opens the two
  Logitech webcams by label and leaves the other two alone.
- **They are already on separate controllers**, which is why there is no contention: the C920 hangs
  off a Realtek Generic USB Hub, the C922 off the USB 3.0 root hub. Moving either one is a
  regression risk worth remembering.
- **720p30 is the recommendation anyway.** Hand and pose landmarkers gain little above it, and it
  costs 2.25x fewer pixels per frame than 1080p. 1080p is held in reserve for reach at desk
  distance; the C920 has about 3 fps of headroom there, the C922 more.
- **Both cameras see one checkerboard at once**, confirmed from the saved stills — frontal in the
  C920, about 90 degrees off in the C922. Extrinsic calibration has its shared view. Use a PRINTED
  board: the test used an iPad, and the C922 frame is badly backlit and glared.
- **Chromium's capture stack, not ffmpeg.** There is no ffmpeg on this machine, and if gesture
  capture lives in the renderer this is the stack it will use. Two honest limits: getUserMedia
  cannot demand MJPEG (Chromium chooses, and asks for MJPEG at 720p30 on UVC hardware), and exact
  width/height constrain the track, which Chromium may satisfy by rescaling a different native
  format. Starved bandwidth still shows as delivered FPS, which is what is measured.
- **The first run of the gate reported a false failure:** 0 fps on both cameras for 48 s at 720p,
  then a clean 30. `requestVideoFrameCallback` counts PRESENTED frames, and Chromium throttles
  presentation while its window is behind another. The playback-quality counters showed 1,846
  frames delivered per camera throughout. The gate now counts `totalVideoFrames` deltas, disables
  background throttling and keeps its window in front. Any future capture measurement in this repo
  must count delivery, not presentation.

## 2026-09-11 — Hand tracking is not the bottleneck; jitter is

`tools/gesture-gate.mjs`: MediaPipe HandLandmarker (`@mediapipe/tasks-vision` 1.0.1, float16 model,
GPU delegate), one landmarker per camera, both running at once, 45 s, 1280x720.

| | C920 | C922 |
|---|---|---|
| landmark fps | 26.1 | 20.9 |
| frames with a hand found | 100% | 100% |
| inference per frame | 7.74 ms | 4.90 ms |
| fingertip jitter, hand held still | 8.1 px rms, 14.1 px p95 | 13.2 px rms, 22.9 px p95 |

- **Inference is cheap.** 12.6 ms for BOTH cameras out of a 33 ms frame budget, so a 3D solve and a
  gesture classifier fit on top without dropping below camera rate.
- **The fps shortfall is the harness, not the hardware.** Both cameras are processed serially inside
  one `requestAnimationFrame` tick. Per-camera `requestVideoFrameCallback` loops should recover the
  last few frames; the camera gate already proved 30 fps of delivery is there.
- **Jitter sets the interaction, and it is the real constraint.** 8.1 px rms is 0.63% of frame width.
  Mapped onto a 1920 px board view that is about 12 px of cursor movement — three quarters of a
  16 px tile — with p95 excursions of a full tile. So:
  - raw landmarks are never fed to the board. Smoothing is mandatory (one-euro or exponential).
  - a pinch-drag snaps to the 16 px grid, with a dead zone of at least one tile before the first
    step, or a held pinch walks between cells on its own.
  - dwell, not click: any discrete gesture needs a hold time, because a single-frame classification
    at this jitter will fire on noise.
- **The C922's jitter is 60% worse than the C920's**, which matches its picture: it is backlit by the
  window and dark. Light the volume evenly before blaming the model.
- **MediaPipe cannot be loaded from `file://`.** It fetches its wasm and the `.task` model, and
  `fetch` is refused on that scheme, so the gate serves them from 127.0.0.1. The app will need the
  same treatment — a custom protocol handler or a bundled asset route — since docs/07 forbids
  loading remote code into the main window. The model lives OUTSIDE the repo
  (`%LOCALAPPDATA%/SkynetOS/vision/hand_landmarker.task`, 7.8 MB) for the same reason whisper does.

## 2026-09-11 — Vision loads from its own origin, and the CSP stops it phoning home

MediaPipe cannot run on a `file://` page: it fetches its wasm, injects a `<script>` for the glue,
and compiles a module at runtime. Three attempts, and the order matters because the second failure
is not the one anyone expects.

1. **Wasm and model behind a privileged `skynet://` scheme, page left on `file://`** — refused, and
   not by CSP. Chromium blocks it at the CORS layer first: "Cross origin requests are only supported
   for protocol schemes: chrome, chrome-extension, chrome-untrusted, data, http, https." A
   privileged custom scheme cannot rescue a `file://` origin.
2. **Inline module script on the probe page** — refused, correctly, by `script-src 'self'`. That was
   the probe's fault, not the design's: the built renderer's script is a file, so a probe with an
   inline script tests a page we would never ship.
3. **The whole page served from `skynet://vision`** — works. The bundle, the wasm and the model are
   then SAME ORIGIN, `'self'` covers all three, and the scheme never appears in the CSP at all.

So the vision page is served by `protocol.handle('skynet', …)` from an explicit route table —
`/index.html`, `/vision_bundle.mjs`, `/wasm/<file>`, `/model` — with no path resolved against a
directory. Registered `{ standard: true, secure: true, supportFetchAPI: true, stream: true }` and
deliberately NOT `bypassCSP`.

Its CSP, verified against a real landmarker init:

```
default-src 'none'; script-src 'self' 'wasm-unsafe-eval'; connect-src 'self';
img-src 'self' blob: data:; media-src 'self' blob:; style-src 'self' 'unsafe-inline';
object-src 'none'; base-uri 'none'; form-action 'none'
```

- **`'wasm-unsafe-eval'` is the only concession**, and it is unavoidable: it permits WebAssembly
  instantiation and nothing else — not `eval`, not inline script, not remote script.
- **`worker-src` is NOT needed.** Tested: MediaPipe's main-thread path creates no worker.
- **`connect-src 'self'` is load-bearing.** On startup MediaPipe tries to POST to
  `https://odml.pa.googleapis.com/v1/log`. The CSP blocked it and the landmarker ran anyway. For a
  feature whose premise is that camera and microphone data never leave this machine, that directive
  is the enforcement, not a formality. It must never be widened on this page.
- **A separate page, not the board's.** The vision window gets its own HTML entry, its own session
  partition and its own CSP, so the board window keeps `script-src 'self'` with no wasm allowance —
  and camera permission can be granted to the vision window ALONE.
- **Found on the way: main sets no permission handlers at all**, so Electron's defaults decide who
  may open a camera or microphone in every window, including the board's. Closed as part of this
  work: deny by default on the default session, and grant `media` only on the vision partition.

## 2026-09-11 — A hand is a pointer: gesture reuses the board's own drag

The board already knows how to drag a node: hit-test, a movement threshold, drop validation against
every other footprint, a snap to the 16 px grid, and ONE `node.move` committed on release so one
Ctrl+Z puts it back. That is the hardest code in the renderer.

So gesture does not reimplement it. `ui/useGesture.ts` SYNTHESISES `pointerdown`, `pointermove` and
`pointerup` at the mapped screen position, and the existing drag runs unchanged.

- **Two properties of BoardCanvas make this sound, and both were checked, not assumed:**
  `pointermove` and `pointerup` are bound to `window` rather than the canvas, so a drag completes
  wherever it ends; and `setPointerCapture` is already inside a `try` with a comment calling it a
  nicety — which is exactly what a synthetic pointer id cannot give.
  - Rejected: a second drag implementation for gesture. It would be a copy of the subtlest code in
    the app, drifting from the original with every fix, and the group-drag and drop-validation rules
    would have to be duplicated exactly.
- **The x axis is mirrored, and the mapping uses the middle of the frame.** The camera faces
  William, so his hand moving to his right moves to the image's left; not mirroring feels like
  reversed steering, and no practice fixes it. Only x 0.18–0.82 and y 0.15–0.85 map to the viewport,
  because a hand at the frame's edge is half out of it and its landmarks are worst exactly there.
- **Attribution is kept honest separately.** `inputSource` in the store makes `runCommand` attribute
  a gesture-driven move to the `gesture` actor, so the history says which hand moved a node. It
  grants nothing: `asWilliam` folds it to `user` for the phantom rules, and a destructive command
  from `gesture` still has no `approved` flag and stops at the dialog (test/actors.test.ts).
- **The cursor is moved by writing a transform to a DOM element**, never through React state. At 26
  events a second, re-rendering the chrome to move a dot would cost more than the landmarking does.
- **Manual control is a HUD chip, not a new panel.** It then takes part in the layout manager's
  compaction (ui/chrome-layout.ts) and cannot overlap anything. The board also takes an outline, as
  Edit Board mode does: a mode nobody pressed a key to enter has to be visible without being read.
- **Permissions, narrowed rather than blanket-denied.** The first pass refused everything on the
  default session and silently broke three `navigator.clipboard.writeText` calls (the resume
  command, the About block, a mailbox message), which Chromium gates behind
  `clipboard-sanitized-write`. That one permission is allowed; `clipboard-read` stays refused, since
  reading the clipboard is how a page learns what you copied somewhere else.
- **Still open:** the claude.ai conversation window's own partition keeps Electron's default
  permissions. Denying everything there would also take away whatever claude.ai's voice features
  ask for, which is William's decision rather than a side effect of this work.

## 2026-09-11 — Two traps found by making manual control actually run

Manual control came up saying "starting" and stayed there. Both causes are the kind that leave no
error anywhere, so both are written down.

### `protocol.handle` registers on ONE session, and it is not the one you meant

`protocol.handle(scheme, …)` from the top-level module registers on `session.defaultSession` alone.
The vision window runs in its own partition — deliberately, so that `media` can be granted to it and
to nothing else — and **a partitioned session has its own protocol registry.** So the window's
request for its own page reached no handler at all. `loadURL` never resolved, the page never ran, no
report was ever sent, and the status sat at "starting" for ever. Nothing logged; nothing failed.

The fix is one line: `session.fromPartition(PARTITION).protocol.handle(…)`. The lesson is bigger —
a custom scheme and a partition must be registered together, and `registerSchemesAsPrivileged` being
global makes it look as though the handler is global too.

It was found by `tools/vision-page-probe.mjs`, which loads the BUILT page over the real scheme with
the real preload and logs every request, every console line and every report. Worth keeping: the app
started by `tools/boot.mjs` has `stdio: 'ignore'`, so its own logs are unreadable by design.

**A probe must write to a file, synchronously.** The first run of that probe printed nothing at all:
Electron's stdout through a pipe is block buffered, so the hang it was built to diagnose swallowed
the whole log. It now appends every line to `.vision-probe/page-probe.log` as it goes.

### A hidden window's video pipeline is throttled, and `backgroundThrottling: false` does not cover it

Measured, both cameras landmarking at once:

| vision window | C920 | C922 |
|---|---|---|
| hidden (`show: false`) | 11 fps | 9 fps |
| shown | 20 fps | 15 fps |

So the window is now a small **camera monitor** in the bottom-right corner of the work area: 336x210,
frameless, `skipTaskbar`, click-through (`setIgnoreMouseEvents`), and `focusable: false` so it can
never take the keyboard from the board — a gesture rig that stole focus would break every shortcut
the moment the cameras came on. It is useful in its own right while aiming the cameras.

- `gesture.preview: false` in settings.json hides it again, at roughly half the frame rate.
- `streamMode` hides it whatever that setting says. docs/07: a stream must not carry the room.
- This is the same family as the earlier false failure (presented frames versus delivered ones).
  Anything in this app that measures or depends on a camera must state whether its window was
  visible, focused or occluded, because all three change the answer.

## 2026-09-12 — Gestures are movements, and most of the work is refusing to act

William's specification, and what it changed.

### A gesture is one to three keyframes, not a pose

`GestureSample` now holds `keyframes: number[][]` — "gestures aren't single hand positions but
movements between hand and arm positions". One keyframe is a posture held; two is a move from one
shape to another; three carries a middle the movement must pass through, which is what separates a
deliberate arc from two unrelated poses that happened in order. The library version went 1 → 2 and
a version 1 file is MIGRATED on read rather than discarded: those were recordings of a real hand.

### The catalogue ships with the vocabulary, untrained

Fourteen built-ins: CURSOR, REST, LEFT CLICK, DOUBLE CLICK, CLICK DRAG, RIGHT CLICK, ZOOM IN,
ZOOM OUT, SCROLL, BOTH FISTS, and four postures whose entire job is to be ignored — ONE FIST,
HOLDING A MOUSE, HOLDING A PHONE, ON THE KEYBOARD. They are in the catalogue from first run so they
can be seen, trained and tuned; each shows `0/4` until it has examples, and an untrained gesture is
not in the machine at all. A built-in cannot be deleted (it would return on the next launch, so the
catalogue offers OFF, which is honest) and its name, kind, keyframes and action are fixed while its
examples and tuning are William's.

**Recognising a pose in order to do nothing is the most valuable half.** A rig that cannot tell
working from gesturing acts while you work.

### One gesture, two meanings, decided by context

Both hands in separate fists ends a zoom AND locks it, and suspends every input for three seconds.
Those are the same movement of the hand, so they are one trained gesture; the state decides which
applies. A locked zoom stays locked until zooming is started again from its opening pose — or until
the hands come down, without which a rig with no trained ZOOM examples could never clear a lock.

### The machine is pure, and the hand that carries it out is not

`packages/shared/gesture-control.ts` decides: the certainty gate (below it, input is discarded
rather than guessed at), the suppression postures with a dwell so a shape passed through is not
mistaken for a rest, the halt, the zoom lock, the drag-versus-click hold, and the double-click
window. It takes frame timestamps and owns no timers, so a three-second halt is tested in a
millisecond. `ui/useGesture.ts` then synthesises the events the board already listens for — pointer,
wheel, contextmenu, keys — so the existing drag, context menu and zoom run unchanged.

Continuous values stay geometric and identity stays trained: a classifier answers "which gesture",
never "where is the cursor".

### A trained gesture carries WORDS, and that is the interconnection

`ui/actOnIntent.ts` is now the single consumer end: words in, action out. A gesture's utterance goes
through exactly the grammar a spoken sentence goes through, so gesture and voice cannot drift apart
and a gesture can do anything William could say and nothing he could not.

### The zero-sentinel bug, twice, and now written down

Seven control tests failed at once because `0` meant both "not started" and the timestamp zero: a
pinch that began at 0 could never become a click. The identical bug had already been fixed in the
tracker, where a hand first seen at 0 could never be considered lost. **Every "when did this start"
in this codebase is `number | null`.** Frame timestamps legitimately start at zero.

## 2026-09-12 — The tracking engine, rebuilt: measure the three critical controls, do not classify them

William: "it seems to be the least recognized gesture and most often confused with simply clicking …
they are similar but they are adjacent actions so their poses MUST be similar for the gesture
control to flow."

That diagnosis was right and it condemned the first design. Cursor, click and right-click were three
CLASSES in a nearest-neighbour vote. They are not three poses. They are ONE posture separated by two
continuous quantities, so a classifier asked to choose between them must fail — and the better they
are trained to resemble each other, the worse it gets.

### What replaced it (packages/shared/hand-metrics.ts)

Interpretable measurements, all scale-free:

| | what it is | what it decides |
|---|---|---|
| `aperture` | thumb tip to index tip, in hand spans | cursor ↔ click ↔ drag |
| `extension` | tip-over-knuckle distance, per finger | which posture family the hand is in |
| `roll` | angle of the knuckle line | its CHANGE is the right click |
| `palmRatio` | palm width over length | how square the hand is to this camera |
| `spread` | index tip to pinky tip | an open hand from a gathered one |

- **The cursor follows the POSTURE and ignores the aperture**, so closing the fingers to click never
  interrupts pointing. There is no recognition to fail.
- **A click is an aperture crossing**, with hysteresis; held past 350 ms it is a drag instead.
- **A right click is roll velocity** — 0.7 rad inside 350 ms — and only if the fingertip stayed put.
  A sweep of the arm rotates the hand too; requiring it to stay in place is what separates a twist
  from a wave.
- Classification is kept for what it is good at: the postures trained to be IGNORED, the halt, and
  gestures William adds himself.

Two thresholds were wrong on the first pass and were corrected against measurements: an extended
finger reads 1.43 on the extension ratio and a curled one 0.70, so "gathered" belongs at 1.15, not
the 1.45 that called an open palm gathered. And requiring the index to be EXTENDED for the pointing
posture would have dropped cursor control at the exact moment of a pinch — a real pinch curls it.

### Thresholds that tune themselves (packages/shared/adaptive.ts)

"Dynamically tune the sensitivity … to standardize the intensity and responsiveness." A fixed number
for "the fingers are touching" cannot survive different people, distances and lenses. The model
watches where this hand's own open and closed extremes sit — quick to follow a new extreme, slow to
forget one — and puts the thresholds a third and half of the way between them. It only learns from
frames where the hand is in the pointing posture, so a fist never teaches it what "open" means, and
the extremes can never collapse onto each other.

### The picture is corrected before it is analysed, and judged before it is believed

(packages/shared/frame-quality.ts) Two jobs, deliberately separate:

- **Correct** what can be corrected: a dim frame is redrawn brightened and contrast-stretched for
  the landmarker, and ONLY then. The preview stays raw, because a preview that silently fixes itself
  hides the problem the user has to solve.
- **Reject** what cannot: black, blown-out and motion-blurred frames are skipped entirely.

A frame can be good enough to TRACK from and still not good enough to LEARN from, and the two have
different thresholds: a poor frame costs one frame of tracking, while a poor training example
poisons every comparison it takes part in for as long as it is stored — which has already happened
here once.

## 2026-09-11 — Hands have roles, training has a conscience, and gestures have variants

### A hand is assigned a role every frame, instead of `hands[0]` being assumed to be the point

(packages/shared/hand-roles.ts) William: "I don't think the program is easily interpreting the
difference between one hand resting, both hands resting, one hand up one down … the cursor only
appears to work when both hands are present."

Both faults had one cause. MediaPipe returns hands in no guaranteed order, so `hands[0]` changed
frame to frame and a hand resting on the desk was as likely to be picked as the one being pointed;
and the two-handed zoom test was `hands.length >= 2`, so a resting hand beside a pointing one put
the machine into a zoom and took the cursor away.

Roles are now assigned explicitly from three things a camera can see: WHERE the hand is (a
title-safe action boundary, because the edges of frame are where hands are half-visible), WHAT
SHAPE it is in, and HOW WELL it can be read. The driver is sticky — a hand keeps the cursor unless
another is clearly better — because two raised hands otherwise swap the pointer several times a
second.

**Alternatives rejected.** Handedness from the landmarker's own `handedness` field: it is a guess
about left versus right, which is not the question — the question is which hand is asking to drive,
and a left hand may be either. Nearest-to-last-position: it locks onto whichever hand moved least,
which is the resting one.

### Zoom needs two RAISED hands, not two pointing ones

A first attempt required both hands to be in the pointing posture, which was wrong on its face: a
zoom is made with cupped or open hands. The test is that both are up, in shot and readable —
`raised` — which is a different question from whether either wants the cursor.

### The wizard's shutter is gated twice, because pacing is a correctness problem

(src/renderer/vision-train.ts) William: "slow down the calibration / learning mechanic, at some
points it seemed to take the image / sample after I stopped or before i started."

The old capture fired every 1200 ms regardless. Half of what it banked was a hand on its way into
or out of the pose — the worst possible training data, because those poses sit in the space BETWEEN
two gestures, which is exactly where the classifier has to draw its boundary. There is now a
visible countdown (3 s before the first keyframe, 1.8 s between keyframes, 2 s between takes) and a
steadiness gate: the shutter waits for four consecutive frames within 0.045 hand spans of each
other. Measured, not chosen — landmark noise on a still hand is about 0.02 spans frame to frame, a
hand moving between poses covers 0.15 or more. The timeout fires anyway after 2.5 s, so an honest
tremor cannot deadlock it; only visible motion blocks.

### A cropped thumbnail of the hand, which is a picture, and is still not a recording

William asked for "a cropped screenshot of the hand for each keyframe it's attempting to capture",
alongside his standing rule that "no images or data is recorded until the user clicks on onscreen
prompt". Both hold at once, and the distinguishing word is RECORDED: the thumbnail is a data URL in
a page that is about to be closed, drawn only from a keyframe a capture the user started has just
banked, never written to disk, never sent over IPC, and impossible to store — `gesture:addSample`
takes 42 numbers per keyframe and has no field that could carry an image. It exists because a
number cannot explain a refusal and a picture of his own hand at the moment of the shutter can.

### Alternative takes, on the Face ID model

(`SampleVariant` in packages/shared/gesture-library.ts) William: "for each captured gesture the
interface should offer to also capture an alternative gestures set that is the user explicitly
doing a poor job of the gesture or other angles … sort of like the 'add other fingers' or 'with a
mask' or 'with glasses' Face ID features."

He is right, and the reason is worth stating: a class trained only on careful examples has its
boundary drawn around careful examples, so the gesture works while you are paying attention to it
and stops the moment you are not — which is the moment you want it. Five labelled sets: clean,
rough, angled, other-hand, far. Labelled rather than thrown in anonymously, so the catalogue can
show which exist and the audit can say which KIND of example broke a gesture. Variants are offered
only once a clean set exists, and the sample cap keeps at least MIN_SAMPLES clean ones, because the
variants widen a boundary — they do not define a centre.

### The catalogue audits itself, because training could silently break everything

(`libraryHealth`) William: "After the last training most of the gestures don't seem to be working so
also ensure the gesture learning and calibration isn't accidentally breaking the entire feature."

It could, through a hole that was real. `judgeSample` refuses an example landing on top of another
gesture — but only against gestures that already have MIN_SAMPLES, so training the catalogue in
order records the first gestures before anything is complete enough to collide with. By the time
the guard is armed, the damage is on disk. And it is GLOBAL damage: nearest-neighbour has no
per-class isolation, so one example of ON THE KEYBOARD taken with the fingers half-pointing sits
nearer to CURSOR than CURSOR's own examples do, and every attempt to move the pointer classifies as
a suppression pose. Nothing looks broken. One number moved.

The audit is the classifier's own decision rule turned back on the training set, with a second test
that matters more than the first:

> A sample is at fault if it is nearer to a DIFFERENT gesture than to its own siblings **and** it
> does not belong with its own siblings either.

The second clause is not decoration. Without it, an intruder landing on CURSOR condemns the
intruder AND every CURSOR sample — all of which are also nearer to the intruder than to each other
— so a repair would delete the gesture that did nothing wrong. The intruder sits a quarter of a
hand span from every real example of its own class; a genuine CURSOR sample sits two hundredths
from its siblings. That is what separates them. The endangered class is marked `watch`, shown, and
left alone.

`gesture:repair` drops only what the audit condemns. The board's catalogue shows the verdict as a
banner, because a count of examples cannot show this fault — every gesture had its four.

### Retry, and the keyframe editor, are destructive and ask twice

`gesture:resetSamples` and `gesture:setFrames` both destroy recordings, so both arm on the first
click — the button relabels itself with the number it would take — and act on the second. docs/07
allows destruction when the click that approves it names what it is approving. Changing the
keyframe count has to discard the examples rather than pad them: a two-keyframe take cannot answer
what a third keyframe looked like, and padding one would invent a pose that was never made.

### CLOSE THE BOOK is handled in main, not on the board

The gesture that switches manual control off is intercepted in `visionEvents` before being
forwarded. Switching the cameras off is main's job, and — more to the point — the way OUT of
gesture control must not depend on the board being responsive, since a rig that has started
misreading every pose is precisely when it is needed. It is still forwarded, so the board can put
its crosshair away.

### The wizard's buttons are pinned outside the scroll, and a probe proves it

William, within minutes of the above landing: "I got stuck in the opening calibration screen
because the buttons didn't render." They had rendered. The training window is a fixed 820x620 with
`overflow: hidden`, the intro flow needed about 706 px once the countdown, the thumbnail strip and
the keyframe editor were added — eighty pixels of furniture present on every phase whether in use
or not — and START and NOT NOW were simply below the fold, with nothing on screen to say so and no
way to scroll and find out. A dead end reached by pressing the only visible control.

Three changes, in order of how much they matter:

1. **The buttons cannot be what gets clipped.** `.wz` is a flex column from `body.training` down;
   everything except the action row lives in a scrolling `.wz-body`; the action row is
   `flex: 0 0 auto` outside it. A layout where the controls are the first thing to go is a layout
   that can trap the user, so the controls are now the one thing that cannot go.
2. **Empty furniture takes no room** — `:empty` on the countdown, the strip, the keyframe row and
   the dots.
3. **The previews give first**: `clamp(120px, 24vh, 220px)` rather than a flat 220, since the TRAIN
   phase carries three panels the AIM phase does not.

**`tools/wizard-layout-probe.mjs` (`npm run gate:wizard`).** Arithmetic could not have settled
this — wrapping, `clamp()` and flexbox are decided by a layout engine — so the probe runs the real
one at the real window size and asks, for all six phases including their worst-case content, whether
every button is inside the viewport. It holds down to a 150 px viewport and reports FAIL below that,
naming the buttons that fell off, so the check is not a rubber stamp. No camera is opened: the
page's script is stripped and only its markup and stylesheet are loaded.

Two landmines were paid for on the way. Playwright is installed but its browser is not downloaded,
so the probe uses Electron — which is the more faithful runtime anyway. And a top-level `await` in
an ESM Electron entry deadlocks `app.whenReady()`, because Electron does not finish bootstrapping
until the entry module's evaluation completes: the work goes inside an unawaited `main()`, as
`tools/vision-page-probe.mjs` already did.

## 2026-09-12 — The vocabulary gets coarser, the data gets a vote

### The shutter is a clock, not a trigger

William: "instead of waiting to capture a hand pose until it's perfectly framed up or detected, do a
countdown of 8 seconds for each pose, and no matter what try to capture any hand detected … on a
simple timer, not a detection trigger." Plus: "often while perfectly posturing my hand in one
position that is a perfect example of a keyframe, the program isn't detecting my hand at all."

The old design had it backwards, and the fault was structural rather than a tuning problem. A
shutter that waits for the tracker to be satisfied makes the tracker the judge of what a good
example looks like — which is circular, and worse: the poses the tracker finds HARDEST are then
exactly the ones that never get recorded, and those are the examples the catalogue most needs. So
the clock runs eight seconds, and whatever is in shot at zero is banked. Only genuine nothing buys
the two-second grace, in red.

Alongside it, training now runs the landmarker at 0.15 for detection, presence and tracking rather
than 0.5. The defaults are right for CONTROL, where a false positive moves his cursor; they are
wrong for TRAINING, where a miss costs a pose held for nothing and a marginal detection costs
nothing at all — a poor example is caught downstream by `featuresOf`, the frame-quality gate and
the health audit, none of which care how confident the landmarker was.

### Both cameras are catalogued, not just the driver

"At least visually within the ui only one of the angles is being catalogued; when it seems like both
angles should be catalogued." Both are now: the shutter reads every running camera and banks one
example per camera per take, each tagged with its own lens. The same hand from two angles is two
genuinely different pieces of evidence, and throwing one away was waste. The thumbnail wall shows a
row per camera, so it is visible that both contributed.

### Three hand modes, because there are three cases

"The ability for the program to distinguish between a gesture being done on one hand, a two hand
gesture, or one gesture being done on both hands."

`one` / `two` / `both`, declared per gesture and never inferred — inferring it from what is in shot
would make a gesture two-handed whenever a second hand happened to be resting on the desk, which is
the exact confusion `hand-roles.ts` was built to end. `two` means the hands do DIFFERENT things and
the gesture is the relationship between them (a zoom is not two hands each zooming). `both` means
the same shape mirrored, which is what keeps BOTH FISTS from being recognised from one fist and one
fist from being read as half of it. The second hand is stored on its own track, `offhand`, so
everything that reads the main hand carries on working unchanged.

### Travel gestures: two points, not two shapes

"Some gestures like a click and drag / scroll is simply a gesture from two different points on
screen … prompt the user which points in-frame to use as their start and finish points."

A `travel` gesture's prompts ask for a START position and a FINISH position, and every sample now
records `path` — the palm centre at each keyframe. Two numbers per keyframe, recorded for every
gesture whether or not it travels, because it is the only way to answer "how far does he actually
drag?" from evidence instead of from a constant.

### The new vocabulary, and the built-in it killed

Open hand to cursor. Closed fist to click. Fist held and moved to drag. Open hand closing into a
peace sign to right click. William's reasoning is right and worth recording: the old cursor pose was
a held-open pinch, a precise shape, and a precise shape competes with the click sitting next to it
and loses tracking the moment attention moves. Fewer, coarser, more separable poses beat more, finer
ones.

This retired a shipped gesture. ONE FIST existed to be IGNORED — a fist moved around casually was
trained as "not a gesture". With a fist as the click, that class now says "never notice the click",
and no audit could resolve it because both classes would be behaving exactly as trained.
`RETIRED_BUILT_INS` drops it on read, with its examples, because they were examples of a rule that
no longer exists. A retired built-in must be removed rather than merely dropped from the table:
`sanitiseLibrary` keeps whatever is in the file, so without this it would linger for ever as a
gesture nobody can delete.

### The endless variant run, and why a confirmation fixes it structurally

"On one of the gestures I got stuck in an endless Alternative angle training that wouldn't end
unless I hit stop." Real: the run ended on `takes >= 4`, and only a SUCCESSFUL take incremented
`takes`. A variant run whose takes were all refused as near-duplicates therefore looped for ever.
Every take now ends at a confirmation — which is what he asked for independently — so nothing
starts another take on its own and the loop cannot exist. There is also a BACK button, per his
"I accidentally clicked past one of the gesture trainings and had to cycle all the way back".

### Handedness: one calibrated fact, because two guesses made two bugs

William, within minutes: "it appears the inputs may be horizontally inverted - it continually
thinks my right hand is my left hand." He was right, and the first attempt at this was wrong in a
more interesting way than a flipped default.

TWO pieces of code had each made their own guess about mirroring. The camera page swapped MediaPipe's
handedness label (MediaPipe labels on the assumption of a mirrored selfie frame). The wizard, quite
separately, hard-coded "the person's right hand is the one further LEFT in frame" as the fallback
for when a label cannot be read. A toggle that fixed the first would have silently left the second
wrong — so the correction offered could not have fully worked even once it was found. And the
correction was written into the calibration profile and never read back, so it could not have
survived a restart either.

Whether a webcam hands over a mirrored frame is a property of the camera and its driver; it cannot
be known in advance. So it is now ONE fact — `mirrored` on the calibration profile — answered by the
person in front of the camera, loaded back on the way in, and both rules derived from it:
`sideFromLabel` for the labels and `rightHandHasSmallerX` for the position fallback. The camera page
now passes the landmarker's label through untranslated, because interpreting it needs a fact that
page does not have.

The default flips to `mirrored: true`: most webcams present a looking glass, which is why a video
call does. But a default is only what holds until he is asked, and the asking is phrased as a hand
question rather than a camera question — he holds up his right hand, the advice line names what it
thinks that is, and one button flips it while the readout updates to agree. There is no way to
answer it incorrectly and no need to understand mirroring at all. The same button sits on the
gesture card too, because he hit the inversion while TRAINING rather than while aiming, and a fix
he has to leave the screen to reach is a fix he will not make.

`test/handedness.test.ts` pins the invariant that actually matters — not that the default is right,
which no default can be for every camera, but that the two rules can never disagree and that
flipping the one fact flips both.

(Also fixed: the keyframe thumbnails were being mirrored while the preview was not. There is no
`scaleX(-1)` anywhere on the page — the mirroring is in the cursor mapping, not the display.)

### `gesture-analysis.ts`: the data gets a vote

"I want to ensure you're working on this gesture program with great detail and interconnected data
analysis that actually uses data sets and the training data to genuinely iterate and improve on its
algorithm."

Up to now the catalogue could only grow. It could say how many examples a gesture had, and since the
health audit which ones were poisonous, but it could not answer WILL THIS WORK and could not use its
own recordings to improve anything. Two additions:

**Leave-one-out accuracy.** Each example is removed, classified against everything that remains, and
checked for coming back to its own gesture. That is exactly the decision the tracker makes at run
time, so the number is real. Scoring a nearest-neighbour classifier against its own training set
without removing the sample first reports 100% for ever, because every sample is zero from itself —
a measurement that cannot fail measures nothing, and there is a test whose whole job is to prove
this one can fail.

**Thresholds fitted per gesture.** One shipped constant cannot be right for every gesture: an open
hand varies far less between takes than a peace sign does. Each threshold is now fitted from two
measured quantities — the 90th percentile of the distances between a gesture's own examples, and the
closest any other gesture gets — and placed at their GEOMETRIC mean, because these are ratios rather
than positions. A class whose rival is nearer than its own scatter cannot be separated by shape at
all and is reported as such rather than given a threshold that pretends otherwise. `TUNE FROM MY
DATA` in the CHECK phase writes them in and shows accuracy before and after.

**And the interconnection.** Shape alone CANNOT separate a drag from a scroll: both are a closed
fist, and their first keyframes are identical because they are the same pose. Any analysis looking
only at hand shape would report them as hopelessly confused and would be right to, while being
useless. So travel gestures carry a measured axis taken from the paths actually recorded, and a
confusion between two travel gestures on different axes is reported as resolved by travel rather
than as a fault. The shape data and the path data only mean anything together.

## 2026-09-12 — A stable baseline for the five controls, built from geometry up

William: "most of the gestures in the gesture control feature don't work … I think that my training
images I provided during gesture training aren't quite cutting it. I need you to help me develop a
stable baseline for at least the MAIN 5 gestures." And: "I need the infrastructure and math behind the
geometry / image detection to be highly advanced."

### It was not the training data

Three faults, found by reading the live path and then by rendering an honest synthetic camera:

1. **No hand could drive.** `assignHands` gave the cursor only to a hand in the POINTING posture — the
   old vocabulary. An open hand and a fist both fail that test, so under the new vocabulary no hand ever
   drove, and the only gesture that worked was zoom, which ignored hand shape. That is exactly "the zoom
   feature is the only one starting to work".
2. **Upright hands were measured 44% too narrow.** `hand-metrics.ts` took distances in normalised image
   coordinates, where x is divided by the width and y by the height. At 16:9 an upright palm's width and
   length are in different units, so its width-to-length ratio read far too low and the readability gate
   called it "edge". Invisible to the old test hands, which were laid out in square coordinates; found the
   moment the synthetic camera rendered a real 1280x720 frame. Metrics now take the aspect ratio; the live
   controller passes 16:9.
3. **The pointer was on a fingertip.** Closing into a fist moves the index fingertip 22% of the frame
   width, so every click landed somewhere other than where he aimed.

### Four layers, each in its own file and tested on its own

- `hand-geometry.ts` — the shape of a hand in 3D.
- `pose-model.ts` — which pose, as a probability.
- `one-euro.ts` — the cursor filter.
- `gesture-control.ts` — time: smoothing, hysteresis, clicks, drags, zoom.

And three tools: `hand-synth.ts`, a kinematic hand with a pinhole camera that generates any pose from any
angle; `npm run gesture:eval`, which scores the model on it; and `npm run gesture:probe`, which proves the
pre-trained model runs in Electron without opening a camera.

### Geometry: what the measurements forced

- **Summed joint angles failed under noise.** Flexion angles are exactly invariant to the view, and on a
  noisy synthetic hand they scored 42%. An unsigned angle cannot average out — noise on a straight finger
  always reads as some bend — so the estimator is biased, worst of all for the open hand. The test that
  shows the bias is kept in `test/hand-geometry.test.ts`.
- **Curl is now REACH:** how far the fingertip gets along its finger's own ray, over the finger's length.
  Signed, monotone from straight to closed, and a projection over about 80 mm, so under the same noise it
  varies by 0.03–0.08.
- **Points are fused:** x and y from the image landmarks, which are the most precise output, and depth from
  the world landmarks, scaled by a least-squares fit. Perspective is then undone exactly — a point at depth
  z from the hand's centre is magnified by Z0/(Z0+z) — using a 70° horizontal field of view (C920/C922).
  Before that correction curl drifted by 0.07 at the extreme views; after it, it holds to 0.02 over yaw ±70°,
  pitch ±40° and roll ±45°, and world landmarks alone hold to 0.005.
- **The palm's side comes from anatomy** — fingers curl towards it, the thumb rests in front of it — and is
  right for either hand on raw and mirrored cameras. Never from the handedness label.
- **The V is the gap between index and middle fingertips,** weighted by how straight the two are.

### The pose model

Six features per hand: thumb reach, four finger curls, the tip gap. Each class is a mixture of Student-t
densities (ν = 4): heavy tails, so one badly-tracked finger costs confidence rather than the pose.
"None of these" is a MIXTURE of components placed on the known near-misses — two fingers together, a
thumbs-up, a hand mid-motion — because a single broad background density, even fitted to the data, still
called two out of three near-misses a control. The shipped priors lean deliberately towards the controls: a
missed click is noticed every time; a thumbs-up read as a click is a gesture he does not use.

His recordings sharpen it through a conjugate update with the prior worth six examples, and a floor on how
certain any class may become. Samples now store the seven pose features per keyframe; recordings made before
today do not have them and sharpen nothing until re-recorded.

Measured with `npm run gesture:eval` — 3,240 frames per run, 45 views, both hands, raw and mirrored cameras,
7° of joint variation, 3 px image and 4 mm world noise:

| pose | per frame | three-frame mean | oracle (fitted, held out) |
|---|---|---|---|
| open, flat | 100.0% | 100.0% | 100.0% |
| open, relaxed | 98.1% | 100.0% | 98.9% |
| fist | 99.6% | 100.0% | 97.6% |
| fist, thumb beside | 100.0% | 100.0% | 98.3% |
| peace | 96.5% | 98.3% | 95.2% |
| two together, rejected | 79.1% | 85.0% | 82.8% |
| thumbs up, rejected | 64.3% | 75.6% | 84.8% |
| mid-motion, rejected | 100.0% | 100.0% | 99.6% |
| all, at yaw 0° / 35° / 70° | 96.9 / 94.6 / 89.6% | 98.1 / 97.1 / 92.4% | 98.3 / 96.9 / 92.1% |

These measure the maths. The renderer does not model how MediaPipe itself degrades when a hand is edge-on,
so they are an upper bound on the real system, not a claim about it.

### The pre-trained model

MediaPipe's GestureRecognizer: `gesture_recognizer.task`, float16 version 1, 8,373,440 bytes, SHA-256
97952348cf6a6a4915c2ea1496b4b37ebabc50cbbf80571435643c455f2b0482, stored in
`%LOCALAPPDATA%/SkynetOS/vision/` beside the hand model and outside the public repo. It is the same landmark
network with a classifier Google trained on a large labelled corpus; Open_Palm, Closed_Fist and Victory are
three of the five. The vision page prefers it and falls back to the HandLandmarker, and the controls work
without it. Because that fallback would fail silently, `npm run gesture:probe` checks it directly: on
William-Desktop it loads under the vision page's CSP in 330 ms and runs at 3.3 ms a frame on the GPU.
Its scores are fused with geometry at weight 0.6.

### The controller

- Pose probabilities smoothed with a 60 ms time constant; a pose entered at 0.6 and left at 0.35.
- The cursor is frozen the moment closure starts rising, so a click lands where he was aiming.
- A fist is released by the hand OPENING, in both directions: a classifier losing confidence mid-drag is not
  a release, and a hand that has opened releases at once rather than two frames later.
- A fist becomes a drag after 320 ms or 3% of the frame of travel; the drag starts where the fist closed.
- A peace sign is one right click per sign, after 150 ms.
- Zoom needs the hands turned towards each other — pointing or facing, as he described it — and steps by
  1.1 palm lengths of separation, which is the step the old zoom used at arm's length.
- The driving hand is kept by position, because MediaPipe does not keep hands in order.
- The second camera corroborates the pose when it sees exactly one hand that could be driving.
- A posture trained to be ignored only wins when the geometry is not confident this is a control.

### The cursor filter

One Euro, chosen from a sweep of rest cutoff, speed gain and derivative cutoff against a still palm and two
sweep speeds: 0.45 Hz, β 12, 1 Hz. Still-hand jitter falls 3.5x on raw landmark noise and 4.1x on the palm
anchor; a sweep at a frame width a second lags by 0.01 of the frame. A plain low-pass equally steady at rest
would lag by 0.35. My first docstring claimed 0.6 Hz met the jitter requirement before it had been measured;
it did not, and the sweep replaced it.

### Left and right are two facts, not one

Earlier today one flag was made to drive both the handedness label and anything reasoned from position. That
was wrong: his report fits a mirrored camera under MediaPipe's documented convention and a raw camera with
labels already right, and the two predict opposite cursor directions. Now `labelsSwapped` corrects the label
and nothing else, and each camera's `mirrored` is MEASURED by the CHECK DIRECTION movement in the AIM phase and
decides the cursor's direction and the position fallback. Unmeasured, a camera is taken as raw — what the
C920 and C922 hand the browser, and what the cursor mapping always assumed without complaint.

### Still to come, named

- **Nothing above has seen William's hands.** Every figure is from the synthetic hand and the tests.
- The readability gate is still a 2D palm ratio, so a hand turned more than about 50° from the driving
  camera is dropped even though the 3D model could read it. It should become a 3D confidence.
- Scroll has no gesture in the new vocabulary.
- The CHECK phase's analysis (`gesture-analysis.ts`) still scores the 42-number catalogue, not the pose
  model. It should score pose features once recordings carry them.

### Still to come, and named so it is not forgotten

- **Per-camera roles from `viewpointOf`.** William's rig is not symmetric — one camera is near
  profile, one head-on — so each should be used for what it is good at rather than being asked to
  agree.
- **A POINT · CLICK · TWIST calibration phase.** With the three critical controls measured rather
  than trained, what needs collecting is not more examples but the RANGE of each: how open is open,
  how closed is closed, how far a twist goes, across the working area.
- **Transition learning:** banking the poses that occur BETWEEN gestures as things to ignore.
- **Voice**, which is designed and specified but not built: the wake phrase, the dock behaviour,
  and the split between a SkynetOS command and a question for the Face.

## 2026-09-12 — Voice, two hands placing the cursor, a steadier click, and THE MATRIX

William asked, in one message: "implement the service that runs the voice control microphone and get voice
control full set up … holding both hands up far apart or close together should be registered as the cursor,
and zoom should always happen on where the cursor is … Single click is the only gesture that isn't running as
smoothly … replace the cursor crosshair thing with a classic windows mouse ui, retro, and replace click and
drag cursor with the closed hand … a globe made up of tiles, a hidden interface … called the MATRIX."

### Voice: a closed wake grammar, then one sentence to a whisper-server on this machine

**Decision.** Three processes, each doing one thing, all stopped by one switch.

1. **The wake phrase** is Windows' own recogniser (System.Speech, in a PowerShell sidecar) holding a
   `Choices` grammar of the wake phrases and nothing else (`wakeScript`, packages/shared/voice.ts). It prints
   `READY`, `WAKE <confidence> <phrase>` and `FATAL`. A closed grammar can only ever return one of its choices,
   so nothing said before the wake phrase can become text.
2. **The sentence** is captured by a hidden window (`voice.html`) in its own partition. That partition may
   use a microphone and nothing else (`allowMicrophoneOnly` refuses any request that includes video), and its
   CSP gives it no network. It opens the microphone only when main sends `voice:listen`, finds the end of the
   sentence by energy (`voice-capture.ts`: 200 ms floor, speech at 3× floor, ends after 700 ms quiet, 8 s at
   most), stops every track first, and hands back a 16 kHz WAV over `voice:captured` — a channel only that
   window may call, and the only channel it may call.
3. **Transcription** is `whisper-server.exe` (whisper.cpp, CUDA) holding ggml-large-v3-turbo-q5_0 loaded for
   as long as voice is on, bound to 127.0.0.1:47831. The service warms it on a synthesised sentence and sends
   no `prompt` field (a prompt field cost a 6.3 s first request when measured).

The sentence then goes through `resolveIntent`, the grammar gestures already use. A command runs. A
sentence that is not a command at all (`understood: false`, new) is shown for 2.2 s with Esc to cancel and
then sent as text to the Face (`prompt:send`). A command that could not be carried out is said and not sent.
"Stop listening", "mute", "voice off" close the microphone; nothing can open it by voice, because nothing is
listening for that.

**Measured, 2026-09-12, William-Desktop, RTX 5070, no microphone** (`npm run voice:probe`, Windows' speech
synthesiser speaking into WAV files, the server started with the service's arguments on a spare port): model
loaded in 1,325 ms; warm-up requests 360 ms then 69 ms; four sentences at 78, 68, 64 and 83 ms, each
transcribed word for word. The probe found a grammar gap — "Zoom in on the board." was sent to the Face as a
question — now a command.

**Rejected.** whisper-stream listening continuously and matching the wake word in its transcript: it
transcribes everything said in the room, which is precisely what the brief forbids. A neural wake-word engine
(Porcupine, openWakeWord): a new dependency and model download for a problem Windows already solves in a
closed grammar. Opening the microphone in the board window: the page that can hear the room must not be the
page that can edit the board.

**Not verified:** the wake phrase and the capture window with a person speaking. That needs William, and a
test that opened his microphone without him starting it would break the rule this design exists to keep.

### Two raised hands place the cursor, and zoom happens about it

**Decision.** In `gesture-control.ts`, two raised open hands put the cursor at the point between their palms
(its own One Euro filter), whether or not they are turned towards each other. Zoom still needs them turned
towards each other, and every zoom event now carries that point. `useGesture.ts` zooms by sending a wheel
event at the point, which BoardCanvas's `onWheel` already handles by keeping the world point under the pointer
fixed; it used to press `+`/`-`, which zoom about the middle of the window. Changing between one hand and two
glides over 160 ms (`handoverMs`) rather than jumping half a frame.

A fist or peace sign made by one of the two hands keeps the controls until it is released (`actingAnchor`).
Without that, role assignment gave the cursor to the other hand, still open, and the click never came — found
by a test, then traced frame by frame.

**Rejected.** A relative ("clutch") two-hand cursor: it drifts away from the hands over repeated use. Requiring
the zoom orientation for the cursor too: William asked for any two raised hands.

### The single click

**Measured first.** Eight new tests (`test/gesture-two-hands.test.ts`) were run against the old machine before
any change: seven failed. Two were real misses rather than missing fields: a quick click with the natural dip of
the hand (3.5 cm down while closing) produced no click at all, and closing one hand while both were raised
produced no click. The very quick click (one frame closed) already passed, so it is not claimed as a fix.

**Decision.**
- A click lands where the cursor was 70 ms before the closing was noticed (`clickLookbackMs`, read from a one
  second trail of cursor positions), not where the hand had drifted to.
- A fist that is unmistakable in a single frame (probability ≥ 0.85 and closure ≥ 0.8) is entered at once
  instead of waiting two frames for the smoothing (`fastEnter`, `fastClosure`).
- Movement starts a drag only after the fist has been closed for 150 ms (`dragSlopMs`); the hold time still
  starts one at 320 ms.
- Click events carry their position; after a click or a drop, the cursor glides back to the hand.

After: all eight pass, and so do the 84 gesture tests that were there before (92). Nothing has been seen on
camera.

### The pointer: a Windows 3.1 arrow, and a closed hand while dragging

Two bitmaps (`ui/cursor-sprites.ts`): the classic arrow at 12×19 with its tip as the hotspot, and a closed hand
at 16×16 with the palm as the hotspot, drawn as whole-pixel SVG rects at `--p` in two palette tokens (mask-dark
outline, silk fill), so they read on the dark board and on light panels. The fill never touches a transparent
pixel (tested). Rejected: a CSS `cursor:` image — Windows scales cursor images by non-integer factors, and the
hand's pointer is a separate element from the mouse's anyway.

### THE MATRIX

**What it is.** G, or the MATRIX button beside MANUAL: every `file.document`, `file.artifact` and `link.url`
on every board (provisional nodes left out), each on a card hovering over a tile of a globe, tethered to it.
Opening it changes nothing on any board.

**Geometry** (`packages/shared/matrix.ts`, pure, 21 tests):
- 12 latitude bands, each cut into as many tiles as keeps them near square (24 at the equator), so tiles are
  close to equal in area.
- No file on a tile reaching within 30° of a pole: 160 of the 184 tiles can hold one.
- Each project is seeded at a tile chosen by a hash of its board id, and its files fill the nearest free tiles
  outward from there, so a project reads as a region. Files that do not fit are counted and reported, never
  stacked.
- Hover height is `log1p(visits) / log1p(most visits)`, between 0.06 and 0.30 globe radii.
- The dolly zoom: the field of view narrows from 46° to 6° while the distance is chosen so the middle card
  grows geometrically on screen to one that covers the view. At 6° the card is effectively flat, and zooming
  out is the same function run backwards.

**Rendering** (`src/renderer/matrix/MatrixView.tsx`): a software rasteriser into a buffer of about 280 rows,
shown at a whole number of device pixels per pixel, nearest-neighbour. Every pixel written is one of the room's
exact colours — mask-dark, mask-light, signal — or silk, with shading by a 4×4 Bayer dither. The far side's grid
shows through, dithered, and a scan line crosses the near side (off under reduced motion). Rejected: WebGL or
three.js (a dependency, and antialiasing and texture filtering to fight for pixel purity); Canvas2D paths
(antialiased edges put colours on screen that are in no palette).

**Input.**
- A drag turns the globe with the surface under the pointer. Letting go while it is moving spins it (slowing
  over a 900 ms time constant), and it settles onto the nearest file. It always ends centred on a file.
- WASD and the arrows go to the next file in that direction, within about 60°. When there is none, a nudge
  shows the key was heard.
- The wheel, `+`/`−` and the two-hand gesture zoom in 25% steps. The wheel zooms onto the file under the
  pointer.
- A click goes to a file; a click on the centred file goes into it. A double click or Enter opens it.
- A right click (or a peace sign) or Esc steps back out; G or Esc leaves.
- While open it swallows plain keys, so the board underneath cannot pan, zoom or change mode unseen.
- Manual control drives it: `useGesture.ts` targets the MATRIX canvas while it exists.

**Visits** are counted in main on every successful `node:open` from the board window (`services/visits.ts`,
`userData/visits.json`: a count and the time of the last), not in the board JSON. An unreadable visits file is
left untouched and counting carries on in memory. `node:visits` is read-only and in neither allowlist.

**Seen:** smoke captures of the built app at rest and part-way in (22 files, 5 projects). They showed cards seen
edge-on at the rim drawing slivers outside the globe — now left out below a cosine of 0.3 — and the words hard
to read over the dither — now on the ground colour. **Not seen:** a live drag, the spin, the keys, or gestures
in the MATRIX.

**Pixel census.** A stdlib PNG decoder counted the colours in the globe region of `07-matrix.png` (887 × 749
px, from the built app): exactly four — mask-dark, signal, mask-light and silk.

### The breadcrumb row, and what the layout audit found

**Found.** The smoke layout audit's first run in this work failed all 56 desktop states and both remote
windows. The breadcrumb was clipped: its `max-width: 26vw` cut the switches, and VOICE was cut in half
below 1920 wide. It also overlapped the usage meter: the switches' borders made the row taller than the
fixed `9 × gap` the meter hangs at. Both come from the row of switches added in uncommitted work — at
`cf8d493` the breadcrumb held no buttons — and MATRIX and VOICE made the clipping worse.

**Decision.**
- The room path truncates; the switches never do. The planner already narrows the HUD to whatever the row
  leaves.
- Below 1100 px wide the switches show their icons alone. This keys off the window width, not the
  planner's own output, so it cannot oscillate.
- The planner now places the usage meter (`usageTop`: where it was, or under the row once the row is
  taller) and LOOK (`lookTop`: under the meter when the two share a column).
- A remote screen does not show MANUAL or VOICE. Neither `gesture:setEnabled` nor `voice:setEnabled` is in
  REMOTE_METHODS, so they could only be refused.

**After.** 50 of 56 desktop states and both remote windows are clean. The 6 that remain are the HUD's own
chips clipped with the inspector open at 1280 and 1024. The first audit already showed those six, and this
work did not change them.

**Rejected.** Icon-only switches at every width: William knows the MANUAL ON button by its words. A second
row for the switches: it collides with the usage meter and the HUD instead.

## 2026-09-15 — Morning maintenance: one de-overlap rule for every chrome plate

An unattended run of the MORNING MAINTENANCE task (`codex/briefs/morning-maintenance.md`), catching up the
08:00 slot. Three small changes, each green on `npm run verify` (98 files, 1,538 tests; was 97 and 1,529).

**The drag badges overlapped, the phantom plates did not.** handoff.md had it since 2026-09-11: at overview
zoom DIRTY PLUSH's badge covered PANIC's, the same fault the phantom plates had, and the plates had already
been fixed with a push-below loop written inline in `Phantoms.tsx`. Copying that loop into `DragBadges.tsx`
would have been the second copy of a rule that will be needed a third time (prompt boxes are the same kind
of overlay). It is now `src/renderer/ui/stack-plates.ts`: `pushBelow`, `boxesOverlap`, `plateOrder`, pure
and tested (`test/stack-plates.test.ts`). Both overlays call it; the phantom behaviour is unchanged by
construction, since the loop body is the same comparison. The badge gap is one chrome pixel (`uiScale`),
matching the plates' one world pixel. **Not seen on screen** — the badges are placed inside a rAF loop that
the unit test cannot drive, so the proof is the helper's tests plus the unchanged phantom path.

**Rejected:** measuring badges only when the camera changes. It would save layout reads, but the plates
already measure every frame and the two should stay the same shape until one of them is shown to cost
something.

**The rotation control's absence on components is now pinned.** docs/06 "Known issues" 1 says the control
does nothing on a component's drawn package and names hiding it as the cheap honest fix. It was already
hidden — `ROTATION_FIELD` has only ever been on `decor.part` and `decor.image` (`6bc6beb`) — but nothing
held that, so a later edit could put it back on a chip and reopen the bug. `test/node-fields.test.ts` now
asserts, for every kind, that the control is offered exactly when the pixels turn. The roadmap item is
ticked for the hiding half; rotating component art is still open.

**`ema` in `packages/shared/adaptive.ts` is gone.** Its comment said it served roll velocity and frame
rate; nothing imported it and nothing in the file called it. Removed rather than kept "in case": a helper
with a description of callers it does not have is the kind of comment that misleads the next reader.

**Found and left alone**, on the roadmap under "Known issues": `useChromeLayout` re-measures the chrome
every 400 ms whatever is happening (a `scrollWidth` read forces layout), and a dozen exports in
`packages/shared/*` have no importer. Neither is a fix for an unattended run.

## 2026-09-15 — The MinecraftOS room is a grid of identical mod clusters

William asked for every mod he works on to be laid out as The Stalker is, backdrop and all, in a
neat grid. Seven mods, so the choices were the grid's shape and what "the same" means.

**Two columns, four rows, the board grown taller.** The room already had a 2x2 of 53-wide clusters
at x 32 and 110; seven fit as 2+2+2+1 with the same column pitch and the 24-tile row pitch already in
use, which leaves every existing cluster where William knows it. Three columns would have fitted
seven in three rows without growing the board, but only by moving all four existing clusters and
squeezing the margins to 12 tiles. So `grid.height` went 132 → 180 and the deployment bus, the
backlog and the far fiducial moved down 48 tiles, keeping their spacing.

**"The same" is the Stalker's geometry, not its flair.** Every cluster gets the Stalker's zone,
backdrop, agent footprint, castellated frame, LED and screw positions and wiring. It does not get the
Stalker's `chase` effect, which is a hunter's signature and would be noise seven times over, and
priorities stay per node (the Stalker sits five levels proud as the flagship; the rest at their own
heights). Every agent with an `icon.png` in its resources wears it, because William put MCCamOp's on
the node he made himself that afternoon; the Stalker has no icon file and stays bare.

**Edited on disk, not through the bus.** Seventy-odd node changes as `require-approval` commands
would have meant that many dialogs. The whole `board/` was copied to `.snapshots/` first, in the
shape the command bus uses, and the running app re-reads the file on the next load. Ctrl+Z cannot
undo it; the snapshot and git can.

**TimeServed does not deploy to the client mods folder.** The script's rule was "every jar wires to
Client mods", which added that edge; it was removed by hand, because TimeServed is server-side and
runs in prod on Goobtropolis. A layout rule is not a deployment fact.

## 2026-09-19 — Morning maintenance: tooltips that were written and never shown, errors that end in an action

An unattended run of the MORNING MAINTENANCE task (`codex/briefs/morning-maintenance.md`), catching up the
08:00 slot. Three small changes and one roadmap step, each green on `npm run verify` (98 files, 1,544
tests; was 1,538).

**A select option can carry its own line of help.** `FRAME_BLURB` in `packages/shared/frames.ts` describes
each of the nine node frames and says it is "for the editor's tooltip"; nothing imported it, so the Frame
select offered `dip`, `quad`, `bga` and no way to learn what they draw. `FieldSpec` now has `optionHelp`,
the frame field sets it to `FRAME_BLURB`, and `NodeEditor.tsx` puts it in the `title` of each option and of
the select itself for the option currently chosen. The select's own title is the one that certainly shows
in Chromium; an option's title inside the native popup may not, which is why both are set.
**Rejected:** printing the line under the field. The editor's own comment records why help lives in
tooltips: a paragraph under every field made the form a wall of prose.

**The schedule readout's two dead ends now say what to do.** The inspector prints `nextRunFor`'s reason
after "NOT SCHEDULED —". `DISABLED` became `SWITCHED OFF. TICK ENABLED IN THE EDITOR TO RUN IT`, and
`THIS SCHEDULE NEVER FIRES` became `NO SUCH DATE IN THE NEXT FIVE YEARS. CHECK THE DAY AND MONTH FIELDS`
(five years is `nextRun`'s own limit). `nextRunFor` had no test at all; `test/schedule.test.ts` now has
five. Nothing compared against the old strings.

**The REMOTE panel's four calls can reject, and none was caught.** `toggle` set `busy` and cleared it
only after the await, so a rejection left the switch disabled until the panel was reopened; `revoke`,
`makeCode` and `publish` failed silently. Each now toasts what failed and reads the status back. The
revoke message does not claim the device can still connect, because after a failed save that is only
partly true (roadmap "Known issues" 9): it says to check the list and to turn remote off if the device is
still there. **Not seen on screen, and not unit-tested:** the repo has no DOM test environment (roadmap
"Known issues" 10).

**Spare exports are left exported.** Roadmap item 8 asked for a reader to say which of fifteen never-
imported exports were dead. Fourteen are live inside their own file, several as the default value of an
exported function's parameter, which a caller may reasonably want to name. `tsconfig.json` has no
`noUnusedLocals`, so removing `export` would buy no checking either. They stay. A wider count found three
names with no second mention anywhere; `REMOTE_DEFAULT_PORT` was the port written twice, and
`settings.ts` now imports it. `isChannel` and `FEATURE_NAMES` are left for William.

## 2026-09-21 — The board sees a first build; the program gets an installer and a home; sessions reach the phone

William: "my TimeServed mod was just rebuilt and the board still shows no build for it", then: an
exe he can pin, an update workflow, and Tailscale so he can work from his phone.

**Why the jar was never seen.** `watchBoard` filtered its directories with `existsSync` and watched
the survivors. A mod that had never been built has no `build/libs`, so nothing watched it, and the
first build was the one build the board could not see. `gradlew clean` did the same to a built mod.
The relink poll did fire (a missing glob is "broken"), but it called `refreshTargets` alone, so the
target healed while the cartridge, which reads `artifacts`, went on saying NO BUILD.

**Wait at the nearest ancestor that exists.** `packages/shared/watch-plan.ts` plans the watch: what
exists is watched directly, what does not is waited for at the nearest existing ancestor, at most
three steps up and never a drive root. When something appears there that lies on the way to a wanted
directory, or a watched directory is removed, the watcher re-plans after 600 ms and tells the nodes
concerned, because `ignoreInitial` means the new watch will not report a jar that is already there.
`test/watch-plan.test.ts` proves both sequences against a real temp directory: first build, and
clean then rebuild.
**Rejected:** polling every artifact on a timer. It would have worked and hidden the bug; a watcher
that is right costs nothing while idle. **Rejected:** watching the repo root recursively: `build/`
during a Gradle run is tens of thousands of events.

**F5 refreshes files, R still re-reads the board.** `refreshFiles` re-resolves targets and
artifacts and re-plans the watchers. It runs on F5, from the palette, from a Refresh button on file
nodes, when the window regains focus (at most once in five seconds), and in the relink poll. The
toast says what changed (`packages/shared/refresh-summary.ts`): a refresh that answers "REFRESHED"
has not answered the question it was pressed to ask.

**An install may never own the boards.** A packaged SkynetOS read `resources/board`, a copy made at
build time inside the install folder. The first update would have overwritten every board edit made
since. So program and data are separate (`packages/shared/home.ts`): the program is what the
installer puts down, the data lives in a home folder, and on William's machines the home is the repo.
The install finds it through `build-info.json` (`builtFrom`), remembers it in `userData/home.json`
so a published build, which carries no path, keeps it, and seeds `%USERPROFILE%/SkynetOS` only on a
machine with no repo. `settings.json` `home` overrides, and is file-only because the home is a
trusted root.
**Rejected:** keeping data in `%APPDATA%/SkynetOS`. The Hands edit the repo and the Face reads it
through GitHub; a third copy in AppData would be the one William looks at and the one nobody else
can see.

**Updates come from GitHub Releases, and nothing publishes itself.** electron-updater, per-user
NSIS so no administrator prompt, download in the background, install on close. Every
electron-builder script passes `--publish never`; `npm run release:publish` is separate and is
William's. `update:check` and `update:install` are user-only. The build is unsigned, so an update is
checked by hash against `latest.yml` and not by publisher: the GitHub account is the control, and
docs/07 says so. **Rejected:** a from-source updater (`git pull` and rebuild inside the installed
app): it needs node, git and a toolchain on every machine, which is what an installer exists to
avoid. **New dependency:** `electron-updater`, the only one. William asked for the workflow.

**The icon is drawn, not downloaded.** `tools/make-icon.mjs` draws a 32 px chip in the root board's
colours and scales it by whole numbers into a multi-size `.ico`. No vendor art, no licence trail, and
no bilinear mush on the taskbar.

**Sessions on the phone use Claude Code's Remote Control, not a terminal streamed by SkynetOS.**
docs/08's R4 would have needed headless sessions or `node-pty`, which has no build here. The CLI
already has `--remote-control [name]` (read from `claude --help`, 2.1.278). An `agent.code` node
opts in with `remoteControl`; the name is always passed because the flag's value is optional and a
bare flag would swallow the next argument. The reach is William's Anthropic login, so an agent
setting the flag gains nothing; `disableRemoteControl` in `~/.claude/settings.json` is the hard off.

**A revoke never throws (roadmap "Known issues" 9).** The save used to throw out of
`DeviceStore.revoke`, the caller skipped `disconnect`, and the device returned after a restart. Memory
is now the truth for the run, the disconnect is in a `finally`, the unsaved list is reported to the
panel, and revoking again settles the write once the file can be written.

**Found by the smoke run of the packed exe:** waiting at an ancestor put a watch on
`C:/Program Files`, which holds `WindowsApps`, which cannot be read. That is where the three-step cap,
the drive-root rule and the refusal to wait in `Program Files`, `Users`, `Windows` or `ProgramData`
came from: a program that is not installed is left to the relink poll and the refresh on focus.

**A second copy may not take the control file (found the hard way, same day).** The Hands ran the
packed exe through the smoke harness beside William's open app, three times. Each run wrote its own
`control.json` over the live one in userData and removed it on exit, so his board stayed open while
every agent was told SKYNETOS IS NOT RUNNING; the `to-face` mail for this session had to be written by
hand for that reason. `npm run smoke:shots` had the same fault and is documented as safe beside a
running app. Two rules now, in `packages/shared/control-file.ts`: a smoke run keeps its control file
in its capture folder, and a process removes the file only if the file still names its own pid.
Proved with a decoy file in userData that survived a smoke run of the packed exe. The live app needs
one restart to get its link back; it needed one anyway for the watcher.

## 2026-09-23 — Morning maintenance: the notify task rings, and three states that were missing

An unattended run of the MORNING MAINTENANCE task (`codex/briefs/morning-maintenance.md`), catching up the
08:00 slot. Three small changes and one roadmap step, each green on `npm run verify` (103 files, 1,606
tests; was 1,604).

**A `notify` task shows a Windows toast (roadmap M8).** The deductionos board has carried `T1 Daily drill
reminder` with `{"type":"notify","message":"…"}` since before the scheduler existed, and the scheduler
answered it with "WINDOWS TOAST NOTIFICATIONS ARE NOT BUILT YET". Electron's `Notification` is the whole
mechanism: `resolveTaskAction` reads `action.message` (an empty one is refused with a reason that names the
key), `planDispatch` titles the toast with the task's designator and name, and `scheduler.ts` shows it.
A dev copy has no App User Model ID, without which Windows shows nothing, so it borrows `process.execPath`
as the Electron docs say; the installer gives the packaged app its own. **Rejected:** a copy in the in-app
notification centre. That needs a new main→renderer push channel through the preload allowlist and a
restart, and it doubles a step that should first be seen working once. `level` on the node is read by
nothing; noted on the roadmap. **Not seen on screen:** the pure half is tested, the toast is not.

**Space activates what Enter activates.** The usage meter's plan label, CALIBRATE and minimise are
`role="button"` spans inside the head button, announced as buttons, and answered Enter only. Space now works
on all three and `preventDefault` stops it scrolling. Turning them into `<button>`s would be the right
fix, but a button inside a button is invalid HTML, so they would have to leave the head row: a layout
change, not a maintenance one.

**A gesture switch that fails to save now says so.** `toggle` in `GestureCatalogue.tsx` set the library
from the result and never read `ok`, so the switch snapped back in silence; its neighbours `add` and
`setWords` already toasted. The fallback names the gesture and the direction it would not go.

**A schedule read that fails is a warning, not a spinner.** `ScheduleBlock` answered a rejected
`task:status` by clearing the status, which rendered READING THE SCHEDULE… in the green style for as long
as the failure lasted. The reason is kept and shown, with the 30 s retry named so the reader knows waiting
is one of the options.

**Found and left alone**, roadmap "Known issues" 11–15: the mailbox and the gesture catalogue claim
emptiness before their first read and on a failed one; the mailbox's clipboard copy has no failure
path; a failed away-mode save leaves the typed value on screen; the MANUAL chip drops its instruction when
manual control has failed; and six bare fallback strings. All renderer, none testable here (item 10).

**Reported after the bound**, from the tidying survey that finished late: five one-word comment faults, two
duplicated helpers and twelve unread exports in `src/main/services/`. Roadmap "Known issues" 16–18. None
touched today: three improvements is the brief's limit, and removing code is William's call.

## 2026-09-23 — The away hour: a private home, a workspace for Prime, the phone guide, mail, and FinanceOS

William, leaving for an hour or two: a detailed Tailscale setup for his side; a FinanceOS room with
institution links, meters for balances and bills, spending and earning rates, unpaid-bill alerts, and
a place to work on income and debt; JARVIS reading and managing his several inboxes with an urgency
scale, ideally through one unified inbox; and a persistent "play pen" for JARVIS Prime. "Proceed."
Three forks with one owner per file; the main session kept these docs. Nothing committed.

**`private/` exists before anything else, and git never sees it.** The repo is public (docs/07). A
ledger, a mail survey, or a bank's name in a handoff would be published with the next commit. So
`private/{finance,email,prime}/` is gitignored first, every fork is told what may leave it (counts
and categories, never names or figures), and the FinanceOS board itself carries no number at all:
its institution nodes are provisional until William types the URLs, and the ledger is a template he
copies and fills. **Rejected:** a gitignored board file for the room. A `drive.room` pointing at a
file git does not carry shows broken on the second desktop, and FACE-BOOT would still bake the
targets it could read. Bank login pages are public URLs; the balances are the secret, and they are
in `private/`.

**Prime's workspace is method, not project facts** (`prime/`). The codex says what William's
projects are; `prime/` says how Prime works: a toolbox of what a session can reach, playbooks for the
jobs that recur (session start, an on-disk board edit, reporting, parallel forks, an unattended run),
learning notes, a log, and two tools that earlier sessions kept re-writing inline:
`npm run board:overlap` (mounted nodes that overlap or leave the grid, skipping printed kinds by the
shared `isPrinted` rule, and it was wrong until it did; 286 false faults on the real boards from
zones and screws with footprints) and `npm run board:snapshot`. `prime/tools/**` is in tsconfig so
verify typechecks it; `prime/scratch/` is gitignored. **Rejected:** putting this in `codex/`, which
the Face reads as project knowledge and which has a 150-line index to protect. **Learned:** vite-node
strips the script path from `process.argv`, so a tool cannot recognise itself there; `VITEST` in the
environment is the honest guard for "imported by a test".

**A bad token now counts toward the remote lockout.** docs/07 and docs/08 both say ten failed
pairings OR authentications in ten minutes turn remote off; `remote-server.ts` counted pairing codes
only, so a token could be guessed at without limit while the doc promised otherwise. The unknown-
device branch now records the failure, audits it as channel `auth`, and trips `onTooManyFailures`
like the pairing path (`test/remote-server.test.ts` "turns remote off after ten wrong tokens in a
row"). The doc was the intent and the stricter rule, so the code moved to it, not the other way.
This is the security path; William's eye is asked for in the handoff.

**The Tailscale guide quotes the code, not the design.** Every button, status line and dialog in
`docs/guides/remote-setup-tailscale.md` is the string in `RemotePanel.tsx` and `remote.ts`, read on
2026-09-23, and section 0 is this PC's real state (Tailscale 1.102.4 signed in, MagicDNS and HTTPS
certificates on, the iPhone on the tailnet, nothing published, remote off). The tailnet suffix and IPs
are left out of the guide because the repo is public; the panel prints them. Two gaps found by
writing it: the REMOTE panel is in LOOK → System only, not in the Settings panel; and an iOS Home
Screen web app has its own localStorage, so the icon will most likely ask to pair a second time
(predicted, unverified).

**Mail: Gmail is the hub, and the connector is read-only until William re-authorises it.** The
Outlook app on his phone aggregates on the phone only, so a server-side hub is required for an agent
to see everything; forwarding the other accounts into Gmail costs nothing and the existing connector
already covers Gmail. The survey found the inbox read to zero (6 unread of about 10,000 threads),
promotions and notifications at roughly nine tenths of the volume, and 1 P0, 11 P1 and 5 P2 items,
listed in `private/email/`. No label was created: `create_label` answered "Insufficient scope", so
the mailbox is untouched and the 26-thread labelling plan waits in `private/email/` for a run with
the modify scope. **Rejected:** authenticating the Microsoft 365 connector for the hotmail account
unattended, which needs his consent screen. **Unverified and blocking the schedule:** whether a
session SkynetOS launches on a chip carries the Gmail connector at all.

**FinanceOS: a ledger William keeps, not a bank the app reads.** He asked for meters of balances and
card bills, spending and earning rates, unpaid-bill alerts, and a room to work on income and debt.
**Decision:** the truth is `private/finance/ledger.json`, gitignored, filled by hand or from bank CSV
exports; `npm run finance:report` computes everything (`packages/shared/finance.ts`, pure, 32 tests)
and writes `report.json`; the board reads that one file through a board-window-only channel
(`finance:status`, in neither AGENT_METHODS nor REMOTE_METHODS) and shows it on the LEDGER node's
inspector block. No figure is ever a default, and an absent ledger is words, not an empty bar.
**Rejected:** a live aggregator (Plaid and the like): a paid dependency, a credential store, and a
public repo; a bank's own CSV is free, offline and already on every site. **Rejected:** institution
URLs on the board now: which banks he uses is his to write, so J1–J4 are provisional. **Rejected:** a
new `monitor.finance` kind today: the vertical-slice rule says schema → render → click → effect →
test, and the inspector block proves the data path first. The room's theme is graphite with a cyan
signal, clear of the three status colours by the palette test. The advisor persona never moves money,
never logs in, never invents a number, and ends every turn with one sized action; its weekly review
and the Monday BILLS DUE toast are on the board **disabled** until he ticks them. The root board was
edited on disk (D5, snapshot `2026-09-23T17-51-27-000Z-agent-financeos`); Ctrl+Z will not undo it.
What the mail survey showed about his institutions is in `private/finance/institutions.md`, not here.
