import { useEffect, useState } from 'react';
import type { AutostartState } from '@shared/boot.js';
import { useBoardStore } from '../store/useBoardStore.js';
import { UI_SCALE_CHOICES, resolveUiScale, uiScaleLabel } from '@shared/ui-scale.js';

/**
 * The machine-level switches: start with Windows, the JARVIS face windows, and a face preview.
 *
 * The cameras and the gesture catalogue used to be here and are now under VIDEO, where they belong:
 * they are a device and its calibration, not machine switches.
 *
 * Its own component so the same controls can sit in LOOK's SYSTEM section and in the Settings
 * panel (Ctrl+,) without being two copies that drift. Every switch goes through a user-only
 * channel that already existed; nothing here adds a write path.
 */
export function SystemSettings(): React.JSX.Element {
  const toast = useBoardStore((s) => s.toast);
  // The chrome's scale (settings.json `uiScale`, written by main through `settings:setUiScale`).
  const uiScaleSetting = useBoardStore((s) => s.uiScaleSetting);
  const osScaleFactor = useBoardStore((s) => s.osScaleFactor);
  const chooseUiScale = useBoardStore((s) => s.chooseUiScale);
  const scaleAvailable = typeof window.skynet['settings:setUiScale'] === 'function';

  /*
   * Start SkynetOS with Windows. Read from the registry by main every time this is shown, so the
   * box says what Windows will actually do, not what was last clicked. A SkynetOS started before
   * this switch existed has no channel for it, and the box says so rather than doing nothing.
   */
  const [autostart, setAutostartState] = useState<AutostartState | null>(null);
  const autostartAvailable = typeof window.skynet['app:autostart'] === 'function';
  // The JARVIS face windows' global switch (settings.json `avatarWindows`, written by main).
  const avatarAvailable = typeof window.skynet['avatar:status'] === 'function';
  const [facesOn, setFacesOn] = useState<boolean | null>(null);
  const previewAvailable = typeof window.skynet['avatar:preview'] === 'function';
  // JARVIS Voice: the hologram window (docs/11). settings.json `hologram.enabled`, written by main.
  const hologramAvailable = typeof window.skynet['hologram:status'] === 'function';
  const [hologramOn, setHologramOn] = useState<boolean | null>(null);

  useEffect(() => {
    if (!avatarAvailable) return;
    let live = true;
    void window.skynet['avatar:status']().then((s) => { if (live) setFacesOn(s.enabled); }).catch(() => undefined);
    return () => { live = false; };
  }, [avatarAvailable]);

  useEffect(() => {
    if (!hologramAvailable) return;
    let live = true;
    void window.skynet['hologram:status']().then((s) => { if (live) setHologramOn(s.enabled); }).catch(() => undefined);
    return () => { live = false; };
  }, [hologramAvailable]);

  useEffect(() => {
    if (!autostartAvailable) return;
    let live = true;
    void window.skynet['app:autostart']().then((state) => { if (live) setAutostartState(state); }).catch(() => undefined);
    return () => { live = false; };
  }, [autostartAvailable]);

  const toggleFaces = async (on: boolean): Promise<void> => {
    const result = await window.skynet['avatar:setEnabled'](on);
    setFacesOn(result.enabled);
  };
  const toggleHologram = async (on: boolean): Promise<void> => {
    try {
      const result = await window.skynet['hologram:setEnabled'](on);
      setHologramOn(result.enabled);
      toast('ok', on ? 'JARVIS Voice window open — it opens with SkynetOS from now on' : 'JARVIS Voice window closed');
    } catch (err) {
      toast('fault', `COULD NOT SWITCH THE JARVIS VOICE WINDOW — ${(err as Error).message}`);
      void window.skynet['hologram:status']().then((s) => setHologramOn(s.enabled)).catch(() => undefined);
    }
  };
  const toggleAutostart = async (on: boolean): Promise<void> => {
    const result = await window.skynet['app:setAutostart'](on);
    setAutostartState(result);
    if (!result.ok) toast('fault', result.error ?? 'COULD NOT CHANGE IT');
    else toast('ok', on ? 'SkynetOS will start with Windows' : 'SkynetOS will no longer start with Windows');
  };
  const previewFace = async (): Promise<void> => {
    if (!previewAvailable) { toast('warn', 'RESTART SKYNETOS TO PREVIEW THE FACE'); return; }
    await window.skynet['avatar:preview']();
  };

  return (
    <>
      {/*
        * UI scale (2026-09-27, William: "a lot of the buttons and UI elements are squashed"). Four
        * whole-number choices, so the chrome stays on --p and Departure Mono stays on 11 × n. The
        * board's pixel zoom is separate and untouched.
        */}
      <div className="look-row" role="group" aria-label="UI scale">
        <span className="look-row-label">UI scale</span>
        {UI_SCALE_CHOICES.map((choice) => (
          <button
            type="button"
            key={String(choice)}
            className="btn tiny look-step"
            aria-pressed={uiScaleSetting === choice}
            disabled={!scaleAvailable}
            onClick={() => void chooseUiScale(choice)}
            title={choice === 'auto'
              ? `Follow Windows' display scale (${resolveUiScale('auto', osScaleFactor)}× here)`
              : `Draw the buttons and panels at ${choice}× whatever Windows says`}
          >
            {uiScaleLabel(choice)}
          </button>
        ))}
      </div>
      <div className="look-note">
        {scaleAvailable
          ? `The size of the buttons, panels and words around the board: now ${resolveUiScale(uiScaleSetting, osScaleFactor)}×. AUTO follows Windows' display scale. Also "UI scale" in Ctrl+K. The board's own zoom is the wheel.`
          : 'Restart SkynetOS to use this switch: the running copy predates it.'}
      </div>
      <label className="look-check">
        <input
          type="checkbox"
          disabled={!autostartAvailable || !autostart?.supported}
          checked={Boolean(autostart?.enabled)}
          onChange={(e) => void toggleAutostart(e.target.checked)}
        />
        Start SkynetOS with Windows
      </label>
      <div className="look-note">
        {!autostartAvailable
          ? 'Restart SkynetOS to use this switch: the running copy predates it.'
          : autostart?.enabled && !autostart.current
            ? `Set, but to something other than this copy: ${autostart.command ?? ''}. Tick it again to point it here.`
            : 'At sign-in, builds the latest code and starts it, with no console window. For this machine only. A copy already open hands over to the new one.'}
      </div>
      <label className="look-check">
        <input
          type="checkbox"
          disabled={!avatarAvailable || facesOn === null}
          checked={facesOn !== false}
          onChange={(e) => void toggleFaces(e.target.checked)}
        />
        JARVIS face windows
      </label>
      <div className="look-note">
        {avatarAvailable
          ? 'A face beside the web Face and every JARVIS Prime terminal: it talks while JARVIS responds and blinks otherwise. Frames go in assets/avatar/jarvis.'
          : 'Restart SkynetOS to use this switch: the running copy predates it.'}
      </div>
      <label className="look-check">
        <input
          type="checkbox"
          disabled={!hologramAvailable || hologramOn === null}
          checked={hologramOn === true}
          onChange={(e) => void toggleHologram(e.target.checked)}
        />
        JARVIS Voice window
      </label>
      <div className="look-note">
        {hologramAvailable
          ? 'The small square with the hologram: microphone, speech and desktop-control switches, a command box and the voice-profile recorder. Bottom-right, close minimises it, and it opens with SkynetOS. docs/11.'
          : 'Restart SkynetOS to use this switch: the running copy predates it.'}
      </div>
      <button
        type="button"
        className="btn"
        disabled={!previewAvailable}
        onClick={() => void previewFace()}
        title="Open the face on its own, alternating talking and idle, to see the frames. Press again or Esc to close."
      >
        PREVIEW FACE
      </button>
    </>
  );
}
