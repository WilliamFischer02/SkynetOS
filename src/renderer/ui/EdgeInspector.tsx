import { EDGE_KINDS, type BoardEdge, type EdgeKind, type WireDash } from '@shared/types.js';
import { COPPER, INK, ROOM_THEMES, WIRE_TOKENS, resolveWireToken, type WireToken } from '@shared/palette.js';
import { anchorLabel } from '../board/wire-geometry.js';
import { useBoardStore } from '../store/useBoardStore.js';
import { Icon } from './Icon.js';

/**
 * The selected wire, and everything about it that can be changed.
 *
 * William: "I also want wires to be selectable / color and stroke editable." Click a wire on the
 * board and this replaces the node inspector: its kind, its run colour, its outline colour, its
 * width, the room its inner strand points at, and a delete. Every change is an `edge.update`
 * through the command bus, so it is snapshotted and Ctrl+Z takes it back, and a delete goes
 * through the same native confirmation every other deletion does.
 *
 * Colours are palette TOKENS, never hex, for the reason the node colours are: a board cannot name
 * an off-palette colour, and `signal` stays each room's own accent.
 */

const WIDTHS: NonNullable<BoardEdge['width']>[] = [1, 2, 3, 4];
const OUTLINE_WIDTHS: NonNullable<BoardEdge['outlineWidth']>[] = [0, 1, 2, 3];
/** The pattern choices: undefined first, meaning "what the kind does" for the run and "follow the run" for the outline. */
const DASHES: (WireDash | undefined)[] = [undefined, 'solid', 'dashed', 'dotted'];
const DASH_LABEL: Record<WireDash, string> = { solid: 'SOLID', dashed: 'DASHED', dotted: 'DOTTED' };

export function EdgeInspector(): React.JSX.Element | null {
  const board = useBoardStore((s) => s.board);
  const selectedEdgeId = useBoardStore((s) => s.selectedEdgeId);
  const busy = useBoardStore((s) => s.busy);
  const updateEdge = useBoardStore((s) => s.updateEdge);
  const deleteEdge = useBoardStore((s) => s.deleteEdge);
  const select = useBoardStore((s) => s.select);

  if (!board || !selectedEdgeId) return null;
  const edge = board.edges.find((e) => e.id === selectedEdgeId);
  if (!edge) return null;

  const nodeName = (id: string): string => {
    const node = board.nodes.find((n) => n.id === id);
    return node ? (node.designator ? `${node.designator} ${node.name}` : node.name) : `${id} (missing)`;
  };
  const change = (patch: Partial<BoardEdge>): void => { void updateEdge(edge.id, patch); };

  /** A row of swatches for one colour field. The first swatch is "no override". */
  const swatches = (field: 'color' | 'stroke', fallback: string, fallbackLabel: string) => (
    <div className="swatches" role="radiogroup" aria-label={field === 'color' ? 'Run colour' : 'Outline colour'}>
      {[undefined, ...WIRE_TOKENS].map((token: WireToken | undefined) => {
        const hex = resolveWireToken(token, board.theme, fallback);
        const current = edge[field] === token;
        return (
          <button
            key={token ?? 'default'}
            type="button"
            className={token ? 'swatch' : 'swatch default'}
            role="radio"
            aria-checked={current}
            disabled={busy}
            title={token ?? `${fallbackLabel} (default)`}
            style={{ background: hex }}
            onClick={() => change({ [field]: token } as Partial<BoardEdge>)}
          />
        );
      })}
    </div>
  );

  return (
    <aside className="inspector edge-inspector">
      <header className="inspector-head">
        <div className="inspector-title">
          <span className="desig with-icon"><Icon name="wire" />TRACE</span>
          <span className="nodename">{edge.id}</span>
        </div>
        <div className="inspector-kind">{nodeName(edge.from)} → {nodeName(edge.to)}</div>
      </header>

      <div className="field">
        <label className="field-label" htmlFor="edge-kind">Kind</label>
        <select
          id="edge-kind"
          className="input"
          value={edge.kind}
          disabled={busy}
          onChange={(e) => change({ kind: e.target.value as EdgeKind })}
        >
          {EDGE_KINDS.map((kind) => <option key={kind} value={kind}>{kind}</option>)}
        </select>
      </div>

      <div className="field">
        <div className="field-label">Run colour</div>
        {swatches('color', COPPER, 'copper')}
      </div>

      <div className="field">
        <div className="field-label">Outline</div>
        {swatches('stroke', INK, 'ink')}
      </div>

      <div className="field">
        <div className="field-label">Width</div>
        <div className="field-row">
          {WIDTHS.map((width) => (
            <button
              key={width}
              type="button"
              className={(edge.width ?? 2) === width ? 'btn primary' : 'btn'}
              aria-pressed={(edge.width ?? 2) === width}
              disabled={busy}
              onClick={() => change({ width })}
            >
              {width}
            </button>
          ))}
        </div>
      </div>

      {/*
        * Stroke patterns and the outline's width. William: "dotted and dashed and solid strokes and
        * fills, stroke width modifier". Every pattern is whole-pixel rectangles along the route.
        */}
      <div className="field">
        <div className="field-label" title="The copper run's pattern. AUTO keeps the kind's own: a depends wire is dashed.">Run pattern</div>
        <div className="field-row">
          {DASHES.map((dash) => (
            <button
              key={dash ?? 'auto'}
              type="button"
              className={edge.dash === dash ? 'btn primary' : 'btn'}
              aria-pressed={edge.dash === dash}
              disabled={busy}
              onClick={() => change({ dash })}
            >
              {dash ? DASH_LABEL[dash] : 'AUTO'}
            </button>
          ))}
        </div>
      </div>

      <div className="field">
        <div className="field-label" title="The black edge's pattern. FOLLOW outlines each piece of the run; SOLID is one continuous sleeve.">Outline pattern</div>
        <div className="field-row">
          {DASHES.map((dash) => (
            <button
              key={dash ?? 'follow'}
              type="button"
              className={edge.outlineDash === dash ? 'btn primary' : 'btn'}
              aria-pressed={edge.outlineDash === dash}
              disabled={busy}
              onClick={() => change({ outlineDash: dash })}
            >
              {dash ? DASH_LABEL[dash] : 'FOLLOW'}
            </button>
          ))}
        </div>
      </div>

      <div className="field">
        <div className="field-label" title="The black edge on each side, in pixels. 0 draws no outline.">Outline width</div>
        <div className="field-row">
          {OUTLINE_WIDTHS.map((width) => (
            <button
              key={width}
              type="button"
              className={(edge.outlineWidth ?? 1) === width ? 'btn primary' : 'btn'}
              aria-pressed={(edge.outlineWidth ?? 1) === width}
              disabled={busy}
              onClick={() => change({ outlineWidth: width === 1 ? undefined : width })}
            >
              {width}
            </button>
          ))}
        </div>
      </div>

      {/*
        * The route. Pinned ends and hand-moved elbows are made on the board itself (Edit Board mode,
        * the handles on the selected wire); this says what is pinned and puts it all back to auto.
        */}
      <div className="field">
        <div className="field-label">Route</div>
        <div className="dim">
          FROM: {anchorLabel(edge.fromAnchor).toUpperCase()} · TO: {anchorLabel(edge.toAnchor).toUpperCase()}
          {edge.waypoints?.length ? ` · ${edge.waypoints.length} BEND${edge.waypoints.length === 1 ? '' : 'S'}` : ' · AUTO-ROUTED'}
        </div>
        <div className="field-row">
          <button
            type="button"
            className="btn"
            disabled={busy || (!edge.waypoints?.length && !edge.fromAnchor && !edge.toAnchor)}
            title="Forget the pinned ends and the moved elbows, and let the router lay this wire again."
            onClick={() => change({ waypoints: undefined, fromAnchor: undefined, toAnchor: undefined })}
          >
            <Icon name="refresh" />Reset route
          </button>
        </div>
        <div className="dim">
          IN EDIT BOARD (E): DRAG AN END ALONG ITS NODE, OR AN ELBOW · DRAG A SEGMENT'S MIDDLE TO BEND IT ·
          TAB CYCLES THE HANDLES, ARROWS NUDGE, ENTER KEEPS, ESC CANCELS
        </div>
      </div>

      <div className="field">
        <label className="field-label" htmlFor="edge-relation" title="The room whose signal colour the inner strand carries. Colour only.">
          Leads to room
        </label>
        <select
          id="edge-relation"
          className="input"
          value={edge.relation ?? ''}
          disabled={busy}
          onChange={(e) => change({ relation: e.target.value || undefined })}
        >
          <option value="">none</option>
          {Object.keys(ROOM_THEMES).map((room) => <option key={room} value={room}>{room}</option>)}
        </select>
      </div>

      <div className="inspector-actions">
        <button type="button" className="btn" onClick={() => select(edge.from)}><Icon name="target" />Select start</button>
        <button type="button" className="btn" onClick={() => select(edge.to)}><Icon name="target" />Select end</button>
        <button type="button" className="btn danger" disabled={busy} onClick={() => void deleteEdge(edge.id)}>
          <Icon name="close" />Delete trace
        </button>
      </div>

      <div className="dim">ESC DESELECTS · CTRL+Z UNDOES ANY CHANGE</div>
    </aside>
  );
}
