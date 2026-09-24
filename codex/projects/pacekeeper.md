---
updated: 2026-09-11
status: ACTIVE — first-session checklist and modern-version audit likely still unrun (inferred: no handoff.md in the repo)
purpose: What JARVIS needs to know about PaceKeeper to route sessions and track state.
---

# PaceKeeper

Fabric mod, Minecraft Java 26.1.x/26.2 **only** (explicitly not 1.16.1 or any legacy version) —
a live speedrun coach: strat guidance + splits, singleplayer, streaming-focused. Repo:
`C:/dev/PaceKeeper`. Owner: William (Goob Entertainment Co.).

## Shape of the repo

- `core/` + `timer/` are pure Java; fix compile errors only in `mc/`
  (`McGameSnapshot.java`, `PaceHud.java`) and the registrations in `PaceKeeperClient.java`.
  `HudRenderCallback` may need swapping to `HudElementRegistry` — expected drift, not a bug.
- The route is data: JSON (`rsg_modern.json`) with a `config/pacekeeper/routes/` override —
  meta/route changes are JSON edits, never recompiles.

## Next

1. **No handoff.md exists** — inferred the first-session checklist (pin `gradle.properties`,
   `./gradlew build`, fix only `mc/`+`PaceKeeperClient.java`, `./gradlew runClient` and verify
   HUD step-advance, ENTER NETHER split + delta announcement, records file, `P` toggle, hot-reload
   override) has not been run to completion on 26.x.
2. **The modern-version audit (CLAUDE.md's checklist)** is the real content work once the mod
   boots: confirm in-game and tune `rsg_modern.json` against current (not legacy 1.16.1) numbers —
   piglin barter pearl rate (`gold_ingots` 40 / `pearls` 12), bastion brute behavior, eye-of-ender
   + stronghold triangulation text, whether bed one-cycle is still the standard dragon kill
   (`beds` 4), blaze rod drop rate (`blaze_rods` 7). Cross-check against current MCSR
   any%/modern-route resources, not legacy docs.

## Landmines

- Do not retarget to 1.16.1 — the whole route and tuning assume modern mechanics.
- 26.1+ is unobfuscated Mojang names (`Minecraft`, `ServerPlayer`, `GuiGraphics`), not Yarn.
