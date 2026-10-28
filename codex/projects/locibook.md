---
updated: 2026-10-26
status: ACTIVE — real, versioned build through v0.3.0 per CHANGELOG.md; still no CLAUDE.md or handoff.md, so no session-to-session record exists
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

**Build state — confirmed 2026-10-26.** `CHANGELOG.md` exists (did not on 2026-09-11) and shows
three real shipped versions, newest first: **0.3.0** — free 16-angle rotation matching look
direction with ⟲/⟳ reader buttons (WorldEdit-safe), a three-layer "spine dip" page cascade, a
~0.7s page-flutter animation on open, the book body moved to a block-entity renderer for
any-angle/animated drawing, plus an Axiom Tinker-capability compatibility fix (the book's
`rotation` property is no longer shared with vanilla's) and several UI/tooltip fixes; **0.2.0** —
sneak-click place/read, rebindable keys, on-screen hints, reader toolbar (Rotate/Show/Take),
settings screen + `config/locibook.json`, authorship + lock rule, copy recipe, chiseled-bookshelf
fit, comparator output; **0.1.0** — initial release (three bodies, eight colourways, Q/E,
edit/cover/spine/page rendering). This is a substantially built, actively iterated mod, not an
unverified gap.

## Next

1. **Still no CLAUDE.md or handoff.md in the repo** — there is a real CHANGELOG but no
   session-to-session build record (test results, known issues, what's mid-flight). A first real
   session should write one, following the pattern DollyGrip/MCCamOp use.
2. If William approves the `ph_locibook`/`ph_cc_locibook` phantoms, this repo gets its first board
   presence — until then it has no board node at all, codex-only visibility.

## Landmines

- None logged yet — no handoff.md exists to carry them forward, though the CHANGELOG's own "Notes"
  under 0.3.0 flags one: books placed under 0.2.0 lose their facing (the `rotation` property
  changed) and come back pointing north; the reader's ⟲/⟳ buttons fix it by hand.
