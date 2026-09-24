import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { BoardNode } from '@shared/types.js';
import {
  formatSize,
  iconFor,
  parentRel,
  sortEntries,
  type ExplorerEntry,
  type ExplorerIcon,
  type ExplorerListing,
  type ExplorerSort
} from '@shared/explorer.js';
import { useBoardStore } from '../store/useBoardStore.js';
import { Icon } from './Icon.js';
import { isMarkdownFile, isTextFile, type EditorOpenWith } from '@shared/open-with.js';

/**
 * The file explorer window: a `store.explorer` node's folder, as a retro desktop file browser.
 *
 * William: "browsing the files within looks like a pixel art / retro file explorer but references
 * real files / folders — the default / resting folder is selectable."
 *
 * Everything it shows is read from disk by main (`explorer:list`), scoped to the node's root; this
 * file only draws it. It changes nothing on disk. Its one edit is to the BOARD: SET AS RESTING
 * FOLDER writes the node's `restPath` through the command bus, so Ctrl+Z takes it back.
 *
 * The chrome follows docs/02 like the rest of the board's panels: whole multiples of --p, bevels
 * drawn as hard inset shadows rather than gradients, and icons that are 16x16 pixel art drawn from
 * the palette tokens.
 */

/* ────────────────────────── pixel icons ────────────────────────── */

/** One character per art pixel. `.` is transparent. Colours are the palette's CSS tokens. */
const INK: Record<string, string> = {
  k: 'var(--mask-dark)',
  l: 'var(--mask-light)',
  s: 'var(--silk)',
  c: 'var(--copper)',
  d: 'var(--copper-dark)',
  g: 'var(--signal)',
  o: 'var(--ok)',
  w: 'var(--warn)',
  f: 'var(--fault)'
};

const FOLDER = [
  '................',
  '................',
  '.kkkkkk.........',
  '.kwwwwwk........',
  '.kwwwwwwkkkkkkk.',
  '.kwwwwwwwwwwwwk.',
  '.kcccccccccccck.',
  '.kwwwwwwwwwwwwk.',
  '.kwwwwwwwwwwwwk.',
  '.kwwwwwwwwwwwwk.',
  '.kwwwwwwwwwwwwk.',
  '.kwwwwwwwwwwwwk.',
  '.kddddddddddddk.',
  '.kkkkkkkkkkkkkk.',
  '................',
  '................'
];

/** A page with its corner folded. Glyphs are laid over rows 6-12, columns 3-12. */
const PAGE = [
  '................',
  '..kkkkkkkkk.....',
  '..kssssssskk....',
  '..kssssssskdk...',
  '..ksssssssskkkk.',
  '..kssssssssssk..',
  '..kssssssssssk..',
  '..kssssssssssk..',
  '..kssssssssssk..',
  '..kssssssssssk..',
  '..kssssssssssk..',
  '..kssssssssssk..',
  '..kssssssssssk..',
  '..kssssssssssk..',
  '..kkkkkkkkkkkk..',
  '................'
];

function onPage(glyph: string[]): string[] {
  return PAGE.map((row, y) => {
    const line = glyph[y - 6];
    if (!line) return row;
    const chars = row.split('');
    for (let x = 0; x < line.length; x++) if (line[x] !== '.') chars[3 + x] = line[x] as string;
    return chars.join('');
  });
}

const MAP = [
  '................',
  '................',
  '.kkkkkkkkkkkkkk.',
  '.kssssccccssssk.',
  '.ksfssccccssssk.',
  '.ksfssccccssssk.',
  '.ksfffccccssssk.',
  '.ksssfcfffssssk.',
  '.kssssccfsssssk.',
  '.kssssccfffsssk.',
  '.kssssccccsfssk.',
  '.kssssccccsfssk.',
  '.kssssccccssssk.',
  '.kkkkkkkkkkkkkk.',
  '................',
  '................'
];

const ART: Record<ExplorerIcon, string[]> = {
  folder: FOLDER,
  map: MAP,
  doc: onPage(['.gggggg...', '..........', '.dddddddd.', '..........', '.dddddddd.', '..........', '.dddddd...']),
  text: onPage(['.dddddddd.', '..........', '.dddddddd.', '..........', '.dddddddd.', '..........', '.dddd.....']),
  pdf: onPage(['.ffffffff.', '.ffffffff.', '..........', '.dddddddd.', '..........', '.dddddddd.', '..........']),
  data: onPage(['.ooooooo..', '.o..o..o..', '.ooooooo..', '.o..o..o..', '.ooooooo..', '.o..o..o..', '.ooooooo..']),
  image: onPage(['......ww..', '......ww..', '..........', '...o......', '..ooo..o..', '.ooooooooo', '.ooooooooo']),
  archive: onPage(['....dc....', '....cd....', '....dc....', '....cd....', '...kkkk...', '...kddk...', '...kkkk...']),
  audio: onPage(['......cc..', '....cccc..', '....c..c..', '....c..c..', '..ccc.ccc.', '..ccc.ccc.', '..........']),
  video: onPage(['d.d.d.d.d.', 'dddddddddd', 'dggggggggd', 'dggggggggd', 'dddddddddd', 'd.d.d.d.d.', '..........']),
  code: onPage(['..........', '...g..g...', '..g....g..', '.g......g.', '..g....g..', '...g..g...', '..........']),
  program: onPage(['.kkkkkkkk.', '.kggggggk.', '.kkkkkkkk.', '.k......k.', '.k.dddd.k.', '.k......k.', '.kkkkkkkk.']),
  unknown: onPage(['...kkkk...', '..k....k..', '......k...', '.....k....', '.....k....', '..........', '.....k....'])
};

interface Run { x: number; y: number; w: number; c: string }

/** Each row collapsed into runs of one colour, once, at load: a few dozen rects per icon, not 256. */
function runsOf(rows: string[]): Run[] {
  const runs: Run[] = [];
  rows.forEach((row, y) => {
    let x = 0;
    while (x < row.length) {
      const c = row[x] as string;
      let w = 1;
      while (row[x + w] === c) w++;
      if (c !== '.') runs.push({ x, y, w, c });
      x += w;
    }
  });
  return runs;
}

const RUNS = Object.fromEntries(
  (Object.keys(ART) as ExplorerIcon[]).map((icon) => [icon, runsOf(ART[icon])])
) as Record<ExplorerIcon, Run[]>;

function PixelIcon({ icon }: { icon: ExplorerIcon }): React.JSX.Element {
  return (
    <svg className="px-icon" viewBox="0 0 16 16" shapeRendering="crispEdges" aria-hidden="true">
      {RUNS[icon].map((r) => (
        <rect key={`${r.x}.${r.y}`} x={r.x} y={r.y} width={r.w} height={1} style={{ fill: INK[r.c] }} />
      ))}
    </svg>
  );
}

/* ────────────────────────── the window ────────────────────────── */

const joinRel = (rel: string, name: string): string => (rel ? `${rel}/${name}` : name);

/** Let a long filename break after its separators instead of overflowing the cell. */
const wrappable = (name: string): string => name.replace(/([._-])/g, '$1​');

const SORTS: { id: ExplorerSort; label: string }[] = [
  { id: 'name', label: 'NAME' },
  { id: 'date', label: 'DATE' },
  { id: 'size', label: 'SIZE' }
];

function titleOf(node: BoardNode | undefined): string | null {
  if (!node) return null;
  return node.designator ? `${node.designator} ${node.name}` : node.name;
}

export function Explorer(): React.JSX.Element | null {
  const target = useBoardStore((s) => s.explorer);
  const close = useBoardStore((s) => s.closeExplorer);
  const runCommand = useBoardStore((s) => s.runCommand);
  const toast = useBoardStore((s) => s.toast);
  const title = useBoardStore((s) =>
    s.explorer && s.board?.id === s.explorer.boardId
      ? titleOf(s.board.nodes.find((n) => n.id === s.explorer?.nodeId))
      : null
  );

  const [listing, setListing] = useState<ExplorerListing | null>(null);
  const [rel, setRel] = useState('');
  const [back, setBack] = useState<string[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [sort, setSort] = useState<ExplorerSort>('name');
  const [descending, setDescending] = useState(false);
  const [busy, setBusy] = useState(false);

  const panelRef = useRef<HTMLDivElement>(null);
  const gridRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async (next: string | null, from: string | null) => {
    if (!target) return;
    setBusy(true);
    try {
      const result = await window.skynet['explorer:list'](target.boardId, target.nodeId, next);
      setListing(result);
      if (result.ok) {
        setRel(result.rel);
        if (from !== null && from !== result.rel) setBack((stack) => [...stack, from]);
        setSelected(null);
      }
    } catch (err) {
      setListing({ ok: false, root: '', rel: next ?? '', rest: null, entries: [], truncated: false, error: (err as Error).message });
    } finally {
      setBusy(false);
    }
  }, [target]);

  // A new node (or the same one reopened) starts where it rests, with no history.
  useEffect(() => {
    if (!target) return;
    setBack([]);
    setListing(null);
    void load(null, null);
  }, [target, load]);

  const entries = useMemo(
    () => sortEntries(listing?.entries ?? [], sort, descending),
    [listing, sort, descending]
  );
  const selectedIndex = selected === null ? -1 : entries.findIndex((e) => e.name === selected);
  const selectedEntry: ExplorerEntry | undefined = selectedIndex >= 0 ? entries[selectedIndex] : undefined;

  const open = useCallback(async (entry: ExplorerEntry) => {
    if (!target) return;
    if (entry.kind === 'dir') { void load(joinRel(rel, entry.name), rel); return; }
    const result = await window.skynet['explorer:open'](target.boardId, target.nodeId, joinRel(rel, entry.name), 'open');
    if (result.ok) toast('ok', result.action ?? `opened ${entry.name}`);
    else if (result.error !== 'CANCELLED') toast('warn', result.error ?? `COULD NOT OPEN ${entry.name}`);
  }, [target, rel, load, toast]);

  const goUp = useCallback(() => { if (rel) void load(parentRel(rel), rel); }, [rel, load]);
  const goBack = useCallback(() => {
    const previous = back[back.length - 1];
    if (previous === undefined) return;
    setBack((stack) => stack.slice(0, -1));
    void load(previous, null);
  }, [back, load]);
  const refresh = useCallback(() => { void load(rel, null); }, [rel, load]);

  const openInEditor = async (editor: EditorOpenWith): Promise<void> => {
    if (!target || !selectedEntry || selectedEntry.kind === 'dir') return;
    const result = await window.skynet['explorer:open'](target.boardId, target.nodeId, joinRel(rel, selectedEntry.name), editor);
    if (result.ok) toast('ok', result.action ?? `opened ${selectedEntry.name}`);
    else if (result.error !== 'CANCELLED') toast('warn', result.error ?? `COULD NOT OPEN ${selectedEntry.name}`);
  };

  const reveal = async (): Promise<void> => {
    if (!target) return;
    const result = await window.skynet['explorer:open'](target.boardId, target.nodeId, selectedEntry ? joinRel(rel, selectedEntry.name) : rel, 'reveal');
    if (!result.ok) toast('warn', result.error ?? 'COULD NOT SHOW IT');
  };

  /*
   * The resting folder is a board edit, not a preference: it belongs to the node, travels with the
   * board file, and goes through the command bus like any other change, so Ctrl+Z takes it back.
   * The path is built from the root AS THE BOARD SPELLS IT, so a `%USERPROFILE%` root stays portable.
   */
  const setResting = async (): Promise<void> => {
    if (!target || !listing?.ok) return;
    const restPath = rel ? `${listing.root.replace(/[\\/]+$/, '')}/${rel}` : undefined;
    const result = await runCommand(
      { type: 'node.update', boardId: target.boardId, nodeId: target.nodeId, patch: { restPath } as Partial<BoardNode> },
      rel ? `explorer rests at ${rel}` : 'explorer rests at its root'
    );
    // runCommand has already said why, in its own toast.
    if (!result.ok) return;
    toast('ok', rel ? `resting folder: ${rel}` : 'resting folder: the root');
    void load(rel, null);
  };

  const dragOut = (entry: ExplorerEntry): void => {
    if (!target) return;
    void window.skynet['explorer:drag'](target.boardId, target.nodeId, joinRel(rel, entry.name)).then((result) => {
      if (!result.ok) toast('warn', result.error ?? 'COULD NOT START THE DRAG');
    });
  };

  /** How many cells fit on one row, measured, so Up and Down move by a whole row. */
  const columns = (): number => {
    const items = gridRef.current?.querySelectorAll<HTMLElement>('.explorer-item');
    if (!items || items.length < 2) return 1;
    const top = (items[0] as HTMLElement).offsetTop;
    let count = 0;
    for (const item of items) { if (item.offsetTop !== top) break; count++; }
    return Math.max(1, count);
  };

  /*
   * Esc closes, and ONLY closes: captured ahead of the board, which would otherwise deselect or
   * leave the room. While focus is inside the window every key stays inside it, so reading a folder
   * never pans the camera underneath.
   */
  useEffect(() => {
    if (!target) return;
    const onKey = (event: KeyboardEvent): void => {
      if (event.code === 'Escape') {
        event.preventDefault();
        event.stopImmediatePropagation();
        close();
        return;
      }
      if (!panelRef.current?.contains(document.activeElement)) return;
      event.stopImmediatePropagation();
      if (document.activeElement !== gridRef.current) return;

      const last = entries.length - 1;
      const move = (to: number): void => {
        event.preventDefault();
        if (last < 0) return;
        const next = entries[Math.max(0, Math.min(last, to))];
        if (next) setSelected(next.name);
      };
      const from = selectedIndex < 0 ? -1 : selectedIndex;
      if (event.altKey && event.code === 'ArrowLeft') { event.preventDefault(); goBack(); return; }
      switch (event.code) {
        case 'ArrowRight': move(from + 1); break;
        case 'ArrowLeft': move(from < 0 ? 0 : from - 1); break;
        case 'ArrowDown': move(from < 0 ? 0 : from + columns()); break;
        case 'ArrowUp': move(from < 0 ? 0 : from - columns()); break;
        case 'Home': move(0); break;
        case 'End': move(last); break;
        case 'Enter':
        case 'NumpadEnter':
          event.preventDefault();
          if (selectedEntry) void open(selectedEntry);
          break;
        case 'Backspace': event.preventDefault(); goUp(); break;
        case 'F5': event.preventDefault(); refresh(); break;
        default: break;
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [target, close, entries, selectedIndex, selectedEntry, open, goUp, goBack, refresh]);

  // Focus the grid on open, so the arrow keys work without a click first.
  useEffect(() => { if (target) gridRef.current?.focus(); }, [target]);

  // Keep the selection on screen as the arrow keys walk past the fold.
  useEffect(() => {
    if (selectedIndex < 0) return;
    gridRef.current?.querySelectorAll<HTMLElement>('.explorer-item')[selectedIndex]?.scrollIntoView({ block: 'nearest' });
  }, [selectedIndex]);

  if (!target) return null;

  const rootName = (listing?.root ?? '').replace(/[\\/]+$/, '').split(/[\\/]/).pop() || 'ROOT';
  const segments = rel ? rel.split('/') : [];
  const isResting = listing?.ok === true && (listing.rest ?? '') === rel;
  const folders = entries.filter((e) => e.kind === 'dir').length;
  const files = entries.length - folders;

  return (
    <div className="explorer-backdrop">
      <div className="explorer" ref={panelRef} role="dialog" aria-label={`File explorer: ${title ?? rootName}`}>
        <div className="explorer-title">
          <PixelIcon icon="folder" />
          <span className="explorer-title-text">{title ?? rootName} — FILE EXPLORER</span>
          <button type="button" className="explorer-winbtn" onClick={close} title="Close (Esc)" aria-label="Close"><Icon name="close" /></button>
        </div>

        <div className="explorer-toolbar">
          <button type="button" className="explorer-tool" disabled={!back.length} onClick={goBack} title="Back (Alt+Left)"><Icon name="left" />BACK</button>
          <button type="button" className="explorer-tool" disabled={!rel} onClick={goUp} title="Up one folder (Backspace)"><Icon name="up" />UP</button>
          <button type="button" className="explorer-tool" onClick={refresh} title="Read the folder again (F5)"><Icon name="refresh" />REFRESH</button>
          <span className="explorer-sep" aria-hidden="true" />
          {SORTS.map((s) => (
            <button
              key={s.id}
              type="button"
              className={sort === s.id ? 'explorer-tool on' : 'explorer-tool'}
              onClick={() => { if (sort === s.id) setDescending(!descending); else { setSort(s.id); setDescending(s.id !== 'name'); } }}
              title={`Sort by ${s.label.toLowerCase()}. Click again to reverse. Folders stay first.`}
            >
              {s.label}{sort === s.id ? (descending ? ' ▼' : ' ▲') : ''}
            </button>
          ))}
          <span className="explorer-spacer" />
          {/* Open With for text and notes: Notepad++ for any text file, Obsidian for markdown in a vault. */}
          <button
            type="button"
            className="explorer-tool"
            disabled={!selectedEntry || selectedEntry.kind === 'dir' || !isTextFile(selectedEntry.name)}
            onClick={() => void openInEditor('notepadpp')}
            title="Open the selected text file in Notepad++"
          >
            <Icon name="notepad" />NOTEPAD++
          </button>
          <button
            type="button"
            className="explorer-tool"
            disabled={!selectedEntry || selectedEntry.kind === 'dir' || !isMarkdownFile(selectedEntry.name)}
            onClick={() => void openInEditor('obsidian')}
            title="Open the selected note in Obsidian (it must be inside a vault)"
          >
            <Icon name="gem" />OBSIDIAN
          </button>
          <button type="button" className="explorer-tool" onClick={() => void reveal()} disabled={!listing?.ok} title="Show the selection (or this folder) in Windows Explorer"><Icon name="open" />SHOW IN WINDOWS</button>
          <button
            type="button"
            className={isResting ? 'explorer-tool on' : 'explorer-tool'}
            disabled={!listing?.ok || isResting}
            onClick={() => void setResting()}
            title="Open this node at this folder from now on. A board edit: Ctrl+Z takes it back."
          >
            <Icon name="pin" />{isResting ? 'RESTING HERE' : 'SET AS RESTING FOLDER'}
          </button>
        </div>

        <div className="explorer-address">
          <span className="explorer-address-label">ADDRESS</span>
          <div className="explorer-crumbs">
            <button type="button" className="explorer-crumb" onClick={() => void load('', rel)} title={listing?.root}>{rootName}</button>
            {segments.map((segment, i) => (
              <span key={`${i}.${segment}`} className="explorer-crumb-wrap">
                <span className="explorer-crumb-sep" aria-hidden="true">\</span>
                <button type="button" className="explorer-crumb" onClick={() => void load(segments.slice(0, i + 1).join('/'), rel)}>{segment}</button>
              </span>
            ))}
          </div>
        </div>

        <div
          className="explorer-grid"
          ref={gridRef}
          tabIndex={0}
          role="listbox"
          aria-label="Files and folders"
          aria-activedescendant={selectedIndex >= 0 ? `explorer-item-${selectedIndex}` : undefined}
        >
          {listing && !listing.ok ? (
            <div className="explorer-empty fault">{listing.error ?? 'COULD NOT READ THIS FOLDER'}</div>
          ) : listing && !entries.length ? (
            <div className="explorer-empty">THIS FOLDER IS EMPTY</div>
          ) : !listing ? (
            <div className="explorer-empty">READING…</div>
          ) : null}
          {entries.map((entry, i) => (
            <div
              key={entry.name}
              id={`explorer-item-${i}`}
              role="option"
              aria-selected={i === selectedIndex}
              className={i === selectedIndex ? 'explorer-item selected' : 'explorer-item'}
              title={entry.kind === 'dir' ? `${entry.name}\nFolder` : `${entry.name}\n${formatSize(entry.size)}${entry.mtime ? ` · ${new Date(entry.mtime).toLocaleString()}` : ''}\nDrag out into another program`}
              draggable={entry.kind === 'file'}
              onClick={() => { setSelected(entry.name); gridRef.current?.focus(); }}
              onDoubleClick={() => void open(entry)}
              onDragStart={(event) => {
                // preventDefault + IPC is the required shape: see ui/DragBadges.tsx and services/drag-out.ts.
                event.preventDefault();
                dragOut(entry);
              }}
            >
              <PixelIcon icon={iconFor(entry)} />
              <span className="explorer-name">{wrappable(entry.name)}{entry.link ? ' ↪' : ''}</span>
            </div>
          ))}
        </div>

        <div className="explorer-status">
          <span className="explorer-cell">{busy ? 'READING…' : `${folders} FOLDER${folders === 1 ? '' : 'S'} · ${files} FILE${files === 1 ? '' : 'S'}${listing?.truncated ? ' · MORE NOT SHOWN' : ''}`}</span>
          <span className="explorer-cell grow">
            {selectedEntry
              ? `${selectedEntry.name}${selectedEntry.kind === 'file' ? ` · ${formatSize(selectedEntry.size)}` : ''}${selectedEntry.mtime ? ` · ${new Date(selectedEntry.mtime).toLocaleDateString()}` : ''}`
              : listing?.restRefused ?? 'DOUBLE-CLICK TO OPEN · DRAG A FILE OUT'}
          </span>
          <span className="explorer-cell">{listing?.rest ? `RESTS AT ${listing.rest}` : 'RESTS AT THE ROOT'}</span>
        </div>
      </div>
    </div>
  );
}
