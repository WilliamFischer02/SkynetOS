---
updated: 2026-09-11
status: ACTIVE — README describes a complete feature set; no CLAUDE.md or handoff.md exists, so build/verify state is unknown (inferred gap, not confirmed broken)
purpose: What JARVIS needs to know about LociBook to route sessions and track state.
---

# LociBook

Fabric mod, Minecraft 26.2, Java 25: placeable, writable "loci books" for mind-palace use — set a
book down at any of 16 angles, write a landing cue and up to 32 note pages, read it back in-world.
Repo: `C:/dev/LociBook`. Owner: William (Goob Entertainment Co.), MIT. Already phantom-proposed
into the `deductionos` room (`ph_locibook`, `ph_cc_locibook`) as a natural neighbor to the Mind
Palace room, since the mod is itself a memory-palace tool — not yet approved by William.

## Shape of the repo

- `src/main` — block, block entity, item, data component (tooltip), placement helper, copy recipe,
  config, networking, registration.
- `src/client` — reader/editor screen, settings screen, HUD hints, key mappings, block entity
  renderer (angle-aware body model, page flutter), tint source, two mixins (Q → set down, E → read).
- `src/main/resources/assets/locibook/models/block` — closed/open body models; regenerate with a
  script if body models change.
- Config: `config/locibook.json`, editable in-game via `/locibook` or the ⚙ button.
- Build: `./gradlew build` → `build/libs/locibook-<version>.jar`. Needs Fabric API on client+server.

## Next

1. **No CLAUDE.md or handoff.md in the repo** — there is no record of what's actually built vs. what
   the README describes as the target feature set. First session should confirm `./gradlew build`
   and `./gradlew runClient` succeed, then check off README features against real in-game behavior
   before trusting the README as current-state documentation.
2. If William approves the `ph_locibook`/`ph_cc_locibook` phantoms, this repo gets its first board
   presence — until then it has no board node at all, codex-only visibility.

## Landmines

- None logged yet — no handoff.md exists to carry them forward. Treat this repo as unverified until
  a real session confirms the build.
