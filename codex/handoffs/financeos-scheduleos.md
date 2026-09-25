---
updated: 2026-09-25
status: active — the build handoff for the Face's drop; superseded by handoffs/financeos.md and handoffs/scheduleos.md after Phase 7
owner-node: U3 (JARVIS-PRIME) until CC-FINANCE and CC-SECRETARY exist
---

# FinanceOS + ScheduleOS build — handoff

Master directive: `codex/drops/skynetos-drop-2026-09-25-financeos-scheduleos/directives/00-prime-master-directive.md`
(the drop is on disk only; `codex/drops/` is gitignored, decision 2026-09-25 private split).

## Phase 0 — done 2026-09-25

- Drop present, 33 files, complete. Path differs from the directive's (`skynetos-drop-…`); every
  reference here uses the real one.
- All nine node kinds the specs use exist in the schema.
- `npm run verify` green: 112 files, 1,747 tests.
- No Reclaim entry in `claude mcp list`. Google Calendar connector connected in Prime's session.
- Found: a FinanceOS room already exists (Prime, 2026-09-23, D5 on root, 27 nodes, ledger model,
  `npm run finance:report`, meters on the LEDGER node, finance-advisor persona). Phase 3 is a merge.
- Found: no `task.scheduled` action runs a shell string, and docs/07 forbids one; FIN-SYNC needs a
  built-in action or an `agent.run` (Phase 4 decision).
- William: merge the two rooms; the private split; the more secure choice; commit as needed.

## Phase 1 — done 2026-09-25

| From the drop | To | Note |
|---|---|---|
| `codex/projects-*.md` | `codex/projects/rent-run.md`, `financeos.md`, `scheduleos.md` | figures removed, paths rewritten to `private/` |
| `codex/decisions/*.md` | `codex/decisions/` (three files) | as written, plus `2026-09-25-private-split-…` by Prime |
| `codex/index-lines.md` | `codex/index.md` § Projects — LifeOS, and the handoffs line | index at 87 lines |
| `data/` | `private/finance/research/` | gitignored |
| `finance/residency-and-benefits.md` | `private/finance/` | carries his figures |
| `finance/aggregator-options.md`, `finance/ledger-schema.json` | `finance/` | tracked |
| `reclaim/` | `private/schedule/reclaim/` | carries calendar IDs |
| — | `private/finance/settings.json` | seeded with the stated figures, placeholders flagged |
| — | `.gitignore`: `codex/drops/`, the generated `schedule/` files | `private/` was already ignored |

Directories: `finance/sync/`, `schedule/`, `private/finance/research/`, `private/schedule/reclaim/`.
Committed as `feat(codex): install financeos/scheduleos drop from the Face, 2026-09-25` (only these
paths; yesterday's JARVIS Voice work stays uncommitted for review).

## Next — Phase 2, interactive, 60–90 min with William

Load `directives/10-income-orientation.md`. Open with the three questions the directive holds:
Ross still a job? How does the PBS schedule arrive? Card issuer, APR, minimum (no card number).
Then Block A (relief), B (six lanes), C (three at a time, five yeses), D (sign-ups, Prolific first;
the DataAnnotation test is one shot and goes in a rested block, not this session), E (close).
Outputs: `private/finance/selections.json` (≥5 entries, ≥2 applied/active with dashboard URLs),
`private/finance/settings.json` updated, tomorrow's first task, three lines in `codex/journal/`.

## Landmines

- Every path the Face's directives give as `finance/research/…` or `schedule/reclaim/…` is
  `private/finance/research/…` or `private/schedule/reclaim/…` here.
- The drop's board snippets use `d5_financeos`, the id the existing drive already has; the
  scheduleos snippet's `d6_scheduleos` is free. Grids in the snippets are 48×30; the existing rooms
  are 144×96 in tiles; match the existing scale at the merge.
- The drop proposes signal `#FF7AC8` for FinanceOS; the room today is `#5CDCD0`. Ask at Phase 3.
