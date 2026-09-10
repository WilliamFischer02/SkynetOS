import { Container, Graphics, Sprite, Texture } from 'pixi.js';
import { COPPER, COPPER_DARK, SILK, hexToNumber } from '@shared/palette.js';
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
}

/** Frames the glitch-dissolve takes. Four steps, each a whole frame, no partial alpha. */
const DECAY_FRAMES = 8;

/** Never more than this walking at once, however busy the board is. Past this it is noise. */
const MAX_COURIERS = 90;

/**
 * A courier's colour, derived from the node id.
 *
 * Deterministic, so a node keeps its colour across restarts and you can learn it. Chosen from a
 * fixed list of palette-legal hues rather than generated, because "any hue" is how a six-colour
 * board turns into a rainbow — docs/02 §Anti-mush rule 2.
 */
const COURIER_COLORS = [
  '#7fe0b0', // signal green
  '#c08a3e', // copper
  '#e9e4d6', // silk
  '#57c25a', // ok green
  '#e0a22e', // warn amber
  '#8ab6d6', // sky
  '#c98ad6', // orchid
  '#d67f7f'  // clay
] as const;

export function courierColor(nodeId: string): string {
  let hash = 0;
  for (let i = 0; i < nodeId.length; i++) hash = (hash * 31 + nodeId.charCodeAt(i)) >>> 0;
  return COURIER_COLORS[hash % COURIER_COLORS.length] as string;
}

/**
 * Draw the two-frame walk cycle for one colour.
 *
 * A 6x7 worker: head, body, a carried packet held above it, and two legs that swap. Drawn once
 * per colour into textures and reused, because building a Graphics per courier per frame is how
 * a board with ninety of them stops being 60fps.
 */
function buildWalkFrames(color: string): Texture[] {
  const frames: Texture[] = [];
  for (let step = 0; step < 2; step++) {
    const canvas = document.createElement('canvas');
    canvas.width = 6;
    canvas.height = 8;
    const ctx = canvas.getContext('2d');
    if (!ctx) return frames;
    ctx.imageSmoothingEnabled = false;

    // The packet, carried overhead. Copper: it is cargo, not part of the robot.
    ctx.fillStyle = COPPER;
    ctx.fillRect(1, 0, 4, 2);
    ctx.fillStyle = COPPER_DARK;
    ctx.fillRect(1, 1, 4, 1);

    // Head and body in the destination's colour.
    ctx.fillStyle = color;
    ctx.fillRect(1, 2, 4, 1);
    ctx.fillRect(1, 3, 4, 3);

    // One lit eye, so it has a facing.
    ctx.fillStyle = SILK;
    ctx.fillRect(3, 3, 1, 1);

    // Legs: swapped between the two frames. That swap is the entire walk cycle, and at 16px
    // tiles it is all the animation a 6px figure can carry.
    ctx.fillStyle = color;
    if (step === 0) {
      ctx.fillRect(1, 6, 1, 2);
      ctx.fillRect(4, 6, 1, 1);
    } else {
      ctx.fillRect(1, 6, 1, 1);
      ctx.fillRect(4, 6, 1, 2);
    }

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
function buildDissolveFrames(color: string): Texture[] {
  const frames: Texture[] = [];
  const patterns = [
    [[0, 0], [3, 2], [1, 5]],
    [[1, 0], [2, 3], [4, 4], [0, 6]],
    [[2, 1], [1, 3], [3, 4], [4, 5], [1, 6]],
    [[0, 2], [2, 2], [4, 3], [0, 4], [3, 5], [2, 6], [4, 6]]
  ];

  for (let step = 0; step < patterns.length; step++) {
    const canvas = document.createElement('canvas');
    canvas.width = 6;
    canvas.height = 8;
    const ctx = canvas.getContext('2d');
    if (!ctx) return frames;
    ctx.imageSmoothingEnabled = false;

    ctx.fillStyle = color;
    ctx.fillRect(1, 2, 4, 4);
    ctx.fillStyle = SILK;
    ctx.fillRect(3, 3, 1, 1);

    // Punch out everything this step and every step before it, so the decay accumulates.
    ctx.globalCompositeOperation = 'destination-out';
    for (let s = 0; s <= step; s++) {
      for (const [x, y] of patterns[s] ?? []) ctx.fillRect(x as number, y as number, 1, 1);
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

  private framesFor(color: string, kind: 'walk' | 'dissolve'): Texture[] {
    const store = kind === 'walk' ? this.walkFrames : this.dissolveFrames;
    let frames = store.get(color);
    if (!frames) {
      frames = kind === 'walk' ? buildWalkFrames(color) : buildDissolveFrames(color);
      store.set(color, frames);
    }
    return frames;
  }

  private spawn(route: CourierRoute): void {
    if (this.couriers.length >= MAX_COURIERS) return;
    const frames = this.framesFor(route.color, 'walk');
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
      phase: Math.floor(Math.random() * 8)
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
        const perFrame = (route.share * 6 * spawnScale) / 60;
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

        courier.sprite.x = Math.round(x) - 3;
        courier.sprite.y = Math.round(y) - 4;

        const walk = this.framesFor(courier.route.color, 'walk');
        const step = Math.floor((this.frame + courier.phase) / 6) % 2;
        if (walk[step]) courier.sprite.texture = walk[step];

        // Arrived: start coming apart. This is the moment the packet is delivered.
        if (courier.t >= 1) courier.decay = 1;
        continue;
      }

      // Dissolving.
      const dissolve = this.framesFor(courier.route.color, 'dissolve');
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

/** A debug grid of every courier colour, for the asset catalogue. Not used at runtime. */
export function courierPalettePreview(): Graphics {
  const g = new Graphics();
  COURIER_COLORS.forEach((color, i) => {
    g.rect(i * 8, 0, 6, 6);
    g.fill({ color: hexToNumber(color) });
  });
  return g;
}
