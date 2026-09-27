# Prime log

Append-only. One entry per session, newest last. What worked, what did not, what to keep.

## 2026-09-23 — morning maintenance, then the away hour

- Morning run: three renderer fixes and the `notify` toast. Two survey forks (UX, tidying) were
  worth their cost; the tidying one reported after the bound, so its findings went to the roadmap.
  Keep: spawn surveys first, before reading code myself, and set them a shorter bound.
- Away hour: William handed over four goals (Tailscale guide, FinanceOS, email, this workspace).
  Three forks with one-owner-per-file briefs; the main session kept the shared docs. `private/`
  created and gitignored before any fork could write a figure anywhere else.
- Learned: the Gmail connector is live in this session; whether a chip-launched session has it is
  unknown. Windows toasts need an AUMID in dev. `vite-node --config vitest.config.ts` is how a
  `.ts` tool runs.
- Keep: `prime/tools/board-overlap.ts` replaces the inline overlap script every board edit re-wrote.
- The Tailscale guide fork read the code closely enough to find a doc/code disagreement (the
  lockout ignored bad tokens). Keep: a guide-writing fork doubles as a review; ask it to report
  faults, not just write.
- The overlap tool reported 286 faults on real boards before it used `isPrinted`; a footprint on a
  zone is for drawing, not for occupancy. Keep: reuse the shared rule, never re-derive it.

## 2026-09-24 — JARVIS Voice, slice 1

- The contract went first: types, channels, settings blocks and honest skeletons, green before any
  fork started. Three forks then built window, speech and desktop control without touching each
  other's files. Keep: lay the contract, then fork. One threshold in my own test was off by one and
  two forks reported it rather than editing my file; the ownership rule held.
- Declined a cloned actor's voice; William amended to his own recordings within the hour. Keep:
  say the line once, plainly, and offer the nearest thing.
- Learned: pwsh 7's Add-Type cannot see System.Speech without a reference set (the speech sidecar
  starts powershell.exe first); System.Speech lists only Desktop/SAPI voices, not OneCore ones;
  three forks running verify at once can trip the 8 s watch-plan deadline.
- Later: the AIFF importer fork, the F5-TTS server and its installer. `npm run speech:install`
  took about twenty minutes for 5 GB; torch cu128 wheels are what an RTX 50-series needs. Keep:
  check `pip index versions` against the specific Python before choosing a package; Python 3.14
  was the default here and 3.10 the one the TTS stack is tested on.
- The bash heredoc backslash landmine bit twice in one hour (a `'\n'` in settings.ts, a
  `/\r?\n/` in speech.ts). Keep: any line with a backslash goes through the Write or Edit tool.
- The profile spoke on the second try. torchaudio 2.9+ needs torchcodec+FFmpeg to load a WAV;
  soundfile over `torchaudio.load` was ten lines. Keep: when a stack wants FFmpeg for a WAV we
  wrote ourselves, read it ourselves. William put the clips inside the repo; the gitignore went in
  before the import ran. Keep: guard the public repo first, build second.
- Conversation and follow-up: two forks, one owning the reply (converse), one the microphone
  window (voice/speech), split on files not on features, and both green in under ten minutes of
  each other. Keep: split by file ownership first, then check the seam (here `heardRecently`, so
  neither fork needed the other's edit to work).
- William's first live try found two things a verify cannot: the Face hand-off was the wrong
  default for speech, and five buttons did not fit 208 px. Keep: a first-use walk with him beats
  another hour of building.
