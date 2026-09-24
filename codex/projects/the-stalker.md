---
updated: 2026-09-11
status: ACTIVE — first-session checklist likely still unrun (inferred: no handoff.md in the repo)
purpose: What JARVIS needs to know about The Stalker to route sessions and track state.
---

# The Stalker

Fabric mod, Minecraft Java 26.1.x/26.2, singleplayer, streaming-focused. An adaptive hunter
entity that tiers up on player deaths — except the design's hardest rail is that **player deaths
must never tier it up** (`DESIGN.md` §5). Repo: `C:/dev/TheStalker`. Owner: William (Goob
Entertainment Co.).

## Shape of the repo

- `core/` is pure Java (brain, ledger, tiers, state, persistence) — version-drift-proof.
- `mc/` + the two client/server entrypoints are where Minecraft-version drift actually bites;
  every likely spot is flagged `ADAPTER-NOTE` (entity builder signatures, sun-burn override
  names, `hurt` vs `hurtServer`, `HudRenderCallback` → `HudElementRegistry`, spawn-reason enum).
  See CLAUDE.md's hotspot list before touching either.
- Balance is data (`rules.json`/`tiers.json` + `config/thestalker/` overrides) — never recompiled.
- **Hard rule:** client entrypoints are registration-only; no GPU resource creation
  (`DynamicTexture`/`NativeImage`) in `onInitializeClient` — the render device isn't up yet in
  26.x and it crashes.

## Next

1. **No handoff.md exists** — inferred that the first-session checklist in CLAUDE.md (pin
   `gradle.properties` from fabricmc.net/develop, `gradle wrapper`, `./gradlew build`, fix only
   in `mc/`+entrypoints, then the full in-game verification list: spawn distance, HUD states,
   detection/loss range, chase+combat, death→evolution→`IT LEARNED`, tier persistence via
   `thestalker_state.json`, difficulty toggling) has not been run to completion on 26.x. That
   checklist IS the next session's plan until a handoff says otherwise.
2. Once verified once, a 30+ minute live balance pass with William tuning `rules.json`.
3. **v2 backlog, explicitly do-not-start-unprompted:** skin + eye glow, heartbeat proximity
   audio, `/stalker history`, taunt lines, Nether behavior.

## Landmines

- Never tier up on player death — this is the mod's one non-negotiable balancing rail.
- 26.1+ is unobfuscated Mojang names, not Yarn — easy to reach for the wrong name from muscle memory.
