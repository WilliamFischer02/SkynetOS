import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { dirname } from 'node:path';
import { PAIR_CODE_TTL_MS, makePairCode, normalisePairCode } from '@shared/remote.js';

/**
 * Who may connect: paired devices and the one-time codes that pair them. No Electron here, so the
 * server core can be tested in plain Node.
 *
 *   - A pairing code is 8 characters, single use, valid for 5 minutes, and only ever held in memory.
 *   - Pairing issues a 256-bit device token. The DEVICE keeps it (the page's localStorage); this
 *     store keeps only its SHA-256, so the file on disk cannot be replayed as a login.
 *   - Tokens are compared in constant time, and revoking a device deletes its hash.
 */

export interface RemoteDevice {
  id: string;
  name: string;
  tokenHash: string;
  createdAt: string;
  lastSeenAt: string | null;
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

function sameHash(a: string, b: string): boolean {
  const x = Buffer.from(a, 'hex');
  const y = Buffer.from(b, 'hex');
  return x.length === y.length && x.length > 0 && timingSafeEqual(x, y);
}

/** Paired devices, persisted as hashes. `file` null keeps them in memory (the smoke run, the tests). */
export class DeviceStore {
  private devices: RemoteDevice[] = [];

  constructor(private readonly file: string | null) {
    if (file && existsSync(file)) {
      try {
        const parsed = JSON.parse(readFileSync(file, 'utf8')) as { devices?: RemoteDevice[] };
        this.devices = Array.isArray(parsed.devices) ? parsed.devices.filter((d) => d && typeof d.tokenHash === 'string') : [];
      } catch { this.devices = []; }
    }
  }

  list(): Omit<RemoteDevice, 'tokenHash'>[] {
    return this.devices.map(({ tokenHash: _hidden, ...rest }) => rest);
  }

  issue(name: string, now = new Date()): { device: RemoteDevice; token: string } {
    const token = randomBytes(32).toString('base64url');
    const device: RemoteDevice = {
      id: randomUUID(),
      name: String(name || 'device').replace(/[^\w .'-]/g, '').slice(0, 40) || 'device',
      tokenHash: hashToken(token),
      createdAt: now.toISOString(),
      lastSeenAt: null
    };
    this.devices.push(device);
    this.save();
    return { device, token };
  }

  verify(token: string): RemoteDevice | null {
    const hash = hashToken(token);
    return this.devices.find((d) => sameHash(d.tokenHash, hash)) ?? null;
  }

  touch(id: string, now = new Date()): void {
    const d = this.devices.find((x) => x.id === id);
    if (!d) return;
    d.lastSeenAt = now.toISOString();
    this.save();
  }

  /**
   * Why the last revoke could not be written to disk, or null when the file is up to date.
   *
   * A revoke must never throw. Until 2026-09-21 it did when the save failed, and the caller then
   * skipped `disconnect`: the device's open socket stayed up, and because the file still listed the
   * device, its token worked again after the next restart. Memory is the truth for this run, so the
   * token stops working at once whatever the disk says; this field is how the caller learns that the
   * file disagrees, so William is told rather than reassured.
   */
  lastRevokeError: string | null = null;

  revoke(id: string): boolean {
    const before = this.devices.length;
    this.devices = this.devices.filter((d) => d.id !== id);
    const found = this.devices.length !== before;
    // Nothing removed and nothing owed to the disk: a plain "no such device". Revoking again after a
    // failed save lands here with a debt, and tries the write again.
    if (!found && !this.lastRevokeError) return false;
    try {
      this.save();
      this.lastRevokeError = null;
    } catch (err) {
      this.lastRevokeError = (err as Error).message;
    }
    return found;
  }

  private save(): void {
    if (!this.file) return;
    mkdirSync(dirname(this.file), { recursive: true });
    writeFileSync(this.file, JSON.stringify({ devices: this.devices }, null, 2) + '\n', 'utf8');
  }
}

/** The pairing code currently on offer. One at a time: showing a new code retires the old. */
export class PairingCodes {
  private active: { code: string; expiresAt: number } | null = null;

  constructor(
    private readonly now: () => number = Date.now,
    private readonly ttlMs: number = PAIR_CODE_TTL_MS,
    private readonly random: (n: number) => Uint8Array = (n) => randomBytes(n)
  ) {}

  create(): { code: string; expiresAt: number } {
    this.active = { code: makePairCode(this.random), expiresAt: this.now() + this.ttlMs };
    return { ...this.active };
  }

  current(): { code: string; expiresAt: number } | null {
    if (this.active && this.now() > this.active.expiresAt) this.active = null;
    return this.active ? { ...this.active } : null;
  }

  /** True once, for the right code before it expires. */
  consume(input: string): boolean {
    const active = this.current();
    if (!active) return false;
    const a = Buffer.from(normalisePairCode(input));
    const b = Buffer.from(active.code);
    const ok = a.length === b.length && timingSafeEqual(a, b);
    if (ok) this.active = null;
    return ok;
  }

  clear(): void { this.active = null; }
}

export interface AuditEntry { at: string; device: string; channel: string; ok: boolean; error?: string }

/**
 * One line per remote call: when, which device, which channel, and whether it worked. Never the
 * arguments. A prompt sent from the phone is William's words, and a log is not where they belong.
 */
export function appendAudit(file: string | null, entry: AuditEntry): void {
  if (!file) return;
  try {
    mkdirSync(dirname(file), { recursive: true });
    appendFileSync(file, JSON.stringify(entry) + '\n', 'utf8');
  } catch { /* an audit that cannot be written must not break the call it records */ }
}
