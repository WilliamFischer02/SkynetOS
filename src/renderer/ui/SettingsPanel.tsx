import { useEffect, useState } from 'react';
import { useBoardStore } from '../store/useBoardStore.js';
import { AwaySettings } from './AwayScreen.js';
import { resetFirstRunHints } from './FirstRunHints.js';
import { Icon, type IconName } from './Icon.js';
import { SystemSettings } from './SystemSettings.js';

/**
 * Settings (Ctrl+,): everything about the app rather than the room, in one place.
 *
 * LOOK is per room (colour, vignette, floor) and was also where the machine-wide switches had ended
 * up, because it was the only panel there was. This panel gathers them: what the chrome shows, the
 * system switches, away mode, and the usage meter's calibration. The controls are the same
 * components LOOK uses (SystemSettings, AwaySettings), through the same user-only channels; nothing
 * here adds a way to write anything.
 */

type SectionId = 'interface' | 'system' | 'away' | 'usage';

const SECTIONS: { id: SectionId; label: string; icon: IconName }[] = [
  { id: 'interface', label: 'Interface', icon: 'list' },
  { id: 'system', label: 'System', icon: 'power' },
  { id: 'away', label: 'Away', icon: 'moon' },
  { id: 'usage', label: 'Usage meter', icon: 'usage' }
];

export function SettingsPanel(): React.JSX.Element | null {
  const open = useBoardStore((s) => s.settingsOpen);
  return open ? <SettingsBody /> : null;
}

function SettingsBody(): React.JSX.Element {
  const setOpen = useBoardStore((s) => s.setSettingsOpen);
  const prefs = useBoardStore((s) => s.chromePrefs);
  const setPref = useBoardStore((s) => s.setChromePref);
  const minimapOpen = useBoardStore((s) => s.minimapOpen);
  const toggleMinimap = useBoardStore((s) => s.toggleMinimap);
  const setMinimapForced = useBoardStore((s) => s.setMinimapForced);
  const hidePhantoms = useBoardStore((s) => s.hidePhantoms);
  const setHidePhantoms = useBoardStore((s) => s.setHidePhantoms);
  const requestPlanDialog = useBoardStore((s) => s.requestPlanDialog);
  const setKeysOpen = useBoardStore((s) => s.setKeysOpen);
  const setAboutOpen = useBoardStore((s) => s.setAboutOpen);
  const setLookOpen = useBoardStore((s) => s.setLookOpen);
  const toast = useBoardStore((s) => s.toast);
  const [open, setSectionOpen] = useState<Record<SectionId, boolean>>({ interface: true, system: true, away: false, usage: true });

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopImmediatePropagation();
      setOpen(false);
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [setOpen]);

  const check = (label: string, checked: boolean, onChange: (on: boolean) => void): React.JSX.Element => (
    <label className="look-check">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      {label}
    </label>
  );

  const bodies: Record<SectionId, React.ReactNode> = {
    interface: (
      <>
        {check('Show the minimap', minimapOpen, (on) => {
          if (on !== minimapOpen) toggleMinimap();
          // Asked for here, so the layout manager leaves it open even when it would move it aside.
          setMinimapForced(on);
        })}
        {check('Usage meter: header only', prefs.usageMinimized, (on) => setPref('usageMinimized', on))}
        {check('Session dock: header only', prefs.dockCollapsed, (on) => setPref('dockCollapsed', on))}
        {check('Corner prompt: folded to a bar', prefs.jarvisDockCollapsed, (on) => setPref('jarvisDockCollapsed', on))}
        {check('Help line along the bottom', !prefs.helpHidden, (on) => setPref('helpHidden', !on))}
        {check('Keep the HUD overflow list open', prefs.hudExpanded, (on) => setPref('hudExpanded', on))}
        {check('Hide recommended nodes (Shift+H)', hidePhantoms, setHidePhantoms)}
        <div className="look-note">
          When the window is too small for every panel, the lower-priority ones fold or move aside on
          their own: the help line, then the minimap, then the usage meter and the session dock. What
          you choose here always holds.
        </div>
        <div className="settings-row">
          <button
            type="button"
            className="btn tiny"
            onClick={() => { resetFirstRunHints(); toast('ok', 'The getting-started card shows again next time SkynetOS opens'); }}
          >
            Show the getting-started card again
          </button>
        </div>
      </>
    ),
    system: (
      <>
        <SystemSettings />
        <div className="look-note">The window opens where you last left it. Remote access is under LOOK, System.</div>
      </>
    ),
    away: <AwaySettings />,
    usage: (
      <>
        <div className="look-note">
          The meter reads your usage off disk. It cannot read your plan&apos;s allowance, so the pool and time left are
          estimates until it is calibrated.
        </div>
        <button
          type="button"
          className="btn"
          onClick={() => { setPref('usageMinimized', false); requestPlanDialog(); setOpen(false); }}
        >
          <Icon name="calibrate" />Calibrate or set my plan
        </button>
      </>
    )
  };

  return (
    <div className="settings-backdrop">
      <div className="settings-panel" role="dialog" aria-label="Settings">
        <div className="look-head">
          <span className="with-icon"><Icon name="gear" />Settings</span>
          <button type="button" className="btn tiny" onClick={() => setOpen(false)}>Close (Esc)</button>
        </div>
        {SECTIONS.map(({ id, label, icon }) => (
          <div key={id}>
            <button
              type="button"
              className="look-section"
              aria-expanded={open[id]}
              onClick={() => setSectionOpen((o) => ({ ...o, [id]: !o[id] }))}
            >
              <span className="look-section-mark">{open[id] ? '[-]' : '[+]'}</span>
              <Icon name={icon} />
              {label}
            </button>
            {open[id] ? <div className="look-body">{bodies[id]}</div> : null}
          </div>
        ))}
        <div className="settings-row">
          <button type="button" className="btn tiny" onClick={() => { setOpen(false); setLookOpen(true); }}><Icon name="look" />Board look (L)</button>
          <button type="button" className="btn tiny" onClick={() => setKeysOpen(true)}><Icon name="keys" />All keys (?)</button>
          <button type="button" className="btn tiny" onClick={() => setAboutOpen(true)}><Icon name="info" />About</button>
        </div>
      </div>
    </div>
  );
}
