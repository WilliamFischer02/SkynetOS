import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import type { BoardNode } from '@shared/types.js';
import { footprintOf } from '@shared/types.js';
import type { BoardLoad } from '@shared/ipc.js';
import { useBoardStore } from '../store/useBoardStore.js';
import { Icon, type IconName } from './Icon.js';
import { pushRecent, rankCommands, type CommandItem } from './command-search.js';

/**
 * The command palette (Ctrl+K): type to find any node in any room, or anything the chrome can do.
 *
 * A board with rooms inside rooms hides most of itself, and the only way to reach a node three rooms
 * down was to remember where it lives. Here every board is read (the same read-only `board:load` and
 * `board:loadRoom` a descent uses), so a node is found by name wherever it is. Choosing it walks the
 * room path with the ordinary descent, selects it and centres the camera on it. Shift+Enter also
 * opens it, exactly as a double-click would.
 *
 * Actions are the chrome's own switches with their keys beside them, so the palette also teaches
 * the keys. Nothing here has a write path of its own: every action calls a store function or a
 * user-only channel that the button or key for it already used.
 */

const RECENT_KEY = 'skynet.cmdk.recent';
/** Rooms within rooms: deeper than any board on disk, shallow enough that a loop cannot run away. */
const MAX_DEPTH = 4;

interface NodeHit {
  boardId: string;
  /** The drive.room node ids to descend through from the root, in order. */
  path: string[];
  room: string;
  node: BoardNode;
}

interface Entry extends CommandItem {
  icon: IconName;
  run: (open: boolean) => void | Promise<void>;
}

function loadRecent(): string[] {
  try {
    const raw = JSON.parse(window.localStorage.getItem(RECENT_KEY) ?? '[]') as unknown;
    return Array.isArray(raw) ? raw.filter((x): x is string => typeof x === 'string').slice(0, 8) : [];
  } catch {
    return [];
  }
}

function iconForKind(kind: string): IconName {
  if (kind.startsWith('agent.')) return 'terminal';
  if (kind.startsWith('drive.') || kind.startsWith('store.')) return 'folder';
  if (kind.startsWith('file.') || kind.startsWith('note.')) return 'text';
  if (kind.startsWith('group.')) return 'list';
  return 'target';
}

/** The room being looked at, available at once, before the whole index has been read. */
function currentHits(): NodeHit[] {
  const s = useBoardStore.getState();
  const room = s.stack[s.stack.length - 1]?.engraving ?? s.boardId.toUpperCase();
  return (s.board?.nodes ?? []).map((node) => ({ boardId: s.boardId, path: [], room, node }));
}

/** Every node on every board, root first. Read-only: the same loads a descent makes. */
async function indexBoards(): Promise<NodeHit[]> {
  const hits: NodeHit[] = [];
  const seen = new Set<string>();
  const walk = async (load: BoardLoad, boardId: string, path: string[], depth: number): Promise<void> => {
    if (!load.ok || seen.has(boardId)) return;
    seen.add(boardId);
    const room = (load.board.engraving ?? load.board.name).toUpperCase();
    for (const node of load.board.nodes) hits.push({ boardId, path, room, node });
    if (depth >= MAX_DEPTH) return;
    for (const node of load.board.nodes) {
      if (node.kind !== 'drive.room' || !node.boardFile) continue;
      const next = await window.skynet['board:loadRoom'](node.boardFile).catch(() => null);
      // A room's id is the one the store will hold after descending into it: its board's own id.
      if (next?.ok) await walk(next, next.board.id, [...path, node.id], depth + 1);
    }
  };
  // The root is held in the store by the id it was loaded with, 'root', whatever its file says.
  await walk(await window.skynet['board:load']('root'), 'root', [], 0);
  return hits;
}

/** Wait for a room change's iris to finish, since a descent is refused while one is running. */
async function settle(): Promise<void> {
  const until = Date.now() + 4000;
  while (useBoardStore.getState().transition && Date.now() < until) {
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

async function goTo(hit: NodeHit, open: boolean): Promise<void> {
  const get = useBoardStore.getState;
  if (get().boardId !== hit.boardId) {
    await settle();
    // Up to the root, then down the room path. Each step is the ordinary ascend or descend.
    while (get().stack.length > 1) {
      const depth = get().stack.length;
      await get().ascend();
      await settle();
      if (get().stack.length >= depth) break;
    }
    for (const roomNodeId of hit.path) {
      const depth = get().stack.length;
      await get().descend(roomNodeId);
      await settle();
      if (get().stack.length <= depth) break;
    }
  }
  const s = get();
  if (s.boardId !== hit.boardId || !s.board) { s.toast('warn', `COULD NOT REACH ${hit.room}`); return; }
  const node = s.board.nodes.find((n) => n.id === hit.node.id);
  if (!node) { s.toast('warn', `${hit.node.name} IS NO LONGER IN ${hit.room}`); return; }
  const fp = footprintOf(node);
  const tile = s.board.grid.tile;
  s.select(node.id);
  s.requestJump({ x: (node.pos.x + fp.w / 2) * tile, y: (node.pos.y + fp.h / 2) * tile });
  if (open) await s.openNode(node.id);
}

function nodeEntry(hit: NodeHit): Entry {
  const n = hit.node;
  return {
    id: `node:${hit.boardId}:${n.id}`,
    label: `${n.designator ? `${n.designator} ` : ''}${n.name}`,
    detail: `${hit.room} · ${n.kind}`,
    group: 'node',
    keywords: [n.kind, n.id, ...(n.tags ?? []), n.path ?? ''],
    icon: iconForKind(n.kind),
    run: (open) => goTo(hit, open)
  };
}

/** The same key the user would press, for the things only the canvas or App's own state handles. */
function press(code: string, key: string): void {
  window.dispatchEvent(new KeyboardEvent('keydown', { code, key, bubbles: true }));
}

function buildActions(): Entry[] {
  const s = useBoardStore.getState();
  const prefs = s.chromePrefs;
  const action = (e: Omit<Entry, 'group'>): Entry => ({ ...e, group: 'action' });
  const list: Entry[] = [
    action({ id: 'act.edit', label: s.mode === 'edit' ? 'Leave Edit Board' : 'Edit Board', detail: 'E', icon: 'edit', keywords: ['mode', 'move', 'drag', 'wire', 'arrange'], run: () => s.setMode(s.mode === 'edit' ? 'view' : 'edit') }),
    action({ id: 'act.add', label: 'Add a component', detail: 'N', icon: 'add', keywords: ['new', 'node', 'place', 'part', 'palette'], run: () => { s.setMode('edit'); s.setPaletteOpen(true); } }),
    action({ id: 'act.look', label: 'Board look', detail: 'L', icon: 'look', keywords: ['colour', 'color', 'vignette', 'background', 'tile', 'theme', 'remote'], run: () => s.setLookOpen(true) }),
    action({ id: 'act.settings', label: 'Settings', detail: 'Ctrl+,', icon: 'gear', keywords: ['preferences', 'options', 'autostart', 'away', 'system', 'face'], run: () => s.setSettingsOpen(true) }),
    action({ id: 'act.notifications', label: 'Notifications', icon: 'bell', keywords: ['toasts', 'history', 'messages', 'errors', 'faults'], run: () => s.setNotificationsOpen(true) }),
    action({ id: 'act.keys', label: 'All keys', detail: '?', icon: 'keys', keywords: ['shortcuts', 'keyboard', 'help'], run: () => s.setKeysOpen(true) }),
    action({ id: 'act.about', label: 'About SkynetOS', icon: 'info', keywords: ['version', 'licence', 'license', 'credits', 'electron'], run: () => s.setAboutOpen(true) }),
    action({ id: 'act.mailbox', label: 'JARVIS mailbox', detail: 'M', icon: 'mail', keywords: ['hands', 'face', 'messages', 'inbox'], run: () => s.setMailboxOpen(true) }),
    action({
      id: 'act.message', label: 'Message JARVIS', detail: '/', icon: 'face', keywords: ['prompt', 'chat', 'send', 'ask', 'corner'],
      run: () => {
        if (prefs.jarvisDockCollapsed) s.setChromePref('jarvisDockCollapsed', false);
        requestAnimationFrame(() => document.querySelector<HTMLTextAreaElement>('.jarvis-input')?.focus());
      }
    }),
    action({
      id: 'act.sleep', label: 'Sleep now (away mode)', detail: 'Shift+Z', icon: 'moon', keywords: ['away', 'idle', 'night', 'rest'],
      run: () => {
        if (typeof window.skynet['away:sleepNow'] !== 'function') { s.toast('warn', 'RESTART SKYNETOS: AWAY MODE ARRIVED AFTER THIS WINDOW OPENED'); return; }
        void window.skynet['away:sleepNow']().then((r) => { if (!r.ok) s.toast('warn', r.error ?? 'COULD NOT SLEEP'); });
      }
    }),
    action({
      id: 'act.face', label: 'Preview the JARVIS face', icon: 'face', keywords: ['avatar', 'frames', 'talk'],
      run: () => {
        if (typeof window.skynet['avatar:preview'] !== 'function') { s.toast('warn', 'RESTART SKYNETOS TO PREVIEW THE FACE'); return; }
        void window.skynet['avatar:preview']();
      }
    }),
    action({ id: 'act.focus', label: s.focus ? 'Focus off' : 'Focus on the selection', detail: 'F', icon: 'target', keywords: ['dim', 'highlight'], run: () => s.toggleFocus() }),
    action({ id: 'act.phantoms', label: s.hidePhantoms ? 'Show recommended nodes' : 'Hide recommended nodes', detail: 'Shift+H', icon: 'eye', keywords: ['phantoms', 'suggestions', 'jarvis'], run: () => s.setHidePhantoms(!s.hidePhantoms) }),
    action({ id: 'act.refresh', label: 'Refresh files and builds', detail: 'F5', icon: 'refresh', keywords: ['recheck', 'rebuild', 'jar', 'artifact', 'latest', 'update', 'stale'], run: () => void s.refreshFiles({ announce: true }) }),
    action({ id: 'act.reload', label: 'Re-read the board', detail: 'R', icon: 'refresh', keywords: ['reload', 'refresh', 'file'], run: () => void s.loadBoard(s.boardId) }),
    action({ id: 'act.whole', label: 'Whole board', detail: '0', icon: 'map', keywords: ['zoom', 'fit', 'overview'], run: () => press('Digit0', '0') }),
    action({ id: 'act.zoomin', label: 'Zoom in', detail: '=', icon: 'add', keywords: ['closer', 'bigger'], run: () => press('Equal', '=') }),
    action({ id: 'act.zoomout', label: 'Zoom out', detail: '-', icon: 'minus', keywords: ['further', 'smaller'], run: () => press('Minus', '-') }),
    action({
      id: 'act.minimap', label: s.minimapOpen && !s.layout.minimapSqueezed ? 'Hide the minimap' : 'Show the minimap', icon: 'map', keywords: ['overview', 'corner'],
      run: () => {
        const showing = s.minimapOpen && !s.layout.minimapSqueezed;
        if (showing) { s.toggleMinimap(); s.setMinimapForced(false); return; }
        if (!s.minimapOpen) s.toggleMinimap();
        s.setMinimapForced(true);
      }
    }),
    action({ id: 'act.usage', label: prefs.usageMinimized ? 'Show the whole usage meter' : 'Minimise the usage meter', icon: 'usage', keywords: ['tokens', 'rate', 'pool', 'collapse'], run: () => s.setChromePref('usageMinimized', !prefs.usageMinimized) }),
    action({ id: 'act.calibrate', label: 'Calibrate the usage meter', icon: 'calibrate', keywords: ['plan', 'budget', 'tokens', 'limit'], run: () => { s.setChromePref('usageMinimized', false); s.requestPlanDialog(); } }),
    action({ id: 'act.dock', label: prefs.dockCollapsed ? 'Unfold the session dock' : 'Fold the session dock', icon: 'list', keywords: ['sessions', 'services', 'collapse'], run: () => s.setChromePref('dockCollapsed', !prefs.dockCollapsed) }),
    action({ id: 'act.help', label: prefs.helpHidden ? 'Show the help line' : 'Hide the help line', icon: 'help', keywords: ['hint', 'bottom'], run: () => s.setChromePref('helpHidden', !prefs.helpHidden) }),
    action({ id: 'act.diag', label: 'Renderer diagnostics', detail: '`', icon: 'info', keywords: ['fps', 'camera', 'dpr', 'debug'], run: () => press('Backquote', '`') }),
    action({ id: 'act.undo', label: s.history.canUndo ? `Undo ${s.history.undoLabel ?? ''}`.trim() : 'Undo', detail: 'Ctrl+Z', icon: 'left', keywords: ['back', 'revert'], run: () => void s.undo() }),
    action({ id: 'act.redo', label: 'Redo', detail: 'Ctrl+Y', icon: 'right', keywords: ['again'], run: () => void s.redo() })
  ];
  if (s.stack.length > 1) {
    list.push(action({ id: 'act.up', label: 'Up a room', detail: 'Backspace', icon: 'up', keywords: ['parent', 'back', 'ascend'], run: () => void s.ascend() }));
  }
  return list;
}

export function CommandPalette(): React.JSX.Element | null {
  const open = useBoardStore((s) => s.commandPaletteOpen);
  const setOpen = useBoardStore((s) => s.setCommandPaletteOpen);
  // A fresh body on each opening, so the query, the selection and the index start over.
  return open ? <PaletteBody onClose={() => setOpen(false)} /> : null;
}

function PaletteBody({ onClose }: { onClose: () => void }): React.JSX.Element {
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const [recent] = useState<string[]>(loadRecent);
  const [hits, setHits] = useState<NodeHit[]>(currentHits);
  const [indexing, setIndexing] = useState(true);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const actions = useMemo(buildActions, []);

  useEffect(() => {
    inputRef.current?.focus();
    let live = true;
    void indexBoards()
      .then((all) => { if (live && all.length) setHits(all); })
      .catch(() => undefined)
      .finally(() => { if (live) setIndexing(false); });
    return () => { live = false; };
  }, []);

  const entries = useMemo(() => [...actions, ...hits.map(nodeEntry)], [actions, hits]);
  const byId = useMemo(() => new Map(entries.map((e) => [e.id, e])), [entries]);
  const ranked = useMemo(() => rankCommands(query, entries, recent), [query, entries, recent]);

  useEffect(() => { setActive(0); }, [query]);
  useEffect(() => {
    listRef.current?.querySelector('.cmdk-item.active')?.scrollIntoView({ block: 'nearest' });
  }, [active]);

  const run = (id: string | undefined, open: boolean): void => {
    const entry = id ? byId.get(id) : undefined;
    if (!entry) return;
    try { window.localStorage.setItem(RECENT_KEY, JSON.stringify(pushRecent(recent, entry.id))); } catch { /* not remembered; harmless */ }
    onClose();
    // After the palette has gone, so a key it presses lands on the board and not on its input.
    requestAnimationFrame(() => { void entry.run(open); });
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLInputElement>): void => {
    // Kept here: Ctrl+Z is the input's own undo, and arrows must not pan the board underneath.
    event.stopPropagation();
    if (event.key === 'Escape' || (event.ctrlKey && event.code === 'KeyK')) { event.preventDefault(); onClose(); return; }
    if (event.key === 'ArrowDown') { event.preventDefault(); setActive((a) => Math.min(ranked.length - 1, a + 1)); return; }
    if (event.key === 'ArrowUp') { event.preventDefault(); setActive((a) => Math.max(0, a - 1)); return; }
    if (event.key === 'Enter') { event.preventDefault(); run(ranked[active]?.id, event.shiftKey); }
  };

  const typed = query.trim() !== '';
  let lastSection = '';
  return (
    <div className="cmdk-backdrop" onPointerDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="cmdk" role="dialog" aria-label="Command palette">
        <div className="cmdk-input-row">
          <Icon name="search" />
          <input
            ref={inputRef}
            className="cmdk-input"
            value={query}
            spellCheck={false}
            placeholder={indexing ? 'Find a node, a room or an action (reading rooms)' : 'Find a node, a room or an action'}
            aria-label="Find a node, a room or an action"
            aria-controls="cmdk-list"
            aria-activedescendant={ranked[active] ? `cmdk-${active}` : undefined}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onKeyDown}
          />
        </div>
        <div className="cmdk-list" id="cmdk-list" role="listbox" ref={listRef}>
          {ranked.length ? ranked.map((item, i) => {
            const section = !typed && item.recent ? 'Recent' : item.group === 'action' ? 'Actions' : 'Nodes';
            const head = section !== lastSection ? <div className="cmdk-group">{section}</div> : null;
            lastSection = section;
            const entry = byId.get(item.id);
            return (
              <Fragment key={item.id}>
                {head}
                <button
                  type="button"
                  id={`cmdk-${i}`}
                  role="option"
                  tabIndex={-1}
                  aria-selected={i === active}
                  className={i === active ? 'cmdk-item active' : 'cmdk-item'}
                  onMouseMove={() => { if (i !== active) setActive(i); }}
                  onClick={(e) => run(item.id, e.shiftKey)}
                >
                  <Icon name={entry?.icon ?? 'target'} />
                  <span className="cmdk-label">{item.label}</span>
                  {item.detail ? <span className="cmdk-detail">{item.detail}</span> : null}
                </button>
              </Fragment>
            );
          }) : <div className="cmdk-empty">Nothing matches {query}</div>}
        </div>
        <div className="cmdk-foot">Up · Down choose · Enter go · Shift+Enter open · Esc close</div>
      </div>
    </div>
  );
}
