# SkynetOS

An overhead pixel-art motherboard that is also a real control surface for every project I run with Claude.

Agents are microchips. Repos and folders are disk drives. Files are components. Copper traces show what produces what. Clicking a chip launches the actual agent in the actual directory. Clicking a drive opens the actual folder — or descends into a room. Nothing on the board is decorative-only; every sprite is bound to something real on disk, in GitHub, or in the cloud.

**Status:** M0 done, M1 substantially done. The app builds, launches, renders the real board with
copper traces, resolves every node against the real filesystem, opens real folders, and lets you
edit any node through a form with a native file picker. All art is still placeholder rectangles —
no atlas has been baked yet, which is by design until M5.

---

## Running it

**Day to day — this is the one you want:**

```bash
npm install     # once. Downloads Electron (~250MB), takes a couple of minutes.
npm run dev     # opens the app with hot reload on the renderer
```

Edit anything under `src/renderer/` and the window updates without restarting. Changes to
`src/main/` or `src/preload/` restart Electron automatically.

**Controls:** `WASD`/arrows pan · `2` `3` `4` zoom · `Ctrl+scroll` zoom · click or `Tab`/`Shift+Tab`
to select · `Space`/`Enter` or double-click to activate · `E` edit the selected node · `F` focus
mode · `R` re-read the board file · `Ctrl+Z`/`Ctrl+Y` undo/redo.

**A real double-clickable exe:**

| Command | Time | Produces |
|---|---|---|
| `npm run app` | ~14s | `release/win-unpacked/SkynetOS.exe`, then launches it. No installer. Pin it to the taskbar. |
| `npm run build` | ~40s | `release/SkynetOS-<version>-x64.exe` — a real NSIS installer, ~129MB. Runs `verify` first. |
| `npm run smoke` | ~20s | Launches the built app headless, screenshots it, drives pan/zoom, exercises the command bus, exits. Evidence, not claims. |

**Checks:**

```bash
npm run verify   # typecheck + board schema + canonical form + asset bake + pixel purity + tests
npm run sheet <sheet-id> out.png --zoom 6   # ruled contact sheet of a vendor sheet
```

## Automatic builds

**Every push to `main` builds an installer.** `.github/workflows/build.yml` runs `npm run verify`,
packages the NSIS installer, uploads it as a run artifact, and republishes the rolling
[`main-latest`](../../releases/tag/main-latest) prerelease so there is always one URL for the
newest build. A failing `verify` produces no downloadable exe.

The installer is **unsigned**, so Windows SmartScreen warns on first run — "More info", then
"Run anyway". Code signing needs a certificate; it is not a build problem.

**Optional, local:** `npm run hooks:install` adds a post-commit hook that rebuilds
`release/win-unpacked/SkynetOS.exe` in the background after every commit, so a pinned shortcut is
always current. It never blocks or fails a commit; errors land in `release/build.log`.
`npm run hooks:uninstall` removes it.

---

## TL;DR for the building agent

1. Read `CLAUDE.md` — that is your standing contract.
2. Read `docs/01`–`docs/07` in order.
3. Build in the milestone order in `docs/06-ROADMAP.md`. Do not skip M0.
4. Every commit must leave `npm run verify` green (typecheck + board schema validation + asset purity).

## Repo map

```
CLAUDE.md                  Standing rules for any agent working in this repo
STARTUP_PROMPT.md          The kickoff prompt to paste into Claude Code on day one
docs/
  01-ARCHITECTURE.md       Stack, processes, IPC, data flow, why each choice
  02-VISUAL-LANGUAGE.md    Palette, grid, sprite specs, animation, anti-mush rules
  03-NODE-TYPES.md         Every node & edge kind, its data, its click behavior
  04-JARVIS.md             Primary agent: two-body design, Codex memory, MCP tool surface
  05-ASSETS.md             Where art comes from, licenses, sprite manifest, validator
  06-ROADMAP.md            M0–M8 milestones with exit criteria
  07-SECURITY.md           Elevation, allowlists, secrets, blast radius
schema/board.schema.json   JSON Schema for board files (source of truth)
board/                     The actual board data — one file per room, git-tracked
tools/                     bake-assets.mjs, validate-assets.mjs, validate-board.mjs
assets/
  vendor/                  Downloaded asset packs, unedited. One folder per pack. See its README.
  sprites/manifest.json    Every sprite key → which vendor cells build it (kitbash recipes)
  sprites/authored/        Your own hand-drawn PNGs, added over time
  palettes/                skynet.gpl (locked) + per-pack remap tables
  atlas/                   Baked output the app loads. Git-ignored, regenerated.
.claude/commands/          Slash commands for the build agent
```

## Non-negotiables

- **Windows 11 first.** Cross-platform is a nice-to-have, never a blocker.
- **Real files or nothing.** A node that can't resolve its target renders as a dead component with a broken-trace indicator. It never fakes success.
- **Board data is git-tracked JSON.** Every edit — mine or JARVIS's — is a reviewable diff.
- **Pixel purity.** No blur, no anti-aliasing, no fractional scaling, no soft glow filters. See `docs/02`.
- **Art is baked, never used raw.** Vendor sheets get sliced and recolored to the locked palette by `npm run assets:bake`. The app only ever loads `assets/atlas/`. See `docs/05`.
- **No destructive autonomy.** Agents may propose file deletion, board deletion, or force-push. They may not perform them unattended. See `docs/07`.
