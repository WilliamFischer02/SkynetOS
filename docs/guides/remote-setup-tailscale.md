---
name: remote-setup-tailscale
written: 2026-09-23
status: active
purpose: The keyboard-side walkthrough for putting SkynetOS on William's iPhone, iPad, a Mac or a second PC over Tailscale. Every button name, status line and error below is quoted from the code as it stood on 2026-09-23. Design is docs/08-REMOTE.md; rules are docs/07-SECURITY.md "Remote devices".
---

# SkynetOS on your phone: the Tailscale setup, step by step

Read this at the PC with SkynetOS in front of you. Each step is one action, then what the screen
should say. If it does not say that, the fix is under the step. Nothing here has been tried on a
real phone yet: the code is unit-tested and smoke-tested over the bridge on this PC, so the first
time through, treat each "you should see" as a prediction and tell JARVIS where it was wrong.

Ten minutes if everything goes right. Nothing in it is dangerous: remote is off until you tick it,
the server only ever listens on this PC (127.0.0.1), and a device cannot do anything until it has
traded a one-time code for a token.

---

## 0. What is already done (read on this PC, 2026-09-23)

| Item | State | How it was read |
|---|---|---|
| Tailscale on this PC | Installed, version 1.102.4, signed in as your account, connected (`BackendState: Running`) | `tailscale version`, `tailscale status --json` |
| This PC's tailnet name | `william-desktop.<tailnet>.ts.net` (the suffix is printed in the REMOTE panel and by `tailscale status --json` under `MagicDNSSuffix`) | `tailscale status --json` |
| MagicDNS | On, tailnet-wide | `tailscale dns status` |
| HTTPS certificates | **On**: `CertDomains` lists this PC. This is the setting `tailscale serve` needs; it was off on 2026-09-11 and someone has since turned it on | `tailscale status --json` |
| Your iPhone | On the tailnet as `iphone-15-pro`, online at the time of reading | `tailscale status` |
| Published to the tailnet | **Not yet**: `tailscale serve status` answers `No serve config` | `tailscale serve status` |
| SkynetOS remote switch | **Off** (`remoteEnabled: false`, port 47821, no extra hosts) | `%APPDATA%/SkynetOS/settings.json`, read only |
| Paired devices | None (`remote-devices.json` does not exist yet) | userData listing |
| Built renderer to serve | Present (`out/renderer/index.html`) | file listing |
| Port 47821 | Free | `netstat` |

So on the PC side, what is left is exactly three presses in the REMOTE panel, after one restart.
Nothing needs installing on the PC or the iPhone. An iPad or a Mac needs the Tailscale app first
(step 5, step 6).

---

## 1. Restart SkynetOS with the latest code

The remote server, the pairing channels and the REMOTE panel are main-process code. A copy of
SkynetOS started before they existed shows the panel's note
`Restart SkynetOS to use remote devices: the running copy predates them.` and nothing else.

1. In a terminal at `C:\dev\SkynetOS`:

   ```
   npm run boot
   ```

   This builds with electron-vite and starts the build. A SkynetOS already open hands over to the
   new one (`src/main/services/instance.ts`), so you do not need to close anything first.

   **You should see:** the old window close, a new one open on the root board, and one line
   appended to `%APPDATA%\SkynetOS\boot.log` reading `build ok; started SkynetOS, pid …`.

   **If the build fails:** the log line says `build FAILED (…) — starting the last good build`
   and the previous build starts instead. That older build may lack the panel. Run
   `npm run build:app` on its own and read the error.

   **If you are running `npm run dev` instead:** the renderer half hot-reloads but the main
   process does not. Stop it and use `npm run boot`, or restart `npm run dev`.

---

## 2. Turn remote on: LOOK → System → REMOTE

1. On the board, press **`L`** (or open the palette and choose LOOK). The LOOK panel opens with
   sections down the side: `Audio · microphone and voice`, `Video · cameras and gestures`,
   `System`, `Board colour`, `Vignette`, `Background`, `Recommendations`, `Away`.
2. Open **System**. Under the `Start SkynetOS with Windows` and `JARVIS face windows` switches
   there is a note `REMOTE: this board on your phone, tablet or another computer.` and, below it,
   the REMOTE panel.

   Note: the Settings panel (`Ctrl+,`) shows the System switches but **not** the REMOTE panel.
   It lives in LOOK only (`src/renderer/ui/BoardLook.tsx:265-267`).

3. Tick **`Allow remote devices (phone, tablet, another computer)`**.

   **Before ticking, the note under it reads:**
   `Off. When on, SkynetOS listens on this PC only (127.0.0.1); devices reach it through Tailscale and must pair with a one-time code.`

   **After ticking, within a second:**
   `Listening on http://127.0.0.1:47821/ · 0 connected`

   and a **`PAIR A DEVICE`** button appears, plus a warning (expected at this point, read on):
   `Not published to your tailnet yet, so a QR code will only work on this PC. Press PUBLISH TO MY TAILNET first.`

   and, at the bottom, the Tailscale line:
   `Tailscale: this PC is william-desktop.<tailnet>.ts.net · not published yet.`

   and a **`PUBLISH TO MY TAILNET`** button.

   **If the switch snaps back and a toast says `COULD NOT START REMOTE` or the note reads
   `COULD NOT LISTEN ON 127.0.0.1:47821 — …`:** something else holds the port. See
   troubleshooting §9.6.

   **If a warning says `No built renderer to serve yet. On this PC: npm run build:app`:** the
   `out/renderer` folder is missing. Run that command, then untick and re-tick the switch.

   **If the Tailscale line says `Tailscale is installed but not connected on this PC. Open it and
   sign in.`:** open the Tailscale tray icon and connect. The panel re-reads Tailscale every
   20 seconds; it refreshes itself every 4 seconds, so wait for it rather than reopening.

   What the tick did: it wrote `remoteEnabled: true` to `settings.json` and started an HTTP
   server bound to `127.0.0.1:47821`. Only this PC can reach that address. Untick it and the server
   stops and any open connections are closed.

---

## 3. Publish to your tailnet

This is the step that lets your phone reach the port. It runs one Tailscale command; SkynetOS
asks first.

1. Press **`PUBLISH TO MY TAILNET`**. Its tooltip reads: `Runs \`tailscale serve\` so devices on
   your tailnet reach this server over HTTPS. Asks first.`

2. A native dialog opens, titled **`Publish SkynetOS to your tailnet?`**:

   > Run `tailscale serve --bg http://127.0.0.1:47821`?
   >
   > This changes your Tailscale configuration: devices signed in to YOUR tailnet (your iPhone,
   > iPad, laptop) can reach SkynetOS at https://<this-pc>.<tailnet>.ts.net, which Tailscale
   > forwards to 127.0.0.1:47821 on this PC.
   >
   > Nothing is exposed to the public internet. A device still has to pair with a one-time code
   > before it can do anything.
   >
   > To undo it later: tailscale serve reset

   Buttons: **`Publish to my tailnet`** and **`Cancel`**. Cancel is the default (Enter cancels),
   so click the first button deliberately.

3. **You should see:** a toast `published to your tailnet`, the warning under PAIR A DEVICE gone,
   and the Tailscale line now reading
   `Tailscale: this PC is william-desktop.<tailnet>.ts.net · published to your tailnet.`

   To double-check outside SkynetOS:

   ```
   tailscale serve status
   ```

   should print an `https://william-desktop.<tailnet>.ts.net` entry proxying to
   `http://127.0.0.1:47821`. The panel reads exactly that output and only counts it as published
   when it names `127.0.0.1:47821`.

   **If the toast says `TAILSCALE SERVE FAILED` followed by Tailscale's own words:** the first
   three lines of Tailscale's error are in the toast. The usual causes:

   - **HTTPS is off for the tailnet.** The panel would already have said
     `Tailscale also has no HTTPS certificate for this tailnet: turn on HTTPS Certificates in the
     Tailscale admin console under DNS, then press PUBLISH.` On this PC it is on, but to check or
     fix it: open https://login.tailscale.com/admin/dns, and under **HTTPS Certificates** press
     **Enable HTTPS**. MagicDNS must be on in the same page (it is). Then press PUBLISH again.
   - **`serve` needs a newer Tailscale.** This PC has 1.102.4, which has `serve --bg`. On an
     older install, update Tailscale from the tray icon.
   - **Tailscale asks for an operator.** On some Windows installs the CLI answers
     `Access denied: … need to be the operator` for `serve`. Run the command it suggests once in
     an Administrator PowerShell, `tailscale set --operator=<your Windows username>`, then press
     PUBLISH again. (Not seen on this PC; listed because the CLI can say it.)

   **If the dialog never appears:** the button is only shown when Tailscale is running and the
   server is listening; if you ticked the switch and the button is not there, read the Tailscale
   line for what it wants.

   What this changes: Tailscale's own config on this PC, persistently (it survives reboots and
   SkynetOS restarts). It is `serve`, never `funnel`: only devices signed in to your tailnet can
   resolve or reach the name. `tailscale serve reset` undoes it (§10).

---

## 4. Pair the iPhone

Before this step, on the iPhone: open the **Tailscale** app and make sure the switch at the top is
**on** (connected). It was online when this PC was read. Away from home, the iPhone needs
Tailscale connected on mobile data too; that is the whole point of the VPN.

1. On the PC, press **`PAIR A DEVICE`**.

   **You should see:** a QR code (black modules on a white square), an 8-character code in the
   form `ABCD-EFGH` (no 0/O or 1/I/L, so it survives being read aloud), a line
   `One use · expires in 4:59` counting down, the line
   `Scan with the device's camera, or open one of these and type the code:` and two addresses:

   - `https://william-desktop.<tailnet>.ts.net/` (the one the phone uses)
   - `http://127.0.0.1:47821/` (works on this PC only; that is how the smoke test pairs)

   The button now reads **`NEW CODE`**. Pressing it retires the old code and makes another; only
   one code exists at a time, and it lives in memory only.

   **If only the `http://127.0.0.1:47821/` line appears:** publishing did not take. The QR code
   would then point at an address the phone cannot open. Go back to §3.

2. On the iPhone, open the **Camera** app and point it at the QR code. Tap the yellow link it
   offers. Safari opens `https://william-desktop.<tailnet>.ts.net/#pair=ABCD-EFGH`.

   **You should see:** a card titled **`SKYNETOS · REMOTE`**. Because the code is in the URL,
   the page pairs by itself on arrival; you may only glimpse the form. If it does show, the form
   has: the note `On the PC: LOOK → SYSTEM → REMOTE → PAIR A DEVICE. Scan its code, or type it here.`,
   a **Pairing code** field (already filled), a **This device** field (pre-filled `iPhone`; change
   it if you like, up to 40 characters, and it is the name the PC lists), and a **`PAIR`** button.
   Then `CONNECTING TO SKYNETOS…`, then the board.

   On the PC at the same moment: the code disappears from the panel, the device list shows
   `iPhone · seen <date and time>` with a **`REVOKE`** button beside it, and the status line reads
   `Listening on http://127.0.0.1:47821/ · 1 connected`.

   **If Safari shows nothing or "cannot connect to the server":** the phone cannot reach the name.
   Check the Tailscale app on the phone is connected, then open
   `https://william-desktop.<tailnet>.ts.net/` by hand. If that fails but `http://100.x.y.z`
   style addresses are also unreachable, the phone is not on the tailnet; if the name fails and the
   IP works, MagicDNS on the phone is off (Tailscale app → settings → Use Tailscale DNS).
   Note there is no plain-IP route to SkynetOS by design: the server only answers a `Host` of
   `localhost`, `127.0.0.1`, `*.ts.net`, or a name in `remoteAllowedHosts`, so an IP in the address
   bar gets `misdirected request` (HTTP 421). Use the name.

   **If the card says `THAT CODE IS WRONG OR EXPIRED — make a new one on the PC`:** the five
   minutes passed, or the code was already used, or it was mistyped. Press NEW CODE on the PC and
   scan again. Ten wrong codes within ten minutes turn remote off on the PC (§9.2).

   **If the card says `CANNOT REACH SKYNETOS — …`:** the page loaded but `POST /pair` failed:
   the PC's server stopped between loading the page and pairing. Check the switch is still ticked.

   **If the board appears but a strip at the top says `OFFLINE — RECONNECTING TO SKYNETOS…`:**
   the WebSocket did not come up after the page did. The most likely cause on a real phone, since
   this has not been tried outside this PC, is the Origin check: the socket's `Origin` must equal
   the page's `Host`, which depends on `tailscale serve` passing the tailnet name through
   unchanged. Read the PC's console for `[remote]` lines; a refused upgrade shows nothing on the
   phone but the strip. Tell JARVIS; the fix is in `hostAllowed`/`originMatchesHost`
   (`packages/shared/remote.ts`), not on the phone. The page retries by itself, with backoff up to
   15 seconds.

3. **Add it to the Home Screen.** In Safari: the Share button → **Add to Home Screen** → Add. The
   page declares `apple-mobile-web-app-capable`, so it opens full screen without Safari's bars.

   **Expect to pair once more from the Home Screen icon.** The device token is kept in the page's
   localStorage for that origin, and iOS gives a Home Screen web app its own storage, separate from
   Safari's. So the icon most likely opens on the `SKYNETOS · REMOTE` card again: press NEW CODE on
   the PC and type it (or scan from the Camera app, which reopens Safari, so type this time). The
   PC will then list two devices, `iPhone` twice; revoke the one whose `seen` time is older. This
   is a prediction from how iOS treats standalone web apps, not something that has been observed
   here.

---

## 5. Pair the iPad

1. On the iPad: App Store → **Tailscale** → install → open → sign in with the same account the PC
   uses (Google, `williamsfischer2002@`) → turn the switch on. The iPad appears in
   `tailscale status` on the PC as a new row.
2. Repeat §4. The **This device** field pre-fills `iPad`. Nothing on the PC side needs redoing:
   the publish is per PC, not per device.

---

## 6. A Mac, or a second Windows PC

1. Install Tailscale from https://tailscale.com/download and sign in with the same account.
2. On the PC, press **`PAIR A DEVICE`** (or **`NEW CODE`**).
3. On the other computer, in any browser, open the `https://william-desktop.<tailnet>.ts.net/`
   line from the panel. Type the code into **Pairing code**, name the device (it pre-fills `Mac`
   or `Windows PC`), press **`PAIR`**.

   The layout stays the desktop layout unless the window is 820 px wide or narrower or the
   pointer is a touch pointer, in which case the phone layout (bottom sheets, larger targets)
   applies. Narrow the window to get it deliberately.

A second desktop that has its own SkynetOS is a separate question: this guide connects a browser
to THIS PC's board. Two PCs each running SkynetOS do not sync (docs/06 "out of scope").

---

## 7. Check that it really works

1. **The device list.** In LOOK → System → REMOTE, each paired device is one row:
   `<name>   seen <date, time>   REVOKE`. A device that paired but never opened the socket shows
   `never connected`. The status line counts open sockets: `· 1 connected`.
2. **The audit log.** `%APPDATA%\SkynetOS\remote-audit.log`, one JSON line per pairing and per
   call: `at`, `device` (the id, not the name), `channel`, `ok`, and `error` when it failed. It
   never records arguments, so prompts and paths are not in it. After a successful pairing it has
   `{"channel":"pair","ok":true}`; after the board loads, `board:load` and `board:list` rows follow.
3. **A first action from the phone.** Tap a room (MinecraftOS) to descend. Tap the corner prompt
   and send a line to the Face: that lands in your claude.ai conversation exactly as from the PC,
   without files. Then tick a phantom: the plate should turn into a real node on the PC too, and
   Ctrl+Z on the PC undoes it (the phone's edits sit in the same undo history as actor `remote`).
4. **On mobile data.** Turn Wi-Fi off on the phone, reload. If the board still comes up, the
   tailnet is doing its job and nothing on your home network is involved.

---

## 8. What the phone cannot do (by design, so you are not surprised)

These are allowlist rules in `REMOTE_METHODS` (`packages/shared/ipc.ts`) and the remote guards in
`src/main/ipc.ts`. Each fails with a sentence in a toast rather than silently.

| Tried from the phone | What happens |
|---|---|
| Delete a node, edge or room | Refused: `DELETIONS ARE CONFIRMED ON THE DESKTOP — remote cannot approve a destructive edit yet`. Undo still works from the phone |
| Open a file or program on the PC (double-tap a file node, a repo, an exe) | `NOT AVAILABLE FROM A REMOTE DEVICE — do "node:open" at the PC` |
| Anything that would raise a dialog on the PC (a launch confirmation, a file picker) | `CONFIRM ON THE DESKTOP — … asks a question on the PC's screen, which cannot be answered remotely` |
| Change settings, autostart, elevation, the face windows, or anything in the REMOTE panel itself | Not in the allowlist; the REMOTE panel does not even render on a remote page |
| Attach files to a prompt | The phone's files are not paths on the PC; attachments are silently empty. Text goes through |
| Drag a file out to another app | Drag badges are hidden on a remote page |

What it **can** do: read every board and room, move and edit nodes and wires (undoably), add and
paste nodes, send to the Face, PROMPT → NODE, the mailbox, Summon JARVIS onto a node, start and
stop sessions and services, tick and cross phantoms (as you, not as an agent), run a scheduled
task now, put the app to sleep and wake it, and browse the file explorer's listing.

---

## 9. Troubleshooting

**9.1 `OFFLINE — RECONNECTING TO SKYNETOS…` strip on the phone, page otherwise fine.**
The socket was refused or dropped. On the PC's console look for `[remote]` lines. Causes, in
order of likelihood: SkynetOS restarted (wait: the page retries with backoff up to 15 s and queues
what you tapped); the switch was unticked; or the Origin/Host mismatch described in §4 step 2. The
socket must also authenticate within 5 seconds of opening (close code 4401 otherwise); a very slow
link could hit that, and the page simply retries.

**9.2 The switch has unticked itself.**
Ten wrong pairing codes or wrong device tokens within ten minutes turn remote off, and the console
logs `[remote] too many bad codes or tokens: turning remote off`. Tick `Allow remote devices` again.
The window is sliding, so wait a few minutes if it trips again at once. (Until 2026-09-23 only bad
pairing codes counted; a bad token now counts too, as docs/07 always said.)

**9.3 The phone says `THIS DEVICE IS NOT PAIRED, OR WAS REVOKED — reload to pair again`.**
Its token was revoked on the PC (or `remote-devices.json` was removed). The page forgets the token.
Reload, and pair with a new code.

**9.4 REVOKE on the PC toasts `<name>: REVOKED UNTIL SKYNETOS RESTARTS, BUT THE DEVICE LIST COULD
NOT BE SAVED, SO IT WOULD COME BACK — …`.**
The device is cut off now (its socket is closed with 4403 whatever else happened), but
`remote-devices.json` could not be written. Fix what the message names (a locked file, a full
disk), then press REVOKE again on the same row to settle the write, or untick the switch.

**9.5 `TAILSCALE SERVE FAILED`, or `Tailscale also has no HTTPS certificate for this tailnet`.**
See §3. Admin console → DNS → HTTPS Certificates → Enable HTTPS. The panel reads `CertDomains`
from `tailscale status --json`; once that lists this PC, press PUBLISH again.

**9.6 `COULD NOT LISTEN ON 127.0.0.1:47821 — …` under the switch.**
Another program has the port. Find it:

```
netstat -ano | findstr 47821
```

Either stop that program, or change the port: `remotePort` in `%APPDATA%\SkynetOS\settings.json`
(there is no switch for it in the app), then restart SkynetOS and publish again, because the
serve config names the old port.

**9.7 `tailscale` is not recognised in a terminal.**
SkynetOS looks for it on PATH and then at `C:\Program Files\Tailscale\tailscale.exe`; the panel
would say `Away from home: install Tailscale on this PC and on the device (tailscale.com/download),
signed in to the same account.` if neither existed. For your own terminal, use the full path or
add that folder to PATH.

**9.8 The QR code will not scan.**
It is drawn at 4 px per module. Zoom the LOOK panel (the app's zoom, Ctrl+wheel, scales it as whole
pixels), or type the code: dashes, spaces and case do not matter.

**9.9 Everything works at home and not on mobile data.**
The phone's Tailscale is disconnected, or your carrier blocks the VPN. Open the Tailscale app;
its switch must be on and the PC must be listed as online.

**9.10 The panel says `Reading…` forever.**
`remote:status` is not answering. That is the pre-restart case (§1) or a main-process fault; the
console will say.

---

## 10. Turning it off, and revoking

- **A device:** LOOK → System → REMOTE → **`REVOKE`** on its row. Its open connections close at
  once with code 4403, its token is refused from then on, and the row disappears. The toast reads
  `<name> can no longer connect`. The phone shows §9.3.
- **Remote altogether:** untick **`Allow remote devices`**. The server stops, every socket closes
  with 1001, and the pending pairing code is cleared. Paired devices are remembered (as token
  hashes) for when you turn it back on.
- **The tailnet publish:** in a terminal,

  ```
  tailscale serve reset
  ```

  removes the serve config. Devices then cannot even load the page. The panel's Tailscale line
  goes back to `· not published yet`.
- **Nothing to clean on the phone** beyond deleting the Home Screen icon; the token it holds is
  useless once revoked.

---

## 11. Claude Code Remote Control: a session on your phone, not just the board

SkynetOS's remote puts the **board** on the phone. A running agent's terminal is a console window
on the desktop and does not travel. Claude Code has its own feature for that, **Remote Control**,
and it works without any of the above: it is outbound HTTPS from the `claude` process to
Anthropic, and the Claude app (or claude.ai/code) signed in as you shows the session.

1. Open the node editor on an `agent.code` chip (JARVIS Prime, for instance), section **Session**,
   and tick **`Reachable from my phone`**. Its help reads: `On: the session starts with Claude
   Code's Remote Control, named after this node. Open the Claude app on a phone or claude.ai/code,
   signed in as you, to read it, type to it and answer its permission prompts. The terminal must
   stay open on this PC. Takes effect at the next launch.`
2. Launch the chip. The command line gains `--remote-control "<designator> <name>"` (read from
   `claude --help` on this machine, CLI 2.1.278; held by `test/sessions.test.ts`).
3. In the Claude app on the phone, open the sessions list; the session appears under the chip's
   own label. You can read it, type to it, and **answer its permission prompts** from there, which
   is you answering them from another room.

Rules that stay true: an agent gains nothing by setting the flag, because the grant is your
Anthropic login; a chip set to launch elevated is still refused for a scheduled run; and the hard
off is `"disableRemoteControl": true` in `~/.claude/settings.json`, which is not set on this PC.
Not tried on a phone yet either.

Combined, the two give you: the board and its controls through Tailscale, and each terminal's
conversation through Anthropic, from one phone.

---

## Reference: the numbers

| | |
|---|---|
| Port | 47821 (`remotePort` in settings.json) |
| Bind address | 127.0.0.1 only, never a LAN address |
| Pairing code | 8 characters from `ABCDEFGHJKMNPQRSTUVWXYZ23456789`, single use, 5 minutes, memory only |
| Device token | 256-bit; the PC stores its SHA-256 in `%APPDATA%\SkynetOS\remote-devices.json`; the phone stores it in localStorage |
| Lockout | 10 bad pairing codes or device tokens in 10 minutes turns remote off |
| Socket auth | must arrive within 5 s of opening; 4401 otherwise; 4403 for a bad or revoked token |
| Call timeout | 60 s, then `SKYNETOS DID NOT ANSWER "<channel>" IN 60 s` |
| Reconnect | automatic, backoff doubling to 15 s, calls queued while offline |
| Largest message | 1 MB |
| Panel refresh | every 4 s; Tailscale re-read every 20 s |
| Hosts answered | `localhost`/`127.0.0.1` on the port, any `*.ts.net`, plus `remoteAllowedHosts` (settings.json, for a Cloudflare Tunnel fallback) |
| Audit | `%APPDATA%\SkynetOS\remote-audit.log`, no arguments ever |
