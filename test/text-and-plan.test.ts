import { describe, expect, it } from 'vitest';
import { ROOM_SUFFIX, roomStem, roomTitle, suffixIsSmaller, suffixSize } from '../packages/shared/room-title.js';
import { PLAN_SPECS, PRO_BASELINE_TOKENS, parsePlanInput, planFromPeak, resolveBudget } from '../packages/shared/plans.js';
import { PALETTE_TOKENS, brighten, isPaletteToken, resolveToken, themeRampHex } from '../packages/shared/palette.js';

const THEME = { maskDark: '#0E1A14', maskLight: '#16261D', signal: '#7FE0B0' };

/*
 * Room titles: the stem is data, the OS is a convention.
 */
describe('room titles', () => {
  it('appends OS to whatever stem is stored', () => {
    expect(roomTitle('Minecraft')).toEqual({ stem: 'Minecraft', suffix: 'OS' });
    expect(ROOM_SUFFIX).toBe('OS');
  });

  it('strips a suffix the seeded boards already stored', () => {
    // The five rooms were written before this existed and hold the full name. Editing one shows
    // the stem and saves the stem, so the migration happens by touching a node.
    expect(roomStem('MinecraftOS')).toBe('Minecraft');
    expect(roomStem('StoryOS')).toBe('Story');
    expect(roomStem('GameOS')).toBe('Game');
  });

  it('strips the separators people actually type', () => {
    expect(roomStem('Minecraft-OS')).toBe('Minecraft');
    expect(roomStem('Minecraft OS')).toBe('Minecraft');
    expect(roomStem('Minecraft_OS')).toBe('Minecraft');
    expect(roomStem('minecraftos')).toBe('minecraft');
  });

  it('never doubles the suffix', () => {
    // Typing "MinecraftOS" out of habit must not produce "MinecraftOSOS" on the board.
    expect(roomTitle(roomStem('MinecraftOS')).stem).toBe('Minecraft');
  });

  it('leaves a name that only contains the suffix alone', () => {
    // Stripping "OS" to nothing would leave an unnamed room. The whole name survives instead.
    expect(roomTitle('OS').stem).toBe('OS');
  });

  it('steps the suffix down one PIXEL-EXACT size, not to 75%', () => {
    /*
     * The one thing that could not be built as asked. Departure Mono is exact at 11px and 22px
     * only (docs/02); 75% of 11 is 8.25, which means scaling a bitmap by a fraction — the precise
     * thing anti-mush treats as a crash-severity bug.
     */
    expect(suffixSize(22)).toBe(11);
    expect(suffixSize(11)).toBe(11);
    expect(suffixIsSmaller(22)).toBe(true);
    // And it says so, rather than pretending: at 11 the suffix reads as subordinate by colour and
    // outline alone.
    expect(suffixIsSmaller(11)).toBe(false);
  });
});

/*
 * Palette tokens: board JSON names a colour, never spells one.
 */
describe('palette tokens', () => {
  it('resolves the room-dependent ones against the room', () => {
    // The whole reason board JSON stores a token. A note that said #7FE0B0 would carry SkynetOS's
    // green into a room that is not green.
    expect(resolveToken('signal', THEME)).toBe(THEME.signal);
    expect(resolveToken('mask-dark', THEME)).toBe(THEME.maskDark);
    expect(resolveToken('signal', { ...THEME, signal: '#A8E85C' })).toBe('#A8E85C');
  });

  it('resolves the shared tri-tone identically in every room', () => {
    expect(resolveToken('copper', THEME)).toBe(resolveToken('copper', { ...THEME, signal: '#FF0000' }));
  });

  it('falls back rather than returning something off-palette', () => {
    expect(resolveToken('#ff00ff', THEME)).toBe('#E9E4D6');
    expect(resolveToken(undefined, THEME)).toBe('#E9E4D6');
  });

  it('recognises exactly the declared tokens', () => {
    for (const token of PALETTE_TOKENS) expect(isPaletteToken(token)).toBe(true);
    expect(isPaletteToken('chartreuse')).toBe(false);
  });

  it('orders the ramp dark to light', () => {
    const ramp = themeRampHex(THEME);
    expect(ramp).toHaveLength(6);
    expect(ramp[0]).toBe(THEME.maskDark);
    expect(ramp[ramp.length - 1]).toBe('#E9E4D6');
  });

  it('brightens along the ramp and saturates at the top', () => {
    const ramp = themeRampHex(THEME);
    expect(brighten(ramp[0] as string, 1, THEME)).toBe(ramp[1]);
    expect(brighten(ramp[5] as string, 2, THEME)).toBe(ramp[5]);
  });

  it('leaves a colour that is not on the ramp untouched', () => {
    // A glow must never invent a colour: if it cannot place the input, it returns it unchanged.
    expect(brighten('#123456', 2, THEME)).toBe('#123456');
  });
});

/*
 * The plan. The multiplier is published; the baseline is calibrated; the pool is never guessed.
 */
describe('plans', () => {
  it('scales every plan off one Pro baseline', () => {
    expect(PLAN_SPECS['pro'].windowTokens).toBe(PRO_BASELINE_TOKENS);
    expect(PLAN_SPECS['max-5x'].windowTokens).toBe(PRO_BASELINE_TOKENS * 5);
    expect(PLAN_SPECS['max-20x'].windowTokens).toBe(PRO_BASELINE_TOKENS * 20);
  });

  it('lands Max 20x on the measured ceiling', () => {
    // Calibration, from this machine: 10,715 messages, 5h windows with p99 94.6M and max 96.1M.
    expect(PLAN_SPECS['max-20x'].windowTokens).toBe(96_000_000);
  });

  it('lets an exact budget beat a plan estimate', () => {
    // A measurement should never argue with an instruction.
    const budget = resolveBudget('max-20x', 50_000_000);
    expect(budget.tokens).toBe(50_000_000);
    expect(budget.source).toBe('setting');
    expect(budget.estimated).toBe(false);
  });

  it('marks a plan-derived budget as an estimate', () => {
    const budget = resolveBudget('max-20x', null);
    expect(budget.source).toBe('plan');
    expect(budget.estimated).toBe(true);
  });

  it('returns nothing at all when neither is set', () => {
    const budget = resolveBudget(null, null);
    expect(budget.tokens).toBeNull();
    expect(budget.source).toBe('none');
  });

  it('treats `custom` with no budget as no budget', () => {
    expect(resolveBudget('custom', null).tokens).toBeNull();
  });
});

describe('parsing what a person types for a plan', () => {
  const cases: [string, string | null][] = [
    ['Max 20x', 'max-20x'],
    ['max20', 'max-20x'],
    ['max 20', 'max-20x'],
    ['MAX20X', 'max-20x'],
    ['claude max 20x', 'max-20x'],
    ['20x', 'max-20x'],
    ['Max 5x', 'max-5x'],
    ['max5', 'max-5x'],
    ['5x', 'max-5x'],
    ['Pro', 'pro'],
    ['Claude Pro', 'pro'],
    ['free', 'free'],
    ['Max', 'max-20x']
  ];

  it.each(cases)('reads %s as %s', (input, expected) => {
    expect(parsePlanInput(input).plan).toBe(expected);
  });

  it('takes a bare token count as an exact budget', () => {
    // "What plan am I on" and "how many tokens do I get" are the same question two ways.
    expect(parsePlanInput('96M')).toMatchObject({ plan: 'custom', tokenBudget: 96_000_000 });
    expect(parsePlanInput('96,000,000')).toMatchObject({ plan: 'custom', tokenBudget: 96_000_000 });
    expect(parsePlanInput('500k')).toMatchObject({ plan: 'custom', tokenBudget: 500_000 });
  });

  it('says what it could not read instead of picking something', () => {
    const parsed = parsePlanInput('the good one');
    expect(parsed.plan).toBeNull();
    expect(parsed.reading).toContain('could not read');
  });

  it('reads nothing as nothing', () => {
    expect(parsePlanInput('   ').plan).toBeNull();
  });
});

describe('planFromPeak — reading the plan off measured history', () => {
  it('recognises this machine as Max 20x', () => {
    expect(planFromPeak(96_100_000)).toBe('max-20x');
  });

  it('recognises a Pro-sized ceiling', () => {
    expect(planFromPeak(PRO_BASELINE_TOKENS)).toBe('pro');
  });

  it('says nothing when the peak matches nothing', () => {
    // An account that has never come near its limit has not revealed it, and guessing from a
    // quiet week is worse than saying nothing.
    expect(planFromPeak(1)).toBeNull();
    expect(planFromPeak(0)).toBeNull();
    expect(planFromPeak(50_000_000_000)).toBeNull();
  });
});
