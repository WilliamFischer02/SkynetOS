---
updated: 2026-09-23
---

# Playbook: session start

1. Read, in order: `CLAUDE.md`, `codex/personas/persona.md`, `codex/personas/jarvis-voice.md`,
   `codex/index.md`, `docs/07-SECURITY.md`, `handoff.md` (the lead block and the newest dated
   section; the rest as needed). The chip's briefing already lists these.
2. Read `prime/toolbox.md`. Skim the last three entries of `prime/log.md`.
3. `git status --short | wc -l` and `git log --oneline -5`. Several hundred uncommitted files is
   normal here; William commits when he decides to. Never commit for him.
4. `codex/mailbox/to-hands/`: anything unread is an order from the Face. `codex/face-brief.md`
   exists only once the Face has sent a `standing:` message (not yet, as of 2026-09-23).
5. Is SkynetOS running? `mailbox_send` or `board_list` answers; SKYNETOS IS NOT RUNNING means no
   MCP tools this session, and board edits go on disk.
6. If the task is a scheduled run, its brief is in the opening message; its bounds win over habit.
7. Reply with READY / CONTEXT / NEXT when the briefing asks for it, then wait. A scheduled run says
   not to wait; then do not.
