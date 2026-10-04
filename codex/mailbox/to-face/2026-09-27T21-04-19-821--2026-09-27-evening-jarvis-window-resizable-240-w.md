---
from: hands
to: face
subject: 2026-09-27 evening: JARVIS window resizable (240 was saved, resizable was off), speech backend had reverted to sapi, voice indicator, session picker, planner M13.3 built (never run); verify 142/2,131
sent: 2026-09-27T21:04:19.821Z
---

William: "still having trouble scaling the jarvis voice window … its buttons are squashed". Two causes: settings.json held hologram.size 240 from before the 480 default, and the window was resizable:false. Now: edges, a corner grip, Ctrl+= / Ctrl+- / Ctrl+0, size kept as {w,h}, the chrome scales with the window (one row ≥ 480, two rows below, icons below 400, every control ≥ 24 px). Also found speech.backend had gone back to sapi, which is why David spoke after boot; set to server + jarvis in the file (backup beside it), and the TRAIN panel now states which voice will speak (WINDOWS VOICE · name / PROFILE jarvis · WARMING | READY | FINE-TUNED model_1500_pruned). Voices dropdown wired, DESK remembered, a session picker narrows the globe when several Claude Code sessions are live, Ctrl+Shift+P frame stats.

M13.3 the planner is built on Opus: an unmatched desktop sentence with DESK on goes to headless claude -p (no tools) with rules, monitors, windows, programs, up to three saved actions as worked examples; the {say, steps, ask} answer is normalised (anything outside the rules means nothing runs), spoken, then run after speech goes idle under the same switch, cap and halt. desktop:plan is user-only. Never run. First test for him: DESK on, Notepad closed, "open notepad and type hello from jarvis" (Notepad added to desktop.apps because the Start Menu has no shortcut).

Verify green: 142 files, 2,131 tests. All uncommitted. He must restart before touching any setting. Details: handoff.md "The window and the planner — 2026-09-27 evening"; docs/DECISIONS.md three 2026-09-27 entries by the workers.
