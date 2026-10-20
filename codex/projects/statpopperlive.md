---
updated: 2026-10-17
status: ACTIVE — live and deployed, v0.3.0 shipped 2026-10-17, zero board/codex presence until this pass
owner-node: none yet (no board presence anywhere)
---

# Stat Pop Board (StatPopperLIVE)

**Identity.** A personal, non-commercial second-monitor tool for William, who runs the graphics
computer for Montana PBS broadcasts of Montana State volleyball (basketball/football later). It reads
the public StatBroadcast stats page he already has open in a browser tab and suggests the few stats
worth "popping" on air right now, pre-formatted the way he types them into the graphics system by
hand. Repo: `C:/dev/StatPopperLIVE` (GitHub `WilliamFischer02/StatPopperLIVE`). Live:
https://stat-pop-board.vercel.app. Per [[statpopper-agent-owns-git]]: in this repo the building agent
owns commits/merges/pushes, not JARVIS Prime.

**Found this pass.** Not in `codex/index.md` or `codex/projects/` before now, despite having its own
`CLAUDE.md`, `docs/HANDOFF.md` and `docs/CONTEXT.md` and three real deploys today. Found by the sweep
for files newer than the 2026-10-16 away-pass journal.

**Hard rule worth repeating here** (from its own `CLAUDE.md`): never fetch StatBroadcast from a
server or script — no proxy, scraper, poller, or anything that works around its bot protection.
StatBroadcast's terms only grant personal, non-commercial use through its own web interface; the
whole design (a reader injected into William's own open tab, `postMessage` to the board window, no
network calls of its own) exists to stay inside that line. Any future suggestion that would need
server-side access to StatBroadcast should stop and ask William rather than proceeding.

## State (from `docs/HANDOFF.md`, read 2026-10-17)

**v0.3.0 live** at the URL above, deployed ~3pm MT today, e2e 26/26. Three releases shipped today
alone: v0.2.0 (the Vercel move, paste-a-link flow, impact-player stars), v0.2.1 (one-click Tampermonkey
install), v0.3.0 (Pin button holding a card 10 min; each side always fills 3 player + 2 team cards,
greyed when sub-par, rather than hiding minor stats). Volleyball only; basketball/football are backlog.

**The one real unknown:** the reader has never parsed a real StatBroadcast page — its table/title/
play-by-play parsing is built against StatCrew conventions and a hand-built mock, not a live match.
**The first real game is the calibration run.** William has a home match tonight (Oct 17, Southern
Utah, 7:00 pm MT per the handoff's own note) that would be the first live test.

**Also open, not urgent:** push-to-deploy isn't wired (the Vercel project isn't Git-linked yet — every
deploy so far went through the Vercel API by hand); opponent roster positions are only bundled for
MSU.

## Blockers — William's, not agent work

1. **Watching it survive a real game.** Nothing here is agent work — it needs William at the graphics
   computer with a live StatBroadcast page open, using Reader check → Copy for Claude to report back
   what the real page structure actually looks like.
2. **Connecting the Vercel project's Git integration**, a few clicks in Vercel's own settings — after
   which pushes deploy without the manual API step.
3. **No board or codex presence anywhere** until this pass. Root is 4/4 phantoms, unticked since
   2026-09-16/25 — no capacity this pass.

## Next

1. **William: run it live tonight (or the next home match)** and send back a Reader-check JSON — this
   is the one piece of ground truth the whole parsing layer is still guessing at.
2. **William: connect the Vercel project to the GitHub repo** in Vercel's Git settings.
3. **Propose `ph_statpopperlive` on `root`** (link.url to the live board, or store.repo to the repo —
   director's call at write time) the next pass that finds a root slot open.
4. Basketball support (needs a snapshot contract + reader table mapping) is November-onward, per its
   own backlog — not a near-term board item.
