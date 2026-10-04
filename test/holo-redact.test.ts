import { describe, expect, it } from 'vitest';
import { isSecretPath } from '../packages/shared/globe-atlas.js';
import { redactScene, type HoloScene } from '../packages/shared/holo-scene.js';
import { REFUSED_COMBOS, desktopScript, isRefusedCombo } from '../packages/shared/desktop.js';
import { isRefusedChord } from '../packages/shared/actions.js';

/*
 * 2026-09-26 audit (fork N). Three rules the first build missed:
 *  - the globe never draws a secret's contents, even under a trusted root;
 *  - stream mode strips every centre panel to a title (docs/07 § Streaming safety);
 *  - a spoken plan refuses the same key combinations a replayed action does.
 */

describe('isSecretPath', () => {
  it.each([
    'C:/dev/SkynetOS/.env',
    'C:/dev/SkynetOS/.env.local',
    'C:\\Users\\wills\\.ssh\\id_rsa',
    'C:/Users/wills/.ssh/id_ed25519.pub',
    'C:/dev/x/server.pem',
    'C:/dev/x/tls.key',
    'C:/dev/x/store.pfx',
    'C:/Users/wills/.aws/credentials',
    'C:/dev/x/secrets.json',
    'C:/dev/SkynetOS/.git/config',
    'C:/dev/SkynetOS/node_modules/pkg/index.js'
  ])('refuses %s', (path) => {
    expect(isSecretPath(path)).toBe(true);
  });

  it.each([
    'C:/dev/SkynetOS/handoff.md',
    'C:/dev/SkynetOS/src/main/index.ts',
    'C:/dev/SkynetOS/environment.md',
    'C:/dev/x/keyboard.ts',
    'C:/dev/x/monkey.png'
  ])('allows %s', (path) => {
    expect(isSecretPath(path)).toBe(false);
  });
});

describe('redactScene', () => {
  const scene: HoloScene = {
    orbit: [],
    queue: 2,
    sessions: [],
    focus: {
      item: { id: 'a', path: 'C:/dev/a.md', name: 'a.md', kind: 'doc', lat: 1, lon: 2, priority: 32, lastSeen: 1 },
      content: { type: 'paper', title: 'a.md', scrollFrom: 0, lines: ['a secret line'] },
      since: 1,
      action: 'read'
    }
  };

  it('keeps the item and drops the contents', () => {
    const out = redactScene(scene);
    expect(out.focus?.item).toEqual(scene.focus?.item);
    expect(out.focus?.content).toEqual({ type: 'none', title: 'a.md' });
    expect(JSON.stringify(out)).not.toContain('a secret line');
    expect(out.queue).toBe(2);
  });

  it('returns the same scene when there is nothing to hide', () => {
    const idle: HoloScene = { orbit: [], focus: null, queue: 0, sessions: [] };
    expect(redactScene(idle)).toBe(idle);
    const bare = redactScene({ ...scene, focus: { ...scene.focus!, content: { type: 'none', title: 'a.md' } } });
    expect(bare.focus?.content.type).toBe('none');
  });
});

describe('a spoken plan refuses what a replay refuses', () => {
  it.each(['win', 'win+r', 'win+x', 'ctrl+shift+escape', 'alt+f4', 'win+l'])('%s', (combo) => {
    expect(isRefusedCombo(combo)).toBe(true);
    expect(isRefusedChord(combo)).toBe(true);
  });

  it('is the same list inside the helper script', () => {
    const script = desktopScript();
    for (const combo of REFUSED_COMBOS) {
      if (combo === 'alt+ctrl+delete' || combo === 'ctrl+alt+del') continue; // spellings the script normalises by sorting
      expect(script, combo).toContain(`'${combo}'`);
    }
  });

  it('still allows an ordinary shortcut', () => {
    expect(isRefusedCombo('ctrl+s')).toBe(false);
    expect(isRefusedChord('ctrl+s')).toBe(false);
  });
});
