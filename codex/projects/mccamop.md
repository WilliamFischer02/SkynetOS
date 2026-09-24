---
updated: 2026-09-11
status: ACTIVE — v1 shipped, v2.1 design-only. NOT previously in the codex index (found during an away-mode survey; JARVIS had no board visibility into this repo before today).
purpose: What JARVIS needs to know about MCCamOp to route sessions and track state.
---

# MCCamOp

Fabric mod, Minecraft Java 26.2, client-side only cinematic camera operator: ten hotkey-bound
eased camera shots (5 surface, 5 player) with HUD hide. Repo: `C:/dev/MCCamOp`. Owner: William
(Goob Entertainment Co.), mod by @bingusthewizard69. `SPEC.md` is authoritative; read before any task.

## Shape of the repo

- Non-negotiables (SPEC §1): client-side only, never moves the player entity, no fabricated
  APIs (26.1+ ships Mojang names natively — no Yarn, no remap step), Fabric API events preferred
  over Mixins, `abort()` must be idempotent and total.
- **No `.claude/handoff.md` exists** — session state isn't tracked between sessions the way the
  other Minecraft mods are; `docs/ROADMAP.md` is the only durable state document.

## Next

1. **v2.1 — path-aware framing** (`docs/ROADMAP.md`): the real fix for orbit/dolly shots that
   clip through overhangs or pass through terrain. v1's `avoidTerrain` is a reactive single-ray
   per-frame correction that SPEC 3.5 explicitly scoped as "cheap approximation only, real fix
   later." v2.1 solves the whole path once at activation, adjusting shot parameters (not nudging
   the camera per frame) so the shot is clean from frame one instead of rescued mid-flight.
2. Given there's no handoff.md, a first session here should establish one and confirm what of v1
   has actually been verified in-game (the default modifier is `Ctrl`, which the SPEC itself flags
   as colliding with vanilla sprint — `Alt` is called out as the better choice, unconfirmed whether
   that's been switched).

## Landmines

- `Ctrl` as the shot modifier collides with vanilla sprint (`Ctrl+O` while walking toggles sprint
  on the way past) — known, not yet fixed per the README.
- Daily visual stack is Iris + Complementary Reimagined; anything touching rendering needs testing
  with that active. Distant Horizons + Sodium also run — both read the camera.
- Moonrise is a known-bad suggestion for this stack (crashes with Distant Horizons at "Preparing
  level").
