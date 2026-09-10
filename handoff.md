# handoff.md

Rewritten at the end of every session. This is what the next agent reads first, after `CLAUDE.md`.

**Last session:** the turn-10 pass — display toggles, the launch bug, the JARVIS window.
**Milestones done:** M0–M4. **Next on the roadmap:** M5 (telemetry, heat, animation, occupants,
activity feed, alerts, PSU monitor) — `docs/06-ROADMAP.md`.

---

## What landed this session

1. **Per-node display toggles.** `showDesignator`, `showName`, `showThumbnail` — three optional
   booleans on `BoardNode`, three tickers in the node editor, all defaulting to ON. Resolved by
   `displayOf()` in `packages/shared/types.ts`; honoured in `BoardCanvas.tsx`. A node with its
   thumbnail off does not even ask main for a mosaic.

2. **The launch bug.** Clicking Launch session on U3 opened nothing at all and the UI said it
   had worked. `wt.exe` splits its own command line on `;`, and U3's initial prompt contains one.
   Two fixes: `wtEscape()` in `launch-args.ts`, and — the one that matters — an `initialPrompt`
   is now staged in `userData/prompts/<board>.<node>.txt` and read back with `Get-Content -Raw`,
   so prose never crosses a shell parser again. Full story in `docs/DECISIONS.md`.

3. **"New session (fresh context)" now means it.** The old `force` flag still resumed the stored
   conversation. `fresh` mints a new id and re-sends the initial prompt. The idle chip gained a
   separate **Resume conversation** button.

4. **The JARVIS conversation is its own window.** `agent.jarvis` / `agent.chat` open an Electron
   `BrowserWindow` with the node's `partition`, its own title and its own taskbar entry, instead
   of a tab in whatever browser was default. Still a browser tab in every sense docs/07 cares
   about: no preload, no bridge, sandboxed, https-only.

## Mid-flight — nothing

`npm run verify` is green (329 tests). Working tree is clean at `589fa75`.

## Landmines, in the order they will bite you

- **Bash heredocs eat backslashes in this environment.** A doubled backslash inside a `<<'EOF'`
  block arrives as a single one, and a single one can vanish entirely. It has produced a broken
  regex, an invalid string escape, one wrong fix and one wrong bug repro in a single session —
  including in the paragraph that warns about it. Write patch scripts with the Write tool, or
  build every backslash with `chr(92)`.
- **wt.exe is a second parser.** Anything you hand it is parsed by Windows Terminal before
  PowerShell sees it, and `;` is its tab delimiter. Do not put free text on that command line.
- **A successful `spawn` is not a successful launch.** `wt.exe` exits 0 after failing to parse.
  If a launch path ever reports success, prove it opened something.
- **`--session-id` vs `--resume`.** SkynetOS assigns the conversation id; it never scrapes it.
  Getting this wrong is silent — a chip that opens a fresh conversation every time looks fine.
- **Copper is an edge colour, not a fill.** Filling a package with copper-dark turns the board
  into a wall of brown. `outline()` in `component-art.ts` exists because of that mistake.
- **The nameplate extends the TEXTURE, not the footprint.** Collision, routing and hit-testing
  all still run on the grid the board file describes. Keep it that way.
- **Canonical board JSON** is 2-space, LF, trailing newline. Python's `json.dumps` escapes
  em-dashes into an ASCII `\uXXXX` escape and breaks the check; normalise before writing with
  the JS one-liner the validator prints.

## Open questions for William

- **Head vs hands.** The two-body split (U1 Face on claude.ai, U3 Hands in a terminal) is a
  design I proposed and it costs him copy-paste, which he has said he does not want. Options are
  written up in `codex/JARVIS-SETUP.md` — the recommendation is to talk to the Hands and treat
  the Face as optional.
- **M5 or the JARVIS workflow first?** M5 is the roadmap; the JARVIS workflow is what he is
  actually trying to use.
