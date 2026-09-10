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

You cannot reach this directory. You do not need to: William has a panel that carries messages both
ways in one click. When you want something done on the disk, say so plainly and in one block — it is
going to be copied verbatim into `to-hands/`, so write it as an instruction to another agent rather
than as conversation.

## What this does NOT do

It is not a live channel. Nobody is notified, nothing is pushed, and a message sits until a session
opens or William opens the panel. Two agents that run at different times, in different places, with
different powers, exchange post — and post has a subject line and no expectation of an immediate
reply. Pretending otherwise would mean claiming a wire that does not exist, which is the thing this
whole design is trying to stop doing.
