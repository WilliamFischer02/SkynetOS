---
updated: 2026-09-09
status: active
purpose: How to bring JARVIS up, and what to paste where. Read this once, then follow it.
---

# Starting JARVIS

## The decision you have to make first

You asked for one agent that can **rewrite SkynetOS's code**, **operate the program**, look like a
**chat, not a terminal**, take **file and image uploads**, and give you a **link to embed**.

No single Claude surface does all five today. Here is what each one actually is, verified against
this machine (`claude 2.1.267`) rather than assumed:

| | claude.ai **Project** | `claude --cloud` | **Agent SDK** in-app | Claude Code CLI |
|---|---|---|---|---|
| Chat UI, not a terminal | yes | yes | yes (we build it) | no |
| File / image upload | yes | yes | yes | paths only |
| Gives a URL to embed | **yes** | **yes** (`claude.ai/code/...`) | n/a — it lives in-process | no |
| Can rewrite SkynetOS's code | no | yes, in a cloud clone → PR | **yes, locally** | **yes, locally** |
| Can operate *this machine* (board files, launch agents) | no | no | **yes** | **yes** |
| Billing | your Claude subscription | your Claude subscription | **API key, billed separately** | your Claude subscription |

Two facts do most of the work here:

1. **The Agent SDK needs an API key.** Its docs say plainly: *"Unless previously approved,
   Anthropic does not allow third party developers to offer claude.ai login or rate limits for
   their products, including agents built on the Claude Agent SDK. Use the API key authentication
   methods instead."* So an in-app JARVIS would bill to an API account, **not** your Max/Pro
   subscription. That is a real running cost, and it is the reason it is not the default here.
2. **A cloud session cannot touch this machine.** `claude --cloud` gets you a genuine
   `claude.ai/code` URL and a chat UI, and it can genuinely rewrite the program — but it works on
   a cloud clone of the repo. It cannot read `board/root.board.json` on your disk, cannot launch a
   session, and cannot see whether `C:/dev/TheStalker` exists.

## What to do — the two-body setup

This is `docs/04-JARVIS.md`'s design, and **half of it already exists**: M3 shipped real Claude
Code sessions, so the Hands are a chip you click.

- **The Face** — a claude.ai Project. Where you think with JARVIS. Chat UI, uploads, a URL you
  embed in the `u1_jarvis` node. Costs nothing beyond your subscription.
- **The Hands** — an `agent.code` chip on the root board pointed at `C:/dev/SkynetOS`. Full local
  power: reads the board, edits the code, runs `npm run verify`. Also your subscription.

They are one identity because both read `codex/` and both follow `codex/persona.md`. The Face
decides; the Hands do. When the Face needs something real done, it writes you a block to hand to
the Hands — or, once `skynet-mcp` lands at M7, the Hands do it directly.

**Upgrade path:** if you later want one seamless chat that can also touch the disk, that is the
Agent SDK panel, and it is an M7 decision — with an API bill attached. Nothing below is wasted if
you take it: the codex, the persona and the board wiring are identical.

---

## Step 1 — Fill in the codex (do this first, it is the context)

`codex/index.md` is the only file JARVIS loads every session. It currently names **14 project
files that do not exist yet** — `codex/projects/` holds nothing but a `.gitkeep`. A JARVIS that
reads the index and finds nothing behind it is a JARVIS with an impressive-looking empty head.

Create one file per active project. Keep each under ~40 lines. The template:

```md
---
updated: 2026-09-09
status: active          # active | paused | done
owner-node: U1          # the board designator, so JARVIS can point at it
---

# The Stalker

One paragraph: what it is, who it is for, what "done" looks like.

## State
Where it actually is right now. Be blunt about what is broken.

## Decisions that still bind
- Fabric 26.2, not Forge — <why>
- <the next one>

## Open threads
- The thing you will pick up next.

## Paths
- repo: C:/dev/TheStalker
- artifact: C:/dev/TheStalker/build/libs/*.jar
```

You do not have to write all 14 now. Write the three you are actually working on and delete the
index lines for the rest — **an index line with no file behind it is worse than no line**, because
JARVIS will cite it at you as though it read something.

## Step 2 — Create the Project (the Face)

1. Go to **claude.ai** → **Projects** → **Create project**.
2. Name it exactly: `JARVIS — SkynetOS`
3. **Project instructions**: paste the entire contents of `codex/persona.md`, then append the
   block from *Step 3* below. Project instructions load on every conversation in the project —
   this is what "always launches with sufficient context" means for the Face.
4. **Project knowledge** — add these files. This is the part people skip and then wonder why the
   agent is vague:
   - `codex/index.md`
   - every `codex/projects/*.md` you wrote in Step 1
   - `board/root.board.json` and each `board/*/room.board.json`
   - `docs/01-ARCHITECTURE.md` … `docs/07-SECURITY.md`
   - `docs/DECISIONS.md` and `handoff.md`
   - `CLAUDE.md`
5. Start a conversation with the opening message in `STARTUP_PROMPT.md` § 2.
6. **Copy that conversation's URL from the address bar.** It looks like
   `https://claude.ai/chat/<uuid>` (a specific conversation) or `https://claude.ai/project/<uuid>`
   (the project). **Prefer the project URL** — a conversation fills up and gets replaced; the
   project outlives it.

## Step 3 — The bootstrap block (append to Project instructions)

```
STANDING CONTEXT
Load codex/index.md at the start of every conversation. Nothing else loads automatically —
ask William for a file, or ask the Hands to fetch it. Never ask him to paste the whole codex.

YOUR TWO BODIES
You are the Face: the conversation. The Hands are headless Claude Code runs on William's machine,
launched from the U2/U3 chips on the SkynetOS root board. You think; they act. You cannot read
his disk. When you need something real done — a file read, a board edit, a command run — write a
HANDS block: the exact prompt to paste into a Hands session, self-contained, assuming no memory
of this conversation.

WHAT YOU CANNOT DO, AND MUST NOT PRETEND TO
- You cannot see C:/dev. If you need a file, ask for it or write a HANDS block.
- You cannot run commands or verify a build.
- Never claim something is built, tested, or working that you have not been shown. "I wrote it,
  I have not run it" is always an acceptable sentence.

SESSION RITUAL
End every session — even a two-message one, even if William forgets to ask — with:
  CODEX PATCH  — the durable facts learned, as file path + exact content to write
  HANDOFF      — current state, the single next action, and the landmines
```

## Step 4 — Wire the link into the board

Open SkynetOS, select the **U1 JARVIS** chip, press **F2**, and paste the URL into
**Conversation URL**. Save. The node stops rendering as broken hardware the moment the URL is a
real one — that red stipple you see on U1 today is the placeholder `REPLACE_WITH_JARVIS_PROJECT_ID`
being correctly reported as unresolved.

Or edit `board/root.board.json` directly and set `u1_jarvis.url`. Either way it is one line, and
the app will re-read it when you press `R`.

> The embedded webview that renders that URL inside SkynetOS is **M7**. Until then the node opens
> the conversation in your browser, which is the same conversation — nothing is lost by starting
> now, and the codex you build is the whole point.

## Step 5 — Launch the Hands

The root board has a **U3 JARVIS-HANDS** chip pointed at `C:/dev/SkynetOS`. Click it. A Windows
Terminal tab opens running Claude Code in this repo, on **its own conversation**, and every later
click resumes that same conversation rather than starting a fresh one.

Its `initialPrompt` (sent once, on the first launch only) is in the node and reads:

```
You are the Hands of JARVIS for SkynetOS. Read CLAUDE.md, then codex/persona.md, then
codex/index.md before anything else. You act on William's machine: you read and write files, run
commands, and edit board JSON. The Face — the claude.ai conversation on the U1 chip — thinks and
plans but cannot see this disk; you are how its decisions become real. Follow docs/07-SECURITY.md
as a hard boundary: never delete files, force-push, or remove a board node without explicit
approval in that exact exchange. End every session with a CODEX PATCH and a HANDOFF block.
```

If you would rather it live in a different repo, change the chip's **Working directory** in the
same F2 form.

---

## Which link do I actually paste?

- **A `claude.ai/project/<uuid>` URL** — recommended. Survives conversation compaction.
- A `claude.ai/chat/<uuid>` URL — pins one specific conversation. Use it only if you want JARVIS
  to always land in the same thread, and accept that you will re-point it when that thread fills.
- A `claude.ai/code/<uuid>` URL from `claude --cloud` — valid too, and that agent *can* change the
  code via PRs. It still cannot see this machine. If you want this as well as the Face, add it as
  a second `agent.chat` node rather than replacing U1.

## If you want the in-app chat panel instead

Say so and I will build it at M7. What it takes, honestly:

- `npm i @anthropic-ai/claude-agent-sdk` (currently `0.3.267`) running in SkynetOS's **main**
  process, with a React chat panel in the renderer talking to it over the existing typed IPC.
- An `ANTHROPIC_API_KEY` in Windows Credential Manager. **This bills separately from your Claude
  subscription** — that is the trade, and it is the whole reason this is not the default.
- Roughly: uploads become content blocks, the SDK's session id replaces the one the command bus
  already tracks, and `skynet-mcp` gives it the board tools it needs to restructure rooms.

It is the better end state. It is not the cheaper one.
