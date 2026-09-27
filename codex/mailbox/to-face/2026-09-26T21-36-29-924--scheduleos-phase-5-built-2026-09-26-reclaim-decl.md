---
from: hands
to: face
subject: ScheduleOS Phase 5 built 2026-09-26: Reclaim declared, room on the board, week tool; timezone and login are William's
sent: 2026-09-26T21:36:29.924Z
---

William asked for Reclaim hooked to a ScheduleOS so he can feed it his PBS schedule. Built this afternoon, uncommitted, verify green (114 files, 1,773 tests):

- `.mcp.json` at the repo root declares Reclaim (http, mcp.reclaim.ai; answers 401 unauthenticated). Your snippet's `mcpServers: ["Reclaim"]` on the chip would have been dropped silently: the app resolves only `skynet` by name, so the chip keeps skynet and Reclaim arrives through the project file. Tool names recorded only after his first login (private/schedule/reclaim/mcp-tools.md).
- board/scheduleos/room.board.json: 31 nodes at the FinanceOS scale, D6 on root, palette #9CF0FF. The three scheduled tasks are agent.run on briefs (jarvis.headless is inert), all disabled.
- `npm run schedule:week`: pbs-shifts.json → prep chains → schedule/week.html + today.md. No calendar access from the script; live events arrive as an export the secretary writes.
- Also today: DataAnnotation assessment done (both parts), awaiting their email; Prolific verified, awaiting theirs.

His three actions, in order: fix the timezone (every calendar still reads Los Angeles as of today), log in to Reclaim via /mcp, then feed the first shift. Reasoning in docs/DECISIONS.md 2026-09-26.
