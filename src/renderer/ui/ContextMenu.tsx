import { useEffect, useRef, useState } from 'react';
import { useBoardStore } from '../store/useBoardStore.js';
import { Icon, type IconName } from './Icon.js';

/**
 * The board's right-click menu.
 *
 * William: "right click selected node or cluster and click 'copy', then right click somewhere else
 * on the board and click 'paste'", and "right click a node of any kind and click 'Summon JARVIS'".
 *
 * Opened by the canvas with what was under the cursor: a node, the group it belongs to, or bare
 * substrate. Keyboard-operable (arrows, Enter, Esc), and it closes on any press outside it or a
 * wheel, so it never outlives the moment it was opened for.
 */

interface MenuItem {
  label: string;
  icon?: IconName;
  keys?: string;
  disabled?: boolean;
  run: () => void;
}

export function ContextMenu(): React.JSX.Element | null {
  const menu = useBoardStore((s) => s.contextMenu);
  const setMenu = useBoardStore((s) => s.setContextMenu);
  const board = useBoardStore((s) => s.board);
  const clipboard = useBoardStore((s) => s.clipboard);
  const copyNodes = useBoardStore((s) => s.copyNodes);
  const duplicateNodes = useBoardStore((s) => s.duplicateNodes);
  const pasteNodes = useBoardStore((s) => s.pasteNodes);
  const setSummonTarget = useBoardStore((s) => s.setSummonTarget);
  const openNode = useBoardStore((s) => s.openNode);
  const beginEdit = useBoardStore((s) => s.beginEdit);
  const ref = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState(0);

  const close = (): void => setMenu(null);

  const node = menu?.nodeId ? board?.nodes.find((n) => n.id === menu.nodeId) : undefined;
  const count = menu?.ids.length ?? 0;
  const items: MenuItem[] = [];
  if (menu && count) {
    items.push({ label: count > 1 ? `Copy ${count} nodes` : 'Copy', icon: 'copy', keys: 'Ctrl+C', run: () => copyNodes(menu.ids) });
    items.push({ label: count > 1 ? `Duplicate ${count} nodes` : 'Duplicate', icon: 'add', run: () => void duplicateNodes(menu.ids) });
  }
  if (menu) {
    const n = clipboard?.nodes.length ?? 0;
    items.push({
      label: n > 1 ? `Paste ${n} nodes here` : n === 1 ? `Paste ${clipboard!.nodes[0]!.name} here` : 'Paste',
      icon: 'paste',
      keys: 'Ctrl+V',
      disabled: !n,
      run: () => void pasteNodes(menu.tile)
    });
  }
  if (menu && node) {
    items.push({ label: 'Summon JARVIS', icon: 'face', run: () => setSummonTarget(node.id) });
    items.push({ label: 'Open', icon: 'open', keys: 'Enter', run: () => void openNode(node.id) });
    items.push({ label: 'Edit properties', icon: 'edit', keys: 'F2', run: () => beginEdit(node.id) });
  }

  // Start on the first thing that can actually be done.
  useEffect(() => {
    if (!menu) return;
    setActive(Math.max(0, items.findIndex((i) => !i.disabled)));
    ref.current?.focus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [menu]);

  useEffect(() => {
    if (!menu) return;
    const onDown = (event: PointerEvent): void => {
      if (ref.current && !ref.current.contains(event.target as Node)) close();
    };
    const onWheel = (): void => close();
    window.addEventListener('pointerdown', onDown, true);
    window.addEventListener('wheel', onWheel, { passive: true });
    window.addEventListener('blur', onWheel);
    return () => {
      window.removeEventListener('pointerdown', onDown, true);
      window.removeEventListener('wheel', onWheel);
      window.removeEventListener('blur', onWheel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [menu]);

  if (!menu || !items.length) return null;

  const run = (item: MenuItem | undefined): void => {
    if (!item || item.disabled) return;
    close();
    item.run();
  };

  const onKey = (event: React.KeyboardEvent): void => {
    // Stopped here so App's Escape does not also leave the room, and the arrows do not pan.
    event.stopPropagation();
    if (event.key === 'Escape') { event.preventDefault(); close(); return; }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      const step = event.key === 'ArrowDown' ? 1 : -1;
      let next = active;
      for (let i = 0; i < items.length; i++) {
        next = (next + step + items.length) % items.length;
        if (!items[next]!.disabled) break;
      }
      setActive(next);
      return;
    }
    if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); run(items[active]); }
  };

  // Whole pixels, and never off the edge of the window.
  const width = 220 * useBoardStore.getState().uiScale;
  const x = Math.round(Math.min(menu.screen.x, window.innerWidth - width - 8));
  const y = Math.round(Math.min(menu.screen.y, window.innerHeight - (items.length * 26 + 16) * useBoardStore.getState().uiScale));

  return (
    <div
      ref={ref}
      className="context-menu"
      role="menu"
      tabIndex={-1}
      style={{ left: Math.max(8, x), top: Math.max(8, y) }}
      onKeyDown={onKey}
      onContextMenu={(e) => e.preventDefault()}
    >
      {node ? <div className="context-head">{node.designator ? `${node.designator} ` : ''}{node.name}</div> : null}
      {items.map((item, i) => (
        <button
          type="button"
          role="menuitem"
          key={item.label}
          className={i === active ? 'context-item active' : 'context-item'}
          disabled={item.disabled}
          onMouseEnter={() => setActive(i)}
          onClick={() => run(item)}
        >
          <span className="with-icon">{item.icon ? <Icon name={item.icon} /> : null}{item.label}</span>
          {item.keys ? <span className="context-keys">{item.keys}</span> : null}
        </button>
      ))}
    </div>
  );
}
