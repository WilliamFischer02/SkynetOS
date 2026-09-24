/**
 * The vision page: cameras in, gestures out.
 *
 * Served from `skynet://vision` with its own CSP and its own session (src/main/services/vision.ts).
 * It is the only page in SkynetOS that opens a camera, and the only one main will accept
 * `vision:report` and `vision:events` from — every other channel is refused to it, so a page that
 * is allowed near a webcam cannot also edit the board.
 *
 * What it sends is EVENTS, not landmarks. 21 points per hand per frame at 26 fps would be tens of
 * kilobytes a second of IPC for the board to re-derive what is already known here, and it would put
 * raw camera geometry into the window holding the board. The board is told "a pinch closed at this
 * point", which is all it can act on.
 *
 * Two deliberate limits in this first pass:
 *   - ONE camera drives. The second is tracked so its frame rate and hand presence are reported and
 *     so the pair is proven to run in-app, but depth needs the extrinsic calibration that is not
 *     written yet. Until it is, push-and-pull gestures (descend and ascend) stay out of the
 *     vocabulary rather than being faked from a single view.
 *   - The loop is a TIMER, never requestAnimationFrame. Presentation stops when this window is not
 *     in front, and stops altogether if it is hidden (`gesture.preview: false`) — measured, and it
 *     cost an evening once already.
 *
 * The window itself is the monitor William asked for: both angles scaled down for display, the
 * detected gesture in text, and an outline on whichever camera can see a hand. The streams stay at
 * 720p and the landmarker sees that full resolution; only the display is small.
 */

import { FilesetResolver, GestureRecognizer, HandLandmarker } from '@mediapipe/tasks-vision';
import { classifyPose, type Hand } from '@shared/gesture.js';
import { createControl, type ControlEvent, type GestureControl, type HandObservation } from '@shared/gesture-control.js';
import { EMPTY_LIBRARY, withBuiltIns } from '@shared/gesture-library.js';
import { judgeFrame, statsFromLuma, type FrameVerdict } from '@shared/frame-quality.js';
import type { RawSide } from '@shared/hand-roles.js';
import type { VisionCamera, VisionPhase, VisionReport } from '@shared/vision.js';
import { createWizard, type Wizard } from './vision-train.js';

const params = new URLSearchParams(window.location.search);
const HAND_COUNT = Math.min(2, Math.max(1, Number(params.get('hands')) || 2));
const DELEGATE = params.get('delegate') === 'CPU' ? 'CPU' : 'GPU';
/**
 * `?mode=train` turns this page into the calibration and training wizard (vision-train.ts). While
 * it is up NO gesture events are sent to the board: a hand being taught a gesture must not also be
 * dragging nodes around behind the wizard.
 */
const TRAINING = params.get('mode') === 'train';
const WANTED = (params.get('cameras') ?? '')
  .split(',')
  .map((name) => name.trim().toLowerCase())
  .filter(Boolean);

/** 720p: measured as the best trade tonight — 1080p also holds, but hand landmarks gain nothing. */
const WIDTH = 1280;
const HEIGHT = 720;
/** ~50 Hz, so a 30 fps camera is never waiting on the loop, and idle ticks cost nothing. */
const TICK_MS = 20;
/** Events are flushed in batches, coalescing cursor moves: only the last position matters. */
const FLUSH_MS = 50;
const REPORT_MS = 500;

const logEl = document.getElementById('log') as HTMLDivElement;
const viewsEl = document.getElementById('views') as HTMLDivElement;
const rateEl = document.getElementById('rate') as HTMLSpanElement;
const gestureEl = document.getElementById('gesture') as HTMLDivElement;

/** Errors only. Anything else belongs on the rate line, so the window stays a monitor. */
const log = (line: string): void => {
  logEl.textContent = line;
  console.info(`[vision] ${line}`);
};

/**
 * What the window says it can see. William: "display a text of the detected gesture whenever the
 * program is detecting a gesture" — so the pose when there is one, and plainly nothing when not,
 * because a monitor that always claims to see something is no use for telling whether it does.
 */
const showGesture = (text: string | null): void => {
  gestureEl.textContent = text ?? 'no hand';
  gestureEl.classList.toggle('idle', !text);
};

interface Cam {
  label: string;
  video: HTMLVideoElement;
  /** The last exposure and focus verdict for this camera's picture. */
  quality?: FrameVerdict;
  /** Its box in the monitor, outlined while that camera has a hand in view. */
  view: HTMLDivElement;
  /**
   * The engine for this camera. The GestureRecognizer when its bundle loads — landmarks, world
   * landmarks and Google's pre-trained gesture scores in one inference — and the plain HandLandmarker
   * when it does not. Exactly one is set on a working camera.
   */
  recognizer: GestureRecognizer | null;
  landmarker: HandLandmarker | null;
  /** Strictly increasing timestamps: VIDEO mode refuses anything else. */
  stamp: number;
  lastTime: number;
  frames: number;
  fps: number;
  seeing: boolean;
  error?: string;
}

/*
 * Two canvases, shared by every camera.
 *
 *  - `sample` is 64x36 and exists to measure the picture: mean brightness, clipping and local
 *    detail. Reading a million pixels a frame would cost more than the landmarking does; a small
 *    grid answers an exposure question perfectly well.
 *  - `analysis` is full size and is used ONLY when the picture needs correcting. The landmarker
 *    then sees a brightened, contrast-stretched frame while the preview keeps showing the raw feed
 *    — because a preview that silently fixes itself hides the very problem the user has to solve.
 */
const sample = document.createElement('canvas');
sample.width = 64;
sample.height = 36;
const sampleCtx = sample.getContext('2d', { willReadFrequently: true });
const analysis = document.createElement('canvas');
analysis.width = WIDTH;
analysis.height = HEIGHT;
const analysisCtx = analysis.getContext('2d');

/** Measure one camera's picture, and say what to do about it. */
function inspect(video: HTMLVideoElement): FrameVerdict | null {
  if (!sampleCtx || video.readyState < 2) return null;
  sampleCtx.drawImage(video, 0, 0, sample.width, sample.height);
  const { data } = sampleCtx.getImageData(0, 0, sample.width, sample.height);
  const luma = new Float32Array(sample.width * sample.height);
  for (let i = 0; i < luma.length; i++) {
    const at = i * 4;
    // Rec. 601 luma, which is what a camera's own exposure is judged on.
    luma[i] = (0.299 * (data[at] ?? 0) + 0.587 * (data[at + 1] ?? 0) + 0.114 * (data[at + 2] ?? 0)) / 255;
  }
  return judgeFrame(statsFromLuma(luma, sample.width, sample.height));
}

/*
 * A cropped picture of the hand, for the wizard's keyframe strip.
 *
 * ── Why this is allowed, given the consent rule ───────────────────────────────────────────────
 *
 * William, 2026-09-12: "make sure no images or data is recorded until the user clicks on onscreen
 * prompt", and 2026-09-11: "it should show a cropped screenshot of the hand for each keyframe it's
 * attempting to capture."
 *
 * Both, at once, and the distinction is the word RECORDED. This returns a data URL held in a page
 * that is about to be thrown away. It is never written to disk, never sent over IPC, never put in
 * the library — `gesture:addSample` takes 42 numbers per keyframe and has no field that could
 * carry a picture. And it is only ever called from inside a capture the user started by pressing a
 * button, on the keyframe that capture just banked.
 *
 * It exists because a number cannot tell him what went wrong. "Example refused, too edge-on" is
 * true and useless; a thumbnail of his own hand at the moment of the shutter is the whole answer.
 */
const crop = document.createElement('canvas');
const cropCtx = crop.getContext('2d');

function snapshotHand(video: HTMLVideoElement, hand: Hand, mirrored: boolean): string | null {
  if (!cropCtx || video.readyState < 2 || !hand.length) return null;
  let minX = 1;
  let maxX = 0;
  let minY = 1;
  let maxY = 0;
  for (const point of hand) {
    minX = Math.min(minX, point.x);
    maxX = Math.max(maxX, point.x);
    minY = Math.min(minY, point.y);
    maxY = Math.max(maxY, point.y);
  }
  // A quarter of the hand's own size as breathing room, so the crop shows the wrist and the
  // fingertips rather than clipping the two things that decide most gestures.
  const padX = Math.max(0.04, (maxX - minX) * 0.25);
  const padY = Math.max(0.04, (maxY - minY) * 0.25);
  const x0 = Math.max(0, minX - padX);
  const y0 = Math.max(0, minY - padY);
  const x1 = Math.min(1, maxX + padX);
  const y1 = Math.min(1, maxY + padY);
  const w = (x1 - x0) * WIDTH;
  const h = (y1 - y0) * HEIGHT;
  if (!(w > 8 && h > 8)) return null;
  const side = 96;
  crop.width = side;
  crop.height = side;
  cropCtx.setTransform(1, 0, 0, 1, 0, 0);
  cropCtx.fillStyle = '#0b0d0c';
  cropCtx.fillRect(0, 0, side, side);
  // Fit the longer edge, so the hand keeps its shape instead of being squashed into a square.
  const scale = side / Math.max(w, h);
  const dw = w * scale;
  const dh = h * scale;
  if (mirrored) {
    // The preview is mirrored so it behaves like a looking glass; the thumbnail has to match, or
    // the picture disagrees with the hand he is looking at while he holds the pose.
    cropCtx.translate(side, 0);
    cropCtx.scale(-1, 1);
  }
  cropCtx.drawImage(video, x0 * WIDTH, y0 * HEIGHT, w, h, (side - dw) / 2, (side - dh) / 2, dw, dh);
  cropCtx.setTransform(1, 0, 0, 1, 0, 0);
  try {
    return crop.toDataURL('image/webp', 0.7);
  } catch {
    return null;
  }
}

/**
 * The landmarker's handedness labels, passed through UNTRANSLATED.
 *
 * Deliberately not interpreted here. Turning a label into "his right hand" needs to know whether
 * this camera hands over a mirrored frame, and that is a calibrated fact about the desk which this
 * page has no business guessing — see the note on DEFAULT_MIRRORED in hand-roles.ts. Translating
 * it in two places is how one wrong assumption became two bugs on 2026-09-12.
 */
function readSides(result: { handedness?: { categoryName?: string }[][]; handednesses?: { categoryName?: string }[][] }): RawSide[] {
  const raw = result.handedness ?? result.handednesses ?? [];
  return raw.map((entry) => {
    const name = entry?.[0]?.categoryName;
    return name === 'Left' || name === 'Right' ? name : 'unknown';
  });
}

const cams: Cam[] = [];
/**
 * The control machine (packages/shared/gesture-control.ts), built from the trained catalogue: the
 * cursor posture, the clicks, the drag, the scroll, the zoom, the postures trained to be ignored,
 * and both fists to stop. Rebuilt whenever the catalogue changes, which is why it is not a const.
 */
let control: GestureControl = createControl(withBuiltIns(EMPTY_LIBRARY));
let wizard: Wizard | null = null;
let queue: ControlEvent[] = [];
/** The last thing the machine decided, for the monitor's text line. */
let lastDecision: string | null = null;
let phase: VisionPhase = 'starting';
let lastError: string | undefined;
/** The raw pose of the driving hand, for the monitor. Geometry, not recognition. */
let livePose: ReturnType<typeof classifyPose> = 'unknown';

const report = (): void => {
  const cameras: VisionCamera[] = cams.map((cam) => ({
    label: cam.label,
    fps: cam.fps,
    seeing: cam.seeing,
    ...(cam.error ? { error: cam.error } : {})
  }));
  const payload: VisionReport = {
    phase,
    cameras,
    ...(livePose !== 'unknown' ? { pose: livePose } : {}),
    ...(lastError ? { error: lastError } : {})
  };
  void window.skynet['vision:report'](payload);
};

/** Send what has accumulated, keeping only the final cursor position from the batch. */
const flush = (): void => {
  if (!queue.length) return;
  const lastCursorAt = queue.map((event) => event.type).lastIndexOf('cursor');
  const batch = queue.filter((event, index) => event.type !== 'cursor' || index === lastCursorAt);
  queue = [];
  void window.skynet['vision:events'](batch);
};

async function openCameras(): Promise<void> {
  // One grant, then labels are populated; before a grant they are empty strings.
  const warm = await navigator.mediaDevices.getUserMedia({ video: true });
  warm.getTracks().forEach((track) => track.stop());

  const all = (await navigator.mediaDevices.enumerateDevices()).filter((device) => device.kind === 'videoinput');
  const matched = WANTED.length
    ? all.filter((device) => WANTED.some((name) => device.label.toLowerCase().includes(name)))
    : all.slice(0, 2);
  const picked = matched.length ? matched : all.slice(0, 1);
  if (!picked.length) throw new Error('NO CAMERA FOUND');

  const files = await FilesetResolver.forVisionTasks('/wasm');

  for (const device of picked) {
    const view = document.createElement('div');
    view.className = 'view';
    const tag = document.createElement('div');
    tag.className = 'tag';
    // Just the make, not the USB ids: the window is 336 px wide.
    tag.textContent = device.label.replace(/\s*\(.*\)\s*$/, '');
    const video = document.createElement('video');
    video.autoplay = true;
    video.muted = true;
    video.playsInline = true;
    view.append(video, tag);
    viewsEl.append(view);

    try {
      video.srcObject = await navigator.mediaDevices.getUserMedia({
        video: {
          deviceId: { exact: device.deviceId },
          width: { exact: WIDTH },
          height: { exact: HEIGHT },
          frameRate: { ideal: 30 }
        }
      });
      /*
       * Training runs the landmarker far more sensitively than control does.
       *
       * William, 2026-09-12: "often while perfectly posturing my hand in one position that is a
       * perfect example of a keyframe, the program isn't detecting my hand in the footage at all.
       * At least during training the hand recognition should be SUPER tuned up."
       *
       * The 0.5 defaults are right for CONTROL, where a false positive moves his cursor or clicks
       * something, so the cost of seeing a hand that is not there is real. They are wrong for
       * TRAINING, where the cost of a miss is a capture that fails and a pose he has to hold
       * again, and the cost of a marginal detection is nothing at all — a poor example is caught
       * downstream by `featuresOf`, the frame-quality gate and the health audit, none of which
       * care how confident the landmarker was.
       *
       * So the thresholds drop to 0.15 and both hands are always tracked. Presence in particular:
       * a hand held very still in an unusual posture is exactly what a presence threshold tuned
       * for video tracking tends to lose, and holding a pose still is the entire activity here.
       */
      const detection = {
        numHands: TRAINING ? 2 : HAND_COUNT,
        minHandDetectionConfidence: TRAINING ? 0.15 : 0.5,
        minHandPresenceConfidence: TRAINING ? 0.15 : 0.5,
        minTrackingConfidence: TRAINING ? 0.15 : 0.5
      };
      /*
       * The pre-trained recognizer first, the plain landmarker if it will not load.
       *
       * The recognizer is the same landmark model with a gesture classifier on top, trained by Google
       * on a large labelled corpus: Open_Palm, Closed_Fist and Victory are three of William's five. It
       * costs no extra inference. Every category is requested with its score, not just the winner,
       * because the pose model fuses the whole distribution with geometry rather than obeying a vote.
       *
       * Without it nothing breaks: the controls decide on 3D geometry alone, which is the baseline.
       */
      let recognizer: GestureRecognizer | null = null;
      let landmarker: HandLandmarker | null = null;
      try {
        recognizer = await GestureRecognizer.createFromOptions(files, {
          baseOptions: { modelAssetPath: '/gesture-model', delegate: DELEGATE },
          runningMode: 'VIDEO',
          ...detection,
          cannedGesturesClassifierOptions: { maxResults: 8, scoreThreshold: 0 }
        });
      } catch (err) {
        log(`gesture model did not load (${err instanceof Error ? err.message : String(err)}) — geometry only`);
        landmarker = await HandLandmarker.createFromOptions(files, {
          baseOptions: { modelAssetPath: '/model', delegate: DELEGATE },
          runningMode: 'VIDEO',
          ...detection
        });
      }
      cams.push({ label: device.label, video, view, recognizer, landmarker, stamp: 0, lastTime: -1, frames: 0, fps: 0, seeing: false });
    } catch (err) {
      // One camera failing is not the feature failing: the other can still drive.
      const message = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
      tag.textContent = `${device.label} — ${message}`;
      cams.push({
        label: device.label,
        video,
        view,
        recognizer: null,
        landmarker: null,
        stamp: 0,
        lastTime: -1,
        frames: 0,
        fps: 0,
        seeing: false,
        error: message
      });
    }
  }
  if (!cams.some((cam) => !cam.error)) throw new Error(cams[0]?.error ?? 'NO CAMERA OPENED');
  log(cams.some((cam) => cam.recognizer) ? 'pre-trained gestures + 3D geometry' : 'landmarks + 3D geometry');
}

function tick(): void {
  const now = performance.now();
  for (let i = 0; i < cams.length; i++) {
    const cam = cams[i]!;
    if (cam.error || cam.video.readyState < 2) continue;
    if (cam.video.currentTime === cam.lastTime) continue;
    cam.lastTime = cam.video.currentTime;
    cam.stamp = Math.max(cam.stamp + 1, Math.round(now));

    /*
     * Judge the picture before believing anything found in it. A black, blown-out or motion-blurred
     * frame contains no hand to find, and letting one through does not merely waste a frame — a
     * training example taken from one poisons every comparison it ever takes part in.
     */
    const verdict = inspect(cam.video);
    if (verdict) cam.quality = verdict;
    if (verdict && !verdict.usable) {
      cam.seeing = false;
      cam.view.classList.remove('seeing');
      continue;
    }

    /*
     * Correct only when correcting helps. An already well-exposed frame goes straight to the
     * landmarker with no copy at all; a dim one is redrawn brightened and contrast-stretched.
     */
    let source: HTMLVideoElement | HTMLCanvasElement = cam.video;
    const correction = verdict?.correction;
    if (analysisCtx && correction && (correction.brightness > 1.05 || correction.contrast > 1.05)) {
      analysisCtx.filter = `brightness(${correction.brightness.toFixed(2)}) contrast(${correction.contrast.toFixed(2)})`;
      analysisCtx.drawImage(cam.video, 0, 0, WIDTH, HEIGHT);
      analysisCtx.filter = 'none';
      source = analysis;
    }

    let hands: Hand[] = [];
    let sides: RawSide[] = [];
    /** Each hand with everything the controls use: world landmarks, the label, the pre-trained scores. */
    let observations: HandObservation[] = [];
    try {
      if (cam.recognizer) {
        const result = cam.recognizer.recognizeForVideo(source, cam.stamp);
        hands = (result.landmarks ?? []) as Hand[];
        sides = readSides(result);
        observations = hands.map((landmarks, i) => ({
          landmarks,
          world: (result.worldLandmarks?.[i] ?? null) as Hand | null,
          label: sides[i] ?? 'unknown',
          canned: result.gestures?.[i] ?? []
        }));
      } else if (cam.landmarker) {
        const result = cam.landmarker.detectForVideo(source, cam.stamp);
        hands = (result.landmarks ?? []) as Hand[];
        sides = readSides(result);
        observations = hands.map((landmarks, i) => ({
          landmarks,
          world: (result.worldLandmarks?.[i] ?? null) as Hand | null,
          label: sides[i] ?? 'unknown'
        }));
      } else {
        continue;
      }
    } catch (err) {
      cam.error = err instanceof Error ? err.message : String(err);
      continue;
    }
    cam.frames++;
    cam.seeing = hands.length > 0;
    cam.view.classList.toggle('seeing', cam.seeing);

    if (wizard) {
      // Training: every camera's hands go to the wizard, and nothing goes to the board.
      wizard.frame(cam.label, hands, sides, now, observations.map((observation) => observation.world ?? null));
      continue;
    }

    // The first working camera drives. The rest are watched, for the status and for the 3D solve
    // that will use them once calibration exists.
    if (i !== cams.findIndex((candidate) => !candidate.error)) {
      /*
       * The other camera's view of the same moment. It does not drive, but when it sees exactly one
       * hand that could be driving, its opinion of that hand's pose is folded in — a peace sign that
       * is ambiguous edge-on to one lens is usually plain to the other.
       */
      control.corroborate({ hands: observations, atMs: now });
    } else {
      const events = control.push({ hands: observations, atMs: now });
      if (events.length) queue.push(...events);
      const next: VisionPhase = hands.length ? 'tracking' : 'watching';
      if (next !== phase) { phase = next; report(); }

      // The monitor's text: what the machine DECIDED, falling back to the raw pose. William asked
      // for "a text of the detected gesture whenever the program is detecting a gesture", and what
      // it decided is more use than what shape the hand happens to be.
      const first = hands[0];
      livePose = first ? classifyPose(first) : 'unknown';
      for (const event of events) {
        if (event.type === 'suppressed') lastDecision = `IGNORED · ${event.reason}`;
        else if (event.type === 'resumed') lastDecision = null;
        else if (event.type === 'gesture') lastDecision = event.name;
        else if (event.type === 'click') lastDecision = `${event.button.toUpperCase()} CLICK${event.count === 2 ? ' ×2' : ''}`;
        else if (event.type === 'zoom') lastDecision = `ZOOM ${event.direction.toUpperCase()}`;
        else if (event.type === 'zoomLocked') lastDecision = 'ZOOM LOCKED';
        else if (event.type === 'dragStart') lastDecision = 'DRAG';
        else if (event.type === 'dragEnd') lastDecision = null;
        else if (event.type === 'scroll') lastDecision = 'SCROLL';
      }
      /*
       * Between decisions, the monitor shows what the pose model believes and how strongly — "OPEN 94%",
       * "FIST 71%". On camera that number is the whole diagnostic: a pose that reads 55% is a pose the
       * machine is unsure of, and it says so before it acts wrongly on it.
       */
      const read = control.state();
      showGesture(
        lastDecision ??
          (read.pose ? `${read.pose.toUpperCase()} ${Math.round(read.confidence * 100)}%` : hands.length ? `HAND · ${read.hands}` : null)
      );
    }
  }
}

async function main(): Promise<void> {
  try {
    log(`opening cameras (${HAND_COUNT} hand${HAND_COUNT === 1 ? '' : 's'}, ${DELEGATE})`);
    await openCameras();
  } catch (err) {
    lastError = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
    phase = 'unavailable';
    log(`FAILED — ${lastError}`);
    report();
    return;
  }

  phase = 'watching';
  report();

  /*
   * The catalogue, as trained. An untrained gesture simply is not in the machine — `createControl`
   * ignores anything with fewer than the required examples — so a fresh install recognises nothing
   * until the wizard has been run, which is the honest behaviour.
   */
  try {
    control = createControl(await window.skynet['gesture:library']());
  } catch {
    control = createControl(withBuiltIns(EMPTY_LIBRARY));
  }

  if (TRAINING) {
    document.body.classList.add('training');
    const host = document.getElementById('wizard');
    if (host) {
      wizard = createWizard({
        cameras: cams.filter((cam) => !cam.error).map((cam) => ({ label: cam.label, view: cam.view })),
        host,
        views: viewsEl,
        // A frame can be good enough to track from and still be too poor to learn from. The
        // catalogue is kept for months; a bad example in it is a bad example for months.
        trainable: (label) => cams.find((cam) => cam.label === label)?.quality?.trainable !== false,
        // Transient, in-page, and only during a capture the user started. Never written anywhere.
        /*
         * `false`, because the preview is not mirrored either — there is no `scaleX(-1)` anywhere
         * on this page. A thumbnail that mirrored while the preview did not would disagree with
         * the hand he is looking at as he holds the pose, which is the one thing it exists to
         * agree with.
         */
        snapshot: (label, hand) => {
          const cam = cams.find((entry) => entry.label === label);
          return cam ? snapshotHand(cam.video, hand, false) : null;
        },
        // Back to being a monitor. Main moves the window and reloads this page without the mode.
        onFinished: () => { void window.skynet['gesture:train'](false); }
      });
    }
  }
  rateEl.textContent = 'starting';

  setInterval(tick, TICK_MS);
  setInterval(flush, FLUSH_MS);
  // Frame rate is measured per second here rather than inferred in main: only this page knows how
  // many frames it actually processed, and a throttled hidden window has to be visible as a number.
  setInterval(() => {
    for (const cam of cams) { cam.fps = cam.frames; cam.frames = 0; }
    report();
    log(cams.map((cam) => `${cam.label.slice(0, 24)} ${cam.fps}fps${cam.seeing ? ' hand' : ''}${cam.error ? ' ERR' : ''}`).join('\n'));
  }, REPORT_MS * 2);
  setInterval(report, REPORT_MS);
}

void main();
