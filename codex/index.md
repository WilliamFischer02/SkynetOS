---
updated: 2026-09-09
purpose: The ONLY codex file loaded into JARVIS's standing context. A map, not content. Keep under 150 lines.
---

# Codex index

Read the file, don't guess from the line. Each line: path — one-sentence identity — STATUS — current blocker.

## Meta
- `persona.md` — who JARVIS is and how it behaves.
- `personas/jarvis-voice.md` — how JARVIS sounds and what he knows. Read with persona.md.
- `JARVIS-SETUP.md` — how JARVIS is launched, which surface is which, and what the two bodies can
  and cannot each do. Read once; it is setup, not standing context.
- `board-map.md` — auto-generated room/node inventory. Regenerate with `board_read`. NOT WRITTEN YET.

> **The project files below do not exist yet.** `codex/projects/` is empty. Every line in this
> index is a promise about a file, and an index line with no file behind it is worse than no line
> — JARVIS will cite it as though it read something. Write the two or three projects you are
> actually working on, and delete the rest of these lines until they are real.
> Template and instructions: `JARVIS-SETUP.md` § Step 1.

## Projects — MinecraftOS
- `projects/the-stalker.md` — Fabric 26.2 adaptive hunter mod, Challenge #1. ACTIVE.
- `projects/pacekeeper.md` — Speedrun coach: live strat guidance + splits, modern versions only. ACTIVE.
- `projects/there-could-be-giants.md` — Kaiju-scale giants, ships to the Goobtropolis server. ACTIVE.
- `projects/time-served.md` — Server-side stats HUD (days/time/deaths), modid timeserved. RUNNING IN PROD.
- `projects/goobtropolis.md` — Bloom.host Fabric 26.2 SMP for 2-4 friends. ACTIVE.
- `projects/LociBook.md` — Bloom.host Fabric 26.2 SMP for 2-4 friends. ACTIVE.

## Projects — GameOS
- `projects/truthquest-retro.md` — 3D terraced-hill platformer, custom C++ engine, Steam target. ACTIVE.
- `projects/forge-editor.md` — William-only level/asset editor. Biggest focus of TQR.
- `projects/handheld.md` — 5 self-built units, ESP32-S3 route. PAUSED — platform fork undecided.

## Projects — StoryOS
- `projects/something-in-the-woods.md` — First-person present-tense horror-thriller, Leavenworth WA.
- `projects/dirty-plush.md` — 8-chapter literary mystery + 8-episode limited series, Ray Vega, 1994.

## Projects — DeductionOS
- `projects/deduction-training.md` — 16-week evidence-based observation curriculum + Anki deck v2.

## Projects — SkynetOS itself
- `projects/skynetos.md` — This program. See the repo's docs/ for the spec; this file tracks state only.

## Decisions
- `decisions/` — one file per decision, append-only, newest filename wins on conflict.

## Journal & handoffs
- `journal/YYYY-MM.md` — nightly five-line summaries.
- `handoffs/<project>.md` — current state per agent, overwritten each session.
