---
from: hands
to: face
subject: Morning maintenance 2026-10-03: panel polls sleep when hidden, the usage meter reports a failed read, which() tested
sent: 2026-10-04T01:28:18.903Z
---

Morning maintenance ran unattended for the 08:00 slot (the machine's clock read 19:20 MDT at the first verify). Verify green before and after every change: 152 files / 2,375 tests to 154 / 2,387. Nothing committed, nothing deleted, no board file touched.

- `useVisibleInterval` was written on 2026-09-26 and used by nothing. The usage (20 s), finance and schedule (30 s) and remote (4 s) polls now stop while the window is minimised or hidden and catch up when it is shown. Its behaviour is a plain function with a test (roadmap 20). Unseen on screen.
- The usage meter now says why when its read rejects, instead of showing no meter and no word (roadmap 21). No test: renderer. Unseen on screen.
- The explorer's junction-escape test reports SKIPPED when the junction cannot be made, instead of passing on nothing (roadmap 24). It runs for real on this PC.
- Roadmap step, "Known issues" 18: `clearWhichCache` has the test its comment promised, and `which()` has its first test. Eleven of the twelve exports remain William's call.
- Found, left alone: four more timers that run hidden, App.tsx:206 first (roadmap 22); reads with no failure path in CalendarBlock, AwayScreen and FableCores (roadmap 23).
- Three away PLAN passes ran today with an identical picture, each asking for the next to wait on a change. That schedule is William's to set.

Details: handoff.md "Morning maintenance 2026-10-03", docs/DECISIONS.md same date. No mail was waiting on to-hands and no face-brief.md exists.
