/**
 * The chrome's layout manager: who gets which corner, and what gives way when they collide.
 *
 * William: "check ui elements don't overlap or obscure each other and have hide / relocation
 * behaviors to ensure full program ui legibility." The smoke layout audit found seven states with
 * collisions on 2026-09-11, all the same few shapes:
 *   - the HUD, pushed left by the inspector, running over the breadcrumb;
 *   - the toasts sitting on the minimap, or reaching across into the left-hand stack;
 *   - the LOOK panel hanging down over the minimap and, in a narrow window, the usage meter;
 *   - at 1024 px, the minimap meeting the left stack and the help line meeting everything.
 *
 * Pure. The hook (useChromeLayout.ts) measures the panels and applies the plan; this decides. It
 * works from each panel's NATURAL size, remembered from the last time it was shown in full, never
 * from its current collapsed size. Otherwise collapsing a panel would make the collision vanish,
 * the panel would re-open, and the two states would flicker against each other.
 *
 * What gives way, lowest priority first: the help line (a hint), then the minimap (collapses to its
 * button), then the usage meter (to its header), then the session dock (to its header). The user's
 * own choices always hold: a panel the user collapsed stays collapsed, and a minimap the user
 * re-opened while squeezed stays open.
 */

export interface Box { x: number; y: number; w: number; h: number }

const right = (b: Box): number => b.x + b.w;
const bottom = (b: Box): number => b.y + b.h;

/** What the user collapsed or hid, kept in localStorage. */
export interface ChromePrefs {
  usageMinimized: boolean;
  /** Show every HUD chip in a drop-down even when the HUD is compact. */
  hudExpanded: boolean;
  helpHidden: boolean;
  dockCollapsed: boolean;
  jarvisDockCollapsed: boolean;
}

export const DEFAULT_CHROME_PREFS: ChromePrefs = {
  usageMinimized: false,
  hudExpanded: false,
  helpHidden: false,
  dockCollapsed: false,
  jarvisDockCollapsed: false
};

export interface ChromeInput {
  view: { w: number; h: number };
  /** One `--gap` in px (4 × the chrome scale). */
  gap: number;
  /** Distance from the window's right edge to the right-hand chrome: past the inspector when it is open. */
  dodge: number;
  breadcrumb: Box | null;
  usage: Box | null;
  /** The usage meter's height in full, remembered from when it was last shown in full. */
  usageFullH: number;
  /** The usage meter's height minimised to its header. */
  usageHeadH: number;
  /** The usage meter's drawer is open: the user asked for it, so it is not minimised away. */
  usageExpanded: boolean;
  leftStack: Box | null;
  /** The left stack's height with its dock un-collapsed, remembered. */
  leftStackFullH: number;
  /** The user's own minimap choice (store `minimapOpen`). */
  minimapOpen: boolean;
  /** The user re-opened the minimap while it was squeezed: leave it open. */
  minimapForced: boolean;
  minimapSize: { w: number; h: number };
  minimapButton: { w: number; h: number };
  /** The HUD's width on one line with every chip. */
  hudNaturalW: number;
  /** The help line's full width. */
  helpNaturalW: number;
  lookOpen: boolean;
  lookW: number;
  lookTop: number;
  prefs: ChromePrefs;
  /**
   * A phone, a tablet or a narrow window (`html.compact`, ui/mobile.css). The usage meter starts as
   * its header there: in full it covers a third of an iPhone's screen.
   */
  compact?: boolean;
}

export interface ChromePlan {
  usageMinimized: boolean;
  minimapSqueezed: boolean;
  hudCompact: boolean;
  hudMaxW: number;
  helpHidden: boolean;
  helpMaxW: number;
  toastsBottom: number;
  toastsRight: number;
  toastsMaxW: number;
  lookMaxH: number;
  dockCompact: boolean;
  /**
   * Where the usage meter's top goes: where it always was, or just under the breadcrumb row once that row is taller.
   * It was a fixed `9 * gap`, which the row of switches outgrew (smoke layout audit, 2026-09-12).
   */
  usageTop: number;
  /**
   * Where the LOOK panel's top goes: its usual place, or just under the usage meter when the two share a
   * column and the meter, pushed down by a taller breadcrumb row, would otherwise reach into it.
   */
  lookTop: number;
  /** One line per decision, for the diagnostics and a tooltip. */
  reasons: string[];
}

export const EMPTY_PLAN: ChromePlan = {
  usageMinimized: false,
  minimapSqueezed: false,
  hudCompact: false,
  hudMaxW: 0,
  helpHidden: false,
  helpMaxW: 0,
  toastsBottom: 0,
  toastsRight: 0,
  toastsMaxW: 0,
  lookMaxH: 0,
  dockCompact: false,
  usageTop: 0,
  lookTop: 0,
  reasons: []
};

/** Below this, a LOOK panel is too short to use, and the minimap gives up its corner instead. */
const MIN_LOOK_H = 280;
/** Below this, the help line is not worth showing truncated; it is hidden. */
const MIN_HELP_W = 240;
const MIN_TOAST_W = 160;

export function planChrome(input: ChromeInput): ChromePlan {
  const { gap: g, prefs } = input;
  const unit = Math.max(1, g / 4);
  const W = input.view.w;
  const H = input.view.h;
  const reasons: string[] = [];

  /*
   * The HUD stays on one line, between the breadcrumb and the right-hand chrome. Two lines would
   * reach down into the usage meter's row. When the chips do not fit, the HUD goes compact: the
   * secondary chips move into a drop-down.
   */
  const breadcrumbRight = input.breadcrumb ? right(input.breadcrumb) : 2 * g;
  const hudMaxW = Math.max(0, Math.floor(W - input.dodge - breadcrumbRight - 2 * g));
  const hudCompact = input.hudNaturalW > hudMaxW;
  if (hudCompact) reasons.push(`HUD compact: ${Math.round(input.hudNaturalW)} px of chips in ${hudMaxW} px`);

  const lookLeft = W - input.dodge - input.lookW;
  const leftStackTop = input.leftStack ? bottom(input.leftStack) - input.leftStackFullH : H;
  const leftStackRight = input.leftStack ? right(input.leftStack) : 0;

  // The usage meter: minimised to its header on a small screen, when its full height would meet
  // the left stack, or when the LOOK panel reaches over it. Not while its drawer is open: that was
  // asked for, and on a phone a tap on the header is how you ask.
  const usageTop = input.breadcrumb
    ? Math.max(input.compact ? 0 : 9 * g, Math.round(input.breadcrumb.y + input.breadcrumb.h))
    : (input.usage?.y ?? 9 * g);
  const usageRight = input.usage ? right(input.usage) : 0;
  let usageMinimized = prefs.usageMinimized;
  if (!usageMinimized && input.usage && !input.usageExpanded) {
    const fullBottom = usageTop + input.usageFullH;
    if (input.compact) {
      usageMinimized = true;
      reasons.push('usage meter minimised: a small screen keeps it to its header');
    } else if (input.leftStack && fullBottom > leftStackTop - g) {
      usageMinimized = true;
      reasons.push('usage meter minimised: it would meet the left stack');
    } else if (input.lookOpen && lookLeft < usageRight + g && input.lookTop < fullBottom) {
      usageMinimized = true;
      reasons.push('usage meter minimised: the LOOK panel reaches over it');
    }
  }
  const usageBottom = input.usage ? usageTop + (usageMinimized ? input.usageHeadH : input.usageFullH) : 0;

  const lookTop =
    input.lookOpen && input.usage && lookLeft < usageRight + g && usageBottom + g > input.lookTop ? Math.round(usageBottom + g) : input.lookTop;
  if (lookTop !== input.lookTop) reasons.push('LOOK panel lowered: it would reach over the usage meter');

  // Still colliding with the meter at its smallest? Then the session dock folds to its header.
  const dockCompact = Boolean(input.leftStack && input.usage && leftStackTop < usageBottom + g);
  if (dockCompact) reasons.push('session dock compact: the left column is full');

  /*
   * The minimap, where it would sit if open: bottom right, at the dodge. It collapses to its button
   * when that would put it on the left stack or the usage meter. A user who re-opens it anyway
   * keeps it.
   */
  const mm = input.minimapSize;
  const mmBox: Box = { x: W - input.dodge - mm.w, y: H - 2 * g - mm.h, w: mm.w, h: mm.h };
  let minimapSqueezed = false;
  if (input.minimapOpen && !input.minimapForced) {
    if (input.leftStack && mmBox.x < leftStackRight + g && mmBox.y < bottom(input.leftStack)) {
      minimapSqueezed = true;
      reasons.push('minimap collapsed: it would sit on the left stack');
    } else if (input.usage && mmBox.x < usageRight + g && mmBox.y < usageBottom + g) {
      minimapSqueezed = true;
      reasons.push('minimap collapsed: it would sit on the usage meter');
    }
  }

  // The LOOK panel stops short of whatever is below it.
  let lookMaxH = H - lookTop - 2 * g;
  if (input.lookOpen) {
    const buttonTop = H - 2 * g - input.minimapButton.h;
    const minimapTop = input.minimapOpen && !minimapSqueezed ? mmBox.y : buttonTop;
    lookMaxH = minimapTop - g - lookTop;
    if (lookMaxH < MIN_LOOK_H * unit && input.minimapOpen && !minimapSqueezed && !input.minimapForced) {
      minimapSqueezed = true;
      reasons.push('minimap collapsed: the LOOK panel needs the height');
      lookMaxH = buttonTop - g - lookTop;
    }
    if (input.leftStack && lookLeft < leftStackRight + g) {
      lookMaxH = Math.min(lookMaxH, leftStackTop - g - lookTop);
    }
  }
  lookMaxH = Math.max(Math.round(120 * unit), Math.floor(lookMaxH));

  // Toasts stack above whatever holds the bottom-right corner, and left of an open LOOK panel.
  const minimapVisible = input.minimapOpen && !minimapSqueezed;
  const cornerH = minimapVisible ? mm.h : input.minimapButton.h;
  const cornerW = minimapVisible ? mm.w : input.minimapButton.w;
  const toastsBottom = Math.round(2 * g + cornerH + 2 * g);
  const toastsRight = Math.round(input.lookOpen ? input.dodge + input.lookW + g : input.dodge);
  const leftBound = input.leftStack ? leftStackRight + g : 2 * g;
  const toastsMaxW = Math.round(Math.max(MIN_TOAST_W * unit, Math.min(W * 0.45, W - toastsRight - leftBound)));

  // The help line runs along the bottom until the corner occupant; too little room and it hides.
  const helpMaxW = Math.max(0, Math.floor(W - input.dodge - cornerW - g - 2 * g));
  let helpHidden = prefs.helpHidden;
  if (!helpHidden && helpMaxW < Math.min(input.helpNaturalW, MIN_HELP_W * unit)) {
    helpHidden = true;
    reasons.push('help line hidden: no room along the bottom');
  }

  return {
    usageMinimized,
    minimapSqueezed,
    hudCompact,
    hudMaxW,
    helpHidden,
    helpMaxW,
    toastsBottom,
    toastsRight,
    toastsMaxW,
    lookMaxH,
    dockCompact,
    usageTop: Math.round(usageTop),
    lookTop,
    reasons
  };
}

/** Two plans that would render identically. Keeps the hook from re-rendering on every measurement. */
export function samePlan(a: ChromePlan, b: ChromePlan): boolean {
  return a.usageMinimized === b.usageMinimized
    && a.minimapSqueezed === b.minimapSqueezed
    && a.hudCompact === b.hudCompact
    && a.hudMaxW === b.hudMaxW
    && a.helpHidden === b.helpHidden
    && a.helpMaxW === b.helpMaxW
    && a.toastsBottom === b.toastsBottom
    && a.toastsRight === b.toastsRight
    && a.toastsMaxW === b.toastsMaxW
    && a.lookMaxH === b.lookMaxH
    && a.dockCompact === b.dockCompact
    && a.usageTop === b.usageTop
    && a.lookTop === b.lookTop;
}
