# handoff.md

Rewritten at the end of every session. This is what the next agent reads first, after `CLAUDE.md`.

**Last session:** the launch was fixed — it had never worked — then a large feature pass.
**Milestones done:** M0–M4, plus most of what M5 was going to be (usage telemetry, animation).
**`npm run verify` is green: 450 tests.**

---

## What landed this session

### 1. No chip had ever launched. Four stacked bugs.

Every conversation id in `skynet.db` was a phantom; `claude` had never once started from the board.
Full write-up in `docs/DECISIONS.md` — read it before touching the launch path.

- **`existsSync` is `false` for every Windows App Execution Alias.** They are zero-length reparse
  points; `stat` throws EACCES. So `wt.exe` and `pwsh.exe` were both "not installed" and the
  launcher silently fell back to PowerShell 5.1. Fixed by `services/which.ts`, which resolves by
  listing PATH directories. **Never use `existsSync` to test for an executable again.**
- **Electron main is a GUI-subsystem process with no console**, so spawning a console app from it
  detached opened no window at all. The no-wt fallback now goes through `cmd /c start`.
- **`wt.exe` is a stub that exits 0 in ~200ms**, and `spawn` succeeding was read as a launch.
- **The conversation id was recorded before the spawn**, so one failure poisoned the chip forever.

Now: the whole launch is a staged `.ps1` under userData whose command line carries nothing but
file paths; it confirms itself by writing a pid file; and `services/conversations.ts` checks
`~/.claude/projects` before any id reaches `--resume`.

**Prove it, don't assume it:** `SKYNET_SMOKE_LAUNCH=terminal node tools/smoke-shot.mjs` opens a
real shell; `=agent` opens a real Claude Code session and checks the process is running on that
conversation id.

### 2. The camera stopped being destroyed on every edit

`BoardCanvas` was keyed on `[props.board, props.boardId]`, and the store replaces `props.board`
after every mutation — so moving one node rebuilt the entire Pixi application. The app is now built
once per ROOM and the scene is rebuilt in place. Dragging moves the sprite itself, not just a ghost.

### 3. The art pipeline is finally on

`ATLAS_URL` is wired and the atlas loads — 26 frames, all cut from the Kenney 1-bit sheet by
`npm run assets:bake` and recoloured to the locked palette. `decor.part` is 21 pieces of board
furniture (vias, screws, junctions, grilles, pad arrays, fiducials, five pulsing LEDs), placeable
from the `N` palette, which shows each one's ACTUAL baked sprite rather than a redrawing of it.

Two things had to change to get there, both worth knowing:
- The baker now always writes an atlas. Vite's `?url` resolves at BUILD time and `assets/atlas` is
  git-ignored, so a missing file was a build failure rather than a graceful degrade.
- The atlas PNG is imported too. An emitted asset lives at a hashed path, so deriving its URL from
  `meta.image` produced "The source image cannot be decoded" in the built app while dev worked.
- The baker no longer skips a sprite in silence. A `source` missing its `type` baked nothing and
  said nothing.

### 4. Everything else

- **Priming and briefings.** `prelaunch` (allowlisted ids, never shell strings), `briefing`,
  `readOnLaunch`, `addDirs` -> `claude --add-dir`.
- **Terminals anywhere.** `terminal:open`, plain and admin, on any node with a directory.
- **Node scaling** three ways: corner handle, Shift+arrows, W×H field. Per-kind caps.
- **Two images per node**: `image` (wallpaper, fills the footprint) and `logo` (centred badge,
  aspect preserved). `drawBevel()` on every component and badge.
- **Usage meter** (top-left) and **couriers** — robots carrying packets in proportion to real
  measured Claude usage, read from `~/.claude/projects`.
- **Add-component palette** (`N` in Edit Board mode) and editable printed furniture.
- **`decor.image`** — backdrops behind everything, resizable to the whole board.
- **JARVIS mailbox** (`M`) — `codex/mailbox/`, with unread mail folded into session briefings.
- **`docs/08-AGENT-INTAKE.md`** — the brief to hand another agent to populate a room.
- **`docs/09-ASSET-CATALOGUE.md`** — generated; 764 files measured.

## Mid-flight — nothing. Working tree is clean.

## What William has asked for that is NOT done

- **A tilesheet palette in the board editor** — "open a palette of the tilesheet assets in the board
  editor and redesign the board myself". `AddPalette` covers node KINDS; picking arbitrary sheet
  cells as art is not built. `docs/09-ASSET-CATALOGUE.md` is the inventory it would draw from, and
  `assets/sprites/manifest.json` is where a chosen cell has to end up.
- **Using more of the vendor sheets.** The catalogue now says what is there (21,981 non-empty
  cells); nothing new has been kitbashed from it. `ATLAS_URL` in `BoardCanvas.tsx` is still `null`,
  so every node draws as a placeholder.
- **`tokenBudget` is unset**, so the meter shows SET A BUDGET where the pool would be. That is
  deliberate — see the DECISIONS entry — but William may want to pick a number.

## Landmines, in the order they will bite you

- **`existsSync` cannot see a WindowsApps alias.** Cost this project every launch it ever
  attempted. Use `services/which.ts`.
- **A console app spawned from Electron main has nowhere to appear.** It needs `wt` or
  `cmd /c start`.
- **A successful `spawn` is not a successful launch.** Wait for the pid file.
- **An assigned conversation id is a plan, not a fact.** Check `~/.claude/projects` before
  `--resume`, and walk the node's history past phantoms.
- **Four separate implementations of "which kinds are obstacles"** must stay in step:
  `tools/validate-board.mjs`, `board-store.graphProblems`, `layout.findFreeSpace`, `drag.canDrop`.
  Adding `decor.image` needed all four; missing one made the app refuse to load a valid board.
- **Bash heredocs eat backslashes in this environment.** Write patch scripts with the Write tool,
  or build every backslash with `String.fromCharCode(92)`. It has produced a broken regex, an
  invalid string escape and two wrong bug repros across sessions.
- **`wt.exe` is a second parser.** Only file paths go on its command line now. Keep it that way.
- **Every hook must run on every render.** An effect added after `if (!board) return` rendered a
  blank window; renderer errors now reach the smoke log, which is how it was found.
- **The Ajv validator is compiled from a file that agents may edit while the app runs.** It is
  keyed on the schema's mtime — do not re-cache it unconditionally.
- **Copper is an edge colour, not a fill.**
- **The nameplate extends the TEXTURE, not the footprint.**
- **Canonical board JSON** is 2-space, LF, trailing newline. Python's `json.dumps` escapes
  em-dashes; pass `ensure_ascii=False`, or write it with Node.

## Standing context

- **This project is personal and will not be on stream.** William said so directly on
  2026-09-10. `docs/07-SECURITY.md` §Streaming safety and the `streamMode` setting still exist and
  still work, but do not spend effort on them, and do not let "it might be on stream" shape a
  design decision. Full paths in the inspector are fine.

## Open questions for William

- **What should `tokenBudget` be?** Until it is set, two of the meter's three numbers are blank.
- **Is the backdrop demo wanted?** `bg_board` on the root board exists to prove `decor.image`
  works. Delete it, repoint it, or move it.
- **M5 proper.** Heat, occupants, the activity feed and alerts are still unbuilt; telemetry and
  animation arrived early via the usage meter and the couriers.

---

## Added after the first handoff was written (same session)

- **`showLogo`** splits from `showThumbnail`, so a badge can sit on a drawn package.
- **Usage meter**: a bar per value, a `plan` setting, and a clickable dialog that parses free text
  (`Max 20x`, `96M`). The Max-20x figure is calibrated from this machine's own 96.1M peak window;
  see `docs/DECISIONS.md`. `settings:setPlan` is the ONLY settings write and touches exactly two
  keys — do not widen it.
- **`decor.image`** backdrops and **`decor.part`** furniture, both printed kinds.
- **`pulseGlow`** on any node with a wallpaper, and **`textGlow`** on type. Both are palette shifts
  along the room's own ramp, not translucent halos.
- **The wheel zooms**, anchored on the cursor.
- **Text plates**, `textColor` / `textStroke`, and a measured bounding box for text nodes.
- **Rooms store a stem**; the board appends `OS` one size down and darker.
- **`PRINTED_KINDS` is one shared list.** It used to be five copies of a predicate and adding a
  kind meant finding all five. Add to the list, not to a condition.

## Still not done

- **A tilesheet-CELL palette.** `N` now shows 21 baked parts, which is most of the way there, but
  picking an arbitrary cell and turning it into a sprite is still a manifest edit plus a bake.
  `docs/09-ASSET-CATALOGUE.md` is the inventory; `tools/sheet-contact.mjs` is how you read
  coordinates off a sheet without guessing.
- **The component keys are still placeholders.** 12 of them. `component.chip_dip.idle` and friends
  have no atlas entry, so every mounted node is still a drawn silhouette. The pipeline that would
  fix that now demonstrably works — `decor.*` proves it end to end.
- **The `@theme` key swap.** `@mask-dark` / `@mask-light` / `@signal` bake as reserved magenta and
  the renderer does not swap them, so no sprite may use one yet. Needed before any sprite can take
  a room's colour.
