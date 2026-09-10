import { useMemo, useState } from 'react';
import type { BoardNode } from '@shared/types.js';
import { fieldsFor, isTargetControl, missingRequired, type FieldSpec } from '@shared/node-fields.js';
import { TargetField } from './TargetField.js';

/**
 * The node edit interface.
 *
 * Every control on this form comes from `fieldsFor(kind)` in packages/shared/node-fields.ts,
 * which is checked against the JSON Schema by a test. So the form can offer exactly the fields
 * the schema accepts, mark exactly the ones it requires, and never drift from it.
 *
 * Saving builds a `node.update` command and hands it to the bus in the main process. It does not
 * write anything itself. That is what puts a Ctrl+Z behind every edit and a snapshot in front of
 * every write, and it is why an agent's edit and this form's edit are the same operation.
 */

export interface NodeEditorProps {
  node: BoardNode;
  saving: boolean;
  onSave: (patch: Partial<BoardNode>) => void;
  onCancel: () => void;
  onDelete: () => void;
}

/** The in-form value for a field: everything is edited as a string except booleans. */
type Draft = Record<string, string | boolean>;

function toDraft(node: BoardNode): Draft {
  const draft: Draft = {};
  for (const field of fieldsFor(node.kind)) {
    const value = node[field.key];
    if (field.control === 'boolean') {
      draft[field.key] = value === undefined ? defaultBoolean(field) : Boolean(value);
    } else if (field.control === 'tags') {
      draft[field.key] = Array.isArray(value) ? value.join(', ') : '';
    } else if (field.control === 'json') {
      draft[field.key] = value === undefined ? '' : JSON.stringify(value, null, 2);
    } else {
      draft[field.key] = value === undefined || value === null ? '' : String(value);
    }
  }
  return draft;
}

/** Schema defaults, so a checkbox does not read as "off" for a field that defaults to on. */
function defaultBoolean(field: FieldSpec): boolean {
  if (field.key === 'resume') return true;
  if (field.key === 'confirmBeforeLaunch') return true;
  if (field.key === 'enabled') return true;
  // The display toggles default to ON: a node that has never been touched prints everything,
  // which is what every board did before the toggles existed.
  if (field.key === 'showDesignator' || field.key === 'showName' || field.key === 'showThumbnail') return true;
  return false;
}

/**
 * Turn the draft back into a patch, dropping unchanged fields and converting an emptied field
 * to `undefined` so the bus removes it rather than writing an empty string. A board file full
 * of `"remote": ""` is a board file that lies about what is configured.
 */
function toPatch(node: BoardNode, draft: Draft): { patch: Partial<BoardNode>; errors: string[] } {
  const patch: Record<string, unknown> = {};
  const errors: string[] = [];

  for (const field of fieldsFor(node.kind)) {
    const raw = draft[field.key];
    const current = node[field.key];

    let next: unknown;
    if (field.control === 'boolean') {
      next = Boolean(raw);
      if (next === defaultBoolean(field) && current === undefined) continue;
    } else if (field.control === 'tags') {
      const parts = String(raw ?? '').split(',').map((s) => s.trim()).filter(Boolean);
      next = parts.length ? parts : undefined;
    } else if (field.control === 'number') {
      const text = String(raw ?? '').trim();
      if (!text) next = undefined;
      else {
        const n = Number(text);
        if (!Number.isInteger(n)) { errors.push(`${field.label} must be a whole number`); continue; }
        next = n;
      }
    } else if (field.control === 'json') {
      const text = String(raw ?? '').trim();
      if (!text) next = undefined;
      else {
        try {
          const parsed: unknown = JSON.parse(text);
          if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
            errors.push(`${field.label} must be a JSON object`);
            continue;
          }
          next = parsed;
        } catch (err) {
          errors.push(`${field.label} is not valid JSON — ${(err as Error).message}`);
          continue;
        }
      }
    } else if (field.key === 'size') {
      const text = String(raw ?? '').trim();
      next = text ? Number(text) : undefined;
    } else {
      const text = String(raw ?? '');
      next = text.trim() ? text.trim() : undefined;
    }

    if (JSON.stringify(next) === JSON.stringify(current)) continue;
    patch[field.key] = next;
  }

  return { patch: patch as Partial<BoardNode>, errors };
}

export function NodeEditor({ node, saving, onSave, onCancel, onDelete }: NodeEditorProps): React.JSX.Element {
  const [draft, setDraft] = useState<Draft>(() => toDraft(node));
  const fields = useMemo(() => fieldsFor(node.kind), [node.kind]);

  const { patch, errors } = useMemo(() => toPatch(node, draft), [node, draft]);
  const changedKeys = Object.keys(patch);

  // A preview of the node as it would be, so "required field missing" reflects the pending edit
  // rather than the saved state.
  const pending = useMemo(() => ({ ...node, ...patch }) as BoardNode, [node, patch]);
  const missing = missingRequired(pending);

  const set = (key: string, value: string | boolean) => setDraft((d) => ({ ...d, [key]: value }));

  const blocked = errors.length > 0 || missing.length > 0;

  return (
    <form
      className="editor"
      onSubmit={(e) => { e.preventDefault(); if (!blocked && changedKeys.length) onSave(patch); }}
    >
      <div className="editor-head">
        <span className="editor-kind">{node.kind}</span>
        <span className="editor-id">{node.id}</span>
      </div>

      {fields.map((field) => {
        const value = draft[field.key];

        if (isTargetControl(field.control)) {
          return (
            <TargetField
              key={String(field.key)}
              field={field}
              value={String(value ?? '')}
              context={pending}
              disabled={saving}
              onChange={(v) => set(field.key, v)}
            />
          );
        }

        return (
          <div className="field" key={String(field.key)}>
            <label className="field-label" htmlFor={`f-${String(field.key)}`}>
              {field.label}
              {field.required ? <span className="req" title="Required by the schema"> *</span> : null}
            </label>

            {field.control === 'boolean' ? (
              <label className="checkline">
                <input
                  id={`f-${String(field.key)}`}
                  type="checkbox"
                  checked={Boolean(value)}
                  disabled={saving}
                  onChange={(e) => set(field.key, e.target.checked)}
                />
                <span>{Boolean(value) ? 'on' : 'off'}</span>
              </label>
            ) : field.control === 'select' ? (
              <select
                id={`f-${String(field.key)}`}
                className="input"
                value={String(value ?? '')}
                disabled={saving}
                onChange={(e) => set(field.key, e.target.value)}
              >
                <option value="">— unset —</option>
                {field.options?.map((option) => <option key={option} value={option}>{option}</option>)}
              </select>
            ) : field.control === 'textarea' || field.control === 'json' ? (
              <textarea
                id={`f-${String(field.key)}`}
                className="input area"
                rows={field.control === 'json' ? 6 : 3}
                spellCheck={false}
                value={String(value ?? '')}
                placeholder={field.placeholder ?? ''}
                disabled={saving}
                onChange={(e) => set(field.key, e.target.value)}
              />
            ) : (
              <input
                id={`f-${String(field.key)}`}
                className="input"
                type={field.control === 'number' ? 'number' : 'text'}
                spellCheck={false}
                value={String(value ?? '')}
                placeholder={field.placeholder ?? ''}
                disabled={saving}
                onChange={(e) => set(field.key, e.target.value)}
              />
            )}

            {field.help ? <div className="field-help">{field.help}</div> : null}
          </div>
        );
      })}

      {errors.length ? (
        <div className="editor-problems">
          {errors.map((e) => <div key={e}>{e}</div>)}
        </div>
      ) : null}

      {missing.length ? (
        <div className="editor-problems">
          MISSING REQUIRED: {missing.map((f) => f.label).join(', ')}
        </div>
      ) : null}

      <div className="editor-actions">
        <button type="submit" className="btn primary" disabled={saving || blocked || !changedKeys.length}>
          {saving ? 'Saving…' : changedKeys.length ? `Save ${changedKeys.length} change${changedKeys.length === 1 ? '' : 's'}` : 'No changes'}
        </button>
        <button type="button" className="btn" onClick={onCancel} disabled={saving}>Cancel</button>
        <button type="button" className="btn danger" onClick={onDelete} disabled={saving}>Delete node</button>
      </div>

      {changedKeys.length ? (
        <div className="editor-diff">
          <div className="editor-diff-head">Pending changes</div>
          {changedKeys.map((key) => (
            <div className="editor-diff-row" key={key}>
              <span className="k">{key}</span>
              <span className="before">{format(node[key as keyof BoardNode])}</span>
              <span className="arrow">→</span>
              <span className="after">{format((patch as Record<string, unknown>)[key])}</span>
            </div>
          ))}
        </div>
      ) : null}
    </form>
  );
}

function format(value: unknown): string {
  if (value === undefined) return '(unset)';
  if (value === null) return 'null';
  if (typeof value === 'string') return value || '(empty)';
  if (Array.isArray(value)) return value.join(', ');
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}
