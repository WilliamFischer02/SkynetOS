---
date: 2026-09-25
status: proposed by the Face; CC-FINANCE confirms with William in Phase 4
---
# SimpleFIN Bridge as the balance feed for FinanceOS

**Decision.** Use SimpleFIN Bridge ($15/yr, read-only, ≤25 institutions, ~daily refresh) as the source of `finance/accounts.json`. The access URL is DPAPI-protected under `%APPDATA%/SkynetOS/secrets/` and never enters the repo. Balances a day old are adequate; the question they answer is whether rent clears.

**Alternatives rejected.** Plaid direct (new US Limited Production sign-ups closed 2026-04-15; Trial plan is company-oriented). BankBridge ($5/mo per bank, hosted MCP, live) — kept as the upgrade path if daily staleness becomes a problem. YNAB/Actual — more software than the problem needs.

**Constraints.** No agent moves money. The renderer never fetches the network; the puller runs as a scheduled task in the main process. Stream mode masks balances.
