import { describe, expect, it } from 'vitest';
import {
  IMPORT_MAX_MS,
  IMPORT_MIN_MS,
  newProfile,
  nextImportId,
  normaliseProfile,
  nextUnrecorded,
  parseTranscripts,
  profileFolder,
  profileSummary,
  profilesRoot,
  trimSilence,
  type ProfileLine
} from '../packages/shared/speech.js';

/** The pure half of tools/profile-import.ts: where clips go, what they are called, what is said in them. */

const imported = (n: number, text = '', original = `clip${n}.aif`): ProfileLine =>
  ({ id: `import-${String(n).padStart(2, '0')}`, text, file: `line-import-${String(n).padStart(2, '0')}.wav`, ms: 1200, recordedAt: '2026-09-24T12:00:00.000Z', source: 'imported', original });

describe('profile folders', () => {
  it('live under LOCALAPPDATA, or the fallback the caller names', () => {
    expect(profilesRoot('C:\\Users\\w\\AppData\\Local', 'D:\\fallback')).toBe('C:\\Users\\w\\AppData\\Local\\SkynetOS\\voice-profiles');
    expect(profilesRoot('C:\\Users\\w\\AppData\\Local\\', 'D:\\fallback')).toBe('C:\\Users\\w\\AppData\\Local\\SkynetOS\\voice-profiles');
    expect(profilesRoot(undefined, 'D:\\fallback')).toBe('D:\\fallback');
    expect(profileFolder('D:\\root\\', 'william')).toBe('D:\\root\\william');
  });
});

describe('imported clips in a profile', () => {
  it('are numbered as they arrive', () => {
    const p = newProfile('w', 's');
    expect(nextImportId(p)).toBe('import-01');
    expect(nextImportId({ ...p, lines: [...p.lines, imported(1), imported(7)] })).toBe('import-08');
  });

  it('are counted apart from the script, and never offered to the recorder', () => {
    const p = { ...newProfile('w', 's'), lines: [...newProfile('w', 's').lines, imported(1, 'hello'), imported(2)] };
    expect(profileSummary(p)).toMatchObject({ recorded: 0, total: 40, imported: 2 });
    expect(nextUnrecorded(p)?.id).toBe('l01');
  });

  it('survive a round trip through normaliseProfile, sorted after the script, fakes dropped', () => {
    const raw = {
      lines: [
        imported(2, 'two'),
        { id: 'import-03', text: 'no file', file: null, ms: 0, recordedAt: null },
        { id: 'import-04', text: 'bad file', file: '..\\..\\x.wav', ms: 1, recordedAt: null },
        { id: 'import-01', file: 'line-import-01.wav', ms: 900, recordedAt: '2026-09-24T12:00:00.000Z', original: 'a.aif' }
      ]
    };
    const p = normaliseProfile(raw, 'w', 's');
    expect(p.lines.length).toBe(42);
    expect(p.lines[40]).toMatchObject({ id: 'import-02', source: 'imported', text: 'two' });
    expect(p.lines[41]).toMatchObject({ id: 'import-01', source: 'imported', text: '', original: 'a.aif' });
    expect(p.lines.slice(0, 40).every((l) => l.source === 'scripted')).toBe(true);
  });
});

describe('transcripts.txt', () => {
  it('reads name<TAB>text, ignores comments, blanks and tabless lines, matches case-insensitively', () => {
    const map = parseTranscripts('# clips\nOne.aif\tGood morning, sir.\n\nno tab here\nTwo.AIF\t  The build  is green.  \n');
    expect(map.get('one.aif')).toBe('Good morning, sir.');
    expect(map.get('two.aif')).toBe('The build is green.');
    expect(map.size).toBe(2);
  });
});

describe('trimSilence', () => {
  it('drops leading and trailing quiet below one percent of peak', () => {
    const s = new Float32Array([0, 0.001, 0.5, -0.8, 0.2, 0.002, 0]);
    expect(Array.from(trimSilence(s))).toEqual([0.5, -0.800000011920929, 0.20000000298023224]);
  });
  it('returns nothing for silence, and everything for a clip with no quiet ends', () => {
    expect(trimSilence(new Float32Array(100)).length).toBe(0);
    expect(trimSilence(new Float32Array([0.5, 0.5, 0.5])).length).toBe(3);
  });
  it('keeps the bounds a clip must fit', () => {
    expect(IMPORT_MIN_MS).toBe(500);
    expect(IMPORT_MAX_MS).toBe(30_000);
  });
});
