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

- `hologram.size` DIPs (a 480 square by default, resizable 320–1600 a side since 2026-09-27),
  frameless, on the taskbar, `alwaysOnTop` by setting. Bottom-right of the primary display's work
  area by default; it remembers a drag.
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

**Resizable (2026-09-27; William: "trouble scaling the jarvis voice window … its buttons are quite
squashed").** The window is frameless with `thickFrame`, so Windows' own resize borders work on all
four edges (checked: `WM_NCHITTEST` answers HTRIGHT and HTBOTTOMRIGHT just outside the visible edge),
and an 8×8 copper grip in the bottom-right corner resizes it by drag through `hologram:setSize`
(user-only, HOLOGRAM_ALLOWED; it sizes this window and nothing else). **Ctrl+=** and **Ctrl+-** step
both sides by 80 DIPs and **Ctrl+0** returns to 480, taken in main before the page so they never
zoom it. The head strip (the nav's gaps) and the stage drag the window; every control is no-drag.
The size is kept as `hologram.size: { w, h }` DIPs, clamped 320–1600, written by ONE writer, main's
`resize` handler, 300 ms after the last change and never in DESK (DESK is unchanged; leaving it
restores the saved size). An old bare number is read as both sides and rewritten as `{ w, h }`; one
under 400 (the 240 saved before the 480 default) is bumped to 480 once, and the log says so. Inside,
the globe canvas is the largest whole-pixel square between the nav and the caption, re-measured by
a ResizeObserver, its backing store in device pixels so the dither stays 1:1. The chrome takes an
integer `--holo-scale` from the window's shorter side (1 below 640 px, 2 to 1279, 3 above; CSS px
are device px here), every size a multiple of `--p`. The nav's buttons are at least 24×24 chrome px;
below 480 chrome px of width they wrap to two rows of four, below 400 they show icons (the word
stays as the accessible name, the title as the tooltip); the TRAIN, DESK and ACTIONS panels scroll
inside the stage; the text box and SEND share one row at every width. Pure helpers and tests:
`packages/shared/hologram.ts`, `test/hologram-size.test.ts`.

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

**What speaks (built 2026-09-27).** After a reboot William heard Microsoft David with the "jarvis"
profile selected: settings.json said `speech.backend: sapi`, and nothing on screen did. The TRAIN
panel now says which voice the next line will be in, from `speech:status` (`voiceLabel` in
`packages/shared/speech.ts`): `WINDOWS VOICE · Microsoft David Desktop` on `sapi`; on `server`,
`PROFILE jarvis · WARMING`, `· READY`, or `· FINE-TUNED model_1500_pruned` once the model is loaded,
and `PROFILE jarvis · UNAVAILABLE — WINDOWS VOICE · …` when the server is down. The checkpoint
comes from the server's `GET /profile/<name>`, fetched by main in the background and cached per
profile (refreshed on a backend switch, when the server warms, and after a synthesis; no line ever
waits for it) into `SpeechStatus.model`. While a line is spoken the same label shows under the
caption, for THAT line: a server-backend line that fell back says `WINDOWS VOICE · … — PROFILE
jarvis NOT READY` (`SpeechState.via`). The toggle reads as what a press does, `USE THE JARVIS
PROFILE` on Windows' voice and `USE WINDOWS VOICE` on the profile; a switch that cannot take
effect says why in the server's own words (no venv: `NO SYNTHESIS ENVIRONMENT — RUN npm run
speech:install`). The voices dropdown sets `speech.voice` through the user-only `speech:setVoice`
(one of the names the sidecar reported, or none), shows the new name, and says "This is <name>."
in it when Windows' voice is the one speaking; on the server backend it is the fallback voice.

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
  then clicks), `keys` (text, or a combination; `alt+f4` is refused; never into a sign-in window
  or a shell), `wait`, `say`, and `uiaClick` (a control by its UI Automation name in a window by
  title; the planner's click, slice 2), and since 2026-09-27 `scroll` (the wheel at the pointer)
  and `focus` with `focusByPointer` (§ Reaching into windows). At most 12 steps; `desktop:state` is pushed per step; Esc,
  "stop" or the switch halts between steps.
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
  rule fires only when a catalogue app or a site matches. Since 2026-09-27 also `press`, `scroll`,
  `click` and `type` "in <app>" (§ Reaching into windows, the board, and a terminal).
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
- **Then the microphone opens once more, without the wake phrase.** Once the TURN has ended (since
  2026-09-27; before, when JARVIS finished speaking, which opened it after the planner's read-back
  and before the plan ran: § One turn at a time), and a 350 ms pause for the room, the capture
  window listens for one sentence with a 5 s silence limit. A sentence takes the normal path (a
  command, or another reply, and another follow-up); silence closes the window without transcribing
  anything, and the next sentence needs "Jarvis" again. The sphere shows LISTENING throughout.
  `voice.followUp: false` removes the window entirely. This is the one bounded exception to
  "nothing is transcribed before the wake phrase" in docs/07, and it is written there.
- **It can see the board (2026-09-27).** William: the reply said it "needs the board state streamed
  to it". The board window sends main a read-only summary on every room change, selection change
  and board edit (`board:context`, the board window only, coalesced to one per 250 ms;
  `src/renderer/ui/useBoardContext.ts`), and main prints the last one into every conversation prompt
  as a BOARD block of at most 3,000 characters (`boardBlock`, packages/shared/board-context.ts,
  `test/board-context.test.ts`): the room and its path, the selected node (designator, name, kind,
  its path or URL, id), every node on the board one per line (at most 60), the root board's rooms
  (as last seen), the Claude Code sessions and whether they run, and the turn's phase. The system
  text tells the model it can SEE the board, to answer questions about it directly and never say it
  lacks the state, and that "select X" or "go to Y" are the grammar's to do, not its own.
- **The Face is reached only on purpose:** "ask the face …", "tell the face …", "send that to the
  face" still go to the claude.ai window, and nothing else does.

## One turn at a time (built 2026-09-27; not yet seen on screen)

William, after the first live session: "there is still quite a delay, and Jarvis often starts
listening again before taking its first directed action … commands keep getting cut off … make
sure an intelligent system that doesn't stack voice commands or prompt to listen again until the
current requested task is completed … the listening brighten animation … sometimes turns off while
Jarvis keeps listening … one action at a time … never confuses the user as to whether they've been
heard or if the action is in progress … one time Jarvis said it was doing an action but nothing was
happening … add an indicator that gives visual cues as to what Jarvis is doing in that exact moment."

**What was wrong.** Three streams (`voice:state`, `speech:state`, `desktop:state`) and every view
guessing the moment from them. The follow-up window opened when a line that answered a sentence
FINISHED BEING SPOKEN, so after the planner's read-back ("Opening Firefox and Notepad.") the
microphone reopened 1.5 s before the plan moved anything. The globe's mood ranked a desktop step and
a spoken line above LISTENING (`moodFrom`), and its halo was keyed to that mood, so when the plan
started with the follow-up still open, the brightening went out while the microphone was live.
Sentences ended after 700 ms of quiet and at 8 s.

**The engine.** `packages/shared/turn.ts` (pure, `test/turn.test.ts`) is one reducer,
`turnReduce(state, event, now)`, and `src/main/services/turn.ts` owns the one state, pushes
`turn:state` to the board and the hologram on every change (an identical state is not re-sent),
and ticks every 250 ms while anything is going on. Producers:

| Producer | Events |
|---|---|
| the capture window (`voice:mic`, capture window only), through services/voice.ts | `micOpened(wake \| followUp \| press \| hotkey)` when its tracks START, `speechStarted` when the endpointer hears the sentence begin, `micClosed` the instant the tracks STOP; then `sentence(text)`, `partialTranscript(text)` (a continued sentence) or `nothingHeard` |
| services/speech.ts | `speakStart` / `speakEnd` from the sidecar's own START, DONE, STOPPED and PLAYED (a profile recording played back is not a turn line) |
| services/desktop.ts `runPlan(plan, { onStep })` | `planStarted(of)`, `step(index, label)` per step with a label ("FOCUS FIREFOX", "PRESS SPACE", "LAUNCH NOTEPAD", "CLICK 'NEW TAB'", `stepLabel`), `failed` at once on a failure or refusal; `done` (with "Done." after more than one step) only for a plan nobody's sentence started (a gesture, a panel) |
| services/planner.ts | `thinking('PLANNING')`; then `ask(question)` once the question has been SPOKEN, or the read-back, `thinking('ABOUT TO ACT — ESC STOPS IT')` for the grace (1.5 s before several steps, 400 ms before one: `graceMs`), the run, and `done` after "Done." (more than one step) and after the speech has finished |
| services/converse.ts | `thinking('ASKING CLAUDE')`, then the reply, then `done` once it has been said |
| the board window (`turn:report`, the board only) | `done` / `failed` for a sentence it acted on itself (`actOnIntent`), after handing its one-line result to speech; main waits for that line to finish before DONE |
| the hologram text box (`voice:typed`) | `sentence(text)`, the same engine: held while busy, "stop" obeyed |

| Phase | Entered | The globe | The caption | The strip |
|---|---|---|---|---|
| `idle` | a stop; DONE after 2 s; FAILED after 4 s | resting breath (or speaking/acting for a line or a replay nobody asked for by voice) | READY — SAY JARVIS | hidden |
| `listening` | the capture window's tracks start (wake, follow-up, a press) | LISTENING: the full brightening and halo | LISTENING (with the words so far on a continuation) | ● LISTENING · SPEAK NOW / HEARING YOU / GO ON — NO WAKE WORD NEEDED / DICTATION |
| `heard` | the tracks stop (the endpointer closed); the transcript fills in when whisper answers | thinking pulse | “THE TRANSCRIPT” | ❝ HEARD · TRANSCRIBING, then “the transcript” |
| `thinking` | the planner or conversation starts | the slow pulse | “THE TRANSCRIPT”, kept for the whole phase so he sees what was understood | … THINKING · PLANNING / ASKING CLAUDE / ABOUT TO ACT, a live timer, STOP |
| `speaking` | the sidecar reports the line started | speaking (radius and bands follow the voice) | the line | ≈ SPEAKING · the line (the step bar stays if a plan is running), STOP |
| `acting` | `planStarted`, and every step | acting: a quicker brightness pulse | STEP 2 OF 5 — FOCUS FIREFOX | ▶ ACTING · 2 / 5 · FOCUS FIREFOX, one cell per step, a live timer, STOP |
| `waiting` | a question, once it has been spoken | a soft brightening (less than LISTENING) | the question | ? WAITING FOR YOU · the question |
| `done` | the owner ends the turn, after its speech; lasts 2 s | resting | the summary, or the transcript | ✓ DONE |
| `failed` | a failure, a refusal, or the watchdog; lasts 4 s | amber (the fault palette) | the error | ✕ FAILED · the error (· THE HELD COMMAND WAS DROPPED) |

In every phase: **PENDING** when a sentence is held (its words in the tooltip), **● MIC** when a
microphone is open for a sentence that will be held, and **STOP** (Esc) during thinking, speaking
and acting: `turn:stop` halts the desktop, stops speech, drops a held sentence and goes to READY.
Stream mode prints nothing he said. The board's corner dock (JarvisDock) shows the same glyph, word
and step on one line (`turnOneLine`), also on its folded bar.

**The rules.**

- **Nothing stacks.** A sentence heard or typed while a turn is `heard`, `thinking`, `speaking` or
  `acting` is not started: it is held as PENDING (at most one; a second replaces it), and JARVIS
  says "One moment." once per turn. When the turn ends DONE (or WAITING on a question) the held
  sentence becomes the next turn and goes to the board then. A FAILED turn drops it (it may have
  depended on the one that failed) and the strip says so; a stop drops it.
- **"Stop" is never held.** "Jarvis, stop", "cancel that", "never mind" … during a busy turn is
  obeyed at once (`isStopSentence`, the same words intent.ts reads as stop): halt, silence, READY.
- **The follow-up waits for the turn to END**, not for speech to end: `mayListenAgain` now also
  asks `mayFollowUp` (DONE, WAITING or idle; never listening, heard, thinking, speaking, acting or
  FAILED; never with a sentence held or a microphone already open). The owner ends a turn only
  after its line has been spoken (`whenSpeechIdle`, which now also counts a line still being
  synthesised), and only then do the 350 ms pause and the 20 s heard-window rule apply. Only a turn
  that began with a spoken sentence may open it (not a typed line, not a gesture's plan). A
  consequence: a plan that runs longer than 20 s from the sentence ends without a follow-up; the
  next sentence needs "Jarvis".
- **A silent success never looks like a failure.** After a plan of more than one step succeeds,
  JARVIS says "Done." (a single step stays silent after its read-back; the rule grammar's plans
  still say what is open where).
- **The watchdog.** `heard`, `thinking` or `acting` with no progress (a phase change, a step, a
  line) for 60 s is FAILED — "TIMED OUT — nothing happened for 60 s" — said once, and the desktop is
  halted so a late plan cannot act after the fact. This is the answer to "it said it was doing an
  action but nothing was happening": the strip shows the step and the timer the whole time, and a
  step that never comes ends in words.
- **The light never lies.** LISTENING is the turn's `mic` field, set only by the capture window's
  tracks (`voice:mic`: open, speech, closed), and the renderer's brightening and halo follow it
  (`setListening`, `listeningLight`) whatever the mood. A wake phrase during a busy turn lights it
  (the phase stays ACTING, the strip adds ● MIC) and what it hears is held.

### Where the time goes (measured 2026-09-27)

William, after the first live session: "there is still quite a delay … I can deal with the slight
delay, but … never confuses the user … look for ways to make the program even snappier." Every
turn now leaves one JSON line in `userData/turn-timing.jsonl` (`services/turn-timing.ts`, pure
half `packages/shared/turn-timing.ts`): the moments the microphone closed, the transcript arrived,
main knew what to do (planner, remembered plan, conversation, the board's result), the model was
asked and answered, the first line began synthesising and began playing, the plan's first step
started, and the turn ended; and one console line:

    [turn] heard→speak 1,840 ms (whisper 90, intent 3, model 1,400, synth 350) · converse

No words and no audio are written, only times and how the turn ended. The pieces, measured on
William-Desktop without a microphone (the whisper server on synthesised WAVs, `npm run
voice:probe`; the F5 server's `/synthesize` warm, profile `jarvis`, three runs each; `claude -p` on
Haiku 4.5 with this machine's real Start Menu (300 programs) and planner log, one call each; the
speech sidecar with a silent WAV):

| Piece | Before | After | What changed |
|---|---|---|---|
| whisper (large-v3-turbo q5, a 1–2 s sentence) | 67–84 ms | 67–84 ms | nothing to cut: greedy (no beam), no timestamps, English (`-l en` now named, not left to the build's default), flash attention, a warm model |
| The planner's `claude -p` (wall) | 12,011 ms: 20.6 K input tokens, 1,048 output (mostly thinking) | 3,061 ms: 1.7 K in, 72 out | thinking off (12.0 → 3.8 s on its own); `--system-prompt` for the whole system prompt, `--safe-mode` (no CLAUDE.md, skills, plugins, hooks, memory), `--tools ""` (~0.7 s more); the prompt 5,885 → 3,998 characters (15 windows, programs sharing a word + 20, 10 recent plans). ~1.6 s of each call is the CLI starting |
| Conversation's `claude -p` (wall) | 4,901 ms (19.9 K in, 212 out) | 2,484–3,045 ms (1.7 K in, 33 out) | the same arguments (`headlessClaudeArgs`, packages/shared/converse.ts) |
| F5 synthesis, 2 words ("Right away.") | 1,063 ms | **0 ms: banked** | the acknowledgement bank (below) |
| F5 synthesis, 6 words | 1,142 ms | 1,142 ms | — (nfe 16 would be 780 ms for a 20-word line; a quality trade, not made) |
| F5 synthesis, a two-sentence reply (19 words) | 1,361 ms to first audio | 1,160 ms to first audio | sentence one is synthesised and played while sentence two is synthesised behind it (`splitFirstSentence`) |
| F5 synthesis, 20 words | 1,362 ms | 1,362 ms | — (one sentence) |
| Sidecar: sent → playing | ~95 ms (PlaySync on the read loop) | ~10–20 ms | the WAV plays on its own thread |
| Sidecar: "stop" during a server line | the whole line (1,096 ms for a 1 s WAV) | 14 ms | the same: the read loop is free, and `Stop` cuts the wait |
| The pause after the read-back | 1,500 ms | 1,500 ms before several steps, **400 ms** before one | `graceMs` |

What that makes of a turn (sums of the pieces, from the microphone closing):

| Turn | heard → first word | heard → first step |
|---|---|---|
| A question ("what is on the board") | ≈ 6.4 s (75 + 4,901 + 1,361 + 95) | — |
| — after | ≈ 3.7–4.3 s (75 + 2,484–3,045 + 1,160 + 20) | — |
| A planned single step ("open Firefox on two") | ≈ 13.3 s (75 + 12,011 + 1,142 + 95) | ≈ 16.5 s (+ the 1.7 s line + 1,500) |
| — after | ≈ 4.3 s (75 + 3,061 + 1,142 + 20) | ≈ 6.4 s (+ the 1.7 s line + 400) |
| A remembered plan ("Same as last time.") | ≈ 1.2 s (75 + 1,063 + 95) | ≈ 3.6 s |
| — after | ≈ 0.1 s (75 + banked + 20) | ≈ 1.3 s (+ the 0.9 s line + 400 for one step) |
| "One moment." for a held sentence; "Done." after a plan | ≈ 1.1 s after the moment | ≈ 20 ms |

**The acknowledgement bank** (`packages/shared/ack.ts`, `services/ack-bank.ts`). When the server
has loaded its model, main asks it which checkpoint the profile speaks with and synthesises, ONCE,
the short lines JARVIS says word for word, into
`%LOCALAPPDATA%/SkynetOS/voice-profiles/<profile>/ack/<hash>.wav` with `ack/index.json` (the hash
covers profile, checkpoint and text). One line at a time, and only while nothing is being said or
synthesised, so a real line never waits behind more than one bank line. `say` plays a banked line
when the text matches EXACTLY (whitespace aside) and never synthesises it again; a line not in the
bank is synthesised as before; a new checkpoint (a fine-tune applied) rebuilds the bank. The lines:
Right away. · One moment. · Done. · Opening it now. · On it. · Which one? · I heard you. · Same as
last time. · Stopping. · That is refused. · Very well. · Stopped before I began, as asked. · I am
still working out the last request. · That timed out; nothing happened for a minute. · Stopped
there, as asked. · Cancelled. · Undone. · Redone. · Going up. · Cleared. · Sent. · Back to the
board. · Stopped transcribing. · Voice off. The microphone is closed. Each saves the ~1.06 s a
synthesis costs, every time it is said.

**What William hears differently.** A question is answered about 2.5 s sooner and a planned
command read back about 9 s sooner (thinking was on in every `claude -p` call); "Same as last
time.", "One moment." and "Done." come at once, in the profile's voice; a two-sentence reply starts
~0.2 s sooner; a single step starts 1.1 s after its read-back ends instead of 1.5 s; and "stop",
Esc or STOP silences a line in his profile's voice at once instead of after the line.

**Kept on purpose.** The model is still asked for every unrecognised sentence (a remembered plan
skips it); the 1,100 ms end-of-speech silence is unchanged (shortening it cut William off in the
first session); F5 still runs 32 steps.

**Endpointing (packages/shared/voice-capture.ts).**

| | Before | Now |
|---|---|---|
| End of speech (quiet that ends a sentence) | 700 ms (35 frames of 20 ms) | 1,100 ms (55 frames), `END_SILENCE_MS` |
| Longest sentence, wake and follow-up | 8 s | 20 s, `SENTENCE_MAX_MS` |
| Longest profile line / dictation take | 15 s | 15 s (unchanged) |
| Main's backstop per capture (`LISTEN_TIMEOUT_MS`) | 15 s (4 + 8 + 3) | 29.9 s: 4 s to begin + 20 s + 1.1 s + 1.8 s extension + 3 s (`listenTimeoutMs`; a follow-up adds its own silence budget) |
| A sentence stopped on a connective | cut there | continued once: 1.8 s more |

**The connective extension.** whisper-server (whisper.cpp's `server`) answers a whole file at
`/inference`; it has no streaming partials, so partial transcripts are not posted and there is no
interim text to watch. Instead, when the CLOSED capture's transcript ends in "and", "then", "to",
"the", "with", "in", "on", "of", "a", "an", "for", "into", "my" or "that" (`endsInConnective`;
whisper's trailing full stop ignored; a whole command that merely ends on a particle or on "that",
"zoom in", "turn it on", "undo that", is not continued), and the transcript came back within 400 ms
of the close, the microphone reopens ONCE as part of the same sentence (the same door and turn; the
light comes back on; the strip shows GO ON · “open firefox and …”), for up to 1.8 s of silence and
what is left of the 20 s cap. What it hears is joined to the first half (`joinContinuation`); if he
says nothing more, the first half is the sentence. Transcription on this PC takes 118–153 ms, so
the 400 ms is normally met; when it is not, the sentence is taken as it is and the log says why.

## Slice 2: the planner (built 2026-09-27 as M13.3; not yet run against the desktop)

"Open my most recent project in After Effects", "put the stream chat on the portrait monitor", "do
the notepad test but in Word": sentences the rule grammar cannot express. With DESK on, they are
planned by a model, read back, and only then run by the same `runPlan` as a rule plan.

**The path.** The board's voice path (`src/renderer/ui/useVoice.ts`) resolves a sentence as before.
When the result is `unknown` (not understood, or an "open X" that named neither a node nor a
catalogue program, marked `plannable`), it first calls **`desktop:plan(sentence)`**, a new
user-only channel (the board, and the hologram window through `HOLOGRAM_ALLOWED`; never
`AGENT_METHODS` or `REMOTE_METHODS`; `test/planner.test.ts`, `test/jarvis-voice-contract.test.ts`).
A sentence typed into the hologram's text box takes the same path (`voice:typed` → `voice:heard`).
"Do the notepad test but in Word" no longer runs the saved action: a name with "but", "instead",
"except", "without" or "rather than" in it falls through to the planner (`actionIntent`).

Main (`src/main/services/planner.ts`, `planAndRun`) answers `handled: false` at once, and
conversation takes the sentence as before, unless all of these hold:

- `desktop.enabled` is true AND `desktop.planner` is not false (`plannerActive`). The planner
  setting defaults to TRUE, but a new install has `desktop.enabled: false`, so it never plans;
- the first word after the courtesy ("Jarvis", "please", "could you") is a desktop verb (`isPlannable`
  in `packages/shared/planner.ts`: open, launch, start, run, move, put, send, place, resize, click,
  press, type, write, switch, focus, bring, do, repeat, fill …). "Do you …" is a question, and
  close, quit, delete, shut down, restart, sign out and lock are never planned.

Then:

1. **The prompt** (`plannerPrompt`, pure, under 6,000 characters). Sections: RULES (the six step
   kinds with their JSON, at most 12 steps, the refused chords, no dialog, no closing, no shell, no
   coordinate, "if a step needs a decision, stop and ask"); WILLIAM SAID; MONITORS (spoken numbers,
   size, portrait or landscape, primary); WINDOWS (at most 15 since 2026-09-27, 25 before, from the helper's read-only
   `windows`, the one in front first, a sign-in window's title replaced by "(a sign-in window)");
   PROGRAMS (catalogue names, those sharing a word with the sentence first, then at most 20 others,
   alphabetical: `MAX_OTHER_PROGRAMS`; until 2026-09-27 the whole Start Menu filled the budget); SAVED ACTIONS (up to three TRAIN ACTION recordings chosen by word overlap with
   their name and description, as their `summary` lines, every coordinate scrubbed); RECENT PLANS
   (the last 10 lines of `planner.log.jsonl`, 20 before 2026-09-27, as sentence and step kinds only); ANSWER (`{"say":
   …, "steps": […], "ask": … or null}`, JSON only).
2. **The call** (`planDesktop`): headless `claude -p` shaped exactly like `converse.ts`: the prompt on
   stdin, `--output-format text`, `--strict-mcp-config` on an empty server set
   (`userData/planner-mcp.json`), `--permission-mode dontAsk`, every tool disallowed, model
   `desktop.plannerModel` (default the conversation model, Haiku), 30 s timeout. No screenshot:
   the model has no tools, so it cannot look at one; UI Automation names stand in for it.
3. **The parse** (`parsePlannerReply`): a bare object, one in a ```json fence, or the first
   balanced object in prose; missing fields default; anything else is "no plan".
4. **The rules** (`normalisePlan` in `packages/shared/desktop.ts`). Only these step kinds pass:
   `launch {app, monitor?, layout?}` (rewritten to the catalogue entry's exact name; never a shell,
   never a path), `focus {window}`, `place {window, monitor, layout?}` (move and resize by title),
   `uiaClick {window, control, type?}` (new: the control found BY NAME through the helper's
   `uiafind`, the replay's `element` tier, clicked at its centre; no coordinate fallback),
   `keys {text}` (at most 500 characters) or `keys {combo}` (never alt+f4, win+l, ctrl+alt+delete,
   ctrl+shift+esc, win, win+r, win+x, ctrl+w, ctrl+q, ctrl+f4, alt+space, or anything with the
   Windows key), and `wait {ms}` (clamped to 3,000). A `mouse`, `url`, `say` or unknown kind, a
   shell or interpreter (Terminal, PowerShell, Command Prompt, WSL, Python, IDLE, Git for Windows),
   the Run dialog, Control Panel or Administrative Tools (all on this PC's Start Menu), a control that answers a dialog or closes
   something (OK, Yes, Don't Save, Delete, Allow, Close, Sign in, Install …) or a sign-in window is
   dropped. **If anything was dropped, nothing runs** and JARVIS says the first reason; a plan of
   more than 12 steps is refused whole, never cut short.
5. **The read-back.** `ask` set: the question is spoken and nothing runs; once it has been said the
   turn is WAITING (§ One turn at a time), and only then may the follow-up open. Otherwise the `say`
   line is pushed to the hologram's state line and spoken from main through `say`; main waits for
   the speech service to go idle (`whenSpeechIdle`, fed by the sidecar's `done`), then 1.5 s more
   before a plan of several steps, 400 ms before a single step (`graceMs`, 2026-09-27)
   (the strip: THINKING · ABOUT TO ACT — ESC STOPS IT). A "stop", Esc or the DESK switch since the
   line began (`lastHaltRequest`), or a stop of the turn, cancels the run.
6. **The run.** `runPlan(plan)` with `source: 'planner'`: the same switch, twelve-step cap, halt and
   one-plan-at-a-time as a rule plan. At run time a `keys` step (any plan) refuses when the window
   in front is a sign-in window or a shell (`fgtitle`), and a `uiaClick` refuses in either. Success
   is not re-announced beyond "Done." after more than one step (the read-back said it); a failure or
   a halt is spoken. Each step shows in the strip as it runs (ACTING · 2 / 5 · FOCUS FIREFOX).
7. **The log.** One line per planned sentence in `%APPDATA%/SkynetOS/desktop/planner.log.jsonl`:
   `{at, sentence, say, ask, steps, dropped, tiers, ok, message, ms}`, where `tiers` is `element`
   for a control found by name, `ok`, or `failed: …` per step. Never in the repo.

**Settings** (`settings.json` → `desktop`): `planner` (default true; effective only with
`enabled`), `plannerModel` (default `claude-haiku-4-5-20251001`, as `converse.model`).

**Not done, on purpose.** No screenshot and no `--allowedTools Read` (the original design): the
planner has no tools at all, as conversation has none. No `url` step for the planner (the rule
grammar opens sites). No coordinate step. **No plan has run against the desktop**: the first one is
with William watching.

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

The window is 480 px (full monitor height in DESK mode; since 2026-09-27 `hologram.desk` remembers
DESK across starts, written by the same user-only `hologram:setDesk`, so a window left on monitor
one at full height comes back there) and the sphere is a hand-written WebGL2
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

**The session picker (built 2026-09-27).** The feed remembers every session that writes a line,
with its cwd. Under the caption sits the focus's session label (`SkynetOS · 4a2cf476`, the cwd's
last folder and the id's first eight characters); when more than one session has written in the
last ten minutes it becomes a dropdown (`data-control="dropdown-sessions"`, "open the sessions
dropdown"): ALL first, then each session, most recent first. Choosing one calls the user-only
`hologram:setSessionFilter(id | null)`; the feed then offers the scheduler only that session's
accesses, drops a focus or queued access from any other, and keeps in the orbit only what that
session touched, so the orbit and the focus come from it alone. The scene carries `sessions` and
`filter`; a filtered session stays in the list after it goes quiet, so ALL is always one step
away. Nothing is tailed less; the filter narrows the view. Pure rules in
`packages/shared/holo-sessions.ts`, tested in `test/holo-sessions.test.ts`.

**Frame-time readout (built 2026-09-27).** `Ctrl+Shift+P` in the window, or `SKYNET_PERF=1`
(which adds `perf=1` to the window's URL), shows a tiny monospace line in the top-left corner: fps,
frame ms p50/p95 over the last two seconds, and how many content repaints the 8 ms budget skipped
(`renderer.ts` `stats().window`, `packages/shared/frame-stats.ts`). Off by default. The render loop
stops requesting frames while the window is minimised or hidden (`document.hidden`; the window
keeps Electron's background throttling) and restarts on `visibilitychange`; the caption tick
skips its work while hidden too.

## Reaching into windows, the board, and a terminal (built 2026-09-27; not yet run against the desktop)

William: "Jarvis, hit play on the video in my firefox browser … intelligently use my mouse to
select the firefox window, then hit spacebar." Four asks, one section: reach into a named window
without the model, dictate into a named Claude Code terminal with JARVIS beside it, drive the
board by voice across every room, and remember a planned action so the model is asked once.

### Reaching into a window: four rule sentences, no model

`parseReachCommand` in `packages/shared/desktop.ts`, reached from `resolveIntent` before the
older desktop rules. Each sentence becomes exactly two steps: `focus {window, focusByPointer:
true}`, then the action, and nothing else. The window is matched at RUN time, so no catalogue is
needed.

| Said | Steps after the focus | Reply |
|---|---|---|
| `press\|hit <key or phrase> in <app>` | `keys {combo}`: play / pause / play pause / resume → space, mute → m, fullscreen → f, next / skip → shift+n, back → alt+left, forward → alt+right, refresh / reload → f5, or any spoken key or chord ("space bar", "control shift t", "f five", "page down") that `plannerChord` passes | "Play in Firefox." |
| `press <control name> in <app>` (not a key) | `uiaClick {window: foreground, control}` | "Subscribe pressed in Firefox." |
| `scroll (up\|down) [a bit\|a lot\|<n> times] in <app>` | `scroll {direction, notches}` (5 by default, 1 to 20; the new wheel step, 120 per notch, at the pointer) | "Scrolled down in Firefox." |
| `click <control> in <app>` | `uiaClick {window: foreground, control}`: UI Automation by name, now case-insensitive (`PropertyConditionFlags.IgnoreCase`) | "Subscribe pressed in Firefox." |
| `type\|write <text> in(to) <app>` | `keys {text}`, the text as whisper wrote it, case and punctuation kept, at most 500 characters | "Typed it into Notepad." |

`<app>` (`windowTarget`, then `pickWindow` over the helper's read-only `windows` list): a process
name or its alias ("firefox", "notepad", "word" → WINWORD, "edge" → msedge), a title token (a
chip's "JARVIS-TQR", or its designator "U1"), "my browser" (the default browser's process: the
catalogue's first browser, through its shortcut), or "the terminal" (Windows Terminal, cmd,
PowerShell). An exact process beats a title that mentions the name; among equals, Windows'
Z-order wins, so the most recently active window is taken. SkynetOS's own windows and slivers
under 200×120 are never picked.

**The pointer (`focusByPointer`, `bringForward` in services/desktop.ts).** The pointer travels
visibly to the window's centre (the `mouse` op, `desktop.mouseTravelMs`), the window is restored
if minimised and brought forward (`focus`), and when Windows refuses the foreground (its
foreground lock), the pointer clicks the title bar at `titleBarPoint`: 10 DIPs down, 200 DIPs left
of the right edge, which clears the window buttons and a browser's tab-list button; then it
returns to the centre so a wheel step scrolls the page. Only the existing `mouse`, `click` and
`focus` ops; nothing new in the helper.

**Refused, in words.** A chord `plannerChord` refuses (alt+f4, ctrl+w, ctrl+q, the Windows key,
win+r …); a control that answers a dialog or closes something (OK, Delete, Don't Save, Close, Sign
in …); a sign-in window, by the spoken target or by the title found; typing into a shell ("the
terminal", PowerShell, Command Prompt), here by name and again at run time by process. A press or
scroll into a shell is still refused at run time by the `keys` step's existing rule.

### Dictating into a chip's terminal, side by side

- **The split** (`src/main/services/window-split.ts`, `hologram:split`, user-only):
  "split screen with JARVIS-TQR", "put JARVIS-TQR on monitor one and sit beside it", "sit beside
  JARVIS-TQR". The chip's terminal is found by title (session windows are titled "SkynetOS -
  <designator> - <name>" by launch-script.ts; a session title wins among equals) and placed on
  monitor one's left 62% at full work-area height; the JARVIS window takes the remaining width on
  the right (`splitBounds`, whole DIPs, no gap). This is the SPLIT layout in hologram-window.ts,
  distinct from DESK: it writes nothing to settings, so `hologram.desk` and `hologram.size` keep
  what they held, and "leave split screen" (or DESK on or off) goes back to them. The terminal
  also becomes the dictation target. Needs `desktop.enabled`.
- **The dictation target** (`src/main/services/dictate-target.ts`, `dictate:setTarget`,
  user-only): "transcribe into JARVIS-TQR", "dictate to JARVIS-TQR", "type this into JARVIS-TQR"
  set `{title, process, hwnd}` and start dictation. Before each take is typed, `aimDictation`
  brings THAT window forward (no pointer travel; a title-bar click only if Windows refuses), then
  the existing SendKeys path types. "Send it" / "enter" / "press enter" presses Enter there (with
  no target, "send it" is the JARVIS window's SEND button, as before). "Stop transcribing" clears
  the target and stops dictation. If the window has closed, JARVIS says so, clears the target,
  and that take is typed nowhere. Never a sign-in window; never a bare shell (a dictated line and
  Enter would run): a shell process is accepted only when its title is a SkynetOS session's,
  whose prompt is Claude Code's. Needs `desktop.enabled`. Per app run: nothing is written.

### The board by voice, on every board

`packages/shared/board-voice.ts` (pure matching), `src/renderer/ui/boardVoice.ts` (the index,
the walk, the one pending write), actOnIntent's `board` case. The index is every node on every
board, read the way the command palette reads it (`board:load`, `board:loadRoom`), cached 15 s.
A name is looked for in the room on screen first, then on every board, where only a whole-word
match counts; two equal fits are asked about: "Which one: TIMESERVED JAR in STORYOS, or TIMESERVED
NOTES in DEDUCTIONOS?"

| Said | Does | Refuses |
|---|---|---|
| "go to <room>", "open the <room> room", "go to the mainboard" | walks up to the root and down the room path (ascend, descend) | a room it cannot find is said; two equal rooms are asked about |
| "go back", "up" (inside a room) | ascend | at the root, "go back" is still the JARVIS window's main panel |
| "select <node>" | goes to its board, selects it, brings it into view | |
| "open <node>" | goes there and opens it as a click does (`openNode` → `node:open` as the user); a launch outside the rules still raises its confirmation on screen, and voice never answers it | an "open" that names nothing anywhere still goes to the planner |
| "inspect <node>", "show me <node>" | select, which opens the inspector, and bring it into view | |
| "zoom to <node>" | the same, by name | |
| "rename <node> to <text>" | READ BACK: "Renaming M4 TIMESERVED JAR in STORYOS to TimeServed 1.3. Go?" and waits | the text is what whisper wrote, case kept, at most 80 characters |
| "set <node>'s notes to <text>", "set the notes on <node> to <text>" | READ BACK: "Setting …'s notes to "…". Go?" and waits | at most 2,000 characters |
| "go", "yes", "do it" / "no", "cancel" | while a read-back waits (45 s): applies it through `command:apply` with actor `user`, or drops it. "Stop" drops it too | with nothing waiting, "yes" is conversation and "cancel" is stop |
| "move <node> to <room>" | nothing | refused in words: the bus has no command that moves a node between boards |
| "delete / remove / get rid of / erase / unapprove <node>" | nothing | "I don't delete by voice." |

The read-back "go" is its own path. It applies only what `boardWrite` built, a `node.update` of
`name` or `notes`; `boardWrite` returns nothing for a DESTRUCTIVE command, the renderer checks
`isDestructive` again before holding the edit and again before sending it, and nothing in this
path calls `command:confirmDestructive`. actOnIntent's refusal of `confirm` intents is unchanged:
that is the deletion dialog, and a microphone is still not a hand on it. Typed or gestured
("rename" with actor `user` or `gesture`), the old immediate rename is unchanged; a nudge ("move
the stalker left two") and a wire ("connect …") by voice are still immediate and undoable.

### Action memory

`packages/shared/action-memory.ts` (the key and the list), `src/main/services/action-memory.ts`
(the file and the run). After a PLANNER plan runs to completion, `rememberPlan` keeps `{key,
sentence, steps, windows, at, successes}` in `%APPDATA%/SkynetOS/desktop/action-memory.json`,
never the repo, at most 200 entries, the least recently run dropped first. The key
(`memoryKey`) is the sentence lower-cased, punctuation gone, the wake word and courtesy in front
("Jarvis", "hey Jarvis", "could you", "please", "I'd like you to") and at the end ("please",
"thanks", "for me") dropped, "please" / "um" / "uh" dropped anywhere; nothing is stemmed or
reordered. The next time a key matches, `recallPlan` re-checks the remembered plan with
`normalisePlan` against today's catalogue (a plan that no longer passes is forgotten and the model
is asked) and hands it to the planner in place of the model's answer, with "Same as last time." as
its read-back line: the same speech, pause ("stop" or Esc cancels), turn, switch, cap and halt as
any plan. A failure forgets it (`forgetPlan`).

**Wired (2026-09-27)** in services/planner.ts `planAndRun`: `recallPlan(heard)` first (the strip
shows THINKING · REMEMBERED — SAME AS LAST TIME), else `planDesktop(heard)`; after `runPlan`,
`rememberPlan(heard, plan)` on success, `forgetPlan(heard)` otherwise (a halt included).

## Still open

- The planner (slice 2, M13.3): built 2026-09-27, not yet run against the desktop. Notepad and Word
  are not Start Menu shortcuts on this PC, so add `"notepad": "C:\\Windows\\notepad.exe"` to
  `desktop.apps` first; then, with DESK on and Notepad closed, type or say "open notepad and type
  hello from jarvis".
- The fine-tuned voice (M13.8): training ran on 2026-09-26; `apply` and a listen are next.
- Nothing above has been seen on a screen: the first `npm run boot` compiles the shaders.
- M13.9: page cache for long documents, diffs from tool inputs, model textures. (The session
  picker and the frame-time readout are built: § The globe.)
