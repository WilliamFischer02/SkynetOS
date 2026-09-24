---
updated: 2026-09-11
status: ACTIVE — v0.2.0 built, most in-game behavior still unverified. NOT previously in the codex index (found during an away-mode survey; JARVIS had no board visibility into this repo before today).
purpose: What JARVIS needs to know about Just1Nudge to route sessions and track state.
---

# Just1Nudge

Fabric mod, Minecraft Java 26.2: nudge blocks/items off-grid (rotate, slide, lay flat) via display
entities, so it saves with the world and shows for vanilla-client friends without the mod. Repo:
`C:/dev/Just1Nudge`. Owner: William (Goob Entertainment Co.), mod by @bingusthewizard69, MIT.

## Shape of the repo

- Built 0.2.0 (2026-09-04). Server-authoritative: `NudgeService` does all server logic, state is
  a Fabric data attachment (`just1nudge:state`) rebuilt from quarter-pixel/quarter-degree
  bookkeeping on every edit so nothing accumulates float error.
- No `.claude/handoff.md` — CLAUDE.md itself carries the "Repo state" section as the live summary.
- Compatibility is a first-class requirement: must render/nudge identically across a long list of
  decoration mods (Macaw's, Rechiseled, Blockus, etc.) and survive Iris + Complementary
  Reimagined/Unbound shaders without lighting artifacts. `COMPAT.md` tracks per-mod results.

## Next

CLAUDE.md's own "Known unknowns — verify in-game first, in this order" list is the actual next
session's plan (8 items): gizmo box/arrows actually drawing, item lay-flat orientation on all
faces, HUD compact layout at low GUI scale, scroll-wheel capture behavior, snap-back rotation
correctness on stairs/chairs, interpolation smoothness with shaders on, selection surviving a
chunk unload/reload, and that clicks on displays route through `NudgePick` correctly (hover, select,
snap, delete, barrier show/hide, `BLOCK_SHRINK` anti-flicker). Only item 1 (gizmos, via RCON) has
been confirmed loading; the rest are unconfirmed since the 0.1.0 in-game report that preceded 0.2.0.

## Landmines

- MC 26.2 is unobfuscated Mojang names — there is no Yarn. Easy to reach for the wrong name from
  muscle memory on older mod source.
- Display setters (`setTransformation`/`setBlockState`/etc.) are private in 26.2 — accessed via
  invoker mixins, not directly.
- `withSourcesJar()` is deliberately absent — a `-sources.jar` in `mods/` crashes Fabric with a
  misleading mixin error.
- Owner's mods folder is `C:/Users/wills/AppData/Roaming/.minecraft/mods` — copy the ONE jar,
  delete older just1nudge jars first.
