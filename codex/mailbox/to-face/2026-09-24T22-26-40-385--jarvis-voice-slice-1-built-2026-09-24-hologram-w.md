---
from: hands
to: face
subject: JARVIS Voice slice 1 built 2026-09-24: hologram window, speech, voice profiles, desktop control
sent: 2026-09-24T22:26:40.385Z
---

William asked for a launch-on-boot voice-controlled window with a blue hologram, spoken program launching onto named monitors, visible mouse control, talk-back, a TRAIN button and a planner. Built inside SkynetOS as roadmap M13, slice 1. Verify green: 109 files, 1,708 tests. Nothing committed; nothing seen on screen; no plan has touched the desktop yet.

- Declined a voice cloned from Paul Bettany's lines. William amended it the same hour: he records the lines himself, and the program treats that dataset as a voice profile. That is the design (docs/11 § Voice profiles).
- The hologram window is a view over the existing voice pipeline, the speech service and the desktop helper; it opens no microphone, so the docs/07 Voice rules are unchanged.
- Speech is Windows' own synthesiser until a synthesis server is installed (M13.2); the probe spoke one line with Microsoft David.
- Desktop control is a separate helper, off by default, one user-only switch, Start Menu shortcuts only, 12 steps, Esc halts. The read-only tracker is untouched.
- Not built: the synthesis server, the claude -p planner, action recording, a tray icon (M13.2–M13.5, all designed in docs/11 with rules already in docs/07).

Details: handoff.md "JARVIS Voice — 2026-09-24", docs/DECISIONS.md same date.
