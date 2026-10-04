---
updated: 2026-09-30
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

- **2026-09-26, Phase 5 built (U3, William present).** The room exists:
  `board/scheduleos/room.board.json`, 31 nodes, 10 traces, D6 on root, reached from the root board.
  `.mcp.json` at the repo root declares `Reclaim` (http, `https://mcp.reclaim.ai`); the endpoint
  answers 401 unauthenticated, so it is real and still wants his browser login — no session has
  authenticated yet, so no tool names are recorded in `private/schedule/reclaim/mcp-tools.md`.
  `npm run schedule:week` exists and ran once against empty inputs (seven empty days); it has not
  run against a real shift. CC-SECRETARY (`u_cc_secretary`) has not had its first run. 0/4
  phantoms on the room, checked in full on 2026-09-26 (away pass, 16:13) — every real fact already
  has a node, nothing deserves a recommendation yet.
- **2026-09-30, the calendar pane (`panel.calendar`) built.** K1 CALENDAR (7 days, 14×8, in THIS WEEK,
  fed `produces` from SCHED-BUILD) and K1 THIS WEEK on root beside D6 (compact, 3 days) draw
  `schedule/calendar.json`, the merged calendar: PBS shifts with their chains, the secretary's
  `private/schedule/events.json`, and any private iCal feeds William puts in settings.json
  `schedule.icsUrls` (none yet; fetched every 10 min by the app). The app rebuilds the file when an
  input changes and pushes it to the board; `npm run schedule:week` writes it too and draws
  `week.html` from it. It ran once on 2026-09-30: 0 shifts, no export, 0 blocks, so both panes show
  empty dotted days until the first real shift or export lands. Not yet seen on screen by William.
- **Timezone still wrong as of 2026-09-26:** every calendar reads `America/Los_Angeles` through
  the Google Calendar connector. William's hands (`private/schedule/reclaim/hours-and-timezone.md`
  §1), before any habit is re-timed or any chain is written.
- Phase 6 (first week build with William: timezone fix, Reclaim login, one real shift fed in)
  pending — see `codex/projects/skynetos.md` "Next" for the concrete one-action-each queue.

## Blockers

- How the PBS schedule arrives: unknown. Asked in Phase 2.
- Ross: ended (William, 2026-09-25). The `Work (WorkJam)` calendar is to be hidden or removed by him, and no WorkJam workflow survives.

## 2026-09-30 — the first real schedule (U3, William present)

- William set every calendar to `America/Denver` (verified through the connector) and logged a
  session in to Reclaim: 32 tools, events and tasks, **no habit create or update**
  (`private/schedule/reclaim/mcp-tools.md`). Reclaim's own time zone and Hours are his to set in
  the web app; not yet confirmed.
- Seven October Montana PBS shifts are in `schedule/pbs-shifts.json` (six from the crew list, one he
  added for Oct 11 with call about 8 am, details TBD) and on the `Work – Shifts` calendar as
  `📺 MTPBS: <position> – <event>`, start = call time, end = game start + 3 h, a 60-minute popup.
  Logged in `schedule/changes.log.jsonl`. The prep chains exist in the week view and the board pane;
  they are NOT yet on `Work – Prep Blocks` (his go).
- Found: Saturday Oct 3's 11:00 am call overlaps the Saturday morning stream (10 am–1 pm Mountain).
- `panel.calendar` built the same day: K1 in the room, K1 THIS WEEK on root; shows after a restart.
- **Streams are calendar events now (2026-09-30).** Two weekly series on `[MAIN]`: `🔴 LIVE 10–1 ·
  morning cast` Thu+Sat 10:00–13:00 and `🔴 LIVE 8–11 · night cast` Tue+Fri 20:00–23:00 Mountain,
  each with a 45-minute `🎛 STREAM PREP` before it. **William's rule: a PBS shift takes priority
  over everything.** An overlapping stream occurrence is removed (EXDATE), never the shift; Oct 3's
  morning cast is removed for the 11:00 call. The secretary applies this whenever a shift is added.
- **Habits rebuilt 2026-09-30** in Reclaim by William (16: WRITE, ALBUM, EDIT, BUILD, SKYNET,
  CHANNEL, READ book, READ Comic, MOVIE, WALK, EXERCISE, MEDITATE, LUNCH, DINNER, PAY CARD, UPDATE
  SYSTEMS), checked against the calendar and his screenshot. He set Personal and Working hours "to
  taste": the 23:00–07:30 quiet rule in the Face's model is no longer a rule, his Hours are.
  `private/schedule/reclaim/habits.json` still holds the Face's older set and should be rewritten
  from his.
- **Prep chains are on the calendar (2026-09-30).** 42 events on `Work – Prep Blocks`, six per
  shift for the seven October shifts: shower T−55 (popup 10 min), gear + eat T−30, leave now T−20
  (popup at start), walk in T−15, home +0, decompress +15. Verified by a read of the calendar.
  Reclaim moved the habits clear of them within minutes (Oct 1: BUILD now ends 3:45, MEDITATE moved
  to 9:00 AM). The secretary adds the same six whenever a shift is added.

## Next

1. **Rewrite `private/schedule/reclaim/habits.json`** from William's real 16-habit set (WRITE, ALBUM,
   EDIT, BUILD, SKYNET, CHANNEL, READ book, READ Comic, MOVIE, WALK, EXERCISE, MEDITATE, LUNCH,
   DINNER, PAY CARD, UPDATE SYSTEMS) and his own Personal/Working hours — the file still holds the
   Face's older placeholder set (S, agent work, data entry only, no design decision).
2. **Confirm Reclaim's own time zone and Hours in the web app** match the Denver fix made through
   the Google Calendar connector — stated "not yet confirmed" as of 2026-09-30 (William's hands).
3. **William sees `panel.calendar` (K1 CALENDAR / K1 THIS WEEK) on screen for the first time** — built
   and populated with the real October shifts, never yet opened (William's hands).
4. Remove or hide the `Work (WorkJam)` calendar — Ross ended 2026-09-25, no WorkJam workflow survives
   (William's hands, queued since Phase 5).
