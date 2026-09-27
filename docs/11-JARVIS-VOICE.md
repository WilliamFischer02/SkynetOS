# 11 — JARVIS Voice: the hologram, speech, voice profiles, and desktop control

William, 2026-09-24: "a launch-on-boot fully voice controlled mini program … 'Jarvis, open after
effects on one and firefox on two' … open my most recent project in after effects and open my
hotmail in firefox … I'd want to see it move the mouse … a small square window that opened on
windows startup and that minimized on close … a blue hologram version of what siri's visual looks
like, a sort of audio reactive sphere … talk back … a 'train' button … 'record' their actions on the
desktop … agentic … connect a claude api." And then: "I will do an impression myself, reading the
lines, and it will be a dataset I want the program to be able to 'train' on … since the dataset is
my voice, I can consent to its use."

This document is normative for how it is built. Rules are in docs/07 § JARVIS Voice. What exists
today is marked; what does not is marked too, and nothing below pretends otherwise.

---

## The shape of it

```
  "Jarvis, open after effects on one and firefox on two"
        │
        ▼
  WAKE SIDECAR (System.Speech, closed grammar)          existing, docs/07 § Voice
        │  WAKE 0.87 jarvis
        ▼
  CAPTURE WINDOW (one sentence, microphone only)        existing
        │  wav → whisper-server on 127.0.0.1
        ▼
  voice:heard {text}  ──────────────►  the BOARD window: resolveIntent → actOnIntent
        │                                     │
        │                          desktop intent? ──► desktop:run (main) ──► DESKTOP HELPER
        │                                     │            step by step,           (user32, SendInput)
        │                                     │            desktop:state pushed     launches, places,
        │                                     ▼                                     moves the mouse
        │                          one line of reply ──► speech:say (main) ──► SPEECH SIDECAR
        │                                                                          (System.Speech, or
        ▼                                                                           the profile server)
  HOLOGRAM WINDOW  ◄── voice:state · voice:wake · voice:heard · speech:state · desktop:state
  a square, always up when enabled, close = minimise, opens with SkynetOS (which opens with Windows)
```

**Three streams, one view.** The hologram window owns nothing that hears, speaks or moves. It is
a view over the voice pipeline (which already exists and whose microphone rules do not change), the
speech service, and the desktop helper. That is why it can be on screen all day without opening a
microphone: the sphere reacts to what the wake sidecar, the capture window, the synthesiser and the
helper report, not to a live mic.

**The board window still decides.** A sentence, spoken or typed into the hologram, goes to the board
window as `voice:heard`, where `resolveIntent` already lives. Desktop commands are one more kind of
intent there. Nothing is re-implemented in the small window.

**Launch on boot** is SkynetOS's own start-with-Windows switch (docs/06 M10, `npm run autostart:on`)
plus `hologram.enabled`. There is no second program to register.

---

## The window

- Square, `hologram.size` DIPs (240 by default), frameless, on the taskbar, `alwaysOnTop` by
  setting. Bottom-right of the primary display's work area by default; it remembers a drag.
- **Close is minimise.** The X minimises; the app quits from the board or the tray as before.
- Drawn like the board: a small canvas scaled by a whole number, nearest-neighbour, a limited
  palette, ordered dither, no filters. The "blue analog hologram" is six blues from near-black to
  white-cyan, latitude rings, scanlines drawn as pixels, and an occasional one-frame flicker.
  `prefers-reduced-motion` stills it.
- Moods, in precedence order (`moodFrom` in `packages/shared/hologram.ts`): `fault` (amber, still),
  `acting` (an orbiting dot and the step's text), `speaking` (the radius follows the word pulses),
  `listening` (rings expand from the centre), `thinking` (a band sweeps), `idle` (a slow breath),
  `off` (dim).
- One ALL-CAPS state line: READY · LISTENING · the sentence heard · what was said or done · the
  fault and what to do. Under `streamMode` the sentence is not shown.
- Controls, every one with a keyboard path: **MIC** (voice on/off), **SPEECH**, **DESKTOP** (the
  switch that lets it move things; its label says so), a text box (Enter sends the line down the
  spoken path), **TRAIN**, and minimise. **Esc** halts the desktop helper and stops speech.
- It may call only `HOLOGRAM_ALLOWED` (packages/shared/ipc.ts): status reads, the three switches,
  `voice:typed`, `speech:say`/`stop`, the profile recorder, and `desktop:halt`. It cannot run a
  plan, edit the board, open a file, or start a session.

**Built 2026-09-24.** Not yet seen on screen.

### The tray icon (M13.5, built 2026-09-27)

A second home for the board and this window when both are minimised. `src/main/services/tray.ts`,
created at app ready (not during a smoke capture). The icon is the JARVIS orb in this window's six
blues on transparent, 16 px and 32 px (`npm run icon:tray` → `assets/tray/`, checked in; an install
reads `resources/assets/tray/`); Windows takes the one that matches the display scale. Tooltip
**SkynetOS**. Left click shows, restores and focuses the board. Right click, built fresh each time
(`trayMenuTemplate` in `packages/shared/tray.ts`): **Open board**, **JARVIS Voice** (`openHologram`),
**Voice** ✓, **Desk control** ✓, ─, **Start with Windows** ✓, ─, **Quit** (`app.quit()`, the same
will-quit path as closing the board, which now quits explicitly). The checkboxes call the same
main-side functions as the user-only switches; the tray adds no channel. `tray.minimizeToTray`
in settings.json (default false) hides the board on minimise instead of putting it on the taskbar,
only while the tray exists. An icon that will not load is logged; the tray still works.

---

## Speech

`src/main/services/speech.ts`, types in `packages/shared/speech.ts`. Two backends, one switch.

| Backend | What it is | State |
|---|---|---|
| `sapi` | Windows' own synthesiser, System.Speech in a PowerShell sidecar. Uses whichever voice `speech.voice` names, else the best en-GB male installed, else the first voice. Reports word boundaries, which is what the sphere breathes to | Built 2026-09-24. This PC has only David, Zira and Mark; an en-GB voice is an add-on: Settings → Time & Language → Speech → Add voices → English (United Kingdom) |
| `server` | A synthesis server on 127.0.0.1 that takes `{text, profile}` and answers a WAV, played through the same sidecar. The profile is William's own voice (below) | The client side is built; no server is installed. `speech:status` says so and `say` falls back to `sapi`, so JARVIS is never mute |

What JARVIS says is composed, not generated: `replyFor(plan, result)` in
`packages/shared/desktop.ts` for desktop work, and the one-line result `actOnIntent` already returns
for board work. Register per `codex/personas/jarvis-voice.md`: answer first, one clause of
qualification, failures like weather, no exclamation marks, "sir" about one turn in four. A model
(slice 2) may compose a reply; it may not speak one directly, because `speech:say` is user-only.

**Not a cloned voice.** The first brief asked for a voice trained on Paul Bettany's lines. That is
a real person's voice taken without his consent, and it is not built, private use or not. William's
amendment replaces it: he records the lines himself.

---

## Voice profiles

A profile is a dataset of William reading `PROFILE_LINES` (forty short lines in the register, in
`packages/shared/speech.ts`), recorded in the hologram window's TRAIN panel one line at a time, and
stored under `%LOCALAPPDATA%/SkynetOS/voice-profiles/<name>/`: `profile.json` and one WAV per line
(16 kHz mono, what the capture window already encodes). It is per machine and never in the repo.

- **Recording** goes through the existing capture window (`voice:record`), so the microphone rules
  hold: a line is captured only on a RECORD press, for at most 15 s, and written to the profile
  folder and nowhere else. It is the one WAV written to disk besides `warmup.wav`, and docs/07 says
  so. Voice must be ON, because the capture window exists only then.
- **Training** is the synthesis server's own job, not SkynetOS's. `profile.json` carries `trained:
  null` until a server-side tool fits a model and writes `{at, model}` back. SkynetOS never runs a
  training job unattended and never uploads a recording anywhere.
- **Which server.** Two shapes fit the contract; both run on this PC's GPU, both are William's to
  install (a download, his click):
  1. **Reference-clip synthesis** (F5-TTS or a similar zero-shot model): no training step; the
     profile's recorded lines are the reference, so a profile is usable the moment a few lines are
     recorded. Quality tracks the reference clips.
  2. **Fine-tuned synthesis** (GPT-SoVITS or a similar fine-tunable model): a training step over
     the forty lines produces a model that speaks the register more consistently. Slower to set up,
     better in the end.
  **Chosen 2026-09-24: shape 1 first, with F5-TTS.** It needs no training step, so a profile speaks
  as soon as one clip with a transcript exists, and William's existing samples can be the reference
  today. Shape 2 remains open for a later, more consistent voice.

### Installing the synthesis server (M13.2, built 2026-09-24)

| Step | Command | What it does |
|---|---|---|
| 1 | `npm run speech:install` | Makes a Python 3.10 venv at `%LOCALAPPDATA%/SkynetOS/voice/tts/venv`, installs torch and torchaudio from the CUDA 12.8 index (an RTX 50-series needs those wheels) and F5-TTS. About 4 GB. `-- --check` only reports |
| 2 | `npm run speech:serve` | Runs `tools/speech-server.py` on 127.0.0.1:47832: `GET /health`, `POST /synthesize {text, profile}` → WAV. The first synthesis fetches the model weights (about 1.3 GB) into the Hugging Face cache. SkynetOS starts the same server itself when `speech.backend` is `server` |
| 3 | `settings.json` → `"speech": { "backend": "server", "profile": "william" }` | JARVIS speaks with the profile; when the server is down it falls back to Windows' voice and says so |

The server picks, from the profile, the longest line **with a transcript** between 2 and 15 s as
the reference, and speaks the requested text in that voice. No line with a transcript, no voice:
the answer is a sentence naming the profile, and Windows' voice is used.

### Importing samples William already has

`%LOCALAPPDATA%/SkynetOS/voice-profiles/<name>/import/` is the drop folder, or any folder named as
the second argument (`voice-profiles/` inside the repo is gitignored for this; the profile itself
always lives under `%LOCALAPPDATA%`). `npm run profile:import -- <name> [folder] [--transcribe]`
(`tools/profile-import.ts`) decodes AIFF and WAV with the repo's own decoder
(`packages/shared/aiff.ts`; no ffmpeg on this machine, no dependency added), mixes to mono,
resamples to 16 kHz, trims silence, refuses clips under 0.5 s or over 30 s, writes
`line-import-<nn>.wav` and adds an imported line to `profile.json`. Transcripts come from a
`transcripts.txt` beside the clips (`file<TAB>text`), or from whisper-server with `--transcribe`,
or are typed later in the TRAIN panel, which marks a line NEEDS A TRANSCRIPT until then. Originals
are never modified or deleted; nothing is uploaded. Still open: the training trigger for shape 2.

---

## Desktop control

`src/main/services/desktop.ts`, rules in `packages/shared/desktop.ts`, a separate helper process.
Rules in docs/07 § Desktop control.

- **Off by default.** `desktop.enabled` is written only by the user-only `desktop:setEnabled`: the
  DESKTOP switch in the hologram window, or the file. With it off, every plan is refused with a
  sentence, which is shown and spoken.
- **A plan is a list of steps** (`DesktopStep`): `launch` (a catalogue entry, on a monitor, with a
  layout), `place`, `focus`, `url` (in a browser from the catalogue), `mouse` (travels visibly,
  then clicks), `keys` (text, or a combination; `alt+f4` is refused), `wait`, `say`. At most 12
  steps; `desktop:state` is pushed per step; Esc, "stop" or the switch halts between steps.
- **The catalogue is the Start Menu**: every `.lnk` under the user's and the machine's
  `Start Menu\Programs` (299 on this PC), plus `settings.desktop.apps`. `launch` names an entry
  and nothing else; there is no step that runs an arbitrary path or command. Installing a program
  is how William consents to its being launched by voice.
- **Monitors are numbered** primary first, then left to right, unless `settings.desktop.monitors`
  names an order. "one", "two", "three" are those numbers. This PC: DISPLAY3 (primary) is one,
  DISPLAY1 is two, the portrait DISPLAY2 is three.
- **Sentences understood today** (`parseDesktopCommand`): `open <app> on <n>` with `and`,
  `move <app> to <n>`, `open <site> in <browser>`, `open <site>` (hotmail/outlook, gmail, youtube,
  github, claude, reddit, x, chatgpt). "Open the stalker" still opens the board node: the desktop
  rule fires only when a catalogue app or a site matches.
- **The helper** is its own PowerShell sidecar with user32 `SetWindowPos`, `ShowWindow`,
  `SetForegroundWindow`, `SetCursorPos` and `SendInput`. The window TRACKER (`window-tracker.ts`)
  stays read-only and untouched; `test/avatar-window.test.ts` holds it there.

**Built 2026-09-24.** Not yet run against the desktop; the first plan runs with William watching.

---

## Conversation: a reply, then the next sentence (built 2026-09-24, evening)

William, after the first try: "it opened a U1 jarvis window in claude web and said nothing in
response to me - my goal is for instead, it to talk back to me conversationally and me to be able
to continue by saying my next command. No need for the claude web window to open."

Before this, a sentence that was not a board or desktop command was handed to the Face after 2.2 s
(`prompt:send`), which opened the claude.ai window and typed it there. That path is gone from the
voice pipeline. Now:

- **A sentence that is not a command gets a spoken reply from JARVIS himself.**
  `converse:ask` (user-only) runs headless Claude Code (`claude -p`, Haiku by default,
  `converse.model` in settings) with the persona's voice rules and the last few turns, trims the
  answer to one or two spoken sentences, logs the exchange to `userData/conversation.jsonl`, and
  speaks it through the speech service. The model composes a reply to William's own sentence; it
  cannot start speech on its own, open the Face, or act. When the model is unavailable, a composed
  line says so and what JARVIS can still do.
- **Then the microphone opens once more, without the wake phrase.** After JARVIS finishes speaking
  an answer (or reporting a command), and a 350 ms pause for the room, the capture window listens
  for one sentence with a 5 s silence limit. A sentence takes the normal path (a command, or another
  reply, and another follow-up); silence closes the window without transcribing anything, and the
  next sentence needs "Jarvis" again. The sphere shows LISTENING throughout. `voice.followUp:
  false` removes the window entirely. This is the one bounded exception to "nothing is transcribed
  before the wake phrase" in docs/07, and it is written there.
- **The Face is reached only on purpose:** "ask the face …", "tell the face …", "send that to the
  face" still go to the claude.ai window, and nothing else does.

## Slice 2: the planner (not built)

"Open my most recent project in After Effects" is not a rule; it needs a look at the screen. The
design:

- The board asks main for a plan: `desktop:plan {heard, context}` (a new user-only channel). Main
  gathers the window list, the monitors, the catalogue, the last N recordings for similar commands
  (slice 3), and a screenshot of the relevant monitor (`desktopCapturer`, saved under
  `userData/desktop/shots/`, kept 24 h), and runs **headless Claude Code** the way away mode does:
  `claude -p` with a fixed system prompt, `--allowedTools Read` so it can look at the screenshot,
  `--output-format json`, on the subscription, no API key in the repo. It answers with a
  `DesktopPlan` and one line to say.
- The plan is shown in the hologram's state line and RUN only after it is spoken ("Opening the
  last project, 'Titles v3', sir.") with a 1.5 s window to say "stop"; then it runs like any plan.
  The model never touches the helper: it writes steps, `runPlan` runs them under the same cap,
  the same switch, the same halt.
- A step the model cannot express (`launch` of something not in the catalogue, `keys` of
  `alt+f4`, a 13th step) is dropped by `normalisePlan` before anything runs, and the drop is said.
- **Why `claude -p` and not the API:** no key to store, the subscription already pays, away mode
  already proves the shape (`packages/shared/away.ts`), and `--strict-mcp-config` keeps it to the
  tools it is given.

## Slice 3: training on actions (built 2026-09-26 as TRAIN ACTION; this section was the design)

**What was built, and where it differs.** The button is TRAIN ACTION at the bottom of the DESK
panel, visible only while DESK is on (William's ask), not a TRAIN tab. Press once: the light goes on
and the helper records; press again: a temporary save screen (name, description, the steps in
plain lines, SAVE or DISCARD). Saved actions appear in the ACTIONS panel with PLAY and can be run
by voice: "Jarvis, do the morning setup". Each click records its UI Automation target (process,
window title, control name and type, position relative to the control), so a replay finds the
control by name today even when the window, a taskbar button or a bookmark has moved, and falls
back to window-relative and then screen coordinates, logging which tier it used. The recorder
pauses itself over sign-in windows. No screenshots are taken at clicks (the UIA target replaced
them). Rules in docs/07 § JARVIS Voice. Types `packages/shared/actions.ts`; service
`services/action-recorder.ts`; the helper's `record`, `recstatus`, `uiafind`, `wheel`, `fgtitle`
ops in `packages/shared/desktop.ts`. The "intelligence" that adapts a recording to a new
situation beyond those tiers is still the planner (slice 2): a recording is its worked example.

The original design, for the record:

The TRAIN panel's second tab: type or dictate a command, press RECORD, do it by hand, press STOP.

- The recorder is the desktop helper in a **watch** mode: it polls the cursor, the mouse buttons
  (`GetAsyncKeyState` transitions), the foreground window's title and process, and takes a
  screenshot at each click. Keystrokes are recorded as key names and typed text **only while the
  RECORD light is on**, and the recording is written to `userData/desktop/recordings/<id>.json`
  with its screenshots, never into the repo and never into a prompt without the command it belongs
  to. A recording is a worked example for slice 2, not a macro to replay: the planner reads it and
  writes steps for today's layout.
- Recording is user-only (`desktop:record`), refused while a plan runs, and the light is in the
  hologram window the whole time. There is no way to start it from a sentence.

---

## What William does to see it

1. Restart SkynetOS (`npm run boot`). Everything above is main-process.
2. `L` → System: **JARVIS Voice window** on. The square appears bottom-right. (Or set
   `hologram.enabled` in settings.json.)
3. In the window: MIC on (the existing voice engine starts; VOICE … then READY). SPEECH is on by
   default and speaks with David until an en-GB voice is installed.
4. Type `open firefox on one` in the box and press Enter, with DESKTOP still off: it is refused in
   words and speech. Then DESKTOP on, and again: Firefox opens on the primary display, filled, and
   JARVIS says so.
5. Say "Jarvis, open after effects on one and firefox on two."
6. TRAIN → VOICE PROFILE: a name, CREATE, read the line, RECORD, PLAY.

## The globe (built 2026-09-26; William: "a sentient 3D hologram globe, like Tony Stark's")

The window is 480 px (full monitor height in DESK mode) and the sphere is a hand-written WebGL2
renderer under `src/renderer/hologram/`: a gridded short-depth globe that never stops turning,
wisps as particle trails, the ordered dither kept as a post pass so it is still the same blue orb,
sharper. It listens to two streams of numbers: `speech:levels` while JARVIS speaks (eight
frequency bands bend the grid sideways, band by latitude; loudness stretches it vertically) and
`voice:levels` while the microphone is open. LISTENING is no longer crescents: the whole picture
brightens over 180 ms with a halo and falls back over 400 ms, so the microphone's state is never
in doubt. WARMING THE VOICE shows while the synthesis model loads after boot.

Around it orbit the things Claude Code has touched lately, as their own icons, and every file,
folder and program has a permanent home on the globe: a coordinate from a hash of its path
(`packages/shared/globe-atlas.ts`), remembered in `userData/globe-atlas.json` so it never moves.
The activity feed (`services/activity-feed.ts`) tails every Claude Code transcript on this machine
and decides what deserves the centre: a write beats a read, a document beats a folder, a focus
holds for at least 2.5 s and at most 12 s, a burst of forty reads shows four and drops the rest.
The chosen item travels in from its pin and "maximises": a document as a tall sheet of paper that
scrolls itself, code as a small terminal that types the change with a slight rove so it never
flickers, a model as a crude wireframe, a folder as a grid. The next item sends it back. Contracts:
`packages/shared/holo-scene.ts`; content builders `holo-content.ts`.

Every control has an id and a sentence (`packages/shared/hologram-control.ts`, docs § Voice
commands in intent.ts): "go to the train panel", "open the profiles dropdown", "turn off
talkback", "close yourself", "shut yourself down" (the program, never the machine; a sentence that
names the computer is refused), "stop" in its variants, "take dictation" (also `Ctrl+Alt+D`), "do
the morning setup". CLOSE (✕) closes the window and voice keeps running; shutdown closes it and
turns voice off.

## Still open

- The planner (slice 2, M13.3): the recorded actions are its worked examples now.
- The fine-tuned voice (M13.8): training ran on 2026-09-26; `apply` and a listen are next.
- Nothing above has been seen on a screen: the first `npm run boot` compiles the shaders.
- M13.9: page cache for long documents, diffs from tool inputs, model textures, a session picker.
