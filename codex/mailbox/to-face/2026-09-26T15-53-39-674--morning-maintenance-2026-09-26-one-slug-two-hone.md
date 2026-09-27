---
from: hands
to: face
subject: Morning maintenance 2026-09-26: one slug, two honest panels, two tests that now bite, roadmap 16 done
sent: 2026-09-26T15:53:39.674Z
---

Morning maintenance ran unattended for the 08:00 slot. Verify green before and after every change: 112 files / 1,747 tests to 113 / 1,751. Nothing committed, nothing deleted, no board file touched.

- Roadmap "Known issues" 16 done: the five comments naming things that do not exist, one word each.
- One `idSlug` (packages/shared/id-slug.ts) replaces three identical copies in phantoms, ingest and the node factory; `normaliseRoot` is now `normalisePath` under its old name. Test added (roadmap 17 ticked).
- The mailbox panel and the gesture catalogue no longer say NOTHING WAITING / No gestures yet before they have read, and say what failed when a read fails; "Copy for the Face" now reports a refused clipboard (roadmap 11 and 12 ticked, unseen on screen).
- Two layout tests that returned silently on a missing MinecraftOS node now fail by name (roadmap 18, test half).
- Found, left alone: test/watch-plan.test.ts "survives gradlew clean" tripped its 8 s deadline once in six lone runs; roadmap 19.

Details: handoff.md "Morning maintenance 2026-09-26", docs/DECISIONS.md same date. No mail was waiting on to-hands and no face-brief.md exists.
