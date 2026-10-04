import { useCallback, useEffect, useRef, useState } from 'react';
import {
  captionForTurn,
  flickerAt,
  isWarming,
  listeningLight,
  moodFromTurn,
  paletteFor,
  renderSphere,
  smoothLevel,
  type HologramMood
} from '@shared/hologram.js';
import { describeControl, type HologramControl, type HologramDropdown, type HologramPanel } from '@shared/hologram-control.js';
import type { DesktopState, DesktopStatus } from '@shared/desktop.js';
import { useVoiceAction, voiceLabel, windowsVoiceName, type ProfileLine, type SpeechState, type SpeechStatus, type VoiceProfile, type VoiceProfileSummary } from '@shared/speech.js';
import { VOICE_OFF, type VoiceStatus } from '@shared/voice.js';
import { summariseSteps, type ActionRecording, type RecordStatus, type SavedAction } from '@shared/actions.js';
import type { DictateStatus } from '@shared/dictate.js';
import { redactScene, type HoloScene, type HoloSession } from '@shared/holo-scene.js';
import { sessionOptions, showSessionPicker } from '@shared/holo-sessions.js';
import { frameReadout } from '@shared/frame-stats.js';
import { CONTROL_CAPTION_MS, controlEffect, panelForButton } from '../hologram/controls.js';
import { createHologramRenderer, type HologramRenderer } from '../hologram/renderer.js';
import { NavLabel, SizeGrip, useHoloFrame } from '../hologram/frame.js';
import { TurnStrip } from '../hologram/TurnStrip.js';
import type { TurnState } from '@shared/turn.js';
import fontUrl from '../../../assets/fonts/DepartureMono-1.500/DepartureMono-Regular.woff2?url';
import './hologram.css';

/**
 * JARVIS Voice: the hologram window's page (docs/11-JARVIS-VOICE.md).
 *
 * The globe (src/renderer/hologram/, WebGL2) with one caption line, a text box that takes a
 * command the way the microphone would, and the switches. Everything it knows arrives as events
 * main already pushes: voice, speech and desktop state, the audio levels, the scene, and spoken
 * controls (`hologram:control`), which it performs exactly as a click on the element carrying the
 * same `data-control` id. It polls nothing but the recorder's own status while a recording runs.
 *
 * Panels over the stage: TRAIN (the voice-profile recorder), DESK (desktop control, the monitor
 * list and TRAIN ACTION), ACTIONS (the save screen for a recording, and the saved actions).
 * This window itself never opens a microphone.
 *
 * If WebGL2 is refused, the old 2D dithered sphere (`renderSphere`) draws instead, at the same
 * size, so the window is never black.
 */

const LOGICAL = 80;
const RECORD_MAX_MS = 12_000;
const NOTE_MS = 4000;
const RECORD_POLL_MS = 500;
/** How often the TRAIN panel re-reads which voice will speak (WARMING → READY), and the perf readout refreshes. */
const VOICE_POLL_MS = 3000;
const PERF_POLL_MS = 250;

function reducedMotion(): boolean {
  try { return window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { return false; }
}

function hashParams(): URLSearchParams {
  return new URLSearchParams(window.location.hash.split('?')[1] ?? '');
}

function message(err: unknown): string {
  return (err as Error)?.message ?? String(err);
}

interface Live {
  voice: VoiceStatus;
  speech: SpeechState | null;
  desktop: DesktopState | null;
  heard: string | null;
  said: string | null;
  level: number;
  lastT: number;
  /** A line that replaces the caption for a moment: what a switch could not do, or what a voice command pressed. */
  note: { text: string; until: number } | null;
  /** The last speech status, for the "what speaks" line under the caption while a line is said. */
  speechStatus: SpeechStatus | null;
  /**
   * The turn (services/turn.ts, `turn:state`), 2026-09-27: the ONE source of the mood, the
   * LISTENING light and the caption. Null only until main has answered, or from an older main.
   */
  turn: TurnState | null;
}

export function HologramApp(): React.JSX.Element {
  const params = hashParams();
  const streamMode = params.get('stream') === '1';
  const canvasRef = useRef<HTMLCanvasElement>(null);
  // Resizable since 2026-09-27: the chrome scale, the nav's layout and the globe's square.
  const stageRef = useRef<HTMLDivElement>(null);
  const frame = useHoloFrame(stageRef);
  const rendererRef = useRef<HologramRenderer | null>(null);
  const liveRef = useRef<Live>({ voice: VOICE_OFF, speech: null, desktop: null, heard: null, said: null, level: 0, lastT: 0, note: null, speechStatus: null, turn: null });
  // The status strip under the caption: re-rendered on every `turn:state`, not on the 10 Hz tick.
  const [turn, setTurn] = useState<TurnState | null>(null);
  const [caption, setCaption] = useState('READY');
  const [mood, setMood] = useState<HologramMood>('off');
  const [voice, setVoice] = useState<VoiceStatus>(VOICE_OFF);
  const [speechStatus, setSpeechStatus] = useState<SpeechStatus | null>(null);
  const [desktopStatus, setDesktopStatus] = useState<DesktopStatus | null>(null);
  const [text, setText] = useState('');
  const [panel, setPanel] = useState<HologramPanel>('main');
  const [busy, setBusy] = useState<string | null>(null);
  const [legacy, setLegacy] = useState(false);
  const [desk, setDesk] = useState(false);
  const [recStatus, setRecStatus] = useState<RecordStatus | null>(null);
  const [pending, setPending] = useState<ActionRecording | null>(null);
  const [actions, setActions] = useState<SavedAction[] | null>(null);
  const [dictate, setDictate] = useState<DictateStatus | null>(null);
  // Under the caption (2026-09-27): which voice is saying the line, the session picker, the perf readout.
  const [voiceLine, setVoiceLine] = useState<string | null>(null);
  const [sessionInfo, setSessionInfo] = useState<{ session?: string; sessions: HoloSession[]; filter: string | null }>({ sessions: [], filter: null });
  const [perf, setPerf] = useState(() => params.get('perf') === '1');
  const [perfLine, setPerfLine] = useState('');
  const sessionsRef = useRef<HTMLSelectElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const profilesRef = useRef<HTMLSelectElement>(null);
  const voicesRef = useRef<HTMLSelectElement>(null);
  const monitorsRef = useRef<HTMLSelectElement>(null);

  const note = useCallback((line: string, ms = NOTE_MS): void => {
    liveRef.current.note = { text: line.toUpperCase(), until: performance.now() + ms };
  }, []);

  // The chrome font, loaded into this window's own document.
  useEffect(() => {
    try {
      const font = new FontFace('Departure Mono', `url(${fontUrl})`);
      void font.load().then((f) => document.fonts.add(f)).catch(() => undefined);
    } catch { /* the fallback monospace is fine */ }
  }, []);

  const api = window.skynet;
  const has = useCallback((channel: string): boolean => typeof (api as unknown as Record<string, unknown>)[channel] === 'function', [api]);

  const readStatuses = useCallback((): void => {
    if (has('voice:status')) void api['voice:status']().then((s) => { liveRef.current.voice = s; setVoice(s); }).catch(() => undefined);
    if (has('turn:state')) void api['turn:state']().then((t) => { liveRef.current.turn = t; setTurn(t); }).catch(() => undefined);
    if (has('speech:status')) void api['speech:status']().then(setSpeechStatus).catch(() => setSpeechStatus(null));
    if (has('desktop:status')) void api['desktop:status']().then(setDesktopStatus).catch(() => setDesktopStatus(null));
    if (has('hologram:status')) void api['hologram:status']().then((s) => setDesk(s.desk === true)).catch(() => undefined);
    if (has('dictate:status')) void api['dictate:status']().then(setDictate).catch(() => setDictate(null));
    if (has('desktop:recordStatus')) void api['desktop:recordStatus']().then(setRecStatus).catch(() => setRecStatus(null));
  }, [api, has]);

  useEffect(() => { liveRef.current.speechStatus = speechStatus; }, [speechStatus]);

  /* ────────────────────────── the renderer ────────────────────────── */

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    let renderer: HologramRenderer | null = null;
    try {
      renderer = createHologramRenderer(canvas);
      renderer.setReducedMotion(reducedMotion());
      renderer.start();
      rendererRef.current = renderer;
    } catch (err) {
      console.warn('[hologram] WebGL2 renderer unavailable, drawing the 2D sphere:', message(err));
      setLegacy(true);
      return;
    }
    return () => { renderer?.destroy(); rendererRef.current = null; };
  }, []);

  // Mood and caption, ten times a second, from the three streams. The renderer animates between.
  useEffect(() => {
    const motionless = reducedMotion();
    let lastCaption = '';
    let lastMood: HologramMood = 'off';
    let lastVoiceLine: string | null = null;
    const tick = (): void => {
      // Minimised or hidden: nothing to caption (the render loop is stopped too, renderer.ts).
      if (document.hidden) return;
      const t = performance.now();
      const live = liveRef.current;
      // One source: the turn. The light is the microphone's own tracks, set every tick so nothing
      // else (a desktop step, a line being spoken, a voice phase) can put it out while one is open.
      const current = moodFromTurn(live.turn, live.voice.phase, live.speech, live.desktop);
      if (current !== lastMood) { lastMood = current; setMood(current); rendererRef.current?.setMood(current); }
      rendererRef.current?.setListening(listeningLight(live.turn, live.voice.phase));
      rendererRef.current?.setWaiting(live.turn?.phase === 'waiting');
      rendererRef.current?.setWarming(isWarming(live.speech));
      const warmingLine = isWarming(live.speech) ? 'WARMING THE VOICE' : null;
      const line = live.note && live.note.until > t
        ? live.note.text
        : warmingLine ?? captionForTurn(live.turn, {
          mood: current,
          voice: live.voice.phase,
          voiceError: live.voice.error,
          wakeWord: live.voice.word,
          heard: live.heard,
          said: live.said,
          desktop: live.desktop,
          speech: live.speech,
          streamMode
        });
      if (line !== lastCaption) { lastCaption = line; setCaption(line); }
      // What speaks, while a line is said or held for the server: the truth for THIS line (`via`).
      const saying = live.speech?.speaking === true || isWarming(live.speech);
      const voiceNow = saying ? voiceLabel(live.speechStatus, live.speech?.speaking ? live.speech.via : undefined) : null;
      if (voiceNow !== lastVoiceLine) { lastVoiceLine = voiceNow; setVoiceLine(voiceNow); }
      if (!motionless) return;
    };
    tick();
    const timer = window.setInterval(tick, 100);
    return () => window.clearInterval(timer);
  }, [streamMode]);

  // The 2D fallback: the old dithered sphere, only when WebGL2 refused.
  useEffect(() => {
    if (!legacy) return;
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    const buffer = document.createElement('canvas');
    buffer.width = LOGICAL;
    buffer.height = LOGICAL;
    const bctx = buffer.getContext('2d');
    if (!bctx) return;
    const image = bctx.createImageData(LOGICAL, LOGICAL);
    const rgb = new Map<string, [number, number, number]>();
    const parse = (hex: string): [number, number, number] => {
      let v = rgb.get(hex);
      if (!v) { v = [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)]; rgb.set(hex, v); }
      return v;
    };
    const motionless = reducedMotion();
    let raf = 0;
    const draw = (): void => {
      const t = performance.now();
      const live = liveRef.current;
      const dt = live.lastT ? t - live.lastT : 16;
      live.lastT = t;
      const target = live.speech?.speaking ? live.level : 0;
      live.level = smoothLevel(live.level, target, dt);
      if (live.speech?.speaking) live.level = Math.max(0, live.level - dt / 900);
      const current = moodFromTurn(live.turn, live.voice.phase, live.speech, live.desktop);
      const grid = renderSphere({ size: LOGICAL, t, mood: current, level: live.level, reducedMotion: motionless, flicker: flickerAt(t, motionless) });
      const palette = paletteFor(current);
      const data = image.data;
      for (let i = 0; i < grid.length; i++) {
        const [r, g, b] = parse(palette[grid[i]!] ?? palette[0]!);
        const o = i * 4;
        data[o] = r; data[o + 1] = g; data[o + 2] = b; data[o + 3] = 255;
      }
      bctx.putImageData(image, 0, 0);
      // In device pixels, so the whole-number scale is whole device pixels at any devicePixelRatio.
      const dpr = window.devicePixelRatio || 1;
      const cw = Math.max(1, Math.round(canvas.clientWidth * dpr));
      const ch = Math.max(1, Math.round(canvas.clientHeight * dpr));
      if (canvas.width !== cw || canvas.height !== ch) { canvas.width = cw; canvas.height = ch; }
      const scale = Math.max(1, Math.floor(Math.min(cw, ch) / LOGICAL));
      const side = LOGICAL * scale;
      ctx.imageSmoothingEnabled = false;
      ctx.fillStyle = palette[0]!;
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(buffer, Math.floor((canvas.width - side) / 2), Math.floor((canvas.height - side) / 2), side, side);
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [legacy]);

  /* ────────────────────────── switches and actions ────────────────────────── */

  const flip = useCallback(async (what: 'MIC' | 'SPEECH' | 'DESKTOP', on: boolean): Promise<void> => {
    setBusy(what);
    try {
      if (what === 'MIC') { const s = await api['voice:setEnabled'](on); liveRef.current.voice = s; setVoice(s); }
      if (what === 'SPEECH') setSpeechStatus(await api['speech:setEnabled'](on));
      if (what === 'DESKTOP') {
        setDesktopStatus(await api['desktop:setEnabled'](on));
        // DESK is also the window's layout: monitor one, full height (William, 2026-09-26).
        if (has('hologram:setDesk')) { const st = await api['hologram:setDesk'](on); setDesk(st.desk === true); }
      }
    } catch (err) {
      note(`${what} — ${message(err)}`);
      readStatuses();
    } finally {
      setBusy(null);
    }
  }, [api, has, note, readStatuses]);

  const send = useCallback(async (): Promise<void> => {
    const line = text.trim();
    if (!line) return;
    try {
      const result = await api['voice:typed'](line);
      if (!result.ok) { note('NOT SENT — THE BOARD WINDOW IS NOT OPEN'); return; }
      liveRef.current.heard = line;
      liveRef.current.said = null;
      setText('');
    } catch (err) {
      note(`NOT SENT — ${message(err)}`);
    }
  }, [api, note, text]);

  const halt = useCallback((): void => {
    // STOP (Esc): the turn engine halts the desktop, stops speech and drops a held sentence.
    if (has('turn:stop')) { void api['turn:stop']().catch(() => undefined); return; }
    void api['desktop:halt']().catch(() => undefined);
    void api['speech:stop']().catch(() => undefined);
  }, [api, has]);

  const refreshActions = useCallback(async (): Promise<void> => {
    if (!has('desktop:actionList')) { setActions([]); return; }
    try { setActions(await api['desktop:actionList']()); } catch (err) { setActions([]); note(`COULD NOT LIST ACTIONS — ${message(err)}`); }
  }, [api, has, note]);

  const startRecording = useCallback(async (): Promise<void> => {
    if (!has('desktop:recordStart')) { note('ACTION RECORDING IS NOT IN THIS BUILD — RESTART SKYNETOS'); return; }
    try {
      const r = await api['desktop:recordStart']();
      if (!r.ok) { note(r.error ?? 'COULD NOT START RECORDING'); return; }
      note('RECORDING YOUR ACTIONS — PRESS TRAIN ACTION AGAIN TO STOP', 2500);
      setRecStatus({ recording: true, steps: 0 });
    } catch (err) { note(`COULD NOT START RECORDING — ${message(err)}`); }
  }, [api, has, note]);

  const stopRecording = useCallback(async (): Promise<void> => {
    if (!has('desktop:recordStop')) return;
    try {
      const r = await api['desktop:recordStop']();
      setRecStatus({ recording: false, steps: r.recording?.steps.length ?? 0 });
      if (!r.ok || !r.recording) { note(r.error ?? 'NOTHING WAS RECORDED'); return; }
      setPending(r.recording);
      setPanel('actions');
    } catch (err) { note(`COULD NOT STOP RECORDING — ${message(err)}`); }
  }, [api, has, note]);

  const setTrainAction = useCallback((on: boolean): void => {
    if (on) void startRecording(); else void stopRecording();
  }, [startRecording, stopRecording]);

  const toggleDictate = useCallback(async (): Promise<void> => {
    if (!has('dictate:toggle')) { note('DICTATION IS NOT IN THIS BUILD — RESTART SKYNETOS'); return; }
    try { setDictate(await api['dictate:toggle']()); } catch (err) { note(`DICTATE — ${message(err)}`); }
  }, [api, has, note]);

  const setDictateOn = useCallback((on: boolean): void => {
    const isOn = dictate ? dictate.phase !== 'idle' : false;
    if (on !== isOn) void toggleDictate();
  }, [dictate, toggleDictate]);

  const openDropdown = useCallback((name: HologramDropdown, open: boolean): void => {
    const ref = name === 'profiles' ? profilesRef : name === 'voices' ? voicesRef : name === 'sessions' ? sessionsRef : monitorsRef;
    if (name === 'profiles' || name === 'voices') setPanel('train');
    if (name === 'monitors') setPanel('desk');
    // The select mounts with the panel; give React a frame. The sessions picker is under the caption, on every panel.
    window.setTimeout(() => {
      const el = ref.current;
      if (!el) { note(name === 'sessions' ? 'ONE CLAUDE SESSION — NOTHING TO PICK' : `NO ${name.toUpperCase()} DROPDOWN ON THIS PANEL`); return; }
      if (!open) { el.blur(); return; }
      el.focus();
      try { (el as HTMLSelectElement & { showPicker?: () => void }).showPicker?.(); } catch { /* focus is the fallback */ }
    }, 50);
  }, [note]);

  /** A spoken control (packages/shared/hologram-control.ts): exactly what the click would do. */
  const performControl = useCallback((control: HologramControl): void => {
    note(describeControl(control), CONTROL_CAPTION_MS);
    const effect = controlEffect(control);
    switch (effect.kind) {
      case 'panel':
        setPanel(effect.panel);
        if (effect.panel === 'say') window.setTimeout(() => inputRef.current?.focus(), 30);
        return;
      case 'dropdown':
        openDropdown(effect.name, effect.open);
        return;
      case 'toggle':
        if (effect.which === 'talkback') void flip('SPEECH', effect.on);
        else if (effect.which === 'mic') void flip('MIC', effect.on);
        else if (effect.which === 'desk') void flip('DESKTOP', effect.on);
        else if (effect.which === 'dictate') setDictateOn(effect.on);
        else if (effect.which === 'train-action') { setPanel('desk'); setTrainAction(effect.on); }
        return;
      case 'press': {
        const target = panelForButton(effect.id);
        if (target) setPanel((p) => (p === target ? 'main' : target));
        window.setTimeout(() => {
          const el = document.querySelector<HTMLElement>(`[data-control="${effect.id}"]`);
          if (!el) { note(`NO ${effect.id.replace(/^btn-/, '').replace(/-/g, ' ').toUpperCase()} ON THIS PANEL`); return; }
          if (el instanceof HTMLInputElement || el instanceof HTMLSelectElement) el.focus();
          else if (!target) el.click();
        }, 50);
        return;
      }
      case 'call':
        void (api as unknown as Record<string, () => Promise<unknown>>)[effect.channel]?.().catch((err: unknown) => note(message(err)));
        return;
    }
  }, [api, flip, note, openDropdown, setDictateOn, setTrainAction]);

  const performRef = useRef(performControl);
  performRef.current = performControl;

  // Events: the streams. Nothing here is polled but the recorder's status while it runs.
  useEffect(() => {
    readStatuses();
    const on = api.on.bind(api) as (event: string, handler: (payload: never) => void) => () => void;
    const offs: (() => void)[] = [
      api.on('voice:state', (status) => { liveRef.current.voice = status; setVoice(status); }),
      on('turn:state', (state: TurnState) => { liveRef.current.turn = state; setTurn(state); }),
      api.on('voice:wake', () => { liveRef.current.heard = null; liveRef.current.said = null; }),
      api.on('voice:heard', (sentence) => {
        if (sentence.text) liveRef.current.heard = sentence.text;
        if (sentence.error) note(sentence.error);
      }),
      api.on('speech:state', (state) => {
        const live = liveRef.current;
        // A line starts or is held: read the status again, so the voice line names the voice as it is now.
        const starting = (state.speaking && !live.speech?.speaking) || (state.warming === true && live.speech?.warming !== true);
        if (starting && has('speech:status')) void api['speech:status']().then(setSpeechStatus).catch(() => undefined);
        live.speech = state;
        if (state.text) live.said = state.text;
        if (typeof state.level === 'number') live.level = Math.max(live.level, Math.min(1, Math.max(0, state.level)));
      }),
      api.on('desktop:state', (state) => {
        liveRef.current.desktop = state;
        if (!state.busy && state.message) liveRef.current.said = state.message;
        // Not busy: a plan ended, or the switch moved somewhere else (the tray). The DESK switch
        // shows the setting as it is now.
        if (!state.busy && has('desktop:status')) void api['desktop:status']().then(setDesktopStatus).catch(() => undefined);
      }),
      on('speech:levels', (levels) => rendererRef.current?.setSpeechLevels(levels)),
      on('voice:levels', (levels) => rendererRef.current?.setMicLevels(levels)),
      // Stream mode: what was touched, never what it says (docs/07 § Streaming safety).
      on('hologram:scene', (scene: HoloScene) => {
        rendererRef.current?.setScene(streamMode ? redactScene(scene) : scene);
        setSessionInfo({ session: scene.session, sessions: scene.sessions ?? [], filter: scene.filter ?? null });
      }),
      on('hologram:control', (control) => performRef.current(control)),
      on('dictate:state', (status) => setDictate(status)),
      // Main pushes the recorder's light on every change (fork H); the poll below is the backstop.
      on('desktop:recordState', (status: RecordStatus) => setRecStatus(status))
    ];
    return () => { for (const off of offs) off(); };
  }, [api, has, note, readStatuses, streamMode]);

  // While a recording runs, its step count and any pause reason, twice a second.
  useEffect(() => {
    if (!recStatus?.recording || !has('desktop:recordStatus')) return;
    const timer = window.setInterval(() => {
      void api['desktop:recordStatus']().then(setRecStatus).catch(() => undefined);
    }, RECORD_POLL_MS);
    return () => window.clearInterval(timer);
  }, [api, has, recStatus?.recording]);

  useEffect(() => { if (panel === 'actions' && actions === null) void refreshActions(); }, [actions, panel, refreshActions]);

  // TRAIN open: which voice will speak, re-read every few seconds (WARMING becomes READY on its own).
  useEffect(() => {
    if (panel !== 'train' || !has('speech:status')) return;
    const timer = window.setInterval(() => { void api['speech:status']().then(setSpeechStatus).catch(() => undefined); }, VOICE_POLL_MS);
    return () => window.clearInterval(timer);
  }, [api, has, panel]);

  // The perf readout: Ctrl+Shift+P toggles it; `?perf=1` (SKYNET_PERF) starts with it on.
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (!(event.ctrlKey && event.shiftKey && (event.key === 'P' || event.key === 'p'))) return;
      event.preventDefault();
      setPerf((on) => !on);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  useEffect(() => {
    if (!perf) return;
    const read = (): void => {
      const r = rendererRef.current;
      setPerfLine(r ? frameReadout(r.stats().window, r.stats().paused) : legacy ? '2D FALLBACK · no GL stats' : 'no renderer');
    };
    read();
    const timer = window.setInterval(read, PERF_POLL_MS);
    return () => window.clearInterval(timer);
  }, [legacy, perf]);

  const chooseSession = useCallback(async (id: string): Promise<void> => {
    if (!has('hologram:setSessionFilter')) { note('THE SESSION PICKER IS NOT IN THIS BUILD — RESTART SKYNETOS'); return; }
    try {
      const r = await api['hologram:setSessionFilter'](id || null);
      if (!r.ok) { note(r.error ?? 'COULD NOT CHOOSE THAT SESSION'); return; }
      setSessionInfo((info) => ({ ...info, filter: r.filter }));
      const label = sessionInfo.sessions.find((x) => x.id === r.filter)?.label ?? 'ONE SESSION';
      note(r.filter ? `SHOWING ${label}` : 'SHOWING EVERY SESSION', 1500);
    } catch (err) { note(`SESSIONS — ${message(err)}`); }
  }, [api, has, note, sessionInfo.sessions]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      if (panel !== 'main') { setPanel('main'); return; }
      halt();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [halt, panel]);

  const micOn = voice.enabled && voice.phase !== 'off';
  const micLabel = voice.phase === 'off' ? 'MIC' : voice.phase === 'unavailable' ? 'MIC ✕' : voice.phase === 'starting' ? 'MIC …' : 'MIC ●';
  const deskOn = desktopStatus?.enabled === true;
  const dictating = dictate ? dictate.phase !== 'idle' : false;
  const togglePanel = (which: HologramPanel): void => setPanel((p) => (p === which ? 'main' : which));

  return (
    <div className={`holo-root mood-${mood}${desk ? ' desk' : ''}`} style={{ '--holo-scale': frame.scale } as React.CSSProperties}>
      <div className={`holo-nav hologram-nav${frame.nav.rows === 2 ? ' rows-2' : ''}${frame.nav.icons ? ' icons' : ''}`}>
        <button
          type="button"
          data-control="btn-mic"
          className={micOn ? 'btn holo-btn on' : 'btn holo-btn'}
          aria-pressed={micOn}
          disabled={busy === 'MIC'}
          onClick={() => void flip('MIC', !micOn)}
          title={micOn ? `Microphone on: ${voice.phase}. Click to switch voice off (the hard mute).` : 'Switch voice on: listens for the wake phrase only.'}
        >
          <NavLabel icon="mic" text={micLabel} icons={frame.nav.icons} />
        </button>
        <button
          type="button"
          data-control="btn-say"
          className={speechStatus?.enabled ? 'btn holo-btn on' : 'btn holo-btn'}
          aria-pressed={speechStatus?.enabled === true}
          disabled={busy === 'SPEECH'}
          onClick={() => void flip('SPEECH', !(speechStatus?.enabled === true))}
          title={speechStatus ? `Talk back: ${speechStatus.enabled ? 'on' : 'off'}${speechStatus.voice ? ` · ${speechStatus.voice}` : ''}${speechStatus.warm ? ' · profile warm' : ''}${speechStatus.error ? ` · ${speechStatus.error}` : ''}` : 'Talk back'}
        >
          <NavLabel icon="face" text="SAY" icons={frame.nav.icons} />
        </button>
        <button
          type="button"
          data-control="btn-desk"
          className={deskOn ? 'btn holo-btn on warn' : panel === 'desk' ? 'btn holo-btn on' : 'btn holo-btn'}
          aria-pressed={deskOn}
          disabled={busy === 'DESKTOP'}
          onClick={() => togglePanel('desk')}
          title={`Desktop control panel. ${deskOn ? 'ON: a spoken or typed command can launch programs, place windows and MOVE THE MOUSE.' : 'Off.'} ${desktopStatus?.error ?? ''}`.trim()}
        >
          <NavLabel icon="hand" text="DESK" icons={frame.nav.icons} />
        </button>
        <button type="button" data-control="btn-train" className={panel === 'train' ? 'btn holo-btn on' : 'btn holo-btn'} aria-pressed={panel === 'train'} onClick={() => togglePanel('train')} title="Record your own voice profile, line by line, and choose which voice speaks">
          <NavLabel icon="usage" text="TRAIN" icons={frame.nav.icons} />
        </button>
        <button type="button" data-control="btn-actions" className={panel === 'actions' ? 'btn holo-btn on' : 'btn holo-btn'} aria-pressed={panel === 'actions'} onClick={() => togglePanel('actions')} title="Saved actions: what TRAIN ACTION recorded, and PLAY">
          <NavLabel icon="list" text="ACTS" icons={frame.nav.icons} />
        </button>
        <button
          type="button"
          data-control="btn-dictate"
          className={dictating ? 'btn holo-btn on' : 'btn holo-btn'}
          aria-pressed={dictating}
          onClick={() => void toggleDictate()}
          title={dictate ? `Dictate: one press to start, one to stop; typed into the window that has focus.${dictate.hotkeyOk ? ` Hotkey ${dictate.hotkey}.` : ` (hotkey ${dictate.hotkey} is held by another program)`}` : 'Dictate into the focused window'}
        >
          <NavLabel icon="text" text={dictating ? 'DICT ●' : 'DICT'} icons={frame.nav.icons} />
        </button>
        <button type="button" data-control="btn-minimise" className="btn holo-btn holo-small" onClick={() => void api['hologram:minimize']().catch(() => undefined)} aria-label="Minimise" title="Minimise to the taskbar">
          <NavLabel icon="minus" text="_" icons={frame.nav.icons} />
        </button>
        <button
          type="button"
          data-control="btn-close"
          className="btn holo-btn holo-small"
          onClick={() => void (has('hologram:close') ? api['hologram:close']() : api['hologram:minimize']()).catch(() => undefined)}
          aria-label="Close"
          title="Close this window. Voice keeps running; the VOICE button on the board brings it back. Say 'Jarvis, shut yourself down' to stop voice too."
        >
          <NavLabel icon="close" text="✕" icons={frame.nav.icons} />
        </button>
      </div>

      <div className="holo-stage" ref={stageRef}>
        <canvas
          ref={canvasRef}
          className={legacy ? 'holo-canvas legacy' : 'holo-canvas'}
          aria-hidden="true"
          style={{ width: frame.square.side, height: frame.square.side, left: frame.square.left, top: frame.square.top }}
        />
        {panel === 'train' ? <TrainPanel onDone={() => setPanel('main')} note={note} profilesRef={profilesRef} voicesRef={voicesRef} status={speechStatus} onStatus={setSpeechStatus} /> : null}
        {panel === 'desk' ? (
          <DeskPanel
            status={desktopStatus}
            deskLayout={desk}
            busy={busy === 'DESKTOP'}
            recording={recStatus}
            monitorsRef={monitorsRef}
            onToggleDesk={(on) => void flip('DESKTOP', on)}
            onTrainAction={() => setTrainAction(!(recStatus?.recording === true))}
            onDone={() => setPanel('main')}
          />
        ) : null}
        {panel === 'actions' ? (
          <ActionsPanel
            pending={pending}
            actions={actions}
            onSave={async (name, description) => {
              if (!pending) return;
              try {
                const r = await api['desktop:actionSave']({ name, description, recording: pending });
                if (!r.ok) { note(r.error ?? 'COULD NOT SAVE THE ACTION'); return; }
                setPending(null);
                note(`SAVED — SAY "JARVIS, DO ${name.toUpperCase()}"`, 3000);
                await refreshActions();
              } catch (err) { note(`COULD NOT SAVE — ${message(err)}`); }
            }}
            onDiscard={() => { setPending(null); note('RECORDING DISCARDED', 1500); }}
            onRun={async (action) => {
              try {
                const r = await api['desktop:actionRun']({ id: action.id });
                if (!r.ok) note(r.error ?? 'COULD NOT RUN IT');
              } catch (err) { note(`COULD NOT RUN — ${message(err)}`); }
            }}
            onRefresh={() => void refreshActions()}
            onDone={() => setPanel('main')}
          />
        ) : null}
      </div>

      <div className="holo-caption" role="status" aria-live="polite">{caption}</div>
      <TurnStrip turn={turn} streamMode={streamMode} onStop={halt} />
      {voiceLine ? <div className="holo-voice-line" title="Which voice is saying this line">{voiceLine}</div> : null}
      {showSessionPicker(sessionInfo.sessions) ? (
        <select
          ref={sessionsRef}
          data-control="dropdown-sessions"
          className="holo-select holo-session-picker"
          value={sessionInfo.filter ?? ''}
          onChange={(e) => void chooseSession(e.target.value)}
          aria-label="Which Claude Code session the globe shows"
          title="More than one Claude Code session has worked in the last ten minutes. ALL shows every one; a session shows only what it touches."
        >
          {sessionOptions(sessionInfo.sessions).map((o) => <option key={o.value || 'all'} value={o.value}>{o.label}</option>)}
        </select>
      ) : sessionInfo.session ? (
        <div className="holo-session-label" title="The Claude Code session the centre came from">{sessionInfo.session}</div>
      ) : null}
      {perf ? <div className="holo-perf" aria-hidden="true">{perfLine}</div> : null}

      <form className="holo-input-row" onSubmit={(e) => { e.preventDefault(); void send(); }}>
        <input
          ref={inputRef}
          data-control="input-text"
          className="holo-input"
          type="text"
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={deskOn ? 'open firefox on two' : 'type a command'}
          aria-label="A command, typed instead of spoken"
          spellCheck={false}
        />
        <button type="submit" data-control="btn-send" className="btn holo-btn" disabled={!text.trim()} title="Send it the way the microphone would (Enter)">
          ↵
        </button>
      </form>

      {desk ? null : <SizeGrip />}
    </div>
  );
}

/* ────────────────────────── DESK: desktop control, monitors, TRAIN ACTION ────────────────────────── */

function DeskPanel(props: {
  status: DesktopStatus | null;
  deskLayout: boolean;
  busy: boolean;
  recording: RecordStatus | null;
  monitorsRef: React.RefObject<HTMLSelectElement>;
  onToggleDesk: (on: boolean) => void;
  onTrainAction: () => void;
  onDone: () => void;
}): React.JSX.Element {
  const { status, deskLayout, busy, recording, monitorsRef, onToggleDesk, onTrainAction, onDone } = props;
  const on = status?.enabled === true;
  const rec = recording?.recording === true;
  return (
    <div className="holo-panel" role="dialog" aria-label="Desktop control">
      <div className="holo-train-row">
        <button
          type="button"
          className={on ? 'btn holo-btn on warn' : 'btn holo-btn primary'}
          disabled={busy}
          onClick={() => onToggleDesk(!on)}
          aria-pressed={on}
          title="With this ON, a spoken or typed command can launch programs, place windows and MOVE THE MOUSE. The window moves to monitor one, full height."
        >
          {on ? 'DESK ON ●' : 'DESK OFF'}
        </button>
        <span className="holo-count">{status?.error ? status.error.toUpperCase() : on ? (deskLayout ? 'ON MONITOR ONE, FULL HEIGHT' : 'CONTROL ON') : 'CONTROL OFF — NOTHING MOVES'}</span>
        <button type="button" className="btn holo-btn" onClick={onDone} aria-label="Close the panel">✕</button>
      </div>
      <div className="holo-train-row">
        <select ref={monitorsRef} data-control="dropdown-monitors" className="holo-select" aria-label="Monitors, as spoken" defaultValue="" title="Which screen is 'one', 'two', 'three' in a spoken command. Primary first, then left to right.">
          <option value="" disabled>{status?.monitors.length ? `${status.monitors.length} MONITOR${status.monitors.length === 1 ? '' : 'S'}` : 'NO MONITOR LIST YET'}</option>
          {(status?.monitors ?? []).map((m) => (
            <option key={m.id} value={String(m.index)}>{m.index} · {m.label || `${m.width}×${m.height}`}{m.primary ? ' · primary' : ''}</option>
          ))}
        </select>
      </div>
      <div className="holo-line">
        {on
          ? rec
            ? `RECORDING · ${recording?.steps ?? 0} STEP${recording?.steps === 1 ? '' : 'S'}${recording?.pausedFor ? ` · PAUSED: ${recording.pausedFor.toUpperCase()}` : ''}`
            : 'TRAIN ACTION WATCHES YOUR MOUSE AND KEYBOARD ON THE WHOLE PC WHILE ITS LIGHT IS ON. PRESS AGAIN TO STOP AND NAME WHAT YOU DID.'
          : 'SWITCH DESK ON TO TRAIN AN ACTION.'}
      </div>
      {on ? (
        <button
          type="button"
          data-control="btn-train-action"
          className={rec ? 'btn holo-btn holo-wide on rec' : 'btn holo-btn holo-wide primary'}
          aria-pressed={rec}
          onClick={onTrainAction}
          title={rec ? 'Stop recording and name the action' : 'Record what you do next: every click and key, with the window it happened in'}
        >
          {rec ? '● RECORDING — PRESS TO STOP' : 'TRAIN ACTION'}
        </button>
      ) : null}
    </div>
  );
}

/* ────────────────────────── ACTIONS: the save screen and the list ────────────────────────── */

function ActionsPanel(props: {
  pending: ActionRecording | null;
  actions: SavedAction[] | null;
  onSave: (name: string, description: string) => Promise<void>;
  onDiscard: () => void;
  onRun: (action: SavedAction) => Promise<void>;
  onRefresh: () => void;
  onDone: () => void;
}): React.JSX.Element {
  const { pending, actions, onSave, onDiscard, onRun, onRefresh, onDone } = props;
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [saving, setSaving] = useState(false);
  const steps = pending ? summariseSteps(pending.steps) : [];
  if (pending) {
    return (
      <form className="holo-panel" role="dialog" aria-label="Save the recorded action" onSubmit={(e) => { e.preventDefault(); if (!name.trim() || saving) return; setSaving(true); void onSave(name.trim(), description.trim()).finally(() => setSaving(false)); }}>
        <div className="holo-train-row">
          <span className="holo-count">{pending.steps.length} STEP{pending.steps.length === 1 ? '' : 'S'} · {Math.round(pending.durationMs / 1000)} S</span>
          <button type="button" className="btn holo-btn" onClick={onDone} aria-label="Close the panel">✕</button>
        </div>
        <input className="holo-input" type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="name it: open the stream scene" aria-label="Action name" spellCheck={false} autoFocus />
        <input className="holo-input" type="text" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="what it does, one line" aria-label="Action description" spellCheck={false} />
        <ol className="holo-steps" aria-label="Recorded steps">
          {steps.map((line, i) => <li key={i}>{line}</li>)}
        </ol>
        <div className="holo-train-row">
          <button type="submit" data-control="btn-save-action" className="btn holo-btn primary" disabled={!name.trim() || saving}>{saving ? 'SAVING…' : 'SAVE'}</button>
          <button type="button" data-control="btn-discard-action" className="btn holo-btn" onClick={onDiscard}>DISCARD</button>
        </div>
      </form>
    );
  }
  return (
    <div className="holo-panel" role="dialog" aria-label="Saved actions">
      <div className="holo-train-row">
        <span className="holo-count">{actions === null ? 'READING…' : `${actions.length} SAVED ACTION${actions.length === 1 ? '' : 'S'}`}</span>
        <button type="button" className="btn holo-btn" onClick={onRefresh} title="Read the list again">↻</button>
        <button type="button" className="btn holo-btn" onClick={onDone} aria-label="Close the panel">✕</button>
      </div>
      {actions && actions.length === 0 ? <div className="holo-line">NO SAVED ACTIONS. DESK → TRAIN ACTION RECORDS ONE; THEN "JARVIS, DO ‹NAME›".</div> : null}
      <ul className="holo-actions" aria-label="Saved actions">
        {(actions ?? []).map((a) => (
          <li key={a.id} className="holo-action">
            <button type="button" className="btn holo-btn" onClick={() => void onRun(a)} title={`Play "${a.name}" now: ${a.summary.length} steps. Esc stops it.`} aria-label={`Play ${a.name}`}>▶</button>
            <span className="holo-action-name" title={a.description || a.name}>{a.name}</span>
            <span className="holo-action-meta">{a.summary.length} · {a.createdAt.slice(0, 10)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/* ────────────────────────── TRAIN: the voice-profile recorder ────────────────────────── */

function nextLine(profile: VoiceProfile | null): ProfileLine | null {
  return profile?.lines.find((l) => l.source !== 'imported' && l.file === null) ?? null;
}

function TrainPanel({ onDone, note, profilesRef, voicesRef, status, onStatus }: {
  onDone: () => void;
  note: (line: string) => void;
  profilesRef: React.RefObject<HTMLSelectElement>;
  voicesRef: React.RefObject<HTMLSelectElement>;
  /** The speech status the whole window reads; the indicator, the toggle and the voices all come from it. */
  status: SpeechStatus | null;
  onStatus: (status: SpeechStatus) => void;
}): React.JSX.Element {
  const voices = status?.voices ?? [];
  const [profiles, setProfiles] = useState<VoiceProfileSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [chosen, setChosen] = useState<string | null>(null);
  const [profile, setProfile] = useState<VoiceProfile | null>(null);
  const [recording, setRecording] = useState(false);
  const [last, setLast] = useState<ProfileLine | null>(null);
  const [result, setResult] = useState<string | null>(null);
  // Which voice speaks (2026-09-27): the indicator says what WILL speak, from the status main reports
  // (`voiceLabel`); the toggle reads as what a press does (`useVoiceAction`); a failed switch says why.
  const [voiceNote, setVoiceNote] = useState<string | null>(null);
  const action = useVoiceAction(status, chosen);
  const current = windowsVoiceName(status?.voice);

  const useVoice = async (): Promise<void> => {
    if (!chosen) return;
    try {
      const st = await window.skynet['speech:setBackend']({ backend: action.backend, profile: chosen });
      onStatus(st);
      setVoiceNote(st.error ? `${action.backend === 'server' ? 'THE PROFILE CANNOT SPEAK' : 'SWITCHED'} — ${st.error}`.toUpperCase() : null);
    } catch (err) {
      setVoiceNote(`COULD NOT SWITCH THE VOICE — ${message(err)}`.toUpperCase());
    }
  };

  // The voices dropdown: sets `speech.voice` (the Windows voice, and the fallback for a profile) and says it.
  const chooseWindowsVoice = async (name: string): Promise<void> => {
    if (!name || typeof window.skynet['speech:setVoice'] !== 'function') return;
    try {
      const st = await window.skynet['speech:setVoice'](name);
      onStatus(st);
      const now = windowsVoiceName(st.voice) ?? name;
      setVoiceNote(null);
      note(st.backend === 'sapi' ? `WINDOWS VOICE · ${now}` : `WINDOWS VOICE · ${now} (WHEN THE PROFILE CANNOT SPEAK)`);
      // Said in the new voice, when that is the voice that speaks.
      if (st.enabled && st.backend === 'sapi' && typeof window.skynet['speech:say'] === 'function') {
        void window.skynet['speech:say']({ text: `This is ${now}.`, interrupt: true }).catch(() => undefined);
      }
    } catch (err) {
      setVoiceNote(`COULD NOT CHOOSE THAT VOICE — ${message(err)}`.toUpperCase());
    }
  };

  const refresh = useCallback(async (): Promise<void> => {
    try {
      const list = await window.skynet['profile:list']();
      setProfiles(list);
      setError(null);
      if (!chosen && list.length) setChosen(list[0]!.name);
    } catch (err) {
      setProfiles([]);
      setError(message(err));
    }
  }, [chosen]);

  useEffect(() => { void refresh(); }, [refresh]);

  useEffect(() => {
    if (!chosen) { setProfile(null); return; }
    let live = true;
    void window.skynet['profile:read'](chosen).then((p) => { if (live) setProfile(p); }).catch((err: unknown) => { if (live) setError(message(err)); });
    return () => { live = false; };
  }, [chosen, result]);

  const create = async (): Promise<void> => {
    const n = name.trim();
    if (!n) return;
    try {
      const r = await window.skynet['profile:create'](n);
      if (!r.ok) { setError(r.error ?? 'COULD NOT CREATE THE PROFILE'); return; }
      setName('');
      setChosen(n);
      await refresh();
    } catch (err) {
      setError(message(err));
    }
  };

  const record = async (): Promise<void> => {
    const line = nextLine(profile);
    if (!chosen || !line) return;
    setRecording(true);
    setResult(null);
    try {
      const r = await window.skynet['profile:record']({ profile: chosen, lineId: line.id, maxMs: RECORD_MAX_MS });
      if (!r.ok) { setError(r.error ?? 'NOT RECORDED'); setResult(null); }
      else {
        setError(null);
        setLast(r.line ?? null);
        const done = profile?.lines.filter((l) => l.source !== 'imported' && l.file !== null).length ?? 0;
        setResult(`RECORDED ${done + 1} OF ${profile?.lines.filter((l) => l.source !== 'imported').length ?? 0}`);
      }
    } catch (err) {
      setError(message(err));
    } finally {
      setRecording(false);
    }
  };

  const play = async (which: ProfileLine | null = last): Promise<void> => {
    if (!chosen || !which) return;
    try {
      const r = await window.skynet['profile:play']({ profile: chosen, lineId: which.id });
      if (!r.ok) note(r.error ?? 'COULD NOT PLAY IT');
    } catch (err) {
      note(message(err));
    }
  };

  // Imported clips (npm run profile:import): each shows its file, plays, and takes its transcript.
  const setText = async (which: ProfileLine, text: string): Promise<void> => {
    if (!chosen || text === which.text) return;
    try {
      const r = await window.skynet['profile:setText']({ profile: chosen, lineId: which.id, text });
      if (!r.ok) { note(r.error ?? 'COULD NOT SAVE THE TRANSCRIPT'); return; }
      setProfile((p) => (p ? { ...p, lines: p.lines.map((l) => (l.id === which.id ? { ...l, text } : l)) } : p));
    } catch (err) {
      note(message(err));
    }
  };

  const line = nextLine(profile);
  const scripted = profile?.lines.filter((l) => l.source !== 'imported') ?? [];
  const importedLines = profile?.lines.filter((l) => l.source === 'imported') ?? [];
  const recorded = scripted.filter((l) => l.file !== null).length;
  const total = scripted.length;

  return (
    <div className="holo-panel holo-train" role="dialog" aria-label="Voice profile recorder">
      <div className="holo-train-row">
        <select ref={profilesRef} data-control="dropdown-profiles" className="holo-select" value={chosen ?? ''} onChange={(e) => setChosen(e.target.value || null)} aria-label="Voice profile" disabled={!profiles?.length}>
          {profiles?.length ? profiles.map((p) => <option key={p.name} value={p.name}>{p.name} · {p.recorded}/{p.total} scripted{p.imported ? ` · ${p.imported} imported` : ''}{p.trained ? ' · fitted' : ''}</option>) : <option value="">no profiles yet</option>}
        </select>
        <button type="button" className="btn holo-btn" onClick={onDone} aria-label="Close the recorder">✕</button>
      </div>
      <div className="holo-train-row">
        <button
          type="button"
          data-control="btn-use-voice"
          className={action.backend === 'sapi' ? 'btn holo-btn on' : 'btn holo-btn'}
          disabled={!chosen && action.backend === 'server'}
          onClick={() => void useVoice()}
          title={action.backend === 'server'
            ? "Speak with this profile through the synthesis server (docs/11 § Installing a synthesis server). Falls back to Windows' voice whenever the server is down, and the line below says so."
            : "Go back to Windows' own voice (the one chosen in the voices list)."}
        >
          {action.label}
        </button>
      </div>
      <div className="holo-voice-now" data-backend={status?.backend ?? 'unknown'} role="status" aria-live="polite" title="The voice the next line will be spoken in">
        {voiceLabel(status)}
      </div>
      {voiceNote ? <div className="holo-train-error">{voiceNote}</div> : null}
      <div className="holo-train-row">
        <select
          ref={voicesRef}
          data-control="dropdown-voices"
          className="holo-select"
          aria-label="Windows voice"
          value={current && voices.includes(current) ? current : ''}
          onChange={(e) => void chooseWindowsVoice(e.target.value)}
          disabled={!voices.length}
          title="Windows' voice: what speaks when the backend is Windows, and when a profile cannot. An en-GB voice is added in Windows Settings → Time & Language → Speech."
        >
          <option value="" disabled>{voices.length ? `${voices.length} WINDOWS VOICE${voices.length === 1 ? '' : 'S'}` : 'WINDOWS VOICES UNKNOWN UNTIL SAY IS ON'}</option>
          {voices.map((v) => <option key={v} value={v}>{v}</option>)}
        </select>
      </div>
      <form className="holo-train-row" onSubmit={(e) => { e.preventDefault(); void create(); }}>
        <input className="holo-input" type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="new profile name" aria-label="New profile name" spellCheck={false} />
        <button type="submit" data-control="btn-create-profile" className="btn holo-btn" disabled={!name.trim()}>CREATE</button>
      </form>
      {error ? <div className="holo-train-error">{error.toUpperCase()}</div> : null}
      {profile ? (
        line ? (
          <>
            <div className="holo-line" aria-live="polite">{line.text}</div>
            <div className="holo-train-row">
              <button type="button" data-control="btn-record" className={recording ? 'btn holo-btn on' : 'btn holo-btn primary'} disabled={recording} onClick={() => void record()} title="Read the line above, then stop. Up to 12 seconds.">
                {recording ? 'LISTENING…' : 'RECORD'}
              </button>
              <button type="button" data-control="btn-play" className="btn holo-btn" disabled={!last || recording} onClick={() => void play()} title="Play the last line back">PLAY</button>
              <span className="holo-count">{result ?? `${recorded} OF ${total}`}</span>
            </div>
          </>
        ) : (
          <div className="holo-line">EVERY LINE IS RECORDED: {recorded} OF {total}. {profile.trained ? 'FITTED.' : 'READY TO FIT (docs/11).'}</div>
        )
      ) : profiles && !profiles.length && !error ? (
        <div className="holo-line">NAME A PROFILE AND PRESS CREATE, THEN READ EACH LINE.</div>
      ) : null}
      {importedLines.length ? (
        <ul className="holo-imports" aria-label="Imported clips">
          {importedLines.map((l) => (
            <li key={l.id} className={l.text ? 'holo-import' : 'holo-import needs'}>
              <button type="button" className="btn holo-btn" onClick={() => void play(l)} title={`Play ${l.original ?? l.file ?? l.id} (${(l.ms / 1000).toFixed(1)} s)`} aria-label={`Play ${l.original ?? l.id}`}>▶</button>
              <span className="holo-import-name" title={l.original ?? l.file ?? ''}>{l.original ?? l.id}</span>
              <input
                className="holo-input holo-import-text"
                type="text"
                defaultValue={l.text}
                placeholder="NEEDS A TRANSCRIPT — type what is said"
                aria-label={`Transcript of ${l.original ?? l.id}`}
                spellCheck={false}
                onBlur={(e) => void setText(l, e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); (e.target as HTMLInputElement).blur(); } }}
              />
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
