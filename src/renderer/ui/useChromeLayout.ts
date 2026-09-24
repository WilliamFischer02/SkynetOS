import { useEffect } from 'react';
import { useBoardStore } from '../store/useBoardStore.js';
import { planChrome, samePlan, type Box, type ChromePlan } from './chrome-layout.js';

/**
 * The layout manager's hook: measure the chrome, plan it (chrome-layout.ts), apply the plan.
 *
 * Measured on a slow interval and on window resize, not every frame. Nine getBoundingClientRect
 * calls every 400 ms cost nothing, and the chrome only changes shape when a panel opens, a session
 * starts, or the window is resized. The plan goes two ways: booleans into the store, for the
 * components that collapse (usage meter, minimap, HUD, dock, help), and pixel values as CSS
 * variables on the app root, for the ones that only move (toasts, the LOOK panel's height).
 *
 * Each panel's natural size is remembered from the last time it was shown in full (see
 * chrome-layout.ts on why), so a collapsed panel is planned by the size it would come back at.
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
    let raf = 0;

    const measure = (): void => {
      raf = 0;
      const app = appRef.current;
      if (!app) return;
      const store = useBoardStore.getState();
      const unit = store.uiScale || 1;
      const gap = 4 * unit;
      const q = (selector: string): HTMLElement | null => app.querySelector(selector);
      const box = (el: HTMLElement | null): Box | null => {
        if (!el) return null;
        const r = el.getBoundingClientRect();
        return r.width > 0 && r.height > 0 ? { x: r.left, y: r.top, w: r.width, h: r.height } : null;
      };

      const inspector = box(q('.inspector'));
      const dodge = inspector ? inspector.w + 2 * gap : 2 * gap;

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

      const hudMeasure = q('.hud-measure');
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
        helpNaturalW: natural.helpW,
        lookOpen: store.lookOpen,
        lookW: look?.w ?? 330 * unit,
        lookTop: 16 * gap,
        prefs: store.chromePrefs,
        compact: document.documentElement.classList.contains('compact')
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
      store.setLayout(plan);
    };

    const soon = (): void => { if (!raf) raf = requestAnimationFrame(measure); };
    const timer = setInterval(soon, 400);
    window.addEventListener('resize', soon);
    soon();
    return () => {
      clearInterval(timer);
      window.removeEventListener('resize', soon);
      if (raf) cancelAnimationFrame(raf);
    };
  }, [appRef]);
}
