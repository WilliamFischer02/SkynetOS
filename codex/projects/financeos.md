---
updated: 2026-09-25
status: active — room exists (built 2026-09-23); the Face's spec is merged into it in Phase 3
owner-node: CC-FINANCE (FinanceOS room), U3 until Phase 7
---

# FinanceOS

**Identity.** The room where William looks at his money without softening, and launches the
income sources he chose. Two authors: Prime built the first room on 2026-09-23 (ledger model,
`npm run finance:report`, meters on the LEDGER node, a finance-advisor persona, two disabled
tasks); the Face's drop of 2026-09-25 adds the INCOME LAUNCHER, the live balance feed, the
dashboard and the rituals. Spec: `codex/drops/…/specs/financeos-room.md` (on disk). Agent
directive: `codex/drops/…/directives/20-finance-advisor-agent.md`. Prime's persona:
`codex/personas/finance-advisor.md`.

**Board.** `board/financeos/room.board.json`; drive `d5_financeos` on root. Theme today
`#5CDCD0` (graphite, cyan); the Face proposed `#FF7AC8`. Chosen at the Phase 3 merge, with William.

**Where things live (decision 2026-09-25, private split).**
- Tracked: `finance/aggregator-options.md`, `finance/ledger-schema.json`, `finance/sync/`
  (scripts, written in Phase 4), `packages/shared/finance.ts`, `tools/finance-report.ts`.
- Private, gitignored: `private/finance/settings.json` (rent, base, goal, APR, minimum,
  subscriptions), `selections.json` (the chosen options with dashboard URLs), `ledger.json` and
  `ledger.jsonl`, `accounts.json` (daily balances), `balances.log.jsonl`, `transactions.cache.json`,
  `subscriptions.json`, `dashboard.html`, `reviews/`, `closes/`, `research/` (the 216 options),
  `residency-and-benefits.md`, `institutions.md`.
- Secrets: `%APPDATA%/SkynetOS/secrets/` only (SimpleFIN access URL, DPAPI).

**Data feed.** SimpleFIN Bridge (read-only). Upgrade path: BankBridge hosted MCP. See
`finance/aggregator-options.md`.

**Rituals.** Advisor Review Sunday 18:00 (`t1_review`, disabled until Phase 4). Monthly close last
Sunday. FIN-SYNC 06:00 daily (needs a built-in action or an `agent.run`: no scheduled task may run
a shell string, docs/07).

## State

- Room: exists, 27 nodes, unseen on screen. Launcher zone, FIN-DASH, FIN-SYNC: Phase 3–4.
- Feed: not set up. Phase 4.

## Blockers

- Card issuer and APR resolved (Bank of America, 24.49% APR, per `private/finance/settings.json`
  stated 2026-09-24/25) — only the minimum ($210) is still flagged as a placeholder. Corrected
  2026-09-26 (away pass); the prior "unknown, asked at the hardship call" line was stale.
- Ross Dress for Less ended (2026-09-25): PBS is the only base income.
- Whether SimpleFIN covers his institutions: verify in Phase 4; log in `aggregator-options.md`.
