import { QUAD, bindAttrib, createBuffer, createProgram, type Buffer, type Program } from './gl.js';

/**
 * The post pass: the intensity picture becomes the JARVIS orb.
 *
 * Everything before this is grey light in a texture. Here it is quantised through a 4x4 ordered
 * Bayer dither onto the six blues (or ambers, on a fault) at 1:1 device pixels, with the shaded
 * disc that made the old sphere read as glass, a halo that grows while LISTENING, and the odd-row
 * scanline. That is the same recipe as `renderSphere` (packages/shared/hologram.ts), so the orb
 * William liked is the orb he gets, at four times the pixels.
 */

const VERTEX = `#version 300 es
precision highp float;
in vec2 aPos;
out vec2 vUv;
void main() {
  vUv = aPos * 0.5 + 0.5;
  gl_Position = vec4(aPos, 0.0, 1.0);
}`;

const FRAGMENT = `#version 300 es
precision mediump float;
in vec2 vUv;
uniform sampler2D uScene;
uniform vec3 uPalette[7];
uniform float uBright;
uniform vec2 uCentre;
uniform float uRadius;
uniform float uDisc;
uniform float uHalo;
uniform float uScan;
uniform float uFlicker;
out vec4 o;
float bayer(ivec2 p) {
  int x = p.x & 3;
  int y = p.y & 3;
  int m[16] = int[16](0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5);
  return float(m[y * 4 + x]) / 16.0;
}
void main() {
  vec2 px = gl_FragCoord.xy;
  vec2 uv = vUv;
  if (uFlicker > 0.5) uv.x -= 1.0 / float(textureSize(uScene, 0).x);
  float i = texture(uScene, uv).r;
  vec2 d = (px - uCentre) / uRadius;
  float d2 = dot(d, d);
  if (d2 <= 1.0) {
    float nz = sqrt(1.0 - d2);
    float lit = clamp(0.3 + 0.7 * (-0.45 * d.x + 0.5 * d.y + 0.55 * nz), 0.0, 1.0);
    float rim = d2 > 0.82 ? 0.25 : 0.0;
    i += (lit + rim) * uDisc;
  } else if (uHalo > 0.0) {
    float r = sqrt(d2);
    float ring = exp(-pow((r - (1.0 + 0.3 * uHalo)) * 5.0, 2.0));
    float glow = exp(-(r - 1.0) * 4.0);
    i += (ring * 0.4 + glow * 0.25) * uHalo;
  }
  i *= uBright;
  if (uFlicker > 0.5) i *= 0.8;
  float level = floor(clamp(i, 0.0, 1.0) * 6.0 + bayer(ivec2(px)));
  int idx = int(clamp(level, 0.0, 6.0));
  if (i <= 0.004) idx = 0;
  if (uScan > 0.5 && (int(px.y) & 1) == 1 && idx > 1) idx -= 1;
  o = vec4(uPalette[idx], 1.0);
}`;

export interface PostUniforms {
  palette: readonly string[];
  bright: number;
  /** Device pixels, GL origin (bottom-left). */
  centre: [number, number];
  radius: number;
  disc: number;
  halo: number;
  scan: boolean;
  flicker: boolean;
}

function hexToRgb(hex: string): [number, number, number] {
  return [parseInt(hex.slice(1, 3), 16) / 255, parseInt(hex.slice(3, 5), 16) / 255, parseInt(hex.slice(5, 7), 16) / 255];
}

export class Post {
  private readonly program: Program;
  private readonly quad: Buffer;
  private paletteKey = '';
  private readonly paletteData = new Float32Array(21);

  constructor(private readonly gl: WebGL2RenderingContext) {
    this.program = createProgram(gl, VERTEX, FRAGMENT, ['aPos'], [
      'uScene', 'uPalette', 'uBright', 'uCentre', 'uRadius', 'uDisc', 'uHalo', 'uScan', 'uFlicker'
    ]);
    this.quad = createBuffer(gl, QUAD);
  }

  draw(scene: WebGLTexture, u: PostUniforms): void {
    const gl = this.gl;
    const p = this.program;
    gl.useProgram(p.program);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, scene);
    gl.uniform1i(p.uniforms['uScene']!, 0);
    const key = u.palette.join(',');
    if (key !== this.paletteKey) {
      this.paletteKey = key;
      for (let i = 0; i < 7; i++) {
        const [r, g, b] = hexToRgb(u.palette[i] ?? u.palette[u.palette.length - 1] ?? '#000000');
        this.paletteData[i * 3] = r; this.paletteData[i * 3 + 1] = g; this.paletteData[i * 3 + 2] = b;
      }
    }
    gl.uniform3fv(p.uniforms['uPalette']!, this.paletteData);
    gl.uniform1f(p.uniforms['uBright']!, u.bright);
    gl.uniform2f(p.uniforms['uCentre']!, u.centre[0], u.centre[1]);
    gl.uniform1f(p.uniforms['uRadius']!, Math.max(1, u.radius));
    gl.uniform1f(p.uniforms['uDisc']!, u.disc);
    gl.uniform1f(p.uniforms['uHalo']!, u.halo);
    gl.uniform1f(p.uniforms['uScan']!, u.scan ? 1 : 0);
    gl.uniform1f(p.uniforms['uFlicker']!, u.flicker ? 1 : 0);
    bindAttrib(gl, p.attribs['aPos']!, this.quad, 2);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
  }

  destroy(): void {
    this.gl.deleteBuffer(this.quad.buffer);
    this.gl.deleteProgram(this.program.program);
  }
}
