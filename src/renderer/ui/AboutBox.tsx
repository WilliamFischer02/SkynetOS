import { useEffect, useState } from 'react';
import { useBoardStore } from '../store/useBoardStore.js';
import { Icon } from './Icon.js';
import { updateLine, type UpdateStatus } from '@shared/update.js';

/**
 * About SkynetOS: what is running, where the source lives, and whose work it is built on.
 *
 * The version numbers come from main (`app:version`, which already existed). The credit lines were
 * checked against the licence files in assets/fonts and assets/vendor when this was written; the
 * panel names those folders so they can be checked again.
 */

interface Versions { app: string; electron: string; chrome: string; node: string }

const SOURCE = 'github.com/WilliamFischer02/SkynetOS';

export function AboutBox(): React.JSX.Element | null {
  const open = useBoardStore((s) => s.aboutOpen);
  return open ? <AboutBody /> : null;
}

function AboutBody(): React.JSX.Element {
  const setOpen = useBoardStore((s) => s.setAboutOpen);
  const toast = useBoardStore((s) => s.toast);
  const [versions, setVersions] = useState<Versions | null>(null);
  const [update, setUpdate] = useState<UpdateStatus | null>(null);
  // A SkynetOS started before the updater existed has no `update:*` channels. Say so, do not throw.
  const canUpdate = typeof window.skynet['update:status'] === 'function';

  useEffect(() => {
    if (!canUpdate) return;
    let live = true;
    void window.skynet['update:status']().then((u) => { if (live) setUpdate(u); }).catch(() => undefined);
    const off = window.skynet.on('update:state', (u) => setUpdate(u));
    return () => { live = false; off(); };
  }, [canUpdate]);

  const check = async (): Promise<void> => {
    try { setUpdate(await window.skynet['update:check']()); } catch (err) { toast('fault', `COULD NOT CHECK — ${(err as Error).message}`); }
  };
  const install = async (): Promise<void> => {
    try {
      const result = await window.skynet['update:install']();
      if (!result.ok) toast('warn', result.error ?? 'NO UPDATE TO INSTALL');
    } catch (err) {
      toast('fault', `COULD NOT INSTALL — ${(err as Error).message}`);
    }
  };

  useEffect(() => {
    let live = true;
    void window.skynet['app:version']().then((v) => { if (live) setVersions(v); }).catch(() => undefined);
    return () => { live = false; };
  }, []);

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

  // One line to paste into a bug report.
  const copy = async (): Promise<void> => {
    if (!versions) return;
    try {
      await navigator.clipboard.writeText(
        `SkynetOS ${versions.app} · Electron ${versions.electron} · Chromium ${versions.chrome} · Node ${versions.node}`
      );
      toast('ok', 'Version details copied');
    } catch {
      toast('warn', 'COULD NOT REACH THE CLIPBOARD');
    }
  };

  return (
    <div className="about-backdrop">
      <div className="about-panel" role="dialog" aria-label="About SkynetOS">
        <div className="look-head">
          <span className="with-icon"><Icon name="info" />About</span>
          <button type="button" className="btn tiny" onClick={() => setOpen(false)}>Close (Esc)</button>
        </div>
        <div className="about-title">SkynetOS</div>
        <div className="about-sub">
          An overhead pixel-art motherboard that is a real control surface for every project run with Claude.
        </div>
        <dl className="about-grid">
          <dt>Version</dt><dd>{versions?.app ?? '…'}</dd>
          <dt>Electron</dt><dd>{versions?.electron ?? '…'}</dd>
          <dt>Chromium</dt><dd>{versions?.chrome ?? '…'}</dd>
          <dt>Node</dt><dd>{versions?.node ?? '…'}</dd>
          {update?.build ? <><dt>Build</dt><dd>{update.build.commit ?? 'no commit'}{update.build.dirty ? ' + uncommitted' : ''} · {update.build.builtAt.slice(0, 10)}</dd></> : null}
          {update?.home ? <><dt title="Where the boards and the codex live. An update never touches this folder.">Data</dt><dd className="wrap">{update.home.path}</dd></> : null}
          <dt>Source</dt><dd>{SOURCE}</dd>
          <dt>Author</dt><dd>Goob Entertainment Co.</dd>
        </dl>
        <div className="section-head">Updates</div>
        <div className="about-note">{!canUpdate ? 'RESTART SKYNETOS TO SEE UPDATES: THE RUNNING COPY PREDATES THEM' : update ? updateLine(update) : 'READING…'}</div>
        {canUpdate && update && update.state !== 'dev' ? (
          <div className="settings-row">
            <button type="button" className="btn tiny" disabled={update.state === 'checking' || update.state === 'downloading'} onClick={() => void check()}>
              <Icon name="refresh" />Check now
            </button>
            {update.state === 'ready' ? (
              <button type="button" className="btn tiny primary" onClick={() => void install()} title="Closes SkynetOS, installs the update, and starts it again.">
                Restart and update
              </button>
            ) : null}
          </div>
        ) : null}
        <div className="section-head">Built with</div>
        <div className="about-note">Typeface: Departure Mono, © 2022–2024 Helena Zhang, SIL Open Font License 1.1.</div>
        <div className="about-note">
          Board art, all CC0: Kenney&apos;s 1-Bit Pack and UI Pack Sci-fi, Raphael Gonçalves&apos;s top-down tileset,
          and Ogrebane&apos;s 16x16 Tiles from OpenGameArt. The bake step recolours them; the app loads only the
          baked atlas.
        </div>
        <div className="about-note">Electron, React, PixiJS and zustand, each under its own licence.</div>
        <div className="about-note">
          The licence files are in assets/fonts, assets/vendor and each package&apos;s folder in node_modules.
          SkynetOS&apos;s own code has no licence file.
        </div>
        <div className="settings-row">
          <button type="button" className="btn tiny" disabled={!versions} onClick={() => void copy()}>
            <Icon name="copy" />Copy version details
          </button>
        </div>
      </div>
    </div>
  );
}
