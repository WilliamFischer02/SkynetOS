import { useMemo, useState } from 'react';
import type { BoardNode } from '@shared/types.js';
import { DEFAULT_FOOTPRINT, clampFootprint, footprintOf, maxFootprintFor } from '@shared/types.js';
import { ROOM_SUFFIX, roomStem } from '@shared/room-title.js';
import { fieldsFor, isTargetControl, missingRequired, type FieldSpec } from '@shared/node-fields.js';
import { PRIME_STEPS, isPrimeStepId } from '@shared/prime-steps.js';
import { TargetField } from './TargetField.js';
import { DirListField } from './DirListField.js';

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
    } else if (field.control === 'tags' || field.control === 'multi' || field.control === 'dir-list') {
      draft[field.key] = Array.isArray(value) ? value.join(', ') : '';
    } else if (field.control === 'priority') {
      draft[field.key] = String(value ?? 0);
    } else if (field.control === 'footprint') {
      const fp = footprintOf(node);
      draft[field.key] = `${fp.w}x${fp.h}`;
    } else if (field.key === 'name' && node.kind === 'drive.room') {
      /*
       * A room's name field edits the STEM only. The board appends `OS` at draw time, so a title
       * cannot end up as `MinecraftOSOS` and the suffix cannot be deleted by accident.
       * `roomStem` is tolerant of the seeded boards, which stored the full `MinecraftOS`.
       */
      draft[field.key] = roomStem(String(value ?? ''));
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
  if (field.key === 'showDesignator' || field.key === 'showName') return true;
  if (field.key === 'showThumbnail' || field.key === 'showLogo') return true;
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
    } else if (field.control === 'tags' || field.control === 'dir-list') {
      const parts = String(raw ?? '').split(',').map((s) => s.trim()).filter(Boolean);
      next = parts.length ? parts : undefined;
    } else if (field.control === 'multi') {
      /*
       * An empty `multi` is NOT the same as an unset one, which is why this cannot share the
       * `tags` branch. `prelaunch: []` means "prime nothing"; absent means "use the default".
       * Collapsing the two would make it impossible to turn priming off.
       */
      const parts = String(raw ?? '').split(',').map((s) => s.trim()).filter(Boolean);
      next = current === undefined && parts.length === 0 ? undefined : parts;
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
    } else if (field.control === 'priority') {
      const level = Number.parseInt(String(raw ?? '0'), 10);
      // 0 is flat and is the default, so it is stored as absent rather than as a zero — a board
      // file full of `"priority": 0` says nothing and reads as though something was configured.
      next = Number.isInteger(level) && level > 0 ? Math.min(5, level) : undefined;
    } else if (field.control === 'footprint') {
      const [w, h] = String(raw ?? '').split('x').map((n) => Number.parseInt(n, 10));
      if (!Number.isInteger(w) || !Number.isInteger(h)) { errors.push(`${field.label} must be two whole numbers`); continue; }
      const clamped = clampFootprint({ w: w as number, h: h as number }, maxFootprintFor(node.kind));
      // A footprint equal to the kind's default is stored as `undefined`, so a node that has
      // never been resized keeps inheriting the default if that default ever changes.
      const fallback = DEFAULT_FOOTPRINT[node.kind];
      next = fallback && clamped.w === fallback.w && clamped.h === fallback.h ? undefined : clamped;
    } else if (field.key === 'size') {
      const text = String(raw ?? '').trim();
      next = text ? Number(text) : undefined;
    } else if (field.key === 'name' && node.kind === 'drive.room') {
      // Stored without the suffix, whatever was typed. Someone who types "MinecraftOS" out of
      // habit gets "Minecraft" stored and "MinecraftOS" drawn, which is what they meant.
      const stem = roomStem(String(raw ?? ''));
      next = stem ? stem : undefined;
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
            {/*
              * The help text lives in the tooltip, not under the field.
              *
              * Every field carrying a paragraph turned the editor into a wall of prose you had to
              * scroll past to reach the next input — and after the second read you are not reading
              * it, you are scrolling around it. The `?` says there is more to know; hovering says
              * what. The label itself carries the same tooltip, so you do not have to hit a 6px
              * target to get it.
              */}
            <label className="field-label" htmlFor={`f-${String(field.key)}`} title={field.help ?? field.label}>
              {field.label}
              {field.required ? <span className="req" title="Required by the schema"> *</span> : null}
              {field.help ? <span className="field-hint" aria-hidden="true">?</span> : null}
            </label>

            {field.key === 'name' && node.kind === 'drive.room' ? (
              <div className="room-name">
                <input
                  id={`f-${String(field.key)}`}
                  className="input"
                  type="text"
                  spellCheck={false}
                  value={String(value ?? '')}
                  placeholder="Minecraft"
                  disabled={saving}
                  onChange={(e) => set(field.key, e.target.value)}
                />
                <span
                  className="room-suffix"
                  title="Appended automatically to every room title, and drawn one size down in copper-dark with a near-black outline. Not editable — it is a convention, not data."
                >
                  {ROOM_SUFFIX}
                </span>
              </div>
            ) : field.control === 'boolean' ? (
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
            ) : field.control === 'priority' ? (
              <div className="priority-field">
                <input
                  id={`f-${String(field.key)}`}
                  type="range"
                  min={0}
                  max={5}
                  step={1}
                  value={Number(value ?? 0)}
                  disabled={saving}
                  onChange={(e) => set(field.key, e.target.value)}
                />
                {/*
                  * A preview of the actual stack, not a number. The control is choosing a HEIGHT,
                  * so it shows one — each notch is the same two pixels the board draws.
                  */}
                <span className="priority-stack" aria-hidden="true">
                  {Array.from({ length: 5 }, (_, i) => (
                    <span key={i} className={i < Number(value ?? 0) ? 'notch on' : 'notch'} />
                  ))}
                </span>
                <span className="priority-value">
                  {Number(value ?? 0) === 0 ? 'FLAT' : `LEVEL ${Number(value)}`}
                </span>
              </div>
            ) : field.control === 'footprint' ? (
              <FootprintField
                value={String(value ?? '')}
                max={maxFootprintFor(node.kind)}
                disabled={saving}
                onChange={(v) => set(field.key, v)}
              />
            ) : field.control === 'multi' ? (
              <div className="multi">
                {field.options?.map((option) => {
                  const chosen = String(value ?? '').split(',').map((v) => v.trim()).filter(Boolean);
                  const on = chosen.includes(option);
                  const step = isPrimeStepId(option) ? PRIME_STEPS[option] : null;
                  return (
                    <label className={`multi-row${on ? ' on' : ''}`} key={option} title={step?.help ?? option}>
                      <input
                        type="checkbox"
                        checked={on}
                        disabled={saving}
                        onChange={(e) => {
                          const next = e.target.checked
                            ? [...chosen, option]
                            : chosen.filter((c) => c !== option);
                          // Kept in the registry's order, so the list reads the same every time
                          // and a re-tick does not reorder what runs.
                          const ordered = (field.options ?? []).filter((o) => next.includes(o));
                          set(field.key, ordered.join(', '));
                        }}
                      />
                      <span className="multi-label">{step?.label ?? option}</span>
                      {step?.mutates ? <span className="multi-warn" title="Can change files in the repo">writes</span> : null}
                    </label>
                  );
                })}
              </div>
            ) : field.control === 'dir-list' ? (
              <DirListField
                value={String(value ?? '')}
                disabled={saving}
                onChange={(v) => set(field.key, v)}
              />
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

/**
 * Two tile counts, side by side, with steppers.
 *
 * Stored in the draft as `WxH` because the draft is flat strings — the same reason `tags` is a
 * comma-separated string in there. Parsed and clamped on the way back out.
 */
function FootprintField(
  { value, max, disabled, onChange }:
  { value: string; max: number; disabled: boolean; onChange: (v: string) => void }
): React.JSX.Element {
  const [w, h] = value.split('x').map((n) => Number.parseInt(n, 10) || 1);
  const set = (nw: number, nh: number) => {
    const c = clampFootprint({ w: nw, h: nh }, max);
    onChange(`${c.w}x${c.h}`);
  };
  return (
    <div className="footprint-field">
      <label className="footprint-cell">
        <span>W</span>
        <input
          className="input"
          type="number"
          min={1}
          max={max}
          value={w ?? 1}
          disabled={disabled}
          onChange={(e) => set(Number(e.target.value), h ?? 1)}
        />
      </label>
      <span className="footprint-x">x</span>
      <label className="footprint-cell">
        <span>H</span>
        <input
          className="input"
          type="number"
          min={1}
          max={max}
          value={h ?? 1}
          disabled={disabled}
          onChange={(e) => set(w ?? 1, Number(e.target.value))}
        />
      </label>
      <span className="footprint-note">tiles</span>
    </div>
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
