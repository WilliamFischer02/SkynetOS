import { useEffect, useState } from 'react';
import type { BoardNode } from '@shared/types.js';
import { isGifPath } from '@shared/gif.js';
import { logoSourceOf } from '@shared/logo-source.js';
import { useBoardStore } from '../store/useBoardStore.js';

/**
 * What a GIF wallpaper or logo is doing: how many frames play and how much memory they take, or
 * why fewer play than the file has. Asks main exactly as the board does (`mosaic:forNode`), so the
 * note is the board's own answer; the frames come from main's cache after the first build.
 */
export function GifNote({ node }: { node: BoardNode }): React.JSX.Element | null {
  const boardId = useBoardStore((s) => s.boardId);
  const [lines, setLines] = useState<{ text: string; warn: boolean }[]>([]);

  useEffect(() => {
    const slots: ('face' | 'logo')[] = [];
    if (isGifPath(node.image) && node.showThumbnail !== false) slots.push('face');
    if (isGifPath(node.logo) && logoSourceOf(node) === 'file' && node.showLogo !== false) slots.push('logo');
    if (!slots.length) { setLines([]); return; }
    if (node.imageAnimate === false) {
      setLines([{ text: 'GIF HELD ON ITS FIRST FRAME — Animate GIFs is off', warn: false }]);
      return;
    }
    let alive = true;
    void Promise.all(slots.map(async (slot) => {
      const label = slot === 'face' ? 'WALLPAPER' : 'LOGO';
      const result = await window.skynet['mosaic:forNode'](boardId, node.id, slot);
      if (!result.ok) return { text: `${label}: ${result.error}`, warn: true };
      if (!result.animation) return { text: `${label}: A GIF WITH ONE FRAME — SHOWN STILL`, warn: false };
      const a = result.animation;
      const size = `${(a.decodedBytes / 1048576).toFixed(1)} MB`;
      return {
        text: `${label}: ANIMATED GIF · ${a.frames.length} FRAMES · ${size}${a.truncated && a.note ? ` — ${a.note}` : ''}`,
        warn: a.truncated
      };
    }))
      .then((next) => { if (alive) setLines(next); })
      .catch(() => undefined);
    return () => { alive = false; };
  }, [boardId, node.id, node.image, node.logo, node.logoSource, node.showLogo, node.showThumbnail, node.imageAnimate]);

  if (!lines.length) return null;
  return (
    <div className={lines.some((l) => l.warn) ? 'state warn' : 'state'} title="GIFs are dithered onto the room's palette frame by frame. Up to 120 frames play.">
      {lines.map((l) => <div className="state-line" key={l.text}>{l.text}</div>)}
    </div>
  );
}
