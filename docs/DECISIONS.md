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
