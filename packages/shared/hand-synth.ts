/**
 * A synthetic hand: bones, joints and a camera, so gestures can be generated rather than recorded.
 *
 * William, 2026-09-12: "recreating the gestures' fundamental ligature / geometry 'animation'
 * combined into the training data."
 *
 * ── Why a model hand at all ──────────────────────────────────────────────────────────────────
 *
 * Four examples of a fist, recorded at one desk under one lamp, tell you what a fist looked like
 * four times. They cannot tell you whether the classifier will still call it a fist when the hand is
 * turned forty degrees towards the side camera, or whether closing the hand pinky-first passes
 * through a shape that looks like a peace sign on the way. Those are the questions that decide
 * whether gesture control works, and they can only be answered by generating the hand from its
 * anatomy and sweeping every angle — thousands of times, in a test, in a second.
 *
 * ── The model ────────────────────────────────────────────────────────────────────────────────
 *
 * A kinematic skeleton with adult proportions: a wrist, four metacarpal heads fanned across the palm
 * with the transverse arch, three phalanges per finger, and a thumb rooted at its carpometacarpal
 * joint in front of the palm. Joints bend by angles, not by moving points:
 *
 *   - long fingers flex at MCP, PIP and DIP within their sagittal plane, and abduct at the MCP;
 *   - DIP follows PIP at about two thirds unless told otherwise — the two share a tendon, and a
 *     hand that curls one without the other is not a hand anyone makes;
 *   - the thumb has abduction and opposition at its base, then flexes at MCP and IP across the palm.
 *
 * Forward kinematics turns a pose into 21 points in MediaPipe's order. A rotation and translation
 * place the hand in front of a pinhole camera with a webcam's field of view, and the projection
 * produces image landmarks and camera-aligned world landmarks in the same shape the landmarker
 * returns — so everything downstream runs on generated hands exactly as it runs on real ones.
 *
 * ── What it is not ───────────────────────────────────────────────────────────────────────────
 *
 * It does not model the LANDMARKER. A real hand seen edge-on gives MediaPipe less to work with and
 * its predictions degrade; this model only adds noise, scaled up towards profile by a heuristic that
 * is labelled as one. So accuracy measured on synthetic hands is a measurement of the MATHS — the
 * geometry and the classifier — and an upper bound on the whole system, never a claim about it.
 * William's own recordings are what close that gap, which is why the two are combined.
 *
 * Deterministic: every random draw comes from a seeded generator.
 */

import type { Hand } from './gesture.js';
import type { RawSide } from './hand-roles.js';

export type Vec3 = [number, number, number];

// ── randomness that can be replayed ─────────────────────────────────────────────────────────

/** mulberry32: small, fast, and good enough that a test's hands are the same hands every run. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A standard normal draw (Box–Muller). */
export function gaussian(rng: () => number): number {
  const u = Math.max(1e-12, rng());
  const v = rng();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

const rad = (degrees: number): number => (degrees * Math.PI) / 180;

// ── the pose: angles, in degrees, because that is how anatomy is written ─────────────────────

export interface FingerPose {
  /** Flexion at the knuckle. 0 straight, 90 bent square to the palm. */
  mcp: number;
  /** Flexion at the middle joint. */
  pip: number;
  /** Flexion at the last joint. Omitted means two thirds of `pip`, as the tendons couple them. */
  dip?: number;
  /** Sideways at the knuckle, towards the thumb positive. Added to the finger's natural fan. */
  abd?: number;
}

export interface ThumbPose {
  /** 0 lying alongside the index finger … 1 stretched fully out to the side. */
  abduction: number;
  /** 0 in the plane of the palm … 1 swung round in front of it, towards the little finger. */
  opposition: number;
  mcp: number;
  ip: number;
}

export interface HandPose {
  thumb: ThumbPose;
  index: FingerPose;
  middle: FingerPose;
  ring: FingerPose;
  pinky: FingerPose;
}

type Long = 'index' | 'middle' | 'ring' | 'pinky';
const LONG: readonly Long[] = ['index', 'middle', 'ring', 'pinky'];

const straight = (abd = 0): FingerPose => ({ mcp: 4, pip: 4, abd });
const curled: FingerPose = { mcp: 88, pip: 104, dip: 62 };

/**
 * The gestures, and the distractors that must NOT be mistaken for them.
 *
 * Angles are within published active ranges of motion and describe the pose as a person actually
 * holds it — a fist does not reach the anatomical maximum at every joint, and an open hand is never
 * perfectly flat.
 */
export const POSES = {
  /** Fingers straight and spread: the cursor, stretched. */
  open: {
    thumb: { abduction: 0.85, opposition: 0.15, mcp: 6, ip: 6 },
    index: straight(5),
    middle: straight(0),
    ring: straight(-4),
    pinky: straight(-8)
  },
  /** The cursor as it is really held: a little bent, fingers together. */
  openRelaxed: {
    thumb: { abduction: 0.55, opposition: 0.3, mcp: 12, ip: 18 },
    index: { mcp: 16, pip: 20, abd: 2 },
    middle: { mcp: 16, pip: 22, abd: 0 },
    ring: { mcp: 18, pip: 24, abd: -2 },
    pinky: { mcp: 20, pip: 26, abd: -4 }
  },
  /** The click, four fingers curled towards the camera, thumb across them. */
  fist: {
    thumb: { abduction: 0.25, opposition: 0.75, mcp: 38, ip: 42 },
    index: curled,
    middle: curled,
    ring: curled,
    pinky: curled
  },
  /**
   * A fist with the thumb lying BESIDE the index rather than across the fingers. Just as much a click,
   * and the pose that decides how far out a thumb can be before the hand is a thumbs-up instead.
   */
  fistThumbBeside: {
    thumb: { abduction: 0.1, opposition: 0.35, mcp: 20, ip: 25 },
    index: curled,
    middle: curled,
    ring: curled,
    pinky: curled
  },
  /** The right click: index and middle up in a V, the rest curled, thumb over ring and pinky. */
  peace: {
    thumb: { abduction: 0.3, opposition: 0.8, mcp: 35, ip: 40 },
    index: { mcp: 4, pip: 6, abd: 10 },
    middle: { mcp: 4, pip: 6, abd: -9 },
    ring: { mcp: 86, pip: 102, dip: 60 },
    pinky: { mcp: 84, pip: 100, dip: 58 }
  },
  /** Index out, the rest curled. Not one of the five, and must not be read as a peace sign. */
  point: {
    thumb: { abduction: 0.3, opposition: 0.75, mcp: 35, ip: 40 },
    index: straight(0),
    middle: curled,
    ring: curled,
    pinky: curled
  },
  /** Two fingers up but TOGETHER: the near-miss for a peace sign. */
  twoTogether: {
    thumb: { abduction: 0.3, opposition: 0.8, mcp: 35, ip: 40 },
    index: { mcp: 4, pip: 6, abd: -3 },
    middle: { mcp: 4, pip: 6, abd: 3 },
    ring: curled,
    pinky: curled
  },
  /** A thumbs-up: a fist in its fingers, but not a click. */
  thumbsUp: {
    thumb: { abduction: 1, opposition: 0, mcp: 0, ip: 0 },
    index: curled,
    middle: curled,
    ring: curled,
    pinky: curled
  },
  /** A half-closed claw: the shape a hand passes through, which should belong to nothing. */
  claw: {
    thumb: { abduction: 0.5, opposition: 0.5, mcp: 25, ip: 30 },
    index: { mcp: 12, pip: 70, dip: 50 },
    middle: { mcp: 12, pip: 72, dip: 52 },
    ring: { mcp: 14, pip: 72, dip: 52 },
    pinky: { mcp: 16, pip: 70, dip: 50 }
  }
} satisfies Record<string, HandPose>;

export type PoseName = keyof typeof POSES;

/** Linear interpolation of every joint angle. `t` is clamped to 0..1. */
export function blendPose(a: HandPose, b: HandPose, t: number): HandPose {
  const k = Math.min(1, Math.max(0, t));
  const mix = (x: number, y: number): number => x + (y - x) * k;
  const finger = (f: FingerPose, g: FingerPose): FingerPose => ({
    mcp: mix(f.mcp, g.mcp),
    pip: mix(f.pip, g.pip),
    dip: mix(f.dip ?? f.pip * 0.66, g.dip ?? g.pip * 0.66),
    abd: mix(f.abd ?? 0, g.abd ?? 0)
  });
  return {
    thumb: {
      abduction: mix(a.thumb.abduction, b.thumb.abduction),
      opposition: mix(a.thumb.opposition, b.thumb.opposition),
      mcp: mix(a.thumb.mcp, b.thumb.mcp),
      ip: mix(a.thumb.ip, b.thumb.ip)
    },
    index: finger(a.index, b.index),
    middle: finger(a.middle, b.middle),
    ring: finger(a.ring, b.ring),
    pinky: finger(a.pinky, b.pinky)
  };
}

/**
 * Blend finger by finger on a stagger, the way a real hand closes.
 *
 * `lead` is how far ahead the first finger in `order` runs, as a fraction of the movement. People
 * commonly close little finger first; this is how that is generated — and it is the case where a
 * closing hand passes briefly through something with two fingers still up.
 */
export function staggeredBlend(
  a: HandPose,
  b: HandPose,
  t: number,
  order: readonly Long[] = ['pinky', 'ring', 'middle', 'index'],
  lead = 0.35
): HandPose {
  const base = blendPose(a, b, t);
  const result: HandPose = { ...base };
  /*
   * Each finger moves over its own window of length (1 - lead). The first starts at 0, the last
   * starts at `lead`, so at t = 0 every finger is at `a` and at t = 1 every finger is at `b`. The
   * first version offset the windows the other way and never reached either end: measured on
   * 2026-09-12, its "fist" still had the index finger only 80% closed.
   */
  order.forEach((finger, i) => {
    const start = order.length > 1 ? (lead * i) / (order.length - 1) : 0;
    const local = (t - start) / (1 - lead);
    result[finger] = blendPose(a, b, local)[finger];
  });
  return result;
}

/** Natural variation: every joint moved by a normal draw of `sigma` degrees. Abduction by half that. */
export function jitterPose(pose: HandPose, rng: () => number, sigma: number): HandPose {
  const j = (value: number, s = sigma): number => value + gaussian(rng) * s;
  const finger = (f: FingerPose): FingerPose => ({
    mcp: j(f.mcp),
    pip: j(f.pip),
    dip: j(f.dip ?? f.pip * 0.66),
    abd: j(f.abd ?? 0, sigma / 2)
  });
  return {
    thumb: {
      abduction: Math.min(1, Math.max(0, pose.thumb.abduction + gaussian(rng) * 0.08)),
      opposition: Math.min(1, Math.max(0, pose.thumb.opposition + gaussian(rng) * 0.08)),
      mcp: j(pose.thumb.mcp),
      ip: j(pose.thumb.ip)
    },
    index: finger(pose.index),
    middle: finger(pose.middle),
    ring: finger(pose.ring),
    pinky: finger(pose.pinky)
  };
}

// ── the skeleton ─────────────────────────────────────────────────────────────────────────────

/*
 * Local frame, for a RIGHT hand: origin at the wrist, +X towards the thumb, +Y along the fingers,
 * +Z out of the palm. X × Y = Z. A left hand is the same hand with X negated.
 *
 * Metres, adult proportions: palm (wrist to middle knuckle) about 95 mm, middle finger about 91 mm.
 */
const KNUCKLE: Record<Long, Vec3> = {
  index: [0.025, 0.09, 0],
  middle: [0.005, 0.095, -0.004],
  ring: [-0.015, 0.088, -0.003],
  pinky: [-0.033, 0.078, 0.002]
};
/** Proximal, middle and distal phalanx lengths. */
const PHALANGES: Record<Long, [number, number, number]> = {
  index: [0.04, 0.023, 0.018],
  middle: [0.045, 0.027, 0.019],
  ring: [0.042, 0.026, 0.019],
  pinky: [0.033, 0.019, 0.017]
};
/** The natural fan of each finger's ray, degrees towards the thumb. */
const FAN: Record<Long, number> = { index: 6, middle: 0, ring: -6, pinky: -13 };

const THUMB_CMC: Vec3 = [0.022, 0.028, 0.012];
const THUMB_BONES: [number, number, number] = [0.042, 0.032, 0.025];

const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const mul = (a: Vec3, k: number): Vec3 => [a[0] * k, a[1] * k, a[2] * k];
const norm = (a: Vec3): Vec3 => {
  const l = Math.hypot(a[0], a[1], a[2]) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};
const dot3 = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

/** Forward kinematics: a pose to 21 points in MediaPipe's order, in the local frame of a right hand. */
export function skeleton(pose: HandPose): Vec3[] {
  const points: Vec3[] = new Array(21).fill(null).map(() => [0, 0, 0] as Vec3);
  const palmar: Vec3 = [0, 0, 1];

  LONG.forEach((finger, i) => {
    const f = pose[finger];
    const base = 5 + i * 4;
    const heading = rad(FAN[finger] + (f.abd ?? 0));
    // The finger's ray in the palm plane, then bent towards the palm by the cumulative flexion.
    const ray: Vec3 = [Math.sin(heading), Math.cos(heading), 0];
    const toward = (angle: number): Vec3 => add(mul(ray, Math.cos(angle)), mul(palmar, Math.sin(angle)));
    const [l1, l2, l3] = PHALANGES[finger];
    const a1 = rad(f.mcp);
    const a2 = a1 + rad(f.pip);
    const a3 = a2 + rad(f.dip ?? f.pip * 0.66);
    const mcp = KNUCKLE[finger];
    const pip = add(mcp, mul(toward(a1), l1));
    const dip = add(pip, mul(toward(a2), l2));
    const tip = add(dip, mul(toward(a3), l3));
    points[base] = mcp;
    points[base + 1] = pip;
    points[base + 2] = dip;
    points[base + 3] = tip;
  });

  const t = pose.thumb;
  // The thumb's metacarpal: from lying alongside the index to stretched out, then swung in front.
  const adducted = norm([0.25, 1, 0.15]);
  const abducted = norm([1, 0.75, 0.25]);
  let meta = norm(add(mul(adducted, 1 - t.abduction), mul(abducted, t.abduction)));
  meta = norm(add(meta, mul([0, -0.1, 0.9], t.opposition)));
  // It flexes across the palm, towards the little finger and in front: orthogonalised to the bone.
  const across = norm([-0.8, 0, 0.6 * (0.4 + t.opposition)]);
  const bend = norm(add(across, mul(meta, -dot3(across, meta))));
  const toward = (angle: number): Vec3 => add(mul(meta, Math.cos(angle)), mul(bend, Math.sin(angle)));
  const cmc = THUMB_CMC;
  const mcp = add(cmc, mul(meta, THUMB_BONES[0]));
  const ip = add(mcp, mul(toward(rad(t.mcp)), THUMB_BONES[1]));
  const tip = add(ip, mul(toward(rad(t.mcp + t.ip)), THUMB_BONES[2]));
  points[1] = cmc;
  points[2] = mcp;
  points[3] = ip;
  points[4] = tip;
  points[0] = [0, 0, 0];
  return points;
}

// ── the camera ───────────────────────────────────────────────────────────────────────────────

export interface View {
  /** Degrees about the camera's vertical axis: turning the palm towards the side camera. */
  yaw: number;
  /** Degrees about the camera's horizontal axis: tilting the fingers towards or away from the lens. */
  pitch: number;
  /** Degrees about the line of sight. */
  roll: number;
  /** Where the PALM's centre is, in metres, camera frame: x right, y down, z away from the lens. */
  x: number;
  y: number;
  distance: number;
}

/** Palm square to the camera, fingers up, 60 cm away, dead centre. */
export const FRONTAL: View = { yaw: 0, pitch: 0, roll: 0, x: 0, y: 0, distance: 0.6 };

export interface CameraModel {
  width: number;
  height: number;
  /** Horizontal field of view in degrees. Consumer webcams are 65–78°. */
  hfov: number;
  /** A camera whose driver hands over a mirror image. */
  mirrored: boolean;
}

export const DEFAULT_CAMERA: CameraModel = { width: 1280, height: 720, hfov: 70, mirrored: false };

export interface RenderOptions {
  chirality?: 'right' | 'left';
  view?: View;
  camera?: CameraModel;
  /** Standard deviation of image landmark noise, in normalised frame widths. */
  imageNoise?: number;
  /** Standard deviation of world landmark noise, in metres, for a hand square to the camera. */
  worldNoise?: number;
  rng?: () => number;
}

export interface Rendered {
  landmarks: Hand;
  world: Hand;
  /** The hand it actually is. */
  chirality: 'right' | 'left';
  /**
   * What MediaPipe would label it, under its DOCUMENTED convention — that it assumes a mirrored
   * image. Recorded for completeness; nothing in the main controls is allowed to depend on it, because
   * on 2026-09-12 this rig showed that convention and camera mirroring cannot be assumed.
   */
  label: RawSide;
}

const rotateY = (p: Vec3, a: number): Vec3 => [p[0] * Math.cos(a) + p[2] * Math.sin(a), p[1], -p[0] * Math.sin(a) + p[2] * Math.cos(a)];
const rotateX = (p: Vec3, a: number): Vec3 => [p[0], p[1] * Math.cos(a) - p[2] * Math.sin(a), p[1] * Math.sin(a) + p[2] * Math.cos(a)];
const rotateZ = (p: Vec3, a: number): Vec3 => [p[0] * Math.cos(a) - p[1] * Math.sin(a), p[0] * Math.sin(a) + p[1] * Math.cos(a), p[2]];

/**
 * Place a posed hand in front of a camera and return what the landmarker would.
 *
 * Base orientation: palm towards the lens, fingers up. For a right hand in a raw (unmirrored) frame
 * that puts the thumb on the image's right, since the camera faces the person.
 */
export function render(pose: HandPose, options: RenderOptions = {}): Rendered {
  const chirality = options.chirality ?? 'right';
  const view = options.view ?? FRONTAL;
  const camera = options.camera ?? DEFAULT_CAMERA;
  const rng = options.rng;
  const imageNoise = options.imageNoise ?? 0;
  // Profile views give the landmarker less to see. A heuristic, labelled as one: up to 3x the noise
  // at a hand fully edge-on.
  const worldNoise = (options.worldNoise ?? 0) * (1 + 2 * Math.abs(Math.sin(rad(view.yaw))));

  const local = skeleton(pose).map((p): Vec3 => (chirality === 'left' ? [-p[0], p[1], p[2]] : p));
  // Local to camera: +X stays right, +Y (fingers) becomes up (−y), +Z (palm) faces the lens (−z).
  const oriented = local.map((p) => rotateZ(rotateX(rotateY([p[0], -p[1], -p[2]], rad(view.yaw)), rad(view.pitch)), rad(view.roll)));

  /*
   * Two different origins, deliberately.
   *
   * World landmarks are centred on the geometric centre of all 21 points, because that is what
   * MediaPipe documents for its world model.
   *
   * The hand is PLACED by its palm — wrist and four knuckles — because that is the part that stays
   * where it is when the fingers move. The first version placed it by the 21-point centre, so every
   * time a fist closed the centre moved towards the palm and the renderer shifted the whole hand to
   * compensate: measured on 2026-09-12 as 8.4% of the frame width of pointer drift that a real hand
   * does not produce. A synthetic artefact that would have been blamed on the pointer maths.
   */
  const meanOf = (ids: readonly number[]): Vec3 =>
    ids.reduce((sum, id) => add(sum, oriented[id]!), [0, 0, 0] as Vec3).map((c) => c / ids.length) as Vec3;
  const centroid = meanOf(oriented.map((_, id) => id));
  const palmCentre = meanOf([0, 5, 9, 13, 17]);
  const world = oriented.map((p) => [p[0] - centroid[0], p[1] - centroid[1], p[2] - centroid[2]] as Vec3);
  const placed = oriented.map((p) => add([p[0] - palmCentre[0], p[1] - palmCentre[1], p[2] - palmCentre[2]], [view.x, view.y, view.distance]));

  const fx = camera.width / 2 / Math.tan(rad(camera.hfov) / 2);
  const wristDepth = placed[0]![2];
  const noisy = (sigma: number): number => (rng && sigma > 0 ? gaussian(rng) * sigma : 0);

  let landmarks: Hand = placed.map((p) => ({
    x: (camera.width / 2 + (fx * p[0]) / p[2]) / camera.width + noisy(imageNoise),
    y: (camera.height / 2 + (fx * p[1]) / p[2]) / camera.height + noisy(imageNoise * (camera.width / camera.height)),
    z: ((p[2] - wristDepth) * fx) / (wristDepth * camera.width) + noisy(imageNoise * 3)
  }));
  let worldHand: Hand = world.map((p) => ({ x: p[0] + noisy(worldNoise), y: p[1] + noisy(worldNoise), z: p[2] + noisy(worldNoise) }));

  let apparent = chirality;
  if (camera.mirrored) {
    landmarks = landmarks.map((p) => ({ ...p, x: 1 - p.x }));
    worldHand = worldHand.map((p) => ({ ...p, x: -p.x }));
    apparent = chirality === 'right' ? 'left' : 'right';
  }

  return { landmarks, world: worldHand, chirality, label: apparent === 'right' ? 'Left' : 'Right' };
}
