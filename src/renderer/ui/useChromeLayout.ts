import { useEffect } from 'react';
import { useBoardStore } from '../store/useBoardStore.js';
import { planChrome, samePlan, type Box, type ChromePlan } from './chrome-layout.js';

/**
 * The layout manager's hook: measure the chrome, plan it (chrome-layout.ts), apply the plan.
 *
 * Measured when something changed, not on a clock. Until 2026-09-26 this ran on a 400 ms
 * interval: nine `getBoundingClientRect` calls plus two `scrollWidth` reads every tick, each of
 * which forces a layout, and `samePlan` then threw the result away almost every time (roadmap
 * "Known issues" 7). The chrome only changes shape when a panel mounts, collapses, or the window
 * is resized, and every one of those is observable: a `ResizeObserver` on the app root and on each
 * measured element, a `MutationObserver` for elements appearing, leaving, or changing class, and
 * the window's `resize`. Measurement is coalesced onto one animation frame however many of those
 * fire. The plan goes two ways: booleans into the store, for the components that collapse (usage
 * meter, minimap, HUD, dock, help), and pixel values as CSS variables on the app root, for the ones
 * that only move (toasts, the LOOK panel's height).
 *
 * Each panel's natural size is remembered from the last time it was shown in full (see
 * chrome-layout.ts on why), so a collapsed panel is planned by the size it would come back at.
 *
 * Applying the plan writes `style` on the app root, which the MutationObserver would see; it
 * watches `class` only, so the write does not schedule a measure of its own. A store change that
 * re-renders a panel changes the DOM, and the observers see that instead.
 */
export function useChromeLayout(appRef: React.RefObject<HTMLDivElement | null>): void {
  useEffect(() => {
    const natural = {
      usageFullH: 0,
      usageHeadH: 0,
      leftStackFullH: 0,
      minimap: { w: 0, h: 0 },
      minimapButton: { w: 0, h: 0 },
      helpW: 0
    };
    let applied: ChromePlan | null = null;
    /*
     * The chrome scale the naturals were measured at. A new `--ui-scale` (LOOK → SYSTEM, the palette's
     * "UI scale", or a monitor with another scale factor) changes every panel's natural size, so
     * they are forgotten and re-measured rather than planned from sizes at the old scale.
     */
    let measuredAt = 0;
    let raf = 0;
    const observed = new Set<Element>();
    const resizeObserver = typeof ResizeObserver === 'function' ? new ResizeObserver(() => soon()) : null;

    /** Watch an element's size from now on; ResizeObserver ignores a second observe of the same element. */
    const watch = (el: Element | null): void => {
      if (!el || !resizeObserver || observed.has(el)) return;
      observed.add(el);
      resizeObserver.observe(el);
    };

    const measure = (): void => {
      raf = 0;
      const app = appRef.current;
      if (!app) return;
      const store = useBoardStore.getState();
      const unit = store.uiScale || 1;
      if (unit !== measuredAt) {
        measuredAt = unit;
        natural.usageFullH = 0;
        natural.usageHeadH = 0;
        natural.leftStackFullH = 0;
        natural.minimap = { w: 0, h: 0 };
        natural.minimapButton = { w: 0, h: 0 };
        natural.helpW = 0;
        applied = null;
      }
      const gap = 4 * unit;
      const q = (selector: string): HTMLElement | null => {
        const el = app.querySelector<HTMLElement>(selector);
        watch(el);
        return el;
      };
      const box = (el: HTMLElement | null): Box | null => {
        if (!el) return null;
        const r = el.getBoundingClientRect();
        return r.width > 0 && r.height > 0 ? { x: r.left, y: r.top, w: r.width, h: r.height } : null;
      };

      const inspector = box(q('.inspector'));
      const dodge = inspector ? inspector.w + 2 * gap : 2 * gap;
      /*
       * The inspector's width as the stylesheet sets it (chrome.css: the smaller of 520 × --p and 44vw
       * rounded down to --p), worked out rather than measured: once the plan narrows it, the measured
       * width is the plan's, and planning from that would let the two chase each other. Not on the
       * compact layout, where the inspector is a bottom sheet and takes no width from the HUD.
       */
      const compact = document.documentElement.classList.contains('compact');
      const inspectorNaturalW = inspector && !compact
        ? Math.min(520 * unit, Math.floor((0.44 * window.innerWidth) / unit) * unit)
        : 0;

      const usageEl = q('.usage-meter');
      const usage = box(usageEl);
      const head = box(q('.usage-meter .usage-head-row'));
      if (usage && head) natural.usageHeadH = Math.round(head.y + head.h - usage.y + 1.5 * gap);
      const usageMinimized = Boolean(usageEl?.classList.contains('minimized'));
      if (usage && !usageMinimized) natural.usageFullH = usage.h;
      const usageExpanded = Boolean(q('.usage-meter .usage-drawer'));

      const leftStack = box(q('.left-stack'));
      const dockCompact = Boolean(q('.left-stack .dock.compact'));
      if (leftStack && !dockCompact) natural.leftStackFullH = leftStack.h;

      const mmEl = q('.minimap');
      const mm = box(mmEl);
      if (mm && mmEl?.classList.contains('collapsed')) natural.minimapButton = { w: mm.w, h: mm.h };
      else if (mm) natural.minimap = { w: mm.w, h: mm.h };
      // Never seen open yet (it started collapsed): assume a middling panel rather than none.
      const minimapSize = natural.minimap.w ? natural.minimap : { w: 200 * unit, h: 150 * unit };
      const minimapButton = natural.minimapButton.w ? natural.minimapButton : { w: 26 * unit, h: 26 * unit };

      const hudMeasure = q('.hud-measure[data-level="full"]') ?? q('.hud-measure');
      const hudCompactMeasure = q('.hud-measure[data-level="compact"]');
      const hudIconsMeasure = q('.hud-measure[data-level="icons"]');
      // The help line's full length: its text's scroll width plus the line's own padding and close
      // button. Remembered, because once the plan hides it there is nothing left to measure.
      const help = q('.help');
      const helpText = q('.help .help-text');
      if (help && helpText) natural.helpW = helpText.scrollWidth + (help.offsetWidth - helpText.clientWidth);
      const look = box(q('.look-panel'));

      const plan = planChrome({
        view: { w: window.innerWidth, h: window.innerHeight },
        gap,
        dodge,
        breadcrumb: box(q('.breadcrumb')),
        usage,
        usageFullH: natural.usageFullH || (usage?.h ?? 0),
        usageHeadH: natural.usageHeadH || 28 * unit,
        usageExpanded,
        leftStack,
        leftStackFullH: natural.leftStackFullH || (leftStack?.h ?? 0),
        minimapOpen: store.minimapOpen,
        minimapForced: store.minimapForced,
        minimapSize,
        minimapButton,
        hudNaturalW: hudMeasure ? hudMeasure.scrollWidth : 0,
        ...(hudCompactMeasure ? { hudCompactW: hudCompactMeasure.scrollWidth } : {}),
        ...(hudIconsMeasure ? { hudIconsW: hudIconsMeasure.scrollWidth } : {}),
        ...(compact ? {} : { inspectorNaturalW }),
        helpNaturalW: natural.helpW,
        lookOpen: store.lookOpen,
        lookW: look?.w ?? 330 * unit,
        lookTop: 16 * gap,
        prefs: store.chromePrefs,
        compact
      });

      if (applied && samePlan(applied, plan)) return;
      applied = plan;
      const style = app.style;
      style.setProperty('--hud-max', `${plan.hudMaxW}px`);
      style.setProperty('--help-max', `${plan.helpMaxW}px`);
      style.setProperty('--toasts-bottom', `${plan.toastsBottom}px`);
      style.setProperty('--toasts-right', `${plan.toastsRight}px`);
      style.setProperty('--toasts-max', `${plan.toastsMaxW}px`);
      style.setProperty('--look-max-h', `${plan.lookMaxH}px`);
      style.setProperty('--usage-top', `${plan.usageTop}px`);
      style.setProperty('--look-top', `${plan.lookTop}px`);
      // Narrowed only when the HUD's buttons would otherwise be pushed off; otherwise the stylesheet's.
      if (plan.inspectorW > 0) style.setProperty('--inspector-width', `${plan.inspectorW}px`);
      else style.removeProperty('--inspector-width');
      store.setLayout(plan);
    };

    const soon = (): void => { if (!raf) raf = requestAnimationFrame(measure); };

    const app = appRef.current;
    watch(app);
    watch(document.documentElement);
    // Panels mount, unmount, collapse and expand by class; each is a reason to re-plan. `style`
    // is deliberately not watched: the plan itself writes style on the app root.
    const mutations = typeof MutationObserver === 'function'
      ? new MutationObserver(() => soon())
      : null;
    if (app && mutations) mutations.observe(app, { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] });
    // The store's own layout inputs (minimap open, LOOK open, prefs, ui scale) change without a
    // DOM mutation preceding them in every case, so a store change schedules a measure as well;
    // `samePlan` makes an unchanged plan free.
    const unsubscribe = useBoardStore.subscribe(() => soon());
    window.addEventListener('resize', soon);
    soon();
    return () => {
      unsubscribe();
      mutations?.disconnect();
      resizeObserver?.disconnect();
      observed.clear();
      window.removeEventListener('resize', soon);
      if (raf) cancelAnimationFrame(raf);
    };
  }, [appRef]);
}
