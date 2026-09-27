import type { HoloFocus, HoloItem, HoloScene } from '@shared/holo-scene.js';
import { EMPTY_SCENE } from '@shared/holo-scene.js';
import { QUAD, apply3, bindAttrib, createBuffer, createProgram, easeInOutCubic, easeOutCubic, latLonToXyz, mul3, project, rotationX, rotationY, textureFrom, type Buffer, type Mat3, type Program } from './gl.js';
import type { Globe } from './globe.js';
import { orbitAt, orbitFor, type Orbit } from './wisps.js';
import { CONTENT_W, PANEL_H, PAPER_H, PAPER_LINES_PER_S, TerminalPlayer, contentKey, paintFolder, paintGlyph, paintNone, paintPaper, paintPlate, type PaperView } from './content.js';

/**
 * The scene layer: the icons that orbit, the dots pinned to the globe, and the item at the
 * centre with its contents "maximised" inside the globe. Drawn AFTER the post pass, crisp and in
 * colour, because an icon should look like the icon and text should be legible.
 *
 * Every item rides an orbit chosen from its id, so the same document always takes the same path;
 * its pin is its permanent coordinate on the globe (`lat`/`lon`, from the producer). Taking the
 * centre is a 600 ms ease-out from the pin; leaving it is 300 ms back. The panel opens 250 ms
 * after arrival and closes as the item leaves.
 */

const SPRITE_VERTEX = `#version 300 es
precision highp float;
in vec2 aPos;
uniform vec2 uCentre;
uniform vec2 uSize;
out vec2 vUv;
void main() {
  vUv = vec2(aPos.x * 0.5 + 0.5, 0.5 - aPos.y * 0.5);
  gl_Position = vec4(uCentre + aPos * uSize * 0.5, 0.0, 1.0);
}`;

const SPRITE_FRAGMENT = `#version 300 es
precision mediump float;
in vec2 vUv;
uniform sampler2D uTex;
uniform float uAlpha;
out vec4 o;
void main() {
  o = texture(uTex, vUv) * uAlpha;
}`;

export const TRAVEL_IN_MS = 600;
export const TRAVEL_OUT_MS = 300;
export const PANEL_OPEN_MS = 250;
const ICON_PX = 18;
const ORBIT_R = 1.32;

interface Traveller {
  item: HoloItem;
  focus: HoloFocus | null;
  /** 'in' travels pin → centre, 'held' sits, 'out' travels centre → pin, then is dropped. */
  phase: 'in' | 'held' | 'out';
  since: number;
}

function hashId(id: string): number {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) { h ^= id.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

export interface View {
  rot: Mat3;
  scale: number;
  aspect: number;
  width: number;
  height: number;
  now: number;
}

export class SceneLayer {
  private scene: HoloScene = EMPTY_SCENE;
  private readonly program: Program;
  private readonly quad: Buffer;
  private readonly textures = new Map<string, WebGLTexture>();
  private readonly loading = new Set<string>();
  private readonly orbits = new Map<string, Orbit>();
  private readonly paperCache = new Map<string, PaperView>();
  private current: Traveller | null = null;
  private leaving: Traveller | null = null;
  private contentTexture: WebGLTexture | null = null;
  private contentKeyShown = '';
  private paperKeyShown = '';
  private terminal: TerminalPlayer | null = null;
  private wireBuffer: Buffer | null = null;
  private wireCount = 0;
  private plate: { text: string; texture: WebGLTexture; w: number; h: number } | null = null;
  private pinData = new Float32Array(0);
  private pinsDirty = true;

  constructor(private readonly gl: WebGL2RenderingContext, private readonly globe: Globe) {
    this.program = createProgram(gl, SPRITE_VERTEX, SPRITE_FRAGMENT, ['aPos'], ['uCentre', 'uSize', 'uTex', 'uAlpha']);
    this.quad = createBuffer(gl, QUAD);
  }

  /** How much the centre is occupied, 0..1: the renderer fades the grid by it. */
  focusStrength(now: number): number {
    const t = this.current;
    if (!t) return this.leaving ? 1 - Math.min(1, (now - this.leaving.since) / TRAVEL_OUT_MS) : 0;
    if (t.phase === 'in') return easeOutCubic((now - t.since) / TRAVEL_IN_MS);
    return 1;
  }

  setScene(scene: HoloScene, now: number): void {
    this.scene = scene;
    this.pinsDirty = true;
    const next = scene.focus;
    const cur = this.current;
    if (next && cur && cur.item.id === next.item.id) {
      // Same item, maybe new content (more of the file, more ops).
      if (cur.focus && contentKey(cur.focus.content) !== contentKey(next.content)) cur.focus = next;
      else if (!cur.focus) cur.focus = next;
      return;
    }
    if (cur) {
      this.leaving = { ...cur, phase: 'out', since: now };
    }
    this.current = next ? { item: next.item, focus: next, phase: 'in', since: now } : null;
    if (!next) { this.terminal = null; this.contentKeyShown = ''; }
  }

  /** Unit-sphere positions of every orbit item's pin, for the globe's point pass. */
  pins(): Float32Array | null {
    if (!this.pinsDirty) return null;
    this.pinsDirty = false;
    const items = this.scene.orbit;
    const data = new Float32Array(items.length * 4);
    items.forEach((item, i) => {
      const p = latLonToXyz(item.lat, item.lon);
      data[i * 4] = p[0]; data[i * 4 + 1] = p[1]; data[i * 4 + 2] = p[2];
      data[i * 4 + 3] = this.current?.item.id === item.id ? 1 : 0.6;
    });
    this.pinData = data;
    return data;
  }

  private orbitOf(item: HoloItem): Orbit {
    let o = this.orbits.get(item.id);
    if (!o) {
      o = orbitFor(hashId(item.id));
      o.radius = ORBIT_R + (hashId(item.id + 'r') % 100) / 500;
      o.speed *= 0.6;
      this.orbits.set(item.id, o);
    }
    return o;
  }

  private textureFor(item: HoloItem): WebGLTexture | null {
    const key = item.icon ? `icon:${item.id}` : `glyph:${item.kind}`;
    const have = this.textures.get(key);
    if (have) return have;
    if (!item.icon) {
      const tex = textureFrom(this.gl, paintGlyph(item.kind));
      this.textures.set(key, tex);
      return tex;
    }
    if (!this.loading.has(key)) {
      this.loading.add(key);
      const img = new Image();
      img.onload = () => {
        try { this.textures.set(key, textureFrom(this.gl, img)); } catch { /* keep the glyph */ }
        this.loading.delete(key);
      };
      img.onerror = () => { this.loading.delete(key); };
      img.src = item.icon;
    }
    // The glyph stands in until the icon has decoded.
    const glyphKey = `glyph:${item.kind}`;
    let glyph = this.textures.get(glyphKey);
    if (!glyph) { glyph = textureFrom(this.gl, paintGlyph(item.kind)); this.textures.set(glyphKey, glyph); }
    return glyph;
  }

  /** NDC position of an item's pin on the (undistorted) globe, plus its depth. */
  private pinNdc(item: HoloItem, view: View): [number, number, number] {
    return project(apply3(view.rot, latLonToXyz(item.lat, item.lon)), view.scale, view.aspect);
  }

  private orbitNdc(item: HoloItem, view: View, spread: number): [number, number, number] {
    return project(apply3(view.rot, orbitAt(this.orbitOf(item), view.now, spread)), view.scale, view.aspect);
  }

  private drawSprite(texture: WebGLTexture, cx: number, cy: number, wPx: number, hPx: number, alpha: number, view: View): void {
    const gl = this.gl;
    const p = this.program;
    gl.uniform2f(p.uniforms['uCentre']!, cx, cy);
    gl.uniform2f(p.uniforms['uSize']!, (2 * wPx) / view.width, (2 * hPx) / view.height);
    gl.uniform1f(p.uniforms['uAlpha']!, alpha);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.uniform1i(p.uniforms['uTex']!, 0);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
  }

  /** Prepare the centre panel's texture for this frame; skipped when the frame budget is spent. */
  private updateContent(view: View, allowPaint: boolean): { texture: WebGLTexture; w: number; h: number } | null {
    const t = this.current;
    if (!t || !t.focus) return null;
    const content = t.focus.content;
    const key = contentKey(content);
    if (content.type === 'wire') { this.contentKeyShown = key; return null; }
    let canvas: HTMLCanvasElement | null = null;
    let changed = false;
    if (content.type === 'paper') {
      const elapsedS = Math.max(0, (view.now - t.focus.since) / 1000);
      const scroll = content.scrollFrom + elapsedS * PAPER_LINES_PER_S;
      const pv = paintPaper(content, scroll, this.paperCache);
      if (pv.key !== this.paperKeyShown || key !== this.contentKeyShown) { canvas = pv.canvas; changed = true; this.paperKeyShown = pv.key; }
    } else if (content.type === 'terminal') {
      if (!this.terminal || this.terminal.key !== key.slice(5) || key !== this.contentKeyShown) this.terminal = new TerminalPlayer(content);
      if (this.terminal.update(Math.max(0, view.now - t.focus.since), view.now) || key !== this.contentKeyShown) { canvas = this.terminal.canvas; changed = true; }
    } else if (key !== this.contentKeyShown) {
      canvas = content.type === 'folder' ? paintFolder(content) : paintNone(content.title, t.item.kind);
      changed = true;
    }
    if (changed && canvas && (allowPaint || !this.contentTexture)) {
      this.contentTexture = textureFrom(this.gl, canvas, this.contentTexture);
      this.contentKeyShown = key;
    }
    if (!this.contentTexture) return null;
    const h = content.type === 'paper' ? PAPER_H : PANEL_H;
    return { texture: this.contentTexture, w: CONTENT_W, h };
  }

  private wireGeometry(): void {
    const t = this.current;
    if (!t?.focus || t.focus.content.type !== 'wire') return;
    const key = contentKey(t.focus.content);
    if (this.contentKeyShown === key && this.wireBuffer) return;
    const c = t.focus.content;
    const data = new Float32Array(c.edges.length * 8);
    let o = 0;
    for (const [a, b] of c.edges) {
      const va = c.verts[a]; const vb = c.verts[b];
      if (!va || !vb) continue;
      data[o++] = va[0]; data[o++] = va[1]; data[o++] = va[2]; data[o++] = 0.9;
      data[o++] = vb[0]; data[o++] = vb[1]; data[o++] = vb[2]; data[o++] = 0.9;
    }
    if (this.wireBuffer) this.gl.deleteBuffer(this.wireBuffer.buffer);
    this.wireBuffer = createBuffer(this.gl, data.subarray(0, o));
    this.wireCount = o / 4;
    this.contentKeyShown = key;
  }

  /**
   * Draw the layer onto the canvas (after post): orbiting icons back to front, the leaving and
   * arriving items, the centre panel, and the queue plate. `allowPaint` gates 2D repaints.
   */
  draw(view: View, allowPaint: boolean, spread: number): void {
    const gl = this.gl;
    const now = view.now;
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.useProgram(this.program.program);
    bindAttrib(gl, this.program.attribs['aPos']!, this.quad, 2);

    // Orbit icons, sorted far to near so the near ones draw last.
    const focusId = this.current?.item.id;
    const placed = this.scene.orbit
      .filter((item) => item.id !== focusId && item.id !== this.leaving?.item.id)
      .map((item) => ({ item, ndc: this.orbitNdc(item, view, spread) }))
      .sort((a, b) => a.ndc[2] - b.ndc[2]);
    for (const { item, ndc } of placed) {
      const tex = this.textureFor(item);
      if (!tex) continue;
      const near = ndc[2] * 0.5 + 0.5;
      const px = ICON_PX * (0.7 + 0.5 * near);
      this.drawSprite(tex, ndc[0], ndc[1], px, px, 0.35 + 0.65 * near, view);
    }

    // The item leaving the centre: back to its pin, shrinking.
    if (this.leaving) {
      const k = Math.min(1, (now - this.leaving.since) / TRAVEL_OUT_MS);
      if (k >= 1) this.leaving = null;
      else {
        const e = easeInOutCubic(k);
        const pin = this.pinNdc(this.leaving.item, view);
        const tex = this.textureFor(this.leaving.item);
        if (tex) this.drawSprite(tex, pin[0] * e, pin[1] * e, ICON_PX * (1.6 - 0.6 * e), ICON_PX * (1.6 - 0.6 * e), 1 - 0.5 * e, view);
      }
    }

    const t = this.current;
    if (!t) { this.drawPlate(view); return; }
    const k = t.phase === 'in' ? Math.min(1, (now - t.since) / TRAVEL_IN_MS) : 1;
    if (t.phase === 'in' && k >= 1) { t.phase = 'held'; t.since = now; }
    const e = easeOutCubic(k);
    const pin = this.pinNdc(t.item, view);
    const tex = this.textureFor(t.item);
    const ix = pin[0] * (1 - e);
    const iy = pin[1] * (1 - e);
    if (tex) this.drawSprite(tex, ix, iy, ICON_PX * (1 + 0.6 * e), ICON_PX * (1 + 0.6 * e), 1, view);

    // The panel, once the icon has arrived.
    const openFor = t.phase === 'held' ? now - t.since : 0;
    const open = t.phase === 'held' ? easeOutCubic(openFor / PANEL_OPEN_MS) : 0;
    if (open > 0) {
      const radiusPx = view.scale * view.height * 0.5;
      const maxW = radiusPx * 1.3;
      if (t.focus?.content.type === 'wire') {
        this.wireGeometry();
        if (this.wireBuffer && this.wireCount) {
          const spin = mul3(view.rot, mul3(rotationY(now * 0.0009), rotationX(0.4)));
          this.globe.use({ rot: spin, scale: view.scale * 0.45 * open, aspect: view.aspect, bands: [], rms: 0, gridAlpha: 1, pointSize: 2 });
          this.globe.drawLines(this.wireBuffer, this.wireCount, 0.9 * open, 1, [0.72, 0.96, 1]);
          gl.useProgram(this.program.program);
          bindAttrib(gl, this.program.attribs['aPos']!, this.quad, 2);
        }
      } else {
        const panel = this.updateContent(view, allowPaint);
        if (panel) {
          const integer = Math.max(1, Math.floor(maxW / panel.w));
          const w = panel.w * integer * open;
          const h = panel.h * integer * open;
          // Sit just above the centre so the icon's landing point is not covered by the title bar.
          this.drawSprite(panel.texture, 0, 0.02, w, h, 0.85 + 0.15 * open, view);
        }
      }
    }
    this.drawPlate(view);
  }

  private drawPlate(view: View): void {
    const n = this.scene.queue;
    if (n <= 0) { return; }
    const text = `+${n}`;
    if (!this.plate || this.plate.text !== text) {
      const canvas = paintPlate(text);
      const texture = textureFrom(this.gl, canvas, this.plate?.texture ?? null);
      this.plate = { text, texture, w: canvas.width, h: canvas.height };
    }
    this.drawSprite(this.plate.texture, 0, -view.scale * 0.92 - 0.06, this.plate.w, this.plate.h, 0.55, view);
  }

  destroy(): void {
    const gl = this.gl;
    for (const t of this.textures.values()) gl.deleteTexture(t);
    this.textures.clear();
    if (this.contentTexture) gl.deleteTexture(this.contentTexture);
    if (this.plate) gl.deleteTexture(this.plate.texture);
    if (this.wireBuffer) gl.deleteBuffer(this.wireBuffer.buffer);
    gl.deleteBuffer(this.quad.buffer);
    gl.deleteProgram(this.program.program);
  }
}
