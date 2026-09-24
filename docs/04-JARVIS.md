# 04 — JARVIS

## The honest constraint first

You asked for one agent with permanent memory and jurisdiction over everything. A single long-lived chat conversation cannot be that: context compacts, and a conversation is not an API. So JARVIS is **one identity with two bodies**, sharing one memory store.

| | **The Face** | **The Hands** |
|---|---|---|
| What | The claude.ai conversation you talk to, embedded in SkynetOS | Headless Claude Code runs spawned by SkynetOS |
| Auth | Your logged-in session, `partition: persist:jarvis` | `claude -p --output-format stream-json` on your machine |
| Good at | Thinking with you, planning, judgment, long-form | Reading files, editing the board, supervising sessions, scheduled work |
| Memory | Loads `codex/index.md` at conversation start; you paste/refresh briefs | Reads and writes `codex/` directly, every run |

They stay one identity because both read the same `codex/` and both follow the same persona brief. The Face is where you think; the Hands are where things happen. Any time the Face decides something durable, its output ends with a `CODEX PATCH` block that you paste into the app (one button: "Apply codex patch"), or it asks the Hands to write it.

This is not a compromise you have to accept forever — if a first-party persistent-agent API lands, the Face swaps to it and nothing else changes, because the memory and tool layers are already external.

---

## The Codex — memory that doesn't burn context

**Design goal:** JARVIS should carry ~2,000 tokens of standing context and retrieve the rest on demand. Not 100,000 tokens of chat history.

```
codex/
  index.md              ~150 lines. The ONLY file loaded every time.
  persona.md            Who JARVIS is, how it behaves, its refusals
  board-map.md          One line per room + what lives there (auto-generated)
  projects/
    the-stalker.md      state · decisions · open threads · paths · agent id
    pacekeeper.md
    there-could-be-giants.md
    truthquest-retro.md
    ...
  decisions/
    2026-09-09-electron-over-tauri.md      one file per real decision
  journal/
    2026-09.md          rolling monthly log, appended by the nightly task
  handoffs/
    the-stalker.md      current handoff state per agent, overwritten
```

Rules that keep it maintainable:

1. **`index.md` is a map, not content.** Each line: `projects/the-stalker.md — Fabric 26.2 adaptive hunter mod. ACTIVE. Blocked on: mob AI perf.` If it exceeds 150 lines, the fix is nesting, not a longer file.
2. **One fact, one home.** A fact about The Stalker lives in `projects/the-stalker.md` and nowhere else. Duplicated facts are how memory systems rot.
3. **Append-only decisions.** Never rewrite a decision file; supersede it with a new one that links back.
4. **Every file has a header:** `updated:`, `status: active|paused|done`, `owner-node:` (the board designator, e.g. `U4`).
5. **Everything is markdown in git.** You can read the whole memory in a text editor and fix it by hand. That was your explicit requirement and it's the right one.
6. **`codex.db` is an FTS5 index over the markdown, rebuildable at any time.** Deleting it must be harmless.
7. **Retrieval, not recall.** The Hands call `codex_search("stalker mob AI")` and get 3 relevant chunks, not the whole store.

### Compaction protocol
When a Face conversation gets long, JARVIS runs its own end-of-session ritual before you close it:
1. Emit a `CODEX PATCH` with everything durable learned this session.
2. Emit a `HANDOFF` block: current state, next action, landmines.
3. You start a new conversation; it loads `index.md` + the handoff and is immediately current.
The nightly scheduled task does the same automatically for every `agent.code` session that ran that day.

---

## MCP tool surface

SkynetOS ships a local MCP server, `tools/skynet-mcp.mjs`, so a Claude Code session can see and
change the board it was launched from. A node asks for it by name:

```json
"mcpServers": ["skynet"]
```

The name is resolved at launch to a generated `--mcp-config` file (`services/mcp-config.ts`),
because the config has to carry an absolute path to the script and that path differs between this
repo and an installed build. Do not write a path into board JSON.

### How it is wired

The MCP server is a **thin proxy** and holds no logic. Claude Code spawns it as a child process,
so it cannot be the Electron main process — main is already running and owns the board, the
database, the command bus and the undo stack. Instead:

```
Claude Code  ──stdio/JSON-RPC──▶  tools/skynet-mcp.mjs
                                        │
                                 named pipe + token      (services/control-server.ts)
                                        ▼
                                  callAsAgent()          (src/main/ipc.ts)
                                        ▼
                              the same handler table the renderer uses
```

`callAsAgent` is the only gate. It refuses anything outside `AGENT_METHODS`, forces
`actor: 'agent'` so an edit cannot misattribute itself, and strips `approved` so an agent cannot
assert that a human authorised its own delete. Editing the MCP server to ask for something else
changes nothing — the authority lives in the app, where it is tested.

The server imports nothing. It speaks JSON-RPC directly rather than using
`@modelcontextprotocol/sdk`, because it runs as a bare `node script.mjs` whose imports must resolve
from disk — and in a packaged build `node_modules` is inside `app.asar`, where they would not.

### Tools

**Read**
- `board_read(boardId)` → every node with every field, traces, grid, theme
- `board_list()` → the root board and every room
- `board_resolve(boardId)` → each node's target resolved against the real filesystem
- `node_fields()` → every field a node can carry, and what each means
- `classify_path(paths)` → what a real path is, and the node kind and fields that would represent it
- `session_list()` · `usage_summary()` · `usage_routes(boardId)` · `history()`

**Write** — all validated against the schema, all snapshotted, all undoable with Ctrl+Z
- `node_create({boardId, kind, pos, fields?})` — the auto-placer finds free grid space
- `node_update(boardId, nodeId, fields)` · `node_move(boardId, nodeId, pos)`
- `node_delete(boardId, nodeId)` *(always comes back needing approval — there is no way around it)*
- `edge_create({...})` · `edge_delete(boardId, edgeId)`

**Act**
- `session_start(boardId, nodeId, {prompt?, fresh?})` — opens a real Claude Code terminal in that
  node's working directory, on William's desktop, already holding `prompt` as its task. This is
  the main thing JARVIS Prime is for: asked to fix something in a repo that has a node, it starts
  a session there rather than trying to do the work from its own directory.
- `terminal_open(boardId, nodeId, {elevated?})` — a plain shell, no agent
- `open_target(boardId, nodeId)` — same as clicking
- `mailbox_read(side)` · `mailbox_send(side, subject, body)` · `mailbox_archive(side, file)`

A task reaches a session through a FILE, appended to its briefing — never on a command line. A
task contains quotes, newlines and paths with spaces, and a command line is where that becomes a
quoting bug with a shell on the other end.

**Never exposed as tools:** settings and allowlist writes, the approval dialog itself, the native
file picker, undo/redo (the stack is shared with the user and is not per-actor), drag-out, deleting
files on disk, `git push --force`, running arbitrary shell outside a node's declared cwd. See
`AGENT_METHODS` in `src/main/ipc.ts` and `docs/07-SECURITY.md`.

**Not built yet:** `board_find`, `node_status`, `telemetry_query`, `artifact_latest`,
`codex_search`, `room_create`, `codex_write`, `board_snapshot`, `session_send`, `notify`. An agent
can reach most of what these would give it through `board_read` and `board_resolve`.

---

## Head → Prime

The Face is a claude.ai conversation and cannot see this disk. The Hands are a Claude Code session
and can do anything on it. The mailbox (`codex/mailbox/`) carries words between them; a message
carrying a `run:` field carries **intent**, and SkynetOS acts on it:

```
---
from: face
to: hands
subject: Fix the lighting regression in GameOS
run: true
---

The light rendering update broke shadow acne on sloped surfaces. Look at src/render/light.ts.
```

`services/mail-dispatch.ts` polls `to-hands/` every ten seconds, and a flagged message opens a real
session on the Hands node with its body as the task. `run: true` picks whichever node is the Hands
on that board; `run: <nodeId>` names one.

The bounds are in `docs/07-SECURITY.md` and are not negotiable from a message: opt in per message,
never elevated, three runs an hour, only nodes the board already declares, and archived before
launching so a message can never fire twice. `autoRunMail: false` in settings.json turns it off
entirely.

A message carrying `standing: true` is state rather than a task. SkynetOS writes its body over
`codex/face-brief.md` and archives it (`services/face-brief.ts`), and every Hands session opens
with those orders inlined between its briefing and its mail. The Face owns the file; the Hands
never edit it. Details in `codex/mailbox/README.md`.

## Prime → Head: FACE-BOOT.md

The Face cannot write anywhere, but it can read this repo through github.com, with two limits:
it fetches only URLs that William pasted or that appeared in an earlier fetch result, and GitHub
robots-blocks directory listings. From a cold start it reaches the repo root page and one hop
beyond. So `FACE-BOOT.md` sits at the root and carries everything inline:

1. `codex/index.md`, verbatim
2. every unread `codex/mailbox/to-face/` message, newest first
3. board truth: node counts per board, every unresolved target with its path, every provisional
   node, resolved through `target-resolver.ts` on the machine that baked it
4. the Hands' state, compressed from `handoff.md`
5. the skynet MCP tool names, read from `tools/skynet-mcp.mjs`

It is a bake artefact: `npm run face:bake` writes it, and the pre-commit hook installed by
`npm run face:hook` rebakes and stages it so every commit carries a current copy. Nobody edits it
by hand.

---

## Which model a session gets

Every Claude Code session SkynetOS launches is given a model and an effort on its command line:
Fable 5.1 at `high` while Fable is available, Opus 5 at `xhigh` while it is out of usage. The Fable
launch also names Opus 5 as `--fallback-model`. A node's own `model` field always wins, and
`autoModel: false` in settings.json leaves every launch on Claude Code's own default. SkynetOS never
edits `~/.claude/settings.json`.

"Out" is read from the transcripts: Claude Code records a refused request as an assistant line with
`isApiErrorMessage: true` and `error: "rate_limit"`, and the out-of-credits refusal names Fable in
its text. Fable is back when the restart time passes, or as soon as any conversation gets a real
Fable reply after the refusal. The restart time comes from `quotaLimits.resetsAt` when the refusal
carries it, from a "resets …" phrase in its text, or from a time typed into the usage meter,
because the CLI does not always write it down. Never from a guess.

A terminal that is already open keeps the model it started with. There is no channel into a live
console, so the switch applies from the next launch or resume. The usage meter shows
`FABLE 5.1 CORES: OFFLINE` and a `CORE RESTART` countdown while Fable is out, and which model a new
session gets either way. `models:status` is readable by agents; `models:setFableReset` is not.

## Away mode (built 2026-09-11)

After `awayAfterMinutes` (default 30) with no input anywhere on the machine, no Claude Code
transcript writes and no board commands, SkynetOS shows a sleep screen. At level `plan` (the
default) or `work`, it also starts JARVIS Prime **headless** in C:/dev and streams its conversation
into a centred window, with a growing "while you were away" list below. Any input wakes it: the
run is stopped and the write-up is shown, and Space returns to the board. The run's journal lands
in `codex/journal/away-*.md`, and the Face gets the summary as `to-face` mail. The Face window is
never automated.

- **Code:** `packages/shared/presence.ts` (when), `packages/shared/away.ts` (bounds, command line,
  prompt, stream parser), `src/main/services/presence.ts` and `away-session.ts`, and
  `src/renderer/ui/AwayScreen.tsx`.
- **Settings:** `awayMode`, `awayAfterMinutes`, `awayModel`, set in the LOOK panel's AWAY section.
  `work` is settings.json only. Shift+Z sleeps at once.
- **Bounds:** docs/07 rows under "Agent authority", and docs/DECISIONS.md "Away mode".

## Supervision loop

This is the "keep my agents running when I'm not there" capability, done safely.

A `task.scheduled` node runs the Hands every N minutes:

```
For each live agent.code session:
  - read the last 50 stream-json events
  - classify: PROGRESSING | AWAITING_INPUT | LOOPING | ERRORED | IDLE_DONE
  - AWAITING_INPUT + the question is answerable from codex → session_send the answer, log it
  - AWAITING_INPUT + it needs a real decision from William → notify(), leave it alone
  - LOOPING (same tool call ≥5×) → session_send a redirect, log it, notify()
  - ERRORED → capture the tail, write to handoffs/, notify()
  - IDLE_DONE → write the handoff, ask if the artifact rebuilt, update the board's staleness
Then: append a 5-line summary to codex/journal/YYYY-MM.md
```

Hard limits on the loop: it may send at most 3 messages per session per hour; it may never approve a permission prompt on your behalf; it may never start a session that wasn't already declared as a node. Every intervention is logged to the activity feed with `JARVIS` as the actor, so you can scroll back and see exactly what it did while you were at work.

---

## JARVIS persona brief (`codex/persona.md`, seed version)

> You are JARVIS, the primary agent of SkynetOS — William Fischer's project board. You have jurisdiction over every project on the board and responsibility for the board itself: its accuracy, its structure, and its visual coherence.
>
> **How you work**
> - Blunt over flattering. If a plan is bad, say so in the first sentence and say why. Never open with praise.
> - Lead with the answer. Then structure: short sections, checklists, bold only for the thing that matters.
> - You are talking to someone with severe ADHD and a completionist streak. Give one next action, not five parallel ones. Never bury the action in a paragraph.
> - When you don't know, say so and name what would tell you.
> - Cite the codex file you're drawing from, so it can be corrected.
>
> **What you own**
> - The board's truth: if a node's target moved, fix it. If a project is dead, mark it paused, don't quietly delete it.
> - The board's design: enforce `docs/02-VISUAL-LANGUAGE.md` on anything you place. Six colors, 16px grid, integer everything.
> - The codex: one fact one home, append-only decisions, index stays under 150 lines.
> - Cross-project awareness: you are the only agent who sees every room. Say when work in one room duplicates or unblocks another.
>
> **What you never do**
> - Delete files, force-push, or remove a node without explicit approval in that exact exchange.
> - Approve a permission prompt on William's behalf.
> - Claim something is built, tested, or working when you have not verified it. "I wrote it, I have not run it" is always an acceptable sentence.
> - Fabricate file contents, paths, or command output.
>
> **Session ritual**
> Start: read `codex/index.md`, then any handoff named in the opening message.
> End: emit `CODEX PATCH` and `HANDOFF` blocks. Always. Even for a short session.
