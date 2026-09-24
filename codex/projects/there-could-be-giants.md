---
updated: 2026-09-11
status: ACTIVE — Phases 1–5c, 6, 7b built; Phase 8 (live-modlist test + 30-min playtest with William) is the next real gate
purpose: What JARVIS needs to know about There Could Be Giants to route sessions and track state.
---

# There Could Be Giants

Standalone Fabric mod, Minecraft Java 26.2.x, singleplayer/streaming-focused: kaiju-scale Warden
and Iron Golem giants with steering-based movement, footfall craters/shake, a mind-control helmet,
pickup/throw/shoulder-ride, and a spawn director. Repo: `C:/dev/ThereCouldBeGiants`. Owner: William
(Goob Entertainment Co.). Design contract: `DESIGN.md` (read first — §4 steering, §3.1 Stride Clock
are non-negotiable).

## Shape of the repo

- `core/` is pure Java (StrideClock, brains, `GiantIn`) — no Minecraft imports. Version drift fixes
  only go in `mc/`.
- All tunables live in `giants.json`/`rules.json` with `config/therecouldbegiants/` overrides —
  balance passes are JSON edits, never recompiles.
- Multiplayer verify loop: `./gradlew runServer` (own `run-server/`) then `./gradlew runClientJoin`
  (own `run-join/`, quick-plays into localhost).

## State per CLAUDE.md (2026-09-07 latest dated entry)

Built and gated: Phase 0 (toolchain), Phase 1 (Warden Giant), most of Phase 3 (senses/behavior —
marked in-progress but several sub-items checked), Phase 5b (presence/destruction pass), Phase 5c
(boulder throw + multiplayer). Built, awaiting William's gate: Phase 6 (pickup/throw/shoulder ride)
and Phase 7b (silhouettes). Phase 2 (Stride Clock walk+footfall) and Phase 4 (Iron Golem + kaiju)
are listed unchecked in the file despite later phases building on them — likely done implicitly
since 5b/5c/6 depend on golem+footfall systems; **inferred, not confirmed** — verify by reading the
checkboxes again next session rather than trusting this note.

## Next

1. **Phase 8 — the real gate.** Test against William's live modlist (Sodium, Iris+Euphoria,
   EntityCulling, Distant Horizons, ImmediatelyFast, Lithium) with giants exempted from
   EntityCulling so silhouettes still render at range. Then a 30-minute balance playtest with
   William, tuning JSONs live, plus a shake-intensity note in the README for stream/viewer comfort.
2. Confirm Phase 2 and Phase 4 checkboxes are actually done (see note above) before treating Phase 8
   as the only remaining gate — don't assume from later phases' success.
3. v2 backlog (DESIGN §7) stays untouched until Phase 8 is gated — "do NOT start unprompted."

## Landmines

- Never vanilla ground pathfinding — steering only (DESIGN §4).
- StrideClock owns both animation and footfall events; never read vanilla walk-anim to detect steps.
- Warden inheritance is decided: `GiantEntity extends PathfinderMob` with zero goals, reusing
  `WardenModel`/texture, scale via vanilla `Attributes.SCALE`. Don't relitigate.
- Trample base must use `ceil(getY())`, not `floor` — floor carves endless staircases.
- Director's spawn band is clamped to `min(view distance, simulation distance)` — never spawn
  outside what the server actually ticks (hard-won 2026-09-02 bug: silent zero-spawns after the
  opener).
