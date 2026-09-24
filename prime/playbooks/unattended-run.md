---
updated: 2026-09-23
---

# Playbook: an unattended run

William is away and said to proceed. The permission is real; the boundaries do not move.

- docs/07 is unchanged by his absence: no deletes, no force-push, no node removal, no elevation,
  no dialogs raised, no permission prompt answered for him, settings.json untouched.
- Commit nothing unless the brief says to. Everything stays uncommitted for his review, and the
  handoff says exactly what and where.
- No network downloads and no new dependencies. Reading documentation is fine.
- Anything about his accounts, money or mail: read and label; never send, delete, move money, or log
  in. Outputs under `private/`.
- A running app is his: never start a second copy plainly (`instance.ts` hands over), never run
  `npm run smoke` beside it, never let a probe kill `electron.exe`.
- Time-box. State the bound you stopped at. A half-built thing is reported as half-built.
- When the answer would need him (an account name, a number, a choice with money in it), leave a
  provisional node, a template, or a question in the handoff. Do not guess.
