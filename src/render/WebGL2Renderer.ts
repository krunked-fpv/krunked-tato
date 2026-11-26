// ============================================================================
// src/render/WebGL2Renderer.ts
// High-throughput instanced WebGL2 RendererAPI implementation:
// - Pre-allocated 16,384-quad instance buffer (ZERO per-frame buffer/canvas/
//   texture/gradient allocations!)
// - Persistent 160-entry floor decal ring-buffer + 320-particle pool + 96-text
//   floating damage number pool (rendered via pre-baked comic glyph texture)
// - Full 11-layer crisp z-order matching krunkedtato visual craft spec
// ============================================================================

import {
  ARENA_H,
  ARENA_W,
  EDGE_MAP_DIST,
  EDGE_SIZE,
  REF_HEIGHT,
  REF_WIDTH,
  type AtlasRegion,
  type EnemyState,
  type EquippedWeaponState,
  type HazardState,
  type PickupState,
  type ProjectileState,
  type RendererAPI,
  type RenderSettings,
  type SimEvent,
  type SimState,
  type StructureState,
} from '../contracts/index';
import { SPRITE_FRAG_SHADER, SPRITE_VERT_SHADER } from './shaders';

const MAX_QUADS = 16384;
const FLOATS_PER_QUAD = 16;
const MAX_DECALS = 160;
const MAX_PARTICLES = 320;
const MAX_FLOATING_TEXTS = 96;
const MAX_TEXT_QUADS = 1024;

const GLYPH_CHARS = '0123456789+-!x%.ABCDEFGHIJKLMNOPQRSTUVWXYZ ';
const GLYPH_CELL = 48;
const GLYPH_COLS = 11;
const GLYPH_ATLAS_W = 528; // 11 * 48
const GLYPH_ATLAS_H = 192; // 4 * 48

interface FloorDecal {
  active: boolean;
  spriteId: string;
  x: number;
  y: number;
  size: number;
  rot: number;
  r: number;
  g: number;
  b: number;
  a: number;
}

interface Particle {
  active: boolean;
  spriteId: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
  size: number;
  endSize: number;
  rot: number;
  vRot: number;
  life: number;
  maxLife: number;
  r: number;
  g: number;
  b: number;
  a: number;
}

interface FloatingText {
  active: boolean;
  text: string;
  x: number;
  y: number;
  vy: number;
  scale: number;
  life: number;
  maxLife: number;
  r: number;
  g: number;
  b: number;
}

const DEFAULT_WHITE_REGION: AtlasRegion = {
  id: 'vfx_white',
  x: 0,
  y: 0,
  w: 64,
  h: 64,
  u0: 0,
  v0: 0,
  u1: 0.01,
  v1: 0.01,
};

function parseHexRgb(hex: string, out: [number, number, number]): void {
  if (!hex || hex[0] !== '#') {
    out[0] = 1;
    out[1] = 1;
    out[2] = 1;
    return;
  }
  const clean = hex.length === 4
    ? `${hex[1]}${hex[1]}${hex[2]}${hex[2]}${hex[3]}${hex[3]}`
    : hex.slice(1, 7);
  const n = parseInt(clean, 16);
  if (Number.isNaN(n)) {
    out[0] = 1;
    out[1] = 1;
    out[2] = 1;
    return;
  }
  out[0] = ((n >> 16) & 255) / 255;
  out[1] = ((n >> 8) & 255) / 255;
  out[2] = (n & 255) / 255;
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function getZoneBackdropRgb(zoneId: 0 | 1 | 2): [number, number, number] {
  if (zoneId === 1) return [0.055, 0.095, 0.135]; // Abyssal Trench
  if (zoneId === 2) return [0.075, 0.12, 0.075];  // Primal Jungle
  return [0.115, 0.092, 0.088];                   // Crash Zone
}

function getZoneWallRgb(zoneId: 0 | 1 | 2): [number, number, number] {
  if (zoneId === 1) return [0.11, 0.21, 0.28];
  if (zoneId === 2) return [0.15, 0.24, 0.14];
  return [0.24, 0.19, 0.17];
}

function getZoneTrimRgb(zoneId: 0 | 1 | 2): [number, number, number] {
  if (zoneId === 1) return [0.22, 0.78, 0.94];
  if (zoneId === 2) return [0.42, 0.8, 0.34];
  return [0.85, 0.56, 0.34];
}

export function computeViewportZoom(cssW: number, cssH: number, cameraZoom: number): number {
  const safeW = Math.max(1, cssW);
  const safeH = Math.max(1, cssH);
  const baseScale = Math.sqrt((safeW * safeH) / (REF_WIDTH * REF_HEIGHT));
  return Math.max(0.25, baseScale * (cameraZoom > 0 ? cameraZoom : 1));
}

function compileShader(gl: WebGL2RenderingContext, type: number, src: string): WebGLShader {
  const sh = gl.createShader(type);
  if (!sh) throw new Error('Failed to create WebGL2 shader');
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(sh) || 'unknown shader error';
    gl.deleteShader(sh);
    throw new Error(`WebGL2 shader compile failed: ${log}`);
  }
  return sh;
}

function createProgram(gl: WebGL2RenderingContext): WebGLProgram {
  const vs = compileShader(gl, gl.VERTEX_SHADER, SPRITE_VERT_SHADER);
  const fs = compileShader(gl, gl.FRAGMENT_SHADER, SPRITE_FRAG_SHADER);
  const prog = gl.createProgram();
  if (!prog) throw new Error('Failed to create WebGL2 program');
  gl.attachShader(prog, vs);
  gl.attachShader(prog, fs);
  gl.linkProgram(prog);
  gl.deleteShader(vs);
  gl.deleteShader(fs);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
    const log = gl.getProgramInfoLog(prog) || 'unknown link error';
    gl.deleteProgram(prog);
    throw new Error(`WebGL2 program link failed: ${log}`);
  }
  return prog;
}

function bakeGlyphFontAtlas(): { canvas: HTMLCanvasElement; uvMap: Map<string, [number, number, number, number]> } {
  const canvas = document.createElement('canvas');
  canvas.width = GLYPH_ATLAS_W;
  canvas.height = GLYPH_ATLAS_H;
  const ctx = canvas.getContext('2d');
  const uvMap = new Map<string, [number, number, number, number]>();

  if (ctx) {
    ctx.clearRect(0, 0, GLYPH_ATLAS_W, GLYPH_ATLAS_H);
    ctx.font = '900 32px "Segoe UI", system-ui, -apple-system, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';

    for (let i = 0; i < GLYPH_CHARS.length; i++) {
      const ch = GLYPH_CHARS[i];
      const col = i % GLYPH_COLS;
      const row = Math.floor(i / GLYPH_COLS);
      const x = col * GLYPH_CELL;
      const y = row * GLYPH_CELL;
      const cx = x + GLYPH_CELL / 2;
      const cy = y + GLYPH_CELL / 2 + 1;

      if (ch !== ' ') {
        ctx.strokeStyle = '#15131c';
        ctx.lineWidth = 7;
        ctx.strokeText(ch, cx, cy);
        ctx.fillStyle = '#ffffff';
        ctx.fillText(ch, cx, cy);
      }

      uvMap.set(ch, [
        (x + 2) / GLYPH_ATLAS_W,
        (y + 2) / GLYPH_ATLAS_H,
        (x + GLYPH_CELL - 2) / GLYPH_ATLAS_W,
        (y + GLYPH_CELL - 2) / GLYPH_ATLAS_H,
      ]);
    }
  }
  return { canvas, uvMap };
}

export class WebGL2Renderer implements RendererAPI {
  public readonly backend = 'webgl2' as const;

  private readonly canvas: HTMLCanvasElement;
  private readonly gl: WebGL2RenderingContext;
  private readonly program: WebGLProgram;
  private readonly vao: WebGLVertexArrayObject;
  private readonly quadVbo: WebGLBuffer;
  private readonly instanceVbo: WebGLBuffer;
  private readonly atlasTex: WebGLTexture;
  private readonly fontTex: WebGLTexture;

  private readonly uCamPos: WebGLUniformLocation | null;
  private readonly uViewHalfWorld: WebGLUniformLocation | null;
  private readonly uAtlas: WebGLUniformLocation | null;
  private readonly uTexelSize: WebGLUniformLocation | null;

  private readonly instanceData = new Float32Array(MAX_QUADS * FLOATS_PER_QUAD);
  private readonly textInstanceData = new Float32Array(MAX_TEXT_QUADS * FLOATS_PER_QUAD);
  private readonly glyphUvs: Map<string, [number, number, number, number]>;

  private regions = new Map<string, AtlasRegion>();
  private atlasWidth = 2048;
  private atlasHeight = 2048;
  private cssWidth = 1280;
  private cssHeight = 720;
  private dpr = 1;

  private quadCount = 0;
  private textQuadCount = 0;
  private lastDrawCalls = 0;
  private lastQuadCount = 0;
  private animClock = 0;
  private fxRng = 0x9e3779b9;
  private readonly scratchRgb: [number, number, number] = [1, 1, 1];

  // Pre-allocated pools (ZERO per-frame heap allocations!)
  private readonly decals: FloorDecal[] = [];
  private decalCursor = 0;
  private readonly particles: Particle[] = [];
  private particleCursor = 0;
  private readonly floatingTexts: FloatingText[] = [];
  private textCursor = 0;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    const gl = canvas.getContext('webgl2', {
      alpha: false,
      antialias: true,
      depth: false,
      stencil: false,
      powerPreference: 'high-performance',
      preserveDrawingBuffer: false,
    });
    if (!gl) {
      throw new Error('WebGL2 context unavailable');
    }
    this.gl = gl;

    // Pre-allocate object pools once
    for (let i = 0; i < MAX_DECALS; i++) {
      this.decals.push({ active: false, spriteId: 'vfx_splat', x: 0, y: 0, size: 32, rot: 0, r: 1, g: 1, b: 1, a: 0.4 });
    }
    for (let i = 0; i < MAX_PARTICLES; i++) {
      this.particles.push({
        active: false, spriteId: 'vfx_spark', x: 0, y: 0, vx: 0, vy: 0,
        size: 12, endSize: 2, rot: 0, vRot: 0, life: 0, maxLife: 0.3,
        r: 1, g: 1, b: 1, a: 1,
      });
    }
    for (let i = 0; i < MAX_FLOATING_TEXTS; i++) {
      this.floatingTexts.push({
        active: false, text: '', x: 0, y: 0, vy: -50, scale: 1,
        life: 0, maxLife: 0.65, r: 1, g: 1, b: 1,
      });
    }

    this.program = createProgram(gl);
    this.uCamPos = gl.getUniformLocation(this.program, 'uCamPos');
    this.uViewHalfWorld = gl.getUniformLocation(this.program, 'uViewHalfWorld');
    this.uAtlas = gl.getUniformLocation(this.program, 'uAtlas');
    this.uTexelSize = gl.getUniformLocation(this.program, 'uTexelSize');

    const vao = gl.createVertexArray();
    const quadVbo = gl.createBuffer();
    const instanceVbo = gl.createBuffer();
    const atlasTex = gl.createTexture();
    const fontTex = gl.createTexture();
    if (!vao || !quadVbo || !instanceVbo || !atlasTex || !fontTex) {
      throw new Error('Failed to allocate WebGL2 GPU objects');
    }
    this.vao = vao;
    this.quadVbo = quadVbo;
    this.instanceVbo = instanceVbo;
    this.atlasTex = atlasTex;
    this.fontTex = fontTex;

    gl.bindVertexArray(this.vao);

    // Static unit quad (triangle strip)
    const unitQuad = new Float32Array([
      -0.5, -0.5,
       0.5, -0.5,
      -0.5,  0.5,
       0.5,  0.5,
    ]);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quadVbo);
    gl.bufferData(gl.ARRAY_BUFFER, unitQuad, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

    // Pre-allocated dynamic instance buffer (16,384 quads * 64 bytes = 1 MB)
    gl.bindBuffer(gl.ARRAY_BUFFER, this.instanceVbo);
    gl.bufferData(gl.ARRAY_BUFFER, this.instanceData.byteLength, gl.DYNAMIC_DRAW);

    const stride = FLOATS_PER_QUAD * 4;
    for (let loc = 1; loc <= 4; loc++) {
      gl.enableVertexAttribArray(loc);
      gl.vertexAttribPointer(loc, 4, gl.FLOAT, false, stride, (loc - 1) * 16);
      gl.vertexAttribDivisor(loc, 1);
    }

    gl.bindVertexArray(null);

    // Configure atlas texture placeholder
    gl.bindTexture(gl.TEXTURE_2D, this.atlasTex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([255, 255, 255, 255]));

    // Bake comic bitmap glyph font texture ONCE at startup
    const bakedFont = bakeGlyphFontAtlas();
    this.glyphUvs = bakedFont.uvMap;
    gl.bindTexture(gl.TEXTURE_2D, this.fontTex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, bakedFont.canvas);

    gl.disable(gl.DEPTH_TEST);
    gl.enable(gl.BLEND);
    gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
  }

  private nextFxRand(): number {
    let x = this.fxRng;
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    this.fxRng = x >>> 0;
    return (this.fxRng & 0xffffff) / 0x1000000;
  }

  public resize(width: number, height: number, dpr: number): void {
    this.cssWidth = Math.max(1, width);
    this.cssHeight = Math.max(1, height);
    this.dpr = Math.max(1, Math.min(2.5, dpr));
    const pw = Math.round(this.cssWidth * this.dpr);
    const ph = Math.round(this.cssHeight * this.dpr);
    if (this.canvas.width !== pw || this.canvas.height !== ph) {
      this.canvas.width = pw;
      this.canvas.height = ph;
    }
    this.gl.viewport(0, 0, pw, ph);
  }

  public setAtlasSource(
    canvas: HTMLCanvasElement,
    regions: Map<string, AtlasRegion>,
    _customImages?: Map<string, HTMLImageElement | ImageBitmap>
  ): void {
    this.regions = regions;
    this.atlasWidth = Math.max(1, canvas.width);
    this.atlasHeight = Math.max(1, canvas.height);
    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, this.atlasTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, canvas);
  }

  public clearDecals(): void {
    for (let i = 0; i < MAX_DECALS; i++) this.decals[i].active = false;
    for (let i = 0; i < MAX_PARTICLES; i++) this.particles[i].active = false;
    for (let i = 0; i < MAX_FLOATING_TEXTS; i++) this.floatingTexts[i].active = false;
    this.decalCursor = 0;
    this.particleCursor = 0;
    this.textCursor = 0;
  }

  private addDecal(spriteId: string, x: number, y: number, size: number, r: number, g: number, b: number, a: number): void {
    const d = this.decals[this.decalCursor];
    this.decalCursor = (this.decalCursor + 1) % MAX_DECALS;
    d.active = true;
    d.spriteId = spriteId;
    d.x = x;
    d.y = y;
    d.size = size;
    d.rot = this.nextFxRand() * Math.PI * 2;
    d.r = r;
    d.g = g;
    d.b = b;
    d.a = a;
  }

  private spawnParticle(
    spriteId: string,
    x: number,
    y: number,
    vx: number,
    vy: number,
    size: number,
    endSize: number,
    life: number,
    r: number,
    g: number,
    b: number,
    a = 1
  ): void {
    const p = this.particles[this.particleCursor];
    this.particleCursor = (this.particleCursor + 1) % MAX_PARTICLES;
    p.active = true;
    p.spriteId = spriteId;
    p.x = x;
    p.y = y;
    p.vx = vx;
    p.vy = vy;
    p.size = size;
    p.endSize = endSize;
    p.rot = this.nextFxRand() * Math.PI * 2;
    p.vRot = (this.nextFxRand() - 0.5) * 8;
    p.life = life;
    p.maxLife = life;
    p.r = r;
    p.g = g;
    p.b = b;
    p.a = a;
  }

  private spawnFloatingText(text: string, x: number, y: number, scale: number, r: number, g: number, b: number): void {
    const ft = this.floatingTexts[this.textCursor];
    this.textCursor = (this.textCursor + 1) % MAX_FLOATING_TEXTS;
    ft.active = true;
    ft.text = text.toUpperCase();
    ft.x = x + (this.nextFxRand() - 0.5) * 18;
    ft.y = y - 16;
    ft.vy = -68 - this.nextFxRand() * 24;
    ft.scale = scale;
    ft.life = 0.68;
    ft.maxLife = 0.68;
    ft.r = r;
    ft.g = g;
    ft.b = b;
  }

  public onSimEvents(events: readonly SimEvent[], _state: SimState): void {
    const rgb = this.scratchRgb;
    for (let i = 0; i < events.length; i++) {
      const ev = events[i];
      switch (ev.type) {
        case 'decal': {
          parseHexRgb(ev.color, rgb);
          const id = ev.kind === 'scorch' ? 'vfx_scorch' : ev.kind === 'crater' ? 'vfx_crater' : 'vfx_splat';
          this.addDecal(id, ev.x, ev.y, ev.radius * 2, rgb[0], rgb[1], rgb[2], ev.kind === 'splat' ? 0.36 : 0.55);
          break;
        }
        case 'weapon_fire': {
          if (!ev.isMelee) {
            const mx = ev.x + Math.cos(ev.angle) * 20;
            const my = ev.y + Math.sin(ev.angle) * 20;
            this.spawnParticle('vfx_spark', mx, my, Math.cos(ev.angle) * 80, Math.sin(ev.angle) * 80, 22, 4, 0.1, 1, 0.92, 0.45, 0.95);
          }
          break;
        }
        case 'enemy_hit': {
          const dmgText = ev.isCrit ? `${Math.round(ev.damage)}!` : `${Math.round(ev.damage)}`;
          if (ev.isCrit) {
            this.spawnFloatingText(dmgText, ev.x, ev.y - 10, 1.38, 1.0, 0.88, 0.2);
          } else {
            this.spawnFloatingText(dmgText, ev.x, ev.y - 4, 1.0, 1.0, 1.0, 1.0);
          }
          for (let k = 0; k < (ev.isCrit ? 5 : 2); k++) {
            const a = this.nextFxRand() * Math.PI * 2;
            const spd = 90 + this.nextFxRand() * 140;
            this.spawnParticle(
              'vfx_spark',
              ev.x,
              ev.y,
              Math.cos(a) * spd,
              Math.sin(a) * spd,
              ev.isCrit ? 16 : 11,
              2,
              0.22,
              1.0,
              ev.isCrit ? 0.85 : 0.95,
              ev.isCrit ? 0.25 : 0.85,
              0.95
            );
          }
          break;
        }
        case 'enemy_die': {
          parseHexRgb(ev.color, rgb);
          this.addDecal('vfx_splat', ev.x, ev.y, ev.isBoss ? 120 : ev.isElite ? 76 : 44, rgb[0] * 0.72, rgb[1] * 0.72, rgb[2] * 0.72, 0.34);
          const count = ev.isBoss ? 22 : ev.isElite ? 12 : 6;
          for (let k = 0; k < count; k++) {
            const a = this.nextFxRand() * Math.PI * 2;
            const spd = 70 + this.nextFxRand() * (ev.isBoss ? 280 : 170);
            this.spawnParticle('vfx_circle', ev.x, ev.y, Math.cos(a) * spd, Math.sin(a) * spd, ev.isBoss ? 18 : 11, 2, 0.35, rgb[0], rgb[1], rgb[2], 0.92);
          }
          break;
        }
        case 'explosion': {
          this.addDecal('vfx_scorch', ev.x, ev.y, ev.radius * 1.65, 1, 1, 1, 0.52);
          this.spawnParticle('vfx_ring', ev.x, ev.y, 0, 0, ev.radius * 0.5, ev.radius * 2.1, 0.28, 1.0, 0.65, 0.22, 0.9);
          for (let k = 0; k < 8; k++) {
            const a = this.nextFxRand() * Math.PI * 2;
            const spd = 80 + this.nextFxRand() * 190;
            this.spawnParticle('vfx_spark', ev.x, ev.y, Math.cos(a) * spd, Math.sin(a) * spd, 18, 3, 0.3, 1.0, 0.55, 0.18, 0.95);
          }
          break;
        }
        case 'player_hit': {
          this.spawnFloatingText(`-${Math.round(ev.damage)}`, ev.x, ev.y - 24, 1.22, 1.0, 0.26, 0.3);
          for (let k = 0; k < 6; k++) {
            const a = this.nextFxRand() * Math.PI * 2;
            this.spawnParticle('vfx_spark', ev.x, ev.y - 12, Math.cos(a) * 140, Math.sin(a) * 140, 14, 2, 0.25, 1.0, 0.22, 0.28, 1);
          }
          break;
        }
        case 'player_dodge': {
          this.spawnFloatingText('DODGE', ev.x, ev.y - 26, 1.15, 0.32, 0.9, 1.0);
          this.spawnParticle('vfx_ring', ev.x, ev.y - 12, 0, 0, 24, 62, 0.25, 0.35, 0.92, 1.0, 0.8);
          break;
        }
        case 'player_heal': {
          this.spawnFloatingText(`+${Math.round(ev.amount)}`, ev.x, ev.y - 22, 1.08, 0.32, 0.95, 0.45);
          break;
        }
        case 'pickup_material': {
          this.spawnFloatingText(`+${Math.round(ev.value)}`, ev.x, ev.y - 12, ev.isBoosted ? 1.1 : 0.85, 0.48, 1.0, 0.32);
          this.spawnParticle('vfx_spark', ev.x, ev.y, 0, -50, 14, 2, 0.2, 0.48, 1.0, 0.32, 0.9);
          break;
        }
        case 'level_up': {
          this.spawnFloatingText('LEVEL UP!', ev.x, ev.y - 42, 1.45, 1.0, 0.9, 0.25);
          this.spawnParticle('vfx_ring', ev.x, ev.y - 14, 0, 0, 24, 130, 0.45, 1.0, 0.9, 0.25, 0.95);
          for (let k = 0; k < 12; k++) {
            const a = (k / 12) * Math.PI * 2;
            this.spawnParticle('vfx_spark', ev.x, ev.y - 14, Math.cos(a) * 190, Math.sin(a) * 190, 18, 3, 0.45, 1.0, 0.92, 0.3, 1);
          }
          break;
        }
        case 'wave_start': {
          this.clearDecals();
          break;
        }
        default:
          break;
      }
    }
  }

  private getRegion(id: string, fallback = 'vfx_circle'): AtlasRegion {
    return this.regions.get(id) ?? this.regions.get(fallback) ?? DEFAULT_WHITE_REGION;
  }

  private pushQuad(
    region: AtlasRegion,
    x: number,
    y: number,
    w: number,
    h: number,
    rot: number,
    r: number,
    g: number,
    b: number,
    a: number,
    hitFlash = 0,
    outlineMode = 0,
    flipFlags = 0
  ): void {
    if (this.quadCount >= MAX_QUADS) return;
    const base = this.quadCount * FLOATS_PER_QUAD;
    const d = this.instanceData;
    d[base + 0] = x;
    d[base + 1] = y;
    d[base + 2] = w;
    d[base + 3] = h;
    d[base + 4] = region.u0;
    d[base + 5] = region.v0;
    d[base + 6] = region.u1;
    d[base + 7] = region.v1;
    d[base + 8] = r;
    d[base + 9] = g;
    d[base + 10] = b;
    d[base + 11] = a;
    d[base + 12] = rot;
    d[base + 13] = hitFlash;
    d[base + 14] = outlineMode;
    d[base + 15] = flipFlags;
    this.quadCount++;
  }

  private pushTextQuad(
    u0: number,
    v0: number,
    u1: number,
    v1: number,
    x: number,
    y: number,
    w: number,
    h: number,
    r: number,
    g: number,
    b: number,
    a: number
  ): void {
    if (this.textQuadCount >= MAX_TEXT_QUADS) return;
    const base = this.textQuadCount * FLOATS_PER_QUAD;
    const d = this.textInstanceData;
    d[base + 0] = x;
    d[base + 1] = y;
    d[base + 2] = w;
    d[base + 3] = h;
    d[base + 4] = u0;
    d[base + 5] = v0;
    d[base + 6] = u1;
    d[base + 7] = v1;
    d[base + 8] = r;
    d[base + 9] = g;
    d[base + 10] = b;
    d[base + 11] = a;
    d[base + 12] = 0;
    d[base + 13] = 0;
    d[base + 14] = 0;
    d[base + 15] = 0;
    this.textQuadCount++;
  }

  private stepVisualPools(dt: number): void {
    for (let i = 0; i < MAX_PARTICLES; i++) {
      const p = this.particles[i];
      if (!p.active) continue;
      p.life -= dt;
      if (p.life <= 0) {
        p.active = false;
        continue;
      }
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vx *= 0.92;
      p.vy *= 0.92;
      p.rot += p.vRot * dt;
    }
    for (let i = 0; i < MAX_FLOATING_TEXTS; i++) {
      const ft = this.floatingTexts[i];
      if (!ft.active) continue;
      ft.life -= dt;
      if (ft.life <= 0) {
        ft.active = false;
        continue;
      }
      ft.y += ft.vy * dt;
      ft.vy *= 0.93;
    }
  }

  public render(state: SimState, interpAlpha: number, settings: RenderSettings): void {
    const alpha = settings.classicSnap60 ? 1.0 : Math.max(0, Math.min(1, interpAlpha));
    const dt = 1 / 60;
    this.animClock += dt;
    this.stepVisualPools(dt);

    const gl = this.gl;
    const bg = getZoneBackdropRgb(state.zoneId);
    gl.clearColor(bg[0], bg[1], bg[2], 1.0);
    gl.clear(gl.COLOR_BUFFER_BIT);

    this.quadCount = 0;
    this.textQuadCount = 0;

    // Camera interpolation + optional screen shake
    const camX = lerp(state.camera.prevX, state.camera.x, alpha) + (settings.screenShake ? state.camera.shakeOffsetX : 0);
    const camY = lerp(state.camera.prevY, state.camera.y, alpha) + (settings.screenShake ? state.camera.shakeOffsetY : 0);
    const zoom = computeViewportZoom(this.cssWidth, this.cssHeight, state.camera.zoom);
    const halfWorldW = this.cssWidth / (2 * zoom);
    const halfWorldH = this.cssHeight / (2 * zoom);

    // ------------------------------------------------------------------
    // LAYER 1: Arena Perimeter Walls + Floor Tiles (3 distinct Zone palettes)
    // ------------------------------------------------------------------
    const whiteReg = this.getRegion('vfx_white');
    const wallRgb = getZoneWallRgb(state.zoneId);
    const trimRgb = getZoneTrimRgb(state.zoneId);

    // Outer boundary wall slabs (EDGE_SIZE = 96px)
    const wallT = EDGE_SIZE;
    this.pushQuad(whiteReg, ARENA_W / 2, -wallT / 2 + EDGE_MAP_DIST / 2, ARENA_W + wallT * 2, wallT + EDGE_MAP_DIST, 0, wallRgb[0], wallRgb[1], wallRgb[2], 1);
    this.pushQuad(whiteReg, ARENA_W / 2, ARENA_H + wallT / 2 - EDGE_MAP_DIST / 2, ARENA_W + wallT * 2, wallT + EDGE_MAP_DIST, 0, wallRgb[0], wallRgb[1], wallRgb[2], 1);
    this.pushQuad(whiteReg, -wallT / 2 + EDGE_MAP_DIST / 2, ARENA_H / 2, wallT + EDGE_MAP_DIST, ARENA_H, 0, wallRgb[0], wallRgb[1], wallRgb[2], 1);
    this.pushQuad(whiteReg, ARENA_W + wallT / 2 - EDGE_MAP_DIST / 2, ARENA_H / 2, wallT + EDGE_MAP_DIST, ARENA_H, 0, wallRgb[0], wallRgb[1], wallRgb[2], 1);

    // Playable floor tile grid (128x128 tiles across 2048x1536 -> 16x12 = 192 quads)
    const tileStep = 128;
    const tileCols = Math.ceil(ARENA_W / tileStep);
    const tileRows = Math.ceil(ARENA_H / tileStep);
    const tilePrefix = state.zoneId === 1 ? 'tile_abyss_' : state.zoneId === 2 ? 'tile_jungle_' : 'tile_crash_';
    const tileMod = state.zoneId === 0 ? 6 : 3;
    for (let ty = 0; ty < tileRows; ty++) {
      for (let tx = 0; tx < tileCols; tx++) {
        const idx = ((tx * 7 + ty * 13 + tx * ty * 3) >>> 0) % tileMod;
        const tileId = `${tilePrefix}${state.zoneId === 0 ? idx + 1 : idx}`;
        const reg = this.getRegion(tileId, `${tilePrefix}1`);
        this.pushQuad(reg, tx * tileStep + tileStep / 2, ty * tileStep + tileStep / 2, tileStep + 1, tileStep + 1, 0, 1, 1, 1, 1);
      }
    }

    // Crisp playable boundary perimeter trim (EDGE_MAP_DIST = 64px)
    const minX = EDGE_MAP_DIST;
    const maxX = ARENA_W - EDGE_MAP_DIST;
    const minY = EDGE_MAP_DIST;
    const maxY = ARENA_H - EDGE_MAP_DIST;
    const playW = maxX - minX;
    const playH = maxY - minY;
    const trimW = 6;
    this.pushQuad(whiteReg, ARENA_W / 2, minY, playW + trimW, trimW, 0, trimRgb[0], trimRgb[1], trimRgb[2], 0.72);
    this.pushQuad(whiteReg, ARENA_W / 2, maxY, playW + trimW, trimW, 0, trimRgb[0], trimRgb[1], trimRgb[2], 0.72);
    this.pushQuad(whiteReg, minX, ARENA_H / 2, trimW, playH + trimW, 0, trimRgb[0], trimRgb[1], trimRgb[2], 0.72);
    this.pushQuad(whiteReg, maxX, ARENA_H / 2, trimW, playH + trimW, 0, trimRgb[0], trimRgb[1], trimRgb[2], 0.72);

    // ------------------------------------------------------------------
    // LAYER 2: Persistent Floor Decals
    // ------------------------------------------------------------------
    for (let i = 0; i < MAX_DECALS; i++) {
      const d = this.decals[i];
      if (!d.active) continue;
      this.pushQuad(this.getRegion(d.spriteId), d.x, d.y, d.size, d.size, d.rot, d.r, d.g, d.b, d.a);
    }

    // ------------------------------------------------------------------
    // LAYER 3: Soft Ground Contact Shadows
    // ------------------------------------------------------------------
    const shadowReg = this.getRegion('vfx_shadow');
    for (let i = 0; i < state.trees.length; i++) {
      const t = state.trees[i];
      this.pushQuad(shadowReg, t.x, t.y + 18, t.radius * 2.5, t.radius * 1.4, 0, 1, 1, 1, 0.7);
    }
    for (let i = 0; i < state.structures.length; i++) {
      const s = state.structures[i];
      this.pushQuad(shadowReg, s.x, s.y + 12, 48, 28, 0, 1, 1, 1, 0.65);
    }
    for (let i = 0; i < state.pickups.length; i++) {
      const pk = state.pickups[i];
      const px = lerp(pk.prevX, pk.x, alpha);
      const py = lerp(pk.prevY, pk.y, alpha);
      this.pushQuad(shadowReg, px, py + 9, 26 * pk.scale, 15 * pk.scale, 0, 1, 1, 1, 0.55);
    }
    for (let i = 0; i < state.enemies.length; i++) {
      const e = state.enemies[i];
      const ex = lerp(e.prevX, e.x, alpha);
      const ey = lerp(e.prevY, e.y, alpha);
      this.pushQuad(shadowReg, ex, ey + e.radius * 0.68, e.radius * 2.1, e.radius * 1.15, 0, 1, 1, 1, 0.7);
    }
    const playerX = lerp(state.player.prevX, state.player.x, alpha);
    const playerY = lerp(state.player.prevY, state.player.y, alpha);
    this.pushQuad(shadowReg, playerX, playerY + 6, 52, 28, 0, 1, 1, 1, 0.75);

    // ------------------------------------------------------------------
    // LAYER 4: Spawn Telegraphs (Accelerating Pulsing Crimson X)
    // ------------------------------------------------------------------
    const spawnXReg = this.getRegion('vfx_spawn_x', 'spawn_telegraph');
    const ringReg = this.getRegion('vfx_ring');
    for (let i = 0; i < state.telegraphs.length; i++) {
      const tg = state.telegraphs[i];
      const prog = 1 - tg.ticksLeft / Math.max(1, tg.totalTicks);
      const freq = 8 + prog * 28;
      const blink = 0.52 + 0.48 * Math.sin(this.animClock * freq);
      const sz = (tg.isBoss ? 104 : tg.isElite ? 76 : 48) * (0.85 + 0.25 * blink);
      if (tg.isBoss || tg.isElite) {
        const cr = tg.isBoss ? 1.0 : 0.85;
        const cg = tg.isBoss ? 0.2 : 0.45;
        const cb = tg.isBoss ? 0.25 : 1.0;
        this.pushQuad(ringReg, tg.x, tg.y, sz * 1.45, sz * 1.45, 0, cr, cg, cb, 0.65 * blink);
      }
      this.pushQuad(spawnXReg, tg.x, tg.y, sz, sz, 0, 1, 1, 1, 0.45 + 0.55 * blink);
    }

    // ------------------------------------------------------------------
    // LAYER 5: Pickups, Structures & Trees
    // ------------------------------------------------------------------
    for (let i = 0; i < state.pickups.length; i++) {
      this.renderPickup(state.pickups[i], alpha, ringReg);
    }

    for (let i = 0; i < state.structures.length; i++) {
      this.renderStructure(state.structures[i]);
    }

    const treeSprite = state.zoneId === 2 ? 'tree_jungle' : 'tree_0';
    const treeReg = this.getRegion(treeSprite, 'tree_0');
    for (let i = 0; i < state.trees.length; i++) {
      const t = state.trees[i];
      const flash = settings.hitFlash && t.hitFlashTicks > 0 ? 0.85 : 0;
      const sz = t.radius * 2.9;
      this.pushQuad(treeReg, t.x, t.y - 10, sz, sz, 0, 1, 1, 1, 1, flash);
      if (t.hp < t.maxHp && t.maxHp > 0) {
        this.drawWorldBar(whiteReg, t.x, t.y - sz * 0.55, 44, 6, t.hp / t.maxHp, 0.35, 0.9, 0.42);
      }
    }

    // Ground hazards (acid pools / telegraph rings / orb zones)
    for (let i = 0; i < state.hazards.length; i++) {
      const hz = state.hazards[i];
      if (hz.kind === 'acid_pool' || hz.kind === 'boss_orb_zone' || hz.kind === 'fog_pulse') {
        this.renderHazard(hz, whiteReg, ringReg);
      }
    }

    // ------------------------------------------------------------------
    // LAYER 6: Enemies, Elites & Bosses
    // ------------------------------------------------------------------
    for (let i = 0; i < state.enemies.length; i++) {
      this.renderEnemy(state.enemies[i], alpha, settings, whiteReg, ringReg);
    }

    // ------------------------------------------------------------------
    // LAYER 7: Player Spud & Orbiting Weapons
    // ------------------------------------------------------------------
    const p = state.player;
    const isMoving = Math.abs(p.vx) > 8 || Math.abs(p.vy) > 8;
    const walkWave = isMoving ? Math.sin(p.walkAnimPhase * 2) : Math.sin(this.animClock * 4) * 0.25;
    const squashX = 1 + walkWave * 0.085;
    const squashY = 1 - walkWave * 0.085;
    const hopY = isMoving ? -Math.abs(Math.sin(p.walkAnimPhase)) * 6 : 0;

    const iframeBlink = p.iframesTicks > 0 && Math.floor(p.iframesTicks / 3) % 2 === 0 ? 0.55 : 1.0;
    const playerFlash = settings.hitFlash && p.hitFlashTicks > 0 ? 0.9 : 0;
    const playerSpriteId = `char_${p.characterId}`;
    const playerReg = this.getRegion(playerSpriteId, 'player_body');
    const flipPlayer = p.facingX < 0 ? 1 : 0;

    if (p.hitProtectionLeft > 0) {
      this.pushQuad(ringReg, playerX, playerY - 18, 72, 72, 0, 0.35, 0.85, 1.0, 0.55);
    }

    this.pushQuad(
      playerReg,
      playerX,
      playerY - 22 + hopY,
      62 * squashX,
      62 * squashY,
      0,
      1,
      1,
      1,
      iframeBlink,
      playerFlash,
      0,
      flipPlayer
    );

    // Floating orbiting weapons
    for (let i = 0; i < p.weapons.length; i++) {
      this.renderWeapon(p.weapons[i], alpha);
    }

    // ------------------------------------------------------------------
    // LAYER 8: Melee Slashes, Explosions, Player Projectiles & Sparks
    // ------------------------------------------------------------------
    for (let i = 0; i < state.hazards.length; i++) {
      const hz = state.hazards[i];
      if (hz.kind === 'melee_slash' || hz.kind === 'explosion') {
        this.renderHazard(hz, whiteReg, ringReg);
      }
    }

    for (let i = 0; i < state.projectiles.length; i++) {
      const proj = state.projectiles[i];
      if (proj.owner !== 'enemy') {
        this.renderProjectile(proj, alpha);
      }
    }

    for (let i = 0; i < MAX_PARTICLES; i++) {
      const pt = this.particles[i];
      if (!pt.active) continue;
      const t = 1 - pt.life / pt.maxLife;
      const sz = lerp(pt.size, pt.endSize, t);
      this.pushQuad(this.getRegion(pt.spriteId), pt.x, pt.y, sz, sz, pt.rot, pt.r, pt.g, pt.b, pt.a * (1 - t));
    }

    // ------------------------------------------------------------------
    // LAYER 9: Enemy Projectiles & Boss Beams/Rings ALWAYS ON TOP
    // ------------------------------------------------------------------
    for (let i = 0; i < state.hazards.length; i++) {
      const hz = state.hazards[i];
      if (hz.kind === 'boss_beam' || hz.kind === 'boss_ring') {
        this.renderHazard(hz, whiteReg, ringReg);
      }
    }

    for (let i = 0; i < state.projectiles.length; i++) {
      const proj = state.projectiles[i];
      if (proj.owner === 'enemy') {
        this.renderProjectile(proj, alpha);
      }
    }

    // ------------------------------------------------------------------
    // LAYER 10: Nightmare Fog of War + Manual Aim Crosshair Reticle
    // ------------------------------------------------------------------
    if (state.nightmareEvent === 'fog_of_war') {
      // Subtle translucent dark vignette bands keeping clear combat visibility near player
      this.pushQuad(ringReg, playerX, playerY - 16, 860, 860, 0, 0.04, 0.02, 0.08, 0.45);
    }

    if (!state.autoAim || state.aimActive) {
      const chReg = this.getRegion('ui_crosshair', 'ui_manual_cursor');
      const pulse = 1 + Math.sin(this.animClock * 10) * 0.08;
      this.pushQuad(chReg, state.manualAimWorldX, state.manualAimWorldY, 44 * pulse, 44 * pulse, 0, 1, 1, 1, 0.94);
    }

    // ------------------------------------------------------------------
    // FLUSH PASS 1: Main World & Entity Sprite Batch
    // ------------------------------------------------------------------
    gl.useProgram(this.program);
    gl.bindVertexArray(this.vao);
    gl.uniform2f(this.uCamPos, camX, camY);
    gl.uniform2f(this.uViewHalfWorld, halfWorldW, halfWorldH);
    gl.uniform1i(this.uAtlas, 0);

    let drawCalls = 0;
    let totalQuads = 0;

    if (this.quadCount > 0) {
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, this.atlasTex);
      gl.uniform2f(this.uTexelSize, 1 / this.atlasWidth, 1 / this.atlasHeight);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.instanceVbo);
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, this.instanceData.subarray(0, this.quadCount * FLOATS_PER_QUAD));
      gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, this.quadCount);
      drawCalls++;
      totalQuads += this.quadCount;
    }

    // ------------------------------------------------------------------
    // LAYER 11 / FLUSH PASS 2: Floating Damage Numbers (Pre-baked Comic Glyphs)
    // ------------------------------------------------------------------
    if (settings.damageNumbers) {
      for (let i = 0; i < MAX_FLOATING_TEXTS; i++) {
        const ft = this.floatingTexts[i];
        if (!ft.active) continue;
        const age = 1 - ft.life / ft.maxLife;
        const pop = age < 0.14 ? 0.65 + (age / 0.14) * 0.55 : 1.0;
        const fade = age > 0.65 ? Math.max(0, 1 - (age - 0.65) / 0.35) : 1.0;
        const charW = 22 * ft.scale * pop;
        const charH = 28 * ft.scale * pop;
        const spacing = charW * 0.68;
        const startX = ft.x - ((ft.text.length - 1) * spacing) / 2;

        for (let cIdx = 0; cIdx < ft.text.length; cIdx++) {
          const uv = this.glyphUvs.get(ft.text[cIdx]);
          if (!uv) continue;
          this.pushTextQuad(uv[0], uv[1], uv[2], uv[3], startX + cIdx * spacing, ft.y, charW, charH, ft.r, ft.g, ft.b, fade);
        }
      }

      if (this.textQuadCount > 0) {
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, this.fontTex);
        gl.uniform2f(this.uTexelSize, 1 / GLYPH_ATLAS_W, 1 / GLYPH_ATLAS_H);
        gl.bindBuffer(gl.ARRAY_BUFFER, this.instanceVbo);
        gl.bufferSubData(gl.ARRAY_BUFFER, 0, this.textInstanceData.subarray(0, this.textQuadCount * FLOATS_PER_QUAD));
        gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, this.textQuadCount);
        drawCalls++;
        totalQuads += this.textQuadCount;
      }
    }

    gl.bindVertexArray(null);
    this.lastDrawCalls = drawCalls;
    this.lastQuadCount = totalQuads;
  }

  private renderPickup(pk: PickupState, alpha: number, ringReg: AtlasRegion): void {
    const x = lerp(pk.prevX, pk.x, alpha);
    const y = lerp(pk.prevY, pk.y, alpha);
    const bob = Math.sin(this.animClock * 5 + pk.uid * 0.7) * 3;

    if (pk.kind === 'material') {
      const sz = 24 * pk.scale;
      if (pk.isBagBoosted) {
        const pulse = 1 + Math.sin(this.animClock * 8 + pk.uid) * 0.14;
        this.pushQuad(ringReg, x, y + bob, sz * 1.45 * pulse, sz * 1.45 * pulse, 0, 0.48, 1.0, 0.3, 0.72);
      }
      const matId = `material_${pk.uid % 11}`;
      this.pushQuad(this.getRegion(matId, 'material_0'), x, y + bob, sz, sz, 0, 1, 1, 1, 1);
    } else if (pk.kind === 'consumable') {
      const pulse = 1 + Math.sin(this.animClock * 6 + pk.uid) * 0.08;
      this.pushQuad(ringReg, x, y + bob, 36 * pulse, 36 * pulse, 0, 1.0, 0.25, 0.35, 0.4);
      this.pushQuad(this.getRegion('consumable_fruit', 'fruit'), x, y + bob, 30 * pulse, 30 * pulse, 0, 1, 1, 1, 1);
    } else {
      const isLeg = pk.kind === 'legendary_crate';
      const pulse = 1 + Math.sin(this.animClock * 5) * 0.1;
      this.pushQuad(ringReg, x, y + bob, 54 * pulse, 54 * pulse, 0, isLeg ? 1.0 : 1.0, isLeg ? 0.22 : 0.82, isLeg ? 0.25 : 0.22, 0.65);
      const id = isLeg ? 'crate_legendary' : 'crate_normal';
      this.pushQuad(this.getRegion(id, 'crate'), x, y + bob, 44, 44, 0, 1, 1, 1, 1, 0, isLeg ? 3 : 4);
    }
  }

  private renderStructure(s: StructureState): void {
    const id = `structure_${s.kind}`;
    const reg = this.getRegion(id, 'structure_turret');
    const flip = Math.cos(s.aimAngle) < 0 ? 1 : 0;
    const kick = s.recoil > 0 ? Math.min(8, s.recoil) : 0;
    const ox = -Math.cos(s.aimAngle) * kick;
    const oy = -Math.sin(s.aimAngle) * kick;
    this.pushQuad(reg, s.x + ox, s.y + oy - 8, 52, 52, 0, 1, 1, 1, 1, 0, 0, flip);
  }

  private renderEnemy(
    e: EnemyState,
    alpha: number,
    settings: RenderSettings,
    whiteReg: AtlasRegion,
    ringReg: AtlasRegion
  ): void {
    const ex = lerp(e.prevX, e.x, alpha);
    const ey = lerp(e.prevY, e.y, alpha);
    const wobble = Math.sin(this.animClock * 8 + e.uid * 1.3) * 0.06;
    const sz = Math.max(36, e.radius * 2.55);

    if (e.kind === 'boss') {
      const pulse = 1 + Math.sin(this.animClock * 5) * 0.08;
      this.pushQuad(ringReg, ex, ey, sz * 1.32 * pulse, sz * 1.32 * pulse, 0, 1.0, 0.18, 0.28, 0.72);
    } else if (e.kind === 'elite') {
      const pulse = 1 + Math.sin(this.animClock * 6) * 0.07;
      this.pushQuad(ringReg, ex, ey, sz * 1.25 * pulse, sz * 1.25 * pulse, 0, 1.0, 0.82, 0.22, 0.65);
    }

    if (e.buffedTicks > 0) {
      this.pushQuad(ringReg, ex, ey, sz * 1.15, sz * 1.15, 0, 0.78, 0.38, 1.0, 0.6);
    }

    const r = e.burnTicksLeft > 0 ? 1.0 : e.slowTicks > 0 ? 0.65 : 1.0;
    const g = e.burnTicksLeft > 0 ? 0.68 : e.slowTicks > 0 ? 0.88 : 1.0;
    const b = e.burnTicksLeft > 0 ? 0.45 : 1.0;
    const flash = settings.hitFlash && e.hitFlashTicks > 0 ? 0.92 : 0;
    const outline = e.kind === 'boss' ? 3 : e.kind === 'elite' ? 4 : 0;
    const flip = e.facingX < 0 ? 1 : 0;

    // Windup telegraph pulse before dash/charge
    const windupScale = e.state === 'windup' ? 1.0 + Math.sin(this.animClock * 24) * 0.12 : 1.0;
    const spriteId = e.defId.startsWith('enemy_') ? e.defId : `enemy_${e.defId}`;
    this.pushQuad(
      this.getRegion(spriteId, 'enemy_baby_alien'),
      ex,
      ey - 4,
      sz * (1 + wobble) * windupScale,
      sz * (1 - wobble) * windupScale,
      0,
      r,
      g,
      b,
      1,
      flash,
      outline,
      flip
    );

    if ((e.kind === 'elite' || (e.maxHp >= 60 && e.hp < e.maxHp)) && e.kind !== 'boss') {
      this.drawWorldBar(
        whiteReg,
        ex,
        ey - sz * 0.62,
        e.kind === 'elite' ? 64 : 38,
        e.kind === 'elite' ? 7 : 5,
        e.hp / Math.max(1, e.maxHp),
        e.kind === 'elite' ? 1.0 : 0.95,
        e.kind === 'elite' ? 0.78 : 0.25,
        e.kind === 'elite' ? 0.22 : 0.3
      );
    }
  }

  private renderWeapon(w: EquippedWeaponState, alpha: number): void {
    const wx = lerp(w.prevWorldX, w.worldX, alpha);
    const wy = lerp(w.prevWorldY, w.worldY, alpha);

    let angle = w.aimAngle;
    let offset = -w.recoilOffset;
    if (w.swingTimer > 0 && w.swingDuration > 0) {
      const p = 1 - w.swingTimer / w.swingDuration;
      if (w.swingType === 0) {
        // Thrust jab out and retract smoothly
        offset += Math.sin(p * Math.PI) * 38;
      } else {
        // Sweep cleave arc
        angle += (p - 0.5) * 2.1 * w.swingDir;
        offset += Math.sin(p * Math.PI) * 18;
      }
    }

    const drawX = wx + Math.cos(angle) * offset;
    const drawY = wy + Math.sin(angle) * offset;
    const flipY = Math.cos(angle) < 0 ? 2 : 0;
    const outlineMode = w.tier >= 2 ? w.tier - 1 : 0;
    const spriteId = w.weaponId.startsWith('weapon_') ? w.weaponId : `weapon_${w.weaponId}`;

    this.pushQuad(
      this.getRegion(spriteId, 'weapon_pistol'),
      drawX,
      drawY,
      44,
      44,
      angle,
      1,
      1,
      1,
      1,
      0,
      outlineMode,
      flipY
    );
  }

  private renderProjectile(proj: ProjectileState, alpha: number): void {
    const x = lerp(proj.prevX, proj.x, alpha);
    const y = lerp(proj.prevY, proj.y, alpha);
    const ang = Math.atan2(proj.vy, proj.vx);

    if (proj.owner === 'enemy') {
      const pulse = 1 + Math.sin(this.animClock * 16 + proj.uid) * 0.1;
      const sz = Math.max(24, proj.radius * 3.1) * pulse;
      this.pushQuad(this.getRegion('proj_enemy'), x, y, sz, sz, ang, 1, 1, 1, 1);
      return;
    }

    const sz = Math.max(22, proj.radius * 2.8);
    const reg = this.getRegion(proj.spriteId || 'proj_bullet', 'proj_bullet');
    this.pushQuad(reg, x, y, sz, sz, ang, 1, 1, 1, 1);
  }

  private renderHazard(hz: HazardState, whiteReg: AtlasRegion, ringReg: AtlasRegion): void {
    const rgb = this.scratchRgb;
    parseHexRgb(hz.color, rgb);
    const prog = 1 - hz.ticksLeft / Math.max(1, hz.maxTicks);

    if (hz.kind === 'melee_slash') {
      const fade = Math.max(0, 1 - prog);
      const sz = Math.max(70, hz.radius * 2.15);
      this.pushQuad(this.getRegion('vfx_slash'), hz.x, hz.y, sz, sz, hz.angle, rgb[0], rgb[1], rgb[2], 0.85 * fade);
      return;
    }

    if (hz.kind === 'explosion') {
      const scale = 0.55 + prog * 0.7;
      const fade = Math.max(0, 1 - prog * prog);
      const sz = hz.radius * 2.1 * scale;
      this.pushQuad(this.getRegion('vfx_explosion'), hz.x, hz.y, sz, sz, prog * 0.8, 1, 1, 1, fade);
      return;
    }

    if (hz.kind === 'boss_beam') {
      const dx = hz.endX - hz.x;
      const dy = hz.endY - hz.y;
      const len = Math.max(10, Math.hypot(dx, dy));
      const ang = Math.atan2(dy, dx);
      const mx = (hz.x + hz.endX) / 2;
      const my = (hz.y + hz.endY) / 2;
      const isTelegraph = hz.activeDelayTicks > 0;
      const thickness = isTelegraph ? Math.max(6, hz.radius * 0.4) : Math.max(22, hz.radius * 1.8);
      const alpha = isTelegraph ? 0.35 + 0.35 * Math.sin(this.animClock * 24) : 0.92;
      this.pushQuad(whiteReg, mx, my, len, thickness, ang, 1.0, isTelegraph ? 0.25 : 0.15, isTelegraph ? 0.35 : 0.22, alpha);
      if (!isTelegraph) {
        this.pushQuad(whiteReg, mx, my, len, thickness * 0.42, ang, 1, 1, 1, 0.95);
      }
      return;
    }

    if (hz.kind === 'boss_ring') {
      const isTelegraph = hz.activeDelayTicks > 0;
      const sz = hz.radius * 2;
      this.pushQuad(ringReg, hz.x, hz.y, sz, sz, 0, 1.0, 0.2, 0.32, isTelegraph ? 0.5 : 0.9);
      return;
    }

    // acid_pool / boss_orb_zone / fog_pulse
    const fade = Math.min(1, hz.ticksLeft / 15);
    this.pushQuad(this.getRegion('vfx_circle'), hz.x, hz.y, hz.radius * 2, hz.radius * 2, 0, rgb[0], rgb[1], rgb[2], 0.28 * fade);
    this.pushQuad(ringReg, hz.x, hz.y, hz.radius * 2, hz.radius * 2, 0, rgb[0], rgb[1], rgb[2], 0.72 * fade);
  }

  private drawWorldBar(
    whiteReg: AtlasRegion,
    cx: number,
    cy: number,
    w: number,
    h: number,
    ratio: number,
    r: number,
    g: number,
    b: number
  ): void {
    const clamped = Math.max(0, Math.min(1, ratio));
    this.pushQuad(whiteReg, cx, cy, w + 4, h + 4, 0, 0.08, 0.07, 0.11, 0.9);
    const fillW = w * clamped;
    if (fillW > 0.5) {
      this.pushQuad(whiteReg, cx - (w - fillW) / 2, cy, fillW, h, 0, r, g, b, 1);
    }
  }

  public getPerfSnapshot(): { drawCalls: number; quadCount: number } {
    return { drawCalls: this.lastDrawCalls, quadCount: this.lastQuadCount };
  }

  public dispose(): void {
    const gl = this.gl;
    gl.deleteTexture(this.atlasTex);
    gl.deleteTexture(this.fontTex);
    gl.deleteBuffer(this.instanceVbo);
    gl.deleteBuffer(this.quadVbo);
    gl.deleteVertexArray(this.vao);
    gl.deleteProgram(this.program);
  }
}
