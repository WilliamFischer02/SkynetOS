import { Container, Graphics, Sprite, Texture } from 'pixi.js';
import { COPPER, COPPER_DARK, hexToNumber } from '@shared/palette.js';
import { TILE } from './camera.js';

/**
 * The couriers: little robots that carry packets across the board, in proportion to what you are
 * actually spending Claude on.
 *
 * ── What they mean ───────────────────────────────────────────────────────────────────────────
 *
 * A trickle of workers walking toward MinecraftOS means MinecraftOS is where the tokens went in
 * the last few hours. A stream means it is where they are going right now. Nothing walking means
 * nothing is running. The rate is read from `~/.claude/projects` — see packages/shared/usage.ts —
 * so this is a readout, not decoration: it cannot show traffic that is not happening.
 *
 * Each destination gets its own colour, derived from the node id, so you learn to recognise a
 * room's couriers before you read where they are heading.
 *
 * ── How they move ────────────────────────────────────────────────────────────────────────────
 *
 * Orthogonally, on whole pixels, one axis at a time — the same discipline the copper traces
 * follow, because a diagonal walk on a pixel board is a shimmering staircase. They emerge from a
 * source (the JARVIS head on the root board, a board edge inside a room), walk to the destination,
 * and glitch-dissolve on contact: a two-step decay through the palette rather than a fade, since
 * docs/02 forbids partial alpha.
 *
 * The whole layer is skipped when `reducedMotion` is set — docs/02 says state must survive
 * without animation, and this is the most animated thing on the board.
 */

/** How a courier is drawn and where it is going. */
export interface CourierRoute {
  /** The node these couriers serve. Used for the colour and as the arrival point. */
  nodeId: string;
  /** Where they come from, in world px. */
  from: { x: number; y: number };
  /** Where they are going, in world px — the centre of the destination node. */
  to: { x: number; y: number };
  /**
   * Share of board activity, 0..1. Drives how many are walking and how often one sets off.
   * Straight from `shares()` on the usage summary.
   */
  share: number;
  /** Palette-legal body colour for this destination. */
  color: string;
}

interface Courier {
  route: CourierRoute;
  /** Progress along the L-shaped path, 0..1. */
  t: number;
  /** World px per frame. Slower for a heavier packet, which reads as effort. */
  speed: number;
  /** 0 while walking; counts up once it has arrived, driving the dissolve. */
  decay: number;
  /** Which leg first: horizontal or vertical. Alternating makes a crowd look like a crowd. */
  horizontalFirst: boolean;
  sprite: Sprite;
  /** Animation phase, so legs do not all move in lockstep. */
  phase: number;
  /** Amplitude and phase of this individual's drift off the straight line. */
  wobble: number;
  wobblePhase: number;
  /** Which of the three body silvers this one is, so a crowd is not one stamp repeated. */
  shade: number;
}

/** Frames the glitch-dissolve takes. Four steps, each a whole frame, no partial alpha. */
const DECAY_FRAMES = 8;

/**
 * Never more than this walking at once, however busy the board is.
 *
 * Doubled from 90 with the spawn rate, on request. The cap has to move with the rate or the extra
 * couriers are simply never born on a busy board — a rate ceiling and a population ceiling are the
 * same ceiling wearing two hats.
 */
const MAX_COURIERS = 180;

/**
 * How far a courier drifts off the straight line, in world pixels.
 *
 * William: "add a variance / slight path wobble." Without it a route is a single-pixel queue and
 * twice as many couriers just makes the queue denser rather than making it look like traffic. The
 * wobble is a slow sine across the whole journey, with its own phase per individual, so a column
 * fans out and re-converges at the destination instead of marching in file.
 *
 * Applied on the axis PERPENDICULAR to the current leg, and rounded — the walk stays orthogonal
 * and on whole pixels, which is the rule the copper follows and the reason the board does not
 * shimmer.
 */
const WOBBLE_PX = 5;

/**
 * ── Colour: every robot is silver; its DESTINATION is in the outline ─────────────────────────
 *
 * William: "make the robots all a silver / gray color and instead make their unique colors their
 * stroke color, mixed with black to make the stroke color darker."
 *
 * This is better than what it replaced in more than one way. The old version gave each destination
 * a saturated body colour, which put eight bright hues on a six-colour board and made the courier
 * layer the loudest thing on screen — louder than the components it was reporting on. A silver body
 * with a dark coloured edge reads as a machine carrying a tag, the traffic recedes to where it
 * belongs, and the per-destination identity survives intact because an outline at 6px is still
 * perfectly legible as colour.
 *
 * ── The one place the six-colour rule is relaxed, and why ────────────────────────────────────
 *
 * docs/02 caps a frame at six palette colours. The courier layer exceeds that: there are more
 * destinations on a busy board than the palette has entries, and per-destination identity is the
 * entire feature. It is a deliberate, scoped exception — 6x8px sprites, one layer, everything
 * derived from palette entries by darkening rather than invented — and it is written down here
 * rather than left to be discovered.
 */

/**
 * Three silvers, so a column of couriers is not eight identical stamps.
 *
 * William: "add a slight shade difference between each particle (robot) running along a path."
 * Slight is the operative word: these are one and two steps toward copper-dark from silk, which is
 * enough to break up a crowd and not enough to look like three different kinds of robot.
 */
const SHADES = ['#E9E4D6', '#D6CFBC', '#C3BBA4'] as const;

const COURIER_HUES = [
  '#7FE0B0', // signal green
  '#C08A3E', // copper
  '#57C25A', // ok green
  '#E0A22E', // warn amber
  '#8AB6D6', // sky
  '#C98AD6', // orchid
  '#D67F7F', // clay
  '#7FBFD6'  // ice
] as const;

/** Mix a colour toward black. 0 is unchanged, 1 is black. */
function darken(hex: string, amount: number): string {
  const n = Number.parseInt(hex.slice(1), 16);
  const mix = (c: number): number => Math.round(c * (1 - amount));
  const r = mix((n >> 16) & 0xff);
  const g = mix((n >> 8) & 0xff);
  const b = mix(n & 0xff);
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, '0')}`;
}

/**
 * A courier's OUTLINE colour, derived from the node id.
 *
 * Deterministic, so a destination keeps its colour across restarts and you learn it. Darkened
 * heavily toward black: the outline has to sit against a silver body without competing with it,
 * and a dark edge is what makes a 6px sprite read as drawn rather than as a smudge.
 */
export function courierColor(nodeId: string): string {
  let hash = 0;
  for (let i = 0; i < nodeId.length; i++) hash = (hash * 31 + nodeId.charCodeAt(i)) >>> 0;
  return darken(COURIER_HUES[hash % COURIER_HUES.length] as string, 0.55);
}

/**
 * Draw the two-frame walk cycle for one colour.
 *
 * A 6x7 worker: head, body, a carried packet held above it, and two legs that swap. Drawn once
 * per colour into textures and reused, because building a Graphics per courier per frame is how
 * a board with ninety of them stops being 60fps.
 */
function buildWalkFrames(outline: string, body: string): Texture[] {
  const frames: Texture[] = [];
  for (let step = 0; step < 2; step++) {
    // One pixel of margin all round, for the outline to live in.
    const canvas = document.createElement('canvas');
    canvas.width = 8;
    canvas.height = 10;
    const ctx = canvas.getContext('2d');
    if (!ctx) return frames;
    ctx.imageSmoothingEnabled = false;

    /*
     * Drawn twice: the whole silhouette in the outline colour, one pixel bigger in every
     * direction, then the body on top. The same eight-way stamp the text outline uses, and for
     * the same reason — it is the only kind of outline made entirely of whole pixels.
     */
    const silhouette = (fill: string, ox: number, oy: number): void => {
      ctx.fillStyle = fill;
      // packet
      ctx.fillRect(2 + ox, 1 + oy, 4, 2);
      // head and body
      ctx.fillRect(2 + ox, 3 + oy, 4, 1);
      ctx.fillRect(2 + ox, 4 + oy, 4, 3);
      // legs
      if (step === 0) {
        ctx.fillRect(2 + ox, 7 + oy, 1, 2);
        ctx.fillRect(5 + ox, 7 + oy, 1, 1);
      } else {
        ctx.fillRect(2 + ox, 7 + oy, 1, 1);
        ctx.fillRect(5 + ox, 7 + oy, 1, 2);
      }
    };

    for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1], [-1, -1], [1, -1], [-1, 1], [1, 1]]) {
      silhouette(outline, dx as number, dy as number);
    }
    silhouette(body, 0, 0);

    // The packet is cargo, not part of the robot, so it keeps its own copper.
    ctx.fillStyle = COPPER;
    ctx.fillRect(2, 1, 4, 2);
    ctx.fillStyle = COPPER_DARK;
    ctx.fillRect(2, 2, 4, 1);

    // One dark eye, so it has a facing.
    ctx.fillStyle = outline;
    ctx.fillRect(4, 4, 1, 1);

    const texture = Texture.from(canvas);
    texture.source.scaleMode = 'nearest';
    frames.push(texture);
  }
  return frames;
}

/**
 * The glitch-dissolve: the same body, eaten away in four steps.
 *
 * Whole pixels removed on a fixed pattern rather than an alpha fade, so every frame is still six
 * exact colours. It reads as a thing coming apart rather than a thing becoming transparent, which
 * is the difference between pixel art and a CSS transition.
 */
function buildDissolveFrames(outline: string, body: string): Texture[] {
  const frames: Texture[] = [];
  const patterns = [
    [[0, 0], [3, 2], [1, 5]],
    [[1, 0], [2, 3], [4, 4], [0, 6]],
    [[2, 1], [1, 3], [3, 4], [4, 5], [1, 6]],
    [[0, 2], [2, 2], [4, 3], [0, 4], [3, 5], [2, 6], [4, 6]]
  ];

  for (let step = 0; step < patterns.length; step++) {
    const canvas = document.createElement('canvas');
    canvas.width = 8;
    canvas.height = 10;
    const ctx = canvas.getContext('2d');
    if (!ctx) return frames;
    ctx.imageSmoothingEnabled = false;

    ctx.fillStyle = outline;
    ctx.fillRect(1, 2, 6, 6);
    ctx.fillStyle = body;
    ctx.fillRect(2, 3, 4, 4);

    // Punch out everything this step and every step before it, so the decay accumulates.
    ctx.globalCompositeOperation = 'destination-out';
    for (let s = 0; s <= step; s++) {
      for (const [x, y] of patterns[s] ?? []) ctx.fillRect((x as number) + 1, (y as number) + 1, 1, 1);
    }
    ctx.globalCompositeOperation = 'source-over';

    const texture = Texture.from(canvas);
    texture.source.scaleMode = 'nearest';
    frames.push(texture);
  }
  return frames;
}

/**
 * The courier layer. Owns its own container, its own textures and its own spawning.
 *
 * `setRoutes` is called whenever usage or the board changes; `tick` is called once a frame from
 * the renderer's ticker. Nothing in here reads React state or touches the DOM.
 */
export class CourierLayer {
  readonly container = new Container();
  private routes: CourierRoute[] = [];
  private couriers: Courier[] = [];
  private readonly walkFrames = new Map<string, Texture[]>();
  private readonly dissolveFrames = new Map<string, Texture[]>();
  /** Fractional couriers owed per route, so a share too small for one per second still emits. */
  private readonly owed = new Map<string, number>();
  private frame = 0;

  setRoutes(routes: CourierRoute[]): void {
    this.routes = routes;
    const live = new Set(routes.map((r) => r.nodeId));
    // Couriers walking to a node that has gone finish their journey rather than vanishing
    // mid-stride, which would look like a rendering fault.
    for (const courier of this.couriers) {
      if (!live.has(courier.route.nodeId) && courier.decay === 0) courier.decay = 1;
    }
    for (const key of [...this.owed.keys()]) if (!live.has(key)) this.owed.delete(key);
  }

  /**
   * Textures are cached per (outline, shade) pair, not per courier.
   *
   * Eight destinations times three silvers is twenty-four walk cycles for a whole board — built
   * once and shared by every individual. Building a Graphics per courier per frame is how a board
   * with a hundred and eighty of them stops being 60fps.
   */
  private framesFor(outline: string, shade: number, kind: 'walk' | 'dissolve'): Texture[] {
    const store = kind === 'walk' ? this.walkFrames : this.dissolveFrames;
    const body = SHADES[shade % SHADES.length] as string;
    const key = `${outline}|${body}`;
    let frames = store.get(key);
    if (!frames) {
      frames = kind === 'walk' ? buildWalkFrames(outline, body) : buildDissolveFrames(outline, body);
      store.set(key, frames);
    }
    return frames;
  }

  private spawn(route: CourierRoute): void {
    if (this.couriers.length >= MAX_COURIERS) return;
    const shade = Math.floor(Math.random() * SHADES.length);
    const frames = this.framesFor(route.color, shade, 'walk');
    if (!frames.length) return;

    const sprite = new Sprite(frames[0]);
    sprite.roundPixels = true;
    this.container.addChild(sprite);

    this.couriers.push({
      route,
      t: 0,
      // A spread of speeds, so a column of couriers strings out into a trickle instead of
      // marching as one block.
      speed: 0.0018 + Math.random() * 0.0022,
      decay: 0,
      horizontalFirst: Math.random() < 0.5,
      sprite,
      phase: Math.floor(Math.random() * 8),
      // Signed, so half of them drift one way and half the other and the column fans out rather
      // than bulging to one side.
      wobble: (Math.random() * 2 - 1) * WOBBLE_PX,
      wobblePhase: Math.random() * Math.PI * 2,
      shade
    });
  }

  /**
   * One frame.
   *
   * `spawnScale` lets the caller throttle the whole layer at once — the renderer passes 0 when
   * reduced motion is on, which empties the board of couriers without special-casing anything.
   */
  tick(spawnScale = 1): void {
    this.frame++;

    // Spawning. A route's share is couriers-per-second; the fractional remainder is carried so
    // that a project with 2% of the traffic still sends one every few seconds instead of never.
    if (spawnScale > 0) {
      for (const route of this.routes) {
        // Doubled on request: twice as many bots for the same measured traffic.
        const perFrame = (route.share * 12 * spawnScale) / 60;
        const owed = (this.owed.get(route.nodeId) ?? 0) + perFrame;
        const whole = Math.floor(owed);
        this.owed.set(route.nodeId, owed - whole);
        for (let i = 0; i < whole; i++) this.spawn(route);
      }
    }

    for (let i = this.couriers.length - 1; i >= 0; i--) {
      const courier = this.couriers[i];
      if (!courier) continue;
      const { from, to } = courier.route;

      if (courier.decay === 0) {
        courier.t = Math.min(1, courier.t + courier.speed);

        /*
         * The L-shaped walk. One axis at a time, whole pixels, never a diagonal — the same rule
         * the copper follows. The turn happens at t = 0.5, which puts the corner at a different
         * place for every courier because the two legs are rarely the same length.
         */
        let x: number;
        let y: number;
        if (courier.horizontalFirst) {
          x = courier.t < 0.5 ? from.x + (to.x - from.x) * (courier.t * 2) : to.x;
          y = courier.t < 0.5 ? from.y : from.y + (to.y - from.y) * ((courier.t - 0.5) * 2);
        } else {
          x = courier.t < 0.5 ? from.x : from.x + (to.x - from.x) * ((courier.t - 0.5) * 2);
          y = courier.t < 0.5 ? from.y + (to.y - from.y) * (courier.t * 2) : to.y;
        }

        /*
         * The wobble, on the axis perpendicular to the leg being walked.
         *
         * `sin(t * 2pi + phase)` is a single slow excursion across the whole journey rather than a
         * jitter, and it is scaled down to nothing at both ends — so couriers leave the source and
         * arrive at the destination on the line, and only wander in between. Rounded, because the
         * board is whole pixels.
         */
        const taper = Math.sin(courier.t * Math.PI); // 0 at both ends, 1 in the middle
        const drift = Math.round(courier.wobble * taper * Math.sin(courier.t * Math.PI * 2 + courier.wobblePhase));
        const onHorizontalLeg = courier.horizontalFirst ? courier.t < 0.5 : courier.t >= 0.5;

        courier.sprite.x = Math.round(x) + (onHorizontalLeg ? 0 : drift) - 4;
        courier.sprite.y = Math.round(y) + (onHorizontalLeg ? drift : 0) - 5;

        const walk = this.framesFor(courier.route.color, courier.shade, 'walk');
        const step = Math.floor((this.frame + courier.phase) / 6) % 2;
        if (walk[step]) courier.sprite.texture = walk[step];

        // Arrived: start coming apart. This is the moment the packet is delivered.
        if (courier.t >= 1) courier.decay = 1;
        continue;
      }

      // Dissolving.
      const dissolve = this.framesFor(courier.route.color, courier.shade, 'dissolve');
      const index = Math.min(dissolve.length - 1, Math.floor((courier.decay / DECAY_FRAMES) * dissolve.length));
      if (dissolve[index]) courier.sprite.texture = dissolve[index];
      courier.decay++;

      if (courier.decay > DECAY_FRAMES) {
        courier.sprite.destroy();
        this.couriers.splice(i, 1);
      }
    }
  }

  /** How many are walking right now. Surfaced in the HUD so the layer is never a mystery. */
  get count(): number {
    return this.couriers.length;
  }

  destroy(): void {
    for (const courier of this.couriers) courier.sprite.destroy();
    this.couriers = [];
    for (const frames of [...this.walkFrames.values(), ...this.dissolveFrames.values()]) {
      for (const texture of frames) texture.destroy(true);
    }
    this.walkFrames.clear();
    this.dissolveFrames.clear();
    this.container.destroy({ children: true });
  }
}

/**
 * Where couriers enter a board.
 *
 * On the root board they come from the JARVIS head, because that is the thing with jurisdiction
 * over everything and the packets are its errands. Inside a room there is no head to walk from,
 * so they come in from the nearest edge — which is what William described, and which also reads
 * correctly: work is arriving from outside this room.
 */
export function courierSource(
  head: { x: number; y: number } | null,
  destination: { x: number; y: number },
  boardPx: { width: number; height: number }
): { x: number; y: number } {
  if (head) return head;

  // Nearest edge, so the walk is short and the direction says something about where it came from.
  const distances = [
    { edge: 'left', d: destination.x, point: { x: -TILE, y: destination.y } },
    { edge: 'right', d: boardPx.width - destination.x, point: { x: boardPx.width + TILE, y: destination.y } },
    { edge: 'top', d: destination.y, point: { x: destination.x, y: -TILE } },
    { edge: 'bottom', d: boardPx.height - destination.y, point: { x: destination.x, y: boardPx.height + TILE } }
  ];
  distances.sort((a, b) => a.d - b.d);
  return distances[0]?.point ?? { x: 0, y: 0 };
}

/** Every outline colour a destination can be given, darkened exactly as `courierColor` does it. */
export const COURIER_OUTLINES: readonly string[] = COURIER_HUES.map((hue) => darken(hue, 0.55));

/** A debug grid of every courier outline, for the asset catalogue. Not used at runtime. */
export function courierPalettePreview(): Graphics {
  const g = new Graphics();
  COURIER_OUTLINES.forEach((color, i) => {
    g.rect(i * 8, 0, 6, 6);
    g.fill({ color: hexToNumber(color) });
  });
  SHADES.forEach((color, i) => {
    g.rect(i * 8, 8, 6, 6);
    g.fill({ color: hexToNumber(color) });
  });
  return g;
}
