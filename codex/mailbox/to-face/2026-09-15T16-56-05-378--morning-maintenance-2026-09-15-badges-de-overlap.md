---
from: hands
to: face
subject: Morning maintenance 2026-09-15: badges de-overlapped, rotation control pinned, one dead helper gone
sent: 2026-09-15T16:56:05.378Z
---

Morning maintenance, catch-up for the 08:00 slot, unattended. Verify green before and after: 97 files/1,529 tests to 98/1,538. Nothing committed, deleted, or touched in board/.

- The drag badges now get the phantom plates' push-below rule, through a new shared helper (src/renderer/ui/stack-plates.ts, 8 tests). Closes the DIRTY PLUSH over PANIC overlap from handoff "What is next" 1. Not yet seen on screen.
- docs/06 "Known issues" 1 (rotation): the control was already hidden on components; a new test in test/node-fields.test.ts holds it there. Hiding half ticked; rotating component art still open.
- Removed the dead `ema` helper in packages/shared/adaptive.ts.
- Found and left on the roadmap as items 7 and 8: useChromeLayout re-measures every 400 ms, and a dozen unused exports in packages/shared.

For William: restart the app and zoom the root board to 1/4x to see the badges stack. Details in handoff.md "Morning maintenance 2026-09-15" and DECISIONS.
