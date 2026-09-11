# handoff.md

Rewritten at the end of every session. This is what the next agent reads first, after `CLAUDE.md`.

**Last session:** stood SkynetOS up on the second desktop (`William-Desktop`). No code changed.
**Session before that:** JARVIS Prime got a real tool surface; boards tripled; wiring by hand.
**Milestones done:** M0–M4, plus most of M5 (usage telemetry, animation).
**`npm run verify` is green: 619 tests** (on both desktops).

---

## Second desktop — state as of 2026-09-10

`npm ci` and `npm run verify` are green here. Of 63 target paths across the five boards, 41
resolve. Everything the board points at inside the repo (`%SKYNET%`), in OneDrive
(`%USERPROFILE%`), and in `%APPDATA%/.minecraft` relinked untouched.

The rest is **not a portability bug**. Each miss is one of these, and most were broken on the
primary desktop too:

- **TruthQuestRetro was cloned here.** This machine has Build Tools 2026 and no VS 2022, so the
  repo's `win-debug` preset cannot configure. A gitignored `CMakeUserPresets.json` in that repo
  adds `win-debug-vs2026`, which builds into the same `build/win-debug` folder the root board's
  PLAYER and FORGE nodes point at. It built clean with MSVC 14.50, and those two nodes resolve.
  Rebuild with `cmake --build --preset win-debug-vs2026` using the CMake bundled in Build Tools,
  since none is on PATH.
- **The gameos room's TQR paths are stale on every machine.** `tools/forge` is `forge/`,
  `docs/design.md` is `docs/design/game-design.md`, the executables are `player.exe` and
  `forge.exe`, and there is no `assets/` folder (art lives in `content/` and `assets-inbox/`).
  Not repointed: Release vs Debug is the user's call.
- **Five Minecraft repos exist nowhere but the primary desktop.** GoobtropolisTest, Hurtcraft,
  JohnWickMobs, TheBlobs, TimeServed are not on GitHub. Three are provisional; TimeServed and
  GoobtropolisTest are not.
- **storyos and deductionos still carry `REPLACE_ME` template paths** from the base commit. The
  novels are actually in `%USERPROFILE%/OneDrive/Documents/01 DOCUMENTATION/` and the
  "Something In The Woods (PANIC) Novel" Claude project folder.
- **Anki is not installed** on either desktop.

Session ids in `skynet.db` do not travel, so "Resume conversation" on an agent node starts fresh
here the first time.

---

## What landed this session

Full reasoning for every item is in `docs/DECISIONS.md`, newest last. Read that before changing
any of it — most of these were fixes to something that had already gone wrong once.

### 1. A provisional node need not name its target

`link.url`, `store.repo`, `agent.code`, `decor.image` — **fourteen of the sixteen kinds the "+"
palette offers could not be added at all**. `node-factory.ts` creates every node unbound and
`provisional: true` by design; the schema required the target anyway, so the command bus refused
the edit before it reached the board ("EDIT REJECTED — the result would not validate").

The schema's `allOf` is now gated behind "this node has not declared itself provisional".
Everything else still applies with the flag set. `test/new-node.test.ts` runs the real factory
against the real schema for every kind, and pins the narrowness of the exemption.

### 2. Boards are 3x, and the camera opens on the content

Every board and room is tripled, with existing layouts moved to the middle so nothing is jammed in
a corner. Two consequences had to be handled:

- `PAN_MARGIN` was eight tiles and never delivered what it promised — centring a corner node needs
  half a viewport, ~60 tiles at zoom 2. It is now proportional, with the old constant as a floor.
- The camera opened at 0,0, which on a 192x120 grid is a screenful of bare substrate. It now frames
  the board's content, **once, on arrival in a room**. Never on rebuild: that is the camera-snap
  bug and it stays fixed.

### 3. JARVIS Prime can drive the board and open terminals

`tools/skynet-mcp.mjs` is an MCP server a Claude Code session gets via `"mcpServers": ["skynet"]`
on its node. 22 tools: read the board in full, create/update/move nodes and traces with every field
the editor has, and `session_start` a real terminal in a node's repo **already holding a tailored
prompt**.

```
Claude Code ──stdio/JSON-RPC──▶ tools/skynet-mcp.mjs ──named pipe──▶ callAsAgent() ──▶ handlers
```

`callAsAgent` (`src/main/ipc.ts`) is the only gate. It refuses anything outside `AGENT_METHODS`,
forces `actor: 'agent'`, and strips `approved` so an agent cannot authorise its own delete.

**The MCP server imports nothing.** It speaks JSON-RPC directly rather than using
`@modelcontextprotocol/sdk`, because Claude Code spawns it as a bare `node script.mjs` whose
imports must resolve from disk — and in a packaged build `node_modules` is inside `app.asar`.

### 4. Head → Prime

A mailbox message carrying `run:` in its frontmatter opens a session on the Hands node with its
body as the task. Opt in per message, never elevated, 3/hour, archived **before** launching so it
cannot fire twice. `autoRunMail: false` in settings.json disables it.

### 5. Wiring by hand

Edit Board mode: hover a node's edge to light a port, click it, click another node's edge. The edge
stores two node ids and no coordinates, so traces follow their endpoints already.

### 6. The minimap sized itself from the board

`const SCALE = 3` was chosen when a board was 64 tiles wide. At 192 it made a panel covering a
quarter of the window. The budget is now fixed and the scale derived; it has a title bar with a
resize grip, the current scale, and a close button.

---

## Landmines

### `sendInputEvent` does not produce pointer events

`BoardCanvas` listens for `pointerdown`. `win.webContents.sendInputEvent({ type: 'mouseDown' })`
produces the mouse half and **no pointer event at all**, so every mouse drag the smoke harness
"performed" for weeks landed on nothing — `09-drag-ghost.png` was a picture of a board with no drag
in progress. Real hardware sends both. The harness now dispatches real `PointerEvent`s:
`pointerdown` on the canvas, `pointermove`/`pointerup` on `window`.

### The smoke harness must not guess where things are

It had four assumptions and every one was wrong at least once:

1. "The camera clamps to 0,0" — tripling moved the content off the corner.
2. "`win.getContentSize()` is the coordinate space `sendInputEvent` takes" — it is not. scaleFactor
   2 means main sees 1267x717 while the page is 2534x1434.
3. "A node in the middle of the window is clickable" — the usage meter, minimap and inspector are
   DOM chrome over the canvas, and a mousedown on the minimap is a camera JUMP, which looks exactly
   like the camera-reset bug that check exists to catch.
4. "700ms is enough for a write to land" — it is not, and the harness then skipped its own cleanup
   and left a stray trace in the real board file.

**Ask the page.** `document.elementFromPoint` arbitrates "clickable"; `window.__skynetCamera` and
`window.__skynetWire` say where things actually are; poll for a change rather than sleeping; and
always undo what you created, because this runs against the real `board/`.

### Renderer `console.info` is filtered in the smoke log

`src/main/index.ts` forwards renderer console output only when the level is not `info` **or** the
message starts with `[router|atlas|ui|mosaic]`. A `console.info('[wire] ...')` probe vanishes and
looks like the code never ran. Use one of those prefixes.

### Bash heredocs eat backslashes

`\n` inside a heredoc becomes a literal newline in the file. This has corrupted a source file
twice. Use the Write/Edit tools, a Python heredoc with a quoted delimiter, or
`String.fromCharCode(92)`.

### The older ones, still true

- **Never use `existsSync` to test for an executable.** Windows App Execution Aliases are
  zero-length reparse points and `stat` throws EACCES. Use `services/which.ts`.
- **A node texture is described in exactly one place** (`specFor` in `BoardCanvas.tsx`). Three
  builders drifted once and the board flickered between framed and unframed several times a second.
  `test/render-invariants.test.ts` guards it structurally.
- **A control inside `.breadcrumb`, `.hud` or `.help` needs `pointer-events: auto`.** They are
  click-through; a button inside one renders, highlights on hover, and never fires.
- **The Ajv validator is keyed on the schema file's mtime+size.** It used to be compiled once for
  process life, so editing the schema during a run validated against the old one.

---

## What is next

In rough order of what was asked for most recently:

1. **A board selector** — save and load board variations, so alternatives can be tried side by side.
2. **Rooms within rooms.** `drive.room` already points at a board file; the descend stack already
   holds more than two levels. Mostly a question of room creation and the breadcrumb.
3. **Agent node output boxes.** Two per-node toggles with an adjustable height offset: a short
   summary of that agent's last output, and a witty in-character remark. **The summary needs no
   model** — the last assistant turn is already in `~/.claude/projects/<cwd>/<uuid>.jsonl`, which
   `services/usage.ts` already reads. The remark does; cheapest is `claude -p` against the user's
   existing Max subscription ($0 extra), with the API as an opt-in fallback (~$1.80/month on Haiku).
4. **A commercial UI pass** — tuck text into tooltips, auto-closing submenus, more symbols, fewer
   words, transition animations on redraw/room entry/session open.

Still outstanding from earlier, and worth doing before more features:

- **Component sprites are still 12 drawn placeholders.** `component.*` keys have no atlas entries.
- **The `@theme` colour-key swap is unimplemented**, so no sprite may use `@mask-dark`,
  `@mask-light` or `@signal`.
- **A tilesheet-CELL palette** — pick an arbitrary cell from a vendor sheet, not just a baked key.
