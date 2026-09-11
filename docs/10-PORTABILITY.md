# 10 — Moving SkynetOS to another machine

The repo is the save file. Clone it, install, run — the board, the pictures, the rooms, the
personas and the mailbox all come with it.

What does **not** come with it is anything the board points at *outside* the repo: your other
repos, your installed programs, your documents. Those render broken on the new machine, and
relink the moment the real thing exists. That is the design, not a gap — see §Relinking.

---

## Setting up a second machine

```bash
git clone <your remote> SkynetOS
cd SkynetOS
npm ci
npm run verify      # typecheck, board validation, path check, asset bake, 619 tests
npm run dev
```

**Node 22.5 or newer.** `package.json` declares it. The hard requirement is `node:sqlite`, which
is built into Node from 22.5 and simply absent before it — the session database will not open on
an older runtime.

Nothing else is needed. There are no native modules to compile, no postinstall steps, and
`package-lock.json` is committed so `npm ci` installs the exact tree this was built against.

### What is regenerated rather than committed

| | |
|---|---|
| `assets/atlas/` | Baked from `assets/vendor/` + `assets/sprites/manifest.json` by `npm run assets:bake`, which `npm run verify` runs for you. |
| `board/.snapshots/` | Undo history. Machine-local by nature. |
| `skynet.db` | Session and conversation ids. Machine-local: a conversation id from one machine means nothing on another. |
| `.smoke/` | Screenshots from `npm run smoke`. |

So a fresh clone has no atlas until you run `verify` or `assets:bake` once. Until then every
sprite draws as a labelled placeholder, which is a documented state and not a crash.

---

## How paths stay portable

Board JSON uses the `%VAR%` syntax for anything that should follow the machine rather than be
pinned to one:

| Token | Expands to | Use it for |
|---|---|---|
| `%SKYNET%` | The repo root, or the resources folder in an installed build | Anything **inside** this repo: wallpapers, logos, personas, codex files |
| `%USERPROFILE%` | `C:/Users/<you>` | Documents, OneDrive, anything under your account |
| `%APPDATA%`, or any environment variable | Itself | Whatever it names |
| `~` | Your home directory | Same |

`%SKYNET%` is the one that matters most. Twenty-six paths across the five boards used to be
written as `C:/dev/SkynetOS/assets/sprites/...`; clone the repo to a different folder — or a
machine with a different username — and every wallpaper and logo resolved as missing, for files
sitting right there in the checkout.

Everything is expanded in one place, `expandPath` in `services/target-resolver.ts`, which every
path in the program passes through.

### Keeping them portable

```bash
npm run paths:portable   # rewrite absolute paths that CAN be portable
npm run paths:check      # report without writing — this runs inside `npm run verify`
```

`paths:check` is part of `verify`, so a board that drifts back to absolute paths fails the build
instead of quietly stopping being portable. That matters because the editor's file picker returns
absolute paths: pick a wallpaper from `assets/sprites/` and you get `C:/dev/SkynetOS/...` again.
Run `paths:portable` before committing and it is fixed.

### What is deliberately NOT rewritten

Paths that point outside the repo. `C:/dev/TheStalker` is a true statement about one machine, and
there is no token that makes it true somewhere else. Rewriting it would turn "this points at a
repo you have not cloned yet" into "this points at something that does not exist and never will".

`paths:portable` lists them at the end so you know exactly what to create on the new machine.

---

## Relinking

Nothing is cached. A node resolves its target **at render time**, every time, so:

1. Open SkynetOS on the new machine. Nodes pointing at things that are not there yet render as
   broken hardware — a fault outline, and the reason in the inspector.
2. Create the folder, clone the repo, or install the program.
3. It relinks on the next redraw. No restart, no repair step, no re-import.

If the thing lives somewhere else on the new machine, select the node, press `F2`, and repoint it.
The picker verifies before it saves.

A node whose target you have not set up yet can also be marked **Provisional**, which renders it as
an unpopulated footprint — a real PCB convention for "something goes here" — instead of a fault.

### The things most likely to need attention

- **Your other repos.** `C:/dev/PaceKeeper`, `C:/dev/Hurtcraft` and so on. Clone them to the same
  paths and everything relinks untouched.
- **Dev roots.** `settings.json` lives in `%APPDATA%/SkynetOS/`, not in the repo, because it grants
  access and is deliberately user-only. On a new machine it starts at the default `C:/dev`. Add
  your roots there.
- **Installed programs.** `file.exe` nodes name a real executable. Reinstall, or repoint.
- **Documents.** `%USERPROFILE%` paths follow your account automatically. A document node can also
  hold an `https` URL instead — see `file.document` — which is the better answer for anything in
  OneDrive that you have not synced.

---

## Installed build vs. running from the repo

Both work, and `%SKYNET%` resolves correctly in each:

- **From the repo** (`npm run dev`, or `npm run build:app && npm run smoke`) — `%SKYNET%` is the
  checkout.
- **Installed** (`npm run build` produces an NSIS installer) — `%SKYNET%` is the resources folder
  beside the executable. `electron-builder.yml` ships `board/`, `schema/`, `assets/atlas/`,
  `assets/sprites/`, `assets/fonts/`, `codex/` and `tools/skynet-mcp.mjs` unpacked, so they sit in
  the same relative places they do in the repo.

The difference worth knowing: an **installed** build's `board/` is beside the executable, not in
your git checkout. Edits there are not version-controlled. If the repo is your save file, run from
the repo — or copy `board/` back before committing.
