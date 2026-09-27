import { describe, expect, it } from 'vitest';
import { DEFAULT_CHROME_PREFS, MIN_INSPECTOR_W, SWITCH_WORDS_W, planChrome, samePlan, type ChromeInput } from '../src/renderer/ui/chrome-layout.js';

/*
 * Numbers from the smoke layout audit of 2026-09-11, at chrome scale 1 (gap 4). The usage meter is
 * 300 px wide at (8, 36) and about 240 px tall; the left stack is 340 px wide, anchored 36 px above
 * the bottom; the minimap is about 200x150. The inspector is 520 px wide when open (dodge 528), or
 * 44% of a narrow window (dodge 458 at 1024 px).
 */
function input(over: Partial<ChromeInput> = {}): ChromeInput {
  const view = over.view ?? { w: 1920, h: 1080 };
  return {
    view,
    gap: 4,
    dodge: 8,
    breadcrumb: { x: 8, y: 8, w: 130, h: 24 },
    usage: { x: 8, y: 36, w: 300, h: 240 },
    usageFullH: 240,
    usageHeadH: 28,
    usageExpanded: false,
    leftStack: { x: 8, y: view.h - 36 - 250, w: 340, h: 250 },
    leftStackFullH: 250,
    minimapOpen: true,
    minimapForced: false,
    minimapSize: { w: 200, h: 150 },
    minimapButton: { w: 24, h: 24 },
    hudNaturalW: 760,
    helpNaturalW: 510,
    lookOpen: false,
    lookW: 330,
    lookTop: 64,
    prefs: DEFAULT_CHROME_PREFS,
    ...over
  };
}

describe('planChrome', () => {
  it('leaves a roomy window alone', () => {
    const plan = planChrome(input());
    expect(plan.hudCompact).toBe(false);
    expect(plan.minimapSqueezed).toBe(false);
    expect(plan.usageMinimized).toBe(false);
    expect(plan.helpHidden).toBe(false);
    expect(plan.dockCompact).toBe(false);
    expect(plan.reasons).toEqual([]);
  });

  it('keeps the HUD off the breadcrumb when the inspector pushes it left', () => {
    const plan = planChrome(input({ view: { w: 1280, h: 720 }, dodge: 528 }));
    expect(plan.hudCompact).toBe(true);
    // Its right edge is at the dodge, its left edge clear of the breadcrumb.
    expect(1280 - 528 - plan.hudMaxW).toBeGreaterThanOrEqual(138 + 8);
  });

  it('stacks the toasts above the minimap, not on it', () => {
    const plan = planChrome(input());
    const toastsBottomEdge = 1080 - plan.toastsBottom;
    const minimapTop = 1080 - 8 - 150;
    expect(toastsBottomEdge).toBeLessThan(minimapTop);
  });

  it('keeps the toasts clear of the left stack', () => {
    const plan = planChrome(input({ view: { w: 1280, h: 720 }, dodge: 528 }));
    const toastsLeft = 1280 - plan.toastsRight - plan.toastsMaxW;
    expect(toastsLeft).toBeGreaterThanOrEqual(8 + 340 + 4);
  });

  it('collapses the minimap when it would sit on the left stack', () => {
    const plan = planChrome(input({ view: { w: 1024, h: 768 }, dodge: 528 }));
    expect(plan.minimapSqueezed).toBe(true);
    expect(plan.reasons.some((r) => r.includes('left stack'))).toBe(true);
  });

  it('leaves the minimap open when the narrower inspector leaves it room', () => {
    const plan = planChrome(input({ view: { w: 1024, h: 768 }, dodge: 458 }));
    expect(plan.minimapSqueezed).toBe(false);
  });

  it('respects a minimap the user re-opened while it was squeezed', () => {
    const plan = planChrome(input({ view: { w: 1024, h: 768 }, dodge: 528, minimapForced: true }));
    expect(plan.minimapSqueezed).toBe(false);
  });

  it('gives the LOOK panel the height, collapsing the minimap when it must', () => {
    const plan = planChrome(input({ view: { w: 1280, h: 480 }, lookOpen: true }));
    expect(plan.minimapSqueezed).toBe(true);
    expect(plan.reasons.some((r) => r.includes('LOOK'))).toBe(true);
    expect(64 + plan.lookMaxH).toBeLessThanOrEqual(480 - 8 - 24 - 4);
  });

  it('stops the LOOK panel above the minimap when there is height for both', () => {
    const plan = planChrome(input({ lookOpen: true }));
    expect(plan.minimapSqueezed).toBe(false);
    expect(64 + plan.lookMaxH).toBeLessThanOrEqual(1080 - 8 - 150 - 4);
  });

  it('minimises the usage meter when it would meet the left stack', () => {
    const plan = planChrome(input({ view: { w: 1280, h: 560 } }));
    expect(plan.usageMinimized).toBe(true);
  });

  it('does not minimise a usage meter whose drawer the user opened', () => {
    const plan = planChrome(input({ view: { w: 1280, h: 560 }, usageExpanded: true }));
    expect(plan.usageMinimized).toBe(false);
  });

  it('keeps the usage meter to its header on a small screen until it is asked for', () => {
    const phone: Partial<ChromeInput> = { view: { w: 390, h: 844 }, compact: true, leftStack: null, usage: { x: 4, y: 28, w: 187, h: 230 } };
    const plan = planChrome(input(phone));
    expect(plan.usageMinimized).toBe(true);
    expect(plan.reasons.some((r) => r.includes('small screen'))).toBe(true);
    expect(planChrome(input({ ...phone, usageExpanded: true })).usageMinimized).toBe(false);
    // The same meter in a desktop window with room for it stays in full.
    expect(planChrome(input({ compact: false })).usageMinimized).toBe(false);
  });

  it('folds the session dock when even a minimised meter meets it', () => {
    const plan = planChrome(input({ view: { w: 1280, h: 330 } }));
    expect(plan.usageMinimized).toBe(true);
    expect(plan.dockCompact).toBe(true);
  });

  it('hides the help line when there is no room for it, and keeps the user choice', () => {
    // 900 px, the inspector open and the minimap kept open: 230 px left along the bottom.
    expect(planChrome(input({ view: { w: 900, h: 768 }, dodge: 458, minimapForced: true })).helpHidden).toBe(true);
    // At 1024 there are 354 px: shown, truncated, rather than hidden.
    const roomy = planChrome(input({ view: { w: 1024, h: 768 }, dodge: 458 }));
    expect(roomy.helpHidden).toBe(false);
    expect(roomy.helpMaxW).toBeLessThan(510);
    expect(planChrome(input({ prefs: { ...DEFAULT_CHROME_PREFS, helpHidden: true } })).helpHidden).toBe(true);
  });

  it('gives way in order: help first, the usage meter last', () => {
    // Moderately tight: the help line goes before anything else does.
    const plan = planChrome(input({ view: { w: 900, h: 900 }, helpNaturalW: 700 }));
    expect(plan.helpHidden || plan.helpMaxW < 700).toBe(true);
    expect(plan.usageMinimized).toBe(false);
  });

  it('scales its thresholds with the chrome', () => {
    const one = planChrome(input());
    const two = planChrome(input({ gap: 8, view: { w: 3840, h: 2160 } }));
    expect(two.toastsBottom).toBeGreaterThan(one.toastsBottom);
  });

  it('compares plans by what renders, not by their reasons', () => {
    const a = planChrome(input());
    expect(samePlan(a, { ...a, reasons: ['x'] })).toBe(true);
    expect(samePlan(a, { ...a, hudCompact: !a.hudCompact })).toBe(false);
  });
});

/*
 * The HUD's icons level and the narrowing inspector (2026-09-27). The smoke audit's six known
 * failures were the HUD clipped beside an open inspector at 1280x720 and 1024x768: compact was the
 * last resort, and the primary chips alone were wider than the room left. Numbers from that audit:
 * the breadcrumb row is about 242 px wide at 1024 with its switches as icons, the full HUD about
 * 760, compact about 420, icons (+N, find, bell, settings) about 130.
 */
describe('planChrome: the HUD beside an open inspector', () => {
  const narrow = (over: Partial<ChromeInput> = {}): ChromeInput => input({
    view: { w: 1024, h: 768 },
    breadcrumb: { x: 8, y: 8, w: 234, h: 26 },
    hudNaturalW: 760,
    hudCompactW: 420,
    hudIconsW: 130,
    inspectorNaturalW: 450,
    ...over
  });

  it('folds to icons when even the primary chips do not fit, and the icons do fit', () => {
    const plan = planChrome(narrow());
    // 1024 - (450 + 8) - 242 - 8 = 316 px for the HUD.
    expect(plan.hudMaxW).toBe(316);
    expect(plan.hudCompact).toBe(true);
    expect(plan.hudIcons).toBe(true);
    expect(plan.hudMaxW).toBeGreaterThanOrEqual(130);
    expect(plan.inspectorW).toBe(0);
    expect(plan.reasons.some((r) => r.startsWith('HUD icons'))).toBe(true);
  });

  it('stays compact, not icons, when the primary chips fit', () => {
    const plan = planChrome(narrow({ hudCompactW: 300 }));
    expect(plan.hudCompact).toBe(true);
    expect(plan.hudIcons).toBe(false);
  });

  it('stays full when nothing is open', () => {
    const plan = planChrome(narrow({ view: { w: 1920, h: 1080 }, inspectorNaturalW: 0 }));
    expect(plan.hudCompact).toBe(false);
    expect(plan.hudIcons).toBe(false);
    expect(plan.inspectorW).toBe(0);
  });

  it('works the dodge out from the inspector it plans, not the measured one', () => {
    // A measured dodge left over from a narrowed inspector must not change the plan.
    const a = planChrome(narrow({ dodge: 8 }));
    const b = planChrome(narrow({ dodge: 999 }));
    expect(samePlan(a, b)).toBe(true);
  });

  it("narrows the inspector, in whole --p, rather than push the HUD's buttons off", () => {
    // A 3x chrome in a 1920 window: the breadcrumb row is 726 px, the inspector 844, the icons HUD 390.
    const plan = planChrome(narrow({
      view: { w: 1920, h: 1080 },
      gap: 12,
      breadcrumb: { x: 24, y: 24, w: 702, h: 78 },
      hudNaturalW: 2280,
      hudCompactW: 1260,
      hudIconsW: 390,
      inspectorNaturalW: 843
    }));
    expect(plan.hudIcons).toBe(true);
    expect(plan.inspectorW).toBeGreaterThan(0);
    expect(plan.inspectorW).toBeLessThan(843);
    expect(plan.inspectorW % 3).toBe(0);
    // 30% of the window, since 320 x 3 would be half of it.
    expect(plan.inspectorW).toBeGreaterThanOrEqual(576);
    expect(plan.inspectorW).toBe(756);
    expect(plan.hudMaxW).toBeGreaterThanOrEqual(390);
  });

  it('never narrows it below the minimum; the HUD then takes what is left', () => {
    const plan = planChrome(narrow({ view: { w: 960, h: 640 }, breadcrumb: { x: 8, y: 8, w: 500, h: 26 }, hudIconsW: 300, inspectorNaturalW: 422 }));
    expect(plan.inspectorW).toBe(MIN_INSPECTOR_W);
    expect(plan.hudMaxW).toBe(960 - (MIN_INSPECTOR_W + 8) - 508 - 8);
  });

  it("leaves the touch layout's bottom-sheet inspector alone", () => {
    const plan = planChrome(narrow({ compact: true, hudIconsW: 900 }));
    expect(plan.inspectorW).toBe(0);
  });

  it('moves the toasts and the minimap with a narrowed inspector', () => {
    const wide = planChrome(narrow({ view: { w: 960, h: 640 }, breadcrumb: { x: 8, y: 8, w: 500, h: 26 }, hudIconsW: 300, inspectorNaturalW: 422 }));
    expect(wide.toastsRight).toBe(MIN_INSPECTOR_W + 8);
  });

  it('counts the icons level and the inspector width as part of the plan', () => {
    const a = planChrome(narrow());
    expect(samePlan(a, { ...a, hudIcons: !a.hudIcons })).toBe(false);
    expect(samePlan(a, { ...a, inspectorW: 400 })).toBe(false);
  });
});

describe('planChrome: the breadcrumb switches at every chrome scale', () => {
  it('keeps the words at 1x from 1100 px up, as the stylesheet always did', () => {
    expect(planChrome(input({ view: { w: 1280, h: 720 } })).switchIcons).toBe(false);
    expect(planChrome(input({ view: { w: 1024, h: 768 } })).switchIcons).toBe(true);
    expect(SWITCH_WORDS_W).toBe(1100);
  });

  it('scales the threshold with the chrome: icons at 2x below 2200 px, at 3x below 3300', () => {
    expect(planChrome(input({ view: { w: 1920, h: 1080 }, gap: 8 })).switchIcons).toBe(true);
    expect(planChrome(input({ view: { w: 2560, h: 1440 }, gap: 8 })).switchIcons).toBe(false);
    expect(planChrome(input({ view: { w: 2560, h: 1440 }, gap: 12 })).switchIcons).toBe(true);
  });

  it('is part of the plan', () => {
    const a = planChrome(input());
    expect(samePlan(a, { ...a, switchIcons: !a.switchIcons })).toBe(false);
  });
});
