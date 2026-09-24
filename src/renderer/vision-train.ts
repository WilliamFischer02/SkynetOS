/**
 * The calibration and training wizard: the guided flow William asked for.
 *
 * "A full calibration / gesture control interface that prompts me to adjust my webcam angles so
 * they're relatively levelled to each other and my regular hand gestures aren't likely to leave the
 * camera bounds — then it would do a regular dataset capture / calibration on all gestures in the
 * database … aided by aesthetic onscreen graphical prompts that walk the user through every phase."
 *
 * Four phases, in the only order that works: aim the cameras, learn the reach, teach the gestures,
 * then audit what was taught — because a gesture trained through a badly-aimed camera teaches the
 * wrong thing, and a gesture taught badly can break the ones that were fine.
 *
 * ── The consent rule, and how it is kept ─────────────────────────────────────────────────────
 *
 * "Make sure no images or data is recorded until the user clicks on onscreen prompt."
 *
 *   - Nothing is captured before START. The LEVEL and REACH phases read the live hand to give
 *     advice and keep NOTHING; the numbers they compute never leave the page until the click that
 *     ends the phase.
 *   - A training example is 42 normalised numbers per keyframe per hand
 *     (packages/shared/gesture-library.ts). No frame, still or video is ever written, by this page
 *     or by main.
 *   - The keyframe thumbnails are the one picture in the system, and they are not recorded either:
 *     a data URL in a page that is about to be closed, drawn only from a keyframe a capture the
 *     user started has just banked. See `snapshotHand` in vision.ts for the full argument.
 *   - Each gesture's capture set begins with its own button. One click authorises that gesture, in
 *     that variant, and no other; STOP ends it mid-set, and every take ends at a confirmation
 *     rather than rolling on into the next one.
 *
 * ── The shutter is a clock, not a trigger ────────────────────────────────────────────────────
 *
 * William, 2026-09-12: "instead of waiting to capture a hand pose until it's perfectly framed up
 * or detected, do a countdown of 8 seconds for each pose, and no matter what try to capture any
 * hand detected … as a data point on a simple timer, not a detection trigger."
 *
 * He is right, and the previous design had it backwards. A shutter that waits for the tracker to
 * be happy makes the tracker the judge of what a good example looks like — which is circular, and
 * worse, it means the poses the tracker finds HARDEST are precisely the ones that never get
 * recorded. Those are the examples the catalogue most needs. So the clock runs, and whatever is in
 * shot when it reaches zero is what gets banked. Only genuine nothing — no hand at all on any
 * camera — buys the two-second grace, and it says so in red.
 *
 * ── What this page may NOT do ────────────────────────────────────────────────────────────────
 *
 * It can name a gesture and add examples to it. It cannot give a gesture its WORDS — the utterance
 * that the intent grammar turns into a command — because that is the field that decides what a
 * gesture DOES, and the page that can see the room has no business writing it. That happens in the
 * catalogue on the board. See VISION_METHODS in packages/shared/ipc.ts.
 */

import { MCP, WRIST, handSpan, type Hand } from '@shared/gesture.js';
import {
  featuresOf,
  gestureReadiness,
  handsOf,
  MIN_SAMPLES,
  MODE_NAMES,
  modeOf,
  VARIANTS,
  type FrameCount,
  type GestureDefinition,
  type HandMode,
  type LibraryHealth,
  type SampleVariant
} from '@shared/gesture-library.js';
import type { Analysis } from '@shared/gesture-analysis.js';
import {
  DEFAULT_MIRRORED,
  mirroredFromMotion,
  rightHandHasSmallerX,
  sideFromLabel,
  type RawSide,
  type Side
} from '@shared/hand-roles.js';
import { handGeometry } from '@shared/hand-geometry.js';
import { poseFeatures } from '@shared/pose-model.js';
import {
  LEVEL_TOLERANCE,
  boundsOf,
  levelAdvice,
  reachVerdict,
  type CalibrationProfile,
  type HandObservation
} from '@shared/calibration.js';

type Phase = 'intro' | 'level' | 'reach' | 'train' | 'done';

export interface WizardCamera {
  label: string;
  /** The preview element for this camera, already in the page. */
  view: HTMLDivElement;
}

export interface Wizard {
  /** One camera's hands for one frame, with which hand each one is. Keeps nothing. */
  frame(label: string, hands: Hand[], sides: RawSide[], atMs: number, world?: (Hand | null)[]): void;
  destroy(): void;
}

// ── the clock, all in one place because it is the feel of the thing ───────────────────────────

/** Seconds on the countdown for every keyframe. William asked for eight, and eight is right. */
const COUNT_MS = 8000;
/** The "are you sure" extension, granted once per keyframe when nothing at all was in shot. */
const GRACE_MS = 2000;
/** A frame older than this is not evidence of anything. */
const STALE_MS = 500;

/** Palm centre: the wrist and the four knuckles, which is steadier than any single landmark. */
function palmOf(hand: Hand): { x: number; y: number } | null {
  const ids = [WRIST, MCP.index, MCP.middle, MCP.ring, MCP.pinky];
  let x = 0;
  let y = 0;
  for (const id of ids) {
    const point = hand[id];
    if (!point) return null;
    x += point.x;
    y += point.y;
  }
  return { x: x / ids.length, y: y / ids.length };
}

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
};

/** What one camera saw on its last frame. Overwritten constantly; never stored. */
interface Seen {
  hands: Hand[];
  /** As the landmarker spelled it. Turned into a person's hand only via `sideOf`. */
  sides: RawSide[];
  atMs: number;
  /** World landmarks per hand, where the engine gives them: what pose features are measured from. */
  world: (Hand | null)[];
}

/** One camera's contribution to the take being recorded. */
interface Track {
  main: number[][];
  off: number[][];
  thumbs: (string | null)[];
  /** Palm centre at each keyframe. For a travel gesture this IS the gesture. */
  path: { x: number; y: number }[];
  /** Pose features at each keyframe (pose-model.ts), so the recording sharpens the geometric model. */
  pose: (number[] | null)[];
}

type Stage = 'count' | 'grace' | 'confirm';

interface Run {
  gesture: GestureDefinition;
  variant: SampleVariant;
  keyframe: number;
  /** One per camera that has contributed to this take. */
  tracks: Map<string, Track>;
  stage: Stage;
  /** performance.now() at which the countdown reaches zero. */
  until: number;
  /** The grace is granted once per keyframe, not once per take. */
  graced: boolean;
  /** Ids of the examples stored by the take just finished, so RETAKE can drop exactly those. */
  stored: { gestureId: string; sampleId: string }[];
  /** Takes banked in this run, for the summary. */
  takes: number;
}

export function createWizard(options: {
  cameras: WizardCamera[];
  host: HTMLElement;
  /** Where the previews live, so the wizard can put them inside its own layout. */
  views: HTMLElement;
  /** Is this camera's picture good enough to LEARN from right now? */
  trainable: (label: string) => boolean;
  /** A cropped picture of the hand as it was at the shutter. Transient; never written anywhere. */
  snapshot: (label: string, hand: Hand) => string | null;
  onFinished: () => void;
}): Wizard {
  const { cameras, host, views, trainable, snapshot, onFinished } = options;

  let phase: Phase = 'intro';
  /** The latest observation per camera, for the aiming phases. Live only. */
  const latest = new Map<string, { observation: HandObservation; atMs: number }>();
  /** The latest raw frame per camera, for the shutter. Overwritten every frame; never kept. */
  const seen = new Map<string, Seen>();
  /** The reach sweep, in memory until the phase is confirmed. */
  const reachPoints = new Map<string, { x: number; y: number }[]>();
  let steadyFrames = 0;
  let reachStartedAt = 0;
  /**
   * Two facts about left and right, kept apart — see the correction note in hand-roles.ts.
   *
   * `labelsSwapped` corrects the landmarker's handedness label; the SWAP buttons set it. `mirroredBy` is
   * each camera's geometry, MEASURED by the CHECK DIRECTION movement in the AIM phase; the position
   * fallback uses it here, and once saved it decides which way the cursor moves on the board. Both are
   * loaded from the saved calibration on the way in.
   */
  let labelsSwapped = false;
  const mirroredBy = new Map<string, boolean>();
  /** The direction check in progress: each camera's palm x when it began, and most recently. */
  let motion: { from: Map<string, number>; to: Map<string, number> } | null = null;

  let library: GestureDefinition[] = [];
  let trainIndex = 0;
  const refreshed: string[] = [];

  let run: Run | null = null;
  let clock: number | null = null;
  /** A destructive button becomes armed on the first click and acts on the second. */
  let armed: string | null = null;

  const driver = cameras[0]?.label ?? '';
  /** Every camera that is actually running. Training reads all of them, not just the driver. */
  const labels = cameras.map((camera) => camera.label);

  // ── the shell ───────────────────────────────────────────────────────────────────────────────
  host.innerHTML = '';
  const shell = el('div', 'wz');
  const steps = el('div', 'wz-steps');
  const title = el('h1', 'wz-title');
  const lead = el('p', 'wz-lead');
  const stage = el('div', 'wz-stage');
  const count = el('div', 'wz-count');
  const strip = el('div', 'wz-strip');
  const advice = el('div', 'wz-advice');
  const dots = el('div', 'wz-dots');
  const frameRow = el('div', 'wz-frames');
  const actions = el('div', 'wz-actions');
  /*
   * Everything except the buttons goes in a scrolling body, and the buttons are pinned outside it.
   *
   * Not a nicety. The window is a fixed 820x620 with `overflow: hidden`, so on 2026-09-11 adding
   * the countdown, the thumbnail strip and the keyframe editor pushed START and NOT NOW off the
   * bottom of the intro screen, and William was stuck on it with nothing to press. A layout where
   * the controls are the first thing to be clipped is a layout that can trap the user, so the
   * controls are now the one thing that cannot be. `npm run gate:wizard` checks it.
   */
  const body = el('div', 'wz-body');
  body.append(steps, title, lead, stage, count, strip, advice, dots, frameRow);
  shell.append(body, actions);
  host.append(shell);
  stage.append(views);

  const STEP_NAMES: { key: Phase; label: string }[] = [
    { key: 'level', label: '1 · AIM' },
    { key: 'reach', label: '2 · REACH' },
    { key: 'train', label: '3 · TRAIN' },
    { key: 'done', label: '4 · CHECK' }
  ];

  const drawSteps = (): void => {
    steps.innerHTML = '';
    for (const step of STEP_NAMES) {
      const done = STEP_NAMES.findIndex((s) => s.key === step.key) < STEP_NAMES.findIndex((s) => s.key === phase);
      steps.append(el('span', `wz-step${step.key === phase ? ' now' : done ? ' done' : ''}`, step.label));
    }
  };

  const button = (label: string, onClick: () => void, kind = ''): HTMLButtonElement => {
    const node = el('button', `wz-btn ${kind}`.trim(), label);
    node.type = 'button';
    node.addEventListener('click', onClick);
    return node;
  };

  const setDots = (filled: number, total: number): void => {
    dots.innerHTML = '';
    if (!total) return;
    for (let i = 0; i < total; i++) dots.append(el('span', `wz-dot${i < filled ? ' on' : ''}`));
  };

  const say = (text: string, tone: '' | 'ok' | 'bad' = ''): void => {
    advice.textContent = text;
    advice.className = `wz-advice${tone ? ` ${tone}` : ''}`;
  };

  /** Clear everything the training panels use, so no phase inherits another's furniture. */
  const clearPanels = (): void => {
    count.textContent = '';
    count.className = 'wz-count';
    strip.innerHTML = '';
    frameRow.innerHTML = '';
    armed = null;
  };

  /** Which of the person's hands this is, given how this rig presents its picture. */
  const sideOf = (raw: RawSide): Side => sideFromLabel(raw, labelsSwapped);

  // ── phases ──────────────────────────────────────────────────────────────────────────────────

  /**
   * Read back what this desk already knows before asking anything.
   *
   * The first version wrote `swapHands` into the profile and never read it, so a correction made
   * on Monday was gone by Tuesday and the wizard asked the same wrong question every time.
   */
  async function loadCalibration(): Promise<void> {
    try {
      const profile = await window.skynet['gesture:calibration']();
      if (profile) {
        labelsSwapped = profile.labelsSwapped === true;
        for (const camera of profile.cameras) {
          if (typeof camera.mirrored === 'boolean') mirroredBy.set(camera.label, camera.mirrored);
        }
      }
    } catch {
      /* No profile yet is the normal case on a fresh machine; the default stands. */
    }
  }

  function showIntro(): void {
    phase = 'intro';
    drawSteps();
    clearPanels();
    stopRun();
    title.textContent = 'CALIBRATE AND TRAIN';
    lead.textContent =
      'Four steps: aim the cameras, learn how far you reach, refresh the examples for every gesture, then check that nothing you taught contradicts anything else. Nothing is recorded until you press a button, and no picture is ever saved.';
    say('');
    setDots(0, 0);
    actions.innerHTML = '';
    actions.append(button('START', () => showLevel(), 'go'), button('NOT NOW', () => onFinished()));
  }

  function showLevel(): void {
    phase = 'level';
    steadyFrames = 0;
    drawSteps();
    clearPanels();
    title.textContent = 'AIM THE CAMERAS';
    lead.textContent =
      cameras.length > 1
        ? 'Hold up your RIGHT hand, flat, centred, where you would normally work. Adjust whichever camera is named until both agree.'
        : 'Only one camera is running, so there is nothing to level against. Hold up your RIGHT hand to check it can see you, then continue.';
    say('Waiting for a hand…');
    setDots(0, 0);
    drawLevelActions();
  }

  /**
   * The one question that settles left from right, asked where a hand is already being held up.
   *
   * It is phrased as a correction with a live readout rather than as a question about mirroring,
   * because "is your camera mirrored?" is a question about a driver and this is a question about a
   * hand. He holds up his right hand, the advice line says which hand it thinks that is, and if it
   * is wrong he presses the button and watches the readout change to agree with him. There is no
   * way to answer it incorrectly and no need to understand why it was ever wrong.
   */
  function drawLevelActions(): void {
    actions.innerHTML = '';
    actions.append(
      button('NEXT', () => showReach(), 'go'),
      button(mirroredBy.size ? 'CHECK DIRECTION AGAIN' : 'CHECK DIRECTION', () => startDirectionCheck(), 'alt'),
      button('NO — SWAP LEFT AND RIGHT', () => {
        labelsSwapped = !labelsSwapped;
        drawLevelActions();
        onLevelFrame();
      }, 'alt'),
      button('CANCEL', () => onFinished())
    );
  }

  /**
   * Which way does each camera see a hand move?
   *
   * Asked, not assumed. William, 2026-09-12: "cursor movement in the program should mirror the hand's
   * movement" — and whether a movement to his right goes right or left in the picture depends on the
   * camera's driver, which cannot be known in advance. So he moves his hand to his right for two and a
   * half seconds, and the sign of the palm's travel in each camera's picture is the answer for that
   * camera. Started by its own button; the only thing kept is one boolean per camera, and only once he
   * saves the calibration.
   */
  function startDirectionCheck(): void {
    motion = { from: new Map(), to: new Map() };
    say('Move your open hand slowly to YOUR right — about a shoulder’s width — and keep it moving…');
    window.setTimeout(finishDirectionCheck, 2500);
  }

  function finishDirectionCheck(): void {
    if (!motion) return;
    const notes: string[] = [];
    let measured = 0;
    for (const camera of cameras) {
      const from = motion.from.get(camera.label);
      const to = motion.to.get(camera.label);
      const name = camera.label.replace(/\s*\(.*\)\s*$/, '').slice(0, 18);
      if (from === undefined || to === undefined) {
        notes.push(`${name} did not see the hand`);
        continue;
      }
      const answer = mirroredFromMotion(to - from);
      if (answer === null) {
        notes.push(`${name}: not enough movement`);
        continue;
      }
      mirroredBy.set(camera.label, answer);
      measured++;
      notes.push(`${name}: ${answer ? 'a mirror image' : 'a straight view'}`);
    }
    motion = null;
    say(`${notes.join(' · ')}.${measured ? ' Saved with the calibration.' : ' Try again with a bigger movement.'}`, measured ? 'ok' : 'bad');
    drawLevelActions();
  }

  function showReach(): void {
    phase = 'reach';
    reachPoints.clear();
    reachStartedAt = 0;
    drawSteps();
    clearPanels();
    title.textContent = 'YOUR REACH';
    lead.textContent =
      'With an open hand, sweep the corners of the area you want to use — as far left, right, up and down as is comfortable. The box you draw becomes the whole screen.';
    say('Move your hand to begin.');
    setDots(0, 0);
    actions.innerHTML = '';
    actions.append(button('SAVE AND CONTINUE', () => void saveReach(), 'go'), button('SKIP', () => void startTraining()));
  }

  async function saveReach(): Promise<void> {
    const profile: CalibrationProfile = {
      version: 1,
      capturedAt: new Date().toISOString(),
      driver,
      cameras: cameras.map((camera) => ({
        label: camera.label,
        region: reachVerdict(boundsOf(reachPoints.get(camera.label) ?? [])).region,
        ...(mirroredBy.has(camera.label) ? { mirrored: mirroredBy.get(camera.label)! } : {})
      })),
      refreshed: [],
      ...(labelsSwapped ? { labelsSwapped: true } : {})
    };
    const saved = await window.skynet['gesture:saveCalibration'](profile);
    say(saved.ok ? 'Calibration saved.' : saved.error ?? 'Could not save the calibration.', saved.ok ? 'ok' : 'bad');
    await startTraining();
  }

  async function startTraining(): Promise<void> {
    phase = 'train';
    drawSteps();
    const current = await window.skynet['gesture:library']();
    library = current.gestures;
    trainIndex = 0;
    showGesture();
  }

  // ── the gesture card ────────────────────────────────────────────────────────────────────────

  const promptFor = (gesture: GestureDefinition, index: number): string => {
    const written = gesture.prompts?.[index];
    if (written) return written;
    if (gesture.travel) {
      // A travel gesture is asking WHERE, not what shape — so an unwritten prompt says where.
      if (index === 0) return 'Hold the pose where the movement should START.';
      if (index === gesture.frames - 1) return 'Now where it should FINISH.';
      return `Pass through point ${index + 1}.`;
    }
    return gesture.frames === 1 ? 'Hold the pose.' : `Keyframe ${index + 1} of ${gesture.frames}.`;
  };

  /** The keyframe editor, and the one/two hand toggle beside it. Both discard examples. */
  function drawShapeEditor(gesture: GestureDefinition): void {
    frameRow.innerHTML = '';
    frameRow.append(el('span', 'wz-frames-label', 'KEYFRAMES'));
    for (let i = 0; i < gesture.frames; i++) {
      const chip = el('span', 'wz-frame', String(i + 1));
      chip.title = promptFor(gesture, i);
      frameRow.append(chip);
    }

    const reshape = async (frames: FrameCount, node: HTMLButtonElement): Promise<void> => {
      const key = `frames:${gesture.id}:${frames}`;
      if (gesture.samples.length && armed !== key) {
        armed = key;
        node.classList.add('stop');
        say(
          `${frames} keyframes means starting again — it would discard ${gesture.samples.length} example${gesture.samples.length === 1 ? '' : 's'}. Press again to confirm.`,
          'bad'
        );
        return;
      }
      armed = null;
      const result = await window.skynet['gesture:setFrames']({ gestureId: gesture.id, frames });
      if (!result.ok) {
        say(result.error ?? 'Could not change the keyframes.', 'bad');
        return;
      }
      library = result.library.gestures;
      showGesture();
    };

    if (gesture.frames > 1) {
      const less = button('−', () => void reshape((gesture.frames - 1) as FrameCount, less), 'tiny');
      frameRow.append(less);
    }
    if (gesture.frames < 3) {
      const more = button('+', () => void reshape((gesture.frames + 1) as FrameCount, more), 'tiny');
      frameRow.append(more);
    }

    /*
     * How the hands are used, declared rather than inferred — and three options, not two.
     *
     * William, 2026-09-12: "the ability for the program to distinguish between a gesture being done
     * on one hand, a two hand gesture, or one gesture being done on both hands." Inferring any of
     * this from what is in shot would make a gesture two-handed whenever a second hand happened to
     * be on the desk, which is exactly the confusion the hand roles were built to end.
     */
    const mode = modeOf(gesture);
    frameRow.append(el('span', 'wz-frames-label', 'HANDS'));
    for (const value of ['one', 'two', 'both'] as HandMode[]) {
      const chip = button(MODE_NAMES[value].short, () => void reMode(gesture, value, chip), value === mode ? 'tiny on' : 'tiny');
      chip.title = MODE_NAMES[value].blurb;
      frameRow.append(chip);
    }

    /*
     * Travel: is this gesture two POINTS or two SHAPES?
     *
     * William, 2026-09-12: "some gestures like a click and drag / scroll is simply a gesture from
     * two different points on screen … prompt the user which points in-frame to use as their start
     * and finish points." Turning it on changes what the prompts ask for and makes the recorded
     * positions part of what the gesture means. It keeps the examples, because every sample has
     * been recording where the hand was all along.
     */
    const travelChip = button(
      gesture.travel ? 'TRAVEL: ON' : 'TRAVEL: OFF',
      () => void reTravel(gesture),
      gesture.travel ? 'tiny on' : 'tiny'
    );
    travelChip.title = 'The gesture goes from one place in frame to another — a drag, a scroll.';
    frameRow.append(travelChip);

    /*
     * The left/right correction, reachable here as well as in AIM. William hit the inversion while
     * training, not while aiming, and a fix he has to leave the screen to reach is a fix he will not
     * make.
     */
    const swap = button('SWAP L/R', () => void flipMirror(), 'tiny');
    swap.title = 'Swap which hand is called left and which right.';
    frameRow.append(swap);
    frameRow.append(el('span', 'wz-frames-note', gesture.travel ? 'Start point, then finish point.' : MODE_NAMES[mode].blurb));
  }

  async function reMode(gesture: GestureDefinition, mode: HandMode, node: HTMLButtonElement): Promise<void> {
    if (mode === modeOf(gesture)) return;
    const key = `mode:${gesture.id}:${mode}`;
    if (gesture.samples.length && armed !== key) {
      armed = key;
      node.classList.add('stop');
      say(
        `Changing ${gesture.name} to ${MODE_NAMES[mode].short} discards its ${gesture.samples.length} example${gesture.samples.length === 1 ? '' : 's'}. Press again to confirm.`,
        'bad'
      );
      return;
    }
    armed = null;
    const result = await window.skynet['gesture:setMode']({ gestureId: gesture.id, mode });
    if (!result.ok) {
      say(result.error ?? 'Could not change the hands.', 'bad');
      return;
    }
    library = result.library.gestures;
    showGesture();
  }

  /**
   * Flip which way round the picture is, and remember it.
   *
   * Written straight into the saved calibration rather than held in the page, because the reason
   * he is pressing it is that it was wrong last time too.
   */
  async function flipMirror(): Promise<void> {
    labelsSwapped = !labelsSwapped;
    try {
      const profile = await window.skynet['gesture:calibration']();
      if (profile) await window.skynet['gesture:saveCalibration']({ ...profile, labelsSwapped });
    } catch {
      /* No profile to update yet: the REACH phase will save this along with everything else. */
    }
    showGesture();
    say(`Left and right ${labelsSwapped ? 'swapped' : 'as the landmarker reports them'}. Hold up your right hand to check.`, 'ok');
  }

  /** Travel keeps the examples, so there is nothing to confirm. */
  async function reTravel(gesture: GestureDefinition): Promise<void> {
    const result = await window.skynet['gesture:setTravel']({ gestureId: gesture.id, travel: !gesture.travel });
    if (!result.ok) {
      say(result.error ?? 'Could not change that.', 'bad');
      return;
    }
    library = result.library.gestures;
    showGesture();
  }

  /** Which variants this gesture already has, and how many of each. */
  function drawVariantChips(gesture: GestureDefinition): void {
    const tally = new Map<SampleVariant, number>();
    for (const sample of gesture.samples) {
      const key = sample.variant ?? 'clean';
      tally.set(key, (tally.get(key) ?? 0) + 1);
    }
    for (const spec of VARIANTS) {
      if (spec.key === 'left-hand' && modeOf(gesture) !== 'one') continue;
      const n = tally.get(spec.key) ?? 0;
      strip.append(el('span', `wz-var${n ? ' has' : ''}`, `${spec.name} ${n || '—'}`));
    }
    /* Which cameras contributed, because "only one angle is being catalogued" was a real fault. */
    const byCamera = new Map<string, number>();
    for (const sample of gesture.samples) byCamera.set(sample.camera ?? '?', (byCamera.get(sample.camera ?? '?') ?? 0) + 1);
    for (const label of labels) {
      const n = byCamera.get(label) ?? 0;
      strip.append(el('span', `wz-var${n ? ' has' : ''}`, `${label.slice(0, 22)} ${n || '—'}`));
    }
  }

  function showGesture(): void {
    stopRun();
    clearPanels();
    if (trainIndex >= library.length) {
      void showDone();
      return;
    }
    const gesture = library[trainIndex]!;
    const readiness = gestureReadiness(gesture);
    const mode = modeOf(gesture);
    title.textContent = `${gesture.name}${mode === 'one' ? '' : ` · ${MODE_NAMES[mode].short}`}${gesture.travel ? ' · TRAVEL' : ''}`;
    const what = gesture.action
      ? `Built in: it drives ${gesture.action.replace(/-/g, ' ')}.`
      : gesture.utterance
        ? `It stands for “${gesture.utterance}”.`
        : 'It has no words yet — give it some in the catalogue on the board.';
    lead.textContent = `${gesture.frames === 1 ? 'One pose, held.' : `${gesture.frames} keyframes, performed in order.`} ${what} ${trainIndex + 1} of ${library.length}.`;
    say(
      readiness.ready
        ? `${gesture.samples.length} example${gesture.samples.length === 1 ? '' : 's'} stored. Variants make it work when you are not being careful.`
        : readiness.note
    );
    setDots(Math.min(gesture.samples.length, MIN_SAMPLES), MIN_SAMPLES);
    drawShapeEditor(gesture);
    drawVariantChips(gesture);

    actions.innerHTML = '';
    const clean = gesture.samples.filter((sample) => !sample.variant).length;
    actions.append(button(clean ? 'MORE CLEAN EXAMPLES' : 'CAPTURE EXAMPLES', () => startRun(gesture, 'clean'), 'go'));
    if (clean >= MIN_SAMPLES) {
      for (const spec of VARIANTS) {
        if (spec.key === 'clean') continue;
        if (spec.key === 'left-hand' && mode !== 'one') continue;
        actions.append(button(`+ ${spec.name}`, () => startRun(gesture, spec.key), 'alt'));
      }
    }
    if (gesture.samples.length) {
      const retryButton = button('RETRY CAPTURES', () => void retry(gesture, retryButton));
      actions.append(retryButton);
    }
    /*
     * BACK. William, 2026-09-12: "Add the ability to go back to the last gesture (I accidentally
     * clicked past one of the gesture trainings and had to cycle all the way back)."
     */
    if (trainIndex > 0) {
      actions.append(
        button('◀ BACK', () => {
          trainIndex--;
          showGesture();
        })
      );
    }
    actions.append(
      button(trainIndex === library.length - 1 ? 'FINISH' : 'NEXT ▶', () => {
        trainIndex++;
        showGesture();
      })
    );
  }

  /**
   * Throw this gesture's examples away and start it again.
   *
   * Two clicks, because it destroys recordings: the first arms it and says exactly how many it
   * would take, the second does it. docs/07 — no unattended destruction, and the click that
   * approves it names what it is approving.
   */
  async function retry(gesture: GestureDefinition, node: HTMLButtonElement): Promise<void> {
    const key = `retry:${gesture.id}`;
    const many = gesture.samples.length;
    if (armed !== key) {
      armed = key;
      node.textContent = `DISCARD ${many} — PRESS AGAIN`;
      node.classList.add('stop');
      say(`This discards all ${many} example${many === 1 ? '' : 's'} of ${gesture.name}, including its variants.`, 'bad');
      return;
    }
    armed = null;
    const result = await window.skynet['gesture:resetSamples'](gesture.id);
    if (!result.ok) {
      say(result.error ?? 'Could not clear the examples.', 'bad');
      return;
    }
    library = result.library.gestures;
    showGesture();
    say(`${gesture.name} cleared. Capture it again.`, 'ok');
  }

  // ── one capture run ─────────────────────────────────────────────────────────────────────────

  function stopRun(): void {
    run = null;
    if (clock !== null) {
      window.clearInterval(clock);
      clock = null;
    }
  }

  /**
   * The thumbnail wall: one row per camera, one cell per keyframe.
   *
   * William, 2026-09-12: "at least visually within the ui only one of the angles is being
   * catalogued; when it seems like both angles should be catalogued." Both are, now — every camera
   * banks its own example of the same pose, because the same hand from two angles is two genuinely
   * different pieces of evidence and throwing one away was waste.
   */
  function drawShots(): void {
    if (!run) return;
    strip.innerHTML = '';
    for (const label of labels) {
      const track = run.tracks.get(label);
      const row = el('div', 'wz-cam');
      const view = seen.get(label);
      const sides = (view?.sides ?? []).map((raw) => sideOf(raw)).filter((side) => side !== 'unknown');
      // Named on every row, every take: a wrong mapping should be obvious at the first keyframe
      // rather than three gestures later.
      row.append(el('span', 'wz-cam-name', `${label.slice(0, 16)}${sides.length ? ` · ${sides.join('+').toUpperCase()}` : ''}`));
      for (let i = 0; i < run.gesture.frames; i++) {
        const got = track ? i < track.main.length : false;
        const cell = el('div', `wz-shot${got ? ' got' : i === run.keyframe ? ' now' : ''}`);
        const thumb = track?.thumbs[i];
        if (thumb) {
          const img = el('img', 'wz-thumb');
          img.src = thumb;
          img.alt = `Keyframe ${i + 1}`;
          cell.append(img);
        } else {
          cell.append(el('span', 'wz-shot-empty', String(i + 1)));
        }
        row.append(cell);
      }
      strip.append(row);
    }
  }

  function startRun(gesture: GestureDefinition, variant: SampleVariant): void {
    stopRun();
    clearPanels();
    run = {
      gesture,
      variant,
      keyframe: 0,
      tracks: new Map(),
      stage: 'count',
      until: performance.now() + COUNT_MS,
      graced: false,
      stored: [],
      takes: 0
    };
    const spec = VARIANTS.find((entry) => entry.key === variant);
    title.textContent = variant === 'clean' ? gesture.name : `${gesture.name} · ${spec?.name ?? variant}`;
    const mode = modeOf(gesture);
    const which =
      mode === 'both'
        ? 'The same shape on BOTH hands.'
        : mode === 'two'
          ? 'Both hands, doing different things.'
          : variant === 'left-hand'
            ? 'Your LEFT hand.'
            : 'Your RIGHT hand.';
    const how = gesture.travel ? 'Two positions in frame: where it starts, where it finishes.' : '';
    lead.textContent = `${which} ${how} ${spec?.blurb ?? ''} The shutter fires on the count, whatever it can see.`.replace(/\s+/g, ' ');
    drawShots();
    actions.innerHTML = '';
    actions.append(button('STOP', () => { stopRun(); showGesture(); }, 'stop'));
    say(promptFor(gesture, 0));
    clock = window.setInterval(step, 100);
  }

  /**
   * Pick the hands this take wants out of what one camera can see.
   *
   * Deliberately forgiving. The clock is the trigger, so this is asked at a moment that has already
   * arrived: the question is not "is this a good enough hand" but "is there a hand here at all, and
   * is it plausibly the one asked for". A side of `unknown` is accepted rather than refused, since
   * a hand that cannot be told apart is usually one that is turned away — which is a pose worth
   * having, not a pose to discard.
   */
  function pickHands(gesture: GestureDefinition, variant: SampleVariant, view: Seen, label: string): { main: Hand; off?: Hand } | null {
    const wanted: Side = variant === 'left-hand' ? 'left' : 'right';
    const entries = view.hands.map((hand, i) => ({ hand, side: sideOf(view.sides[i] ?? 'unknown'), x: palmOf(hand)?.x ?? 0.5 }));
    if (!entries.length) return null;

    if (handsOf(gesture) === 2) {
      if (entries.length < 2) return null;
      /*
       * The main track is the RIGHT hand. Where handedness cannot be read, fall back to position —
       * and derive WHICH SIDE that is from the same mirroring fact as the labels, so the two can
       * never disagree. Hard-coding it here was the half of the 2026-09-12 handedness bug that a
       * label toggle would not have fixed.
       */
      const right = entries.find((entry) => entry.side === 'right');
      const left = entries.find((entry) => entry.side === 'left' && entry !== right);
      if (right && left) return { main: right.hand, off: left.hand };
      const ordered = [...entries].sort((a, b) => (rightHandHasSmallerX(mirroredBy.get(label) ?? DEFAULT_MIRRORED) ? a.x - b.x : b.x - a.x));
      return { main: ordered[0]!.hand, off: ordered[1]!.hand };
    }

    const exact = entries.find((entry) => entry.side === wanted);
    if (exact) return { main: exact.hand };
    const unsure = entries.find((entry) => entry.side === 'unknown');
    if (unsure) return { main: unsure.hand };
    // Only the wrong hand is in shot. Still recorded: the clock fired, and a take that silently
    // banks nothing teaches him nothing about why.
    return null;
  }

  function step(): void {
    if (!run || run.stage === 'confirm') return;
    const now = performance.now();
    const left = run.until - now;
    if (left > 0) {
      count.textContent = String(Math.ceil(left / 1000));
      count.className = run.stage === 'grace' ? 'wz-count grace' : 'wz-count';
      return;
    }
    shoot(now);
  }

  /** The shutter. Fires on the clock; banks whatever is there. */
  function shoot(now: number): void {
    if (!run) return;
    const gesture = run.gesture;
    let took = 0;
    let sawSomething = false;

    for (const label of labels) {
      const view = seen.get(label);
      if (!view || now - view.atMs > STALE_MS || !view.hands.length) continue;
      sawSomething = true;
      const picked = pickHands(gesture, run.variant, view, label);
      if (!picked) continue;
      const main = featuresOf(picked.main);
      const off = picked.off ? featuresOf(picked.off) : null;
      // A hand turned so far edge-on that its own measurements collapse is not a hand this can
      // learn from, however willing the shutter is.
      if (!main || (handsOf(gesture) === 2 && !off)) continue;
      const track = run.tracks.get(label) ?? { main: [], off: [], thumbs: [], path: [], pose: [] };
      track.main[run.keyframe] = main;
      if (off) track.off[run.keyframe] = off;
      track.thumbs[run.keyframe] = snapshot(label, picked.main);
      // Where the hand was, always — two numbers, and the only evidence of how far he really drags.
      track.path[run.keyframe] = palmOf(picked.main) ?? { x: 0.5, y: 0.5 };
      // The same features the pose model decides with, from 3D where the engine gave world landmarks.
      const geometry = handGeometry({ landmarks: picked.main, world: view.world[view.hands.indexOf(picked.main)] ?? null });
      const features = geometry ? poseFeatures(geometry) : null;
      track.pose[run.keyframe] = features ? [...features.values, features.spreadWeight] : null;
      run.tracks.set(label, track);
      took++;
    }

    if (!took) {
      /*
       * Nothing usable. One two-second extension, in red — William's "are you sure" grace period —
       * and then the take ends at the confirmation with an honest account of what happened, rather
       * than looping silently until he presses STOP. That loop was a real fault on 2026-09-12.
       */
      if (!run.graced) {
        run.graced = true;
        run.stage = 'grace';
        run.until = now + GRACE_MS;
        count.className = 'wz-count grace';
        say(
          sawSomething
            ? `A hand is in shot, but not the one this take wants — ${handsOf(gesture) === 2 ? 'both hands, please' : run.variant === 'left-hand' ? 'your left hand' : 'your right hand'}.`
            : 'No hand in shot. Two more seconds…',
          'bad'
        );
        return;
      }
      finishTake(sawSomething ? 'the hand it wanted never appeared' : 'nothing was in shot');
      return;
    }

    drawShots();
    if (run.keyframe + 1 < gesture.frames) {
      run.keyframe++;
      run.graced = false;
      run.stage = 'count';
      run.until = now + COUNT_MS;
      say(`Good — ${took} camera${took === 1 ? '' : 's'}. Now: ${promptFor(gesture, run.keyframe)}`, 'ok');
      return;
    }
    void bank();
  }

  /** Store one example per camera that captured the whole take. */
  async function bank(): Promise<void> {
    if (!run) return;
    run.stage = 'confirm';
    count.textContent = '';
    const { gesture, variant } = run;
    const stored: { gestureId: string; sampleId: string }[] = [];
    const refused: string[] = [];

    for (const [label, track] of run.tracks) {
      if (track.main.filter(Boolean).length !== gesture.frames) {
        refused.push(`${label.slice(0, 18)}: incomplete`);
        continue;
      }
      const result = await window.skynet['gesture:addSample']({
        gestureId: gesture.id,
        keyframes: track.main,
        ...(handsOf(gesture) === 2 ? { offhand: track.off } : {}),
        ...(track.path.filter(Boolean).length === gesture.frames ? { path: track.path } : {}),
        ...(track.pose.filter(Boolean).length === gesture.frames ? { pose: track.pose as number[][] } : {}),
        camera: label,
        ...(variant === 'clean' ? {} : { variant })
      });
      if (result.ok) {
        if (result.sampleId) stored.push({ gestureId: gesture.id, sampleId: result.sampleId });
        library = result.library.gestures;
      } else {
        refused.push(`${label.slice(0, 18)}: ${result.verdict.reason ?? 'refused'}`);
      }
    }

    if (!run) return;
    run.stored = stored;
    run.takes += stored.length ? 1 : 0;
    if (stored.length && !refreshed.includes(gesture.id)) refreshed.push(gesture.id);
    const updated = library.find((entry) => entry.id === gesture.id);
    if (updated) run.gesture = updated;
    finishTake(
      stored.length
        ? `Kept ${stored.length} example${stored.length === 1 ? '' : 's'}${refused.length ? ` · ${refused.join(' · ')}` : ''}`
        : refused.join(' · ') || 'nothing was kept'
    );
  }

  /**
   * Every take ends here, and nothing starts a new one on its own.
   *
   * William, 2026-09-12: "after each set or round of capturing a keyframe make a confirm prompt,
   * don't just automatically move onto the next gesture intake." It is also what closes the trap he
   * fell into — a variant run whose takes were all refused looped for ever, because only a
   * successful take could reach the end condition and nothing counted the failures.
   */
  function finishTake(note: string): void {
    if (!run) return;
    run.stage = 'confirm';
    if (clock !== null) {
      window.clearInterval(clock);
      clock = null;
    }
    count.textContent = '';
    count.className = 'wz-count';
    const gesture = run.gesture;
    const kept = run.stored.length;
    say(note, kept ? 'ok' : 'bad');
    setDots(Math.min(gesture.samples.length, MIN_SAMPLES), MIN_SAMPLES);
    drawShots();

    actions.innerHTML = '';
    actions.append(button('ANOTHER TAKE', () => startRun(gesture, run!.variant), 'go'));
    if (kept) {
      actions.append(
        button(`DISCARD THIS TAKE`, () => void discardTake(), 'stop')
      );
    }
    actions.append(button('DONE WITH THIS GESTURE', () => { stopRun(); showGesture(); }));
  }

  /** Drop exactly the examples the take just stored, and offer it again. */
  async function discardTake(): Promise<void> {
    if (!run) return;
    const gesture = run.gesture;
    const variant = run.variant;
    for (const item of run.stored) {
      const result = await window.skynet['gesture:dropSample'](item);
      if (result.ok) library = result.library.gestures;
    }
    const fresh = library.find((entry) => entry.id === gesture.id) ?? gesture;
    startRun(fresh, variant);
    say('Discarded. Going again.', 'ok');
  }

  // ── the audit ───────────────────────────────────────────────────────────────────────────────

  /**
   * The last phase: what was taught, whether it works, and the one button that makes it work better.
   *
   * Two different questions are answered here and they are worth keeping apart. The HEALTH audit
   * asks whether any example is poisonous — a recording that would be misread as a different
   * gesture, which is a fault to be removed. The ANALYSIS asks whether the catalogue as a whole
   * actually classifies, by taking each example out in turn and seeing whether it comes back to
   * itself. A catalogue can be perfectly healthy and still perform badly, and only the second
   * question notices.
   */
  async function showDone(): Promise<void> {
    phase = 'done';
    drawSteps();
    clearPanels();
    stopRun();
    title.textContent = 'CHECK';
    const [health, analysis] = await Promise.all([
      window.skynet['gesture:health'](),
      window.skynet['gesture:analysis']()
    ]);
    drawReport(health, analysis);
  }

  function drawReport(health: LibraryHealth, analysis: Analysis): void {
    clearPanels();
    const pct = Math.round(analysis.overall.accuracy * 100);
    lead.textContent = `${pct}% of your ${analysis.overall.total} examples classify correctly.${
      refreshed.length ? ` Refreshed ${refreshed.length} gesture${refreshed.length === 1 ? '' : 's'} this pass.` : ''
    }`;
    say(health.ok ? analysis.note : `${health.note} ${analysis.note}`, health.ok && pct === 100 ? 'ok' : 'bad');

    const scored = new Map(analysis.gestures.map((score) => [score.id, score]));
    for (const gesture of health.gestures) {
      const score = scored.get(gesture.id);
      const poisoned = gesture.faults.some((fault) => fault.severity === 'drop');
      const misread = score ? score.accuracy < 1 : false;
      const row = el('div', `wz-health${poisoned || misread ? ' bad' : gesture.usable ? ' ok' : ''}`);
      row.append(el('span', 'wz-health-name', gesture.name));
      /*
       * Separation is the number worth showing beside the count: how much further away the nearest
       * OTHER gesture is than this gesture's own examples are from each other. Below about 1.5 it
       * works today and will stop working the first time he does it slightly differently.
       */
      const detail = score
        ? `${gesture.sampleCount} · ${score.correct}/${score.total} · ${score.separation}x · ${score.note}`
        : `${gesture.sampleCount} · ${gesture.note}`;
      row.append(el('span', 'wz-health-note', detail));
      strip.append(row);
    }
    for (const missing of analysis.unmeasured) {
      const row = el('div', 'wz-health');
      row.append(el('span', 'wz-health-name', missing.name));
      row.append(el('span', 'wz-health-note', missing.reason));
      strip.append(row);
    }

    setDots(0, 0);
    actions.innerHTML = '';
    if (!health.ok) actions.append(button(`REPAIR — DROP ${health.drop.length}`, () => void repair(), 'go'));
    /*
     * TUNE is the point of the whole phase. Every gesture ships with one threshold; this fits each
     * one to its own measured scatter and to how close its nearest neighbour actually gets, so a
     * tight class stops matching things it should not and a loose one stops failing to match
     * itself. It is the training data changing the recogniser rather than just describing it.
     */
    actions.append(button('TUNE FROM MY DATA', () => void tune(), health.ok ? 'go' : ''));
    actions.append(
      button('◀ BACK TO TRAINING', () => void backToTraining()),
      button(health.ok ? 'DONE' : 'LEAVE IT', () => onFinished())
    );
  }

  async function tune(): Promise<void> {
    const result = await window.skynet['gesture:tune']();
    library = result.library.gestures;
    const [health, analysis] = await Promise.all([
      window.skynet['gesture:health'](),
      window.skynet['gesture:analysis']()
    ]);
    drawReport(health, analysis);
    const before = Math.round(result.before * 100);
    const after = Math.round(result.after * 100);
    say(
      result.changed.length
        ? `${result.note} ${before}% → ${after}%. ${result.changed
            .slice(0, 4)
            .map((change) => `${change.name} ${change.from}→${change.to}`)
            .join(' · ')}`
        : result.note,
      'ok'
    );
  }

  /** Back into the catalogue at the last gesture, not at the first. */
  async function backToTraining(): Promise<void> {
    phase = 'train';
    drawSteps();
    const current = await window.skynet['gesture:library']();
    library = current.gestures;
    trainIndex = Math.max(0, library.length - 1);
    showGesture();
  }

  async function repair(): Promise<void> {
    const result = await window.skynet['gesture:repair']();
    library = result.library.gestures;
    await showDone();
    say(`${result.note} ${result.dropped ? 'Re-capture those gestures when you can.' : ''}`.trim(), 'ok');
  }

  // ── the live half ───────────────────────────────────────────────────────────────────────────

  function onLevelFrame(): void {
    const reference = latest.get(driver);
    if (!reference) {
      say(`Waiting for a hand in ${driver}…`);
      steadyFrames = 0;
      return;
    }
    const view = seen.get(driver);
    const side = view?.sides.length ? sideOf(view.sides[0] ?? 'unknown') : 'unknown';
    const named = side === 'unknown' ? 'a hand it cannot name' : `your ${side.toUpperCase()} hand`;

    const others = cameras.filter((camera) => camera.label !== driver);
    if (!others.length) {
      say(`That camera can see ${named}. Continue when ready.`, 'ok');
      return;
    }
    const notes: string[] = [];
    let allOk = true;
    for (const other of others) {
      const observed = latest.get(other.label);
      if (!observed) {
        notes.push(`${other.label} CANNOT SEE YOUR HAND — turn it towards you`);
        allOk = false;
        continue;
      }
      const result = levelAdvice(reference.observation, observed.observation, LEVEL_TOLERANCE);
      other.view.classList.toggle('level-ok', result.ok);
      if (!result.ok) {
        allOk = false;
        notes.push(...result.notes);
      }
    }
    if (allOk) {
      steadyFrames++;
      say(steadyFrames > 12 ? `LEVEL — both cameras agree, and that is ${named}.` : `Hold it… that is ${named}.`, 'ok');
    } else {
      steadyFrames = 0;
      say(notes.join(' · '), 'bad');
    }
  }

  function onReachFrame(atMs: number): void {
    const observed = latest.get(driver);
    if (!observed) return;
    if (!reachStartedAt) reachStartedAt = atMs;
    const points = reachPoints.get(driver) ?? [];
    points.push({ x: observed.observation.x, y: observed.observation.y });
    reachPoints.set(driver, points);
    for (const camera of cameras) {
      if (camera.label === driver) continue;
      const other = latest.get(camera.label);
      if (!other) continue;
      const list = reachPoints.get(camera.label) ?? [];
      list.push({ x: other.observation.x, y: other.observation.y });
      reachPoints.set(camera.label, list);
    }

    const verdict = reachVerdict(boundsOf(points));
    const bounds = boundsOf(points);
    const width = bounds ? bounds.maxX - bounds.minX : 0;
    const height = bounds ? bounds.maxY - bounds.minY : 0;
    const enough = width > 0.3 && height > 0.25 && atMs - reachStartedAt > 2500;
    if (verdict.notes.length && verdict.clipped.length) {
      say(verdict.notes[0] ?? '', 'bad');
    } else if (enough) {
      say(`Good — ${Math.round(width * 100)}% across and ${Math.round(height * 100)}% down. Save when you are happy.`, 'ok');
    } else {
      say(`Keep sweeping — ${Math.round(width * 100)}% across, ${Math.round(height * 100)}% down so far.`);
    }
  }

  showIntro();
  void loadCalibration();

  return {
    frame(label, hands, sides, atMs, world) {
      // Every camera's frame is kept for the shutter, whatever phase this is — the shutter reads
      // all of them, not just the driver, which is what "both angles catalogued" means.
      seen.set(label, { hands, sides, atMs, world: world ?? [] });

      const hand = hands[0];
      if (!hand) {
        latest.delete(label);
        return;
      }
      const palm = palmOf(hand);
      const span = handSpan(hand);
      if (!palm || !(span > 0)) return;
      latest.set(label, { observation: { camera: label, x: palm.x, y: palm.y, span }, atMs });
      if (motion) {
        if (!motion.from.has(label)) motion.from.set(label, palm.x);
        motion.to.set(label, palm.x);
      }

      if (label !== driver && phase !== 'level') return;
      if (phase === 'level') onLevelFrame();
      else if (phase === 'reach') onReachFrame(atMs);
    },
    destroy() {
      stopRun();
      host.innerHTML = '';
    }
  };
}
