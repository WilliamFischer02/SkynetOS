import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { extensionOf, type PromptFileInfo } from '@shared/prompt.js';
import { nextQuote, type QuoteStats } from '@shared/quotes.js';
import { useBoardStore } from '../store/useBoardStore.js';
import { Icon } from './Icon.js';
import type { VoiceMoment } from '@shared/voice.js';

/**
 * The corner prompt: always there, bottom left, sending to the JARVIS Face.
 *
 * William: "add a persistent prompt box to the bottom left corner of the ui that, just like the
 * prompt node, opens user input message / files as a prompt into the same Jarvis Face / head
 * session. Above this prompt box rotate a selection of pre-written quotes."
 *
 * The same delivery as a prompt node (`prompt:send`), with no node: main sends it to the root
 * board's JARVIS head. The quotes are packages/shared/quotes.ts, in the blended voice. They type
 * on in whole characters (stepped, like every other motion here), change every 24 s, change on a
 * click, and hold still while you are typing, since a line that moves under your eye while you
 * write is a distraction.
 */

const ROTATE_MS = 24_000;
const TYPE_MS = 28;
/** The Face lives on the root board, whichever room you are looking at. */
const FACE_BOARD = 'root';

/** What the summoned prompt says while voice is in play. */
function voiceLine(moment: VoiceMoment): string {
  switch (moment.stage) {
    case 'listening': return 'Listening…';
    case 'thinking': return 'Thinking…';
    case 'nothing': return 'I heard nothing.';
    case 'asking': return `“${moment.text ?? ''}” — sending to JARVIS · Esc to cancel`;
    case 'sending': return 'Sending to JARVIS…';
    case 'did': return moment.text ? `“${moment.text}” — ${moment.say ?? ''}` : (moment.say ?? '');
  }
}

function reducedMotion(): boolean {
  try { return window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { return false; }
}

export function JarvisDock(): React.JSX.Element {
  const board = useBoardStore((s) => s.board);
  const toast = useBoardStore((s) => s.toast);
  // Folded to one bar by the user (persisted). `/` and the command palette unfold it.
  const collapsed = useBoardStore((s) => s.chromePrefs.jarvisDockCollapsed);
  const setChromePref = useBoardStore((s) => s.setChromePref);
  /*
   * "Hey JARVIS" summons this prompt and its quote to the middle of the screen, larger, for as long as
   * voice is in play (ui/useVoice.ts). A folded prompt unfolds for it too: a wake phrase that produced
   * no visible response would be indistinguishable from one that was not heard.
   */
  const voiceMoment = useBoardStore((s) => s.voiceMoment);

  const stats: QuoteStats = useMemo(() => ({
    nodes: board?.nodes.length ?? 0,
    repos: board?.nodes.filter((n) => n.kind === 'store.repo').length ?? 0,
    rooms: board?.nodes.filter((n) => n.kind === 'drive.room').length ?? 0,
    provisional: board?.nodes.filter((n) => n.provisional).length ?? 0,
    phantoms: board?.phantoms?.length ?? 0
  }), [board]);
  const statsRef = useRef(stats);
  statsRef.current = stats;

  const [text, setText] = useState('');
  const [files, setFiles] = useState<PromptFileInfo[]>([]);
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const typingRef = useRef(false);
  typingRef.current = text !== '' || files.length > 0;

  const [quote, setQuote] = useState(() => nextQuote(new Date().getHours(), stats, null));
  const [shown, setShown] = useState(0);
  const cycle = useCallback((force: boolean) => {
    if (!force && (typingRef.current || document.activeElement === inputRef.current)) return;
    setQuote((previous) => nextQuote(new Date().getHours(), statsRef.current, previous));
  }, []);

  useEffect(() => {
    const timer = setInterval(() => cycle(false), ROTATE_MS);
    return () => clearInterval(timer);
  }, [cycle]);

  // Typed on a character at a time, then the interval stops: nothing ticks while a line is at rest.
  useEffect(() => {
    if (reducedMotion()) { setShown(quote.length); return; }
    setShown(0);
    let n = 0;
    const timer = setInterval(() => {
      n++;
      setShown(n);
      if (n >= quote.length) clearInterval(timer);
    }, TYPE_MS);
    return () => clearInterval(timer);
  }, [quote]);

  // `/` puts the cursor here from anywhere on the board, the way chat apps do.
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      const el = event.target as HTMLElement | null;
      const inForm = !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT');
      if (inForm || event.ctrlKey || event.altKey || event.metaKey) return;
      if (event.key === '/') {
        event.preventDefault();
        const store = useBoardStore.getState();
        if (store.chromePrefs.jarvisDockCollapsed) store.setChromePref('jarvisDockCollapsed', false);
        requestAnimationFrame(() => inputRef.current?.focus());
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const addPaths = async (paths: string[]): Promise<void> => {
    const fresh = paths.filter((p) => p && !files.some((f) => f.path === p));
    if (!fresh.length) return;
    const described = await window.skynet['prompt:describeFiles'](fresh);
    setFiles((current) => [...current, ...described.filter((d) => !current.some((c) => c.path === d.path))]);
  };

  const pick = async (): Promise<void> => {
    const { paths } = await window.skynet['prompt:pickFiles']();
    if (paths.length) await addPaths(paths);
    inputRef.current?.focus();
  };

  const send = async (): Promise<void> => {
    if (busy || (!text.trim() && !files.length)) return;
    const bad = files.find((f) => f.error);
    if (bad) { toast('warn', `${bad.name}: ${bad.error} — remove it to send`); return; }
    setBusy(true);
    try {
      const result = await window.skynet['prompt:send']({ boardId: FACE_BOARD, text, files: files.map((f) => f.path) });
      toast(result.stage === 'failed' ? 'fault' : result.ok ? 'ok' : 'warn', result.message);
      // Kept on failure, like the prompt node: nothing typed is lost to a page that did not load.
      if (result.stage !== 'failed') { setText(''); setFiles([]); }
    } catch (err) {
      toast('fault', `NOT SENT — ${(err as Error).message}`);
    } finally {
      setBusy(false);
    }
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>): void => {
    // The textarea's own undo, not the board's command bus.
    if (event.ctrlKey && (event.code === 'KeyZ' || event.code === 'KeyY')) { event.stopPropagation(); return; }
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); event.currentTarget.blur(); return; }
    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      void send();
    }
  };

  // Files dropped here are attachments; stopped so App's drop-in ingestion does not also fire.
  const onDragOver = (event: React.DragEvent): void => {
    if (!event.dataTransfer.types.includes('Files')) return;
    event.preventDefault();
    event.stopPropagation();
    event.dataTransfer.dropEffect = 'copy';
  };
  const onDrop = (event: React.DragEvent): void => {
    if (!event.dataTransfer.files.length) return;
    event.preventDefault();
    event.stopPropagation();
    void addPaths(window.skynet.pathsForFiles(Array.from(event.dataTransfer.files)));
  };

  if (collapsed && !voiceMoment) {
    return (
      <div className="jarvis-dock folded">
        <button type="button" className="jarvis-fold" onClick={() => setChromePref('jarvisDockCollapsed', false)} title="Open the corner prompt (/)">
          <Icon name="face" />Message JARVIS
        </button>
      </div>
    );
  }

  return (
    <div className={voiceMoment ? 'jarvis-dock summoned' : 'jarvis-dock'} onDragOver={onDragOver} onDrop={onDrop}>
      <button
        type="button"
        className="jarvis-min"
        onClick={() => setChromePref('jarvisDockCollapsed', true)}
        title="Fold the corner prompt to a bar"
        aria-label="Fold the corner prompt"
      >
        <Icon name="minus" />
      </button>
      {voiceMoment ? (
        <div className={`jarvis-voice ${voiceMoment.stage}`} role="status" aria-live="polite">
          {voiceLine(voiceMoment)}
        </div>
      ) : null}
      <button type="button" className="jarvis-quote" onClick={() => cycle(true)} title="Another line">
        <span>{quote.slice(0, shown)}</span>
        <span className="jarvis-caret" aria-hidden="true" />
      </button>

      {files.length ? (
        <div className="jarvis-chips">
          {files.map((f) => (
            <span key={f.path} className={f.error ? 'prompt-chip bad' : 'prompt-chip'} title={f.error ? `${f.path}\n${f.error}` : f.path}>
              {f.thumbnail
                ? <img className="prompt-thumb" src={f.thumbnail} alt="" />
                : <span className="prompt-ext">{extensionOf(f.name).toUpperCase() || 'FILE'}</span>}
              <span className="prompt-chip-name">{f.name}</span>
              <button
                type="button"
                className="prompt-chip-x"
                aria-label={`Remove ${f.name}`}
                disabled={busy}
                onClick={() => setFiles((current) => current.filter((x) => x.path !== f.path))}
              >
                x
              </button>
            </span>
          ))}
        </div>
      ) : null}

      <div className={busy ? 'jarvis-box busy' : 'jarvis-box'}>
        <textarea
          ref={inputRef}
          className="jarvis-input"
          value={text}
          rows={2}
          spellCheck
          disabled={busy}
          placeholder={busy ? 'Sending to JARVIS…' : 'Message JARVIS   ( / )'}
          aria-label="Message JARVIS"
          onChange={(event) => setText(event.target.value)}
          onKeyDown={onKeyDown}
        />
        <div className="jarvis-tools">
          <button type="button" className="jarvis-tool" title="Attach files or images. You can also drop them here." aria-label="Attach files" disabled={busy} onClick={() => void pick()}><Icon name="attach" /></button>
          <button
            type="button"
            className="jarvis-tool send"
            title="Send to JARVIS (Enter). Shift+Enter for a new line."
            aria-label="Send"
            disabled={busy || (!text.trim() && !files.length)}
            onClick={() => void send()}
          >
            <Icon name="right" />
          </button>
        </div>
      </div>
    </div>
  );
}
