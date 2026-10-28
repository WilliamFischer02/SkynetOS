---
updated: 2026-10-26
status: ACTIVE — M0 confirmed done 2026-10-20; M1 (viewport detaches to the rig) not yet confirmed
owner-node: ph_dollygrip phantom proposed on minecraftos 2026-10-20, still unticked
---

# DollyGrip (Goob Entertainment Co.)

**Identity.** A client-only Fabric mod for Minecraft Java 26.2: an offline production camera. You
place a visible rig in the world, pilot it with creative-flight controls, drop keyframes, generate
moves (orbit/truck/dolly/dolly-zoom/crane/flyover), preview live, then export a frame-locked PNG
sequence with shaders on. Builds a per-world shot list. Repo: `C:/dev/DollyGrip`. Author credit in
both `fabric.mod.json` and the README: "a Goob Entertainment Co. Mod™ — a Mod by @bingusthewizard69".

**Found this pass.** Not in `codex/index.md` or `codex/projects/` before now — a real, fully speced
repo (`SPEC.md`, `CLAUDE.md`, a `docs/` folder, a Gradle build with a passing JUnit test for
`ShotEvaluator`, a built jar under `build/libs/dollygrip-0.1.0+mc26.2.jar`) with zero prior board or
codex presence. Same coverage-gap pattern the roadmap has hit five times before (MagicTrainer,
goobtropolis-configs, AE-Phantom_Suite, StatPopperLIVE).

**Relationship to MCCamOp.** DollyGrip is explicitly the sibling of `C:/dev/MCCamOp` (same author,
same camera-detach technique on 26.2, different job): MCCamOp is live hotkey shots during play,
DollyGrip is offline shot authoring/export. `CLAUDE.md` instructs the building agent to read
MCCamOp's mixin code for the proven camera-detach/third-person/HUD-hide technique and adapt it,
without creating a code dependency between the two repos.

**Design decisions already locked (SPEC.md §0):** no second viewport/live world recording — that job
belongs to the existing mod Flashback; DollyGrip only does PREVIEW (realtime) and EXPORT
(frame-stepped, one normal render per frame so Iris/Complementary apply untouched); the rig is a
client-side visual, never a real `Entity`, so the mod works on servers it isn't installed on.

**Build state — confirmed 2026-10-26.** The 2026-10-20 note below found `docs/DECISIONS.md`,
`docs/TESTING.md` and `docs/VERIFIED_API.md` missing; all three now exist. `docs/TESTING.md`
records an agent run on 2026-10-20 passing M0's first 5 of 6 manual checks (build green,
`ShotEvaluatorTest` passes, client reaches the title screen with Sodium+Iris+Complementary
loaded, DollyGrip's load log line present, Iris confirms the shaderpack loaded); step 6 (Mod Menu
entry by eye) is explicitly left for a human. **M0 is done. M1 (viewport detaches to the rig) is
not yet confirmed** — `docs/DECISIONS.md` D2–D4 are M0-session findings about 26.2 API surfaces
(`CameraMixin` target, `LevelRenderEvents` not `WorldRenderEvents`, the Ctrl+F8 modifier check)
that explicitly "apply from M1," i.e. groundwork for the next milestone, not evidence it's built.

## Next
1. A Hands-level session should start M1 per `SPEC.md §12` and `CLAUDE.md`'s gate ("do not start
   M2 until M1 is demonstrated: viewport detaches to the rig, Complementary loaded"), using the
   `CameraMixin`/`LevelRenderEvents` targets `docs/DECISIONS.md` D2/D3 already verified. Sized M
   (one new mixin + the rig's basic render path).
2. `ph_dollygrip` is still an unticked phantom on `minecraftos` (proposed 2026-10-20) — once M1
   lands, consider promoting it to the full cluster MCCamOp has (agent.code + store.repo +
   file.artifact).
