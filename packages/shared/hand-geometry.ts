/**
 * The shape of a hand, measured in three dimensions, independent of where the camera is — and
 * independent of how noisy the landmarks are, which turned out to be the harder half.
 *
 * William, 2026-09-12: "I need the infrastructure and math behind the geometry / image detection to
 * be highly advanced for this."
 *
 * ── Why 2D measurements could not work on this rig ───────────────────────────────────────────
 *
 * Everything before this file measured hands in the picture: tip-to-wrist over knuckle-to-wrist
 * ratios, pinch distances, the angle of the knuckle line. A 2D ratio is a projection, and a
 * projection changes with the viewing angle. A straight finger pointed at the lens is SHORT in the
 * picture, so it reads as curled; a fist seen side-on shows its fingers along the line of sight.
 * William's second camera sits near profile, which is exactly where 2D ratios fall apart.
 *
 * ── Why joint angles were not the answer either ─────────────────────────────────────────────
 *
 * The first version of this file summed the flexion angle at each of a finger's three joints. That
 * is exactly invariant to the view — measured, to the second decimal, over yaw ±70°, pitch ±40° and
 * roll ±45° — and it collapsed the moment realistic noise was added: 42% accuracy on synthetic hands.
 *
 * The reason is statistical, and worth recording because it is not obvious. The angle between two
 * vectors is non-negative, so it cannot average out: add noise to a perfectly straight finger and
 * every joint measures some positive bend, never a negative one. On a 20 mm distal phalanx, 4 mm of
 * landmark noise is about 20° of phantom flexion per joint, and summing three joints triples it. An
 * unsigned angle over short bones is a BIASED estimator of curl, and the bias is largest precisely for
 * the open hand — the cursor.
 *
 * ── What is measured now ─────────────────────────────────────────────────────────────────────
 *
 * Long levers instead of short bones, signed projections instead of unsigned angles:
 *
 *  1. POINTS. Where both are available, x and y come from the IMAGE landmarks — which are the most
 *     precise thing the landmarker outputs — and depth comes from its WORLD landmarks, scaled into the
 *     same units. The scale is the least-squares fit of world x,y onto image x,y over all 21 points,
 *     which is the weak-perspective camera model and is accurate for an object as small as a hand at
 *     arm's length. Each source contributes the axis it measures best.
 *
 *  2. A PALM FRAME from bones that do not move when the fingers do: ŷ from wrist to middle knuckle,
 *     x̂ across the knuckles orthogonalised against it (Gram–Schmidt), n̂ = x̂ × ŷ.
 *
 *  3. CURL as REACH: how far the fingertip gets along its own finger's ray, divided by the finger's
 *     length. A straight finger reaches about +1; a relaxed one about 0.85; a claw about 0.37; in a fist
 *     the tip folds back past the knuckle to about −0.3. It is signed, so noise averages out instead of
 *     accumulating; it is monotone over the whole range, so a claw and a fist cannot be confused; and
 *     it is a projection over the whole finger — about 80 mm — so 4 mm of noise moves it by a few hundredths.
 *
 *  4. The V of a peace sign, measured knuckle-to-TIP rather than along the first bone, for the same
 *     reason: the longer the lever, the less a millimetre matters. Weighted by how straight both
 *     fingers are, since the direction of a curled finger in the plane of the palm is mostly noise.
 *
 *  5. The THUMB by distance: how far its tip is from the little-finger knuckle, in palm lengths. Tucked
 *     across a fist or over a peace sign it is close; stretched out for an open hand or a thumbs-up it is
 *     far. Distances are what noise disturbs least.
 *
 *  6. The PALMAR SIDE from anatomy — fingers only curl towards the palm, and the thumb rests in front
 *     of it — never from the handedness label, which on 2026-09-12 this rig showed cannot be assumed.
 *     Where nothing is decisive, the answer is `null`.
 *
 * The per-joint flexion angles are still computed and returned, for diagnostics. They are no longer
 * what anything decides with.
 */

import type { Hand, Landmark } from './gesture.js';

export type Vec3 = readonly [number, number, number];

/** MediaPipe's 21 landmarks, grouped by finger from base to tip. */
export const CHAIN = {
  thumb: [1, 2, 3, 4],
  index: [5, 6, 7, 8],
  middle: [9, 10, 11, 12],
  ring: [13, 14, 15, 16],
  pinky: [17, 18, 19, 20]
} as const;

export const WRIST_ID = 0;

export const LONG_FINGERS = ['index', 'middle', 'ring', 'pinky'] as const;
export type LongFinger = (typeof LONG_FINGERS)[number];

/**
 * Reach in a fist: the tip folds back past its knuckle by about a third of the finger's length.
 * Curl is scaled so this reads as 1.
 */
export const FIST_REACH = -0.3;

/** 16:9, which is what the vision page captures at. Image y is normalised by height, x by width. */
export const DEFAULT_ASPECT = 16 / 9;

/** Horizontal field of view, degrees. Logitech's C920 and C922 are 78° diagonal, about 70° across. */
export const DEFAULT_HFOV = 70;

// ── vector arithmetic, kept local and explicit ─────────────────────────────────────────────────

const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const scale = (a: Vec3, k: number): Vec3 => [a[0] * k, a[1] * k, a[2] * k];
export const dot = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const cross = (a: Vec3, b: Vec3): Vec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0]
];
export const length = (a: Vec3): number => Math.hypot(a[0], a[1], a[2]);
export const unit = (a: Vec3): Vec3 | null => {
  const l = length(a);
  return l > 1e-9 ? scale(a, 1 / l) : null;
};
/** `a` with its component along the unit vector `axis` removed. */
const reject = (a: Vec3, axis: Vec3): Vec3 => sub(a, scale(axis, dot(a, axis)));

/**
 * The unsigned angle between two vectors, in radians. atan2 of the cross and dot products rather than
 * acos of the normalised dot, which loses its precision near 0 and π.
 */
export const angleBetween = (a: Vec3, b: Vec3): number => Math.atan2(length(cross(a, b)), dot(a, b));

const clamp01 = (value: number): number => Math.min(1, Math.max(0, value));

export interface GeometryInput {
  /** Image landmarks, normalised 0..1 by width and height. Always required: the pointer lives here. */
  landmarks: Hand;
  /** World landmarks in metres, when the landmarker provides them. */
  world?: Hand | null;
  /** Image width over height. */
  aspect?: number;
  /** The camera's horizontal field of view in degrees, for undoing perspective. */
  hfov?: number;
}

export type GeometrySource = 'fused' | 'world' | 'image';

export interface HandGeometry {
  /**
   * The pointer: the palm centroid in image coordinates — wrist and the four knuckles.
   *
   * Not a fingertip. Measured on the synthetic hand, closing into a fist moves the index fingertip by
   * 22% of the frame width and the palm centroid by none of it. A pointer on a fingertip would jump at
   * the exact moment of clicking, and the click would land somewhere other than where he aimed.
   */
  anchor: { x: number; y: number };
  /** Wrist to middle knuckle in isotropic image units: the hand's own ruler for distances in frame. */
  palm: number;
  /** 0 straight … 1 closed, in the order thumb, index, middle, ring, pinky. See the file header. */
  curl: [number, number, number, number, number];
  /** Raw reach of each long finger along its own ray, over its length. +1 straight, about −0.3 in a fist. */
  reach: Record<LongFinger, number>;
  /** Flexion at [MCP, PIP, DIP] per long finger, radians. Diagnostics only — biased under noise. */
  flexion: Record<LongFinger, [number, number, number]>;
  /** Thumb tip to little-finger knuckle, in palm lengths. Small when tucked, large when out. */
  thumbReach: number;
  /** Index–middle V, knuckle to tip, in the plane of the palm, radians. */
  spread: number;
  /** Index and middle fingertips apart, in palm lengths. */
  tipGap: number;
  /** How much the V and the gap can be believed: how straight the two fingers are, 0 to 1. */
  spreadWeight: number;
  /** Unit direction wrist → middle knuckle in the image plane: which way the hand is pointing. */
  axis: { x: number; y: number };
  /** Out of the palm, camera-aligned. `null` when the hand does not reveal which side is palmar. */
  palmNormal: Vec3 | null;
  /** 1 when the palm plane is square to the camera, 0 when it is edge-on. */
  facing: number;
  source: GeometrySource;
}

const finite = (p: Landmark | undefined): p is Landmark =>
  !!p && Number.isFinite(p.x) && Number.isFinite(p.y) && (p.z === undefined || Number.isFinite(p.z));

function points3D(input: GeometryInput): { points: Vec3[]; source: GeometrySource } | null {
  const aspect = input.aspect ?? DEFAULT_ASPECT;
  const { world, landmarks } = input;
  const imageOk = landmarks.length >= 21 && landmarks.slice(0, 21).every(finite);
  const worldOk =
    !!world &&
    world.length >= 21 &&
    world.slice(0, 21).every((p) => finite(p) && p.z !== undefined) &&
    Math.hypot(world[9]!.x - world[0]!.x, world[9]!.y - world[0]!.y, (world[9]!.z ?? 0) - (world[0]!.z ?? 0)) > 0.01;

  if (imageOk && worldOk && world) {
    const w = world.slice(0, 21);
    // Offsets from the principal point, in frame widths on both axes.
    const image = landmarks.slice(0, 21).map((p) => [p.x - 0.5, (p.y - 0.5) / aspect] as [number, number]);
    const focal = 0.5 / Math.tan(((input.hfov ?? DEFAULT_HFOV) * Math.PI) / 360);
    const mean = (values: number[]): number => values.reduce((a, b) => a + b, 0) / values.length;
    const wx = mean(w.map((p) => p.x));
    const wy = mean(w.map((p) => p.y));
    /** Least-squares scale of world x,y onto image x,y, over centred coordinates. */
    const fit = (points: [number, number][]): number => {
      const ix = mean(points.map((p) => p[0]));
      const iy = mean(points.map((p) => p[1]));
      let num = 0;
      let den = 0;
      for (let k = 0; k < 21; k++) {
        const u = w[k]!.x - wx;
        const v = w[k]!.y - wy;
        num += (points[k]![0] - ix) * u + (points[k]![1] - iy) * v;
        den += u * u + v * v;
      }
      return den > 0 ? num / den : 0;
    };
    const first = fit(image);
    if (first > 0) {
      /*
       * Undo perspective, then fit again.
       *
       * A plain scale fit assumes the whole hand is at one depth. It is not: turned 70° towards the side
       * camera, a hand spans a third of its distance from the lens, and the near fingers are magnified
       * relative to the far ones. Measured on 2026-09-12, that bent curl by up to 0.07 at the extreme
       * views. The correction is exact for a pinhole: a point at depth z from the hand's centre, which is
       * at Z0, lands at offset f·X/(Z0 + z), so multiplying its offset by (1 + z/Z0) restores f·X/Z0. And
       * Z0 is known from the fit itself, because the fitted scale is f/Z0.
       */
      const corrected = image.map((p, k) => {
        const stretch = 1 + ((w[k]!.z ?? 0) * first) / focal;
        return [p[0] * stretch, p[1] * stretch] as [number, number];
      });
      const s = fit(corrected);
      if (s > 0) return { points: corrected.map((p, k) => [p[0], p[1], (w[k]!.z ?? 0) * s] as Vec3), source: 'fused' };
    }
  }
  if (worldOk && world) return { points: world.slice(0, 21).map((p) => [p.x, p.y, p.z ?? 0] as Vec3), source: 'world' };
  if (!imageOk) return null;
  return { points: landmarks.slice(0, 21).map((p) => [p.x, p.y / aspect, p.z ?? 0] as Vec3), source: 'image' };
}

/** Measure a hand, or return null when it cannot be measured honestly. */
export function handGeometry(input: GeometryInput): HandGeometry | null {
  const measured = points3D(input);
  if (!measured) return null;
  const { points: P, source } = measured;
  const at = (id: number): Vec3 => P[id]!;

  // ── the palm frame ─────────────────────────────────────────────────────────────────────────
  const wrist = at(WRIST_ID);
  const palmVector = sub(at(CHAIN.middle[0]), wrist);
  const palmLength = length(palmVector);
  const yAxis = unit(palmVector);
  if (!yAxis) return null;
  const xAxis = unit(reject(sub(at(CHAIN.index[0]), at(CHAIN.pinky[0])), yAxis));
  if (!xAxis) return null;
  const normal = cross(xAxis, yAxis);

  // ── each long finger: reach, and the diagnostic angles ───────────────────────────────────
  const reach = {} as Record<LongFinger, number>;
  const flexion = {} as Record<LongFinger, [number, number, number]>;
  const rays = {} as Record<LongFinger, Vec3>;
  const curl: [number, number, number, number, number] = [0, 0, 0, 0, 0];
  let palmarEvidence = 0;

  LONG_FINGERS.forEach((finger, i) => {
    const [mcp, pip, dip, tip] = CHAIN[finger];
    const metacarpal = sub(at(mcp), wrist);
    // The finger's own ray: its metacarpal's direction in the palm plane. Metacarpals fan and do not
    // move with the finger, so this is where a straight finger would point.
    const ray = unit(reject(metacarpal, normal)) ?? yAxis;
    rays[finger] = ray;
    const bones = [sub(at(pip), at(mcp)), sub(at(dip), at(pip)), sub(at(tip), at(dip))];
    const chain = length(bones[0]!) + length(bones[1]!) + length(bones[2]!);
    const r = chain > 1e-9 ? dot(sub(at(tip), at(mcp)), ray) / chain : 1;
    reach[finger] = r;
    curl[i + 1] = clamp01((1 - r) / (1 - FIST_REACH));

    const lateral = unit(cross(ray, normal)) ?? xAxis;
    const sagittal = (vector: Vec3): Vec3 => reject(vector, lateral);
    const b0 = sagittal(metacarpal);
    const [b1, b2, b3] = bones.map(sagittal) as [Vec3, Vec3, Vec3];
    flexion[finger] = [angleBetween(b0, b1), angleBetween(b1, b2), angleBetween(b2, b3)];

    // A curled fingertip sits on the palmar side of its knuckle. Weighted by how curled, so a straight
    // finger — whose tip is in the plane — casts no vote.
    palmarEvidence += dot(sub(at(tip), at(mcp)), normal) * curl[i + 1]!;
  });

  // ── the thumb ───────────────────────────────────────────────────────────────────────────────
  const [cmc, tmcp, tip0, ttip] = CHAIN.thumb;
  const thumbBend =
    angleBetween(sub(at(tmcp), at(cmc)), sub(at(tip0), at(tmcp))) +
    angleBetween(sub(at(tip0), at(tmcp)), sub(at(ttip), at(tip0)));
  const thumbReach = palmLength > 1e-9 ? length(sub(at(ttip), at(CHAIN.pinky[0]))) / palmLength : 0;
  /*
   * Thumb curl from its reach, not its bend. Tucked across a fist the tip is about half a palm from the
   * little-finger knuckle; stretched out it is well over one. The bend angle is kept in the palmar
   * vote below only as a weak cue.
   */
  curl[0] = clamp01((1.2 - thumbReach) / 0.7);

  // ── the palmar side ───────────────────────────────────────────────────────────────────────
  palmarEvidence += 1.5 * dot(sub(at(ttip), wrist), normal) + 0.001 * thumbBend;
  const decisive = Math.abs(palmarEvidence) > 0.08 * palmLength;
  const palmNormal: Vec3 | null = decisive ? scale(normal, Math.sign(palmarEvidence)) : null;

  // ── the V between index and middle, over the whole finger ─────────────────────────────────
  const indexLong = reject(sub(at(CHAIN.index[3]), at(CHAIN.index[0])), normal);
  const middleLong = reject(sub(at(CHAIN.middle[3]), at(CHAIN.middle[0])), normal);
  const spread = angleBetween(indexLong, middleLong);
  const tipGap = palmLength > 1e-9 ? length(sub(at(CHAIN.index[3]), at(CHAIN.middle[3]))) / palmLength : 0;
  const spreadWeight = clamp01(Math.min(1 - curl[1], 1 - curl[2]) * 1.6);

  // ── image-space quantities: where the hand is, and which way it points ─────────────────────
  const aspect = input.aspect ?? DEFAULT_ASPECT;
  const image = input.landmarks;
  const anchorIds = [WRIST_ID, CHAIN.index[0], CHAIN.middle[0], CHAIN.ring[0], CHAIN.pinky[0]];
  let ax = 0;
  let ay = 0;
  for (const id of anchorIds) {
    ax += image[id]!.x;
    ay += image[id]!.y;
  }
  const w0 = image[WRIST_ID]!;
  const m0 = image[CHAIN.middle[0]]!;
  const dx = m0.x - w0.x;
  const dy = (m0.y - w0.y) / aspect;
  const palm = Math.hypot(dx, dy);
  const axis = palm > 1e-9 ? { x: dx / palm, y: dy / palm } : { x: 0, y: -1 };

  return {
    anchor: { x: ax / anchorIds.length, y: ay / anchorIds.length },
    palm,
    curl,
    reach,
    flexion,
    thumbReach,
    spread,
    tipGap,
    spreadWeight,
    axis,
    palmNormal,
    facing: Math.abs(normal[2]),
    source
  };
}

/** Mean curl of the four long fingers: one number for "how closed is this hand". */
export const closure = (geometry: HandGeometry): number =>
  (geometry.curl[1] + geometry.curl[2] + geometry.curl[3] + geometry.curl[4]) / 4;
