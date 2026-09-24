# 09 — Release: the installed program, and how it updates

SkynetOS runs two ways. From source (`npm run dev`, `npm run boot`), which is how it is built and
changed. And installed: `SkynetOS.exe` in the Start menu and on the taskbar, which is how it is
used. This document is the second one: what the installer contains, where the data lives, and the
workflow for every build after the first. Added 2026-09-21.

---

## The one rule: the program and the data are separate

| | Program | Data |
|---|---|---|
| What | `SkynetOS.exe`, `app.asar`, `schema/`, `tools/skynet-mcp.mjs`, `mediapipe/`, `build-info.json` | `board/`, `codex/`, `assets/sprites`, `assets/avatar`, `handoff.md`, `docs/` |
| Where | `%LOCALAPPDATA%/Programs/SkynetOS` | The **home** folder. On William's machines: the repo, `C:/dev/SkynetOS` |
| An update | Replaces all of it | Never touches it |
| Settings, sessions, paired devices | | `%APPDATA%/SkynetOS`, shared by the installed copy and the dev copy |

An installed SkynetOS never reads boards from its own install folder. Before 2026-09-21 it did
(`resources/board`), and an update would have overwritten every board edit made since the previous
build. `packages/shared/home.ts` has the reasoning; `src/main/services/home.ts` applies it.

**How an install finds its home**, first match wins:

1. `"home"` in `%APPDATA%/SkynetOS/settings.json`, if that folder holds `board/root.board.json`.
   File-only: the home is a trusted root, so no channel may move it (docs/07).
2. The home it used last time (`%APPDATA%/SkynetOS/home.json`, written by the app itself).
3. The repo the installer was built in (`build-info.json` → `builtFrom`), if it is on this machine.
4. `%USERPROFILE%/SkynetOS`, if it holds a board.
5. Otherwise `%USERPROFILE%/SkynetOS` is **seeded** from the install's starter copy of `board/`,
   `codex/`, `assets/sprites` and `assets/avatar`. Seeding fills gaps and never overwrites a file.

ABOUT (`Ctrl+K`, "about") shows the home in use, the build's commit and date, and the update state.

Because the home is the repo, the installed copy and the dev copy show the same boards, the Hands
still edit what the window shows, and `git checkout board/` is still the escape hatch.

**Schema drift.** The schema ships with the program. If the repo's boards gain a field that an older
installed build's schema does not know, that build refuses the board with a legible validation
error. The fix is to update the program: that is what the rest of this document is for.

---

## Commands

```bash
npm run icon              # draw build/icon.ico and icon.png (tools/make-icon.mjs)
npm run pack              # fast: an unpacked release/win-unpacked/SkynetOS.exe, no installer
npm run dist              # verify, then the NSIS installer in release/, for the current version
npm run release           # bump patch, then dist.  -- minor | major | x.y.z | --same | --public
npm run install:local     # open this version's installer.  -- --silent for no wizard
npm run release:publish   # upload this version to GitHub Releases with gh.  -- --dry to preview
```

`npm run release` commits, tags, pushes and uploads **nothing**. If the build fails after the
version bump, the version is put back. Every electron-builder script passes `--publish never`, and
`test/update.test.ts` holds that.

---

## First install, on this PC

1. `npm run release -- minor` has been run once: `release/SkynetOS-0.1.0-x64.exe`.
2. Close the dev copy of SkynetOS if it is open (both use the same `%APPDATA%/SkynetOS`; the newer
   start takes over from the older, see `services/instance.ts`, but one at a time is cleaner).
3. `npm run install:local`, and go through the wizard. It installs per user: no administrator
   prompt, now or for any update.
4. Start SkynetOS from the Start menu. Right-click its taskbar button → **Pin to taskbar**.
5. Open ABOUT and check **Data** reads `C:/dev/SkynetOS`.

Windows SmartScreen will warn on the first run, because the installer is not code-signed. "More
info" → "Run anyway". A signing certificate removes the warning and costs money every year; it is
not needed for a program installed by the person who built it.

**Start with Windows.** The LOOK → SYSTEM switch is per copy. Pressed in the INSTALLED copy it sets
the Run value to the exe itself, quoted, with no login script and no node (`installedAutostartCommand`,
`test/boot.test.ts`). Pressed in the dev copy it writes `boot.vbs` as before, which builds from source
and starts Electron. Whichever copy set it last wins, and the other copy's panel shows the value as
not current. Not yet tried from an installed copy.

---

## Every build after the first

### A. This PC only (no GitHub involved)

```bash
npm run release            # 0.1.0 -> 0.1.1, verify, build
npm run install:local -- --silent
```

The installer closes a running SkynetOS, replaces the program, and leaves the home and
`%APPDATA%/SkynetOS` alone. Start it again from the taskbar pin, which survives the update.

### B. Every installed copy, on every machine (the other desktop included)

```bash
npm run release -- --public    # the installer does not record this machine's repo path
git add -A && git commit -m "release: 0.1.1" && git push     # William's, never an agent's
npm run release:publish        # gh release create v0.1.1 with the exe, latest.yml, the blockmap
```

Each installed SkynetOS checks `latest.yml` on the newest GitHub release 15 seconds after it
starts and every six hours, downloads a newer installer in the background, and installs it when
SkynetOS next closes. ABOUT shows progress and offers **Restart and update**. A published build
carries no `builtFrom`; an install that already found its home keeps it (`home.json`), which is why
rule 2 above exists.

`npm run release:publish` refuses an installer that still records its build folder, and refuses a
`latest.yml` for a different version.

### Before publishing the first time

- **The repo is public, so a published installer is public.** It contains the starter `board/` and
  `codex/` exactly as they are in the repo, which is already public, and nothing from
  `%APPDATA%/SkynetOS`.
- **`gh auth status`** must show William's account with `repo` scope.
- **Unsigned updates.** electron-updater verifies an update's SHA-512 against `latest.yml`, fetched
  over HTTPS from GitHub. With no code-signing certificate it cannot also verify a publisher
  signature. Whoever can publish a release on the repo can ship code to every installed copy:
  protect the GitHub account with two-factor authentication.

---

## What is inside the installer

`electron-builder.yml` is the manifest. In short: `out/**` and the production `node_modules` in
`app.asar`; beside it, unpacked, the program files (`schema/`, `tools/skynet-mcp.mjs`,
`mediapipe/`, `assets/fonts`, `build-info.json`) and the seed data (`board/` without `.snapshots`,
`codex/`, `assets/sprites`, `assets/avatar`).

Not inside, by design: the voice engine and model (~700 MB) and the hand-tracking models, which are
per machine under `%LOCALAPPDATA%/SkynetOS` and are found through settings.json as before.

`npmRebuild: false`: there are no native modules in the package. `node-pty` is excluded.

---

## Verified, and not

- **Verified 2026-09-21:** `npm run pack` builds; the packed `SkynetOS.exe`, run through the smoke
  harness beside a live dev copy, chose `C:/dev/SkynetOS (built-from)` as home, loaded all five
  boards, and produced the full screenshot set. `test/home.test.ts` and `test/update.test.ts` hold
  the rules.
- **Not verified:** the NSIS wizard run by a person; an update installed over an older install; an
  update fetched from a real GitHub release; manual (gesture) control and voice from the installed
  copy; Start with Windows for the installed copy.
