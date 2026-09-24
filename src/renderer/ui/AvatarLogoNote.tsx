import { useEffect, useState } from 'react';
import type { BoardNode } from '@shared/types.js';
import { useBoardStore } from '../store/useBoardStore.js';
import { AVATAR_LOGO_MISSING } from '@shared/logo-source.js';

/**
 * A node whose logo is the JARVIS avatar's face, but whose face cannot be drawn yet, says why.
 *
 * Asks main for the logo exactly as the board does (`mosaic:forNode`, logo slot), so the note is
 * the board's own answer: "avatar has no idle.png yet" while the frames folder is empty, or the
 * decode error if a frame is broken. Silent when the face draws. Rechecked when the folder changes.
 */
export function AvatarLogoNote({ node }: { node: BoardNode }): React.JSX.Element | null {
  const boardId = useBoardStore((s) => s.boardId);
  const [note, setNote] = useState<string | null>(null);
  const [stamp, setStamp] = useState(0);

  useEffect(() => window.skynet.on('avatar:changed', () => setStamp((n) => n + 1)), []);

  useEffect(() => {
    const source = node.logoSource;
    if ((source !== 'avatar' && source !== 'avatar-live') || node.showLogo === false) { setNote(null); return; }
    let alive = true;
    // The animated face is drawn by the board from the frames themselves: ask for those. The still
    // face goes through the mosaic like any logo: ask for that, and get its own error.
    const ask: Promise<string | null> = source === 'avatar-live'
      ? window.skynet['avatar:frames']().then((payload) => (payload.ok ? null : AVATAR_LOGO_MISSING))
      : window.skynet['mosaic:forNode'](boardId, node.id, 'logo').then((result) => (result.ok ? null : result.error));
    void ask.then((text) => { if (alive) setNote(text); }).catch(() => undefined);
    return () => { alive = false; };
  }, [boardId, node.id, node.logoSource, node.showLogo, stamp]);

  if (!note) return null;
  return (
    <div className="state warn" title="Logo source is set to the avatar. Frames go in assets/avatar/jarvis; see its README.">
      <div className="state-line">{note}</div>
    </div>
  );
}
