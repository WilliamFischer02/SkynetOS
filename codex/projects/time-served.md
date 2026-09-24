---
updated: 2026-09-19
status: ACTIVE — v1.1.0 released 2026-09-13. index.md called it RUNNING IN PROD; that is unverified here (inferred from the changelog and the Goobtropolis config default). Written by an away-mode pass; the repo had a real README/CHANGELOG but no codex entry.
purpose: What JARVIS needs to know about TimeServed to route sessions and track state.
---

# TimeServed

Fabric mod, Minecraft Java 26.2 (Loader 0.19.5+, Fabric API 0.160.0+26.2, Java 25+), modid
`timeserved`. Repo: `C:/dev/TimeServed` (own `.git`). Owner: William (Goob Entertainment Co.), mod by
@bingusthewizard69.

## What it does

Server-side stats HUD: Minecraft days played, live connected time, deaths. Clients with the jar get
two bevelled boxes on the right screen edge; clients without it get a private scoreboard sidebar.
Data in `world/data/timeserved.json`; server config `config/timeserved.json`, client config
`config/timeserved-client.json`. Commands: `/timeserved`, `/playtime`, `top`, `hud on|off`,
`preview`, `reload` (ops). Default `serverName` is `Goobtropolis`, so it is aimed at that SMP.

## State

- v1.0.0 2026-09-08 (HUD, sidebar fallback, persistence, commands).
- v1.1.0 2026-09-13 (Mod Menu settings screen, client position/margin/padding options,
  hide-with-F3, reset button). Mod Menu is compile-only and optional.
- No `CLAUDE.md` and no `.claude/handoff.md` were found. The changelog and README are the only state
  documents. Working-tree state (uncommitted or not) was not checked: git was unavailable this pass.

## Next (inferred; no handoff names one)

1. **Add a `CLAUDE.md` or `handoff.md`** so a session here knows the non-negotiables, as the Stalker
   and Giants repos have. Small.
2. **Confirm what v1.1.0 has run against in-game**, client HUD with and without Mod Menu, and on the
   real Goobtropolis server. Nothing on disk says it has.
3. The board's minecraftos room has no TimeServed to Client-mods trace on purpose: it deploys to
   Goobtropolis only (handoff.md, 2026-09-15 grid note).

## Landmines

- Daily visual stack on William's client is Iris + Complementary Reimagined, with Distant Horizons
  and Sodium (see `mccamop.md`). The HUD draws in screen space, so test it with that stack.
- Days come from vanilla `play_time` ticks by default; `daysFromVanillaTicks: false` changes the
  meaning of every stored figure going forward. Do not flip it casually on a live world.
