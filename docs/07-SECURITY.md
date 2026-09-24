# 07 — Security and blast radius

This app spawns shells, launches executables, and lets an AI agent modify its own configuration. That's the point, and it's also exactly how a fun project turns into a bad afternoon. The rules below are cheap and non-negotiable.

## Electron hardening
- `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`, `webSecurity: true`
- All IPC channels explicitly allowlisted and typed; no `ipcRenderer.invoke(arbitraryChannel)` pass-through
- `will-navigate` and `setWindowOpenHandler` deny everything except `shell.openExternal` for `https:`
- CSP on the renderer; no remote code loaded into the main window
- The claude.ai `WebContentsView` runs in its own partition and has **no** preload, no bridge, no access to SkynetOS APIs. It is a browser tab, nothing more.
  - **Amended 2026-09-11, honestly:** main now types INTO it. When William presses Enter in an
    `agent.prompt` box, main opens that conversation's window and uses `executeJavaScript` with
    fixed scripts (`src/main/services/prompt-page.ts`), plus `insertText` and key events, to hand
    over the files, type the text and press send. The page still gets no preload, no bridge and no
    way to call SkynetOS: it runs scripts it is given and answers with small JSON values. File names
    and bytes enter those scripts only through `JSON.stringify`. The bytes come from `readFileSync`
    on the paths the user picked or dropped, capped at 10 files, 20 MB each and 30 MB in total.
  - The `prompt:*` channels are user-only and are **not** in AGENT_METHODS. No agent, JARVIS
    included, can type into William's claude.ai conversation or make SkynetOS read a file into it.

## Path and execution policy
- `devRoots` in settings (default `C:/dev`). Any node whose target resolves outside a dev root or
  the user profile requires confirmation on activation.
- `file.exe` nodes: `confirmBeforeLaunch: true` by default. A launch shows the full resolved path
  and asks.
- **One question, not two.** Opening a program outside a dev root used to raise two dialogs in a
  row — "target outside your dev roots", then "launch this program?" — for one click, about one
  file, both answered by the same person for the same reason. They are now a single dialog carrying
  the same path, the same out-of-root warning and the same refusal default. No consent is lost; a
  second dialog for the same decision only teaches people to click through without reading.
- **`confirmBeforeLaunch: false` means it.** It used to be overridden by an unconditional
  "ask once per binary per run", so a user who explicitly turned confirmation off still got a
  dialog. Setting it now suppresses the prompt — for a **user-initiated** activation only.
- **An agent is asked every time, whatever the board says.** Board JSON is agent-writable
  (`command:apply` is in `AGENT_METHODS`) and so is activation (`node:open`). If a node could
  silence its own prompt for everyone, an agent could point one at anything, clear the flag,
  activate it, and run an arbitrary program with nothing on screen. `openTarget` therefore takes an
  actor and `trustedByUser` refuses anything that is not `'user'`.
- **Elevation is always confirmed**, whatever the node says and whoever asked. "Run this" and "run
  this as administrator" are different questions.
- `settings.confirmAllLaunches` puts every prompt back. It lives in settings.json, which has no
  write channel, so it is the one lever an agent cannot touch.
- Path traversal is rejected: a board file may not reference `..` past its room root without an explicit `allowEscape: true` flag on that node.
- Board JSON is data. It never contains executable code, template expressions, or shell strings that aren't `startCommand`/`args` on a node that declares them.

## Elevation
- Default is **non-elevated**. `popout-elevated` is opt-in per node, shows a distinct sprite badge (a lightning bolt on the package), and is listed in Settings so you can audit which nodes have it.
- SkynetOS itself never runs elevated. It launches an elevated child when asked.
- The supervision loop may never start an elevated session, ever, regardless of node config.

## Agent authority
What agents can do through `skynet-mcp`:

| Action | Policy |
|---|---|
| Read board, telemetry, sessions, codex | Allowed, always |
| Create/update/move nodes and edges | Allowed, auto-snapshot first, diff shown; per-room policy `require-approval` (default) or `auto` |
| Delete a node, edge, or room | **Always requires explicit approval in the UI.** No auto policy can override this. |
| Propose a recommended node (phantom) | Allowed, at most 4 per board — enforced by the command bus and by the schema's `maxItems`, not by the agent. Signed with the agent's name; it may never sign as `user` |
| Withdraw a recommended node | Allowed for an agent's OWN proposals only. William's are his to dismiss |
| Approve a recommended node | **Never.** `phantom:approve` is user-only, and the bus refuses `phantom.approve` from any actor but the user. The tick on the board is the approval. Its inverse (`phantom.unapprove`) removes a real node and is in DESTRUCTIVE, so undo is its only door |
| Write codex files | Allowed |
| Start/stop a declared session | Allowed |
| Send a message to a running session | Allowed, rate-limited to 3/hour/session |
| Approve a Claude Code permission prompt | **Never.** Not exposed as a tool. |
| Type into the claude.ai conversation, or attach files to it (prompt node) | **Never.** `prompt:send`, `prompt:pickFiles` and `prompt:describeFiles` are user-only and not in AGENT_METHODS. Only William pressing Enter in a prompt box sends anything |
| Brief JARVIS Prime to build a node (PROMPT → NODE box) | **Never.** `prompt:build` is user-only and not in AGENT_METHODS: it opens a Prime terminal on William's desktop, and only his Enter in the box may do that. An agent that wants a node proposes it with `phantom_propose` or places it with `node_create` |
| Make SkynetOS start with Windows, or stop it doing so | **Never.** `app:autostart` and `app:setAutostart` are user-only and not in AGENT_METHODS. The Run value runs code at every sign-in, so only William's switch in the LOOK panel, or his own `npm run autostart:on`, may set it |
| Check for, or install, a program update | **Never.** `update:check` and `update:install` are user-only, in neither AGENT_METHODS nor REMOTE_METHODS. Installing restarts the app, which ends sessions nobody asked an agent about, and a phone must not be able to restart the desktop it is reaching. `update:status` is read-only and open to the board window |
| Move the data home | **Never.** The home (where `board/` and `codex/` live for an installed copy) is a trusted root. It is chosen by `settings.json` `home`, which has no write channel, or by main itself (`userData/home.json`); no channel writes either. See docs/09 |
| Run a scheduled task now | **Never.** `task:runNow` is user-only and not in AGENT_METHODS: a scheduled `agent.run` opens a Prime terminal on the desktop |
| Configure a scheduled task (`schedule`, `action`, `taskTarget`, `taskBrief`, `taskPrompt`) | Allowed, as with any board field. It is limited by what a scheduled run may do: at most 6 scheduled runs a day across all tasks, one per slot, never elevated (an elevated target is refused, not downgraded), a brief must be a `.md` inside the SkynetOS repo, and every run is a FRESH session told it is a standing task that must commit, push and delete nothing. Board edits are snapshotted and undoable like any other |
| Switch the JARVIS face windows on or off | **Never.** `avatar:setEnabled` is user-only and not in AGENT_METHODS. The face windows themselves only OBSERVE. The terminal tracker reads window titles, rectangles and state through user32, and moves, clicks and types nothing. The web face asks claude.ai whether a response is streaming and never clicks, types or dispatches anything in the page (`streamingProbeScript`, held to that by a test) |
| Summon JARVIS Prime onto a node | **Never.** `jarvis:summon` is user-only and not in AGENT_METHODS: it opens a terminal on William's desktop, and only his right-click may do that |
| Write the journal note into an Obsidian vault | **Never** by an agent: only William's click on a journal `task.scheduled` (`node:open` with actor `user`). It creates ONE new file with `wx`, so it can never overwrite; it never deletes; and a `journalFolder` containing `..` or a drive letter is refused, so it stays inside the vault |
| Paste copied nodes | **Never** through `node:paste`, which is user-only. Agents place nodes with `node_create`. The paste's inverse, `node.removeMany`, is in DESTRUCTIVE, so undo is its only door |
| Delete files on disk, `git push --force`, `git reset --hard` | **Never.** Not exposed as a tool. JARVIS may print the command for you to run. |
| Modify settings, allowlists, or elevation policy | **Never.** Settings are user-only. |
| Run arbitrary shell | Only within a node's declared `cwd`, and only via a session the node already declares |
| Open a terminal or session on a node, with a task | Allowed. The node supplies the working directory; the task reaches it through a staged FILE, never a command line |
| Launch elevated | **Never.** A node set to `popout-elevated` is refused, not downgraded — elevation is a decision a human made about that node |
| Start a session from a mailbox message | Allowed when the message carries `run:`, capped at 3/hour, never elevated, message archived before launch so it cannot fire twice. `autoRunMail: false` disables it |
| Replace the Face's standing orders from a mailbox message | Allowed when the message carries `standing:`. Writes exactly one file, `codex/face-brief.md`, whole, then archives the message; every earlier version stays in `archive/`. Never launches anything, even with `run:` also set. Injected only into the Hands node's briefing. Not gated on `autoRunMail`, because it starts nothing: it changes what the next session is told, which every message in `to-hands/` already does |
| Put the app to sleep, wake it, or change the away level (`away:*`) | **Never.** All four channels are user-only and not in AGENT_METHODS: an agent that could send the app to sleep could hand itself the autonomous loop |
| Act as the away session (away mode `plan` or `work`) | Only inside bounds William chose by choosing the level. SkynetOS starts a headless `claude -p` with `--permission-mode dontAsk --permission-prompts none` and fixed `--allowedTools`/`--disallowedTools` lists (packages/shared/away.ts). Anything no rule allows is denied, and nothing waits for a human who is not there. This is a policy William set, not an agent approving its own prompts. It may write only `SkynetOS/codex/**` and `docs/06-ROADMAP.md`, propose phantoms and send mail. It can never commit, push, delete, run elevated, open terminals, or edit or remove board nodes. `--strict-mcp-config` loads only the skynet server |
| Start sessions while William is away | Only at level `work`, which is **settings.json only** (the in-app control refuses it), and at most 2, counted in main at `session:start` rather than trusted to the prompt. They open on the away model, not Fable or Opus |
| Automate the claude.ai conversation while William is away | **Never.** claude.ai's consumer terms forbid scripted use of the web conversation. The away session is headless Claude Code, and the Face receives its summary as `to-face` mail |
| Undo or redo | **Never.** The undo stack is shared with the user and is not per-actor: an agent's undo reverts whatever happened last, which may be William's work |
| Summon a native file picker or any modal | **Never.** A modal an agent raised is a modal the user may dismiss by reflex |

### Where this is enforced

`callAsAgent` in `src/main/ipc.ts`, against `AGENT_METHODS` in `packages/shared/ipc.ts`. It is an
allowlist of things granted, not a denylist — a channel added later is unreachable by an agent
until someone deliberately adds it. It also rewrites every `command:apply` request so it cannot lie
about itself: `actor` becomes `agent` regardless of what was asked for, and `approved` is stripped,
because that flag means "a human approved THIS command in THIS exchange" and an agent setting it
for itself would turn the delete guard in `command-bus.ts` into a comment.

Everything an agent can reach goes through that one function. The MCP server
(`tools/skynet-mcp.mjs`) is a proxy with no authority of its own; editing it to ask for something
else changes nothing.

The transport is a **named pipe**, not a localhost port. A port is reachable by every process on
the machine and, on a misconfigured box, from the network; a pipe is subject to the same
user-account boundary that already protects `sessions.db` and `settings.json`. A token is written
beside it in userData and required on every request — not as the security boundary, but so a
process that stumbles onto the pipe name still cannot drive the board without being able to read
the user's own AppData. The token is minted per run, so a stale control file names a pipe that no
longer exists and a token nothing will accept.

## Remote devices (docs/08)

A phone, tablet or second computer runs the same renderer in a browser and drives the app over a
WebSocket. It is a third door, next to the desktop window and the agent pipe, and it is narrower
than the first.

| Rule | How it is enforced |
|---|---|
| Off unless William turns it on | `remoteEnabled` in settings.json defaults to `false`. Only the desktop's LOOK → REMOTE switch sets it: `remote:setEnabled` is in neither AGENT_METHODS nor REMOTE_METHODS |
| Never on the network directly | `remote-server.ts` binds `127.0.0.1` and nothing else. Never `0.0.0.0`, never a LAN address. The only way in from another device is a tunnel William sets up (Tailscale, or Cloudflare Tunnel with Access) |
| Publishing to the tailnet is William's click | `remote:tailscaleServe` is desktop-only and raises a native confirm before it runs `tailscale serve --bg http://127.0.0.1:<port>`. That shares the port with William's own devices only; it is never `tailscale funnel` |
| Only paired devices | A one-time code: 8 characters from an alphabet without look-alikes, single use, expiring in 5 minutes, held in memory only. It is exchanged for a 256-bit device token. `remote-devices.json` stores only the SHA-256 of each token, compared in constant time. Devices are listed on the desktop and revocable there; a revoked device is closed with 4403 |
| Wrong guesses turn it off | 10 failed pairings or authentications in 10 minutes switch remote off until William turns it back on |
| No DNS rebinding, no cross-site sockets | Requests are answered only for `localhost` or `127.0.0.1` on the server's own port, `*.ts.net`, or a host in `remoteAllowedHosts`. A WebSocket upgrade's Origin must match its Host |
| An allowlist, not a mirror | `callAsRemote` in `src/main/ipc.ts`, against `REMOTE_METHODS` in `packages/shared/ipc.ts`. A channel added later is unreachable remotely until someone adds it deliberately. Refused from a phone: settings, autostart, elevation, the face windows, opening files or programs on the desktop, pickers, and every `remote:*` channel |
| A phone cannot delete | `command:apply` from a remote device is rewritten: `actor` becomes `remote` and `approved` is stripped. A DESTRUCTIVE command is refused outright, because the delete confirmation is a dialog on a desktop nobody may be sitting at. Undo on the phone is still allowed; it reverts, it does not destroy |
| A phone cannot answer a desktop dialog | A remote call runs inside `runAsRemote` (AsyncLocalStorage). Every confirm and picker checks `refuseDialogWhenRemote` and fails with CONFIRM ON THE DESKTOP, instead of raising a modal William might dismiss by reflex when he gets home |
| Phantoms stay William's | Actor `remote` is treated as `user` for phantom tick and cross: William on his phone is still William. It is never treated as `agent` |
| An audit trail without contents | `userData/remote-audit.log` records each pairing and call: time, device id, channel and ok or error. It never records arguments, so prompts and paths stay out of it |
| No files from the phone | `prompt:send` from a remote device carries no file paths; the phone's own files cannot reach the desktop's disk through it |

The token lives in the phone browser's localStorage for that origin only. It is not a secret the
repo, the board or the audit log ever sees.

## Sessions from the phone: Claude Code's Remote Control

Added 2026-09-21. SkynetOS's own remote (docs/08) puts the BOARD on a phone. It does not put a
running agent's terminal there: sessions are real console windows on the desktop. Claude Code has
its own feature for that, Remote Control, and an `agent.code` node may ask for it with
`remoteControl: true`, which adds `--remote-control "<designator> <name>"` to that chip's launch.

| Rule | Where it is kept |
|---|---|
| Off unless the node says so | `claudeArgs` adds the flag only for `remoteControl === true` (`test/sessions.test.ts`). The schema default is `false` |
| SkynetOS opens nothing for it | Remote Control is outbound HTTPS from the `claude` process to Anthropic. No port, no pipe, no token of SkynetOS's is involved, and docs/08's server is not part of it |
| Only William can reach the session | The session appears in the Claude app and at claude.ai/code for the Anthropic account `claude` is signed in with, and for nobody else. The grant is that login, which no board edit can change |
| What an agent gains by setting the flag | Nothing it can use. Board JSON is agent-writable, so an agent could turn the flag on; the session would then be reachable by William's account, which the agent does not hold. It is still listed here because the phone side CAN answer that session's permission prompts: that is William answering them, from a different room |
| The hard off | `"disableRemoteControl": true` in `~/.claude/settings.json`. It is Claude Code's setting, outside the repo and outside every SkynetOS channel, and it wins over any node |
| Never elevated | Unchanged: a node set to `popout-elevated` is still refused for an agent, and Remote Control does not alter how a session is launched, only what the CLI is told |

Not verified on a phone yet. The flag was read from `claude --help` on this machine (2.1.278) and
the feature's behaviour from code.claude.com/docs/en/remote-control.

## Program updates (docs/09)

An installed SkynetOS downloads and runs new versions of itself, so the rules are written down.
Added 2026-09-21 with `src/main/services/updater.ts`.

| Rule | Where it is kept |
|---|---|
| Only an installed copy updates itself | `startUpdater` returns at once unless `app.isPackaged`. `electron-updater` is imported only then, so a dev build never loads it and never asks GitHub anything |
| Updates come from one place | The GitHub releases of `WilliamFischer02/SkynetOS`, over HTTPS, named in `electron-builder.yml` `publish` and baked into the install as `app-update.yml`. Pre-releases are ignored |
| An update is checked before it runs | electron-updater compares the download's SHA-512 with `latest.yml`. There is no publisher signature to check, because the build is not code-signed: whoever can publish a release on that repo can ship code to every installed copy. Two-factor authentication on the GitHub account is the control |
| An update never touches data | The installer replaces `%LOCALAPPDATA%/Programs/SkynetOS` and nothing else. Boards, codex, `%APPDATA%/SkynetOS` and the home folder are outside it; `deleteAppDataOnUninstall: false` |
| No administrator prompt, ever | `perMachine: false`. SkynetOS itself still never runs elevated |
| Nothing is published by a build | Every electron-builder script passes `--publish never` (`test/update.test.ts`). `npm run release:publish` is a separate command that William runs; no agent runs it, as with every push |
| Nobody else can trigger it | `update:check` and `update:install` are user-only channels |

## Secrets
- No tokens, keys, or passwords in `board/*.json` — the board is git-tracked and will end up on stream. Secrets live in Windows Credential Manager via `keytar`, referenced by name.
- `service.process` nodes reference a `.env` path, never inline values.
- **The repo is public.** `FACE-BOOT.md` and `codex/mailbox/` are how the Face reads this machine,
  and anyone can read them too. Mail to the Face never quotes a secret, a token, or a path outside
  what the boards already expose.
- Before any screenshot export, the exporter redacts full paths beyond the dev root and any string matching a secret-like pattern.

## Recovery
- Auto-snapshot to `board/.snapshots/` before every agent mutation, retained 30 days.
- `board/` is git-tracked, so `git checkout board/` is always the escape hatch.
- Deleting `skynet.db` loses telemetry and session ids only; the board and codex are unaffected.
- Deleting `codex.db` loses nothing — it rebuilds from the markdown.

## Voice

Voice control opens a microphone, so it is held to the standard the cameras are, and to one more:
nothing is transcribed that was not addressed to JARVIS. Added 2026-09-12 with the service that
runs it (src/main/services/voice.ts).

| Rule | Where it is kept |
|---|---|
| Nothing is transcribed before the wake phrase | Windows' recogniser runs a closed grammar of the wake phrases and nothing else (`wakeScript`, packages/shared/voice.ts). A `Choices` grammar can only return one of its choices; no dictation grammar is loaded. |
| Nothing is heard after the sentence | The capture window stops every track the moment the endpointer decides the sentence has ended, and after 8 s of sentence at most (src/renderer/voice.ts, packages/shared/voice-capture.ts). |
| Audio never leaves the machine | whisper-server binds 127.0.0.1 only. The capture window's CSP gives it no network, and its partition grants a microphone and refuses a camera (`allowMicrophoneOnly`). |
| No recording is written to disk | A sentence exists in memory between the capture window and the server. The only WAV the service writes is `warmup.wav`, synthesised by Windows' speech synthesiser. |
| Off means off | `voice:setEnabled(false)` kills the wake sidecar and the speech engine and destroys the capture window. It is the hard mute, and the VOICE button beside MANUAL is one press away. |
| Nobody else can switch it on | `voice:setEnabled` is in neither AGENT_METHODS nor REMOTE_METHODS. `voice:captured` may be called only by the capture window, and that window may call nothing else. |
| Voice cannot approve a deletion | `actOnIntent` refuses every `confirm` intent from every producer. A microphone is not a hand on the confirmation. |
| A question leaves only as text, and only to the Face | A sentence the grammar does not understand at all is shown for 2.2 s with Esc to cancel, then sent as text to William's own claude.ai conversation (`prompt:send`). Audio is never sent anywhere. |

## Streaming safety
You will put this on stream. Add a `Stream mode` toggle that: hides the full path column in the inspector, blurs nothing (no blur — it *hides* rather than obscures), suppresses toast contents to a generic "Activity", and disables the claude.ai webview from rendering conversation text until you re-enable it.
