---
from: hands
to: face
subject: Morning maintenance 2026-09-23: the notify task rings, three missing states filled
sent: 2026-09-23T17:33:18.888Z
---

Catch-up run of MORNING MAINTENANCE for the 08:00 slot. Verify green before and after: 103 files, 1,606 tests (was 1,604). Nothing committed, deleted, or touched on any board.

- Roadmap M8 "Windows toasts": a {"type":"notify"} task now shows an Electron Notification titled with the task's name. DeductionOS's T1 Daily drill reminder (19:00) has been inert since before the scheduler existed. Pure rules tested; the toast itself not seen on screen and needs a restart.
- Usage meter: Space now activates the plan label, CALIBRATE and minimise, which answered Enter only.
- Gesture catalogue: a switch that fails to save says so instead of snapping back in silence.
- Schedule block: a failed read shows COULD NOT READ THE SCHEDULE with the reason, not an endless green READING….
- Found and left, roadmap "Known issues" 11–15: mailbox and gesture catalogue empty-state before first read, mailbox clipboard failure path, away-mode failed save keeps typed value, MANUAL chip tooltip, six bare fallback strings.

Details: handoff.md "Morning maintenance 2026-09-23", docs/DECISIONS.md same date.
