import { bindAttrib, createBuffer, createProgram, updateBuffer, type Buffer, type Mat3, type Program } from './gl.js';

/**
 * The globe: a latitude/longitude grid as GL_LINES, points at the intersections, and any extra
 * points the scene pins to the surface. Drawn into the intensity target; post.ts colours it.
 *
 * Distortion (William, 2026-09-26): eight band levels drive HORIZONTAL displacement per latitude
 * band, equator to poles, mirrored; the loudness drives a VERTICAL stretch. Both arrive already
 * smoothed. A slight perspective (`DEPTH`) gives the short 3D depth he asked for.
 */

export const GRID_STEP_DEG = 15;
const SEGMENTS = 72;

const VERTEX = `#version 300 es
precision highp float;
in vec3 aPos;
in float aWeight;
uniform mat3 uRot;
uniform float uScale;
uniform float uAspect;
uniform float uBands[8];
uniform float uRms;
uniform float uDistort;
uniform float uPointSize;
uniform float uSpread;
out float vI;
out float vZ;
void main() {
  vec3 p = aPos;
  if (uDistort > 0.5) {
    float lat = asin(clamp(p.y, -1.0, 1.0));
    float bandF = (abs(lat) / 1.5707963) * 8.0;
    int b0 = int(clamp(floor(bandF), 0.0, 7.0));
    int b1 = int(clamp(floor(bandF) + 1.0, 0.0, 7.0));
    float h = mix(uBands[b0], uBands[b1], fract(bandF));
    p.xz *= 1.0 + 0.24 * h;
    p.y *= 1.0 + 0.16 * uRms;
  } else {
    p *= uSpread;
  }
  vec3 r = uRot * p;
  float k = 1.0 / (1.0 - r.z * 0.22);
  vec2 xy = r.xy * k * uScale;
  xy.x /= uAspect;
  gl_Position = vec4(xy, 0.0, 1.0);
  gl_PointSize = uPointSize * k;
  vI = aWeight;
  vZ = r.z;
}`;

const FRAGMENT = `#version 300 es
precision mediump float;
in float vI;
in float vZ;
uniform float uGlobal;
uniform float uIsPoint;
uniform vec3 uTint;
out vec4 o;
void main() {
  if (uIsPoint > 0.5) {
    vec2 d = gl_PointCoord - 0.5;
    if (dot(d, d) > 0.25) discard;
  }
  float depth = 0.35 + 0.65 * (vZ * 0.5 + 0.5);
  float i = vI * depth * uGlobal;
  o = vec4(uTint * i, i);
}`;

/** Grid geometry: lines (pairs of xyz+weight) and intersection points. */
export function gridGeometry(stepDeg = GRID_STEP_DEG): { lines: Float32Array; points: Float32Array } {
  const lines: number[] = [];
  const points: number[] = [];
  const push = (arr: number[], x: number, y: number, z: number, w: number): void => { arr.push(x, y, z, w); };
  const toRad = Math.PI / 180;
  // Latitude circles, poles excluded.
  for (let lat = -90 + stepDeg; lat < 90; lat += stepDeg) {
    const la = lat * toRad;
    const y = Math.sin(la);
    const r = Math.cos(la);
    const weight = lat === 0 ? 0.62 : 0.42;
    for (let s = 0; s < SEGMENTS; s++) {
      const a0 = (s / SEGMENTS) * Math.PI * 2;
      const a1 = ((s + 1) / SEGMENTS) * Math.PI * 2;
      push(lines, r * Math.sin(a0), y, r * Math.cos(a0), weight);
      push(lines, r * Math.sin(a1), y, r * Math.cos(a1), weight);
    }
  }
  // Meridians: full circles through both poles, every `stepDeg` of longitude over a half turn.
  for (let lon = 0; lon < 180; lon += stepDeg) {
    const lo = lon * toRad;
    const weight = lon === 0 || lon === 90 ? 0.55 : 0.4;
    for (let s = 0; s < SEGMENTS; s++) {
      const a0 = (s / SEGMENTS) * Math.PI * 2;
      const a1 = ((s + 1) / SEGMENTS) * Math.PI * 2;
      const p0: [number, number, number] = [Math.cos(a0) * Math.sin(lo), Math.sin(a0), Math.cos(a0) * Math.cos(lo)];
      const p1: [number, number, number] = [Math.cos(a1) * Math.sin(lo), Math.sin(a1), Math.cos(a1) * Math.cos(lo)];
      push(lines, p0[0], p0[1], p0[2], weight);
      push(lines, p1[0], p1[1], p1[2], weight);
    }
  }
  for (let lat = -90 + stepDeg; lat < 90; lat += stepDeg) {
    for (let lon = 0; lon < 360; lon += stepDeg) {
      const la = lat * toRad;
      const lo = lon * toRad;
      push(points, Math.cos(la) * Math.sin(lo), Math.sin(la), Math.cos(la) * Math.cos(lo), 0.75);
    }
  }
  return { lines: new Float32Array(lines), points: new Float32Array(points) };
}

export interface GlobeUniforms {
  rot: Mat3;
  scale: number;
  aspect: number;
  bands: readonly number[];
  rms: number;
  /** Grid intensity multiplier: fades to 0.4 while something is at the centre. */
  gridAlpha: number;
  pointSize: number;
}

export class Globe {
  private readonly program: Program;
  private readonly lines: Buffer;
  private readonly points: Buffer;
  private readonly pins: Buffer;
  private pinCount = 0;
  private readonly lineCount: number;
  private readonly pointCount: number;

  constructor(private readonly gl: WebGL2RenderingContext) {
    this.program = createProgram(gl, VERTEX, FRAGMENT, ['aPos', 'aWeight'], [
      'uRot', 'uScale', 'uAspect', 'uBands', 'uRms', 'uDistort', 'uPointSize', 'uSpread', 'uGlobal', 'uIsPoint', 'uTint'
    ]);
    const geometry = gridGeometry();
    this.lines = createBuffer(gl, geometry.lines);
    this.points = createBuffer(gl, geometry.points);
    this.lineCount = geometry.lines.length / 4;
    this.pointCount = geometry.points.length / 4;
    this.pins = createBuffer(gl, new Float32Array(4 * 64), gl.DYNAMIC_DRAW);
  }

  /** Pinned items: unit-sphere positions with a weight, replaced whole when the scene changes. */
  setPins(data: Float32Array): void {
    updateBuffer(this.gl, this.pins, data);
    this.pinCount = data.length / 4;
  }

  /** Bind the program and the uniforms shared by every draw this frame. */
  use(u: GlobeUniforms): void {
    const gl = this.gl;
    const p = this.program;
    gl.useProgram(p.program);
    gl.uniformMatrix3fv(p.uniforms['uRot']!, false, u.rot);
    gl.uniform1f(p.uniforms['uScale']!, u.scale);
    gl.uniform1f(p.uniforms['uAspect']!, u.aspect);
    const bands = new Float32Array(8);
    for (let b = 0; b < 8; b++) bands[b] = u.bands[b] ?? 0;
    gl.uniform1fv(p.uniforms['uBands']!, bands);
    gl.uniform1f(p.uniforms['uRms']!, u.rms);
    gl.uniform1f(p.uniforms['uPointSize']!, u.pointSize);
    gl.uniform1f(p.uniforms['uSpread']!, 1);
    gl.uniform3f(p.uniforms['uTint']!, 1, 1, 1);
    gl.uniform1f(p.uniforms['uGlobal']!, u.gridAlpha);
  }

  drawGrid(): void {
    const gl = this.gl;
    const p = this.program;
    gl.uniform1f(p.uniforms['uDistort']!, 1);
    gl.uniform1f(p.uniforms['uIsPoint']!, 0);
    bindAttrib(gl, p.attribs['aPos']!, this.lines, 3, 4, 0);
    bindAttrib(gl, p.attribs['aWeight']!, this.lines, 1, 4, 3);
    gl.drawArrays(gl.LINES, 0, this.lineCount);
    gl.uniform1f(p.uniforms['uIsPoint']!, 1);
    bindAttrib(gl, p.attribs['aPos']!, this.points, 3, 4, 0);
    bindAttrib(gl, p.attribs['aWeight']!, this.points, 1, 4, 3);
    gl.drawArrays(gl.POINTS, 0, this.pointCount);
  }

  /** The pinned dots, brighter than the grid's own points and drawn on the distorted surface. */
  drawPins(alpha: number, size: number): void {
    if (!this.pinCount) return;
    const gl = this.gl;
    const p = this.program;
    gl.uniform1f(p.uniforms['uDistort']!, 1);
    gl.uniform1f(p.uniforms['uIsPoint']!, 1);
    gl.uniform1f(p.uniforms['uGlobal']!, alpha);
    gl.uniform1f(p.uniforms['uPointSize']!, size);
    bindAttrib(gl, p.attribs['aPos']!, this.pins, 3, 4, 0);
    bindAttrib(gl, p.attribs['aWeight']!, this.pins, 1, 4, 3);
    gl.drawArrays(gl.POINTS, 0, this.pinCount);
  }

  /**
   * Arbitrary lines through the same projection, undistorted: the wisps' trails (into the
   * intensity target) and a wireframe model (onto the canvas, tinted). `spread` scales positions.
   */
  drawLines(buffer: Buffer, count: number, alpha: number, spread: number, tint: [number, number, number] = [1, 1, 1]): void {
    const gl = this.gl;
    const p = this.program;
    gl.uniform1f(p.uniforms['uDistort']!, 0);
    gl.uniform1f(p.uniforms['uIsPoint']!, 0);
    gl.uniform1f(p.uniforms['uGlobal']!, alpha);
    gl.uniform1f(p.uniforms['uSpread']!, spread);
    gl.uniform3f(p.uniforms['uTint']!, tint[0], tint[1], tint[2]);
    bindAttrib(gl, p.attribs['aPos']!, buffer, 3, 4, 0);
    bindAttrib(gl, p.attribs['aWeight']!, buffer, 1, 4, 3);
    gl.drawArrays(gl.LINES, 0, count);
  }

  destroy(): void {
    const gl = this.gl;
    gl.deleteBuffer(this.lines.buffer);
    gl.deleteBuffer(this.points.buffer);
    gl.deleteBuffer(this.pins.buffer);
    gl.deleteProgram(this.program.program);
  }
}
