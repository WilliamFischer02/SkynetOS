import { useEffect, useRef, useState } from 'react';
import { create } from 'zustand';
import type { AwayLogEvent, AwayLogItem, AwayStatus } from '@shared/away.js';
import { AWAY_MAX_LINES } from '@shared/away.js';
import { AWAY_MODES, MAX_AWAY_MINUTES, MIN_AWAY_MINUTES, type AwayMode } from '@shared/presence.js';
import { useBoardStore } from '../store/useBoardStore.js';
import './away.css';

/**
 * Away (sleep) mode, on screen.
 *
 * William: "When that time elapses the graphic appears and a centered window with the autonomous
 * claude Jarvis head session would appear on screen and start to autonomously chat with itself /
 * work and log work completed since user was away in a summarized list below the sleep / away
 * graphic screen. As soon as the user provides any form of input, the log / write-up of work
 * completed away should appear, then spacebar reopens the main view of the board as usual."
 *
 * So there are three views: hidden (the board), away (the sleeping chip, the live session window
 * and the growing list), and report (the write-up). The "JARVIS head session" in the window is JARVIS
 * Prime running headless, streamed from main. The claude.ai conversation is never automated; see
 * packages/shared/away.ts.
 */

type View = 'hidden' | 'away' | 'report';

interface AwayUi {
  status: AwayStatus | null;
  view: View;
  /** A report is waiting behind the HUD chip. */
  reportAvailable: boolean;
  setStatus: (status: AwayStatus, initial?: boolean) => void;
  appendLog: (event: AwayLogEvent) => void;
  setView: (view: View) => void;
  dismiss: () => void;
}

export const useAway = create<AwayUi>((set, get) => ({
  status: null,
  view: 'hidden',
  reportAvailable: false,
  setStatus: (status, initial = false) => {
    const previous = get().status;
    let { view, reportAvailable } = get();
    if (status.phase === 'away') {
      view = 'away';
      reportAvailable = false;
    } else if (status.phase === 'woken' && (previous?.phase === 'away' || view === 'away')) {
      view = 'report';
      reportAvailable = true;
    } else if (initial && status.phase === 'woken' && (status.items.length || status.lines.length)) {
      // A reload after he came back: the report is still there, behind the chip.
      reportAvailable = true;
    }
    set({ status, view, reportAvailable });
  },
  appendLog: (event) => set((s) => {
    if (!s.status) return {};
    return {
      status: {
        ...s.status,
        lines: event.line ? [...s.status.lines, event.line].slice(-AWAY_MAX_LINES) : s.status.lines,
        items: event.item ? [...s.status.items, event.item] : s.status.items
      }
    };
  }),
  setView: (view) => set({ view }),
  dismiss: () => set({ view: 'hidden', reportAvailable: false })
}));
// For the smoke harness's READ-ONLY layout probe, which shows the AWAY REPORT chip (see useBoardStore's __skynetStore).
if (typeof window !== 'undefined') (window as unknown as { __skynetAway?: typeof useAway }).__skynetAway = useAway;

/** The bridge is built when the window opens; an app started before away mode has none of this. */
function awayBridge(): boolean {
  return typeof (window.skynet as unknown as Record<string, unknown>)['away:status'] === 'function';
}

/* ────────────────────────── the sleeping chip ────────────────────────── */

const HEAD = [
  '....#.#.#.#.#.#.....',
  '...################.',
  '...#dddddddddddddd#.',
  '..##dddddddddddddd##',
  '...#ddsssddddsssdd#.',
  '..##dddddddddddddd##',
  '...#dddddddddddddd#.',
  '..##ddddddggdddddd##',
  '...#dddddddddddddd#.',
  '...################.',
  '....#.#.#.#.#.#.....'
];
const Z = ['#####', '...#.', '..#..', '.#...', '#####'];
const PX: Record<string, string> = { '#': 'away-px-copper', d: 'away-px-dark', s: 'away-px-silk', g: 'away-px-signal' };

function Bitmap({ rows, className }: { rows: string[]; className: string }): React.JSX.Element {
  return (
    <svg className={className} viewBox={`0 0 ${rows[0]!.length} ${rows.length}`} shapeRendering="crispEdges" aria-hidden="true">
      {rows.flatMap((row, y) => [...row].map((c, x) => (PX[c] ? <rect key={`${x},${y}`} x={x} y={y} width={1} height={1} className={PX[c]} /> : null)))}
    </svg>
  );
}

function SleepingChip(): React.JSX.Element {
  return (
    <div className="away-art">
      <Bitmap rows={HEAD} className="away-head" />
      <svg className="away-z z1" viewBox="0 0 5 5" shapeRendering="crispEdges" aria-hidden="true">
        {Z.flatMap((row, y) => [...row].map((c, x) => (c === '#' ? <rect key={`${x},${y}`} x={x} y={y} width={1} height={1} /> : null)))}
      </svg>
      <svg className="away-z z2" viewBox="0 0 5 5" shapeRendering="crispEdges" aria-hidden="true">
        {Z.flatMap((row, y) => [...row].map((c, x) => (c === '#' ? <rect key={`${x},${y}`} x={x} y={y} width={1} height={1} /> : null)))}
      </svg>
      <svg className="away-z z3" viewBox="0 0 5 5" shapeRendering="crispEdges" aria-hidden="true">
        {Z.flatMap((row, y) => [...row].map((c, x) => (c === '#' ? <rect key={`${x},${y}`} x={x} y={y} width={1} height={1} /> : null)))}
      </svg>
    </div>
  );
}

/* ────────────────────────── pieces ────────────────────────── */

const clock = (ms: number | null): string => {
  if (!ms) return '--:--';
  const d = new Date(ms);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};

function ItemList({ items }: { items: AwayLogItem[] }): React.JSX.Element {
  if (!items.length) return <div className="away-empty">Nothing written yet.</div>;
  return (
    <div>
      {items.map((item, i) => (
        <div className="away-item" key={`${item.at}-${i}`}>
          <span className={`away-kind ${item.kind}`}>{item.kind}</span>
          <span>{item.text}</span>
        </div>
      ))}
    </div>
  );
}

function SessionWindow({ status }: { status: AwayStatus }): React.JSX.Element {
  const bodyRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = bodyRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [status.lines.length]);
  return (
    <div className="away-window" role="log" aria-live="polite">
      <div className="away-window-head">
        <span>JARVIS PRIME · AWAY SESSION</span>
        <span>{status.model} · {status.mode}{status.running ? ' · WORKING' : ''}</span>
      </div>
      <div className="away-window-body" ref={bodyRef}>
        {status.lines.map((line, i) => (
          <div className={`away-line ${line.kind}`} key={`${line.at}-${i}`}>
            {line.kind === 'tool' ? '▸ ' : ''}{line.text}
          </div>
        ))}
      </div>
    </div>
  );
}

function Report({ status, onReturn, onDismiss }: { status: AwayStatus; onReturn: () => void; onDismiss: () => void }): React.JSX.Element {
  const minutes = status.since ? Math.max(0, Math.round(((status.wokeAt ?? Date.now()) - status.since) / 60_000)) : 0;
  return (
    <div className="away-report" role="dialog" aria-label="While you were away">
      <h2>While you were away</h2>
      <div className="away-stats">
        <span>{clock(status.since)} – {clock(status.wokeAt)} · {minutes} min</span>
        <span>{status.items.length} item{status.items.length === 1 ? '' : 's'}</span>
        <span>{status.files.length} file{status.files.length === 1 ? '' : 's'} written</span>
        {status.tokens ? <span>{status.tokens.input.toLocaleString()} in · {status.tokens.output.toLocaleString()} out</span> : null}
        {status.endReason ? <span>{status.endReason}</span> : status.running ? <span>stopping…</span> : null}
      </div>
      {status.refusal ? <div className="away-refusal">{status.refusal}</div> : null}
      <ItemList items={status.items} />
      {status.files.length ? <div className="away-files">{status.files.join(' · ')}</div> : null}
      {status.summary ? <div className="away-summary">{status.summary}</div> : null}
      {status.journal ? <div className="away-hint">Journal: {status.journal}</div> : null}
      <div className="away-return">Space to return to the board</div>
      <div className="away-report-actions">
        <button type="button" className="btn" onClick={onReturn}>Return to the board (Space)</button>
        <button type="button" className="btn" onClick={onDismiss}>Dismiss the report</button>
      </div>
    </div>
  );
}

/* ────────────────────────── the screen ────────────────────────── */

export function AwayScreen(): React.JSX.Element | null {
  const status = useAway((s) => s.status);
  const view = useAway((s) => s.view);
  const setStatus = useAway((s) => s.setStatus);
  const appendLog = useAway((s) => s.appendLog);
  const setView = useAway((s) => s.setView);
  const dismiss = useAway((s) => s.dismiss);
  const toast = useBoardStore((s) => s.toast);

  useEffect(() => {
    if (!awayBridge()) return;
    void window.skynet['away:status']().then((s) => setStatus(s, true));
    const offState = window.skynet.on('away:state', (s) => setStatus(s));
    const offLog = window.skynet.on('away:log', appendLog);
    return () => { offState(); offLog(); };
  }, [setStatus, appendLog]);

  // Shift+Z: sleep now. For trying it without waiting half an hour.
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      const el = event.target as HTMLElement | null;
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT')) return;
      if (!event.shiftKey || event.ctrlKey || event.altKey || event.code !== 'KeyZ' || useAway.getState().view !== 'hidden') return;
      event.preventDefault();
      if (!awayBridge()) { toast('warn', 'RESTART SKYNETOS: AWAY MODE ARRIVED AFTER THIS WINDOW OPENED'); return; }
      void window.skynet['away:sleepNow']().then((r) => { if (!r.ok) toast('warn', r.error ?? 'COULD NOT SLEEP'); });
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [toast]);

  /*
   * While away: ANY input wakes it. Captured before the board sees it, so the key that wakes the
   * screen does not also pan or open something. A short grace after the screen appears, and a
   * mouse move has to travel a few pixels, so a nudged desk is not a return.
   */
  useEffect(() => {
    if (view !== 'away') return;
    const shownAt = performance.now();
    let base: { x: number; y: number } | null = null;
    let woke = false;
    const wakeUp = (): void => {
      if (woke || performance.now() - shownAt < 800) return;
      woke = true;
      if (awayBridge()) {
        void window.skynet['away:wake']().then((s) => setStatus(s));
      } else {
        setView('report');
      }
    };
    const swallow = (event: Event): void => { event.preventDefault(); event.stopImmediatePropagation(); wakeUp(); };
    const onMove = (event: PointerEvent): void => {
      if (!base) { base = { x: event.clientX, y: event.clientY }; return; }
      if (Math.abs(event.clientX - base.x) + Math.abs(event.clientY - base.y) > 6) wakeUp();
    };
    window.addEventListener('keydown', swallow, true);
    window.addEventListener('pointerdown', swallow, true);
    window.addEventListener('wheel', swallow, { capture: true, passive: false });
    window.addEventListener('pointermove', onMove, true);
    return () => {
      window.removeEventListener('keydown', swallow, true);
      window.removeEventListener('pointerdown', swallow, true);
      window.removeEventListener('wheel', swallow, true);
      window.removeEventListener('pointermove', onMove, true);
    };
  }, [view, setStatus, setView]);

  // The report: Space (or Enter, or Esc) returns to the board; every other key stays here.
  useEffect(() => {
    if (view !== 'report') return;
    const onKey = (event: KeyboardEvent): void => {
      const el = event.target as HTMLElement | null;
      if (el && el.tagName === 'BUTTON' && (event.code === 'Enter' || event.code === 'Space')) return;
      event.stopImmediatePropagation();
      if (event.code === 'Space' || event.code === 'Enter' || event.code === 'Escape') {
        event.preventDefault();
        setView('hidden');
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [view, setView]);

  if (view === 'hidden' || !status) return null;

  if (view === 'report') {
    return (
      <div className="away-screen">
        <Report status={status} onReturn={() => setView('hidden')} onDismiss={dismiss} />
      </div>
    );
  }

  return (
    <div className="away-screen" aria-label="Away">
      <SleepingChip />
      <div className="away-caption">
        {status.running
          ? <>JARVIS is working while you are away · since <strong>{clock(status.since)}</strong></>
          : <>Asleep since <strong>{clock(status.since)}</strong>{status.endReason ? ` · session ${status.endReason}` : ''}</>}
      </div>
      {status.refusal ? <div className="away-refusal">{status.refusal}</div> : null}
      {status.mode !== 'visual' ? <SessionWindow status={status} /> : null}
      <div className="away-list">
        <div className="away-list-head">While you were away</div>
        <ItemList items={status.items} />
      </div>
      <div className="away-hint">Any input wakes the board</div>
    </div>
  );
}

/* ────────────────────────── the LOOK panel's AWAY section ────────────────────────── */

const MODE_NOTES: Record<AwayMode, string> = {
  off: 'Never goes to sleep.',
  visual: 'The sleep screen only. Nothing runs.',
  plan: 'A headless JARVIS Prime roadmaps across the projects, writing only the codex and docs/06.',
  work: 'Plan, plus up to two low-resource sessions. Set in settings.json only.'
};

export function AwaySettings(): React.JSX.Element {
  const status = useAway((s) => s.status);
  const setStatus = useAway((s) => s.setStatus);
  const toast = useBoardStore((s) => s.toast);
  const [minutes, setMinutes] = useState('');
  const [model, setModel] = useState('');

  useEffect(() => {
    if (!status && awayBridge()) void window.skynet['away:status']().then((s) => setStatus(s, true));
  }, [status, setStatus]);
  useEffect(() => {
    if (status) { setMinutes(String(status.afterMinutes)); setModel(status.model); }
  }, [status?.afterMinutes, status?.model]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!awayBridge()) return <div className="look-note">Restart SkynetOS: away mode arrived after this window opened.</div>;
  if (!status) return <div className="look-note">Reading…</div>;

  const save = async (patch: { mode?: AwayMode; afterMinutes?: number; model?: string }): Promise<void> => {
    const result = await window.skynet['away:setMode'](patch);
    if (!result.ok) toast('warn', result.error ?? 'COULD NOT SAVE');
  };

  return (
    <div className="away-settings">
      <div className="look-row">
        <span className="look-row-label">Mode</span>
        {AWAY_MODES.map((m) => (
          <button
            type="button"
            key={m}
            className="btn tiny look-step"
            aria-pressed={status.mode === m}
            disabled={m === 'work' && status.mode !== 'work'}
            title={MODE_NOTES[m]}
            onClick={() => void save({ mode: m })}
          >
            {m.toUpperCase()}
          </button>
        ))}
      </div>
      <div className="look-note">{MODE_NOTES[status.mode]}</div>
      <label className="look-row">
        <span className="look-row-label">After</span>
        <input
          className="input"
          type="number"
          min={MIN_AWAY_MINUTES}
          max={MAX_AWAY_MINUTES}
          value={minutes}
          onChange={(e) => setMinutes(e.target.value)}
          onBlur={() => void save({ afterMinutes: Number(minutes) })}
          onKeyDown={(e) => { if (e.key === 'Enter') void save({ afterMinutes: Number(minutes) }); }}
        />
        <span>min without input or agents</span>
      </label>
      <label className="look-row">
        <span className="look-row-label">Model</span>
        <input
          className="input"
          value={model}
          spellCheck={false}
          onChange={(e) => setModel(e.target.value)}
          onBlur={() => { if (model.trim() && model !== status.model) void save({ model: model.trim() }); }}
          onKeyDown={(e) => { if (e.key === 'Enter' && model.trim()) void save({ model: model.trim() }); }}
        />
      </label>
      <div className="look-row">
        <button type="button" className="btn tiny" onClick={() => void window.skynet['away:sleepNow']().then((r) => { if (!r.ok) toast('warn', r.error ?? 'COULD NOT SLEEP'); })}>
          Sleep now (Shift+Z)
        </button>
      </div>
      <div className="look-note">
        Never commits, pushes, deletes or runs elevated. It never types into the claude.ai window: the
        Face gets the summary as mail. Stopped the moment you touch the keyboard or mouse.
      </div>
    </div>
  );
}
