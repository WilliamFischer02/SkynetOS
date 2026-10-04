/**
 * JARVIS talks back (docs/11-JARVIS-VOICE.md § Speech and § Voice profiles).
 *
 * Types for the speech service in main (services/speech.ts). Two backends:
 *
 *  - `sapi`: Windows' own synthesiser (System.Speech in a PowerShell sidecar). Works on any
 *    Windows machine today, with whichever voices are installed; an en-GB voice is an add-on
 *    William installs in Windows settings.
 *  - `server`: a local synthesis server on 127.0.0.1 that takes text and a VOICE PROFILE and
 *    answers with a WAV. A profile is a dataset William records himself, in the window, reading
 *    a fixed set of lines in the register (`PROFILE_LINES`). His voice, his consent. The server
 *    and its model are installed like whisper-server is: outside the repo, per machine.
 *
 * Neither backend is ever a cloned voice of anyone but William.
 */

export type SpeechBackend = 'sapi' | 'server';

export interface SpeechSettings {
  /** Speak replies at all. Written only by the user-only `speech:setEnabled`. */
  enabled: boolean;
  backend: SpeechBackend;
  /** `sapi`: a substring of an installed voice's name (`Microsoft George`). Empty means choose. */
  voice: string;
  /** System.Speech rate, -10 to 10. Slightly slow reads as measured, which is the register. */
  rate: number;
  /** 0 to 100. */
  volume: number;
  /** `server`: the synthesis endpoint, 127.0.0.1 only. */
  server: string;
  /** `server`: the profile to speak with, by name. Empty means the server's default voice. */
  profile: string;
  /**
   * `server`: how long a line waits for the server to start and load its model before Windows'
   * voice speaks it instead. Milliseconds, 5 s to 5 min; absent means `DEFAULT_WARM_WAIT_MS`.
   * The first line after boot used to fall back to Microsoft David because the model was still
   * loading; a wait is the difference between "his voice, a little late" and "the wrong voice".
   */
  warmWaitMs?: number;
}

export const DEFAULT_SPEECH: SpeechSettings = {
  enabled: true,
  backend: 'sapi',
  voice: '',
  rate: -1,
  volume: 100,
  server: 'http://127.0.0.1:47832',
  profile: ''
};

export const DEFAULT_WARM_WAIT_MS = 120_000;
export const MIN_WARM_WAIT_MS = 5_000;
export const MAX_WARM_WAIT_MS = 300_000;

/** `speech.warmWaitMs` as a number the service can trust: the default when absent, clamped when not. */
export function clampWarmWait(value: unknown): number {
  const n = typeof value === 'number' && Number.isFinite(value) ? value : DEFAULT_WARM_WAIT_MS;
  return Math.max(MIN_WARM_WAIT_MS, Math.min(MAX_WARM_WAIT_MS, Math.round(n)));
}

export type SpeechRoute = 'wait' | 'server' | 'sapi';

/** What the service knows about the synthesis server at the moment a line is asked for. */
export interface SpeechRouteState {
  backend: SpeechBackend;
  /** The server answered a health check, a synthesis, or its own start, and has not exited since. */
  serverUp: boolean;
  /** `/warm` has resolved since the server came up: the model is loaded. */
  warm: boolean;
  /** The service is starting the server or waiting for `/warm` right now. */
  starting: boolean;
  /** How long this line has already waited. */
  waitedMs: number;
  warmWaitMs: number;
}

/**
 * Where a line goes: to the server, to Windows' voice, or nowhere yet.
 *
 *   sapi backend                       → sapi   (never waits)
 *   server up and warm                 → server
 *   waited past warmWaitMs             → sapi   (and the caller says why)
 *   starting, or up but still cold     → wait
 *   down and nobody is starting it     → sapi   (an exit mid-wait lands here)
 */
export function speechRoute(state: SpeechRouteState): SpeechRoute {
  if (state.backend !== 'server') return 'sapi';
  if (state.serverUp && state.warm) return 'server';
  if (state.waitedMs >= state.warmWaitMs) return 'sapi';
  if (state.starting || state.serverUp) return 'wait';
  return 'sapi';
}

export interface SpeechStatus {
  enabled: boolean;
  backend: SpeechBackend;
  /** The backend answered: the sidecar said READY, or the server answered a health check. */
  available: boolean;
  /** The voice actually in use, as the backend names it, or null before it has answered. */
  voice: string | null;
  /** `sapi`: every installed voice, so the settings surface can offer them. */
  voices: string[];
  speaking: boolean;
  /** `server`: the model is loaded, so the next line will be in the profile's voice. */
  warm?: boolean;
  /** `server`: the profile lines are spoken with (`speech.profile`), so the window can name it. */
  profile?: string;
  /**
   * `server`: the checkpoint the profile speaks with, as the server's `GET /profile/<name>` names it
   * (`model_1500_pruned.pt` for a fine-tune, `F5TTS_v1_Base` for the base model). Fetched and cached
   * per profile by main; absent until the server has answered once. Never waited for by a line.
   */
  model?: string;
  error?: string;
}

/** The name the server gives its base model when no fine-tune is applied (tools/speech-server.py). */
export const BASE_SPEECH_MODEL = 'F5TTS_v1_Base';

/** Who is speaking the line in progress: the profile through the server, Windows' voice, or a recording played back. */
export type SpeechVia = 'server' | 'sapi' | 'recording';

/** A Windows voice's name without the status's advisory suffix ("(no British voice installed yet)"). */
export function windowsVoiceName(voice: string | null | undefined): string | null {
  const name = (voice ?? '').replace(/\s*\([^)]*\)\s*$/, '').trim();
  return name || null;
}

/** A checkpoint's short name (`model_1500_pruned`), or null when it is the base model or unknown. */
export function fineTuneName(model: string | null | undefined): string | null {
  const name = (model ?? '').trim().replace(/^.*[\\/]/, '').replace(/\.(pt|pth|ckpt|safetensors)$/i, '');
  if (!name || name.toLowerCase() === BASE_SPEECH_MODEL.toLowerCase()) return null;
  return name;
}

/**
 * Which voice will actually speak, in one line (William, 2026-09-27: after a reboot the voice was
 * Microsoft David although the "jarvis" profile was chosen, because settings.json said `sapi` and
 * nothing on screen did). Shown in the TRAIN panel and, while a line is spoken, under the caption.
 *
 *   sapi                         WINDOWS VOICE · Microsoft David Desktop
 *   server, down                 PROFILE jarvis · UNAVAILABLE — WINDOWS VOICE · Microsoft David Desktop
 *   server, loading              PROFILE jarvis · WARMING
 *   server, warm, base model     PROFILE jarvis · READY
 *   server, warm, fine-tune      PROFILE jarvis · FINE-TUNED model_1500_pruned
 *
 * `via` is who is speaking the line in progress, when there is one: a server-backend line that fell
 * back to Windows' voice says so instead of claiming the profile.
 */
export function voiceLabel(status: SpeechStatus | null | undefined, via?: SpeechVia): string {
  if (!status) return 'VOICE UNKNOWN';
  if (!status.enabled) return 'SPEECH OFF';
  if (via === 'recording') return 'PLAYING YOUR RECORDING';
  const windows = `WINDOWS VOICE · ${windowsVoiceName(status.voice) ?? 'STARTING'}`;
  if (status.backend !== 'server') return windows;
  const profile = `PROFILE ${status.profile?.trim() || 'default'}`;
  if (via === 'sapi') return `${windows} — ${profile} NOT READY`;
  if (status.error) return `${profile} · UNAVAILABLE — ${windows}`;
  if (!status.warm) return `${profile} · WARMING`;
  const tuned = fineTuneName(status.model);
  return tuned ? `${profile} · FINE-TUNED ${tuned}` : `${profile} · READY`;
}

/**
 * The USE THIS VOICE button, reading as what a press will do so its direction is never ambiguous:
 * on Windows' voice (or another profile) it offers the chosen profile; on the chosen profile it
 * offers Windows' voice.
 */
export function useVoiceAction(status: SpeechStatus | null | undefined, chosen: string | null): { backend: SpeechBackend; label: string } {
  const onChosen = status?.backend === 'server' && Boolean(chosen) && (status.profile ?? '') === chosen;
  if (onChosen) return { backend: 'sapi', label: 'USE WINDOWS VOICE' };
  return { backend: 'server', label: chosen ? `USE THE ${chosen.toUpperCase()} PROFILE` : 'USE A PROFILE' };
}

export interface SpeechRequest {
  text: string;
  /** Stop whatever is being said first. Default: queue behind it. */
  interrupt?: boolean;
  /**
   * No longer read (2026-09-27). The follow-up window used to open when a line that answered
   * William finished; it now opens only when the TURN ends (services/turn.ts, docs/11 § One turn at
   * a time), whatever was said. Kept so an older caller still type-checks.
   */
  followUp?: boolean;
}

/** Pushed to the board and the hologram while something is said. */
export interface SpeechState {
  speaking: boolean;
  /**
   * A line is held while the synthesis server starts or loads its model (`speechRoute` said
   * `wait`). The hologram shows WARMING; `text` is the line that is waiting. Cleared, with
   * `warming: false`, the moment the line is routed either way.
   */
  warming?: boolean;
  /** The sentence in progress. */
  text?: string;
  /** 0..1 through the sentence, from the synthesiser's own progress events. */
  progress?: number;
  /** A pulse per word boundary, 0..1, decaying; what the hologram breathes to. */
  level?: number;
  /** Who is speaking this line (set while `speaking`): the profile, Windows' voice, or a recording. */
  via?: SpeechVia;
}

/* ────────────────────────── voice profiles ────────────────────────── */

/**
 * Where a line came from: `scripted` is one of PROFILE_LINES read into the recorder; `imported`
 * is a clip William already had, brought in by `npm run profile:import` (docs/11 § Voice profiles).
 */
export type ProfileLineSource = 'scripted' | 'imported';

/** One recorded line of a profile: the text shown, and the WAV of William reading it. */
export interface ProfileLine {
  id: string;
  /** What is said in it. Empty for an imported clip whose transcript is not known yet. */
  text: string;
  /** File name inside the profile folder (16 kHz mono WAV), or null while unrecorded. */
  file: string | null;
  ms: number;
  recordedAt: string | null;
  source: ProfileLineSource;
  /** `imported` only: the file it was converted from, as dropped in `import/`. Never modified. */
  original?: string;
}

export interface VoiceProfile {
  name: string;
  createdAt: string;
  updatedAt: string;
  /** Every line of PROFILE_LINES, recorded or not, in order. */
  lines: ProfileLine[];
  /** Set once a model has been fitted to this dataset by the synthesis server's own tool. */
  trained: { at: string; model: string } | null;
  /** The server this profile was prepared for, so a mismatch is said rather than guessed. */
  server: string;
}

export interface VoiceProfileSummary {
  name: string;
  /** Scripted lines recorded, of `total`. */
  recorded: number;
  total: number;
  /** Clips brought in by the importer, counted apart from the script. */
  imported: number;
  trained: boolean;
  updatedAt: string;
}

/** What the recorder asks the capture window for: one line, up to `maxMs`. */
export interface ProfileRecordRequest {
  profile: string;
  lineId: string;
  maxMs: number;
}

export interface ProfileRecordResult {
  ok: boolean;
  line?: ProfileLine;
  error?: string;
}

/* ────────────────────────── pure helpers ────────────────────────── */

/** Lines are spoken, not executed: no control characters, one line, a bounded length. */
export const MAX_SPEECH_CHARS = 400;

export function sanitiseSpeech(text: unknown): string {
  if (typeof text !== 'string') return '';
  // eslint-disable-next-line no-control-regex
  return text.replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, MAX_SPEECH_CHARS);
}

/**
 * Which installed voice to use. The preferred substring wins; then the first British male voice
 * (Windows names them "Microsoft George", "Microsoft Ryan"); then any British voice; then the
 * first male voice of any English; then the first voice there is. On a machine with only the US
 * voices Windows installs by default, that is Microsoft David, and the status says so.
 */
export function chooseVoice(installed: readonly string[], preferred: string): string | null {
  const names = installed.map((name) => name.trim()).filter(Boolean);
  if (!names.length) return null;
  const want = preferred.trim().toLowerCase();
  if (want) {
    const hit = names.find((name) => name.toLowerCase().includes(want));
    if (hit) return hit;
  }
  const british = names.filter((name) => /george|ryan|hazel|susan|sonia|\b(en-gb|united kingdom|great britain|british)\b/i.test(name));
  const britishMale = british.find((name) => /george|ryan/i.test(name));
  if (britishMale) return britishMale;
  if (british[0]) return british[0];
  const male = names.find((name) => /david|mark|james|guy|richard/i.test(name));
  return male ?? names[0] ?? null;
}

/** Only a loopback address may be a synthesis server: the voice never leaves the machine. */
export function isLoopbackUrl(url: string): boolean {
  try {
    const u = new URL(url);
    return (u.protocol === 'http:' || u.protocol === 'https:') && (u.hostname === '127.0.0.1' || u.hostname === 'localhost' || u.hostname === '[::1]');
  } catch {
    return false;
  }
}

/**
 * The speech sidecar: Windows' own synthesiser behind a line protocol.
 *
 * A C# wrapper is compiled with Add-Type so the synthesiser's progress events reach stdout from
 * their own thread, which a PowerShell event action cannot do while the script is blocked reading
 * stdin. Input is one JSON object per line: {"say":"…","voice":"…","rate":-1,"volume":100},
 * {"stop":true}, {"play":"C:/…/x.wav"}. Output: VOICES a|b|c, READY <voice>, START <chars>,
 * WORD <pos> <len>, DONE, STOPPED, PLAYED <path>, FATAL <message>. The script never evaluates its
 * input as code and opens no network.
 */
export function speechScript(): string {
  return [
    "$ErrorActionPreference = 'Stop'",
    'Add-Type -AssemblyName System.Speech',
    '$speechAsm = [System.Speech.Synthesis.SpeechSynthesizer].Assembly.Location',
    '$source = @"',
    'using System;',
    'using System.IO;',
    'using System.Speech.Synthesis;',
    'public class JarvisSpeaker {',
    '  private readonly SpeechSynthesizer synth = new SpeechSynthesizer();',
    '  private readonly TextWriter output = Console.Out;',
    '  private int chars = 0;',
    '  public JarvisSpeaker() {',
    '    synth.SetOutputToDefaultAudioDevice();',
    '    synth.SpeakStarted += (s, e) => Emit("START " + chars);',
    '    synth.SpeakProgress += (s, e) => Emit("WORD " + e.CharacterPosition + " " + e.CharacterCount);',
    '    synth.SpeakCompleted += (s, e) => Emit(e.Cancelled ? "STOPPED" : "DONE");',
    '  }',
    '  private void Emit(string line) { lock (output) { output.WriteLine(line); output.Flush(); } }',
    '  public string Voices() {',
    '    var names = new System.Collections.Generic.List<string>();',
    '    foreach (var v in synth.GetInstalledVoices()) { if (v.Enabled) names.Add(v.VoiceInfo.Name); }',
    '    return string.Join("|", names.ToArray());',
    '  }',
    '  public string Current() { return synth.Voice.Name; }',
    '  public string Select(string name) {',
    '    if (!string.IsNullOrEmpty(name)) { try { synth.SelectVoice(name); } catch (Exception) { } }',
    '    return synth.Voice.Name;',
    '  }',
    '  public void Say(string text, int rate, int volume) {',
    '    chars = text.Length;',
    '    synth.Rate = Math.Max(-10, Math.Min(10, rate));',
    '    synth.Volume = Math.Max(0, Math.Min(100, volume));',
    '    synth.SpeakAsync(text);',
    '  }',
    // A WAV plays on its own thread, so the read loop stays free and {"stop":true} ends it at once
    // (2026-09-27: PlaySync on the loop meant "stop" waited for the whole line to finish).
    // A WAV plays asynchronously and a thread waits out its length, so the read loop stays free and
    // {"stop":true} ends it at once (2026-09-27: PlaySync on the loop meant "stop" waited for the
    // whole line; a synchronous PlaySound cannot be stopped from another thread either).
    '  private System.Media.SoundPlayer player;',
    '  private readonly System.Threading.ManualResetEvent cut = new System.Threading.ManualResetEvent(false);',
    '  public void Play(string path) {',
    '    int byteRate = 32000; long bytes = 0;',
    '    using (var fs = File.OpenRead(path)) { bytes = fs.Length; var br = new BinaryReader(fs); fs.Seek(28, SeekOrigin.Begin); byteRate = Math.Max(1, br.ReadInt32()); }',
    '    int ms = (int)Math.Min(300000L, Math.Max(0L, (bytes - 44) * 1000L / byteRate));',
    '    var p = new System.Media.SoundPlayer(path);',
    '    p.Load();',
    '    cut.Reset();',
    '    player = p;',
    '    p.Play();',
    '    var t = new System.Threading.Thread(() => {',
    '      cut.WaitOne(ms + 40);',
    '      if (player == p) player = null;',
    '      p.Dispose();',
    '      Emit("PLAYED " + path);',
    '    });',
    '    t.IsBackground = true;',
    '    t.Start();',
    '  }',
    '  public void Stop() {',
    '    synth.SpeakAsyncCancelAll();',
    '    var p = player;',
    '    if (p != null) { try { p.Stop(); } catch (Exception) { } cut.Set(); }',
    '  }',
    '}',
    '"@',
    'Add-Type -TypeDefinition $source -ReferencedAssemblies $speechAsm',
    'try { $speaker = New-Object JarvisSpeaker } catch { Write-Output ("FATAL " + $_.Exception.Message); exit 1 }',
    "Write-Output ('VOICES ' + $speaker.Voices())",
    "Write-Output ('READY ' + $speaker.Current())",
    '$in = [Console]::In',
    'while ($true) {',
    '  $line = $in.ReadLine()',
    '  if ($null -eq $line) { break }',
    "  if ($line.Trim() -eq '') { continue }",
    '  try { $msg = $line | ConvertFrom-Json } catch { Write-Output "FAULT not json"; continue }',
    '  if ($msg.stop) { $speaker.Stop(); continue }',
    '  if ($msg.play) {',
    "    try { $speaker.Play([string]$msg.play) } catch { Write-Output ('FAULT play ' + $_.Exception.Message) }",
    '    continue',
    '  }',
    '  if ($null -ne $msg.say) {',
    "    $voice = if ($msg.voice) { [string]$msg.voice } else { '' }",
    '    $rate = if ($null -ne $msg.rate) { [int]$msg.rate } else { 0 }',
    '    $volume = if ($null -ne $msg.volume) { [int]$msg.volume } else { 100 }',
    "    Write-Output ('VOICE ' + $speaker.Select($voice))",
    '    $speaker.Say([string]$msg.say, $rate, $volume)',
    '  }',
    '}',
    '$speaker.Stop()'
  ].join('\r\n');
}

export type SpeechLine =
  | { type: 'voices'; voices: string[] }
  | { type: 'ready'; voice: string }
  | { type: 'voice'; voice: string }
  | { type: 'start'; chars: number }
  | { type: 'word'; position: number; length: number }
  | { type: 'done' }
  | { type: 'stopped' }
  | { type: 'played'; path: string }
  | { type: 'fatal'; message: string }
  | { type: 'fault'; message: string }
  | { type: 'other'; text: string };

/** One line from the speech sidecar. Anything unrecognised is only logged. */
export function parseSpeechLine(line: string): SpeechLine {
  const text = line.trim();
  if (text.startsWith('VOICES')) return { type: 'voices', voices: text.slice(6).trim().split('|').map((v) => v.trim()).filter(Boolean) };
  if (text.startsWith('READY')) return { type: 'ready', voice: text.slice(5).trim() };
  if (text.startsWith('VOICE ')) return { type: 'voice', voice: text.slice(6).trim() };
  if (text.startsWith('FATAL')) return { type: 'fatal', message: text.slice(5).trim() || 'THE SPEECH SIDECAR FAILED' };
  if (text.startsWith('FAULT')) return { type: 'fault', message: text.slice(5).trim() };
  if (text.startsWith('PLAYED')) return { type: 'played', path: text.slice(6).trim() };
  if (text === 'DONE') return { type: 'done' };
  if (text === 'STOPPED') return { type: 'stopped' };
  let match = /^START\s+(\d+)$/.exec(text);
  if (match) return { type: 'start', chars: Number(match[1]) };
  match = /^WORD\s+(\d+)\s+(\d+)$/.exec(text);
  if (match) return { type: 'word', position: Number(match[1]), length: Number(match[2]) };
  return { type: 'other', text };
}

/* ────────────────────────── profile lines ────────────────────────── */

/**
 * What William reads to make a voice profile: forty original lines in the register of
 * codex/personas/jarvis-voice.md. Varied sounds, a few questions, a few numbers, "sir" now and
 * then. No film lines, and nothing here is about anyone but the work.
 */
export const PROFILE_LINES: readonly { id: string; text: string }[] = [
  { id: 'l01', text: 'Good morning, sir. The board is green and nothing is on fire.' },
  { id: 'l02', text: 'The build finished in four point two seconds, which is faster than yesterday.' },
  { id: 'l03', text: 'Shall I open After Effects on the first monitor and Firefox on the second?' },
  { id: 'l04', text: 'I would recommend saving before you try that.' },
  { id: 'l05', text: 'Seven files changed, three of them tests. Nothing was deleted.' },
  { id: 'l06', text: 'The microphone is on. Say the word and I will listen for one sentence.' },
  { id: 'l07', text: 'That path does not exist. The nearest match is the folder above it.' },
  { id: 'l08', text: 'Zooming in on the board, as you asked.' },
  { id: 'l09', text: 'The jar was rebuilt eleven minutes ago and the board has noticed.' },
  { id: 'l10', text: 'I do not know. The log stops at the second line, and that would tell us.' },
  { id: 'l11', text: 'Systems are nominal, insofar as that word still applies.' },
  { id: 'l12', text: 'The statement arrived on Tuesday. No payment has been confirmed since.' },
  { id: 'l13', text: 'Fourteen hours, sir. It will still be broken in the morning.' },
  { id: 'l14', text: 'Would you prefer the left half of the screen or the whole of it?' },
  { id: 'l15', text: 'The window is open and placed. The mouse is yours again.' },
  { id: 'l16', text: 'Three hundred and twelve unread. About nine tenths of them are shops.' },
  { id: 'l17', text: 'Proceeding. I would note, once, that this is the risky version.' },
  { id: 'l18', text: 'Voice control is off. Nothing is listening now.' },
  { id: 'l19', text: 'The queue is empty and the scheduler is asleep until eight.' },
  { id: 'l20', text: 'Which of the two Firefox windows did you mean, sir?' },
  { id: 'l21', text: 'The remote device paired at nine fifty. It has made two calls since.' },
  { id: 'l22', text: 'Recording. Read the line at your usual pace, then pause.' },
  { id: 'l23', text: 'That would delete the working tree. I will need you to confirm it yourself.' },
  { id: 'l24', text: 'The kettle analogy holds. The processor is warm, not hot.' },
  { id: 'l25', text: 'Undo is available. The last change moved one node two tiles left.' },
  { id: 'l26', text: 'Twelve per cent of the pool remains, roughly ninety minutes at this rate.' },
  { id: 'l27', text: 'The phone can look, but it cannot delete. That was the design.' },
  { id: 'l28', text: 'Quiet on every channel. I will speak when something changes.' },
  { id: 'l29', text: 'The Stalker build failed on the same target as last week.' },
  { id: 'l30', text: 'A question, then. Do you want the draft sent, or only saved?' },
  { id: 'l31', text: 'Placing the browser on monitor two, right half, as before.' },
  { id: 'l32', text: 'Six scheduled runs a day is the limit. Today has used one.' },
  { id: 'l33', text: 'The zebra, the xylophone and the quartz vase: all catalogued, sir.' },
  { id: 'l34', text: 'Thursday, the twenty third, at half past six in the evening.' },
  { id: 'l35', text: 'The microphone did not answer. Windows may have changed the default input.' },
  { id: 'l36', text: 'Nothing to report. Which, given the week, is a report.' },
  { id: 'l37', text: 'The novel is open in Word. Chapter eight, where you left it.' },
  { id: 'l38', text: 'I have written it. I have not run it. Both of those sentences are true.' },
  { id: 'l39', text: 'Very good, sir. Shall I keep the window on top while you work?' },
  { id: 'l40', text: 'Goodnight. The journal is written and the lights are yours.' }
];

/**
 * Where profiles live: `%LOCALAPPDATA%/SkynetOS/voice-profiles`, or a fallback the caller names
 * (Electron's userData in the app; a temp folder in a test). ONE rule for the service and the
 * import tool, so they cannot disagree about where a profile is.
 */
export function profilesRoot(localAppData: string | undefined, fallback: string): string {
  return localAppData ? `${localAppData.replace(/[\\/]+$/, '')}\\SkynetOS\\voice-profiles` : fallback;
}

export function profileFolder(root: string, name: string): string {
  return `${root.replace(/[\\/]+$/, '')}\\${name}`;
}

/** Imported clips are numbered as they arrive: import-01, import-02 … */
export function nextImportId(profile: VoiceProfile): string {
  let n = 0;
  for (const line of profile.lines) {
    const m = /^import-(\d+)$/.exec(line.id);
    if (m) n = Math.max(n, Number(m[1]));
  }
  return `import-${String(n + 1).padStart(2, '0')}`;
}

/** Bounds on a clip the importer accepts, in milliseconds. */
export const IMPORT_MIN_MS = 500;
export const IMPORT_MAX_MS = 30_000;

/**
 * `transcripts.txt`: one clip per line, `<file name><TAB><text>`. Blank lines and `#` comments are
 * skipped; a line without a tab is ignored rather than guessed at. Names match case-insensitively.
 */
export function parseTranscripts(text: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const tab = line.indexOf('\t');
    if (tab <= 0) continue;
    const name = line.slice(0, tab).trim().toLowerCase();
    const said = sanitiseSpeech(line.slice(tab + 1));
    if (name && said) out.set(name, said);
  }
  return out;
}

/** Drop leading and trailing samples quieter than `ratio` of the clip's peak. Silence in, silence out. */
export function trimSilence(samples: Float32Array, ratio = 0.01): Float32Array {
  let peak = 0;
  for (let i = 0; i < samples.length; i++) peak = Math.max(peak, Math.abs(samples[i]!));
  if (peak === 0) return new Float32Array(0);
  const floor = peak * ratio;
  let start = 0;
  while (start < samples.length && Math.abs(samples[start]!) < floor) start++;
  let end = samples.length;
  while (end > start && Math.abs(samples[end - 1]!) < floor) end--;
  return samples.slice(start, end);
}

export function safeProfileName(name: unknown): string | null {
  if (typeof name !== 'string') return null;
  const clean = name.trim().toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
  return clean || null;
}

export function newProfile(name: string, server: string, now = new Date()): VoiceProfile {
  const at = now.toISOString();
  return {
    name,
    createdAt: at,
    updatedAt: at,
    lines: PROFILE_LINES.map((line) => ({ id: line.id, text: line.text, file: null, ms: 0, recordedAt: null, source: 'scripted' as const })),
    trained: null,
    server
  };
}

/** Whatever was on disk, made safe: unknown lines dropped, missing lines added unrecorded. */
export function normaliseProfile(raw: unknown, name: string, server: string): VoiceProfile {
  const fresh = newProfile(name, server);
  if (!raw || typeof raw !== 'object') return fresh;
  const source = raw as Partial<VoiceProfile>;
  const known = new Map<string, Partial<ProfileLine>>();
  if (Array.isArray(source.lines)) {
    for (const line of source.lines) {
      if (line && typeof line === 'object' && typeof (line as ProfileLine).id === 'string') known.set((line as ProfileLine).id, line as ProfileLine);
    }
  }
  const lines: ProfileLine[] = fresh.lines.map((line) => {
    const had = known.get(line.id);
    const file = had && typeof had.file === 'string' && /^line-[a-z0-9]+\.wav$/.test(had.file) ? had.file : null;
    return {
      id: line.id,
      text: line.text,
      file,
      ms: file && typeof had?.ms === 'number' && had.ms >= 0 ? had.ms : 0,
      recordedAt: file && typeof had?.recordedAt === 'string' ? had.recordedAt : null,
      source: 'scripted'
    };
  });
  // Imported clips: kept when their converted WAV is named as the importer names it. A missing
  // source on an `import-NN` id still counts as imported; anything else is a scripted id or dropped.
  for (const [id, had] of known) {
    if (!/^import-\d+$/.test(id)) continue;
    const file = typeof had.file === 'string' && /^line-import-\d+\.wav$/.test(had.file) ? had.file : null;
    if (!file) continue;
    lines.push({
      id,
      text: typeof had.text === 'string' ? sanitiseSpeech(had.text) : '',
      file,
      ms: typeof had.ms === 'number' && had.ms >= 0 ? had.ms : 0,
      recordedAt: typeof had.recordedAt === 'string' ? had.recordedAt : null,
      source: 'imported',
      ...(typeof had.original === 'string' ? { original: had.original } : {})
    });
  }
  lines.sort((a, b) => (a.source === b.source ? 0 : a.source === 'scripted' ? -1 : 1));
  const trainedRaw = source.trained as { at?: unknown; model?: unknown } | null | undefined;
  const trained = trainedRaw && typeof trainedRaw === 'object' && typeof trainedRaw.at === 'string' && typeof trainedRaw.model === 'string'
    ? { at: trainedRaw.at, model: trainedRaw.model }
    : null;
  return {
    name,
    createdAt: typeof source.createdAt === 'string' ? source.createdAt : fresh.createdAt,
    updatedAt: typeof source.updatedAt === 'string' ? source.updatedAt : fresh.updatedAt,
    lines,
    trained,
    server: typeof source.server === 'string' ? source.server : server
  };
}

export function profileSummary(profile: VoiceProfile): VoiceProfileSummary {
  const scripted = profile.lines.filter((line) => line.source !== 'imported');
  return {
    name: profile.name,
    recorded: scripted.filter((line) => line.file).length,
    total: scripted.length,
    imported: profile.lines.filter((line) => line.source === 'imported').length,
    trained: profile.trained !== null,
    updatedAt: profile.updatedAt
  };
}

/** The next unrecorded scripted line, or null when the script is complete. */
export function nextUnrecorded(profile: VoiceProfile): ProfileLine | null {
  return profile.lines.find((line) => line.source !== 'imported' && !line.file) ?? null;
}
