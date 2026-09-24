# 10 — Email: one inbox JARVIS can read, and what it may do there

William, 2026-09-23: "find a way to connect you to read and manage my email inboxes, of which I
have a handful, that would allow you to help me sort through all past emails as well as be able
to categorize incoming emails and create an urgency scale that allows you to notate to me what
needs my attention which I may have missed. Even better would be for me to install an all-around
inbox I can link all accounts to and then you can manage that; I use outlook on my phone for
example, to link all of my emails within."

**Status, 2026-09-23: designed, surveyed once, nothing wired.** The Gmail account was read end to
end through the claude.ai Gmail connector (survey in `private/email/`, never committed). The
connector's scope is **read-only**, so the labels the triage brief needs could not be created.
The triage rules are in `codex/briefs/email-triage.md`. No scheduled task exists yet.

---

## The one fact that decides the design

The Outlook app on the phone shows every account in one list, but it does that **on the phone**:
it signs in to each mailbox separately and merges them on screen. There is no server anywhere
that holds the merged inbox, so there is nothing for an agent to read. A unified inbox for JARVIS
has to be **one real mailbox on a server that the other accounts feed into**. Then one connector
covers everything, and the phone app keeps working exactly as it does now.

## The options

| | A. Gmail as the hub | B. Outlook.com / Microsoft 365 as the hub | C. A local IMAP reader in SkynetOS |
|---|---|---|---|
| What it is | Every other account forwards into the Gmail account (or Gmail fetches them). The existing connector then sees all of it | The other accounts forward into the hotmail/Outlook.com mailbox; an agent reads it through Microsoft Graph | SkynetOS main opens IMAP sessions to each account with app passwords kept in Credential Manager, and exposes them as `mail:*` channels |
| What exists today | **The connector, signed in, read-only.** The survey was done through it | A Microsoft 365 connector is present in this session (`mcp__plugin_sales_microsoft-365__authenticate`) but **unauthenticated**; it was not authenticated during this pass, because that is William's consent to give | Nothing. It is a new dependency (an IMAP library), which docs/07 and the maintenance brief forbid without William |
| Cost to William | About fifteen minutes in each account's settings, once | Consent screens for a Microsoft connector, and forwarding rules in each Google account | App passwords for each account, and trusting SkynetOS with them |
| Fit with the rest | The survey, the labels, the brief and the security rules below were all built against Gmail's tools | Outlook.com Categories map to labels well; Graph is capable. Everything would be rebuilt | Full control, full liability; every message would pass through SkynetOS on disk |
| Verdict | **Recommended** | Second choice, if the hotmail account turns out to be the one with the real correspondence and William would rather not forward it | Not now |

**Recommendation: A.** One thing already works; make the other accounts feed it. The survey found
that the Gmail account currently receives almost no human mail and **no bank or card mail at all**,
so the forwarding step is not optional: without it JARVIS is triaging the wrong inbox.

## Rules

docs/07 for mail. Enforced today only by the brief and by the connector's scope; when a `mail:*`
channel ever exists in SkynetOS, these rows become `AGENT_METHODS` decisions.

| Rule | How it is kept |
|---|---|
| An agent reads, labels and reports. It never sends, replies, forwards, archives, trashes, marks spam, unsubscribes, stars, marks read, or touches drafts | The brief exposes none of these. If a connector scope ever allows them, the brief still forbids them; a `mail:*` channel would list only `list`, `get`, `label`, `unlabel` |
| Every mutation is reversible by removing a label, and every label applied is recorded with its thread id in `private/email/labels-applied-<date>.json` | The brief, §3 |
| At most 40 label applications a run, and only `JARVIS/*` labels | The brief, §7 |
| A one-time code, a password, an account number or a payment card number **never leaves the mailbox**: not into a file, not into a toast, not into the Face's mail, not into a terminal transcript that the Face can read | The brief opens bodies only when a subject cannot decide, with `PLAIN_TEXT`, and forgets them |
| Nothing from mail goes into the public repo except counts and categories. Subjects, senders, names and amounts tied to a person stay under `private/`, which `.gitignore` excludes | The brief, §7; `FACE-BOOT.md` and `codex/mailbox/` are world-readable (docs/07 §Secrets) |
| The Face is told counts only | A `to-face` note carries "1 P0, 11 P1", never what they are |
| William's other accounts are connected by William: forwarding rules, app passwords and connector consents are his to set, and JARVIS never asks a service for access on his behalf | Nothing in this design authenticates anything; the Microsoft connector was left unauthenticated on purpose |
| The connector is read-only until William widens it, and this document says so, so nobody assumes labelling works | Status line at the top |
| A scheduled triage run is subject to every rule for scheduled runs (docs/07): at most six a day, never elevated, a fresh session told to commit and delete nothing | `task.scheduled`, `agent.run`, `packages/shared/schedule.ts` |

## How the digest reaches William

Three doors, all already built, none yet wired to mail:

1. **A toast.** The triage task's own `notify` action (`{"type":"notify","message":"…"}`, live since
   2026-09-23) shows a Windows toast titled with the task. The message is the digest's first
   line and the counts; if there are no P0 or P1 items, no toast.
2. **The notification centre.** Every toast is kept in the HUD's bell, so a digest shown at 07:30
   is still there at noon. Wiring the digest text into the bell needs the main→renderer push that
   the roadmap (M8, "not done") already lists.
3. **A `to-face` mail with counts only**, so the Face can raise it in conversation.

The full digest is a file, `private/email/digest-<date>.md`, which William opens by hand or, later,
from a `file.document` node in a room.

## What William does (option A), one action per step

Do these once. Each is in the sending account's own settings, not in Gmail.

1. Open Outlook.com (the hotmail account) in a browser and sign in.
2. Settings → Mail → **Forwarding**.
3. Tick **Enable forwarding**, enter the Gmail address, tick **Keep a copy of forwarded messages**,
   Save. Outlook.com may send a confirmation to the Gmail address; open it and confirm.
4. Repeat steps 1–3 for every other Outlook or Hotmail address in the phone's account list.
5. For each **other Gmail** account: Settings → See all settings → **Forwarding and POP/IMAP** →
   Add a forwarding address → the main Gmail address → confirm the code Gmail sends → choose
   "Forward a copy of incoming mail" and "keep Gmail's copy in the Inbox" → Save.
6. For any **iCloud** address: iCloud.com → Mail → Settings (gear) → Preferences → General →
   **Forward my email to** → the Gmail address → tick "Delete messages after forwarding" **off**.
7. In the main Gmail, for each forwarded account make one filter so JARVIS and William can tell
   them apart: Settings → Filters → Create → *To:* the forwarding account's address → *Apply the
   label* `From/<account>` (create it) → also **Never send it to Spam**.
8. Re-authorise the Gmail connector with the modify scope: claude.ai → Settings → Connectors →
   Gmail → Disconnect, then Connect again and, on Google's consent screen, tick **Manage labels**
   (and "Manage drafts and send", if offered, is left **unticked**). Until this step, JARVIS can read
   but not label.
9. Tell JARVIS the accounts are connected. The next run of `codex/briefs/email-triage.md` will
   survey the forwarded mail and create the four `JARVIS/*` labels.
10. Only after a week of digests that look right: place the `task.scheduled` node from the brief
    §6 on the root board, 07:30 daily.

Do not forward a work or school account without checking its policy first; many forbid external
forwarding, and some silently drop it.

## Not yet, and honestly

- Whether a session SkynetOS launches (`agent.run`) has the Gmail connector at all. The connector
  belongs to a claude.ai login; every survey so far was run from an interactive session.
- Whether Outlook.com forwarding delivers reliably for this particular account (some consumer
  accounts are throttled). The "Keep a copy" setting keeps the hotmail copy either way.
- The main→renderer push for the notification centre (roadmap M8).
- The first labelled run: blocked on step 8.
- Reading the **past** ten thousand threads for anything missed. The survey sampled ninety days;
  a full pass is a separate, bounded job once labels exist, done in date slices of a month each.
