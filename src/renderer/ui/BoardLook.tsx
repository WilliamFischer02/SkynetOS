import { useEffect, useState } from 'react';
import { INK, WIRE_TOKENS, resolveWireToken } from '@shared/palette.js';
import { LOOK_LIMITS, TILE_MAX_PX, resolveLook } from '@shared/look.js';
import { AudioSettings } from './AudioSettings.js';
import { VideoSettings } from './VideoSettings.js';
import type { BoardLook as Look } from '@shared/types.js';
import { useBoardStore } from '../store/useBoardStore.js';
import { RemotePanel } from './RemotePanel.js';
import './look.css';
import { AwaySettings } from './AwayScreen.js';
import { Icon, type IconName } from './Icon.js';
import { SystemSettings } from './SystemSettings.js';

/**
 * The LOOK panel (L): a room's overall colour, vignette and floor.
 *
 * William: "add overall board effects / color scheme customizations that render the board in its
 * entirety with a filtered hue adjustment, add a vignette option and add the ability to select an
 * image that is a perfect square and that image can be tiled as the board background, or else it
 * defaults to what it already is. enable background image tile is a toggle." Plus the "Hide
 * Recommended Nodes" toggle, which belongs with the other things that change what the board shows.
 *
 * Every change is a `board.update` on the room's own file, so each room keeps its own look and
 * Ctrl+Z takes any change back. Sliders draw live through `lookPreview` and commit ONCE on release;
 * a drag that wrote a command per pixel of travel would fill the undo stack with nothing.
 */

type SectionId = 'audio' | 'video' | 'colour' | 'vignette' | 'background' | 'recommendations' | 'system' | 'away';

/*
 * Sorted by what someone actually comes here to do, rather than by what was built first: the two
 * devices at the top (they need setting up, and they are the ones that go wrong), then the machine
 * switches, then the room's appearance, which is the thing you fiddle with once and leave.
 */
const SECTIONS: { id: SectionId; label: string; icon: IconName }[] = [
  { id: 'audio', label: 'Audio · microphone and voice', icon: 'mic' },
  { id: 'video', label: 'Video · cameras and gestures', icon: 'camera' },
  { id: 'system', label: 'System', icon: 'power' },
  { id: 'colour', label: 'Board colour', icon: 'colour' },
  { id: 'vignette', label: 'Vignette', icon: 'vignette' },
  { id: 'background', label: 'Background', icon: 'background' },
  { id: 'recommendations', label: 'Recommendations', icon: 'eye' },
  { id: 'away', label: 'Away', icon: 'moon' }
];

// Only formats the mosaic decodes; WebP and BMP would fail on load (see mosaic.ts).
const IMAGE_FILTERS = [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'gif'] }];

type SliderKey = 'hue' | 'saturation' | 'brightness' | 'contrast';

const SLIDERS: { key: SliderKey; label: string; unit: string }[] = [
  { key: 'hue', label: 'Hue', unit: '°' },
  { key: 'saturation', label: 'Saturation', unit: '%' },
  { key: 'brightness', label: 'Brightness', unit: '%' },
  { key: 'contrast', label: 'Contrast', unit: '%' }
];

export function BoardLook({ onClose }: { onClose: () => void }): React.JSX.Element | null {
  const board = useBoardStore((s) => s.board);
  const boardId = useBoardStore((s) => s.boardId);
  const lookPreview = useBoardStore((s) => s.lookPreview);
  const setLookPreview = useBoardStore((s) => s.setLookPreview);
  const setLook = useBoardStore((s) => s.setLook);
  const hidePhantoms = useBoardStore((s) => s.hidePhantoms);
  const setHidePhantoms = useBoardStore((s) => s.setHidePhantoms);
  const toast = useBoardStore((s) => s.toast);

  const [open, setOpen] = useState<Record<SectionId, boolean>>({
    // The devices open, the decoration folded: a panel that opens with everything expanded is a
    // wall of controls, and the two that need setting up are the ones worth seeing first.
    audio: true, video: true, colour: false, vignette: false, background: false,
    recommendations: false, system: false, away: false
  });
  const [tileNote, setTileNote] = useState<{ ok: boolean; text: string } | null>(null);

  // Start with Windows, the face windows and the face preview are SystemSettings.tsx, shared with Settings (Ctrl+,).

  const saved: Look = board?.look ?? {};
  const current: Look = lookPreview ?? saved;
  const r = resolveLook(current);

  /*
   * The square check, read back from main: the same function the canvas uses to load the floor, so
   * what this line says is what the board will do. Only while the panel is open, and only when the
   * saved picture changes.
   */
  useEffect(() => {
    if (!saved.tileImage) { setTileNote(null); return; }
    let live = true;
    void window.skynet['mosaic:boardTile'](boardId).then((result) => {
      if (!live) return;
      setTileNote(result.ok
        ? { ok: true, text: `Square. Tiles at ${result.width} px${result.width === TILE_MAX_PX ? ' (reduced to the largest tile)' : ''}.` }
        : { ok: false, text: `${result.error}. The room's own substrate is shown instead.` });
    });
    return () => { live = false; };
  }, [boardId, saved.tileImage]);

  if (!board) return null;

  const commit = (next: Look): void => { void setLook(next); };
  const preview = (key: SliderKey, value: number): void => setLookPreview({ ...current, [key]: value });
  const commitPreview = (): void => {
    const pending = useBoardStore.getState().lookPreview;
    if (pending) void setLook(pending);
  };
  const toggle = (id: SectionId): void => setOpen((o) => ({ ...o, [id]: !o[id] }));

  const browse = async (): Promise<void> => {
    const result = await window.skynet['pick:target']({
      control: 'path-file',
      title: 'Select a square image to tile as the board background',
      filters: IMAGE_FILTERS,
      ...(r.tileImage ? { current: r.tileImage } : {})
    });
    if (result.cancelled) return;
    if (result.error) { toast('fault', result.error); return; }
    if (!result.value) return;
    // Choosing a picture is asking to see it, so the toggle comes on with it.
    commit({ ...current, tileImage: result.value, tileEnabled: true });
  };

  const clearTile = (): void => {
    const { tileImage: _image, tileEnabled: _enabled, ...rest } = current;
    commit(rest);
  };

  const section = (id: SectionId, label: string, icon: IconName, body: React.ReactNode): React.JSX.Element => (
    <div key={id}>
      <button type="button" className="look-section" aria-expanded={open[id]} onClick={() => toggle(id)}>
        <span className="look-section-mark">{open[id] ? '[-]' : '[+]'}</span>
        <Icon name={icon} />
        {label}
      </button>
      {open[id] ? <div className="look-body">{body}</div> : null}
    </div>
  );

  const bodies: Record<SectionId, React.ReactNode> = {
    audio: <AudioSettings />,
    video: <VideoSettings />,
    colour: (
      <>
        {SLIDERS.map(({ key, label, unit }) => (
          <label className="look-slider" key={key}>
            <span>{label}</span>
            <input
              type="range"
              min={LOOK_LIMITS[key].min}
              max={LOOK_LIMITS[key].max}
              step={1}
              value={r[key]}
              onChange={(e) => preview(key, Number(e.target.value))}
              onPointerUp={commitPreview}
              onKeyUp={commitPreview}
              onBlur={commitPreview}
            />
            <span className="look-slider-value">{r[key]}{unit}</span>
          </label>
        ))}
        <div className="look-row">
          <button
            type="button"
            className="btn tiny"
            onClick={() => {
              const { hue: _h, saturation: _s, brightness: _b, contrast: _c, ...rest } = current;
              commit(rest);
            }}
          >
            Reset colour
          </button>
        </div>
        <div className="look-note">
          A colour change over the whole board, pixel for pixel: nothing is blurred or moved, but the
          board leaves its palette while this is set.
        </div>
      </>
    ),
    vignette: (
      <>
        <label className="look-check">
          <input type="checkbox" checked={r.vignette} onChange={(e) => commit({ ...current, vignette: e.target.checked })} />
          Vignette
        </label>
        <div className="look-row">
          <span className="look-row-label">Strength</span>
          {[1, 2, 3, 4].map((n) => (
            <button
              type="button"
              key={n}
              className="btn tiny look-step"
              aria-pressed={r.vignetteStrength === n}
              onClick={() => commit({ ...current, vignette: true, vignetteStrength: n })}
            >
              {n}
            </button>
          ))}
        </div>
        <div className="look-row">
          <span className="look-row-label">Colour</span>
          {WIRE_TOKENS.map((token) => (
            <button
              type="button"
              key={token}
              className="look-swatch"
              title={token}
              aria-label={`Vignette colour ${token}`}
              aria-pressed={r.vignetteColor === token}
              style={{ background: resolveWireToken(token, board.theme, INK) }}
              onClick={() => commit({ ...current, vignette: true, vignetteColor: token })}
            />
          ))}
        </div>
      </>
    ),
    background: (
      <>
        <label className="look-check">
          <input
            type="checkbox"
            checked={r.tileEnabled && !!r.tileImage}
            onChange={(e) => {
              if (e.target.checked && !r.tileImage) { void browse(); return; }
              commit({ ...current, tileEnabled: e.target.checked });
            }}
          />
          Enable background image tile
        </label>
        <div className="look-row">
          <button type="button" className="btn tiny" onClick={() => void browse()}>Browse…</button>
          {r.tileImage ? <button type="button" className="btn tiny" onClick={clearTile}>Clear</button> : null}
        </div>
        {r.tileImage ? <div className="look-path">{r.tileImage}</div> : (
          <div className="look-note">No picture. The room shows its own procedural substrate.</div>
        )}
        {tileNote ? <div className={tileNote.ok ? 'look-note ok' : 'look-note warn'}>{tileNote.text}</div> : null}
        <div className="look-row">
          <span className="look-row-label">Scale</span>
          {[1, 2, 3, 4].map((n) => (
            <button
              type="button"
              key={n}
              className="btn tiny look-step"
              aria-pressed={r.tileScale === n}
              onClick={() => commit({ ...current, tileScale: n })}
            >
              {n}X
            </button>
          ))}
        </div>
        <div className="look-note">
          The picture must be a perfect square. It is dithered onto the room&apos;s colours like any
          backdrop and repeats across the whole board.
        </div>
      </>
    ),
    recommendations: (
      <label className="look-check">
        <input type="checkbox" checked={hidePhantoms} onChange={(e) => setHidePhantoms(e.target.checked)} />
        Hide Recommended Nodes
      </label>
    ),
    system: (
      <>
        <SystemSettings />
        <div className="look-note">REMOTE: this board on your phone, tablet or another computer.</div>
        <RemotePanel />
      </>
    ),
    // Away (sleep) mode: what runs after half an hour without input or agents. See AwayScreen.tsx.
    away: <AwaySettings />
  };

  return (
    <div className="look-panel" role="dialog" aria-label="Board look">
      <div className="look-head">
        <span className="with-icon"><Icon name="look" />LOOK · {board.name}</span>
        <button type="button" className="btn tiny" onClick={onClose}>Close (L)</button>
      </div>
      {SECTIONS.map(({ id, label, icon }) => section(id, label, icon, bodies[id]))}
      <div className="look-foot">
        <span>Saved in this room&apos;s board file. Ctrl+Z undoes any change.</span>
        <button type="button" className="btn tiny" onClick={() => commit({})}>Reset whole look</button>
      </div>
    </div>
  );
}
