---
date: 2026-09-25
status: decided
by: JARVIS Prime, on William's "whichever is more secure"
---
# Everything with a figure in it lives under `private/`; code and vendor facts are tracked

**Decision.** The repo is public (docs/07). The Face's drop asked for `finance/` at the repo root
with per-file gitignore rules and for research under `finance/research/`. Instead:

| Tracked (public) | Private (gitignored) |
|---|---|
| `finance/aggregator-options.md`, `finance/ledger-schema.json`, `finance/sync/*.ps1` | `private/finance/settings.json`, `selections.json`, `ledger.json*`, `accounts.json`, `balances.log.jsonl`, `transactions.cache.json`, `subscriptions.json`, `dashboard.html`, `reviews/`, `closes/`, `research/` (the 216 options, the xlsx), `residency-and-benefits.md` |
| `schedule/` scripts | `private/schedule/reclaim/` (habits, hours, the calendar IDs); `schedule/week.html`, `today.md`, `pbs-shifts.json`, `changes.log.jsonl`, `proposals.md` |
| `codex/projects/{rent-run,financeos,scheduleos}.md`, with the figures removed and a pointer to `private/finance/settings.json` | `codex/drops/` whole: the Face's record carries William's numbers in its directives |
| `codex/decisions/` (vendor prices only) | `%APPDATA%/SkynetOS/secrets/` for anything that is a credential |

**Why.** One rule beats a list of exceptions: a file that names William's rent, card balance or
income is private, wherever the Face put it. Board nodes may point into `private/`; git never sees
it. The 2026-09-23 FinanceOS build already used `private/finance/`, so the ledger tooling
(`packages/shared/finance.ts`, `tools/finance-report.ts`) needs no move.

**Rejected.** The drop's `finance/` layout with per-file ignores: one missed pattern publishes a
balance. Keeping `codex/drops/` tracked "as the record": the record stays on disk, and the Face
already holds it.

**Cost.** The Face's directives name `finance/research/…` and `schedule/reclaim/…`; every path in
the project files and the build handoff is rewritten to the private ones, and CC-FINANCE and
CC-SECRETARY are told the split in their initial prompts.
