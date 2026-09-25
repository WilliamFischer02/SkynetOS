---
updated: 2026-09-25
status: active — room not yet built; drop installed by Prime in Phase 1
owner-node: CC-SECRETARY (ScheduleOS room), U3 until Phase 7
---

# ScheduleOS

**Identity.** The week, visible and buildable. Reclaim is the engine, Google Calendar the store,
CC-SECRETARY the editor, the week preview the picture. Spec: `codex/drops/…/specs/scheduleos-room.md`
(on disk). Time model: `specs/schedule-model.md`. Names: `specs/notification-copy.md`. Agent
directive: `directives/30-schedule-secretary-agent.md`.

**Board.** `board/scheduleos/room.board.json` (Phase 5); drive `d6_scheduleos` on root. Theme signal
`#9CF0FF` proposed.

**Where things live (decision 2026-09-25, private split).**
- Tracked: `schedule/` scripts (`build-week`, written in Phase 5).
- Private, gitignored: `private/schedule/reclaim/` (`habits.json`, `tasks-seed.json`,
  `hours-and-timezone.md` with the calendar IDs), and the generated `schedule/week.html`,
  `schedule/today.md`, `schedule/pbs-shifts.json`, `schedule/changes.log.jsonl`,
  `schedule/proposals.md`.

**Engine facts (verified by the Face, 2026-09-25).** Official Reclaim MCP:
`claude mcp add Reclaim -t http https://mcp.reclaim.ai`. Unofficial `npx reclaim-mcp` (API key) for
habits if needed; the key would live in `%APPDATA%/SkynetOS/secrets/`. Google Tasks `🗓 Reclaim`
list syncs both ways as a fallback. William is on Reclaim Starter. The Google Calendar connector is
connected in Prime's own session (2026-09-25), which makes the timezone check a read.

**Google account facts (found by the Face).** Every calendar is `America/Los_Angeles`; must become
`America/Denver`. Reclaim placed habits at 02:45–03:45 PT on 9/25. Calendars: `[MAIN]`, `Work –
Shifts`, `Work – Prep Blocks` (both empty; IDs in the private hours file), `Work (WorkJam)` (Ross;
status unknown), `BitRunners Development`. Existing habits: Reading, Meditation, Exercise, Writing,
Update Software Systems & Drivers.

**Constraints (stated by William).** 2–3 days off a week. PBS prep chain: shower 25 min, drive 5,
walk 10. Streams 4/wk alternating morning/night. Reading books and comics are separate blocks.
Writing and music blocks. Buffer/prep blocks before physical tasks. Titles and notifications must
catch attention at a glance.

## State

- Not built. Phase 5 (room + Reclaim) and Phase 6 (first week build) pending.

## Blockers

- How the PBS schedule arrives: unknown. Asked in Phase 2.
- Whether Ross is still a job: unknown. Asked in Phase 2.
