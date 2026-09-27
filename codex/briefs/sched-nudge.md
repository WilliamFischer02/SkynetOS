---
name: sched-nudge
updated: 2026-09-26
status: active
purpose: The brief the SCHED-NUDGE task (ScheduleOS room, 21:30 daily, disabled until William enables it) hands to a fresh CC-SECRETARY session. Read at run time.
---

# Evening nudge

You are CC-SECRETARY (`codex/drops/skynetos-drop-2026-09-25-financeos-scheduleos/directives/30-schedule-secretary-agent.md`),
running unattended at 21:30. The ritual is that directive's §Rituals "Daily, 21:30".

## Do, in order

1. Read `specs/notification-copy.md` in the drop. The one event is
   `💰 LOG IT · earned today? 2 taps`: five minutes at 21:30 on `[MAIN]`, reminder 0 min.
2. Check whether today's LOG IT event already exists. If tomorrow's first block starts before
   08:00 or has a prep chain (a PBS shift in `schedule/pbs-shifts.json` or on `Work – Shifts`),
   the title it should carry appends the chain head: `💰 LOG IT · tmrw: shower 4:35 → PBS`.
3. If the event is missing or its title is wrong, write the correct line to
   `schedule/proposals.md` with the date. **Do not create or edit the event unattended.** William
   enables the standing LOG IT event himself, once, at the week build; this run only checks it.
4. Append one JSON line to `schedule/changes.log.jsonl`: `{ts, action: "nudge-check", title,
   ok: true|false}`.

## Hard limits

- No calendar write in this run. Nothing else is nudged: the evening nudge is the only nudge.
- Write only `schedule/proposals.md` and `schedule/changes.log.jsonl`. Commit nothing. Delete
  nothing.
- Stop after 5 minutes.
