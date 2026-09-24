# 08 — Remote: SkynetOS from the iPhone, the iPad, a Mac or another PC

William, 2026-09-11, first: "a remote connection feature that allows me to interact with the
SkynetOS via my iPhone … as long as both my desktop and iphone has an internet connection and the
program is already running."

Then, later the same day: "a wireless and preferrably fully remote capable virtual link to my phone
that gives me full access to use the program within my desktop and control it from out of the house
on my iphone … remotely controllable via a mac desktop, windows desktop, ipad, or iphone … would
need to be able to remotely control a lot of the program's elements."

**Status: R1–R3 were built on 2026-09-11. Remote is off by default.**

It is tested three ways:
- unit tests;
- an integration test against a real socket;
- a smoke run that renders the board over the bridge in phone-sized and tablet-sized windows.

**It has not yet been tried on a real iPhone over Tailscale.** The milestone is M9 in docs/06. The
rules are in docs/07 §Remote devices, and the reasons are in DECISIONS 2026-09-11.

---

## The shape of it

```
iPhone · iPad · Mac · another PC   (Safari or any browser; "Add to Home Screen" on iOS)
   │  HTTPS + WebSocket (wss://), inside William's tailnet
   ▼
Tailscale   `tailscale serve` terminates TLS for <pc>.<tailnet>.ts.net; no open ports
   │  plain HTTP, on the PC only
   ▼
remote-server.ts   bound to 127.0.0.1:47821 ONLY
   │   GET /       the desktop renderer (out/renderer), its CSP rewritten for this host
   │   POST /pair  one-time code → device token
   │   /ws         JSON-RPC: auth, then calls; events pushed back
   ▼
callAsRemote (src/main/ipc.ts)   the REMOTE_METHODS allowlist, as actor `remote`
   ▼
the same ipcMain handlers the desktop window uses: command bus, sessions, mailbox, prompt, phantoms …
```

**The remote client is the desktop renderer.** Nothing is re-implemented for the phone:

- The server serves the same `out/renderer` bundle the desktop window loads.
- A page served that way has no preload script, so `src/renderer/remote/shim.ts` installs
  `window.skynet` itself. Every call becomes a WebSocket message, and every pushed event arrives at
  `skynet.on`.
- The board, the inspector, the corner prompt, the dock, phantoms, the mailbox and LOOK are the same
  code on every device. A feature built for the desktop reaches the phone the day it lands.

A small screen is a layout (§Mobile), not a second app.

### Why this route (and what was rejected)

| Option | For | Against | Verdict |
|---|---|---|---|
| **The desktop renderer, served over Tailscale** | Nothing exposed to the internet. End-to-end encrypted. Free for personal use. Works on any network, including mobile data. Real TLS through `tailscale serve`. No App Store. One UI for every device | Tailscale must be installed on the PC and on each device, once | **Built** |
| Cloudflare Tunnel + Access | No app on the phone; an email one-time code at the edge | A public hostname pointing at the desktop; a third party in the auth path; more to configure | **The fallback.** Add the hostname to `remoteAllowedHosts` |
| Screen streaming: Parsec, RustDesk, Chrome Remote Desktop | Works today with no code | A desktop-sized UI on a 6-inch screen with mouse semantics. Grants the whole desktop, not SkynetOS, and has no allowlist | **The stopgap** until the tunnel is set up |
| A separate phone app (a second Vite entry, this document's first draft) | A UI designed for the phone | Two UIs that drift apart. Every board feature built twice. A "Now" view is not the "full access" William asked for | **Rejected** 2026-09-11 |
| Port-forward the router | Nothing to install | A home desktop exposed to the internet, running a program that spawns shells | **Rejected** |
| A self-hosted relay (Vercel or Supabase realtime) | Full control, no VPN | The most code; a server to run and secure | Only if both tunnels fail |
| A native iOS app | Push notifications, widgets, Face ID | A developer account, Xcode, App Store review | R5, as a wrapper around this, if it earns it |

The deciding fact: this program opens terminals, launches agents and edits files. The only
acceptable network exposure is none. Tailscale gives the phone a private road to a door that still
only opens from the inside (127.0.0.1).

---

## The wire

One WebSocket per device, at `/ws`. It carries JSON text frames under RFC 6455
(`src/main/services/websocket.ts`), with a cap of 1 MB per message. The types and the parser are in
`packages/shared/remote.ts`.

- **Auth comes first, within 5 s.**
  - `{t:'auth', token}` is answered with `{t:'auth', ok:true, device}`.
  - A wrong or revoked token gets `{t:'auth', ok:false}` and close code 4403. The page shows
    NOT PAIRED and offers to pair again.
  - No auth in time, or anything else sent first, closes with 4401.
- **Calls:** `{t:'call', id, ch, args}` is answered with `{t:'result', id, ok, value | error}`. `ch`
  is an IPC channel name, exactly what the desktop's preload would send.
- **Events:** `{t:'event', event, payload}`, pushed to every connected device beside the desktop
  window's own `webContents.send`. The events are:
  - `sessions:changed`, `services:changed`, `files:changed`;
  - `avatar:changed`;
  - `away:state`, `away:log`;
  - `mail:dispatched`.
- **Keepalive:** `{t:'ping'}` is answered with `{t:'pong'}`.
  - The page reconnects by itself, with backoff up to 15 s.
  - It queues calls while offline.
  - A call gets 60 s before it fails.

---

## Security (docs/07 §Remote devices is normative)

1. **Off by default.** `remoteEnabled` is `false` in settings.json. Only the desktop's LOOK → REMOTE
   switch turns it on; no agent and no remote device can. 10 failed pairings or authentications in
   10 minutes turn it off again.
2. **Localhost only.** The server binds `127.0.0.1`: never `0.0.0.0`, never a LAN address. The tunnel
   is the only way in.
3. **Host and origin checks.** The server answers only these hosts:
   - `localhost` or `127.0.0.1` on its own port;
   - `*.ts.net`;
   - a host listed in `remoteAllowedHosts`.

   A WebSocket's Origin must match its Host. Together these close off DNS rebinding and cross-site
   sockets.
4. **Pairing, then a device token.**
   - PAIR A DEVICE shows an 8-character one-time code and its QR code. The code avoids look-alike
     characters, is valid for 5 minutes, works once, and is held only in memory.
   - The device trades the code at `POST /pair` for a 256-bit token.
   - `remote-devices.json` in userData keeps only the SHA-256 of each token.
   - The desktop's device list shows when each device was last seen. REVOKE closes that device's open
     connections at once with 4403, and refuses the token from then on.
   - Tokens never enter the repo (it is public), the board or the audit log.
5. **A new actor, `remote`.** Every command a device sends lands in the undo history as `remote`, so
   Ctrl+Z on the desktop undoes it. For phantoms it counts as William, so tick and cross work. It is
   never treated as `agent`.
6. **An allowlist, not a mirror.** `REMOTE_METHODS` in `packages/shared/ipc.ts`:
   - **Read:** boards and rooms, targets, settings (read only), usage, the hardware snapshot, models,
     mosaics, the away state, the command history.
   - **Talk:** send to the Face (`prompt:send`, without files), PROMPT → NODE, the mailbox.
   - **Work:**
     - add and paste nodes;
     - `command:apply`, undo and redo;
     - Summon JARVIS;
     - phantoms;
     - start and stop sessions and services;
     - a scheduled task's "run now";
     - sleep and wake;
     - the file explorer's listing.
   - **Never remote:**
     - settings writes, autostart and elevation;
     - the face windows;
     - opening files or programs on the desktop (`node:open`, and the shell and explorer opens);
     - pickers;
     - every `remote:*` channel.
7. **Nothing destructive, and no desktop dialogs.**
   - A DESTRUCTIVE `command:apply` from a device is refused, and `approved` is stripped.
   - A confirm or picker that a remote call would raise fails with CONFIRM ON THE DESKTOP instead of
     leaving a modal on an empty desk (`remote-context.ts`, using AsyncLocalStorage).
8. **An audit log without contents.** `userData/remote-audit.log` records the time, the device id,
   the channel, and ok or error. It never records arguments.

---

## Mobile

Two classes on the root element drive the layout:
- `html.compact` is set when the window is at most 820 px wide or the pointer is coarse, so a narrow
  desktop window gets it too.
- `html.remote` (with `data-remote="1"`) marks a page served over the bridge.

Every rule in `src/renderer/ui/mobile.css` is scoped to one of the two, so the desktop layout is
untouched.

- **Sheets.** The inspector is a bottom sheet over the lower 55% of the screen. These panels become
  full-width sheets from the bottom edge, up to 80% of the screen, scrolling inside themselves:
  - LOOK;
  - the palette;
  - the mailbox;
  - the plan dialog;
  - keys;
  - Summon;
  - the wire inspector;
  - the explorer.
- **Chrome.**
  - The HUD keeps zoom, the counts and faults.
  - The minimap and the key hint are hidden (pinch replaces the wheel).
  - The corner prompt and the session dock sit across the bottom edge.
- **Touch targets.** At least 44 px under a coarse pointer (Apple's minimum). Inputs are 16 px, which
  stops iOS zooming into a focused field.
- **The notch and the home bar.** Every element docked to an edge uses the safe-area insets.
- **On the board** (`src/renderer/board/touch.ts`):
  - one finger pans, through the existing pointer path;
  - pinch steps through the exact zoom levels, never a fractional one (docs/02);
  - long-press (550 ms) opens the right-click menu;
  - double-tap opens a node.
- **Remote only.**
  - Drag badges are hidden: a drag-out hands a PC file to the PC's own shell.
  - File attachments are empty.
  - The display scale is answered locally.

---

## Pairing a device

1. Install Tailscale on the PC and on the device, signed into the same account.
2. Restart SkynetOS. On the PC, press `L`, open SYSTEM → REMOTE and tick **Allow remote devices**.
3. Press **PUBLISH TO MY TAILNET** and confirm the dialog.
   - It runs `tailscale serve --bg http://127.0.0.1:47821`, which shares the port with William's own
     devices only. It never uses Funnel.
   - If Tailscale answers that HTTPS is off for the tailnet, turn on MagicDNS and HTTPS certificates
     in the Tailscale admin console, then press it again.
4. Press **PAIR A DEVICE** and scan the QR code with the device's camera. It opens
   `https://<pc>.<tailnet>.ts.net/#pair=CODE` and pairs itself. Alternatively, open that address and
   type the code.
5. On iOS, Share → Add to Home Screen gives a full-screen app.

`http://127.0.0.1:47821/` works on the PC itself, which is how the smoke test runs it.

---

## Milestones

| | Scope | State |
|---|---|---|
| **R0** | This document | Done |
| **R1** | Server on 127.0.0.1, pairing with QR, device tokens, the REMOTE panel, the switch, docs/07 rows | **Built 2026-09-11** |
| **R2** | The act allowlist, audit log, rate limits, sleep and wake | **Built 2026-09-11.** Photos from the camera roll into `prompt:send` are not |
| **R3** | The live board on the device, touch, the inspector | **Built 2026-09-11.** It is interactive, not read-only, because it is the same renderer |
| **R4** | Remote-driven sessions run headless with stream-json, streamed to the phone with follow-up prompts | Not started. **Covered another way since 2026-09-21:** an `agent.code` node with `remoteControl: true` starts its session with Claude Code's own Remote Control, and the Claude app on the phone reads and drives it. SkynetOS starts the session; Anthropic's app carries the conversation. docs/07 "Sessions from the phone" |
| **R5** | Optional native wrapper: push notifications for away reports, failures and finished builds; Face ID | Not started |
| — | Deleting from a phone, behind a second confirmation on the phone | Not started; refused until then |

**Exit for M9:** on mobile data, summon JARVIS onto a node from the phone, watch the terminal open
on the desktop, and read the away report while it works. This has not been run yet.

## Still open

1. **Photos from the phone into a prompt.** They are not files on the PC's disk, so the PC needs an
   upload path for them, with a size cap.
2. **Session transcripts.** Should the phone see them (R4), or only states and summaries, as now?
