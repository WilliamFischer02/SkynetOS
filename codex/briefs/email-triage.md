---
name: email-triage
updated: 2026-09-23
status: proposed
purpose: The brief a scheduled EMAIL TRIAGE task (07:30 daily, agent.run on JARVIS Prime) hands to a fresh session. Read at run time, so editing this file changes tomorrow's run. Not yet on any board.
---

# Email triage: what needs William, said once, in order

William: "connect you to read and manage my email inboxes … sort through all past emails … be
able to categorize incoming emails and create an urgency scale that allows you to notate to me
what needs my attention which I may have missed."

You are JARVIS Prime, running unattended, reading William's mail. He may be asleep or at work.
Your job is to say what needs him and why, and to make the inbox say it too, with labels. You do
not answer his mail, and you do not throw any of it away.

## 0. Before anything

- The Gmail connector is the only door today (`mcp__claude_ai_Gmail__*`). Load the tools you need
  in ONE `ToolSearch` call. If `list_labels` does not show the four `JARVIS/*` labels and
  `create_label` answers "Insufficient scope", **the connector is read-only**: do the read half of
  this brief, write the digest, and say in it that labels need the connector re-authorised with
  the modify scope (docs/10-EMAIL.md, "What William does").
- **A session SkynetOS launches may not have this connector at all.** The connector belongs to
  the claude.ai login of the Claude Code session, not to SkynetOS, and this brief was written from
  a session that had it; whether a fresh `agent.run` session inherits it has not been verified.
  If the tools are absent, say so in handoff.md in one line and stop. Do not go looking for
  another way in.
- Read `docs/10-EMAIL.md` §Rules. They are docs/07 for mail.

## 1. The scale

| Level | Means | Rule of thumb |
|---|---|---|
| **P0 NOW** | Money, security or a deadline inside 48 hours | An unpaid or unconfirmed bill; a charge he did not make; a sign-in he did not make; anything that expires or auto-renews inside two days; a real person waiting on a same-day answer |
| **P1 THIS WEEK** | A decision with a date inside about ten days, or a cost that keeps running until he acts | Renewals and price increases; offers that reduce debt; a service that has gone dark; a security change to confirm; a real person waiting |
| **P2 WHEN CONVENIENT** | Worth a look, no clock | Trials ending later in the month; pricing changes; leads of doubtful origin; things already resolved that leave a loose end |
| **P3 NOISE** | Nothing to do | Newsletters, promotions, bot chatter, shipping updates that arrived, receipts for expected charges |

Age moves things up, not down: a P1 that is older than its date becomes P0 if the cost is still
running, and P3 if the moment has passed and nothing can be done. Say which.

## 2. The categories

One category per thread, chosen by the sender first and the subject second.

| Category | Sender kinds | Subject patterns | Default level |
|---|---|---|---|
| FINANCE | loan servicers, banks, cards, wallets (PayPal, Stripe Link), merchant platforms (Lemon Squeezy), brokerages and crypto platforms | statement, payment, balance, receipt, refund, "you made a sale" | P1 if a decision or an unconfirmed payment; else P3 |
| BILLS | any merchant | "renew", "price increase", "trial ends", "subscription", "payment due", "past due", "overdue" | P1; P0 if the date is inside 48 h or the words are "past due" |
| SECURITY | accounts.google.com, appleid, firefox accounts, vercel, github, cloudflare login, sony, student-aid portals | "new sign-in", "password", "verification code", "was changed" | P1 to confirm; P0 if it names a device or place that is not his; **a one-time code is never quoted, anywhere** |
| PEOPLE | a human address, not a no-reply | anything | P1; P0 if a question was asked and has waited more than two days |
| WORK | github (non-bot), supabase, fly.io, cloudflare (non-marketing), resend, webflow, vercel | "action required", "grants", "deprecation", "usage", "pricing" | P1 if a date or a breakage; else P2 |
| SHOPPING/RECEIPTS | apple receipts, ebay, ups, amazon, regal tickets, food orders | "receipt", "order", "delivered" | P3; P1 if a charge looks unexpected |
| NEWSLETTERS | claude.com, fly newsletter, supabase update, justwatch, buzzfeed | | P3 |
| PROMOTIONS | tidal marketing, splice, tripo, regmovies, netease, crunchyroll, kickstargogo, indeed matches, pinterest | | P3 |
| NOTIFICATIONS | github bots, linkedin, thangs, hinge, reclaim reports, mxtoolbox, artstation | | P3 |

A thread that fits two categories takes the one with the higher default level.

## 3. What you may do unattended, and what needs his click

| Action | Who |
|---|---|
| Read subjects, senders, snippets; open a body only when the subject cannot decide the level | JARVIS |
| Create the four labels once; apply `JARVIS/P0-NOW`, `JARVIS/P1-THIS-WEEK`, `JARVIS/P2-LATER`, `JARVIS/FINANCE` | JARVIS, at most 40 threads a run, every one recorded in `private/email/labels-applied-<date>.json` so it can be undone |
| Remove a `JARVIS/*` label you applied earlier when it no longer applies | JARVIS |
| Write the digest (§4) to `private/email/digest-<date>.md`, the counts to handoff.md, and a counts-only note to the Face | JARVIS |
| Archive, reply, forward, unsubscribe, trash, mark spam, star, mark read, create or delete drafts | **William**, always. Not exposed to this brief even when the scope allows it |
| Quote a body, an address that is not his, an account number, a one-time code, or a password into any file outside `private/` | **Nobody** |

## 4. The digest

One line per P0 and P1 item, in that order, each starting with the state in capitals and ending
with the action. Then one line of counts. Nothing else. Written to `private/email/digest-<date>.md`
and shown to William as the `notify` toast text of the task if it fits, otherwise the toast says
how many P0 and P1 there are and where the file is.

```
P0  LOAN STATEMENT ON THE 6TH, NO PAYMENT CONFIRMATION SINCE — CHECK THE SERVICER'S SITE TODAY
P1  STREAMING PLAN RISES TO $X ON THE 2ND — CANCEL OR KEEP BY THE 1ST
P1  TWO ANNUAL RENEWALS ON THE 20TH ($X + $Y) — DECIDE BY THE 18TH
P1  A DOMAIN LEFT ITS DNS PROVIDER AFTER FIVE WARNINGS — CHECK THE SITE IS UP
P1  ACCOUNT PASSWORD CHANGED ON THE 17TH — CONFIRM IT WAS YOU
—   6 unread · 1 P0 · 4 P1 · 3 P2 · everything else noise · 12 labelled
```

(Illustrative shapes, not real items: the real digest lives under `private/`.) A line names a
merchant and an amount because both are needed to act; it never names another person's address
or an account number. If nothing is P0 or P1, the digest is the counts line
alone, and the toast is not shown: silence is the report when nothing has changed.

## 5. A run, in order

1. Load the tools. `list_labels`. Note whether the `JARVIS/*` labels exist.
2. `search_threads newer_than:2d in:inbox` (everything since the last run; use `newer_than:8d` on a
   Monday or after a missed run), then the targeted sweeps: `is:unread`, bills (`renew OR renewal OR
   "price increase" OR "past due" OR "payment due" OR trial`), security (`"new sign-in" OR "verification
   code" OR password OR "was changed"`), money (`statement OR receipt OR payment OR refund OR "you
   made a sale"`), and anything from a human address.
3. Level and categorise each thread by §1 and §2. When a subject cannot decide, open the body with
   `PLAIN_TEXT`, decide, and forget the body.
4. Compare with the previous digest in `private/email/`. An item already reported stays in the
   digest only while its date is still ahead; say "STILL" in front of it.
5. Apply labels if the scope allows (cap 40, record every id). If it does not, skip and say so.
6. Write the digest, the handoff line, and the Face note with counts only. Stop.

## 6. How this becomes a scheduled task

A `task.scheduled` node on the root board:

```json
{ "schedule": "30 7 * * *", "action": { "type": "agent.run" },
  "taskTarget": "u3_jarvis_hands", "taskBrief": "codex/briefs/email-triage.md" }
```

It runs only while SkynetOS is open, catches up once within `catchUpHours`, and counts against the
six scheduled runs a day. **Not placed yet**: two things must be true first, and neither has been
checked: that a session SkynetOS launches has the Gmail connector, and that the connector has the
modify scope. Until then this brief is run by hand, from a session that has both.

## 7. Bounds

- Stop after about 20 minutes or one full pass, whichever comes first.
- Never more than 40 label applications a run, never a label that is not `JARVIS/*`.
- Nothing in `codex/`, `handoff.md` or the Face's mail may carry a subject line, a sender
  address, a name, an amount tied to a person, or a code. Counts and categories only.
- Everything else in docs/10-EMAIL.md §Rules.
