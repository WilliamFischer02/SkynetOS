import { useEffect, useState } from 'react';
import { useBoardStore } from '../store/useBoardStore.js';

/**
 * "Summon JARVIS": what should JARVIS Prime do with this node?
 *
 * Asked here, before the terminal opens, so the session starts already holding both the target and
 * the directive and gets straight to work. An empty directive is allowed: the session then reads the
 * target, says what it is, and asks one question.
 */
export function SummonDialog(): React.JSX.Element | null {
  const nodeId = useBoardStore((s) => s.summonTarget);
  const setSummonTarget = useBoardStore((s) => s.setSummonTarget);
  const summonJarvis = useBoardStore((s) => s.summonJarvis);
  const board = useBoardStore((s) => s.board);
  const targets = useBoardStore((s) => s.targets);
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);

  useEffect(() => { setText(''); setSending(false); }, [nodeId]);

  const node = nodeId ? board?.nodes.find((n) => n.id === nodeId) : undefined;
  if (!nodeId || !node) return null;

  const resolved = targets[nodeId]?.resolved ?? null;
  const close = (): void => setSummonTarget(null);
  const send = async (): Promise<void> => {
    if (sending) return;
    setSending(true);
    await summonJarvis(nodeId, text);
    setSending(false);
  };

  return (
    <div className="summon-backdrop" onPointerDown={(e) => { if (e.target === e.currentTarget) close(); }}>
      <form
        className="summon-panel"
        onSubmit={(e) => { e.preventDefault(); void send(); }}
        onKeyDown={(e) => {
          // Kept inside the dialog: App's Escape would otherwise leave the room behind it.
          e.stopPropagation();
          if (e.key === 'Escape') { e.preventDefault(); close(); }
          if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void send(); }
        }}
      >
        <div className="summon-head">
          <span>SUMMON JARVIS PRIME</span>
          <button type="button" className="btn tiny" onClick={close}>Close (Esc)</button>
        </div>
        <div className="summon-target">
          <div className="summon-name">{node.designator ? `${node.designator} ` : ''}{node.name}</div>
          <div className="summon-kind">{node.kind}</div>
          {resolved ? <div className="summon-path">{resolved}</div> : null}
        </div>
        <label className="field-label" htmlFor="summon-directive">Your comment or directive</label>
        <textarea
          id="summon-directive"
          className="input summon-input"
          autoFocus
          rows={4}
          spellCheck
          placeholder="What should JARVIS do with this? Leave it empty to be asked."
          value={text}
          disabled={sending}
          onChange={(e) => setText(e.target.value)}
        />
        <div className="summon-foot">
          <span className="summon-note">Opens a fresh JARVIS Prime terminal on this target. Enter sends, Shift+Enter is a new line.</span>
          <button type="submit" className="btn primary" disabled={sending}>{sending ? 'Summoning…' : 'Summon'}</button>
        </div>
      </form>
    </div>
  );
}
