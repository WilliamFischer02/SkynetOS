import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { AGENT_METHODS, CHANNELS, REMOTE_METHODS } from '../packages/shared/ipc.js';
import { UPDATE_IDLE, bumpVersion, updateLine, type UpdateStatus } from '../packages/shared/update.js';

const status = (patch: Partial<UpdateStatus>): UpdateStatus => ({ ...UPDATE_IDLE, current: '0.1.0', ...patch });

describe('updateLine', () => {
  it('tells a dev build how it is actually updated', () => {
    expect(updateLine(status({ state: 'dev' }))).toMatch(/GIT PULL/);
  });

  it('names the version and the progress while downloading', () => {
    expect(updateLine(status({ state: 'downloading', next: '0.2.0', percent: 41.6 }))).toBe('DOWNLOADING 0.2.0 · 42%');
  });

  it('says when a ready update installs, and how to have it now', () => {
    const line = updateLine(status({ state: 'ready', next: '0.2.0' }));
    expect(line).toMatch(/0\.2\.0 IS READY/);
    expect(line).toMatch(/RESTART AND UPDATE/);
  });

  it('ends a failure in what to look at', () => {
    expect(updateLine(status({ state: 'error', error: 'net::ERR_INTERNET_DISCONNECTED' }))).toMatch(/ERR_INTERNET_DISCONNECTED.*ONLINE/);
  });

  it('has a line for every state', () => {
    for (const state of ['dev', 'idle', 'checking', 'downloading', 'ready', 'current', 'error'] as const) {
      expect(updateLine(status({ state })).length).toBeGreaterThan(0);
    }
  });
});

describe('bumpVersion', () => {
  it('bumps each part and zeroes what follows', () => {
    expect(bumpVersion('0.1.4', 'patch')).toBe('0.1.5');
    expect(bumpVersion('0.1.4', 'minor')).toBe('0.2.0');
    expect(bumpVersion('0.1.4', 'major')).toBe('1.0.0');
  });

  it('drops a pre-release suffix and refuses nonsense', () => {
    expect(bumpVersion('0.2.0-beta.1', 'patch')).toBe('0.2.1');
    expect(() => bumpVersion('latest', 'patch')).toThrow(/NOT A VERSION/);
  });
});

describe('who may update', () => {
  it('has the three channels on the allowlist', () => {
    for (const channel of ['update:status', 'update:check', 'update:install']) expect(CHANNELS as readonly string[]).toContain(channel);
  });

  it('never lets an agent or a remote device check or install', () => {
    // Installing restarts the app. docs/07: not an agent's call, and not a phone's.
    for (const channel of ['update:check', 'update:install']) {
      expect(AGENT_METHODS as readonly string[]).not.toContain(channel);
      expect(REMOTE_METHODS as readonly string[]).not.toContain(channel);
    }
  });
});

describe('the installer never auto-publishes and never owns the boards', () => {
  const root = process.cwd();
  const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as { scripts: Record<string, string> };
  const yml = readFileSync(join(root, 'electron-builder.yml'), 'utf8');

  it('passes --publish never on every electron-builder script', () => {
    for (const [name, script] of Object.entries(pkg.scripts)) {
      if (script.includes('electron-builder')) expect(script, name).toContain('--publish never');
    }
  });

  it('installs per user, so an update needs no administrator prompt', () => {
    expect(yml).toMatch(/perMachine:\s*false/);
  });

  it('keeps user data when the program is uninstalled', () => {
    expect(yml).toMatch(/deleteAppDataOnUninstall:\s*false/);
  });

  it('ships build-info.json, which is how an install finds its data home', () => {
    expect(yml).toMatch(/build\/build-info\.json/);
  });
});
