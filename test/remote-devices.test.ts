import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { DeviceStore, PairingCodes, appendAudit, hashToken } from '../src/main/services/remote-devices.js';

const dirs: string[] = [];
const tmp = (): string => { const d = mkdtempSync(join(tmpdir(), 'skynet-remote-')); dirs.push(d); return d; };
afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }); });

describe('DeviceStore', () => {
  it('stores only the token hash, and verifies the token', () => {
    const file = join(tmp(), 'remote-devices.json');
    const store = new DeviceStore(file);
    const { device, token } = store.issue('William iPhone');
    expect(token.length).toBeGreaterThanOrEqual(43);
    const onDisk = readFileSync(file, 'utf8');
    expect(onDisk).not.toContain(token);
    expect(onDisk).toContain(hashToken(token));
    expect(new DeviceStore(file).verify(token)?.id).toBe(device.id);
    expect(store.verify(token + 'x')).toBeNull();
  });

  it('forgets a revoked device at once', () => {
    const store = new DeviceStore(null);
    const { device, token } = store.issue('ipad');
    expect(store.revoke(device.id)).toBe(true);
    expect(store.verify(token)).toBeNull();
    expect(store.list()).toEqual([]);
  });

  it('revokes in memory even when the list cannot be saved, says so, and settles the debt later', () => {
    /*
     * Roadmap "Known issues" 9. The save used to throw out of revoke, the caller skipped the
     * disconnect, and the device was back after a restart. A directory where the file should be
     * makes the write fail for real (EISDIR).
     */
    const dir = mkdtempSync(join(tmpdir(), 'skynet-revoke-'));
    const file = join(dir, 'remote-devices.json');
    const store = new DeviceStore(file);
    const { device, token } = store.issue('iphone');
    rmSync(file);
    mkdirSync(file);

    expect(() => store.revoke(device.id)).not.toThrow();
    expect(store.verify(token)).toBeNull();
    expect(store.lastRevokeError).toBeTruthy();

    // The folder is fixed; revoking the same, already-gone device writes the list at last.
    rmSync(file, { recursive: true });
    expect(store.revoke(device.id)).toBe(false);
    expect(store.lastRevokeError).toBeNull();
    expect(new DeviceStore(file).verify(token)).toBeNull();
  });

  it('never lists a hash', () => {
    const store = new DeviceStore(null);
    store.issue('x');
    expect(JSON.stringify(store.list())).not.toContain('tokenHash');
  });

  it('cleans a hostile device name', () => {
    const store = new DeviceStore(null);
    expect(store.issue('<script>alert(1)</script>').device.name).not.toContain('<');
  });
});

describe('PairingCodes', () => {
  it('works once, before it expires', () => {
    let now = 1000;
    const codes = new PairingCodes(() => now, 5000);
    const { code } = codes.create();
    expect(codes.consume(code.toLowerCase())).toBe(true);
    expect(codes.consume(code)).toBe(false);
  });

  it('expires', () => {
    let now = 0;
    const codes = new PairingCodes(() => now, 5000);
    const { code } = codes.create();
    now = 5001;
    expect(codes.current()).toBeNull();
    expect(codes.consume(code)).toBe(false);
  });

  it('retires the old code when a new one is made', () => {
    const codes = new PairingCodes(() => 0, 5000);
    const first = codes.create().code;
    codes.create();
    expect(codes.consume(first)).toBe(false);
  });
});

describe('appendAudit', () => {
  it('writes one line per call, with no arguments', () => {
    const file = join(tmp(), 'remote-audit.log');
    appendAudit(file, { at: 't', device: 'd', channel: 'prompt:send', ok: true });
    const line = JSON.parse(readFileSync(file, 'utf8').trim()) as Record<string, unknown>;
    expect(Object.keys(line).sort()).toEqual(['at', 'channel', 'device', 'ok']);
  });
});
