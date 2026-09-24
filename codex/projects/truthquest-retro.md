---
updated: 2026-09-11
status: ACTIVE
purpose: What JARVIS needs to know about TruthQuestRetro to route sessions and track state. State only; see the repo's own docs/roadmap.md and docs/TODO-NEXT.md for the authoritative detail.
---

# TruthQuestRetro (TQR)

3D terraced-hill fantasy action platformer, custom C++20 engine + the "Forge" editor
(creator-only, never ships). Windows/Steam first, futureproofed for iOS/iPadOS/macOS. Owner:
William. Repo: `C:/dev/TruthQuestRetro`, standalone CLAUDE.md governs sessions there.

## How sessions work in this repo

- **Session start:** read `docs/roadmap.md` for the current milestone, verify launch effort
  matches the milestone's tag (STANDARD = fable-5 @ max, HEAVY = fable-5 @ ultracode — wrong
  effort means stop and relaunch), then read `docs/TODO-NEXT.md` for carry-over state.
- **Session end:** commit+push small (never >15 min uncommitted), update
  `docs/SESSION-LOG.md` and `docs/TODO-NEXT.md`.
- Host is fragile (past bugchecks) — headless `ctest` is the default verification; interactive
  `player.exe` runs are William-witnessed only, announced before launch. This is why so much
  shipped work below is still "not yet seen on screen" (E7 run).
- CI green is per-push definition-of-done; a red run halts milestone work. GPU-needing tests
  carry the `gpu` ctest label and are excluded from CI (no display on the runners).

## State as of 2026-09-08 (from docs/TODO-NEXT.md, ten "waves" in one long session)

Shipped and pushed, CI green, but **most of it is still William's E7 run** (never rasterized on
his machine): held-item distance, damage numbers, tabbed settings, Forge viewport handles +
orbit/pan/dolly, lights & shadows with day/night dimming, Forge panel docking + camera bookmarks,
multi-select + transform gizmo in Forge, a full synthesized-placeholder audio pass, gold +
economy, rings (3 slots via skill tree, 3 tiers), shops, a Pacing Report tool, charms (8 sim
abilities), shadow maps, Dress & Fill procedural set-dressing, a non-blocking web/wasm CI job
(green on first run, not yet promoted to blocking), attack-clip + projectile models, save slots,
LOD/imposters/atlasing, and a cinematics file format (ADR-0029) with a headless `scene_smoke`
test that already caught one shipped bug before it reached William.

**In flight as of 2026-09-08 evening** ("proceed with development"), four parallel worktree
agents: (a) enemy breadth + a boss archetype, (b) chapter 1's first two levels, (c) chapter
grouping in the shell/UI, (d) director sequences (waiting on the M9.3 scene player).

## Next

1. **William's E7 run is the real blocker** — nothing above is confirmed working on his machine
   yet. Until he runs the build and reports back, don't assume any of the ten waves' features
   actually render correctly (the M10.7-B skinned/instanced pipeline note is explicit about
   this: compiles for all 5 shader profiles, never rasterized).
2. **M9.3 Cinematics runtime** is next in roadmap order and is HEAVY effort (`setup.ps1 -Heavy`):
   the scene player, letterbox/input suppression/skip, `playCinematic`, played-once progress,
   F5 reload — building on the already-merged FORMAT half (ADR-0029).
3. **M9.8-B** (STANDARD): emissive materials + def-driven particle system + a night-dimmed sun,
   finishing the M9.8 box.
4. **The attribute-guard test** (docs/TODO-NEXT.md "QUEUED WAVES" item 7) is flagged worth doing
   early — it's a small, CPU-only ctest that would have caught the M10.7-B1 pipeline crash that
   cost a full day, and CI currently has no way to see that class of bug at all.
5. Outstanding blockers needing William directly: the font licence (blocks a shippable pak),
   asset drops per `docs/asset-manifest.md`, and a veto/approval on the Resonance rule
   (ring+charm same-type ×1.5, currently default-in).

## Landmines

- `player/` must never compile `forge/` sources (enforced in CMake) — the editor never ships.
- Golden-hash tests must hash quantized/integer data, never raw floats (diverges MSVC/GCC).
- Two 0x10E bugchecks and one CLI death already happened this project — that's why interactive
  runs are witnessed-only and commits are small and pushed constantly.
