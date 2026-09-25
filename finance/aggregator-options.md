---
updated: 2026-09-25
status: active
---

# Getting live balances into FinanceOS: the options, verified September 2026

| Option | Cost | What you get | Freshness | Agent access | Verdict |
|---|---|---|---|---|---|
| **SimpleFIN Bridge** | $1.50/mo or **$15/yr** + tax | Read-only feed; up to 25 institutions and 25 apps; JSON with accounts, balances, transactions | ~once per 24h per account; ≤24 requests/day | Raw HTTPS GET with an access URL; you write the 40-line script | **Default.** Cheapest, read-only by design, the standard behind Actual Budget, MoneyVue, BudgetFi. |
| **BankBridge** | **$5/mo per connected bank** | Hosted MCP server with 11 typed tools (accounts, transaction search, spending summaries, recurring-charge detection, investments), live fetch on each call, normalized merchant names | Live | Native MCP: `claude mcp add` and the agent reads directly | Upgrade path if William wants balances mid-conversation. Three accounts = $180/yr. |
| **Plaid** (direct) | Trial plan free up to 10 Items; Production is paid and reviewed | The industry aggregator | Live | Requires building an app around Plaid Link | **No.** New Limited Production sign-ups closed to US/CA developers on **April 15, 2026**; the Trial plan is aimed at companies. |
| **Actual Budget** (self-hosted) + SimpleFIN | Free + $15/yr | Full budgeting app, MCP servers exist (`s-stefanov/actual-mcp`, `henfrydls/actual-budget-mcp`) | Daily | Via an Actual MCP | Only if he wants envelope budgeting. Actual pulls transactions, not balances, from SimpleFIN. More software to run. |
| **YNAB** | Paid subscription | Budgeting with bank sync + API | Live-ish | Community MCPs exist | Costs more than the problem. |
| **Manual** | $0 | He types balances weekly | Weekly | The ledger | Fallback for any institution the aggregator cannot reach. |

## Recommendation

SimpleFIN Bridge, $15/yr. Reasons: read-only credentials at the aggregator, not on his machine; cheap enough to keep when money is tight; the protocol is public (`simplefin.org/protocol.html`), so the puller is a small script with no dependency; one setup token, one claim, done.

Balances only need to be a day old. Live balances matter for trading, not for knowing whether rent clears.

## What the SimpleFIN protocol gives you (for the puller script)

- Setup token → base64-decoded claim URL → one `POST` → **access URL** (contains credentials; treat as a secret).
- `GET {access_url}/accounts` → `{ "errors": [...], "accounts": [ { "org": {...}, "id", "name", "currency", "balance", "available-balance", "balance-date", "transactions": [...] } ] }`.
- Query params: `start-date`, `end-date` (unix), `pending=1`, `balances-only=1`, `account=<id>`.
- Rate: keep it to one full pull per day plus one balances-only pull if needed. More than 24/day is refused.

## Coverage log (fill in during Phase 4)

| Institution | Linked? | Notes |
|---|---|---|
| Banner Bank | | |
| Charles Schwab | | |
| Card issuer: ____ | | |
| Coinbase | | Likely not via SimpleFIN; Coinbase has read-only API keys as a separate add |

## Security rules that apply to all of the above

- Access URL / API keys live at `%APPDATA%/SkynetOS/secrets/`, DPAPI-protected, never in the repo, `.mcp.json`, a board file, or the codex.
- `.gitignore`: `finance/accounts.json`, `finance/balances.log.jsonl`, `finance/transactions.cache.json`, `finance/ledger.jsonl`, `finance/secrets*`.
- The SkynetOS renderer never fetches the network (docs/07). The puller runs in the main process's `task.scheduled` action or as a PowerShell script the task invokes; the board only reads the resulting JSON.
- Stream mode: `dashboard.html` must not be open on a captured monitor. Put a `STREAM MODE` check in the build script that renders balances as `••••` when `settings.streamMode` is true.

Sources: [SimpleFIN Bridge](https://beta-bridge.simplefin.org/) · [SimpleFIN protocol](https://www.simplefin.org/protocol.html) · [BankBridge vs SimpleFIN](https://bankbridge.money/guides/bankbridge-vs-simplefin) · [Plaid: Sandbox, Production, Trial, Limited Production](https://support.plaid.com/hc/en-us/articles/16110110883479-How-are-Sandbox-Production-Trial-plan-and-Limited-Production-different) · [Actual Budget SimpleFIN setup](https://actualbudget.org/docs/advanced/bank-sync/simplefin/)
