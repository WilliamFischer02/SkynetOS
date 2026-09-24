---
updated: 2026-09-23
status: active
purpose: JARVIS Prime's own workspace. Tools, playbooks, learning notes and a log, kept so each session starts further along than the last.
---

# prime/ — JARVIS Prime's workspace

William, 2026-09-23: "this is your space, your play pen … a place for you to gather tools, resources,
data, learning / coding materials, and anything that can make you operationally more effective,
intelligent, and prepared to face the types of tasks I may typically give you."

This folder is that. It is mine to keep, and it is held to the same rules as the rest of the repo.

## Rules

- **The repo is public.** Nothing about William's accounts, money, mail or people goes here. That
  goes under `private/` (gitignored) or nowhere. `prime/scratch/` is gitignored for working files.
- **Every claim in here was true when written**, and says when. A playbook that no longer matches
  the code is edited, not left. Dates on everything.
- **Tools live in `prime/tools/`** and are typechecked by `npm run verify` (tsconfig includes
  them). A tool that has no test is at least run once before it is described.
- **No new dependencies.** Node, the repo's own packages, and what `packages/shared` exports.
- **The codex is JARVIS's knowledge of William's projects; this folder is Prime's knowledge of
  how to work.** A fact about a project goes in `codex/projects/`. A method goes here.

## Layout

| Path | What it is |
|---|---|
| `toolbox.md` | Every tool I can reach from a session: MCP servers, npm scripts, connectors, and where the important files live. Read this before searching. |
| `playbooks/` | Step lists for the jobs that recur: starting a session, editing a board on disk, reporting and stopping, running parallel forks, an unattended run. |
| `learning/` | What I have learned about this repo and its stack, as notes I can act on: patterns, landmines, and a reading list of the external docs that matter. |
| `tools/` | Scripts of my own: board overlap check, board snapshot. Run through npm (`board:overlap`, `board:snapshot`). |
| `log.md` | Append-only. One short entry per session: what worked, what did not, what to keep. |
| `scratch/` | Gitignored. Working files that die with the session. |

## How a session uses it

1. Session start: the board briefing reads `CLAUDE.md`, the persona, the codex index, docs/07 and
   `handoff.md`. Then read `prime/toolbox.md` and skim `prime/log.md`'s last three entries.
2. Before a recurring job, open its playbook and follow it rather than re-deriving it.
3. At the end, one entry in `log.md`. If a playbook was wrong, fix the playbook in the same session.

## What to add next

- A `playbooks/finance-review.md` once the FinanceOS room and `npm run finance:report` are in use.
- A `playbooks/email-triage.md` once the Gmail hub decision is made (docs/10-EMAIL.md).
- `learning/electron-notes.md`: Notification, single-instance, `app.isPackaged`, AUMID, the things
  found by doing.
- A test for `prime/tools/board-overlap.ts` against a board fixture with a known overlap.
