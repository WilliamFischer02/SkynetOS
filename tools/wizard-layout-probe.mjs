/*
 * tools/wizard-layout-probe.mjs — does every phase of the wizard keep its buttons on screen?
 *
 * William, 2026-09-11: "I got stuck in the opening calibration screen because the buttons didn't
 * render." They had rendered. They were below the fold of a fixed 820x620 window with
 * `overflow: hidden`, which looks identical from the outside and is worse, because there is
 * nothing to say so and no way to scroll and find out. The countdown, thumbnail strip and keyframe
 * editor added that day were eighty pixels of furniture that was present on every phase, in use or
 * not, and the intro screen was already close to the edge.
 *
 * Arithmetic cannot settle this: line wrapping, `clamp()` and flexbox are decided by the layout
 * engine, and the layout engine here is Electron's. So this runs the real one, at the real window
 * size `setTrainMode` uses, over the real stylesheet, and asks the only question that matters:
 *
 *   at each phase, is every button in the action row inside the viewport?
 *
 *   npx electron tools/wizard-layout-probe.mjs [--show]
 *
 * No camera is opened and the page's own script never runs — this is a question about layout, not
 * about vision. Nothing is captured and nothing is written but the log.
 */

import { app, BrowserWindow } from 'electron';
import { mkdirSync, readFileSync, writeFileSync, appendFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const REPO = resolve(import.meta.dirname, '..');
const PAGE = join(REPO, 'src', 'renderer', 'vision.html');

/**
 * The bounds `setTrainMode` gives the window (src/main/services/vision.ts) — but it clamps to the
 * work area, so a short display gets a shorter window. `--height` runs the same checks at that
 * size, which is how the smallest workable window was found.
 */
const flag = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  const value = i > 0 ? Number(process.argv[i + 1]) : NaN;
  return Number.isFinite(value) && value > 0 ? value : fallback;
};
const WIDTH = flag('width', 820);
const HEIGHT = flag('height', 620);

/*
 * Written synchronously to a file as well as stdout: Electron's stdout through a pipe is block
 * buffered, so a run that hangs takes its whole log with it. Learned the hard way on the vision
 * page probe.
 */
const LOG = join(REPO, '.vision-probe', 'wizard-layout.log');
mkdirSync(join(REPO, '.vision-probe'), { recursive: true });
writeFileSync(LOG, `[layout] started ${new Date().toISOString()}\n`);
const say = (line) => {
  console.log(line);
  try {
    appendFileSync(LOG, `${line}\n`);
  } catch {
    /* the console line is still worth having */
  }
};

/**
 * The tallest content each phase can put on screen, in the order vision-train.ts builds it.
 * A phase missing from this list is a phase nobody is checking.
 */
const PHASES = [
  {
    name: 'intro',
    lead:
      'Four steps: aim the cameras at each other’s level, learn how far you reach, refresh the examples for every gesture in the catalogue, then check that nothing you taught contradicts anything else. Nothing is recorded until you press a button, and no picture is ever saved — an example is 42 numbers describing your hand.',
    count: '',
    strip: [],
    dots: 0,
    frames: 0,
    buttons: ['START', 'NOT NOW']
  },
  {
    name: 'level',
    lead:
      'Hold one flat palm up, centred, where you would normally work. Adjust whichever camera is named until both agree.',
    count: '',
    strip: [],
    dots: 0,
    frames: 0,
    buttons: ['NEXT', 'CHECK DIRECTION AGAIN', 'NO — SWAP LEFT AND RIGHT', 'CANCEL']
  },
  {
    name: 'reach',
    lead:
      'With an open hand, sweep the corners of the area you want to use — as far left, right, up and down as is comfortable. The box you draw becomes the whole screen.',
    count: '',
    strip: [],
    dots: 0,
    frames: 0,
    buttons: ['SAVE AND CONTINUE', 'SKIP']
  },
  {
    // The worst case on the card: every variant button showing, the keyframe editor at 3, the
    // hands toggle, the variant tally and a row per camera.
    name: 'gesture card',
    lead: '3 keyframes, performed in order. Built in: it drives left click. 7 of 15.',
    count: '',
    strip: ['var', 'var', 'var', 'var', 'var', 'var', 'var'],
    dots: 4,
    frames: 3,
    hands: true,
    buttons: [
      'MORE CLEAN EXAMPLES',
      '+ A SLOPPY ONE',
      '+ FROM AN ANGLE',
      '+ THE LEFT HAND',
      '+ FURTHER BACK',
      'RETRY CAPTURES',
      '\u25C0 BACK',
      'NEXT \u25B6'
    ]
  },
  {
    name: 'capturing',
    lead:
      'Both hands. Now do it badly — half-hearted, rushed, not quite finishing the shape. The shutter fires on the count, whatever it can see.',
    count: '8',
    // Two cameras, three keyframes each: the full thumbnail wall.
    strip: ['cam3', 'cam3'],
    dots: 4,
    frames: 0,
    buttons: ['STOP']
  },
  {
    // Every take ends here. It is also the screen that closed the endless-variant trap.
    name: 'confirm',
    lead: 'Both hands. The shutter fires on the count, whatever it can see.',
    count: '',
    strip: ['cam3', 'cam3'],
    dots: 4,
    frames: 0,
    buttons: ['ANOTHER TAKE', 'DISCARD THIS TAKE', 'DONE WITH THIS GESTURE']
  },
  {
    // Fifteen built-in gestures, each with a health row: the longest thing the wizard ever shows.
    name: 'check',
    lead: 'Refreshed 15 gestures. The cameras are calibrated for where you actually reach.',
    count: '',
    strip: Array.from({ length: 15 }, () => 'health'),
    dots: 0,
    frames: 0,
    buttons: ['REPAIR — DROP 3', '\u25C0 BACK TO TRAINING', 'LEAVE IT']
  }
];

const script = (phase) => `(() => {
  document.body.className = 'training';
  const host = document.getElementById('wizard');
  host.innerHTML = '';
  const el = (tag, cls, text) => {
    const node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text !== undefined) node.textContent = text;
    return node;
  };
  const phase = ${JSON.stringify(phase)};
  const shell = el('div', 'wz');
  const body = el('div', 'wz-body');
  const steps = el('div', 'wz-steps');
  for (const label of ['1 · AIM', '2 · REACH', '3 · TRAIN', '4 · CHECK']) steps.append(el('span', 'wz-step', label));
  const stage = el('div', 'wz-stage');
  stage.append(document.getElementById('views'));
  const count = el('div', 'wz-count', phase.count);
  const strip = el('div', 'wz-strip');
  for (const kind of phase.strip) {
    if (kind === 'shot') {
      const cell = el('div', 'wz-shot');
      cell.append(el('span', 'wz-shot-empty', '1'), el('span', 'wz-shot-label', '1 · Hold the pose.'));
      strip.append(cell);
    } else if (kind === 'cam3') {
      const row = el('div', 'wz-cam');
      row.append(el('span', 'wz-cam-name', 'HD USB CAMERA'));
      for (let i = 0; i < 3; i++) {
        const cell = el('div', 'wz-shot got');
        cell.append(el('span', 'wz-shot-empty', String(i + 1)));
        row.append(cell);
      }
      strip.append(row);
    } else if (kind === 'health') {
      const row = el('div', 'wz-health');
      row.append(el('span', 'wz-health-name', 'HOLDING A MOUSE'), el('span', 'wz-health-note', '6 · good'));
      strip.append(row);
    } else {
      strip.append(el('span', 'wz-var has', 'THE CLEAN ONE 4'));
    }
  }
  const dots = el('div', 'wz-dots');
  for (let i = 0; i < phase.dots; i++) dots.append(el('span', 'wz-dot on'));
  const frames = el('div', 'wz-frames');
  if (phase.frames > 0) {
    frames.append(el('span', 'wz-frames-label', 'KEYFRAMES'));
    for (let i = 0; i < phase.frames; i++) frames.append(el('span', 'wz-frame', String(i + 1)));
    if (phase.hands) {
      frames.append(el('span', 'wz-frames-label', 'HANDS'));
      for (const label of ['ONE HAND', 'TWO HANDS', 'BOTH, SAME', 'TRAVEL: ON']) {
        const chip = el('button', 'wz-btn tiny', label);
        chip.type = 'button';
        frames.append(chip);
      }
    }
    frames.append(el('span', 'wz-frames-note', 'Both hands, together, every keyframe.'));
  }
  const actions = el('div', 'wz-actions');
  for (const label of phase.buttons) {
    const node = el('button', 'wz-btn', label);
    node.type = 'button';
    actions.append(node);
  }
  body.append(
    steps,
    el('h1', 'wz-title', 'CALIBRATE AND TRAIN'),
    el('p', 'wz-lead', phase.lead),
    stage,
    count,
    strip,
    el('div', 'wz-advice', 'Waiting for a hand…'),
    dots,
    frames
  );
  shell.append(body, actions);
  host.append(shell);

  const view = { width: window.innerWidth, height: window.innerHeight };
  const rect = actions.getBoundingClientRect();
  const buttons = [...actions.querySelectorAll('button')].map((node) => {
    const box = node.getBoundingClientRect();
    return {
      label: node.textContent,
      visible: box.top >= 0 && box.bottom <= view.height && box.left >= 0 && box.right <= view.width
    };
  });
  return {
    view,
    top: Math.round(rect.top),
    bottom: Math.round(rect.bottom),
    scrolls: body.scrollHeight > body.clientHeight + 1,
    buttons
  };
})()`;

/*
 * Everything runs inside `main()`, and `main()` is called without being awaited.
 *
 * A top-level `await` in an ESM Electron entry deadlocks the app: Electron does not finish
 * bootstrapping until the entry module's evaluation completes, and an awaited promise at the top
 * level stops it completing — so `app.whenReady()` waits for a ready event that is waiting for it.
 * The first version of this probe hung there, silently, and had to be killed from outside.
 */
const main = async () => {
  /* A watchdog, because a probe that hangs is worse than one that fails. */
  const watchdog = setTimeout(() => {
    say('FAIL  the probe itself hung — no verdict');
    app.exit(2);
  }, 30_000);

  await app.whenReady();

  const win = new BrowserWindow({
    width: WIDTH,
    height: HEIGHT,
    // Hidden, not offscreen: a real window that is simply not shown lays out normally, where an
    // offscreen one depends on a compositor that may not be there.
    show: process.argv.includes('--show'),
    useContentSize: true,
    webPreferences: { sandbox: false }
  });

  /*
   * The markup and the stylesheet only, written beside the real page so its relative paths still
   * mean what they mean. The page's own script is stripped, so no camera is opened and nothing it
   * would normally do — landmarking, reporting, capturing — can happen here.
   */
  const html = readFileSync(PAGE, 'utf8').replace(/<script[\s\S]*?<\/script>/g, '');
  const scratch = join(REPO, '.vision-probe', 'wizard-layout.html');
  writeFileSync(scratch, html, 'utf8');
  await win.loadFile(scratch);

  let failures = 0;
  for (const phase of PHASES) {
    const result = await win.webContents.executeJavaScript(script(phase));
    const hidden = result.buttons.filter((button) => !button.visible).map((button) => button.label);
    if (hidden.length) failures++;
    say(
      `${hidden.length ? 'FAIL' : 'OK  '} ${phase.name.padEnd(13)} viewport ${result.view.height}  ` +
        `actions ${result.top}-${result.bottom}  ${result.scrolls ? 'body scrolls' : 'fits'}` +
        `${hidden.length ? `  OFF SCREEN: ${hidden.join(', ')}` : ''}`
    );
  }

  clearTimeout(watchdog);
  say(failures ? `\n${failures} phase(s) would trap the user.` : '\nEvery phase keeps its buttons on screen.');
  win.destroy();
  app.exit(failures ? 1 : 0);
};

process.on('uncaughtException', (err) => {
  say(`CRASHED ${err.stack ?? err.message}`);
  app.exit(2);
});

void main();
