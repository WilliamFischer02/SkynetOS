# handoff.md

Rewritten at the end of every session. This is what the next agent reads first, after `CLAUDE.md`.

**Last session:** the launch was fixed — it had never worked — then a large feature pass.
**Milestones done:** M0–M4, plus most of what M5 was going to be (usage telemetry, animation).
**`npm run verify` is green: 400 tests.**

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

### 3. Everything else

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

## Open questions for William

- **What should `tokenBudget` be?** Until it is set, two of the meter's three numbers are blank.
- **Is the backdrop demo wanted?** `bg_board` on the root board exists to prove `decor.image`
  works. Delete it, repoint it, or move it.
- **M5 proper.** Heat, occupants, the activity feed and alerts are still unbuilt; telemetry and
  animation arrived early via the usage meter and the couriers.
