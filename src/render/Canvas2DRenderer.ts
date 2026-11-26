// ============================================================================
// src/render/Canvas2DRenderer.ts
// Complete RendererAPI fallback using HTML5 Canvas 2D with full z-order,
// persistent decal ring buffer, particle pool, floating damage numbers, and
// ZERO per-frame canvas/gradient/buffer allocations.
// ============================================================================

import {
  ARENA_H,
  ARENA_W,
  EDGE_MAP_DIST,
  EDGE_SIZE,
  RARITY_COLORS,
  type AtlasRegion,
  type RendererAPI,
  type RenderSettings,
  type SimEvent,
  type SimState,
} from '../contracts/index';
import { computeViewportZoom } from './WebGL2Renderer';

const MAX_DECALS = 160;
const MAX_PARTICLES = 240;
const MAX_FLOATING_TEXTS = 96;

interface C2DDecal {
  active: boolean;
  spriteId: string;
  x: number;
  y: number;
  size: number;
  rot: number;
  alpha: number;
}

interface C2DParticle {
  active: boolean;
  x: number;
  y: number;
  vx: number;
  vy: number;
  size: number;
  life: number;
  maxLife: number;
  color: string;
}

interface C2DText {
  active: boolean;
  text: string;
  x: number;
  y: number;
  vy: number;
  scale: number;
  life: number;
  maxLife: number;
  color: string;
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export class Canvas2DRenderer implements RendererAPI {
  public readonly backend = 'canvas2d' as const;

  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private atlasCanvas: HTMLCanvasElement | null = null;
  private regions = new Map<string, AtlasRegion>();
  private cssWidth = 1280;
  private cssHeight = 720;
  private dpr = 1;
  private animClock = 0;
  private fxRng = 0x517cc1b7;
  private lastDrawCalls = 0;
  private lastQuadCount = 0;

  private readonly decals: C2DDecal[] = [];
  private decalCursor = 0;
  private readonly particles: C2DParticle[] = [];
  private particleCursor = 0;
  private readonly texts: C2DText[] = [];
  private textCursor = 0;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    const ctx = canvas.getContext('2d', { alpha: false });
    if (!ctx) throw new Error('Canvas2D context unavailable');
    this.ctx = ctx;

    for (let i = 0; i < MAX_DECALS; i++) {
      this.decals.push({ active: false, spriteId: 'vfx_splat', x: 0, y: 0, size: 40, rot: 0, alpha: 0.35 });
    }
    for (let i = 0; i < MAX_PARTICLES; i++) {
      this.particles.push({ active: false, x: 0, y: 0, vx: 0, vy: 0, size: 8, life: 0, maxLife: 0.3, color: '#ffffff' });
    }
    for (let i = 0; i < MAX_FLOATING_TEXTS; i++) {
      this.texts.push({ active: false, text: '', x: 0, y: 0, vy: -60, scale: 1, life: 0, maxLife: 0.65, color: '#ffffff' });
    }
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
    this.dpr = Math.max(1, Math.min(2, dpr));
    const pw = Math.round(this.cssWidth * this.dpr);
    const ph = Math.round(this.cssHeight * this.dpr);
    if (this.canvas.width !== pw || this.canvas.height !== ph) {
      this.canvas.width = pw;
      this.canvas.height = ph;
    }
  }

  public setAtlasSource(
    canvas: HTMLCanvasElement,
    regions: Map<string, AtlasRegion>,
    _customImages?: Map<string, HTMLImageElement | ImageBitmap>
  ): void {
    this.atlasCanvas = canvas;
    this.regions = regions;
  }

  public clearDecals(): void {
    for (let i = 0; i < MAX_DECALS; i++) this.decals[i].active = false;
    for (let i = 0; i < MAX_PARTICLES; i++) this.particles[i].active = false;
    for (let i = 0; i < MAX_FLOATING_TEXTS; i++) this.texts[i].active = false;
    this.decalCursor = 0;
    this.particleCursor = 0;
    this.textCursor = 0;
  }

  private addDecal(spriteId: string, x: number, y: number, size: number, alpha: number): void {
    const d = this.decals[this.decalCursor];
    this.decalCursor = (this.decalCursor + 1) % MAX_DECALS;
    d.active = true;
    d.spriteId = spriteId;
    d.x = x;
    d.y = y;
    d.size = size;
    d.rot = this.nextFxRand() * Math.PI * 2;
    d.alpha = alpha;
  }

  private addParticle(x: number, y: number, vx: number, vy: number, size: number, life: number, color: string): void {
    const p = this.particles[this.particleCursor];
    this.particleCursor = (this.particleCursor + 1) % MAX_PARTICLES;
    p.active = true;
    p.x = x;
    p.y = y;
    p.vx = vx;
    p.vy = vy;
    p.size = size;
    p.life = life;
    p.maxLife = life;
    p.color = color;
  }

  private addText(text: string, x: number, y: number, scale: number, color: string): void {
    const ft = this.texts[this.textCursor];
    this.textCursor = (this.textCursor + 1) % MAX_FLOATING_TEXTS;
    ft.active = true;
    ft.text = text;
    ft.x = x + (this.nextFxRand() - 0.5) * 16;
    ft.y = y - 16;
    ft.vy = -70;
    ft.scale = scale;
    ft.life = 0.65;
    ft.maxLife = 0.65;
    ft.color = color;
  }

  public onSimEvents(events: readonly SimEvent[], _state: SimState): void {
    for (let i = 0; i < events.length; i++) {
      const ev = events[i];
      switch (ev.type) {
        case 'decal':
          this.addDecal(
            ev.kind === 'scorch' ? 'vfx_scorch' : ev.kind === 'crater' ? 'vfx_crater' : 'vfx_splat',
            ev.x,
            ev.y,
            ev.radius * 2,
            0.42
          );
          break;
        case 'enemy_hit':
          this.addText(
            ev.isCrit ? `${Math.round(ev.damage)}!` : `${Math.round(ev.damage)}`,
            ev.x,
            ev.y,
            ev.isCrit ? 1.35 : 1.0,
            ev.isCrit ? '#ffe142' : '#ffffff'
          );
          break;
        case 'enemy_die':
          this.addDecal('vfx_splat', ev.x, ev.y, ev.isBoss ? 110 : ev.isElite ? 70 : 42, 0.32);
          for (let k = 0; k < 5; k++) {
            const a = this.nextFxRand() * Math.PI * 2;
            this.addParticle(ev.x, ev.y, Math.cos(a) * 140, Math.sin(a) * 140, 8, 0.3, ev.color || '#c048d8');
          }
          break;
        case 'explosion':
          this.addDecal('vfx_scorch', ev.x, ev.y, ev.radius * 1.6, 0.5);
          break;
        case 'player_hit':
          this.addText(`-${Math.round(ev.damage)}`, ev.x, ev.y - 20, 1.2, '#ff4757');
          break;
        case 'player_dodge':
          this.addText('DODGE', ev.x, ev.y - 24, 1.12, '#4ee4ff');
          break;
        case 'player_heal':
          this.addText(`+${Math.round(ev.amount)}`, ev.x, ev.y - 20, 1.05, '#4ade80');
          break;
        case 'pickup_material':
          this.addText(`+${Math.round(ev.value)}`, ev.x, ev.y - 10, 0.85, '#76ff45');
          break;
        case 'level_up':
          this.addText('LEVEL UP!', ev.x, ev.y - 36, 1.4, '#ffe142');
          break;
        case 'wave_start':
          this.clearDecals();
          break;
        default:
          break;
      }
    }
  }

  private drawSprite(
    id: string,
    fallback: string,
    x: number,
    y: number,
    w: number,
    h: number,
    rot = 0,
    flipX = false,
    flipY = false,
    alpha = 1
  ): void {
    const atlas = this.atlasCanvas;
    if (!atlas) return;
    const reg = this.regions.get(id) ?? this.regions.get(fallback);
    if (!reg) return;
    const ctx = this.ctx;
    ctx.save();
    if (alpha < 0.999) ctx.globalAlpha = alpha;
    ctx.translate(x, y);
    if (rot !== 0) ctx.rotate(rot);
    if (flipX || flipY) ctx.scale(flipX ? -1 : 1, flipY ? -1 : 1);
    ctx.drawImage(atlas, reg.x, reg.y, reg.w, reg.h, -w / 2, -h / 2, w, h);
    ctx.restore();
    this.lastQuadCount++;
  }

  public render(state: SimState, interpAlpha: number, settings: RenderSettings): void {
    const alpha = settings.classicSnap60 ? 1.0 : Math.max(0, Math.min(1, interpAlpha));
    const dt = 1 / 60;
    this.animClock += dt;
    this.lastQuadCount = 0;

    for (let i = 0; i < MAX_PARTICLES; i++) {
      const p = this.particles[i];
      if (!p.active) continue;
      p.life -= dt;
      if (p.life <= 0) p.active = false;
      else {
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        p.vx *= 0.92;
        p.vy *= 0.92;
      }
    }
    for (let i = 0; i < MAX_FLOATING_TEXTS; i++) {
      const ft = this.texts[i];
      if (!ft.active) continue;
      ft.life -= dt;
      if (ft.life <= 0) ft.active = false;
      else {
        ft.y += ft.vy * dt;
        ft.vy *= 0.93;
      }
    }

    const ctx = this.ctx;
    const pw = this.canvas.width;
    const ph = this.canvas.height;

    const bgHex = state.zoneId === 1 ? '#0e1822' : state.zoneId === 2 ? '#131f13' : '#1d1716';
    const wallHex = state.zoneId === 1 ? '#1c3547' : state.zoneId === 2 ? '#263d24' : '#3d302b';
    const trimHex = state.zoneId === 1 ? '#38c7f0' : state.zoneId === 2 ? '#6bcc57' : '#d98f57';

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = bgHex;
    ctx.fillRect(0, 0, pw, ph);

    const camX = lerp(state.camera.prevX, state.camera.x, alpha) + (settings.screenShake ? state.camera.shakeOffsetX : 0);
    const camY = lerp(state.camera.prevY, state.camera.y, alpha) + (settings.screenShake ? state.camera.shakeOffsetY : 0);
    const zoom = computeViewportZoom(this.cssWidth, this.cssHeight, state.camera.zoom) * this.dpr;

    ctx.save();
    ctx.translate(pw / 2, ph / 2);
    ctx.scale(zoom, zoom);
    ctx.translate(-camX, -camY);

    // Layer 1: Walls & Floor Tiles
    ctx.fillStyle = wallHex;
    ctx.fillRect(-EDGE_SIZE, -EDGE_SIZE, ARENA_W + EDGE_SIZE * 2, ARENA_H + EDGE_SIZE * 2);

    const tileStep = 128;
    const tileCols = Math.ceil(ARENA_W / tileStep);
    const tileRows = Math.ceil(ARENA_H / tileStep);
    const tilePrefix = state.zoneId === 1 ? 'tile_abyss_' : state.zoneId === 2 ? 'tile_jungle_' : 'tile_crash_';
    const tileMod = state.zoneId === 0 ? 6 : 3;
    for (let ty = 0; ty < tileRows; ty++) {
      for (let tx = 0; tx < tileCols; tx++) {
        const idx = ((tx * 7 + ty * 13 + tx * ty * 3) >>> 0) % tileMod;
        const tileId = `${tilePrefix}${state.zoneId === 0 ? idx + 1 : idx}`;
        this.drawSprite(tileId, `${tilePrefix}1`, tx * tileStep + 64, ty * tileStep + 64, 129, 129);
      }
    }

    ctx.strokeStyle = trimHex;
    ctx.lineWidth = 5;
    ctx.strokeRect(EDGE_MAP_DIST, EDGE_MAP_DIST, ARENA_W - EDGE_MAP_DIST * 2, ARENA_H - EDGE_MAP_DIST * 2);

    // Layer 2: Persistent Decals
    for (let i = 0; i < MAX_DECALS; i++) {
      const d = this.decals[i];
      if (!d.active) continue;
      this.drawSprite(d.spriteId, 'vfx_splat', d.x, d.y, d.size, d.size, d.rot, false, false, d.alpha);
    }

    // Layer 3: Contact Shadows
    const playerX = lerp(state.player.prevX, state.player.x, alpha);
    const playerY = lerp(state.player.prevY, state.player.y, alpha);
    for (let i = 0; i < state.enemies.length; i++) {
      const e = state.enemies[i];
      this.drawSprite('vfx_shadow', 'vfx_shadow', lerp(e.prevX, e.x, alpha), lerp(e.prevY, e.y, alpha) + e.radius * 0.65, e.radius * 2, e.radius * 1.1, 0, false, false, 0.7);
    }
    this.drawSprite('vfx_shadow', 'vfx_shadow', playerX, playerY + 6, 52, 28, 0, false, false, 0.75);

    // Layer 4: Spawn Telegraphs
    for (let i = 0; i < state.telegraphs.length; i++) {
      const tg = state.telegraphs[i];
      const prog = 1 - tg.ticksLeft / Math.max(1, tg.totalTicks);
      const blink = 0.55 + 0.45 * Math.sin(this.animClock * (8 + prog * 26));
      const sz = (tg.isBoss ? 100 : tg.isElite ? 74 : 46) * (0.85 + 0.25 * blink);
      this.drawSprite('vfx_spawn_x', 'spawn_telegraph', tg.x, tg.y, sz, sz, 0, false, false, 0.5 + 0.5 * blink);
    }

    // Layer 5: Pickups, Structures & Trees
    for (let i = 0; i < state.pickups.length; i++) {
      const pk = state.pickups[i];
      const px = lerp(pk.prevX, pk.x, alpha);
      const py = lerp(pk.prevY, pk.y, alpha) + Math.sin(this.animClock * 5 + pk.uid) * 3;
      if (pk.kind === 'material') {
        this.drawSprite(`material_${pk.uid % 11}`, 'material_0', px, py, 24 * pk.scale, 24 * pk.scale);
      } else if (pk.kind === 'consumable') {
        this.drawSprite('consumable_fruit', 'fruit', px, py, 30, 30);
      } else {
        this.drawSprite(pk.kind === 'legendary_crate' ? 'crate_legendary' : 'crate_normal', 'crate', px, py, 44, 44);
      }
    }
    for (let i = 0; i < state.structures.length; i++) {
      const s = state.structures[i];
      this.drawSprite(`structure_${s.kind}`, 'structure_turret', s.x, s.y - 8, 52, 52, 0, Math.cos(s.aimAngle) < 0);
    }
    const treeSprite = state.zoneId === 2 ? 'tree_jungle' : 'tree_0';
    for (let i = 0; i < state.trees.length; i++) {
      const t = state.trees[i];
      const sz = t.radius * 2.9;
      this.drawSprite(treeSprite, 'tree_0', t.x, t.y - 10, sz, sz);
    }

    // Layer 6: Enemies
    for (let i = 0; i < state.enemies.length; i++) {
      const e = state.enemies[i];
      const ex = lerp(e.prevX, e.x, alpha);
      const ey = lerp(e.prevY, e.y, alpha);
      const sz = Math.max(36, e.radius * 2.55);
      if (e.kind === 'boss' || e.kind === 'elite') {
        ctx.strokeStyle = e.kind === 'boss' ? '#ff3b3b' : '#ffd43b';
        ctx.lineWidth = 4;
        ctx.beginPath();
        ctx.arc(ex, ey, sz * 0.58, 0, Math.PI * 2);
        ctx.stroke();
      }
      const id = e.defId.startsWith('enemy_') ? e.defId : `enemy_${e.defId}`;
      this.drawSprite(id, 'enemy_baby_alien', ex, ey - 4, sz, sz, 0, e.facingX < 0);
      if (settings.hitFlash && e.hitFlashTicks > 0) {
        this.drawSprite('vfx_circle', 'vfx_circle', ex, ey - 4, sz * 0.65, sz * 0.65, 0, false, false, 0.72);
      }
    }

    // Layer 7: Player & Weapons
    const p = state.player;
    const isMoving = Math.abs(p.vx) > 8 || Math.abs(p.vy) > 8;
    const walkWave = isMoving ? Math.sin(p.walkAnimPhase * 2) : 0;
    const iframeAlpha = p.iframesTicks > 0 && Math.floor(p.iframesTicks / 3) % 2 === 0 ? 0.55 : 1;
    this.drawSprite(
      `char_${p.characterId}`,
      'player_body',
      playerX,
      playerY - 22,
      62 * (1 + walkWave * 0.08),
      62 * (1 - walkWave * 0.08),
      0,
      p.facingX < 0,
      false,
      iframeAlpha
    );

    for (let i = 0; i < p.weapons.length; i++) {
      const w = p.weapons[i];
      const wx = lerp(w.prevWorldX, w.worldX, alpha);
      const wy = lerp(w.prevWorldY, w.worldY, alpha);
      let angle = w.aimAngle;
      let offset = -w.recoilOffset;
      if (w.swingTimer > 0 && w.swingDuration > 0) {
        const prog = 1 - w.swingTimer / w.swingDuration;
        if (w.swingType === 0) offset += Math.sin(prog * Math.PI) * 38;
        else {
          angle += (prog - 0.5) * 2.1 * w.swingDir;
          offset += Math.sin(prog * Math.PI) * 18;
        }
      }
      const dx = wx + Math.cos(angle) * offset;
      const dy = wy + Math.sin(angle) * offset;
      if (w.tier >= 2) {
        ctx.strokeStyle = RARITY_COLORS[Math.min(3, w.tier - 1)];
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(dx, dy, 20, 0, Math.PI * 2);
        ctx.stroke();
      }
      const wId = w.weaponId.startsWith('weapon_') ? w.weaponId : `weapon_${w.weaponId}`;
      this.drawSprite(wId, 'weapon_pistol', dx, dy, 44, 44, angle, false, Math.cos(angle) < 0);
    }

    // Layer 8: Player Projectiles, Hazards & Particles
    for (let i = 0; i < state.hazards.length; i++) {
      const hz = state.hazards[i];
      if (hz.kind === 'melee_slash') {
        const fade = Math.max(0, hz.ticksLeft / Math.max(1, hz.maxTicks));
        this.drawSprite('vfx_slash', 'vfx_slash', hz.x, hz.y, hz.radius * 2.1, hz.radius * 2.1, hz.angle, false, false, 0.85 * fade);
      } else if (hz.kind === 'explosion') {
        const fade = Math.max(0, hz.ticksLeft / Math.max(1, hz.maxTicks));
        this.drawSprite('vfx_explosion', 'vfx_explosion', hz.x, hz.y, hz.radius * 2.1, hz.radius * 2.1, 0, false, false, fade);
      }
    }

    for (let i = 0; i < state.projectiles.length; i++) {
      const pr = state.projectiles[i];
      if (pr.owner !== 'enemy') {
        const sz = Math.max(22, pr.radius * 2.8);
        this.drawSprite(pr.spriteId || 'proj_bullet', 'proj_bullet', lerp(pr.prevX, pr.x, alpha), lerp(pr.prevY, pr.y, alpha), sz, sz, Math.atan2(pr.vy, pr.vx));
      }
    }

    for (let i = 0; i < MAX_PARTICLES; i++) {
      const pt = this.particles[i];
      if (!pt.active) continue;
      ctx.globalAlpha = pt.life / pt.maxLife;
      ctx.fillStyle = pt.color;
      ctx.beginPath();
      ctx.arc(pt.x, pt.y, pt.size * 0.5, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;

    // Layer 9: Enemy Projectiles & Boss Beams ON TOP
    for (let i = 0; i < state.hazards.length; i++) {
      const hz = state.hazards[i];
      if (hz.kind === 'boss_beam') {
        ctx.strokeStyle = hz.activeDelayTicks > 0 ? 'rgba(255, 60, 80, 0.45)' : '#ff2344';
        ctx.lineWidth = hz.activeDelayTicks > 0 ? 8 : Math.max(22, hz.radius * 1.8);
        ctx.beginPath();
        ctx.moveTo(hz.x, hz.y);
        ctx.lineTo(hz.endX, hz.endY);
        ctx.stroke();
      } else if (hz.kind === 'boss_ring') {
        ctx.strokeStyle = '#ff2846';
        ctx.lineWidth = 6;
        ctx.beginPath();
        ctx.arc(hz.x, hz.y, hz.radius, 0, Math.PI * 2);
        ctx.stroke();
      }
    }

    for (let i = 0; i < state.projectiles.length; i++) {
      const pr = state.projectiles[i];
      if (pr.owner === 'enemy') {
        const sz = Math.max(24, pr.radius * 3.1);
        this.drawSprite('proj_enemy', 'proj_enemy', lerp(pr.prevX, pr.x, alpha), lerp(pr.prevY, pr.y, alpha), sz, sz, Math.atan2(pr.vy, pr.vx));
      }
    }

    // Layer 10: Floating Damage Numbers & Manual Crosshair
    if (settings.damageNumbers) {
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.lineJoin = 'round';
      for (let i = 0; i < MAX_FLOATING_TEXTS; i++) {
        const ft = this.texts[i];
        if (!ft.active) continue;
        const fade = Math.min(1, (ft.life / ft.maxLife) * 2);
        ctx.globalAlpha = fade;
        ctx.font = `900 ${Math.round(24 * ft.scale)}px "Segoe UI", system-ui, sans-serif`;
        ctx.strokeStyle = '#15131c';
        ctx.lineWidth = 6;
        ctx.strokeText(ft.text, ft.x, ft.y);
        ctx.fillStyle = ft.color;
        ctx.fillText(ft.text, ft.x, ft.y);
      }
      ctx.globalAlpha = 1;
    }

    if (!state.autoAim || state.aimActive) {
      this.drawSprite('ui_crosshair', 'ui_manual_cursor', state.manualAimWorldX, state.manualAimWorldY, 44, 44);
    }

    ctx.restore();
    this.lastDrawCalls = 1;
  }

  public getPerfSnapshot(): { drawCalls: number; quadCount: number } {
    return { drawCalls: this.lastDrawCalls, quadCount: this.lastQuadCount };
  }

  public dispose(): void {
    this.clearDecals();
  }
}
