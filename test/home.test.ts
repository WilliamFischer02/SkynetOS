import { describe, expect, it } from 'vitest';
import { chooseHome, parseBuildInfo, PROFILE_HOME_DIRNAME, SEED_DIRS } from '../packages/shared/home.js';

/**
 * An installed SkynetOS must never keep the boards inside its own install folder: an update would
 * overwrite them. These hold the rule that decides where the data lives instead.
 */

const has = (...dirs: string[]) => (dir: string): boolean => dirs.includes(dir.replace(/\\/g, '/'));
const base = { appPath: 'C:/Users/w/AppData/Local/Programs/SkynetOS/resources/app.asar', profile: 'C:/Users/w' };

describe('chooseHome', () => {
  it('uses the repo it runs from in a dev build, whatever else is set', () => {
    const choice = chooseHome({ ...base, packaged: false, appPath: 'C:\\dev\\SkynetOS', settingsHome: 'D:/elsewhere', hasBoard: has('D:/elsewhere') });
    expect(choice).toEqual({ home: 'C:/dev/SkynetOS', source: 'dev' });
  });

  it('never chooses the install folder for an installed app', () => {
    for (const hasBoard of [has(), has('C:/dev/SkynetOS'), has('C:/Users/w/SkynetOS')]) {
      const choice = chooseHome({ ...base, packaged: true, builtFrom: 'C:/dev/SkynetOS', hasBoard });
      expect(choice.home).not.toContain('Programs/SkynetOS');
      expect(choice.home).not.toContain('app.asar');
    }
  });

  it('uses the repo the build came from when it is on this machine', () => {
    const choice = chooseHome({ ...base, packaged: true, builtFrom: 'C:/dev/SkynetOS', hasBoard: has('C:/dev/SkynetOS') });
    expect(choice).toEqual({ home: 'C:/dev/SkynetOS', source: 'built-from' });
  });

  it('lets settings.json override that', () => {
    const choice = chooseHome({ ...base, packaged: true, settingsHome: 'D:/Boards/', builtFrom: 'C:/dev/SkynetOS', hasBoard: has('D:/Boards/', 'C:/dev/SkynetOS') });
    expect(choice).toEqual({ home: 'D:/Boards', source: 'settings' });
  });

  it('passes over a configured home that holds no board, and says so', () => {
    const choice = chooseHome({ ...base, packaged: true, settingsHome: 'D:/typo', builtFrom: 'C:/dev/SkynetOS', hasBoard: has('C:/dev/SkynetOS') });
    expect(choice.source).toBe('built-from');
    expect(choice.note).toMatch(/D:\/typo/);
  });

  it('keeps the home it found before, when an update arrives with no builtFrom', () => {
    // The first install was local and found the repo. A published update records no build folder.
    const choice = chooseHome({ ...base, packaged: true, remembered: 'C:/dev/SkynetOS', builtFrom: '', hasBoard: has('C:/dev/SkynetOS') });
    expect(choice).toEqual({ home: 'C:/dev/SkynetOS', source: 'remembered' });
  });

  it('drops a remembered home that no longer holds a board', () => {
    const choice = chooseHome({ ...base, packaged: true, remembered: 'E:/unplugged', builtFrom: 'C:/dev/SkynetOS', hasBoard: has('C:/dev/SkynetOS') });
    expect(choice.source).toBe('built-from');
  });

  it('falls back to the profile home on a machine without the repo', () => {
    const profileHome = `C:/Users/w/${PROFILE_HOME_DIRNAME}`;
    expect(chooseHome({ ...base, packaged: true, builtFrom: 'C:/dev/SkynetOS', hasBoard: has(profileHome) })).toEqual({ home: profileHome, source: 'profile' });
  });

  it('asks for a seed when there is no board anywhere', () => {
    expect(chooseHome({ ...base, packaged: true, builtFrom: null, hasBoard: has() })).toEqual({ home: `C:/Users/w/${PROFILE_HOME_DIRNAME}`, source: 'seed' });
  });
});

describe('parseBuildInfo', () => {
  it('reads what tools/build-info.mjs writes', () => {
    const info = parseBuildInfo(JSON.stringify({ version: '0.1.0', commit: 'cf8d493', dirty: true, builtAt: '2026-09-21T20:00:00.000Z', builtFrom: 'C:\\dev\\SkynetOS\\' }));
    expect(info).toEqual({ version: '0.1.0', commit: 'cf8d493', dirty: true, builtAt: '2026-09-21T20:00:00.000Z', builtFrom: 'C:/dev/SkynetOS' });
  });

  it('is null for anything else, rather than half an answer', () => {
    expect(parseBuildInfo('not json')).toBeNull();
    expect(parseBuildInfo('{"version":"0.1.0"}')).toBeNull();
  });
});

describe('SEED_DIRS', () => {
  it('seeds data only, never program files', () => {
    expect(SEED_DIRS).toContain('board');
    expect(SEED_DIRS).toContain('codex');
    for (const dir of SEED_DIRS) expect(dir).not.toMatch(/^(schema|tools|out|mediapipe)/);
  });
});
