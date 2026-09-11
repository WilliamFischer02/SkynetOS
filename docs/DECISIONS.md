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
