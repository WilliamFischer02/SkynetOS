---
updated: 2026-10-03
status: ACTIVE. The index has cited this file since before 2026-09-12; it never existed until this
  away-mode pass wrote it. Written from the only on-disk evidence found — there is no local repo for
  the server itself, only its config export — so most of this is inferred and marked as such.
purpose: What JARVIS needs to know about the Goobtropolis SMP to route the mods and tools that target it.
---

# Goobtropolis

A Bloom.host-hosted Fabric 26.2 Minecraft SMP for William and 2-4 friends (Goob Entertainment Co.).
Unlike every other MinecraftOS entry, there is no local repo for the server itself — it is a hosted
instance, not code William builds here. The only on-disk trace is its exported server config at
`C:/dev/goobtropolis-configs` (folder mtime 2026-09-21).

## What's on disk

`C:/dev/goobtropolis-configs/config/`:
- `afkplus.json` — AFK handling.
- `chunky/config.json` — Chunky, a chunk pregenerator.
- `doubledoors.json5` — synced double-door opening.
- `ledger.toml` — Ledger, an economy/anti-grief transaction logger.
- `styled-chat.json` — chat formatting.
- `universal-graves/config.json` — death-location grave markers.

Inferred: this is a config *export* from the live server (for backup or reference), not a buildable
project — there's no `.git`, no mod jars, no server jar alongside it.

## What targets this server

Several separate repos build mods aimed at Goobtropolis specifically, each tracked in its own codex
file:
- `projects/there-could-be-giants.md` — kaiju-scale giants mod; ships to this server. ACTIVE, Phase 8 next.
- `projects/time-served.md` — server-side stats HUD; its default `serverName` config value is
  literally `"Goobtropolis"`. Deliberately not wired to Client mods on the board grid for this reason
  (2026-09-15 grid note).
- `goobtab` (`C:/dev/goobtab`, plus a `goobtab_26.2.zip` archive alongside it in `C:/dev`) — a
  four-file datapack, tab-list playtime tracker. Too small for its own project file (noted
  2026-10-01 in `docs/06-ROADMAP.md`); it's a utility of this server, not an independent build.

## Next (inferred; nothing on disk names a plan for the server itself)

1. **No handoff or CLAUDE.md exists for the server configuration itself** — unlike the mods that
   target it, there's nothing here to say whether `goobtropolis-configs` is current or stale against
   the live Bloom.host instance. If William wants this tracked as code (not just an export), it
   needs its own repo with a README saying what it's for and how to redeploy it.
2. Confirm whether `goobtab_26.2.zip` is the same build as `C:/dev/goobtab` or a separate version —
   not checked this pass.
3. Everything else here is downstream: see the "What targets this server" repos' own Next sections.

## Landmines

- Don't confuse this file with a buildable project: there is no code to run `npm run verify` or
  `./gradlew build` against here. Edits to `config/` on disk do not change the live server unless
  someone pushes them through Bloom.host's panel — a step nothing here automates.
