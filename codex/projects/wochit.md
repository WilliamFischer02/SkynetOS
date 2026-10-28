---
updated: 2026-10-26
status: ACTIVE — confirmed this pass: a real, substantially coded monorepo (host ~29 TS modules, web ~35 components), not just a scaffold; CLAUDE.md and docs/DECISIONS.md both exist and read as current
owner-node: none yet (no board presence anywhere; root is 4/4, no open phantom slot)
---

# WochIt

**Identity.** A watch-together app for William and his girlfriend to use from her iPhone: a
JIT HLS host agent, a VLC master clock, Tailscale for transport, and a host console plus a Desktop
launcher. Repo: `C:/dev/WochIt`, a pnpm monorepo with `host/`, `shared/`, `web/`, and a root
`package.json` (React 19 + Vite + Express + ws + hls.js on the client/host side).

**Confirmed this pass (2026-10-26), superseding the 2026-10-20 "inferred" note.** `README.md`,
`CLAUDE.md`, and `docs/DECISIONS.md` all exist and were read directly. The architecture matches
standing memory exactly and is real, not aspirational: VLC's HTTP interface read as master clock
(`host/src/vlc/bridge.ts`), just-in-time HLS with virtual playlists and NVENC transcoding
(`host/src/media/{ffmpeg,transcoder,ladder,cache,playlist}.ts`), a WebSocket room that is
server-authoritative (`host/src/room/room.ts`, `host/src/server/ws.ts`), Tailscale `serve`
publishing over Funnel (`host/src/net/tailscale.ts`), a GIF proxy for Klipy/GIPHY so no key
reaches the browser, and a full web client (chat/emoji/GIF lightbox, reactions overlay, quality
menu, subtitles menu, a host-only library browser + readiness/guests panels + QR share card,
connect/invite pages). `README.md`'s own "Status: under construction" line is generic design-doc
language, not a true read of how little exists — the `host/` and `web/` trees back essentially
every feature the README lists. `CLAUDE.md`'s hard rules (no secrets in git, guests never see
file paths, protocol changes go through `shared/src/protocol.ts` first, VLC as master clock,
agents don't commit) are the ones to follow in this repo.

**No phantom proposed.** `root` is 4/4 (same four phantoms unticked since 2026-09-16/25) — no
capacity, though this project's state is now solid enough to recommend a specific node once a
slot opens.

## Next
1. `root`'s 4/4 ceiling is the only thing blocking WochIt's first board presence now that its
   state is confirmed — same standing flag as BitRunners/StackAssembler/Story Universe
   Map/AboveThem. Worth proposing a `store.repo` phantom the next pass that finds root capacity,
   or folding it into the GoobOS/LifeOS room question already open for those four.
2. Whether it's feature-complete or what's left to build is still not confirmed from this pass
   alone (no handoff.md found, and `docs/DECISIONS.md` was only read in part) — a session should
   read `docs/DECISIONS.md` in full and run `pnpm typecheck && pnpm test` to pin down real state
   before board placement.
