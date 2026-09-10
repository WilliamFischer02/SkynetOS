# 08 — Agent intake: getting a project into SkynetOS in one drop

**This document is the thing you hand to another agent.** Copy the block marked THE BRIEF into a
conversation with an agent that already knows a project — a mod pack, a repo, a game — and it will
hand back a folder you drop into `codex/` and a board fragment you drop into `board/`. After the
drop, JARVIS Head and Hands both know that project.

Written because the alternative is William typing four paths per node, forty times.

---

## Why this shape

SkynetOS binds every node to something real, so populating a room means knowing, for each thing:
where it lives on disk, what it produces, what it depends on, and one paragraph of what it IS. The
agent that has been working on that project already knows all of it. Nobody else does, and asking
SkynetOS to infer it would mean guessing — which prime directive 1 forbids.

So: ask that agent, in its own project, in a format that drops straight in.

Two artefacts come back, and they are deliberately separate:

- **`codex/projects/<slug>/`** — prose. What each thing is, why it exists, what to watch out for.
  Markdown, read by both halves of JARVIS. This is the half that makes an agent *understand* the
  project rather than just address it.
- **`board/<room>/fragment.json`** — data. Nodes and edges, schema-valid, ready to merge. This is
  the half that makes the board *point at* it.

Merge is a folder merge for the first and `npm run validate:board` for the second. Nothing is
executed, nothing is trusted: every path in the fragment resolves or renders broken on the board,
which is exactly the behaviour you want from data another agent wrote.

---

## THE BRIEF

> Copy everything between the rules, into a conversation with an agent that has the project open.
> Fill in the two bracketed values first.

---

You are being asked to produce an intake package for **SkynetOS**, a program that renders a
project as an overhead pixel-art motherboard where every component is bound to a real path on
disk. I will drop your output straight into it, so shape matters more than prose quality.

**Project root:** `[ABSOLUTE PATH, e.g. C:/dev/TheStalker]`
**Room slug:** `[LOWERCASE, e.g. thestalker]`

Produce exactly two things. Do not explain them to me; just produce them.

### 1. `codex/projects/<slug>/` — a folder of markdown

```
codex/projects/<slug>/
  index.md          the project in 200 words: what it is, who it is for, what state it is in
  layout.md         the directory tree, annotated — what lives where and why
  build.md          how it is built and run, exact commands, and what the outputs are called
  dependencies.md   what it depends on, internal and external, and which versions matter
  landmines.md      everything that has bitten you. Be specific and unkind.
  components/       one file per thing that deserves a node (see below)
```

Every file in `components/` is named `<node-id>.md` and starts with this frontmatter:

```markdown
---
id: s1_repo_stalker          # lowercase, digits and underscore only
kind: store.repo             # see the kind list below
name: THE STALKER            # max 40 chars, goes on silkscreen
path: C:/dev/TheStalker      # or cwd / glob / url, per kind — see below
---

One paragraph on what this thing is. Then anything an agent working on it should know: what it
talks to, what breaks it, what it produces.
```

### 2. `board/<slug>/fragment.json`

```json
{
  "nodes": [ /* one object per components/ file */ ],
  "edges": [ /* one object per real relationship */ ]
}
```

### Node kinds, and the field each one MUST carry

| kind | required field | use it for |
|---|---|---|
| `store.repo` | `path` | a git repository |
| `store.folder` | `path` | any folder that matters |
| `file.artifact` | `glob` | a build output. **Always a glob**, never a filename — the next build renames it |
| `file.document` | `path` | one document |
| `file.exe` | `path` | a launchable binary |
| `link.url` | `url` | a bookmark: docs, a mod page, an issue tracker |
| `service.process` | `startCommand` + `cwd` | a long-running local process |
| `agent.code` | `cwd` | a Claude Code session that should live in this project |
| `group.zone` | `members` | a bracket printed around a cluster of related nodes |
| `note.silk` | `text` | a heading printed on the board |

Optional on any node: `designator` (U4, J2, D7 — leave it out and SkynetOS assigns one), `tags`,
`notes`, `codexRef` (path to that thing's file in `codex/`, e.g. `codex/projects/<slug>/components/s1_repo_stalker.md`).

**Do not include** `pos` or `footprint`. Placement is SkynetOS's job and it will find room.

### Edge kinds

`produces`, `reads`, `depends`, `deploys`, `syncs`, `supervises`. Shape:

```json
{ "id": "e_repo_to_jar", "from": "s1_repo_stalker", "to": "a1_jar_stalker", "kind": "produces" }
```

Only include an edge for a relationship that is REAL. A guess here becomes a copper trace on a
board that claims something untrue.

### The rules that matter

1. **Every path must be one that exists right now**, absolute, with forward slashes. If you are not
   certain a path exists, say so in the component's markdown and leave the field out entirely. A
   missing field renders as an honest unbound node; a wrong path renders as a broken one and costs
   me time to find.
2. **Artifacts are globs.** `C:/dev/TheStalker/build/libs/*.jar`, plus `exclude` for the ones you
   do not mean (`*-sources.jar`, `*-dev.jar`).
3. **No secrets.** No tokens, keys or passwords, in either artefact. The board is git-tracked.
4. **No shell.** Except `startCommand` on a `service.process`, which is the one field that is
   allowed to be a command.
5. **Ids are stable.** They are how I refer to a node forever. `<prefix>_<thing>`, lowercase:
   `u` agents, `s` storage, `a` artifacts, `d` drives, `j` links, `g` zones, `n` notes.
6. **Cluster with zones.** If the project has natural groupings — mod families, phases, subsystems —
   emit a `group.zone` per grouping with its `members` listed. This is how the board stays readable
   past about fifteen nodes, and it is the thing I most often have to add by hand afterwards.
7. **Write `landmines.md` properly.** It is the most valuable file in the package. Every wasted
   afternoon you can name, name it.

Output the folder as a series of fenced blocks, each preceded by its path on one line, then the
`fragment.json` last. No commentary between them.

---

## What William does with the output

1. Save the markdown blocks under `codex/projects/<slug>/`, keeping the paths as given. Merging a
   folder over an existing one is safe: files are per-component, so a re-run updates what changed
   and adds what is new.
2. Save `fragment.json` anywhere, then merge it into the room's board with the node wizard or by
   hand.
3. `npm run validate:board`. It will reject anything malformed with the exact JSON pointer.
4. Open SkynetOS. Anything whose path did not resolve renders as broken hardware with the path
   printed on it — fix those, and the room is populated.

The Hands can do steps 1–3 for you: leave the agent's output in `codex/mailbox/to-hands/` and ask
for it to be merged. That is what the mailbox is for.

---

## A note on trust

An intake package is data written by an agent that SkynetOS has never met, describing paths on this
machine. It is treated accordingly:

- The fragment goes through the same JSON Schema and the same command bus as anything else. There
  is no import path that skips validation.
- Board JSON carries no executable strings — see `docs/07-SECURITY.md`. `startCommand` is the sole
  exception and it only runs when you press a button.
- Every path is resolved at render time. A path that does not exist is drawn broken, with the path
  on it. Nothing is opened, run or trusted because a file said so.

That is why the brief can be handed to any agent without much thought: the worst a bad package can
do is produce a room full of visibly broken nodes.
