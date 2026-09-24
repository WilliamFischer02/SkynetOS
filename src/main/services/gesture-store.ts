import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { app } from 'electron';
import {
  EMPTY_LIBRARY,
  MIN_SAMPLES,
  featuresPlausible,
  freeGestureId,
  isVariant,
  handsOf,
  judgeSample,
  modeOf,
  libraryHealth,
  nameIsFree,
  normaliseGestureName,
  sanitiseLibrary,
  withBuiltIns,
  type FrameCount,
  type GestureDefinition,
  type HandMode,
  type GestureLibrary,
  type GestureSample,
  type LibraryHealth,
  type SampleVariant,
  type SampleVerdict,
  type SaveGestureInput
} from '@shared/gesture-library.js';
import { analyseLibrary, tunedLibrary, type Analysis } from '@shared/gesture-analysis.js';
import { sanitiseCalibration, type CalibrationProfile } from '@shared/calibration.js';

/**
 * Where trained gestures and the camera calibration live.
 *
 * `userData/gestures.json` and `userData/gesture-calibration.json`, NOT the repo:
 *
 *   - the repo is public, and these are recordings of William's hands. Normalised landmark vectors
 *     are not pictures, but they are still biometric-shaped data about one person's body, and they
 *     have no business in a public git history;
 *   - calibration describes THIS desk — which camera is where — so it is per-machine like
 *     `boot.vbs` and `window-state.json`, and would be wrong on the laptop;
 *   - and both are the user's, so they must be editable and deletable without a build step.
 *
 * NO IMAGES ARE EVER WRITTEN. William: "make sure no images or data is recorded until the user
 * clicks on onscreen prompt". The stronger rule this file keeps is that no frame, still or video is
 * written at any point, by anything. A sample is 42 numbers, and it only arrives here because the
 * wizard was pressed.
 */

/** More than this per gesture is hoarding: the oldest goes, so a re-train improves rather than grows. */
const MAX_SAMPLES = 12;

let library: GestureLibrary | null = null;
let calibration: CalibrationProfile | null | undefined;

const dir = (): string => app.getPath('userData');
const libraryFile = (): string => join(dir(), 'gestures.json');
const calibrationFile = (): string => join(dir(), 'gesture-calibration.json');

/** Written to a temporary file and renamed: a crash mid-write must not leave a half-written file. */
function writeJson(file: string, value: unknown): void {
  mkdirSync(dir(), { recursive: true });
  const temporary = `${file}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  renameSync(temporary, file);
}

export function gestureLibrary(): GestureLibrary {
  if (library) return library;
  const file = libraryFile();
  if (!existsSync(file)) {
    // First run: the built-in vocabulary, untrained. Nothing fires until it has examples.
    library = withBuiltIns(EMPTY_LIBRARY);
    return library;
  }
  try {
    library = sanitiseLibrary(JSON.parse(readFileSync(file, 'utf8')));
  } catch (err) {
    console.error(`[gestures] ${file} is malformed (${(err as Error).message}) — starting from the built-ins`);
    library = withBuiltIns(EMPTY_LIBRARY);
  }
  return library;
}

function commit(next: GestureLibrary): GestureLibrary {
  library = next;
  try {
    writeJson(libraryFile(), next);
  } catch (err) {
    console.error(`[gestures] could not write ${libraryFile()}: ${(err as Error).message}`);
  }
  return next;
}

/**
 * Create or rename a gesture. Never touches its samples: training adds those, one click at a time.
 */
export function saveGesture(input: SaveGestureInput): { ok: boolean; library: GestureLibrary; id?: string; error?: string } {
  const current = gestureLibrary();
  const name = normaliseGestureName(String(input.name ?? ''));
  if (!name) return { ok: false, library: current, error: 'A GESTURE NEEDS A NAME' };
  if (!nameIsFree(name, current, input.id)) return { ok: false, library: current, error: `THERE IS ALREADY A GESTURE CALLED ${name}` };

  const utterance = String(input.utterance ?? '').trim().slice(0, 120);
  const patch = {
    name,
    utterance,
    ...(typeof input.threshold === 'number' && input.threshold > 0 && input.threshold < 2 ? { threshold: input.threshold } : {}),
    ...(typeof input.dwellMs === 'number' && input.dwellMs >= 0 && input.dwellMs <= 5000 ? { dwellMs: input.dwellMs } : {}),
    ...(input.disabled === true ? { disabled: true as const } : {})
  };

  if (input.id) {
    const existing = current.gestures.find((gesture) => gesture.id === input.id);
    if (!existing) return { ok: false, library: current, error: `NO GESTURE CALLED ${input.id}` };
    const updated: GestureDefinition = { ...existing, ...patch };
    if (input.disabled !== true) delete updated.disabled;
    return {
      ok: true,
      id: existing.id,
      library: commit({ ...current, gestures: current.gestures.map((gesture) => (gesture.id === existing.id ? updated : gesture)) })
    };
  }

  const frames: FrameCount = input.frames === 2 ? 2 : input.frames === 3 ? 3 : 1;
  const id = freeGestureId(current, name);
  const created: GestureDefinition = {
    id,
    samples: [],
    createdAt: new Date().toISOString(),
    frames,
    // One keyframe is a pose held; more than one is a movement performed. `motion` — a pose plus
    // travel, like a drag — is reserved for the built-ins, which the tracker implements directly.
    kind: frames === 1 ? 'posture' : 'sequence',
    ...patch
  };
  return { ok: true, id, library: commit({ ...current, gestures: [...current.gestures, created] }) };
}

/**
 * William's own catalogue, so his click is the approval docs/07 asks for.
 *
 * A built-in cannot be deleted, because it would come back on the next launch — `withBuiltIns` runs
 * on every read. Offering a delete that silently undoes itself would be a lie, so the catalogue
 * offers OFF for those instead, which is what he actually wants when he reaches for delete.
 */
export function deleteGesture(id: string): { ok: boolean; library: GestureLibrary; error?: string } {
  const current = gestureLibrary();
  const target = current.gestures.find((gesture) => gesture.id === id);
  if (!target) return { ok: false, library: current };
  if (target.builtIn) {
    return { ok: false, library: current, error: `${target.name} IS BUILT IN — SWITCH IT OFF INSTEAD` };
  }
  return { ok: true, library: commit({ ...current, gestures: current.gestures.filter((gesture) => gesture.id !== id) }) };
}

export interface AddSampleInput {
  gestureId: string;
  /** One vector per keyframe, in order, for the main hand. A posture has one; a movement two or three. */
  keyframes: number[][];
  /** The second hand, for a two-handed gesture. Same length as `keyframes` or it is not kept. */
  offhand?: number[][];
  /** Where the hand was at each keyframe. Kept only if there is one point per keyframe. */
  path?: { x: number; y: number }[];
  /** Pose features per keyframe (seven numbers each), which is what sharpens the geometric model. */
  pose?: number[][];
  camera?: string;
  /** Which alternative take this is: the deliberately sloppy one, the angled one, the left hand. */
  variant?: SampleVariant;
}

/**
 * Keep the newest examples, but never let the variants crowd out the clean ones.
 *
 * Without this, recording four alternative takes on a gesture already at its cap would push every
 * clean example out, and the gesture would end up defined entirely by deliberately poor
 * performances of itself.
 */
function trimSamples(samples: GestureSample[]): GestureSample[] {
  if (samples.length <= MAX_SAMPLES) return samples;
  const clean = samples.filter((sample) => !sample.variant);
  const varied = samples.filter((sample) => sample.variant);
  const keepClean = Math.min(clean.length, Math.max(MIN_SAMPLES, MAX_SAMPLES - varied.length));
  const kept = new Set([
    ...clean.slice(-keepClean).map((sample) => sample.id),
    ...varied.slice(-Math.max(0, MAX_SAMPLES - keepClean)).map((sample) => sample.id)
  ]);
  return samples.filter((sample) => kept.has(sample.id));
}

/**
 * One training example, judged before it is kept.
 *
 * The verdict goes back to the wizard so it can say why a capture was refused while the hand is
 * still up — "too close to your FIST", "change the angle a little" — which is the only moment that
 * advice is any use.
 */
export function addGestureSample(input: AddSampleInput): {
  ok: boolean;
  verdict: SampleVerdict;
  library: GestureLibrary;
  count: number;
  needed: number;
  sampleId?: string;
} {
  const current = gestureLibrary();
  const gesture = current.gestures.find((entry) => entry.id === input.gestureId);
  if (!gesture) {
    return {
      ok: false,
      verdict: { ok: false, reason: `NO GESTURE CALLED ${input.gestureId}` },
      library: current,
      count: 0,
      needed: MIN_SAMPLES
    };
  }
  const keyframes = Array.isArray(input.keyframes) ? input.keyframes.filter(featuresPlausible) : [];
  const offhand = Array.isArray(input.offhand) ? input.offhand.filter(featuresPlausible) : [];
  const short = keyframes.length !== gesture.frames;
  /*
   * A two-handed gesture needs both hands in every keyframe. Refused rather than downgraded to a
   * one-handed recording, because a zoom described by one hand is not a quieter recording of a
   * zoom — it is a recording of something else entirely.
   */
  if (!short && handsOf(gesture) === 2 && offhand.length !== gesture.frames) {
    return {
      ok: false,
      verdict: { ok: false, reason: `${gesture.name} NEEDS BOTH HANDS — only one was in shot` },
      library: current,
      count: gesture.samples.length,
      needed: Math.max(0, MIN_SAMPLES - gesture.samples.length)
    };
  }
  // Judge the take on its FIRST keyframe: that is the shape that has to be distinguishable from
  // every other gesture's opening, and the one a near-duplicate wastes.
  const verdict: SampleVerdict = short
    ? { ok: false, reason: `THAT TAKE HAD ${keyframes.length} OF ${gesture.frames} KEYFRAMES — start again` }
    : judgeSample(keyframes[0] ?? [], gesture, current, 0);
  if (!verdict.ok) {
    return { ok: false, verdict, library: current, count: gesture.samples.length, needed: Math.max(0, MIN_SAMPLES - gesture.samples.length) };
  }

  const sample: GestureSample = {
    id: `s_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
    keyframes,
    capturedAt: new Date().toISOString(),
    ...(offhand.length === gesture.frames ? { offhand } : {}),
    ...(Array.isArray(input.path) && input.path.length === gesture.frames ? { path: input.path } : {}),
    ...(Array.isArray(input.pose) &&
    input.pose.length === gesture.frames &&
    input.pose.every((vector) => Array.isArray(vector) && vector.length === 7 && vector.every(Number.isFinite))
      ? { pose: input.pose }
      : {}),
    ...(input.camera ? { camera: String(input.camera).slice(0, 60) } : {}),
    ...(isVariant(input.variant) && input.variant !== 'clean' ? { variant: input.variant } : {})
  };
  /*
   * Oldest first out — but never at the cost of the clean examples. A gesture whose cap was filled
   * with variants would have nothing left describing the gesture done properly, which is the one
   * shape that has to match: the variants widen a boundary, they do not define a centre.
   */
  const samples = trimSamples([...gesture.samples, sample]);
  const updated: GestureDefinition = { ...gesture, samples };
  const next = commit({ ...current, gestures: current.gestures.map((entry) => (entry.id === gesture.id ? updated : entry)) });
  return {
    ok: true,
    verdict,
    library: next,
    count: samples.length,
    needed: Math.max(0, MIN_SAMPLES - samples.length),
    sampleId: sample.id
  };
}

/**
 * Throw away every example of one gesture and start it again.
 *
 * William, 2026-09-11: "A retry captures button within the training / calibration process should be
 * available per gesture." A retry has to be all-or-nothing rather than one-more-on-top, because the
 * reason to reach for it is that the last set was wrong — and adding good examples to bad ones
 * leaves a class straddling both, which recognises neither.
 *
 * This destroys recordings, so it is only reachable from the wizard, behind its own button, on the
 * gesture named on the screen at the time. docs/07: destruction is allowed when the click that
 * asks for it IS the approval and names what it destroys.
 */
export function resetGestureSamples(gestureId: string): { ok: boolean; library: GestureLibrary; error?: string } {
  const current = gestureLibrary();
  const gesture = current.gestures.find((entry) => entry.id === gestureId);
  if (!gesture) return { ok: false, library: current, error: `NO GESTURE CALLED ${gestureId}` };
  console.log(`[gestures] ${gesture.name}: dropped all ${gesture.samples.length} example(s) on a retry`);
  return {
    ok: true,
    library: commit({
      ...current,
      gestures: current.gestures.map((entry) => (entry.id === gestureId ? { ...entry, samples: [] } : entry))
    })
  };
}

/** Remove one example: the one whose thumbnail the wizard is showing, or one the audit condemned. */
export function dropGestureSample(
  gestureId: string,
  sampleId: string
): { ok: boolean; library: GestureLibrary; error?: string } {
  const current = gestureLibrary();
  const gesture = current.gestures.find((entry) => entry.id === gestureId);
  if (!gesture) return { ok: false, library: current, error: `NO GESTURE CALLED ${gestureId}` };
  if (!gesture.samples.some((sample) => sample.id === sampleId)) {
    return { ok: false, library: current, error: 'THAT EXAMPLE IS ALREADY GONE' };
  }
  return {
    ok: true,
    library: commit({
      ...current,
      gestures: current.gestures.map((entry) =>
        entry.id === gestureId ? { ...entry, samples: entry.samples.filter((sample) => sample.id !== sampleId) } : entry
      )
    })
  };
}

/**
 * Change how many keyframes a gesture is made of.
 *
 * Every existing example is discarded, because it has to be: a two-keyframe recording cannot answer
 * what the third keyframe looked like, and padding one would invent a pose that was never made. The
 * caller is told how many it destroyed, so the button can say so before it is pressed.
 */
export function setGestureFrames(
  gestureId: string,
  frames: FrameCount
): { ok: boolean; library: GestureLibrary; dropped: number; error?: string } {
  const current = gestureLibrary();
  const gesture = current.gestures.find((entry) => entry.id === gestureId);
  if (!gesture) return { ok: false, library: current, dropped: 0, error: `NO GESTURE CALLED ${gestureId}` };
  const wanted: FrameCount = frames === 2 ? 2 : frames === 3 ? 3 : 1;
  if (wanted === gesture.frames) return { ok: true, library: current, dropped: 0 };
  const prompts = (gesture.prompts ?? []).slice(0, wanted);
  const updated: GestureDefinition = {
    ...gesture,
    frames: wanted,
    kind: gesture.kind === 'motion' ? 'motion' : wanted === 1 ? 'posture' : 'sequence',
    samples: [],
    ...(prompts.length ? { prompts } : {})
  };
  console.log(
    `[gestures] ${gesture.name}: ${gesture.frames} -> ${wanted} keyframes, ${gesture.samples.length} example(s) discarded`
  );
  return {
    ok: true,
    dropped: gesture.samples.length,
    library: commit({ ...current, gestures: current.gestures.map((entry) => (entry.id === gestureId ? updated : entry)) })
  };
}

/**
 * One hand or two.
 *
 * William, 2026-09-12: "Each training should have a toggle option that designates the gesture as
 * two-hand or one-hand." Like the keyframe count, changing it discards the examples — a one-handed
 * recording cannot answer what the second hand was doing, and inventing one would be worse than
 * having none.
 */
export function setGestureMode(
  gestureId: string,
  mode: HandMode
): { ok: boolean; library: GestureLibrary; dropped: number; error?: string } {
  const current = gestureLibrary();
  const gesture = current.gestures.find((entry) => entry.id === gestureId);
  if (!gesture) return { ok: false, library: current, dropped: 0, error: `NO GESTURE CALLED ${gestureId}` };
  const wanted: HandMode = mode === 'two' || mode === 'both' ? mode : 'one';
  if (wanted === modeOf(gesture)) return { ok: true, library: current, dropped: 0 };
  /*
   * Examples go, and they have to. A one-handed recording cannot say what the second hand was
   * doing, and a `two` recording relabelled `both` would claim the hands were mirroring each other
   * when they were doing different things. Either way the stored numbers would be describing a
   * gesture that was never performed.
   */
  const updated: GestureDefinition = { ...gesture, samples: [], mode: wanted };
  delete updated.hands;
  console.log(`[gestures] ${gesture.name}: now ${wanted}, ${gesture.samples.length} example(s) discarded`);
  return {
    ok: true,
    dropped: gesture.samples.length,
    library: commit({ ...current, gestures: current.gestures.map((entry) => (entry.id === gestureId ? updated : entry)) })
  };
}

/** Whether a gesture is a travel gesture: two points in frame rather than two hand shapes. */
export function setGestureTravel(
  gestureId: string,
  travel: boolean
): { ok: boolean; library: GestureLibrary; error?: string } {
  const current = gestureLibrary();
  const gesture = current.gestures.find((entry) => entry.id === gestureId);
  if (!gesture) return { ok: false, library: current, error: `NO GESTURE CALLED ${gestureId}` };
  const updated: GestureDefinition = { ...gesture, ...(travel ? { travel: true } : {}) };
  // Examples survive this one: every sample already records where the hand was, so turning travel
  // on reads something that was measured all along rather than asking for it to be measured again.
  if (!travel) delete updated.travel;
  return {
    ok: true,
    library: commit({ ...current, gestures: current.gestures.map((entry) => (entry.id === gestureId ? updated : entry)) })
  };
}

/** Leave-one-out accuracy, per-gesture separation, and the thresholds the data asks for. */
export function gestureAnalysis(): Analysis {
  return analyseLibrary(gestureLibrary());
}

/**
 * Write the fitted thresholds into the catalogue: the step where the training data changes the
 * recogniser rather than merely describing it.
 */
export function tuneGestureLibrary(): {
  ok: boolean;
  library: GestureLibrary;
  changed: { name: string; from: number; to: number }[];
  before: number;
  after: number;
  note: string;
} {
  const result = tunedLibrary(gestureLibrary());
  if (!result.changed.length) {
    return { ok: true, library: result.library, changed: [], before: result.before, after: result.after, note: result.note };
  }
  for (const change of result.changed) {
    console.log(`[gestures] tuned ${change.name}: ${change.from} -> ${change.to}`);
  }
  return {
    ok: true,
    library: commit(result.library),
    changed: result.changed,
    before: result.before,
    after: result.after,
    note: result.note
  };
}

/** The audit, run against what is on disk right now. */
export function gestureHealthReport(): LibraryHealth {
  return libraryHealth(gestureLibrary());
}

/**
 * Drop every example the audit condemned, and nothing else.
 *
 * This is the answer to "training broke the whole feature": the damage is findable, it is named,
 * and it is undone in one click without touching a gesture that is behaving.
 */
export function repairGestureLibrary(): { ok: boolean; library: GestureLibrary; dropped: number; note: string } {
  const current = gestureLibrary();
  const report = libraryHealth(current);
  if (!report.drop.length) return { ok: true, library: current, dropped: 0, note: report.note };
  const condemned = new Map<string, Set<string>>();
  for (const item of report.drop) {
    const set = condemned.get(item.gestureId) ?? new Set<string>();
    set.add(item.sampleId);
    condemned.set(item.gestureId, set);
  }
  const gestures = current.gestures.map((gesture) => {
    const set = condemned.get(gesture.id);
    if (!set) return gesture;
    console.log(`[gestures] repair: ${gesture.name} loses ${set.size} example(s) that would be misread`);
    return { ...gesture, samples: gesture.samples.filter((sample) => !set.has(sample.id)) };
  });
  return {
    ok: true,
    dropped: report.drop.length,
    library: commit({ ...current, gestures }),
    note: `Dropped ${report.drop.length} example${report.drop.length === 1 ? '' : 's'}.`
  };
}

export function gestureCalibration(): CalibrationProfile | null {
  if (calibration !== undefined) return calibration;
  const file = calibrationFile();
  if (!existsSync(file)) {
    calibration = null;
    return calibration;
  }
  try {
    calibration = sanitiseCalibration(JSON.parse(readFileSync(file, 'utf8')));
  } catch (err) {
    console.error(`[gestures] ${file} is malformed (${(err as Error).message}) — ignoring it`);
    calibration = null;
  }
  return calibration;
}

export function saveCalibration(profile: unknown): { ok: boolean; error?: string } {
  const clean = sanitiseCalibration(profile);
  if (!clean) return { ok: false, error: 'THAT IS NOT A USABLE CALIBRATION' };
  calibration = clean;
  try {
    writeJson(calibrationFile(), clean);
    console.log(`[gestures] calibration saved: driver ${clean.driver}, ${clean.cameras.length} camera(s)`);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: `COULD NOT WRITE ${calibrationFile()} — ${(err as Error).message}` };
  }
}

/** Forget the caches, so a hand-edited file is picked up without a restart. */
export function reloadGestureStore(): void {
  library = null;
  calibration = undefined;
}
