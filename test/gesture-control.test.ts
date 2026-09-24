/**
 * The control machine, driven by the synthetic hand performing William's vocabulary.
 *
 * William, 2026-09-12: "open hand is the cursor and when moved the cursor movement in the program
 * should mirror the hand's movement. Closing the hand into a fist quickly, then opening is a left
 * click. Changing to a peace sign is a right click. Zooming in is anytime two hands are pointed
 * towards each other and moving away from each other, zooming out is two hands facing together
 * moving towards each other … click-hold and drag."
 *
 * Every test here is one of those sentences, performed frame by frame at thirty frames a second by a
 * kinematic hand whose joints actually bend — not a fixture that jumps from one pose to the next. The
 * transitions are the point: a click is not a fist, it is a hand CLOSING and OPENING, and most of
 * what can go wrong happens in between.
 *
 * None of these tests trains anything. The controls work from geometry alone, which is the baseline
 * he asked for.
 */

import { describe, expect, it } from 'vitest';
import {
  DEFAULT_CAMERA,
  FRONTAL,
  POSES,
  blendPose,
  render,
  staggeredBlend,
  type HandPose,
  type View
} from '@shared/hand-synth.js';
import {
  DEFAULT_CONTROL_CONFIG,
  createControl,
  orientationBetween,
  poseExamples,
  separationOf,
  type ControlEvent,
  type GestureControl,
  type HandObservation
} from '@shared/gesture-control.js';
import { handGeometry } from '@shared/hand-geometry.js';
import { EMPTY_LIBRARY, MIN_SAMPLES, featuresOf, type GestureLibrary } from '@shared/gesture-library.js';

/** Thirty frames a second, as the vision page runs. */
const FRAME = 33;
/** Arm's length at a desk. */
const DESK: View = { ...FRONTAL, distance: 0.5 };

const see = (pose: HandPose, view: Partial<View> = {}, chirality: 'right' | 'left' = 'right'): HandObservation => {
  const rendered = render(pose, { chirality, view: { ...DESK, ...view }, camera: DEFAULT_CAMERA });
  return { landmarks: rendered.landmarks, world: rendered.world, label: rendered.label };
};

type Pose = HandPose | ((t: number) => HandPose);
type Place = Partial<View> | ((t: number) => Partial<View>);
interface Step {
  pose: Pose;
  ms: number;
  view?: Place;
}

/** Perform a sequence of steps with one hand. Each step's `t` runs 0 → 1 across its frames. */
function perform(control: GestureControl, steps: Step[], start = 0): { events: { at: number; event: ControlEvent }[]; end: number } {
  const events: { at: number; event: ControlEvent }[] = [];
  let at = start;
  for (const step of steps) {
    const count = Math.max(1, Math.round(step.ms / FRAME));
    for (let i = 0; i < count; i++) {
      const t = count === 1 ? 1 : i / (count - 1);
      const pose = typeof step.pose === 'function' ? step.pose(t) : step.pose;
      const view = typeof step.view === 'function' ? step.view(t) : (step.view ?? {});
      for (const event of control.push({ hands: [see(pose, view)], atMs: at })) events.push({ at, event });
      at += FRAME;
    }
  }
  return { events, end: at };
}

const OPEN = POSES.openRelaxed;
const closing = (t: number): HandPose => blendPose(OPEN, POSES.fist, t);
const opening = (t: number): HandPose => blendPose(POSES.fist, OPEN, t);

const of = <T extends ControlEvent['type']>(events: { event: ControlEvent }[], type: T): Extract<ControlEvent, { type: T }>[] =>
  events.map((entry) => entry.event).filter((event): event is Extract<ControlEvent, { type: T }> => event.type === type);
const clicks = (events: { event: ControlEvent }[], button: 'left' | 'right') => of(events, 'click').filter((click) => click.button === button);

describe('the cursor: an open hand', () => {
  it('drives the cursor with nothing trained at all', () => {
    const { events } = perform(createControl(EMPTY_LIBRARY), [{ pose: OPEN, ms: 400 }]);
    expect(of(events, 'cursor').length).toBeGreaterThan(5);
    expect(of(events, 'suppressed')).toHaveLength(0);
  });

  it('accepts a flat, spread hand as readily as a relaxed one', () => {
    const { events } = perform(createControl(EMPTY_LIBRARY), [{ pose: POSES.open, ms: 400 }]);
    expect(of(events, 'cursor').length).toBeGreaterThan(5);
  });

  it('follows the hand across the frame, in the same direction the hand moves in the picture', () => {
    // Mirroring for the screen happens downstream, from the calibrated camera (useGesture.ts); here
    // the cursor must simply track the palm faithfully.
    const { events } = perform(createControl(EMPTY_LIBRARY), [
      { pose: OPEN, ms: 300 },
      { pose: OPEN, ms: 600, view: (t) => ({ x: 0.12 * t }) }
    ]);
    const cursors = of(events, 'cursor');
    expect(cursors.at(-1)!.x).toBeGreaterThan(cursors[0]!.x + 0.1);
  });

  it('is steady when the hand is still', () => {
    const control = createControl(EMPTY_LIBRARY);
    const { events } = perform(control, [{ pose: OPEN, ms: 600 }]);
    const tail = of(events, 'cursor').slice(-8);
    const spread = Math.max(...tail.map((c) => c.x)) - Math.min(...tail.map((c) => c.x));
    expect(spread).toBeLessThan(0.002);
  });

  it('does not come from a hand resting down by the desk', () => {
    const control = createControl(EMPTY_LIBRARY);
    const low = see(OPEN, { y: 0.13 });
    expect(handGeometry({ landmarks: low.landmarks, world: low.world })!.anchor.y).toBeGreaterThan(DEFAULT_CONTROL_CONFIG.roles.restingBelow);
    const { events } = perform(control, [{ pose: OPEN, ms: 400, view: { y: 0.13 } }]);
    expect(of(events, 'cursor')).toHaveLength(0);
    expect(of(events, 'suppressed').map((s) => s.reason)).toContain('rest');
  });
});

describe('the left click: close, then open', () => {
  it('is exactly one click, and not a drag', () => {
    const { events } = perform(createControl(EMPTY_LIBRARY), [
      { pose: OPEN, ms: 300 },
      { pose: closing, ms: 100 },
      { pose: POSES.fist, ms: 100 },
      { pose: opening, ms: 100 },
      { pose: OPEN, ms: 300 }
    ]);
    expect(clicks(events, 'left')).toHaveLength(1);
    expect(clicks(events, 'left')[0]!.count).toBe(1);
    expect(of(events, 'dragStart')).toHaveLength(0);
    expect(clicks(events, 'right')).toHaveLength(0);
  });

  it('freezes the cursor as the hand closes, so the click lands where he was aiming', () => {
    // A real hand drifts a little while it closes. Here it drifts 4% of the frame during the close;
    // the cursor must not follow that drift before the click.
    const control = createControl(EMPTY_LIBRARY);
    const aimed = perform(control, [{ pose: OPEN, ms: 400 }]);
    const aim = of(aimed.events, 'cursor').at(-1)!;
    const { events } = perform(
      control,
      [
        { pose: closing, ms: 120, view: (t) => ({ x: 0.02 * t }) },
        { pose: POSES.fist, ms: 90, view: { x: 0.02 } },
        { pose: opening, ms: 100, view: { x: 0.02 } }
      ],
      aimed.end
    );
    const clickAt = events.findIndex((entry) => entry.event.type === 'click');
    expect(clickAt).toBeGreaterThanOrEqual(0);
    const before = events.slice(0, clickAt).map((entry) => entry.event).filter((event) => event.type === 'cursor');
    for (const cursor of before) expect(Math.abs((cursor as { x: number }).x - aim.x)).toBeLessThan(0.01);
  });

  it('closing little-finger first is still a left click, and never a right click', () => {
    const { events } = perform(createControl(EMPTY_LIBRARY), [
      { pose: OPEN, ms: 300 },
      { pose: (t) => staggeredBlend(OPEN, POSES.fist, t), ms: 230 },
      { pose: POSES.fist, ms: 90 },
      { pose: opening, ms: 100 },
      { pose: OPEN, ms: 300 }
    ]);
    expect(clicks(events, 'left')).toHaveLength(1);
    expect(clicks(events, 'right')).toHaveLength(0);
  });

  it('two in quick succession are a double click', () => {
    const click: Step[] = [
      { pose: closing, ms: 90 },
      { pose: POSES.fist, ms: 70 },
      { pose: opening, ms: 90 },
      { pose: OPEN, ms: 70 }
    ];
    const { events } = perform(createControl(EMPTY_LIBRARY), [{ pose: OPEN, ms: 300 }, ...click, ...click]);
    expect(clicks(events, 'left').map((c) => c.count)).toEqual([1, 2]);
  });

  it('a thumbs-up is not a click', () => {
    const { events } = perform(createControl(EMPTY_LIBRARY), [
      { pose: OPEN, ms: 300 },
      { pose: (t) => blendPose(OPEN, POSES.thumbsUp, t), ms: 120 },
      { pose: POSES.thumbsUp, ms: 200 },
      { pose: (t) => blendPose(POSES.thumbsUp, OPEN, t), ms: 120 },
      { pose: OPEN, ms: 300 }
    ]);
    expect(clicks(events, 'left')).toHaveLength(0);
  });
});

describe('click-hold and drag', () => {
  it('holding the fist starts a drag where the fist closed, follows the hand, and ends on opening', () => {
    const control = createControl(EMPTY_LIBRARY);
    const { events } = perform(control, [
      { pose: OPEN, ms: 300 },
      { pose: closing, ms: 100 },
      { pose: POSES.fist, ms: 450 },
      { pose: POSES.fist, ms: 500, view: (t) => ({ x: 0.1 * t }) },
      { pose: opening, ms: 100, view: { x: 0.1 } },
      { pose: OPEN, ms: 300, view: { x: 0.1 } }
    ]);
    const start = of(events, 'dragStart');
    const moves = of(events, 'dragMove');
    expect(start).toHaveLength(1);
    expect(moves.length).toBeGreaterThan(5);
    expect(moves.at(-1)!.x).toBeGreaterThan(start[0]!.x + 0.08);
    expect(of(events, 'dragEnd')).toHaveLength(1);
    // A drag is not also a click.
    expect(clicks(events, 'left')).toHaveLength(0);
  });

  it('moving with the fist closed starts the drag before the hold time is up', () => {
    const { events } = perform(createControl(EMPTY_LIBRARY), [
      { pose: OPEN, ms: 300 },
      { pose: closing, ms: 100 },
      { pose: POSES.fist, ms: 250, view: (t) => ({ x: 0.08 * t }) }
    ]);
    const dragStart = events.find((entry) => entry.event.type === 'dragStart');
    expect(dragStart).toBeDefined();
    const fistEntered = 300 + 50;
    expect(dragStart!.at - fistEntered).toBeLessThan(DEFAULT_CONTROL_CONFIG.clickHoldMs);
  });

  it('a hand that is replaced mid-drag ends the drag rather than clicking', () => {
    const control = createControl(EMPTY_LIBRARY);
    const held = perform(control, [
      { pose: OPEN, ms: 300 },
      { pose: closing, ms: 100 },
      { pose: POSES.fist, ms: 450 }
    ]);
    expect(of(held.events, 'dragStart')).toHaveLength(1);
    // A different hand, far across the frame.
    const events = control.push({ hands: [see(OPEN, { x: -0.3 })], atMs: held.end });
    expect(events.some((event) => event.type === 'dragEnd')).toBe(true);
    expect(events.some((event) => event.type === 'click')).toBe(false);
  });
});

describe('the right click: a peace sign', () => {
  const toPeace = (t: number): HandPose => blendPose(OPEN, POSES.peace, t);
  const fromPeace = (t: number): HandPose => blendPose(POSES.peace, OPEN, t);

  it('fires once per sign, however long it is held, and again after the hand leaves it', () => {
    const { events } = perform(createControl(EMPTY_LIBRARY), [
      { pose: OPEN, ms: 300 },
      { pose: toPeace, ms: 120 },
      { pose: POSES.peace, ms: 700 },
      { pose: fromPeace, ms: 120 },
      { pose: OPEN, ms: 400 },
      { pose: toPeace, ms: 120 },
      { pose: POSES.peace, ms: 300 }
    ]);
    expect(clicks(events, 'right')).toHaveLength(2);
    expect(clicks(events, 'left')).toHaveLength(0);
  });

  it('two fingers held together is not a peace sign', () => {
    const { events } = perform(createControl(EMPTY_LIBRARY), [
      { pose: OPEN, ms: 300 },
      { pose: (t) => blendPose(OPEN, POSES.twoTogether, t), ms: 120 },
      { pose: POSES.twoTogether, ms: 500 }
    ]);
    expect(clicks(events, 'right')).toHaveLength(0);
  });
});

describe('zoom: two hands turned towards each other', () => {
  /** Two open hands, fingers pointed at each other, `gap` metres apart palm to palm. */
  const pair = (gap: number): HandObservation[] => [
    see(POSES.open, { x: -gap / 2, roll: 90 }, 'left'),
    see(POSES.open, { x: gap / 2, roll: -90 }, 'right')
  ];

  const play = (control: GestureControl, from: number, to: number, ms: number, start = 0): ControlEvent[] => {
    const events: ControlEvent[] = [];
    const count = Math.round(ms / FRAME);
    for (let i = 0; i < count; i++) {
      const gap = from + ((to - from) * i) / (count - 1);
      events.push(...control.push({ hands: pair(gap), atMs: start + i * FRAME }));
    }
    return events;
  };

  it('recognises the hands as turned towards each other', () => {
    const [a, b] = pair(0.2).map((hand) => handGeometry({ landmarks: hand.landmarks, world: hand.world })!);
    expect(orientationBetween(a!, b!)).toBeGreaterThan(0.8);
    // And measures distance in the hands' own palm lengths.
    expect(separationOf(a!, b!)).toBeGreaterThan(1.5);
  });

  it('moving apart zooms in', () => {
    const events = play(createControl(EMPTY_LIBRARY), 0.16, 0.4, 1000);
    const zooms = events.filter((event) => event.type === 'zoom') as { direction: string }[];
    expect(zooms.length).toBeGreaterThanOrEqual(2);
    expect(zooms.every((zoom) => zoom.direction === 'in')).toBe(true);
  });

  it('moving together zooms out', () => {
    const events = play(createControl(EMPTY_LIBRARY), 0.4, 0.16, 1000);
    const zooms = events.filter((event) => event.type === 'zoom') as { direction: string }[];
    expect(zooms.length).toBeGreaterThanOrEqual(2);
    expect(zooms.every((zoom) => zoom.direction === 'out')).toBe(true);
  });

  it('two hands held up side by side, palms to the camera, do not zoom however they move', () => {
    const control = createControl(EMPTY_LIBRARY);
    const events: ControlEvent[] = [];
    for (let i = 0; i < 30; i++) {
      const gap = 0.16 + (0.24 * i) / 29;
      events.push(...control.push({ hands: [see(POSES.open, { x: -gap / 2 }, 'left'), see(POSES.open, { x: gap / 2 }, 'right')], atMs: i * FRAME }));
    }
    expect(events.some((event) => event.type === 'zoom')).toBe(false);
  });
});

describe('both fists: the halt', () => {
  it('suspends every input for three seconds, then resumes', () => {
    const control = createControl(EMPTY_LIBRARY);
    const fists = [see(POSES.fist, { x: -0.12 }, 'left'), see(POSES.fist, { x: 0.12 }, 'right')];
    const events: ControlEvent[] = [];
    let at = 0;
    for (; at < 450; at += FRAME) events.push(...control.push({ hands: fists, atMs: at }));
    expect(events.some((event) => event.type === 'suppressed' && event.reason === 'halt')).toBe(true);
    // Mid-halt an open hand does nothing.
    expect(control.push({ hands: [see(OPEN)], atMs: at + 1000 }).some((event) => event.type === 'cursor')).toBe(false);
    // After it, it drives again.
    const after = perform(control, [{ pose: OPEN, ms: 300 }], at + DEFAULT_CONTROL_CONFIG.haltMs + 100);
    expect(of(after.events, 'resumed').length + of(after.events, 'cursor').length).toBeGreaterThan(0);
    expect(of(after.events, 'cursor').length).toBeGreaterThan(0);
  });
});

describe('the catalogue, where it still has a say', () => {
  it('a mistrained posture-to-ignore cannot swallow a clear fist', () => {
    // HOLDING A MOUSE, trained — wrongly — on fists. Under the old engine that would have silenced
    // every click. The geometry is confident, so the click still happens.
    const fist = see(POSES.fist);
    const features = featuresOf(fist.landmarks)!;
    const library: GestureLibrary = {
      version: 2,
      gestures: [
        {
          id: 'g_ignore_mouse',
          name: 'HOLDING A MOUSE',
          utterance: '',
          frames: 1,
          kind: 'posture',
          action: 'ignore',
          createdAt: 'x',
          samples: Array.from({ length: MIN_SAMPLES }, (_, i) => ({ id: `s${i}`, keyframes: [features.map((v) => v + i * 0.001)], capturedAt: 'x' }))
        }
      ]
    };
    const { events } = perform(createControl(library), [
      { pose: OPEN, ms: 300 },
      { pose: closing, ms: 100 },
      { pose: POSES.fist, ms: 100 },
      { pose: opening, ms: 100 },
      { pose: OPEN, ms: 300 }
    ]);
    expect(clicks(events, 'left')).toHaveLength(1);
  });

  it('turns recorded pose features into labelled examples that sharpen the model', () => {
    const library: GestureLibrary = {
      version: 2,
      gestures: [
        {
          id: 'g_left_click',
          name: 'LEFT CLICK',
          utterance: '',
          frames: 2,
          kind: 'sequence',
          action: 'left-click',
          createdAt: 'x',
          samples: [
            {
              id: 's1',
              keyframes: [[], []],
              pose: [
                [1.3, 0.1, 0.1, 0.1, 0.1, 0.4, 1],
                [1.0, 0.95, 0.96, 0.96, 0.95, 0.2, 0]
              ],
              capturedAt: 'x'
            }
          ]
        }
      ]
    };
    expect(poseExamples(library).map((example) => example.pose)).toEqual(['open', 'fist']);
    expect(createControl(library).state().refinedFrom).toBe(2);
  });
});

describe('reset', () => {
  it('forgets everything, including a halt and a half-finished drag', () => {
    const control = createControl(EMPTY_LIBRARY);
    perform(control, [
      { pose: OPEN, ms: 300 },
      { pose: closing, ms: 100 },
      { pose: POSES.fist, ms: 450 }
    ]);
    expect(control.state().dragging).toBe(true);
    control.reset();
    expect(control.state()).toMatchObject({ dragging: false, haltUntilMs: 0, zoomLocked: false, suppressed: null, pose: null, cursor: null });
  });
});
