# CLAUDE.md — SkynetOS build contract

You are building SkynetOS: a Windows desktop app that renders an overhead pixel-art motherboard, where every visual component is bound to a real agent, repo, folder, or file on this machine.

Read `docs/01-ARCHITECTURE.md` through `docs/07-SECURITY.md` before writing code. `docs/09-RELEASE.md` is the installed program: where its data lives, and how it updates. They are normative, not suggestions. `docs/08-REMOTE.md` is the design for iPhone remote control (M9): normative for how it must be built, and not yet built.

---

## Prime directives

1. **Bind to reality.** Every node resolves to a real path, URL, or process. If it can't resolve, show it broken. Never mock, never stub-and-forget, never fabricate a file listing.
2. **Data before pixels.** The board is JSON validated against `schema/board.schema.json`. The renderer is a view over that JSON. If those two ever disagree, the JSON wins.
3. **Art comes from the bake pipeline, never from vendor files directly.** Downloaded sheets live in `assets/vendor/` and are never edited and never loaded by the app. `assets/sprites/manifest.json` declares every sprite key and where its pixels come from; `npm run assets:bake` slices, recolors, composites, and packs them into `assets/atlas/`, which is the only art the app loads. Missing keys render as labelled placeholder rectangles — never a crash. See `docs/05-ASSETS.md`.
4. **Pixel purity is a hard requirement.** See `docs/02-VISUAL-LANGUAGE.md` §Anti-mush. Any blur filter, fractional zoom, bilinear scale, or off-palette pixel is a bug of the same severity as a crash.
5. **Undo everything.** Every board mutation goes through the same command bus with an inverse. Ctrl+Z works in Edit Board mode, for user edits and for agent edits alike.
6. **No unattended destruction.** See `docs/07-SECURITY.md`.
7. **Small vertical slices.** Ship one node type end-to-end (schema → render → click → real effect → test) before starting the next.

## Definition of done, per feature

- [ ] Types added to `packages/shared/types.ts` and the JSON Schema
- [ ] Sprite keys declared in `assets/sprites/manifest.json` (or deliberately left as placeholders)
- [ ] Board fixture updated in `board/` and `npm run validate:board` passes
- [ ] Renders correctly at zoom 2x, 3x, 4x with no sub-pixel artifacts
- [ ] Keyboard path exists (not mouse-only)
- [ ] Failure path designed: what it looks like when the target is missing
- [ ] Vitest unit test for logic; Playwright smoke test if it touches IPC
- [ ] `npm run verify` green

## Commands

```bash
npm run dev             # electron-vite dev, HMR renderer
npm run verify          # typecheck && validate:board && assets:bake && validate:assets && vitest run
npm run validate:board  # every board/*.json against schema/board.schema.json
npm run assets:bake     # vendor sheets + manifest -> assets/atlas/
npm run validate:assets # pixel purity check on the baked atlas + authored sprites + license trail
npm run pack            # fast: unpacked release/win-unpacked/SkynetOS.exe, no installer
npm run release         # bump the version, verify, build the NSIS installer (docs/09-RELEASE.md)
npm run build           # the same build for the current version (alias of npm run dist)
```

## Working style

- Blunt commit messages, no ceremony. `feat(board): drive node descends into room`
- Keep a running `docs/DECISIONS.md`: date, decision, alternatives rejected, why. Append-only.
- Keep `handoff.md` at repo root updated at the end of every session: what's done, what's mid-flight, what's next, known landmines. Overwrite it each time.
- When a doc in `docs/` is wrong or has been superseded by reality, **edit the doc in the same commit**. Stale docs are worse than none.
- If you're about to invent a behavior the docs don't cover, add it to `docs/DECISIONS.md` and proceed. Don't stall.

## Things that will bite you (read before you hit them)

- **Electron `startDrag` on Windows** kills in-app drop targets for the same gesture. Distinguish drag-out (from the node's file badge) from drag-to-move (from the node body) at the DOM level, with different handles.
- **`Start-Process -Verb RunAs`** triggers a UAC prompt every launch. Default agent nodes to non-elevated. `elevated: true` is opt-in per node and must be visibly indicated on the sprite.
- **File watchers on network/OneDrive paths** are unreliable. Fall back to polling with a 5s interval when the path is not on a local fixed disk.
- **`claude --resume <id>`** is how an agent node reattaches to its prior conversation. Persist the session id per node in `sessions.db`, not in the board JSON.
- **PixiJS + non-integer camera position** produces shimmer. Round camera x/y to whole device pixels every frame before render.
