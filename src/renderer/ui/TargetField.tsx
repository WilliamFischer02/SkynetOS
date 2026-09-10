import { useCallback, useEffect, useState } from 'react';
import type { FieldSpec } from '@shared/node-fields.js';
import type { BoardNode } from '@shared/types.js';
import { isBroken, type TargetInfo } from '@shared/targets.js';

/**
 * A field that names something real, with the two things that make it usable: a Browse button
 * that opens the native picker, and a live verdict on whether the value resolves.
 *
 * This is the answer to "ensure linkable nodes have an interface for selecting source files,
 * directories, or the right URL to function". A bare text box is how you end up with a board
 * full of paths that are one character wrong — which the board then correctly renders as broken
 * hardware, but for a reason that took ten minutes to find. Browse makes the correct value the
 * easy value; Verify tells you before you save, not after.
 */

export interface TargetFieldProps {
  field: FieldSpec;
  value: string;
  /** The node being edited, so a glob can see its own exclude list while verifying. */
  context: Partial<BoardNode>;
  onChange: (value: string) => void;
  disabled?: boolean;
}

const VERDICT_LABEL: Record<TargetInfo['state'], string> = {
  ok: 'RESOLVES',
  none: '—',
  unset: 'NOT SET',
  missing: 'NOT FOUND',
  invalid: 'INVALID',
  'outside-dev-root': 'OUTSIDE DEV ROOT',
  unknown: 'UNREADABLE'
};

function verdictClass(state: TargetInfo['state']): string {
  if (state === 'ok') return 'verdict ok';
  if (state === 'unset' || state === 'none') return 'verdict dim';
  if (state === 'outside-dev-root') return 'verdict warn';
  return 'verdict fault';
}

export function TargetField({ field, value, context, onChange, disabled }: TargetFieldProps): React.JSX.Element {
  const [info, setInfo] = useState<TargetInfo | null>(null);
  const [checking, setChecking] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  const verify = useCallback(async (candidate: string) => {
    if (!candidate.trim()) { setInfo({ state: 'unset', raw: candidate, resolved: null, detail: 'NOT SET' }); return; }
    setChecking(true);
    try {
      const result = await window.skynet['target:verify'](field.control, candidate, context);
      setInfo(result);
    } finally {
      setChecking(false);
    }
  }, [field.control, context]);

  // Verify on mount and whenever the value settles. Debounced so typing a long path does not
  // stat the filesystem on every keystroke.
  useEffect(() => {
    const timer = setTimeout(() => void verify(value), 350);
    return () => clearTimeout(timer);
  }, [value, verify]);

  const browse = async () => {
    setNote(null);
    const result = await window.skynet['pick:target']({
      control: field.control,
      current: value,
      title: `Select ${field.label.toLowerCase()}`,
      ...(field.filters ? { filters: field.filters } : {})
    });
    if (result.cancelled) return;
    if (result.error) { setNote(result.error); return; }
    if (result.value) {
      onChange(result.value);
      if (result.note) setNote(result.note);
    }
  };

  const canBrowse = field.control !== 'url';

  return (
    <div className="field">
      {/* Help is a tooltip here too — see NodeEditor for why the paragraphs came out. */}
      <label className="field-label" htmlFor={`f-${String(field.key)}`} title={field.help ?? field.label}>
        {field.label}
        {field.required ? <span className="req" title="Required by the schema"> *</span> : null}
        {field.help ? <span className="field-hint" aria-hidden="true">?</span> : null}
      </label>

      <div className="field-row">
        <input
          id={`f-${String(field.key)}`}
          className={info && isBroken(info) && value.trim() ? 'input bad' : 'input'}
          type="text"
          value={value}
          spellCheck={false}
          placeholder={field.placeholder ?? ''}
          disabled={disabled}
          onChange={(e) => onChange(e.target.value)}
        />
        {canBrowse ? (
          <button type="button" className="btn" onClick={() => void browse()} disabled={disabled}>
            {field.control === 'path-dir' ? 'Browse folder…' : 'Browse…'}
          </button>
        ) : null}
        <button type="button" className="btn" onClick={() => void verify(value)} disabled={disabled || checking}>
          {checking ? 'Checking…' : 'Verify'}
        </button>
      </div>

      {info ? (
        <div className={verdictClass(info.state)}>
          <span className="verdict-tag">{VERDICT_LABEL[info.state]}</span>
          {info.state === 'ok' && info.resolved ? <span className="verdict-detail">{describeOk(info)}</span> : null}
          {info.detail ? <span className="verdict-detail">{info.detail}</span> : null}
          {field.control === 'url' && info.state === 'ok' ? (
            <span className="verdict-detail dim">Shape checked only — SkynetOS does not fetch the URL.</span>
          ) : null}
        </div>
      ) : null}

      {note ? <div className="field-note">{note}</div> : null}
    </div>
  );
}

function describeOk(info: TargetInfo): string {
  const bits: string[] = [];
  if (info.resolved) bits.push(info.resolved);
  if (info.matchCount !== undefined) bits.push(`${info.matchCount} match${info.matchCount === 1 ? '' : 'es'}, newest wins`);
  if (info.versionLabel) bits.push(`version ${info.versionLabel}`);
  if (info.sizeBytes !== undefined && info.kind === 'file') bits.push(formatBytes(info.sizeBytes));
  if (info.mtimeMs !== undefined) bits.push(relativeTime(info.mtimeMs));
  return bits.join(' · ');
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function relativeTime(ms: number): string {
  const delta = Date.now() - ms;
  const minutes = Math.round(delta / 60000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}
