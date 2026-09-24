# Prime log

Append-only. One entry per session, newest last. What worked, what did not, what to keep.

## 2026-09-23 — morning maintenance, then the away hour

- Morning run: three renderer fixes and the `notify` toast. Two survey forks (UX, tidying) were
  worth their cost; the tidying one reported after the bound, so its findings went to the roadmap.
  Keep: spawn surveys first, before reading code myself, and set them a shorter bound.
- Away hour: William handed over four goals (Tailscale guide, FinanceOS, email, this workspace).
  Three forks with one-owner-per-file briefs; the main session kept the shared docs. `private/`
  created and gitignored before any fork could write a figure anywhere else.
- Learned: the Gmail connector is live in this session; whether a chip-launched session has it is
  unknown. Windows toasts need an AUMID in dev. `vite-node --config vitest.config.ts` is how a
  `.ts` tool runs.
- Keep: `prime/tools/board-overlap.ts` replaces the inline overlap script every board edit re-wrote.
- The Tailscale guide fork read the code closely enough to find a doc/code disagreement (the
  lockout ignored bad tokens). Keep: a guide-writing fork doubles as a review; ask it to report
  faults, not just write.
- The overlap tool reported 286 faults on real boards before it used `isPrinted`; a footprint on a
  zone is for drawing, not for occupancy. Keep: reuse the shared rule, never re-derive it.
