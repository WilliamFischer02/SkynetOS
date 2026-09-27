import { apply3, createBuffer, mul3, rotationX, rotationZ, updateBuffer, type Buffer, type Mat3 } from './gl.js';

/**
 * The blue wisps: a few hundred particles on tilted elliptical orbits around the globe, each
 * trailing a short tail, blended additively so where they cross they glow. Positions are computed
 * on the CPU every frame (a few thousand numbers) and uploaded as one dynamic buffer of GL_LINES.
 *
 * Also the orbits the scene's icons ride: `orbitAt` is exported so an item can sit in the flow
 * of the tendrils rather than beside it.
 */

export const WISP_COUNT = 360;
export const TRAIL = 7;
const TRAIL_DT_MS = 42;

export interface Orbit {
  tilt: Mat3;
  radius: number;
  /** radians per ms */
  speed: number;
  phase: number;
  /** 0..1 how bright the head is */
  glow: number;
  /** Ellipse squash along the orbit's local z. */
  squash: number;
}

/** A deterministic orbit from a seed, so the same item always rides the same path. */
export function orbitFor(seed: number): Orbit {
  let s = (seed >>> 0) || 1;
  const rand = (): number => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
  const tx = (rand() - 0.5) * 1.3;
  const tz = (rand() - 0.5) * 2.4;
  return {
    tilt: mul3(rotationZ(tz), rotationX(tx)),
    radius: 1.08 + rand() * 0.5,
    speed: (0.00035 + rand() * 0.00055) * (rand() < 0.5 ? 1 : -1),
    phase: rand() * Math.PI * 2,
    glow: 0.35 + rand() * 0.65,
    squash: 0.72 + rand() * 0.28
  };
}

/** Where an orbit is at time `t` (ms), before the view rotation. `spread` scales the radius. */
export function orbitAt(o: Orbit, t: number, spread = 1): [number, number, number] {
  const a = o.phase + o.speed * t;
  return apply3(o.tilt, [Math.cos(a) * o.radius * spread, 0, Math.sin(a) * o.radius * o.squash * spread]);
}

export class Wisps {
  readonly orbits: Orbit[];
  private readonly buffer: Buffer;
  private readonly data: Float32Array;

  constructor(private readonly gl: WebGL2RenderingContext, count = WISP_COUNT) {
    this.orbits = [];
    for (let i = 0; i < count; i++) this.orbits.push(orbitFor(0x9e3779b9 ^ (i * 2654435761)));
    // Each particle: TRAIL-1 segments, 2 vertices each, 4 floats each.
    this.data = new Float32Array(count * (TRAIL - 1) * 2 * 4);
    this.buffer = createBuffer(gl, this.data, gl.DYNAMIC_DRAW);
  }

  /**
   * Fill the trails for time `t`. `energy` (0..1, the loudness) brightens and lengthens the tails a
   * little; `spread` pushes every orbit outward (LISTENING breathes them out); `speedScale` slows
   * them while THINKING.
   */
  update(t: number, energy: number, spread: number, speedScale: number): number {
    const d = this.data;
    let o = 0;
    const dt = TRAIL_DT_MS * (1 + energy * 0.6);
    for (const orbit of this.orbits) {
      const tt = t * speedScale;
      let prev = orbitAt(orbit, tt, spread);
      for (let k = 1; k < TRAIL; k++) {
        const next = orbitAt(orbit, tt - k * dt, spread);
        const fade = 1 - k / TRAIL;
        const w = orbit.glow * (0.18 + 0.32 * energy) * fade;
        d[o++] = prev[0]; d[o++] = prev[1]; d[o++] = prev[2]; d[o++] = w * 1.15;
        d[o++] = next[0]; d[o++] = next[1]; d[o++] = next[2]; d[o++] = w * fade;
        prev = next;
      }
    }
    updateBuffer(this.gl, this.buffer, d);
    return o / 4;
  }

  get glBuffer(): Buffer { return this.buffer; }

  destroy(): void {
    this.gl.deleteBuffer(this.buffer.buffer);
  }
}
