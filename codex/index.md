---
updated: 2026-09-11
purpose: The ONLY codex file loaded into JARVIS's standing context. A map, not content. Keep under 150 lines.
---

# Codex index

Read the file, don't guess from the line. Each line: path — one-sentence identity — STATUS — current blocker.

## Meta
- `persona.md` — who JARVIS is and how it behaves.
- `personas/jarvis-voice.md` — how JARVIS sounds and what he knows. Read with persona.md.
- `personas/voice-blend.md` — a 50/50 blend of the voice William asked for and the one JARVIS would
  choose, dial by dial. PROPOSED 2026-09-11; not in force until William adopts it.
- `personas/obsidian.md` — the Obsidian knowledge profile: vaults, properties, tags, links,
  Dataview/Templater, Canvas/Bases, plugin development, William's vaults. Inlined into every
  Obsidian-aware session's briefing (OBSIDIUS, and any node tagged `obsidian` or inside a vault).
- `JARVIS-SETUP.md` — how JARVIS is launched, which surface is which, and what the two bodies can
  and cannot each do. Read once; it is setup, not standing context.
- `board-map.md` — auto-generated room/node inventory. Regenerate with `board_read`. NOT WRITTEN YET.
- `face-brief.md` — the Face's standing orders. Face-owned, written by SkynetOS from `standing:`
  mail, never hand-edited. See `mailbox/README.md`. NOT WRITTEN YET.
- `../FACE-BOOT.md` — generated at the repo root for the Face: this index, its mail, board faults,
  Hands state. Never hand-edited.
- `../prime/README.md` — JARVIS Prime's own workspace: toolbox, playbooks, learning notes, tools
  (`board:overlap`, `board:snapshot`), a log. Method, not project facts. WRITTEN 2026-09-23.
- `briefs/` — the briefs scheduled runs hand to a fresh session: `morning-maintenance.md`,
  `email-triage.md` and `finance-review.md` (both 2026-09-23).

> **Most of the project files below still do not exist.** As of 2026-09-11, `codex/projects/`
> has fourteen real files (`time-served.md` added 2026-09-19): `dirty-plush.md`, `truthquest-retro.md`, `the-stalker.md`, `pacekeeper.md`,
> `bitrunners.md`, `mccamop.md`, `stackassembler.md`, `just1nudge.md`, `story-universe-map.md`,
> `wfp-site-ops.md`, `there-could-be-giants.md` (Phases 1–7b built, Phase 8 live-modlist gate next),
> `locibook.md` (README-only repo, no CLAUDE.md/handoff.md found — build state unverified), plus
> `skynetos.md` — added 2026-09-12: this line has pointed at it since before that date, but the
> file itself never existed until an away-mode pass wrote it. Every other line in this index is
> still a promise about a file that isn't there — JARVIS will cite it as though it read something.
> Write the next one or two you are actually working on, and delete the rest of these lines until
> they are real. Template and instructions: `JARVIS-SETUP.md` § Step 1.

## Projects — MinecraftOS
- `projects/the-stalker.md` — Fabric 26.2 adaptive hunter mod, Challenge #1. ACTIVE.
- `projects/pacekeeper.md` — Speedrun coach: live strat guidance + splits, modern versions only. ACTIVE.
- `projects/there-could-be-giants.md` — Kaiju-scale giants, ships to the Goobtropolis server. ACTIVE, Phase 8 (live-modlist gate) next.
- `projects/time-served.md` — Server-side stats HUD (days/time/deaths), modid timeserved. ACTIVE, v1.1.0 (2026-09-13). WRITTEN 2026-09-19; no CLAUDE.md/handoff.md in the repo.
- `projects/goobtropolis.md` — Bloom.host Fabric 26.2 SMP for 2-4 friends. ACTIVE.
- `projects/locibook.md` — Placeable writable mind-palace books, Fabric 26.2. ACTIVE, build state unverified (no CLAUDE.md/handoff.md).
- `projects/just1nudge.md` — Off-grid block/item nudging via display entities. ACTIVE, v0.2.0.
- `projects/mccamop.md` — Client-side cinematic camera hotkey mod. ACTIVE, v1 shipped.

## Projects — GoobOS (non-Minecraft Goob Entertainment Co. projects)
- `projects/bitrunners.md` — ASCII multiplayer web MMO, live prod deploys. ACTIVE, PR unmerged since 2026-07-12.
- `projects/stackassembler.md` — Single-player MTG desktop simulator, three-agent studio. ACTIVE, pre-alpha.
- `projects/wfp-site-ops.md` — Webflow site ops for goobscott-productions.com. ACTIVE.
- `projects/story-universe-map.md` — Obsidian plugin: fictional-universe relationship map. ACTIVE.

## Projects — GameOS
- `projects/truthquest-retro.md` — 3D terraced-hill platformer, custom C++ engine, Steam target. ACTIVE.
- `projects/forge-editor.md` — William-only level/asset editor. Biggest focus of TQR.
- `projects/handheld.md` — 5 self-built units, ESP32-S3 route. PAUSED — platform fork undecided.

## Projects — StoryOS
- `projects/something-in-the-woods.md` — First-person present-tense horror-thriller, Leavenworth WA.
- `projects/dirty-plush.md` — 8-chapter literary mystery + 8-episode limited series, Ray Vega, 1994.
  ACTIVE. WRITTEN 2026-09-11: the repo, the HUD, the vault layout, and the `research/` library with
  the rules for adding to it.

## Projects — DeductionOS
- `projects/deduction-training.md` — 16-week evidence-based observation curriculum + Anki deck v2.

## Projects — SkynetOS itself
- `projects/skynetos.md` — This program. See the repo's docs/ for the spec; this file tracks state only.

## Decisions
- `decisions/` — one file per decision, append-only, newest filename wins on conflict.

## Journal & handoffs
- `journal/YYYY-MM.md` — nightly five-line summaries.
- `handoffs/<project>.md` — current state per agent, overwritten each session.
