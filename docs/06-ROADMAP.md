# 06 — Roadmap

Each milestone ends with something you can actually open and use. No milestone is "infrastructure only." Build them in order.

---

## M0 — Skeleton (½ day)
Electron + Vite + React + TS, `contextIsolation` on, typed IPC bridge, Pixi canvas mounted with nearest-neighbour and integer zoom, `npm run verify` wired (tsc + vitest + both validators), electron-builder NSIS config.

**Exit:** a window opens showing a tiled solder-mask substrate at 3x zoom, WASD pans it, nothing shimmers.

## M1 — Board data → pixels (2 days)
JSON Schema, board loader/validator, `BoardGraph`, static rendering of `store.repo`, `store.folder`, `note.silk`, and hand-routed traces. Selection, inspector panel, breadcrumb.

**Exit:** `board/root.board.json` renders as a recognizable board. Clicking a repo node opens that folder in Explorer. A malformed board file shows a clear error, not a blank screen.

## M2 — Rooms + auto-routing + procedural substrate (2 days) — **DONE 2026-09-09**
`drive.room` nodes, iris transition, nested boards, back navigation, minimap. Orthogonal trace auto-router. Seeded procedural substrate per room.

**Exit:** click MinecraftOS, descend, see four mod clusters, press Esc, come back. Traces route themselves when a node moves.

**Met.** Evidence from `npm run smoke`, which drives the built app with real key events:

```
descend: "SKYNETOS" -> "SKYNETOS/MINECRAFTOS"   changed=true
room HUD: 27 NODES / 15 TRACES / ROUTED 15
ascend:  back to "SKYNETOS"                     returned=true
[router] 7 auto-routed, 0 fell back      <- root
[router] 15 auto-routed, 0 fell back     <- inside MinecraftOS
[router] 7 auto-routed, 0 fell back      <- back at root
node drag moved 1 node(s): u1_jarvis 28,17 -> 32,19
[router] 7 auto-routed, 0 fell back      <- re-routed BECAUSE the node moved
```

All four mod clusters render as silkscreen zones. Zero traces fell back to the direct run on any
of the five boards. `test/router.test.ts` additionally proves, on the real board data, that no
routed trace cuts through a component it does not terminate at.

Done in this milestone: room descent and return with a navigation stack, the 8-step iris wipe,
per-room theming of the board *and* the DOM chrome, the A* auto-router with a turn penalty, and
the minimap with a live viewport box and click-to-jump.

Deliberately not done, and not blocking: **trace bundling** with a ribbon clamp (docs/01), and the
**palette-swap shader** (docs/02 Theme keys) — the shader has nothing to swap until an atlas
exists, so it belongs with M5's art rather than here. Room themes currently reach the board by
recolouring at build time, which is correct for geometry and placeholders.

## M3 — Agent nodes and real sessions (3 days)
`agent.code`, SessionManager with all four launch modes, session id capture + `--resume`, session dock, `service.process`, embedded xterm tab.

**Exit:** clicking the `CC-STALKER` chip opens Windows Terminal in `C:/dev/TheStalker` with Claude Code resumed on that project's prior conversation. Closing and reclicking resumes the same session.

## M4 — Files, artifacts, drag-out (2 days)
`file.document`, `file.exe`, `file.artifact` with glob resolution, chokidar watchers, `webContents.startDrag`, staleness detection, drop-in ingestion from Explorer.

**Exit:** the Stalker artifact cartridge shows `thestalker-0.4.2.jar · 11m ago`, and you can drag it from SkynetOS straight into your mods folder. The novel node opens the manuscript in Word.

## M5 — Life: telemetry, heat, animation, characters (3 days)
TelemetryBus, heat model, glow steps, packet sprites, the four agent states, occupant characters, activity feed, alerts + buzzer, PSU monitor.

**Exit:** run an agent for ten minutes; its chip warms to ~38°C SIM, its traces glow one step brighter, packets flow to the artifact when the jar rebuilds, and the room cools down over the next quarter hour.

## M6 — Edit Board mode (3 days)
Palette drawer, placement with snap + collision, node wizard with target verification, trace drawing, undo/redo, JSON diff preview, snapshots, templates, first-run repo scan, health check.

**Exit:** you add a fifth mod cluster — agent + repo + artifact + traces + CurseForge link — in under a minute, without touching a text editor, and the resulting git diff is clean and readable.

## M7 — JARVIS (4 days)
`skynet-mcp` server with the full tool surface, Codex scaffolding + FTS index, embedded claude.ai WebContentsView on `persist:jarvis`, headless Hands runner, board-diff approval flow, agent-edit policy per room.

**Exit:** you tell JARVIS "add a node for the TimeServed jar and wire it to its agent" and a reviewable diff appears; you accept; the board updates. `codex_search` returns real hits from your project files.

## M8 — Supervision + scheduling (2 days)
`task.scheduled` nodes, the supervision loop with its hard limits, nightly journal + handoff generation, Windows toasts.

**Exit:** leave two agents running, go to work, come back to a journal entry describing what each did, what JARVIS unblocked, and what needs your decision.

---

## Deliberately out of scope for v1
Multi-machine sync · mobile companion · multi-user · plugin marketplace · macOS/Linux · a visual scripting layer. Each is a fine v2 idea and a great way to never ship v1.

## Sequencing advice
M0–M4 is the useful core; if you only ever build that, you have a launcher you'll open daily. M5 is what makes it fun. M6 is what makes it yours. M7–M8 are what make it SkynetOS.
