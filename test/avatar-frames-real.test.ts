import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { avatarFrameAt, parseFrameNames, pngSize, readTiming } from '../packages/shared/avatar.js';

/**
 * The JARVIS frames William drew, held to the folder's own rules on every `npm run verify`.
 *
 * The loader skips a frame that breaks a rule, with a warning, rather than failing. That is right
 * at runtime and wrong in the repo: a misnamed or odd-sized frame committed here should fail the
 * build, not quietly vanish from the animation.
 */

const DIR = join(__dirname, '..', 'assets', 'avatar', 'jarvis');
const files = readdirSync(DIR);
const set = parseFrameNames(files);

describe('assets/avatar/jarvis', () => {
  it('names every file by the rules, with nothing ignored', () => {
    expect(set.warnings).toEqual([]);
    expect(set.idle).toBe('idle.png');
    expect(set.talk.length).toBeGreaterThanOrEqual(2);
    expect(set.blink.length).toBeGreaterThanOrEqual(1);
  });

  it('draws every frame at the same size as the still face, as a PNG with alpha', () => {
    const frames = [set.idle!, ...set.blink, ...set.talk];
    const idle = pngSize(readFileSync(join(DIR, set.idle!)));
    expect(idle).not.toBeNull();
    for (const file of frames) {
      const bytes = readFileSync(join(DIR, file));
      expect(pngSize(bytes), file).toEqual(idle);
      // IHDR colour type 6 is RGBA: the transparency the window's dark ground shows through.
      expect(bytes[25], `${file} colour type`).toBe(6);
    }
  });

  it('has an avatar.json that reads back exactly as written, nothing clamped', () => {
    const raw = JSON.parse(readFileSync(join(DIR, 'avatar.json'), 'utf8')) as Record<string, unknown>;
    const timing = readTiming(raw);
    for (const key of Object.keys(raw)) {
      expect((timing as unknown as Record<string, unknown>)[key], key).toEqual(raw[key]);
    }
  });

  it('actually talks and blinks with these frames', () => {
    const timing = readTiming(JSON.parse(readFileSync(join(DIR, 'avatar.json'), 'utf8')));
    const talking = new Set<string | null>();
    for (let t = 0; t < 2000; t += 20) talking.add(avatarFrameAt(set, 'speaking', t, timing).file);
    expect(talking.size).toBe(set.talk.length);
    const idle = new Set<string | null>();
    for (let t = 0; t < 30_000; t += 10) idle.add(avatarFrameAt(set, 'idle', t, timing).file);
    for (const b of set.blink) expect(idle.has(b), b).toBe(true);
  });
});
