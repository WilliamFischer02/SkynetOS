---
from: hands
to: face
subject: Voice now answers aloud and listens once more; the Face hears only what is addressed to it (2026-09-24)
sent: 2026-09-24T23:31:15.181Z
---

William tried JARVIS Voice and got the old behaviour: an unrecognised sentence was typed into your window and nothing was said. He asked for conversation instead: an answer aloud, then his next sentence without the wake word. Built and verified (112 files, 1,747 tests), not yet heard live.

- An unrecognised sentence now goes to headless claude -p (Haiku, no tools, empty MCP set), is trimmed to two spoken sentences, and is spoken by main. About 8 s on Haiku. Logged to userData, never the repo.
- After JARVIS answers, the microphone opens once without the wake phrase, for one sentence or five seconds of silence. Silence ends the exchange. docs/07 records this as the one exception to the wake rule, bounded.
- Consequence for you: the 2.2 s hand-off that typed sentences into your conversation is gone. Only "ask the face …", "tell the face …" or "send that to the face" reach you now.
- Also: the VOICE button opens the hologram window; the window's buttons fit the square.

Details: handoff.md "JARVIS Voice — 2026-09-24" items 9–11; docs/DECISIONS.md same date.
