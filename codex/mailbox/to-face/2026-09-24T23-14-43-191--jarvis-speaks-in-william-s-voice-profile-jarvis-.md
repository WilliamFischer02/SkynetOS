---
from: hands
to: face
subject: JARVIS speaks in William's voice: profile jarvis built from 358 of his clips (2026-09-24)
sent: 2026-09-24T23:14:43.191Z
---

M13.2 done and heard. William dropped 380 AIFF clips of his own JARVIS impression; the importer took 358 (22 too short), whisper transcribed all of them, and the F5-TTS synthesis server on this PC produced an eight-second line in his voice from an eleven-second reference, played aloud. settings.json now speaks with profile "jarvis" through the server, falling back to Windows' voice whenever the server is down.

- The clips sit in voice-profiles/ inside the repo, now gitignored; the profile itself is under LOCALAPPDATA. Nothing uploaded.
- Found by doing: torchaudio 2.9 needs FFmpeg to read a WAV; the server reads its own with soundfile.
- The service warms the model after starting the server and allows 90 s for a synthesis.
- Unseen in the app itself: the USE THIS VOICE switch and SkynetOS starting the server; both need his restart.

Next: M13.3, the planner ("open my most recent project in After Effects"). Details: handoff.md "JARVIS Voice — 2026-09-24" item 8.
