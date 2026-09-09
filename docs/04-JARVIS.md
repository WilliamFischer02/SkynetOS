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

SkynetOS ships a local MCP server (`skynet-mcp`) so **any** Claude Code session — JARVIS's Hands, or a mod agent — can see and change the board. Register it in each project's `.mcp.json`.

**Read**
- `board_read(roomId?)` → nodes, edges, layout
- `board_find(query)` → nodes matching name/path/tag across rooms
- `node_status(nodeId)` → resolved target, live state, heat, recent events
- `telemetry_query({nodeId?, since, kind?})` → event rollups
- `session_list()` → live sessions, uptime, last activity
- `artifact_latest(nodeId)` → resolved path, mtime, version, staleness
- `codex_search(query, k=5)` → ranked markdown chunks with file paths

**Write** (all produce a reviewable diff; all snapshot first)
- `node_create({roomId, kind, name, target, position?})` — position optional; the auto-placer finds free grid space and routes traces
- `node_update(nodeId, patch)` · `node_move(nodeId, position)` · `node_delete(nodeId)` *(approval always required)*
- `edge_create({from, to, kind})` · `edge_delete(edgeId)`
- `room_create({name, engraving, theme})` — also creates the folder and board file
- `codex_write(path, content, mode: append|replace)`
- `board_snapshot(label)`

**Act**
- `session_start(nodeId, {prompt?, mode})` · `session_send(nodeId, message)` · `session_stop(nodeId)`
- `open_target(nodeId)` — same as clicking
- `notify(level, message)` — raises the buzzer

**Never exposed as tools:** deleting files on disk, `git push --force`, running arbitrary shell outside a node's declared cwd, changing the elevation policy. See `docs/07-SECURITY.md`.

---

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
