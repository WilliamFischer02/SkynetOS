---
updated: 2026-10-17
status: ACTIVE — multi-agent studio in daily operation, zero board/codex presence until this pass
owner-node: none yet (no board presence anywhere)
---

# AE Phantom Suite (Goob Entertainment Co.)

**Identity.** A monorepo of paid Adobe After Effects CEP plugins sold on aescripts.com and Gumroad:
AE GRAINR ($19), AE FLAYR ($24), PulseWriter ($22), CaptionFlow ($24 prov.), AuraKit ($19 prov.),
RenderDeck (~$15), VelocityRamp ($27 prov.), AE ProFiler (TBD) — bundle $49 for the three launch
plugins. Repo: `C:/dev/AE-Phantom_Suite` (GitHub org `Goob-Entertainment-Co`, private). Run by a
**Suite Director** agent plus one **plugin-engineer** agent per plugin, fed by a **daily researcher**,
with two scheduled Claude routines (🅰️| AE Daily Research 09:45 Denver, 🅰️| AE Daily Director 10:45
Denver) that already review/merge PRs and dispatch workers without William in the loop.

**Found this pass.** Not in `codex/index.md` or `codex/projects/` before now, and not the kind of gap
prior passes could have caught with a plain `ls` — this is a large, deeply structured repo (its own
`ops/BOARD.md`, `AGENT_ORG.md`, director/infra/researcher roles, 7 Claude Code skills under
`.claude/skills/`) that runs its own internal tracking well enough that it hasn't needed SkynetOS at
all. Found by the sweep for files newer than the 2026-10-16 away-pass journal.

## State (from `ops/BOARD.md`, read 2026-10-17, its own "daily director routine" entry)

**14 PRs reviewed and merged today** across CaptionFlow, AuraKit, FLAYR, GRAINR, PulseWriter and
infra; `main` green; every `.jsx` change passed the `es3-reviewer` subagent. **Agents have run out of
work that doesn't need After Effects** — GRAINR, CaptionFlow, AuraKit, PulseWriter and infra are all
blocked on either an AE run on William's PC (~2h list, A through M, `ops/BOARD.md` has exact
PowerShell commands) or one of 11 owner decisions logged there (pricing, licensing terms, Lite-edition
scope, installer EULA, a name-trademark check).

Phase state: GRAINR and FLAYR both P1→P2 (closest to real progress), PulseWriter P2 and blocked only
on one ID-alignment decision (O-1) before its v1.2 CEP build, CaptionFlow and AuraKit both P1, three
more (RenderDeck, VelocityRamp, AE ProFiler) still P0 drafts. **Nothing in the suite is verified in
After Effects yet** — the AE run list is the single biggest lever William has.

## Blockers — all William's, not agent work

1. **The AE run list itself** (`ops/BOARD.md` "AE run list"): ~2 hours on his own PC, After Effects
   open, in letter order A→M. Unblocks real product progress across every plugin at once.
2. **11 owner decisions** in `ops/BOARD.md` "Owner decisions needed" — each already has the
   director's recommendation written next to it; most are a one-word confirm.
3. **No board or codex presence anywhere** until this pass — same coverage-gap shape as
   BitRunners/StackAssembler/MagicTrainer. **Root is 4/4 phantoms**, unticked since 2026-09-16/25 —
   no capacity this pass for even a bare `store.repo` node.
4. Two items from the owner-tasks list are pre-release physical/account steps, not board work: the
   ZXP signing certificate into the password manager, and the GRAINR compression upload test.

## Next

1. **William: the AE run list.** Highest-leverage single action available on any project right now —
   unblocks five plugins' worth of stalled agent work in one sitting.
2. **William: the 11 BOARD.md decisions**, most answerable with the director's own `Rec:`.
3. **Propose `ph_ae_phantom_suite` on `root`** (store.repo, same shape as BitRunners/MagicTrainer) the
   next pass that finds a root slot open.
4. Once a slot opens, this repo's own `ops/BOARD.md` is the thing worth linking to — it is more
   current and more detailed than anything a codex file would duplicate; treat it as this project's
   board of record and re-read it each pass rather than mirroring its contents here.
