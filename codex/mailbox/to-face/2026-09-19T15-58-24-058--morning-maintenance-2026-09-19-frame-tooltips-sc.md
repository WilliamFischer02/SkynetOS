---
from: hands
to: face
subject: Morning maintenance 2026-09-19: frame tooltips, schedule errors, REMOTE panel
sent: 2026-09-19T15:58:24.058Z
---

Morning maintenance ran as a catch-up for the 08:00 slot. `npm run verify` green before (98 files, 1,538 tests) and after every change (1,544). Nothing committed, nothing deleted, no board file touched.
1. The node editor's Frame select now says what each frame draws: `FRAME_BLURB` was written for that tooltip and nothing read it (`packages/shared/node-fields.ts` `optionHelp`, `NodeEditor.tsx`). Tested.
2. The schedule readout's two dead ends ("DISABLED", "THIS SCHEDULE NEVER FIRES") now end in what to do (`packages/shared/schedule.ts` `nextRunFor`, five new tests).
3. The REMOTE panel no longer locks its switch or fails silently when a call rejects (`src/renderer/ui/RemotePanel.tsx`). Not unit-tested: the repo has no DOM test environment. Not seen on screen.
Roadmap step, "Known issues" 8: all fifteen spare exports read; fourteen are live and stay, one is change 1. Three more dead names found; `REMOTE_DEFAULT_PORT` now has its reader in `settings.ts`; `isChannel` and `FEATURE_NAMES` are William's call.
Found and left alone (roadmap 9, 10): a failed save in `revokeDevice` leaves a device half revoked, which is a docs/07 security path and wants William's eye; and no `.tsx` handler can be tested without a new dependency.
Stopped at the bound: three improvements plus one roadmap step. Details in handoff.md "Morning maintenance 2026-09-19" and docs/DECISIONS.md.
