---
updated: 2026-09-23
purpose: How this repo wants to be changed. Learned by doing; each line names where to look.
---

# Repo patterns

## The shape of a change

- **Rules in `packages/shared/`, pure; the process supplies the clock, the disk and the launcher.**
  `schedule.ts` + `scheduler.ts` is the model: `planRuns`/`planDispatch` are tested with an
  injected clock, the service is a thin switch over the plan. New behaviour goes in the pure half
  first, with the test, then the two-line case in the service.
- **The renderer cannot be unit-tested** (`vitest.config.ts` runs `environment: 'node'`, no DOM
  library, and a dependency is not mine to add). So: logic into a helper beside the component or in
  shared (`stack-plates.ts` for the overlays), and the `.tsx` change stays small enough to prove
  by reading.
- **IPC is an allowlist three times over.** A channel is typed in `packages/shared/ipc.ts`, added to
  the board-window list, and only deliberately to `AGENT_METHODS` (agents) or `REMOTE_METHODS`
  (phones). Anything an agent could use to act without a human stays off both. Read docs/07's table
  before adding a channel; it is the spec.
- **Every board mutation is a command with an inverse** (`command-bus.ts`), except the on-disk
  edits an unattended session makes, which are snapshotted and said to be un-undoable.
- **Placeholders never crash.** Missing sprite keys render as labelled rectangles; missing targets
  render broken. A new node kind must have its failure state designed before its happy state.
- **Text on the board is ALL CAPS state lines** with the action at the end: `NOT SCHEDULED — TICK
  ENABLED IN THE EDITOR`. An error that does not say what to do is a bug (morning-maintenance
  brief).

## Things that bit, briefly (the full list is handoff.md "Landmines")

- Heredocs eat backslashes; write regex-bearing files with the Write tool.
- `npm install` needs `env -u npm_config_allow_scripts` from this shell.
- `existsSync` on an App Execution Alias throws; use `services/which.ts`.
- Paths from the board carry `%SKYNET%`/`%USERPROFILE%`; expand before `spawn`.
- `BrowserWindow.getAllWindows()[0]` is the Face's window once it exists; use `boardWindow()`.
- A top-level `await` in an ESM Electron entry deadlocks `app.whenReady()`.
- Bash tool output over a few KB is persisted to a file, not shown; use the Read tool for files.
- Windows toasts need an App User Model ID; a dev copy borrows `process.execPath` (2026-09-23,
  scheduler.ts).

## Where the specs are

docs/01 architecture · 02 visual language (six colours, 16px grid, anti-mush) · 03 node kinds · 04
JARVIS and supervision · 05 assets and the bake · 06 roadmap · 07 security (hard boundary) · 08
remote · 09 release · 10 email (2026-09-23).
