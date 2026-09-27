/**
 * The hologram's WebGL2 layer: the least that a hand-written renderer needs. No library.
 *
 * Programs are compiled once, buffers are typed arrays uploaded with `bufferData`, and every
 * failure throws a legible message so HologramApp can fall back to the 2D sphere rather than show
 * a black square. Everything here is context bookkeeping; the pictures live in globe.ts, wisps.ts,
 * post.ts and scene.ts.
 */

export interface Program {
  program: WebGLProgram;
  attribs: Record<string, number>;
  uniforms: Record<string, WebGLUniformLocation | null>;
}

export function compileShader(gl: WebGL2RenderingContext, type: number, source: string): WebGLShader {
  const shader = gl.createShader(type);
  if (!shader) throw new Error('COULD NOT CREATE A SHADER');
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(shader) ?? 'no log';
    gl.deleteShader(shader);
    throw new Error(`SHADER DID NOT COMPILE: ${log}`);
  }
  return shader;
}

export function createProgram(gl: WebGL2RenderingContext, vertex: string, fragment: string, attribs: string[], uniforms: string[]): Program {
  const vs = compileShader(gl, gl.VERTEX_SHADER, vertex);
  const fs = compileShader(gl, gl.FRAGMENT_SHADER, fragment);
  const program = gl.createProgram();
  if (!program) throw new Error('COULD NOT CREATE A PROGRAM');
  gl.attachShader(program, vs);
  gl.attachShader(program, fs);
  gl.linkProgram(program);
  gl.deleteShader(vs);
  gl.deleteShader(fs);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const log = gl.getProgramInfoLog(program) ?? 'no log';
    gl.deleteProgram(program);
    throw new Error(`PROGRAM DID NOT LINK: ${log}`);
  }
  const out: Program = { program, attribs: {}, uniforms: {} };
  for (const name of attribs) out.attribs[name] = gl.getAttribLocation(program, name);
  for (const name of uniforms) out.uniforms[name] = gl.getUniformLocation(program, name);
  return out;
}

export interface Buffer {
  buffer: WebGLBuffer;
  count: number;
}

export function createBuffer(gl: WebGL2RenderingContext, data: Float32Array, usage: number = gl.STATIC_DRAW): Buffer {
  const buffer = gl.createBuffer();
  if (!buffer) throw new Error('COULD NOT CREATE A BUFFER');
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.bufferData(gl.ARRAY_BUFFER, data, usage);
  return { buffer, count: data.length };
}

export function updateBuffer(gl: WebGL2RenderingContext, target: Buffer, data: Float32Array): void {
  gl.bindBuffer(gl.ARRAY_BUFFER, target.buffer);
  if (data.length > target.count) {
    gl.bufferData(gl.ARRAY_BUFFER, data, gl.DYNAMIC_DRAW);
    target.count = data.length;
  } else {
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, data);
  }
}

export function bindAttrib(gl: WebGL2RenderingContext, location: number, buffer: Buffer, size: number, stride = 0, offset = 0): void {
  if (location < 0) return;
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer.buffer);
  gl.enableVertexAttribArray(location);
  gl.vertexAttribPointer(location, size, gl.FLOAT, false, stride * 4, offset * 4);
}

export interface Target {
  framebuffer: WebGLFramebuffer;
  texture: WebGLTexture;
  width: number;
  height: number;
}

/** An RGBA8 render target. Resized by `resizeTarget` when the canvas changes. */
export function createTarget(gl: WebGL2RenderingContext, width: number, height: number): Target {
  const texture = gl.createTexture();
  const framebuffer = gl.createFramebuffer();
  if (!texture || !framebuffer) throw new Error('COULD NOT CREATE A RENDER TARGET');
  const target: Target = { framebuffer, texture, width: 0, height: 0 };
  resizeTarget(gl, target, width, height);
  gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
  const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  if (status !== gl.FRAMEBUFFER_COMPLETE) throw new Error(`RENDER TARGET INCOMPLETE (${status})`);
  return target;
}

export function resizeTarget(gl: WebGL2RenderingContext, target: Target, width: number, height: number): void {
  const w = Math.max(1, Math.floor(width));
  const h = Math.max(1, Math.floor(height));
  if (target.width === w && target.height === h) return;
  gl.bindTexture(gl.TEXTURE_2D, target.texture);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  target.width = w;
  target.height = h;
}

/** A texture from an image or canvas, nearest-neighbour, for icons and content panels. */
export function textureFrom(gl: WebGL2RenderingContext, source: TexImageSource, existing?: WebGLTexture | null): WebGLTexture {
  const texture = existing ?? gl.createTexture();
  if (!texture) throw new Error('COULD NOT CREATE A TEXTURE');
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
  gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  return texture;
}

/** Two triangles over clip space, for full-screen passes. */
export const QUAD = new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]);

/* ────────────────────────── small maths ────────────────────────── */

export type Mat3 = Float32Array; // column-major 3x3

export function rotationY(a: number): Mat3 {
  const c = Math.cos(a);
  const s = Math.sin(a);
  return new Float32Array([c, 0, -s, 0, 1, 0, s, 0, c]);
}

export function rotationX(a: number): Mat3 {
  const c = Math.cos(a);
  const s = Math.sin(a);
  return new Float32Array([1, 0, 0, 0, c, s, 0, -s, c]);
}

export function rotationZ(a: number): Mat3 {
  const c = Math.cos(a);
  const s = Math.sin(a);
  return new Float32Array([c, s, 0, -s, c, 0, 0, 0, 1]);
}

export function mul3(a: Mat3, b: Mat3): Mat3 {
  const out = new Float32Array(9);
  for (let c = 0; c < 3; c++) {
    for (let r = 0; r < 3; r++) {
      out[c * 3 + r] = a[r]! * b[c * 3]! + a[3 + r]! * b[c * 3 + 1]! + a[6 + r]! * b[c * 3 + 2]!;
    }
  }
  return out;
}

export function apply3(m: Mat3, v: readonly [number, number, number]): [number, number, number] {
  return [
    m[0]! * v[0] + m[3]! * v[1] + m[6]! * v[2],
    m[1]! * v[0] + m[4]! * v[1] + m[7]! * v[2],
    m[2]! * v[0] + m[5]! * v[1] + m[8]! * v[2]
  ];
}

/**
 * The hologram's projection, shared by the shaders and the CPU (scene.ts places billboards with
 * it): orthographic with a short depth, `DEPTH` per unit of z toward the viewer. Returns clip-space
 * x, y for a point already rotated into view, at `scale` (globe radius in NDC) and `aspect` (w/h).
 */
export const DEPTH = 0.22;
export function project(v: readonly [number, number, number], scale: number, aspect: number): [number, number, number] {
  const k = 1 / (1 - v[2] * DEPTH);
  return [(v[0] * k * scale) / Math.max(aspect, 1e-6), v[1] * k * scale, v[2]];
}

/** The globe's radius in NDC-y units for a canvas of w x h: `R` of the shorter side. */
export const GLOBE_R = 0.58;
export function globeScale(width: number, height: number): number {
  return (GLOBE_R * Math.min(width, height)) / Math.max(1, height);
}

/** Unit vector for a latitude/longitude in degrees, y up, longitude 0 toward +z. */
export function latLonToXyz(lat: number, lon: number): [number, number, number] {
  const la = (lat * Math.PI) / 180;
  const lo = (lon * Math.PI) / 180;
  return [Math.cos(la) * Math.sin(lo), Math.sin(la), Math.cos(la) * Math.cos(lo)];
}

export const easeOutCubic = (t: number): number => 1 - Math.pow(1 - Math.min(1, Math.max(0, t)), 3);
export const easeInOutCubic = (t: number): number => {
  const x = Math.min(1, Math.max(0, t));
  return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2;
};
