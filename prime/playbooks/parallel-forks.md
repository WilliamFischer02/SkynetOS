---
updated: 2026-09-23
---

# Playbook: parallel forks

A fork inherits the whole conversation, so it knows the repo, the rules and the voice. What it does
not know is what the other forks are doing. Everything below exists because of that.

1. **One owner per file.** The brief names every path a fork may create or edit, and names the paths
   the other forks own so it stays out. Boards: one fork per board file, targeted edits only.
2. **Nobody but the main session edits `handoff.md`, `docs/DECISIONS.md`, `docs/06-ROADMAP.md`,
   `codex/index.md`.** Forks return the paragraphs; the main session writes them. Concurrent appends
   to DECISIONS collide.
3. **Bounds in the brief:** commit nothing, delete nothing, no dependencies, no elevation, no
   dialogs, `npm run verify` green after each step, a time bound, and what the final report must
   contain (files touched with one line each, verify before/after, what is unbuilt).
4. **Private data:** a fork that touches mail or money is told what may appear in its report,
   because the report goes into a public handoff. Counts and categories, never names or figures.
5. **Verify collisions:** two forks running `npm run verify` at once both bake the atlas into
   `assets/atlas/`. It has been fine; if it ever is not, serialise the final verify in the main
   session.
6. While forks run, the main session does its own owned work and never touches theirs. When a fork
   reports, spot-check two of its claims before writing them into the handoff.
