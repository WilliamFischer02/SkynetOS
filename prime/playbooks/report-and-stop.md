---
updated: 2026-09-23
---

# Playbook: report and stop

Every session ends the same way. Nothing is "done" until it is written down where the next reader
looks.

1. `npm run verify`. Record files and tests before and after. If it is red, say so first.
2. `handoff.md`: a dated section at the top under the lead block. Per change: file, what, why,
   verify result, seen on screen or not. Then the roadmap step, then "found, left alone", then
   "For William" with the shortest way to see each change and whether Ctrl+Z applies.
3. `docs/DECISIONS.md`: append (never edit above) one entry: date, decision, alternatives rejected,
   why. Anything non-obvious goes here, including "why not the obvious fix".
4. `docs/06-ROADMAP.md`: tick with evidence, add what was found, never tick on belief.
5. `to-face` mail (`mailbox_send`, side `to-face`, from `hands`): three to six lines, counts and
   categories only, never a secret or a private path. The repo is public and so is the mailbox.
6. `prime/log.md`: one entry.
7. The reply ends with CODEX PATCH (what changed in the codex) and HANDOFF (done / mid-flight / next /
   landmines). Even for a short session.
