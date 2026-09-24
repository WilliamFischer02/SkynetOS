/**
 * The vision service: the cameras, and manual control's state.
 *
 * Recognition itself is packages/shared/gesture.ts, which is pure. This file is the contract
 * between the three processes that have to agree about the cameras:
 *
 *   - the VISION PAGE (src/renderer/vision.tsx) opens the cameras, runs the landmarkers and the
 *     tracker, and reports. It is served from `skynet://vision` with its own CSP and its own
 *     session, because it is the only page in the app allowed near a camera, and the only one
 *     permitted to compile WebAssembly. See docs/DECISIONS.md, 2026-09-11.
 *   - MAIN owns the window, the protocol handler and the permission grant, and forwards events.
 *   - the BOARD renderer receives gestures and acts on them, exactly as it acts on a keypress.
 *
 * Camera capture is never started by a setting alone. `enabled` persists William's choice; the
 * cameras open when manual control is switched on and close when it is switched off.
 */

import type { Pose } from './gesture.js';

export interface VisionSettings {
  /** OFF by default. Only William's own switch turns it on; never an agent, never a phone. */
  enabled: boolean;
  /**
   * The hand landmarker model, absolute. OUTSIDE this repo: it is 7.8 MB and the repo is public.
   * Empty means "not installed", which the status reports rather than crashing on.
   */
  model: string;
  /**
   * MediaPipe's GestureRecognizer bundle, absolute: the hand landmarker plus a gesture classifier
   * Google trained on a large labelled corpus (Open_Palm, Closed_Fist, Victory among its classes).
   * Optional. Where it is missing or will not load, the vision page falls back to `model` and decides
   * on geometry alone.
   */
  gestureModel: string;
  /** Camera labels to use, matched case-insensitively as substrings. Empty means the first two. */
  cameras: string[];
  /** How many hands to track. Two are needed for the zoom gesture. */
  hands: number;
  delegate: 'GPU' | 'CPU';
  /**
   * Show the small camera monitor in the corner. ON by default, and not for decoration: measured
   * 2026-09-11, a HIDDEN vision window runs at 11 and 9 fps where a visible one runs at 20 and 15.
   * Chromium throttles a hidden window's video pipeline and `backgroundThrottling: false` does not
   * cover it. Turn it off and manual control still works, at roughly half the frame rate.
   *
   * It is click-through and never takes focus. `streamMode` hides it regardless of this setting:
   * docs/07 says a stream must not carry what the cameras see.
   */
  preview: boolean;
}

export const DEFAULT_VISION: VisionSettings = {
  enabled: false,
  model: '',
  gestureModel: '',
  cameras: ['c920', 'c922'],
  hands: 2,
  delegate: 'GPU',
  preview: true
};

/**
 * - `off`          manual control is not on.
 * - `starting`     the window is up, the model is loading, the cameras are opening.
 * - `unavailable`  on, but it cannot run: no model, no camera, no permission.
 * - `watching`     cameras live, no hand in view.
 * - `tracking`     a hand is in view and driving the board.
 */
export type VisionPhase = 'off' | 'starting' | 'unavailable' | 'watching' | 'tracking';

export interface VisionCamera {
  label: string;
  /** Landmark frames per second, as measured by the page over the last second. */
  fps: number;
  /** A hand is in this camera's view right now. */
  seeing: boolean;
  error?: string;
}

/** What the board needs to draw the manual-control indicator, in one object. */
export interface GestureStatus {
  phase: VisionPhase;
  enabled: boolean;
  cameras: VisionCamera[];
  /** The pose of the hand now driving, for the on-screen chip. */
  pose?: Pose;
  /** Why it is `unavailable`, in words fit to put on screen. */
  error?: string;
}

export const VISION_OFF: GestureStatus = { phase: 'off', enabled: false, cameras: [] };

/** The vision page reporting its own state up to main. */
export interface VisionReport {
  phase: VisionPhase;
  cameras: VisionCamera[];
  pose?: Pose;
  error?: string;
}

/**
 * Is this install usable? Pure, so the UI can say exactly what is missing without probing disk.
 * The caller supplies the results of its own existence checks.
 */
export function visionReadiness(
  settings: VisionSettings,
  present: { model: boolean; bundle: boolean }
): { ok: true } | { ok: false; error: string } {
  if (!settings.model) return { ok: false, error: 'NO HAND MODEL — set gesture.model in settings.json' };
  if (!present.model) return { ok: false, error: `HAND MODEL NOT FOUND AT ${settings.model}` };
  if (!present.bundle) return { ok: false, error: 'MEDIAPIPE IS NOT INSTALLED — npm i' };
  if (settings.hands < 1 || settings.hands > 2) return { ok: false, error: `${settings.hands} HANDS IS NOT A CHOICE — 1 or 2` };
  return { ok: true };
}
