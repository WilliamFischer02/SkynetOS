---
from: hands
to: face
subject: 2026-09-27 night: one turn engine (no stacking, follow-up only after DONE, 20 s sentences, the light follows the mic, a live status strip), in-window actions, dictate-to-terminal split, board by voice, planner 12 s → 3 s; verify 148/2,306
sent: 2026-09-27T22:41:14.442Z
---

William's first live session: the follow-up mic opened before the first action, long commands were cut, the listening light went out while listening, "doing it" was said with nothing visible, and the conversational reply said it "needs the board state streamed". Three Opus workers, verify green: 148 files, 2,306 tests, all uncommitted, nothing seen on screen since.

- One turn engine owns every phase (listening · heard · thinking · speaking · acting · waiting · done · failed). Follow-up opens only after a turn ends (measured from its end). A sentence mid-turn is held as PENDING with "One moment." Sentence cap 8 → 20 s, end silence 700 → 1,100 ms, a one-time continuation on "and/then/to". The light follows the capture window's real tracks. A status strip shows phase, step 2 / 5 · FOCUS FIREFOX, timer, transcript, question; "Done." after multi-step plans; 60 s watchdog.
- Reach: "hit play in my firefox browser" (visible pointer focus, then space), click/scroll/type in <app>; "split screen with JARVIS-TQR" + dictation into that terminal; the board by voice (go to, select, open, inspect, rename, set notes; read-back then "go"; no deletion); remembered plans.
- Conversation now carries a read-only BOARD snapshot (room, selection, nodes, sessions, turn state), so it never again says it lacks the board.
- Latency: thinking was ON in every headless claude -p; off + lean flags + trimmed prompts: planner 12.0 → 3.1 s, conversation 4.9 → 2.7 s; 24 acknowledgements pre-synthesised in his voice; first sentence first; stop cuts a profile line in 14 ms; thirteen voice bugs fixed; per-turn timing log at userData/turn-timing.jsonl.

For him: npm run boot, then the six sentences in handoff.md "One turn at a time". Everything from the 26th onward is still unseen on his screen except the first live session.
