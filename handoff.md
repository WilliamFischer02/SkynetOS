# handoff.md

Rewritten at the end of every session. This is what the next agent reads first, after `CLAUDE.md`.

**Last session (2026-09-11, U3 JARVIS-PRIME):** gave the Face a way to read this machine. `FACE-BOOT.md` at the repo root, rebaked by a pre-commit hook. `standing:` mail now writes `codex/face-brief.md`. The panel honours a pasted header, so `run:` works through it for the first time.
**Not live until SkynetOS restarts:** standing orders and header lifting are main-process code, and the running app predates them.
**Session before that:** stood SkynetOS up on the second desktop (`William-Desktop`). No code changed.
**Milestones done:** M0–M4, plus most of M5 (usage telemetry, animation).
**`npm run verify` is green: 662 tests** on William-Desktop. The primary desktop has not run this commit.

---

## What landed this session

Reasoning for each is in `docs/DECISIONS.md` under 2026-09-11.

### 1. FACE-BOOT.md: the Face's whole view of the repo

The Face tested its reach. Drive is search-only. GitHub works, but it can fetch only URLs that
William pasted or that appeared in an earlier result, and it cannot list directories. Its entire
cold-start reach is the root page plus one hop. So `FACE-BOOT.md` sits at the root and inlines:
the codex index, unread `to-face/` mail, board truth (every unresolved target, every provisional
node, resolved through `target-resolver.ts`), this handoff's lead block and "What is next" titles,
and the MCP tool names.

- `npm run face:bake` → `tools/face-bake.ts` (vite-node) → `src/main/services/face-boot.ts` (pure).
- `npm run face:hook` installs a **pre-commit** hook that bakes and stages it. Installed on
  William-Desktop only. **The primary desktop needs `npm run face:hook` once.**
- The lead block and numbered bold titles under "What is next" in THIS file are what the Face sees
  as the Hands' state. Keep them accurate and keep that shape.

### 2. Standing orders

A message with `standing: true` makes SkynetOS write its body over `codex/face-brief.md`, then
archive it. The Face owns the file and the Hands never edit it. Every Hands session opens with it
inlined between the briefing and the mail (`session-manager.ts`). Only the node picked by
`pickHandsNode` (`packages/shared/face-brief.ts`) receives it, and `run:` dispatch now uses the same
function. The file does not exist yet: the Face has a shape for it and has not sent it.

### 3. Mailbox fixes

- The panel lifts a pasted header (`liftPastedHeader`). Before this, a `run:` pasted through the
  panel landed in the body and never fired.
- MCP `mailbox_send` never passed `from`, so agent mail was signed `undefined`. It also wrote
  `to: to-head`. `normaliseSide` fixes the side and `from: 'hands'` fixes the signature.
- The mail section of a briefing now gives absolute paths, because U3 runs from `C:/dev`.

### 4. The resolver runs without Electron

`settings.ts` reads `%APPDATA%/SkynetOS/settings.json` directly when `app` is absent, and never
creates it from there. `target-resolver.ts` derives its board root from `skynetRoot()`. `tools/**/*.ts`
is now typechecked.

---

## Second desktop — state as of 2026-09-10

`npm ci` and `npm run verify` are green here. Of 63 target paths across the five boards, 41
resolve. Everything the board points at inside the repo (`%SKYNET%`), in OneDrive
(`%USERPROFILE%`), and in `%APPDATA%/.minecraft` relinked untouched. FACE-BOOT's count differs (32
unresolved primary targets) because it counts one target per node, not every path field.

The rest is **not a portability bug**:

- **TruthQuestRetro was cloned here.** This machine has Build Tools 2026 and no VS 2022, so the
  repo's `win-debug` preset cannot configure. A gitignored `CMakeUserPresets.json` in that repo
  adds `win-debug-vs2026`, which builds into the same `build/win-debug` folder the root board's
  PLAYER and FORGE nodes point at. Rebuild with `cmake --build --preset win-debug-vs2026` using the
  CMake bundled in Build Tools, since none is on PATH.
- **The gameos room's TQR paths are stale on every machine.** `tools/forge` is `forge/`,
  `docs/design.md` is `docs/design/game-design.md`, the executables are `player.exe` and
  `forge.exe`, and there is no `assets/` folder (art lives in `content/` and `assets-inbox/`).
  Not repointed: Release vs Debug is the user's call.
- **Five Minecraft repos exist nowhere but the primary desktop.** GoobtropolisTest, Hurtcraft,
  JohnWickMobs, TheBlobs, TimeServed are not on GitHub.
- **storyos and deductionos still carry `REPLACE_ME` template paths** from the base commit. The
  novels are actually in `%USERPROFILE%/OneDrive/Documents/01 DOCUMENTATION/` and the
  "Something In The Woods (PANIC) Novel" Claude project folder.
- **Anki is not installed** on either desktop.

Session ids in `skynet.db` do not travel, so "Resume conversation" on an agent node starts fresh
here the first time.

---

## Landmines

### New this session

- **U3 runs from `C:/dev`, but its `readOnLaunch` and `persona` are repo-relative.**
  `resolveReading` joins them to the cwd, so a fresh U3 session is told `CLAUDE.md`, the persona,
  the codex index, docs/07 and this file are "NOT on disk". The fix is to prefix `SkynetOS/`
  (resolveReading does not expand `%SKYNET%`) and point `persona` at
  `codex/personas/persona.md`. Waiting on William's approval.
- **Two persona files disagree.** U1 uses `codex/personas/persona.md`, U3 the older
  `codex/persona.md`, which lacks the voice section. Root-level `persona.md` and `jarvis-voice.md`
  are untracked copies William added; they match `codex/personas/` apart from whitespace.
- **The Claude Code shell sets `npm_config_allow_scripts`**, and npm 12 refuses it in a
  project-scoped install (`EALLOWSCRIPTS`). Clear it for that one command:
  `Remove-Item Env:npm_config_allow_scripts; npm install ...`.
- **The repo is public.** `FACE-BOOT.md` and `codex/mailbox/` are world-readable.
- **`git commit -- <paths>`** uses a temporary index, so the pre-commit hook's `git add` may not
  make it into that commit. A normal `git commit` and GitHub Desktop are fine.

### `sendInputEvent` does not produce pointer events

`BoardCanvas` listens for `pointerdown`. `win.webContents.sendInputEvent({ type: 'mouseDown' })`
produces the mouse half and **no pointer event at all**. The smoke harness dispatches real
`PointerEvent`s: `pointerdown` on the canvas, `pointermove`/`pointerup` on `window`.

### The smoke harness must not guess where things are

Ask the page. `document.elementFromPoint` arbitrates "clickable"; `window.__skynetCamera` and
`window.__skynetWire` say where things actually are; poll for a change rather than sleeping; and
always undo what you created, because this runs against the real `board/`. scaleFactor 2 means
main sees 1267x717 while the page is 2534x1434.

### Renderer `console.info` is filtered in the smoke log

Forwarded only when the level is not `info` **or** the message starts with
`[router|atlas|ui|mosaic]`. Use one of those prefixes for a probe.

### Bash heredocs eat backslashes

`\n` inside a heredoc becomes a literal newline in the file. Use the Write/Edit tools, a Python
heredoc with a quoted delimiter, or `String.fromCharCode(92)`.

### The older ones, still true

- **Never use `existsSync` to test for an executable.** Windows App Execution Aliases are
  zero-length reparse points and `stat` throws EACCES. Use `services/which.ts`.
- **A node texture is described in exactly one place** (`specFor` in `BoardCanvas.tsx`).
  `test/render-invariants.test.ts` guards it structurally.
- **A control inside `.breadcrumb`, `.hud` or `.help` needs `pointer-events: auto`.**
- **The Ajv validator is keyed on the schema file's mtime+size.**

---

## What is next

In rough order of what was asked for most recently:

1. **Repoint U3's read list** — prefix `SkynetOS/`, persona to `codex/personas/persona.md`, add the voice file. One `node_update`, awaiting approval.
2. **Restart SkynetOS and prove standing orders end to end** — send a `standing:` message through the panel, confirm `codex/face-brief.md` appears, and open U3 fresh to see it in the briefing. Not yet run.
3. **A board selector** — save and load board variations, so alternatives can be tried side by side.
4. **Rooms within rooms.** `drive.room` already points at a board file; the descend stack already holds more than two levels.
5. **Agent node output boxes.** A summary of the agent's last output (no model needed: the last assistant turn is in `~/.claude/projects/<cwd>/<uuid>.jsonl`) and an in-character remark (`claude -p` on the Max subscription).
6. **A commercial UI pass** — tooltips, auto-closing submenus, more symbols, fewer words, transitions.

Still outstanding from earlier:

- **Component sprites are still 12 drawn placeholders.** `component.*` keys have no atlas entries.
- **The `@theme` colour-key swap is unimplemented**, so no sprite may use `@mask-dark`,
  `@mask-light` or `@signal`.
- **A tilesheet-CELL palette** — pick an arbitrary cell from a vendor sheet, not just a baked key.
