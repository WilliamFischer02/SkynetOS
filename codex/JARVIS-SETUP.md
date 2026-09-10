# JARVIS: what it is, and how you actually talk to it

Written for William. Read the first section; the rest is reference.

---

## The short version

You do not have one JARVIS. You have two things wearing the same name, and they cannot talk to
each other. That is the whole confusion, and it is my fault — I designed it that way and did not
say plainly what it costs you.

| | **U1 — the Face** | **U3 — the Hands** |
|---|---|---|
| What it is | A claude.ai conversation | A Claude Code session in a terminal |
| Lives | In a window SkynetOS opens | In `C:/dev/SkynetOS` |
| Can it see your disk? | **No. Never.** | Yes — reads, writes, runs, commits |
| Can it change SkynetOS? | No | Yes, that is its job |
| Images / file uploads | Yes, drag them in | Yes — drag a file onto the terminal, or Ctrl+V a screenshot |
| Chat-app look | Yes | No, it is a terminal |
| Remembers between launches | Yes | Yes — the chip resumes its own conversation |

There is no wire between them. Anything the Face decides reaches your disk only if **you** carry
it to the Hands. That is the copy-paste you said you do not want, and you are right not to want it.

## So: talk to the Hands

**The Hands are a conversation.** That is the part that has not landed. A Claude Code session is
not a build script you fire and watch — it is exactly what you have been doing with me all
project. You type in English, it answers, you argue with it, it edits files and shows you diffs.
It reads `CLAUDE.md`, then `codex/persona.md`, then `codex/index.md` on launch, so it wakes up
knowing who it is and what SkynetOS is.

It takes images too. Drag a PNG onto the terminal window and the path lands in your prompt; a
screenshot on the clipboard pastes with Ctrl+V. The only thing you genuinely lose versus the Face
is that it looks like a terminal instead of a messaging app.

**Do this now:**

1. Click **U3 JARVIS-HANDS** on the board.
2. First time: **New session (fresh context)**. Every time after: **Resume conversation**.
3. A terminal opens in `C:/dev/SkynetOS`, already told who it is.
4. Talk to it. Ask it to change the program. It will ask permission before doing anything real.

That is JARVIS working "from within". No link to embed, no key to buy, no copy-paste.

## Then what is the Face for?

Keep it for the things a terminal is bad at, and stop expecting it to act:

- Long creative conversation where you are thinking out loud, not building.
- Looking at reference images, screenshots, PDFs together.
- Continuing the same conversation on your phone, away from the PC.

It now opens in its own window with its own title and its own taskbar entry — not a tab shoved
into your Firefox. Its `partition` (`persist:jarvis`) keeps it logged in and keeps its cookies
out of everything else.

If you want the Face to *do* something, tell the Hands. One sentence — "the Face wants X" — is
not the copy-paste treadmill; pasting a whole plan back and forth is.

## What would actually remove the split later

Both of these are real work, listed so the option is on the table rather than implied.

**`skynet-mcp` (M7).** An MCP server exposing SkynetOS operations, so an agent can drive the
board through tools instead of prose. It does **not** solve the Face problem: a claude.ai
conversation in a browser can only reach MCP servers published over HTTPS, and putting a server
that edits your disk on the public internet is a bad trade. What it does solve is the Hands
becoming much better at operating SkynetOS itself.

**An in-app chat panel (Agent SDK).** One surface that both chats like the Face and acts like the
Hands, living inside SkynetOS. This is the thing you originally pictured. The blocker is money,
not code: the Claude Agent SDK requires an Anthropic **API key** billed per token. Anthropic does
not permit third-party apps to sign in with a claude.ai subscription. Your Claude Code subscription
does not cover it.

**Recommendation:** use the Hands now. Revisit the in-app panel after M5 if the terminal still
bothers you, and decide then whether an API key is worth it.

---

## Reference

### The U1 node

```
kind        agent.jarvis
url         the claude.ai conversation to open
partition   persist:jarvis    (its own cookie jar; keeps you logged in)
persona     C:/dev/SkynetOS/codex/personas/persona.md
```

Clicking it opens or focuses its window. One node, one window, always.

### The U3 node

```
kind           agent.code
cwd            C:/dev/SkynetOS
launch         popout
resume         true
initialPrompt  who it is and what to read first
```

`resume: true` is why the chip reopens *its own* conversation rather than a new one. SkynetOS
assigns the conversation id (`--session-id` on the first launch, `--resume <id>` after), so it
never has to scrape it out of anything.

**The initial prompt is only sent on a conversation that does not exist yet.** Editing it later
does nothing to a session that has already started — use **New session (fresh context)** to make
a changed prompt take effect.

### Giving the Hands more context on launch

Everything the Hands reads at startup is a file you can edit:

- `CLAUDE.md` — the build contract. Read on every launch, automatically.
- `codex/persona.md` — who JARVIS is.
- `codex/index.md` — what exists and where.
- `handoff.md` — what the last session did, what is mid-flight, what will bite you.

Add to those rather than lengthening `initialPrompt`. Files are versioned, reviewable, and shared
by every session; a prompt is a one-shot that only the next fresh conversation ever sees.

### Handing a session over to the Hands

When one Claude Code session ends and you want another to pick up:

1. Ask the session you are in to update `handoff.md`.
2. Click **U3 JARVIS-HANDS**.
3. The new session reads `CLAUDE.md` → `codex/persona.md` → `codex/index.md` → `handoff.md`.

The new session has **none** of the previous conversation's memory. `handoff.md` is the whole
bridge, which is why `CLAUDE.md` requires rewriting it at the end of every session.

### Security, unchanged

The Face's window has **no preload and no bridge** — it cannot call a single SkynetOS API. It is
a browser tab in a nicer frame, which is what `docs/07-SECURITY.md` requires.

The Hands run as you, non-elevated, and ask Claude Code's own permission prompts before acting.
Nobody but you ever approves one of those.
