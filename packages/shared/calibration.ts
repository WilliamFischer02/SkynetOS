/**
 * Calibration: aiming the cameras, and learning how far William actually reaches.
 *
 * William asked for "a full calibration / gesture control interface that prompts me to adjust my
 * webcam angles so they're relatively levelled to each other and my regular hand gestures aren't
 * likely to leave the camera bounds". This is the arithmetic behind those prompts. Every instruction
 * the wizard puts on screen comes from a number measured here, so it can say "raise it a little"
 * with something behind it, and can tell when to stop.
 *
 * Pure, and tested without a camera. The wizard is the only part that needs a hand in front of a
 * lens; the decisions about what to tell you are all here.
 *
 * ── Why a hand and not a checkerboard ────────────────────────────────────────────────────────
 *
 * A checkerboard measures lens geometry, which is what a 3D solve needs (docs/DECISIONS, the
 * dual-camera gate). It is the wrong tool for "are these two cameras pointing at the same piece of
 * air at the same height", because it needs printing, holding flat, and good light, and it tells you
 * nothing about where the user's hands go. A hand is always present, needs no props, and is the
 * thing the rig exists to see. The checkerboard still comes later, for depth.
 */

/** One camera's view of one hand, in that camera's normalised frame coordinates. */
export interface HandObservation {
  camera: string;
  /** Palm centre, 0..1 across the frame. */
  x: number;
  y: number;
  /** Wrist to middle knuckle, as a fraction of frame height. Stands in for distance. */
  span: number;
}

export interface LevelTolerance {
  /** Vertical disagreement allowed between cameras, as a fraction of frame height. */
  dy: number;
  /** How far from the centre of frame the hand may sit. */
  dx: number;
  /** Allowed ratio between the two cameras' apparent hand sizes, as a factor either way. */
  span: number;
}

export const LEVEL_TOLERANCE: LevelTolerance = { dy: 0.08, dx: 0.14, span: 1.25 };

export interface LevelAdvice {
  camera: string;
  ok: boolean;
  /** Signed: positive means this camera sees the hand LOWER in frame than the reference does. */
  dy: number;
  /** Signed: positive means the hand sits right of this frame's centre. */
  dx: number;
  /** This camera's apparent hand size divided by the reference's. Below 1 means further away. */
  spanRatio: number;
  /** What to do, in the order worth doing it. Empty when nothing needs doing. */
  notes: string[];
}

/** "a touch" / "a little" / "a lot", so a prompt can be read at a glance rather than parsed. */
function magnitude(error: number, tolerance: number): string {
  const ratio = Math.abs(error) / tolerance;
  if (ratio < 1.6) return 'a touch';
  if (ratio < 3) return 'a little';
  return 'a lot';
}

/**
 * How to aim `other` so it agrees with `reference`.
 *
 * The vertical axis is the one that matters for "levelled to each other": the two cameras are about
 * ninety degrees apart, so their x axes measure different directions and disagreement there means
 * nothing — but both measure height the same way. A hand that sits high in one frame and low in the
 * other is a pair of cameras at different heights or tilts, whatever else is true.
 */
export function levelAdvice(
  reference: HandObservation,
  other: HandObservation,
  tolerance: LevelTolerance = LEVEL_TOLERANCE
): LevelAdvice {
  const dy = other.y - reference.y;
  const dx = other.x - 0.5;
  const spanRatio = reference.span > 0 ? other.span / reference.span : 0;
  const notes: string[] = [];

  if (Math.abs(dy) > tolerance.dy) {
    // It sees the hand too low, so it is aimed too high.
    notes.push(dy > 0 ? `AIM ${other.camera} DOWN ${magnitude(dy, tolerance.dy)}` : `AIM ${other.camera} UP ${magnitude(dy, tolerance.dy)}`);
  }
  if (Math.abs(dx) > tolerance.dx) {
    notes.push(dx > 0 ? `TURN ${other.camera} RIGHT ${magnitude(dx, tolerance.dx)}` : `TURN ${other.camera} LEFT ${magnitude(dx, tolerance.dx)}`);
  }
  if (spanRatio > 0 && spanRatio < 1 / tolerance.span) {
    notes.push(`${other.camera} IS FURTHER AWAY — move it closer, or expect less detail from it`);
  } else if (spanRatio > tolerance.span) {
    notes.push(`${other.camera} IS CLOSER THAN THE OTHER — move it back a little`);
  }

  return { camera: other.camera, ok: notes.length === 0, dy, dx, spanRatio, notes };
}

export interface Bounds {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

/** The box a set of observed points fills. Null for no points, rather than an empty box at 0,0. */
export function boundsOf(points: readonly { x: number; y: number }[]): Bounds | null {
  if (!points.length) return null;
  let minX = 1;
  let maxX = 0;
  let minY = 1;
  let maxY = 0;
  for (const point of points) {
    minX = Math.min(minX, point.x);
    maxX = Math.max(maxX, point.x);
    minY = Math.min(minY, point.y);
    maxY = Math.max(maxY, point.y);
  }
  return { minX, maxX, minY, maxY };
}

/** The mapping the pointer uses: normalised camera coordinates in, viewport fraction out. */
export interface Region {
  x0: number;
  x1: number;
  y0: number;
  y1: number;
}

/** Where a reach ran out of the picture. */
export type ClippedEdge = 'left' | 'right' | 'top' | 'bottom';

export interface ReachVerdict {
  ok: boolean;
  /** Edges the hand reached, meaning the working volume is bigger than the camera can see. */
  clipped: ClippedEdge[];
  /** The region to map to the screen, derived from the reach actually observed. */
  region: Region;
  notes: string[];
}

/** Below this much of the frame, a reach is too small to steer a screen with. */
const MIN_SPAN = 0.18;
/** Within this of an edge counts as having hit it: landmarks are worst at the frame border. */
const EDGE = 0.04;

/**
 * Turn an observed reach into the pointer's mapping, and say what is wrong with it.
 *
 * The mapping used to be a hardcoded middle 64% of the frame, which is a guess about where a person
 * moves their hand. This replaces the guess with the answer: William sweeps the corners of what is
 * comfortable, and that box becomes the screen. A reach that touches the frame edge is reported
 * rather than silently clamped, because the fix is physical — move the camera back — and no amount
 * of arithmetic here can recover a hand that left the picture.
 */
export function reachVerdict(bounds: Bounds | null): ReachVerdict {
  const fallback: Region = { x0: 0.18, x1: 0.82, y0: 0.15, y1: 0.85 };
  if (!bounds) {
    return { ok: false, clipped: [], region: fallback, notes: ['NO REACH RECORDED — move your hand around the area you want to use'] };
  }

  const clipped: ClippedEdge[] = [];
  if (bounds.minX <= EDGE) clipped.push('left');
  if (bounds.maxX >= 1 - EDGE) clipped.push('right');
  if (bounds.minY <= EDGE) clipped.push('top');
  if (bounds.maxY >= 1 - EDGE) clipped.push('bottom');

  const notes: string[] = [];
  if (clipped.length) {
    notes.push(`YOUR REACH RUNS OFF THE ${clipped.map((edge) => edge.toUpperCase()).join(' AND ')} — move the camera back, or work in a smaller area`);
  }

  const width = bounds.maxX - bounds.minX;
  const height = bounds.maxY - bounds.minY;
  if (width < MIN_SPAN || height < MIN_SPAN) {
    notes.push('THAT IS A VERY SMALL AREA — small hand movements will jump a long way on screen');
  }

  /*
   * A hair inside the observed reach, so the very edge of the screen is reachable without stretching
   * to the exact limit of what was recorded.
   *
   * Only a DEGENERATE axis is widened, and only about its own centre. The first version clamped
   * every axis towards the middle of frame — `min(0.45, …)` and `max(0.55, …)` — which quietly
   * rewrote honest recordings: on 2026-09-12 a camera that legitimately saw the whole sweep in the
   * right-hand half of its frame came back with `x0: 0.45`, a mapping nobody had made.
   */
  const inset = 0.01;
  const axis = (lo: number, hi: number): [number, number] => {
    const a = Math.max(0, lo + inset);
    const b = Math.min(1, hi - inset);
    if (b - a >= MIN_SPAN) return [a, b];
    const middle = Math.min(1 - MIN_SPAN / 2, Math.max(MIN_SPAN / 2, (a + b) / 2));
    return [middle - MIN_SPAN / 2, middle + MIN_SPAN / 2];
  };
  const [x0, x1] = axis(bounds.minX, bounds.maxX);
  const [y0, y1] = axis(bounds.minY, bounds.maxY);
  const region: Region = { x0, x1, y0, y1 };

  return { ok: notes.length === 0, clipped, region, notes };
}

export interface CameraCalibration {
  label: string;
  /** The mapping derived from the observed reach. */
  region: Region;
  /** Where the hand sat in this frame during the level check, for the record. */
  level?: { dy: number; dx: number; spanRatio: number };
  /**
   * Whether this camera hands over a mirror image, MEASURED in the AIM phase from a movement to his
   * right. Absent means it was never measured and DEFAULT_MIRRORED stands. See hand-roles.ts.
   */
  mirrored?: boolean;
}

export interface CalibrationProfile {
  version: 1;
  capturedAt: string;
  /** The camera whose view drives the pointer. */
  driver: string;
  cameras: CameraCalibration[];
  /** Gestures that were re-captured in this pass, by id, so the wizard can report what it did. */
  refreshed?: string[];
  /**
   * Swap the landmarker's handedness labels on this rig. A correction to the MODEL's convention, set by
   * the SWAP L/R buttons; it has nothing to do with whether a camera mirrors, which is measured per
   * camera. See the correction note in hand-roles.ts.
   */
  labelsSwapped?: boolean;
}

/**
 * Is it worth offering the sequence again?
 *
 * William wants it offered on first boot and on wake, every time — so this is not a gate on whether
 * the wizard may run, it is what the prompt SAYS: whether there is no profile at all, whether the
 * one there is has gone stale, or whether the cameras on the desk are not the ones it was made with.
 * A camera that has been unplugged and moved is the single most likely reason a working rig stops
 * working, and it is invisible until something is measured.
 */
export function calibrationState(
  profile: CalibrationProfile | null,
  cameras: readonly string[],
  now: Date,
  maxAgeHours = 24 * 14
): { state: 'none' | 'stale' | 'cameras-changed' | 'ready'; note: string } {
  if (!profile) return { state: 'none', note: 'The cameras have never been calibrated.' };

  const known = new Set(profile.cameras.map((camera) => camera.label));
  const missing = cameras.filter((label) => !known.has(label));
  if (missing.length || known.size !== cameras.length) {
    return {
      state: 'cameras-changed',
      note: `The cameras are not the ones this was calibrated with (${missing.join(', ') || 'one is missing'}).`
    };
  }

  const ageHours = (now.getTime() - new Date(profile.capturedAt).getTime()) / 3_600_000;
  if (!Number.isFinite(ageHours) || ageHours > maxAgeHours) {
    return { state: 'stale', note: `Last calibrated ${Math.round(ageHours / 24)} days ago.` };
  }
  return { state: 'ready', note: `Calibrated ${ageHours < 1 ? 'less than an hour' : `${Math.round(ageHours)} hours`} ago.` };
}

/** A profile read off disk, made safe: a hand-edited region must not invert the pointer. */
export function sanitiseCalibration(raw: unknown): CalibrationProfile | null {
  const source = (raw ?? {}) as Partial<CalibrationProfile>;
  if (source.version !== 1 || !Array.isArray(source.cameras) || typeof source.capturedAt !== 'string') return null;
  const number = (value: unknown, fallback: number): number =>
    typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1 ? value : fallback;
  const cameras: CameraCalibration[] = [];
  for (const entry of source.cameras) {
    const camera = entry as Partial<CameraCalibration>;
    if (typeof camera.label !== 'string') continue;
    const region = (camera.region ?? {}) as Partial<Region>;
    const x0 = number(region.x0, 0.18);
    const x1 = number(region.x1, 0.82);
    const y0 = number(region.y0, 0.15);
    const y1 = number(region.y1, 0.85);
    // An inverted or zero-width region would make the pointer run backwards or not at all.
    if (x1 - x0 < 0.05 || y1 - y0 < 0.05) continue;
    cameras.push({
      label: camera.label,
      region: { x0, x1, y0, y1 },
      ...(typeof camera.mirrored === 'boolean' ? { mirrored: camera.mirrored } : {})
    });
  }
  if (!cameras.length) return null;
  return {
    version: 1,
    capturedAt: source.capturedAt,
    driver: typeof source.driver === 'string' && cameras.some((c) => c.label === source.driver) ? source.driver : cameras[0]!.label,
    cameras,
    ...(Array.isArray(source.refreshed) ? { refreshed: source.refreshed.filter((id) => typeof id === 'string') } : {}),
    /*
     * The label correction, and its two earlier spellings from the same day. `swapHands: true` and a
     * profile-level `mirrored: true` both meant "take the label as reported"; `mirrored: false` meant
     * "swap it". Neither says anything about a camera's geometry, which is never inferred from them.
     */
    ...(typeof source.labelsSwapped === 'boolean'
      ? { labelsSwapped: source.labelsSwapped }
      : typeof (source as { mirrored?: unknown }).mirrored === 'boolean'
        ? { labelsSwapped: !(source as { mirrored: boolean }).mirrored }
        : {})
  };
}
