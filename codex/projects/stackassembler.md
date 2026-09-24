---
updated: 2026-09-11
status: ACTIVE — pre-alpha, no playable game yet. NOT previously in the codex index (found during an away-mode survey; JARVIS had no board visibility into this repo before today).
purpose: What JARVIS needs to know about StackAssembler to route sessions and track state.
---

# StackAssembler

Single-player Windows desktop Magic: The Gathering simulator (Tauri 2 + React 18 + TS,
event-sourced pure-TS rules engine, SQLite via Scryfall bulk data). Repo: `C:/dev/StackAssembler`.
Built by a three-agent studio defined in `.claude/agents/` — **rules-logic** (engine + AI tiers
A/B), **data-build** (Scryfall ingestion, card comprehension pipeline, Tauri shell/release), and
**ui-gamefeel** (React app, deck builder, Tier-4 manual fallback UI). Agents coordinate through
`QUEUE.md`, not directly.

## Shape of the repo

- Core architectural rule: `packages/game-engine` is pure TS, zero deps, event-sourced
  (`GameState = fold(GameEvent[])`).
- Four-tier card comprehension pipeline (Structural → Keyword Registry → Pattern Matchers →
  per-card DSL script), with a Tier-4 manual TTS-style fallback so the engine never blocks play on
  an uncomprehended card. `unmatchedSentences` is the live prioritized work queue.
- Distribution is already real: a one-click Windows installer (`get-installer.bat` pulls the
  latest tagged MSI from GitHub Releases), unsigned build (SmartScreen warning expected).

## State as of the last handoff (2026-08-12, data-build)

Phase 0 + Phase 1 merged. data-build shipped SQL-side slot filtering (`packages/card-data/src/roles.ts`,
schema v3, `card_comprehension.roles` column), verified the image cache pipeline and fixed one real
storm vector (failed warms now negative-cached instead of retried every render), and queued
ui-gamefeel with an exact slot→filter adoption map and rules-logic with instructions to swap in the
frozen engine's real `roles.ts` in place of data-build's temporary local shim.

## Next

1. **The Phase 3 game engine** (`packages/game-engine/src/reduce.ts`) is called out in CLAUDE.md as
   "the big un-built piece" — this is the real blocker for anything past the deck builder.
2. **rules-logic** should pick up the roles.ts shim swap data-build queued (2026-08-12 handoff item 1).
3. **ui-gamefeel** should pick up the slot→filter adoption map from the same handoff (land/threat via
   `types`, five effect roles via `roles`, cmc via `cmcRange`, utility stays client-side).
4. Check `QUEUE.md` and `.claude/handoff.md` for anything more recent than 2026-08-12 before routing
   a session — this file is a snapshot, not live state.

## Landmines

- The engine never hard-codes a card name or oracle_id outside `packages/card-scripts/`.
- A hard hold was in force on `src-tauri/**` and `release.yml` as of 2026-08-12 — check whether it
  still applies before touching installer/packaging.
- Agents cannot call each other; coordination is only through `QUEUE.md`.
