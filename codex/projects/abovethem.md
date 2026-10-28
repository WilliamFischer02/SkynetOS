---
updated: 2026-10-23
status: active — session 5 (2026-10-22 overnight) was a seven-agent parallel build across every
area of the app; none of it has been seen in a live game yet
owner-node: none yet — no board presence (see Next)
---

# AboveThem

A Goob Entertainment Co. Windows companion app for **Among Us**: an always-on-top overlay that
reads the local player's own screen (capture + OCR, no memory reading, no injection, no packet
sniffing) and turns it into meeting-ready arguments as Crewmate, or a consistency-checked lie
ledger as Impostor, plus live chat OCR translation. Tauri 2 (Rust) + Vite/React/TypeScript. Repo:
`C:/dev/AboveThem`. WRITTEN 2026-10-21 (away-mode pass): a real, actively-worked repo found with
**zero prior codex or board presence** — same pattern as MagicTrainer/goobtropolis-configs/
AE-Phantom_Suite/StatPopperLIVE/DollyGrip/FormatPhantom/WochIt before it.

**Hard rules (from CLAUDE.md/README.md):** no information advantage — only what the local player
can legitimately see; no game-memory reads, no DLL injection into the stock client, no packet
sniffing (screen capture + OCR only; an optional BepInEx exporter mod exists for custom/modded
servers only); every suspect score and suggested line must trace back to a logged observation.

## State (per `docs/handoff.md`, session 5, 2026-10-22 overnight — WRITTEN 2026-10-23, one day after
the 2026-10-21 note this file previously carried)

Seven parallel agents (chat NLU, suspicion engine, UI, maps, research, features, bugs/Rust) each
worked ~90 minutes in git worktrees; the lead merged everything to `main`, built the release exe,
and pushed. Tests jumped from 53 Vitest/28 Rust (session 3) to **585 Vitest / 52 Rust + 1 ignored**.
**Nothing from this session has been seen in a live game** — it is unit/fixture/log-replay tested
only, same caveat the handoff itself leads with.

Headline changes, by area: a full chat→evidence NLU pipeline (assertions with polarity/strength/
confidence, 6-language lexicon, context across a meeting); a whole-game suspicion engine (social
evidence, voting rules, kill feasibility over travel times, mutual-alibi pairs, decay, per-meeting
trend); UI reworked (portal card menus, a 3-second "Why?" reason strip, situational headline engine,
responsive one/two-column layout); map detection that **never worked before this session** now
reads the map logo (UNVERIFIED on all but the Skeld fixture); Russian/German/Japanese/Spanish OCR
packs installed and wired in, several capture/event-listener bugs fixed. Toolchain unchanged (Node
24.19, Rust 1.97.1, Tauri 2.12.4, Vite 8.3.5, Vitest 5.0.5); OCR packs now also de-DE/es-ES/ja/ru.

### Known gaps / next, ordered (from the handoff's own list — supersedes the session-3 gap list)
1. **Live verification of all of the above** — one game on Skeld, one on MIRA, watching for the
   map-auto toast, roster-merge lines, headline tone changes, the reason strip, feature-card
   folding, and `diag` lines.
2. Duplicate roster cards still happen in real logs (two players split into twins) — fix belongs
   in `rosterConsolidate`, not the engine.
3. Suspicion weights are hand-set; need tuning from real ejection outcomes already in the logs.
4. Map logo OCR for Polus/Airship/Fungle has no fixture yet (only Skeld confirmed).
5. Travel-time seconds are eyeballed on every map, probably 20–30% short on Airship/Fungle.
6. Victory/defeat screen still never captured.
7. Chat parser re-parses the whole meeting per new line; needs to go incremental.
8–10. Undo-vs-OCR-events design call, no automatic vote reading, no lobby-OCR source for roles.

### Open questions for William (from the handoff — new set, session 5)
- Capture one Cyrillic chat frame as a fixture now that the Russian OCR pack is installed?
- Default kill cooldown: wiki says 45s, `presets.ts` uses 30s — which do his lobbies use?
- Should undo skip automatic (OCR) events and only undo his own inputs?
- Did any merge toast during the night name two real people, or did the roster size hold?

## Next
1. **Play a live game** — this is the single highest-value next step: none of session 5's rework
   (NLU, suspicion engine, new UI, map detection) has been seen running against a real lobby yet.
2. Fix the roster-duplicate bug (gap 2) using the two named real-log cases already captured.
3. Capture one Polus/Airship/Fungle lobby frame each for map-logo OCR fixtures (gap 4).
4. Answer the four open questions above — all William's, none agent work.
5. **Board presence**: still no GoobOS room (same gap BitRunners/StackAssembler/Story-Universe-Map
   sit in as `root` phantoms since 2026-09-16) — `root` is still 4/4 with the same four phantoms
   unticked since 2026-09-16/25, confirmed unchanged this pass. Flagged again for William: either
   free a root slot or stand up the GoobOS room these four repos are waiting for.
