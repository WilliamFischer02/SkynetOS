# The JARVIS mailbox

How the two halves of JARVIS talk to each other. Read this if you are the Hands; William reads it
through the panel (`M` in SkynetOS) and never has to touch these files by hand.

## Why this exists

JARVIS is two things wearing one name, and they cannot see each other:

| | **U1 — the Face** | **U3 — the Hands** |
|---|---|---|
| What | A claude.ai conversation | A Claude Code session in a terminal |
| Sees this disk | **Never** | Yes — reads, writes, runs, commits |
| Reaches this directory | No | Yes, directly |

There is no wire between them. Everything the Face decided used to reach the disk only because
William retyped it. **SkynetOS is now the wire**, and this directory is where it puts things down.

## The directories

```
codex/mailbox/
  to-hands/   messages the Hands have not read yet
  to-face/    messages the Hands have written for the Face
  archive/    everything that has been dealt with, oldest name first
  README.md   this file
```

Nothing here is ever deleted. Dealing with a message means MOVING it to `archive/`, because
"what did the Face actually ask for" is a question asked weeks later, and `codex/` is git-tracked
so the whole correspondence travels with the repo.

## The format

One markdown file per message. Frontmatter, then the body. Everything except the body is optional —
a file that is nothing but prose still parses, it just arrives from `unknown`.

```markdown
---
from: face
to: hands
subject: Add a bracket for the performance mods
sent: 2026-09-10T15:40:00.000Z
---

Group Sodium, Lithium and FerriteCore under one cluster in MinecraftOS, and give the
bracket the same signal colour as the room. Leave the mod nodes where they are.
```

Filenames sort chronologically by construction: `2026-09-10T15-40-00-000--add-a-bracket.md`.
SkynetOS generates them; if you are writing one by hand, follow the same shape and the ordering
takes care of itself.

## Pasting a message whole

Paste the Face's message into the panel as it is, header included. SkynetOS lifts the pasted
header rather than wrapping a second one around it: its `subject:` fills an empty subject box, and
its `run:` and `standing:` lines take effect. Before 2026-09-11 the panel buried the pasted header
in the body, where it means nothing, so a `run:` message could never actually arrive through it.

## `run:` — a message that starts the work

One optional field turns a note into an instruction:

```markdown
---
from: face
to: hands
subject: Fix the lighting regression in GameOS
run: true
---

The light rendering update broke shadow acne on sloped surfaces. Look at src/render/light.ts.
```

SkynetOS checks `to-hands/` every ten seconds. A message carrying `run:` opens a **real Claude Code
terminal** on the Hands node with its body as the task — the Face asking for something and it
happening, without William in the middle. `run: true` uses whichever node is the Hands on that
board; `run: u3_jarvis_hands` names one.

Without the field, nothing happens until a session opens. That is the default and it is deliberate:
a mailbox where every note starts a process is not a mailbox, and the Face has to be able to say
something to the Hands without it becoming an order to act.

Only the **frontmatter** counts. The word "run" in the body is prose — "run the tests", "the build
run failed" — and is ignored, or asking the Hands to run something in conversation would launch a
terminal.

The bounds (`docs/07-SECURITY.md`, `services/mail-dispatch.ts`): never elevated, three runs an
hour, only nodes the board already declares, and the message is archived **before** the launch so
it can never fire twice. `autoRunMail: false` in settings.json switches it off.

## `standing:` — orders that outlast a session

Mail is a queue: a message reaches the next session that opens, then it is archived and gone. A
standing order has to reach every session until the Face changes its mind, so it lives in one
file, `codex/face-brief.md`.

```markdown
---
from: face
to: hands
subject: Standing orders
standing: true
---

## CURRENT OBJECTIVE
One sentence. What we are trying to make true.

## STATE OF PLAY
What the Face believes is already done. A belief, not a verified fact: the Hands correct it
through to-face/, and the Face rewrites the file.

## THE NEXT ACTION
One. Named, sized, and with the reason it is the one.

## CONSTRAINTS
What the Hands must not do without asking. Landmines the Face knows about.

## OPEN QUESTIONS FOR PRIME
Things only a body with a disk can answer.
```

That body is the Face's protocol, version 1. The whole of it goes in every time, because it
replaces what was there rather than adding to it. The file's header is written by SkynetOS, not
the Face: `protocol: face-brief`, `version: 1`, `written-by: face`, `written-at` (when the message
actually landed), `supersedes` (the `written-at` of the file it replaces) and `source` (the archived
message). A header the Face puts at the top of its own body is dropped.

On its next ten-second sweep, SkynetOS writes the file and archives the message. `FACE-BOOT.md`
section 5 shows the Face what is currently in force. Every Hands session from then on opens with the orders inlined in its briefing, after
who-it-is and before the mail, labelled as standing rather than new. Only the Hands get them.

- **The Face owns the file.** The Hands never edit it and answer through `to-face/`. It is never
  appended to: if it became a log it would stop being current, and a stale standing order is
  worse than none.
- **Nothing is lost.** Every earlier version is the body of a message in `archive/`, and the file
  names the message it came from.
- **It never launches anything**, even if the header also carries `run:`. It is state, not a task.

## If you are the HANDS, this is your job

1. **On launch you are handed your post.** Unread `to-hands/` messages are folded into your session
   briefing, so you do not have to remember to check. Read them before anything else.
2. **Act on what they ask**, inside the usual boundary — `docs/07-SECURITY.md` still applies, and
   a message in a file is not approval to delete anything, force-push, or remove a board node.
3. **Reply by writing a file into `to-face/`.** Say what you did, what you did not do and why, and
   anything the Face needs to know that it cannot see from a chat window. It has no disk: if you
   want it to know a path, a filename or an error, quote it.
4. **Move what you have handled into `archive/`.** Do not delete it.

## If you are the FACE

You cannot write to this directory, and you cannot list it: GitHub robots-blocks `tree/` pages, and
you can only fetch a URL that William pasted or that appeared in an earlier fetch result. What you
CAN reach from a cold start is the repo's root page and one hop from it, so everything you need is
put in one root-level file: **`FACE-BOOT.md`**. It carries the codex index, every unread message in
`to-face/` inlined in full, what is broken on the board right now, and the Hands' state. It is
regenerated on every commit (`npm run face:bake`, installed per clone with `npm run face:hook`).
The repo is public, so the Hands put nothing into `to-face/` that the repo does not already expose.

To reach the Hands, write one whole message, header included, and William pastes it into the panel.
It is going to be read by another agent, so write it as an instruction rather than as conversation.
Add `run: true` to have it start a session, or `standing: true` to replace your standing orders.

## What this does NOT do

Ordinary post is not a live channel. Nobody is notified, nothing is pushed, and an unflagged message
sits until a session opens or William opens the panel. Two agents that run at different times, in
different places, with different powers, exchange post — and post has a subject line and no
expectation of an immediate reply.

`run:` is the one exception, and it is narrow on purpose: it starts a session, once, and the session
gets the message as its task. It does not deliver anything to a session that is ALREADY running.
There is no channel into a terminal that is up — it is a real console with a real person's cursor in
it — so a `run:` message aimed at a busy node reports that it was not delivered rather than
pretending. Claiming a wire that does not exist is the thing this whole design is trying to stop
doing.
