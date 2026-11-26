// ============================================================================
// src/assets/ProceduralKrunkedAtlas.ts
// Pre-baked 2048x2048 stylized comic-inked krunkedtato vector-to-atlas baker.
// Baked ONCE at startup (plus optional pre-game catalog pass) — ZERO per-frame
// canvas or gradient allocations during rendering.
// ============================================================================

import {
  CORE_STAT_KEYS,
  type AtlasRegion,
  type CoreStatKey,
  type GameDataCatalog,
} from '../contracts/index';

export const ATLAS_SIZE = 2048;
const INK = '#15131c';
const PAD = 2;

export interface ProceduralAtlasBundle {
  canvas: HTMLCanvasElement;
  regions: Map<string, AtlasRegion>;
  ensureSprite(spriteId: string): AtlasRegion;
  ensureCatalogSprites(catalog: GameDataCatalog): boolean;
  getVersion(): number;
}

// Deterministic FNV-1a string hash for procedural fallback silhouettes
function hashStr(str: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h >>> 0;
}

function seededFloat(seed: number, salt: number): number {
  let x = (seed ^ (salt * 374761393)) >>> 0;
  x = Math.imul(x ^ (x >>> 13), 1274126177) >>> 0;
  x = (x ^ (x >>> 16)) >>> 0;
  return x / 4294967296;
}

function hsl(h: number, s: number, l: number): string {
  return `hsl(${Math.round(((h % 360) + 360) % 360)}, ${Math.round(s)}%, ${Math.round(l)}%)`;
}

// Clean comic drawing helpers (always operate inside cell [0..w, 0..h])
function roundRectPath(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number
): void {
  const rad = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rad, y);
  ctx.arcTo(x + w, y, x + w, y + h, rad);
  ctx.arcTo(x + w, y + h, x, y + h, rad);
  ctx.arcTo(x, y + h, x, y, rad);
  ctx.arcTo(x, y, x + w, y, rad);
  ctx.closePath();
}

function fillStrokeCircle(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  r: number,
  fill: string,
  lineW = 3,
  stroke = INK
): void {
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fillStyle = fill;
  ctx.fill();
  if (lineW > 0) {
    ctx.lineWidth = lineW;
    ctx.strokeStyle = stroke;
    ctx.stroke();
  }
}

function drawStarPolygon(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  points: number,
  outerR: number,
  innerR: number,
  rot = -Math.PI / 2
): void {
  ctx.beginPath();
  for (let i = 0; i < points * 2; i++) {
    const r = i % 2 === 0 ? outerR : innerR;
    const a = rot + (i * Math.PI) / points;
    const px = cx + Math.cos(a) * r;
    const py = cy + Math.sin(a) * r;
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.closePath();
}

// ----------------------------------------------------------------------------
// Core VFX, Primitives, UI Icons & Ground Tiles
// ----------------------------------------------------------------------------

function drawVfxSprite(ctx: CanvasRenderingContext2D, id: string, size: number): void {
  const c = size / 2;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';

  switch (id) {
    case 'vfx_white': {
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, size, size);
      return;
    }
    case 'vfx_circle': {
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.arc(c, c, size * 0.45, 0, Math.PI * 2);
      ctx.fill();
      return;
    }
    case 'vfx_ring': {
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = size * 0.09;
      ctx.beginPath();
      ctx.arc(c, c, size * 0.42, 0, Math.PI * 2);
      ctx.stroke();
      return;
    }
    case 'vfx_shadow': {
      // Pre-baked once at startup!
      const g = ctx.createRadialGradient(c, c, size * 0.05, c, c, size * 0.46);
      g.addColorStop(0, 'rgba(10, 8, 16, 0.56)');
      g.addColorStop(0.65, 'rgba(10, 8, 16, 0.28)');
      g.addColorStop(1, 'rgba(10, 8, 16, 0)');
      ctx.save();
      ctx.translate(c, c);
      ctx.scale(1.0, 0.6);
      ctx.beginPath();
      ctx.arc(0, 0, size * 0.46, 0, Math.PI * 2);
      ctx.fillStyle = g;
      ctx.fill();
      ctx.restore();
      return;
    }
    case 'vfx_spawn_x':
    case 'spawn_telegraph': {
      const arm = size * 0.34;
      // Soft crimson glow ring
      const g = ctx.createRadialGradient(c, c, 2, c, c, size * 0.48);
      g.addColorStop(0, 'rgba(255, 38, 68, 0.52)');
      g.addColorStop(1, 'rgba(255, 38, 68, 0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(c, c, size * 0.48, 0, Math.PI * 2);
      ctx.fill();

      // Dark outer ink cross
      ctx.strokeStyle = INK;
      ctx.lineWidth = size * 0.2;
      ctx.beginPath();
      ctx.moveTo(c - arm, c - arm);
      ctx.lineTo(c + arm, c + arm);
      ctx.moveTo(c + arm, c - arm);
      ctx.lineTo(c - arm, c + arm);
      ctx.stroke();

      // Neon crimson X
      ctx.strokeStyle = '#ff2846';
      ctx.lineWidth = size * 0.125;
      ctx.stroke();

      // Bright white-pink inner core
      ctx.strokeStyle = '#ffd4dc';
      ctx.lineWidth = size * 0.045;
      ctx.stroke();
      return;
    }
    case 'vfx_slash': {
      ctx.save();
      ctx.translate(c, c);
      // Outer comic ink crescent
      ctx.beginPath();
      ctx.arc(0, 0, size * 0.44, -Math.PI * 0.42, Math.PI * 0.42);
      ctx.arc(-size * 0.12, 0, size * 0.34, Math.PI * 0.38, -Math.PI * 0.38, true);
      ctx.closePath();
      ctx.fillStyle = '#ffffff';
      ctx.fill();
      ctx.lineWidth = 4;
      ctx.strokeStyle = INK;
      ctx.stroke();

      // Bright inner edge highlight
      ctx.beginPath();
      ctx.arc(0, 0, size * 0.41, -Math.PI * 0.36, Math.PI * 0.36);
      ctx.strokeStyle = 'rgba(255,255,255,0.9)';
      ctx.lineWidth = 5;
      ctx.stroke();
      ctx.restore();
      return;
    }
    case 'vfx_explosion': {
      // Spiky comic boom starburst
      const g = ctx.createRadialGradient(c, c, size * 0.05, c, c, size * 0.47);
      g.addColorStop(0, '#fffbe0');
      g.addColorStop(0.35, '#ffbe2e');
      g.addColorStop(0.72, '#ff4d24');
      g.addColorStop(1, 'rgba(255, 50, 20, 0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(c, c, size * 0.47, 0, Math.PI * 2);
      ctx.fill();

      drawStarPolygon(ctx, c, c, 12, size * 0.43, size * 0.26);
      ctx.fillStyle = '#ff6a1a';
      ctx.fill();
      ctx.lineWidth = 4;
      ctx.strokeStyle = INK;
      ctx.stroke();

      drawStarPolygon(ctx, c, c, 9, size * 0.29, size * 0.16, 0.2);
      ctx.fillStyle = '#ffe552';
      ctx.fill();

      ctx.beginPath();
      ctx.arc(c, c, size * 0.13, 0, Math.PI * 2);
      ctx.fillStyle = '#ffffff';
      ctx.fill();
      return;
    }
    case 'vfx_spark': {
      drawStarPolygon(ctx, c, c, 4, size * 0.44, size * 0.12);
      ctx.fillStyle = '#ffffff';
      ctx.fill();
      ctx.lineWidth = 2;
      ctx.strokeStyle = INK;
      ctx.stroke();
      return;
    }
    case 'vfx_splat': {
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.arc(c, c, size * 0.26, 0, Math.PI * 2);
      ctx.fill();
      const blobs: ReadonlyArray<[number, number, number]> = [
        [-0.24, -0.14, 0.12],
        [0.26, -0.1, 0.1],
        [0.14, 0.25, 0.13],
        [-0.18, 0.22, 0.09],
        [0.32, 0.16, 0.06],
        [-0.31, 0.06, 0.06],
      ];
      for (const [bx, by, br] of blobs) {
        ctx.beginPath();
        ctx.arc(c + bx * size, c + by * size, br * size, 0, Math.PI * 2);
        ctx.fill();
      }
      return;
    }
    case 'vfx_scorch': {
      const g = ctx.createRadialGradient(c, c, 2, c, c, size * 0.45);
      g.addColorStop(0, 'rgba(18, 14, 22, 0.72)');
      g.addColorStop(0.55, 'rgba(30, 22, 26, 0.42)');
      g.addColorStop(1, 'rgba(18, 14, 22, 0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(c, c, size * 0.45, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = 'rgba(15, 11, 18, 0.55)';
      ctx.lineWidth = 2.5;
      for (let i = 0; i < 8; i++) {
        const a = (i * Math.PI) / 4 + 0.2;
        ctx.beginPath();
        ctx.moveTo(c + Math.cos(a) * size * 0.12, c + Math.sin(a) * size * 0.12);
        ctx.lineTo(c + Math.cos(a) * size * 0.4, c + Math.sin(a) * size * 0.4);
        ctx.stroke();
      }
      return;
    }
    case 'vfx_crater': {
      ctx.strokeStyle = 'rgba(20, 16, 24, 0.65)';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.ellipse(c, c, size * 0.38, size * 0.28, 0, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(16, 12, 20, 0.35)';
      ctx.fill();
      ctx.stroke();
      return;
    }
    case 'ui_crosshair':
    case 'ui_manual_cursor': {
      const r = size * 0.3;
      ctx.strokeStyle = INK;
      ctx.lineWidth = 6;
      ctx.beginPath();
      ctx.arc(c, c, r, 0, Math.PI * 2);
      ctx.stroke();
      ctx.strokeStyle = '#ffe552';
      ctx.lineWidth = 3;
      ctx.stroke();
      for (let i = 0; i < 4; i++) {
        const a = (i * Math.PI) / 2;
        ctx.strokeStyle = INK;
        ctx.lineWidth = 6;
        ctx.beginPath();
        ctx.moveTo(c + Math.cos(a) * (r - 6), c + Math.sin(a) * (r - 6));
        ctx.lineTo(c + Math.cos(a) * (r + 9), c + Math.sin(a) * (r + 9));
        ctx.stroke();
        ctx.strokeStyle = '#ffe552';
        ctx.lineWidth = 3;
        ctx.stroke();
      }
      fillStrokeCircle(ctx, c, c, 3.5, '#ff3b3b', 2);
      return;
    }
    case 'ui_warning_arrow': {
      ctx.beginPath();
      ctx.moveTo(size * 0.84, c);
      ctx.lineTo(size * 0.24, size * 0.18);
      ctx.lineTo(size * 0.38, c);
      ctx.lineTo(size * 0.24, size * 0.82);
      ctx.closePath();
      ctx.fillStyle = '#ff3b3b';
      ctx.fill();
      ctx.lineWidth = 3;
      ctx.strokeStyle = INK;
      ctx.stroke();
      return;
    }
    case 'ui_boss_icon':
    case 'ui_elite_icon':
    case 'ui_horde_icon': {
      const col = id === 'ui_boss_icon' ? '#ff3b3b' : id === 'ui_elite_icon' ? '#ad5aff' : '#ffaa2b';
      fillStrokeCircle(ctx, c, c + 4, size * 0.34, col, 3.5);
      // Horns / crown
      ctx.fillStyle = '#ffe552';
      ctx.beginPath();
      ctx.moveTo(c - 15, c - 12);
      ctx.lineTo(c - 19, c - 24);
      ctx.lineTo(c - 6, c - 16);
      ctx.lineTo(c, c - 26);
      ctx.lineTo(c + 6, c - 16);
      ctx.lineTo(c + 19, c - 24);
      ctx.lineTo(c + 15, c - 12);
      ctx.closePath();
      ctx.fill();
      ctx.lineWidth = 2.5;
      ctx.strokeStyle = INK;
      ctx.stroke();
      // Angry eyes
      fillStrokeCircle(ctx, c - 8, c + 3, 4, '#ffffff', 2);
      fillStrokeCircle(ctx, c + 8, c + 3, 4, '#ffffff', 2);
      return;
    }
    default: {
      fillStrokeCircle(ctx, c, c, size * 0.35, '#ffffff', 3);
    }
  }
}

function drawTileSprite(ctx: CanvasRenderingContext2D, id: string, size: number): void {
  const h = hashStr(id);
  const isAbyss = id.startsWith('tile_abyss');
  const isJungle = id.startsWith('tile_jungle');

  // Base floor fill
  if (isAbyss) {
    ctx.fillStyle = h % 2 === 0 ? '#182834' : '#1b2e3c';
  } else if (isJungle) {
    ctx.fillStyle = h % 2 === 0 ? '#233422' : '#283c27';
  } else {
    // Crash Zone warm alien dirt crater
    ctx.fillStyle = h % 2 === 0 ? '#3a312b' : '#3f352e';
  }
  ctx.fillRect(0, 0, size, size);

  // Subtle organic ground patches
  for (let i = 0; i < 6; i++) {
    const px = seededFloat(h, i * 3 + 1) * size;
    const py = seededFloat(h, i * 3 + 2) * size;
    const rx = 10 + seededFloat(h, i * 3 + 3) * 22;
    const ry = rx * (0.55 + seededFloat(h, i * 3 + 4) * 0.35);
    ctx.beginPath();
    ctx.ellipse(px, py, rx, ry, seededFloat(h, i + 40) * Math.PI, 0, Math.PI * 2);
    if (isAbyss) {
      ctx.fillStyle = i % 2 === 0 ? 'rgba(13, 21, 30, 0.35)' : 'rgba(42, 92, 118, 0.16)';
    } else if (isJungle) {
      ctx.fillStyle = i % 2 === 0 ? 'rgba(20, 32, 18, 0.34)' : 'rgba(72, 115, 58, 0.18)';
    } else {
      ctx.fillStyle = i % 2 === 0 ? 'rgba(34, 26, 22, 0.28)' : 'rgba(104, 84, 68, 0.16)';
    }
    ctx.fill();
  }

  // Scattered pebbles / cracks / bio-veins
  for (let i = 0; i < 9; i++) {
    const px = 8 + seededFloat(h, 100 + i * 2) * (size - 16);
    const py = 8 + seededFloat(h, 101 + i * 2) * (size - 16);
    const r = 2 + seededFloat(h, 130 + i) * 3.5;
    ctx.beginPath();
    ctx.arc(px, py, r, 0, Math.PI * 2);
    if (isAbyss) {
      ctx.fillStyle = i === 0 ? 'rgba(70, 232, 255, 0.32)' : 'rgba(12, 20, 28, 0.45)';
    } else if (isJungle) {
      ctx.fillStyle = i === 0 ? 'rgba(130, 235, 92, 0.28)' : 'rgba(18, 30, 16, 0.42)';
    } else {
      ctx.fillStyle = i % 3 === 0 ? 'rgba(136, 112, 94, 0.26)' : 'rgba(28, 22, 18, 0.42)';
    }
    ctx.fill();
  }

  // Subtle tile crack on variant tiles
  if (h % 3 === 0) {
    ctx.strokeStyle = isAbyss
      ? 'rgba(64, 216, 255, 0.18)'
      : isJungle
        ? 'rgba(14, 24, 14, 0.38)'
        : 'rgba(24, 18, 15, 0.38)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    const sx = size * (0.2 + seededFloat(h, 201) * 0.25);
    const sy = size * (0.2 + seededFloat(h, 202) * 0.25);
    ctx.moveTo(sx, sy);
    ctx.lineTo(sx + 18, sy + 11);
    ctx.lineTo(sx + 32, sy + 6);
    ctx.lineTo(sx + 46, sy + 20);
    ctx.stroke();
  }

  // Faint grid seam
  ctx.strokeStyle = 'rgba(0, 0, 0, 0.035)';
  ctx.lineWidth = 1;
  ctx.strokeRect(0.5, 0.5, size - 1, size - 1);
}

// ----------------------------------------------------------------------------
// Player & Character Sprites (64x64)
// ----------------------------------------------------------------------------

interface CharStyle {
  skin: string;
  shade: string;
  hat: 'none' | 'headband' | 'hood' | 'wizard' | 'viking' | 'goggles' | 'crown' | 'helmet' | 'horns' | 'halo' | 'beanie' | 'cap' | 'spiky' | 'nurse' | 'straw' | 'visor';
  hatColor: string;
  accent: string;
  widthScale: number;
  eyeStyle: 'cute' | 'angry' | 'crazy' | 'glow' | 'shades' | 'cyclops' | 'dead';
  mouth: 'smile' | 'grin' | 'frown' | 'open' | 'mustache' | 'beard' | 'dead';
}

const KNOWN_CHAR_STYLES: Record<string, Partial<CharStyle>> = {
  well_rounded: { skin: '#ebd1a7', shade: '#caa472', hat: 'none', accent: '#ff5252', eyeStyle: 'cute', mouth: 'smile' },
  brawler: { skin: '#e5be91', shade: '#be8f5d', hat: 'headband', hatColor: '#e63946', accent: '#ffffff', eyeStyle: 'angry', mouth: 'grin' },
  ranger: { skin: '#e2cc9f', shade: '#b99d6e', hat: 'hood', hatColor: '#2d8a4e', accent: '#f4d35e', eyeStyle: 'angry', mouth: 'smile' },
  crazy: { skin: '#ecd5ad', shade: '#c4a678', hat: 'spiky', hatColor: '#ff7b29', accent: '#ffe552', eyeStyle: 'crazy', mouth: 'open' },
  mage: { skin: '#dfd0ef', shade: '#b39ed0', hat: 'wizard', hatColor: '#6c3ce9', accent: '#ffe552', eyeStyle: 'glow', mouth: 'beard' },
  chunky: { skin: '#e6c29a', shade: '#bf9368', hat: 'viking', hatColor: '#8d99ae', accent: '#ffd166', widthScale: 1.18, eyeStyle: 'cute', mouth: 'grin' },
  speedy: { skin: '#f1d6a7', shade: '#c8a36c', hat: 'goggles', hatColor: '#00b4d8', accent: '#ffe552', eyeStyle: 'shades', mouth: 'grin' },
  multitasker: { skin: '#e8d4b0', shade: '#bda175', hat: 'halo', hatColor: '#ffd166', accent: '#5abeff', eyeStyle: 'glow', mouth: 'smile' },
  knight: { skin: '#cfd8e3', shade: '#94a3b8', hat: 'helmet', hatColor: '#94a3b8', accent: '#ef4444', eyeStyle: 'angry', mouth: 'frown' },
  demon: { skin: '#d94848', shade: '#9e2626', hat: 'horns', hatColor: '#2b1b22', accent: '#ffbe0b', eyeStyle: 'glow', mouth: 'grin' },
  bull: { skin: '#c48f65', shade: '#8d5b36', hat: 'horns', hatColor: '#f5efe6', accent: '#ff3b3b', widthScale: 1.14, eyeStyle: 'angry', mouth: 'frown' },
  ghost: { skin: '#d8f3ff', shade: '#90d5f5', hat: 'none', accent: '#ffffff', eyeStyle: 'glow', mouth: 'open' },
  engineer: { skin: '#e7cb9d', shade: '#bd9b68', hat: 'goggles', hatColor: '#f59e0b', accent: '#38bdf8', eyeStyle: 'cute', mouth: 'mustache' },
  cyborg: { skin: '#cbd5e1', shade: '#8a99ad', hat: 'visor', hatColor: '#06b6d4', accent: '#ef4444', eyeStyle: 'shades', mouth: 'frown' },
  doctor: { skin: '#f0dec2', shade: '#c9b18e', hat: 'nurse', hatColor: '#ffffff', accent: '#ef4444', eyeStyle: 'cute', mouth: 'smile' },
  farmer: { skin: '#e8cc9c', shade: '#be9d6b', hat: 'straw', hatColor: '#eab308', accent: '#ef4444', eyeStyle: 'cute', mouth: 'mustache' },
  king: { skin: '#efd5a7', shade: '#c7a470', hat: 'crown', hatColor: '#facc15', accent: '#ef4444', eyeStyle: 'angry', mouth: 'beard' },
  soldier: { skin: '#dec59c', shade: '#b5966a', hat: 'helmet', hatColor: '#4d7c0f', accent: '#facc15', eyeStyle: 'angry', mouth: 'frown' },
  lucky: { skin: '#d8f0b8', shade: '#9ec76b', hat: 'cap', hatColor: '#16a34a', accent: '#facc15', eyeStyle: 'cute', mouth: 'grin' },
  mutant: { skin: '#9ee37d', shade: '#68b048', hat: 'spiky', hatColor: '#a855f7', accent: '#bef264', eyeStyle: 'crazy', mouth: 'open' },
  lich: { skin: '#c7c2d6', shade: '#8b83a3', hat: 'crown', hatColor: '#7e22ce', accent: '#22d3ee', eyeStyle: 'glow', mouth: 'dead' },
};

function resolveCharStyle(charKey: string): CharStyle {
  const preset = KNOWN_CHAR_STYLES[charKey];
  const h = hashStr(charKey);
  const hats: CharStyle['hat'][] = ['headband', 'hood', 'wizard', 'viking', 'goggles', 'crown', 'helmet', 'horns', 'beanie', 'cap', 'spiky', 'straw', 'visor'];
  const eyes: CharStyle['eyeStyle'][] = ['cute', 'angry', 'crazy', 'glow', 'shades'];
  const mouths: CharStyle['mouth'][] = ['smile', 'grin', 'frown', 'mustache', 'beard'];
  const hue = (h % 360);

  return {
    skin: preset?.skin ?? hsl(32 + (h % 24) - 12, 52, 78),
    shade: preset?.shade ?? hsl(32 + (h % 24) - 12, 46, 62),
    hat: preset?.hat ?? hats[h % hats.length],
    hatColor: preset?.hatColor ?? hsl(hue, 72, 48),
    accent: preset?.accent ?? hsl((hue + 140) % 360, 88, 60),
    widthScale: preset?.widthScale ?? 1.0,
    eyeStyle: preset?.eyeStyle ?? eyes[(h >>> 4) % eyes.length],
    mouth: preset?.mouth ?? mouths[(h >>> 8) % mouths.length],
  };
}

function drawSpudCharacter(ctx: CanvasRenderingContext2D, spriteId: string, size: number): void {
  const c = size / 2;
  const isBase = spriteId === 'player_body';
  const charKey = spriteId.startsWith('char_') ? spriteId.slice(5) : 'well_rounded';
  const style = isBase ? resolveCharStyle('well_rounded') : resolveCharStyle(charKey);

  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';

  // Stubby feet
  const footY = size * 0.84;
  fillStrokeCircle(ctx, c - 9 * style.widthScale, footY, 5.5, style.shade, 2.8);
  fillStrokeCircle(ctx, c + 9 * style.widthScale, footY, 5.5, style.shade, 2.8);

  // Expressive potato spud silhouette
  const rx = 18 * style.widthScale;
  const ry = 21;
  const bodyY = c + 4;

  ctx.save();
  ctx.beginPath();
  ctx.ellipse(c, bodyY, rx, ry, 0, 0, Math.PI * 2);
  ctx.fillStyle = style.skin;
  ctx.fill();

  // Cel shadow crescent along bottom-right
  ctx.save();
  ctx.clip();
  ctx.beginPath();
  ctx.ellipse(c + 5, bodyY + 6, rx * 0.98, ry * 0.98, 0, 0, Math.PI * 2);
  ctx.fillStyle = style.shade;
  ctx.globalAlpha = 0.45;
  ctx.fill();

  // Top-left specular highlight
  ctx.beginPath();
  ctx.ellipse(c - rx * 0.42, bodyY - ry * 0.42, rx * 0.3, ry * 0.2, -0.5, 0, Math.PI * 2);
  ctx.fillStyle = '#ffffff';
  ctx.globalAlpha = 0.55;
  ctx.fill();
  ctx.restore();

  // Bold outer ink
  ctx.beginPath();
  ctx.ellipse(c, bodyY, rx, ry, 0, 0, Math.PI * 2);
  ctx.lineWidth = 3.4;
  ctx.strokeStyle = INK;
  ctx.stroke();
  ctx.restore();

  // Eyes
  const eyeY = bodyY - 2;
  const eyeSpread = 7.2 * style.widthScale;
  if (style.eyeStyle === 'shades') {
    ctx.fillStyle = INK;
    roundRectPath(ctx, c - eyeSpread - 6, eyeY - 4.5, 12, 8.5, 2.5);
    ctx.fill();
    roundRectPath(ctx, c + eyeSpread - 6, eyeY - 4.5, 12, 8.5, 2.5);
    ctx.fill();
    ctx.fillRect(c - 4, eyeY - 2, 8, 3);
    ctx.strokeStyle = style.accent;
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.moveTo(c - eyeSpread - 3, eyeY - 2);
    ctx.lineTo(c - eyeSpread + 2, eyeY + 1);
    ctx.moveTo(c + eyeSpread - 3, eyeY - 2);
    ctx.lineTo(c + eyeSpread + 2, eyeY + 1);
    ctx.stroke();
  } else if (style.eyeStyle === 'glow') {
    fillStrokeCircle(ctx, c - eyeSpread, eyeY, 4.3, style.accent, 2.2);
    fillStrokeCircle(ctx, c + eyeSpread, eyeY, 4.3, style.accent, 2.2);
    fillStrokeCircle(ctx, c - eyeSpread - 1, eyeY - 1, 1.5, '#ffffff', 0);
    fillStrokeCircle(ctx, c + eyeSpread - 1, eyeY - 1, 1.5, '#ffffff', 0);
  } else if (style.eyeStyle === 'crazy') {
    fillStrokeCircle(ctx, c - eyeSpread, eyeY, 5.2, '#ffffff', 2.2);
    fillStrokeCircle(ctx, c + eyeSpread, eyeY - 1, 3.8, '#ffffff', 2.2);
    fillStrokeCircle(ctx, c - eyeSpread + 1, eyeY + 1, 2.2, INK, 0);
    fillStrokeCircle(ctx, c + eyeSpread - 1, eyeY - 1.5, 1.8, INK, 0);
  } else {
    fillStrokeCircle(ctx, c - eyeSpread, eyeY, 3.6, INK, 0);
    fillStrokeCircle(ctx, c + eyeSpread, eyeY, 3.6, INK, 0);
    fillStrokeCircle(ctx, c - eyeSpread - 1.1, eyeY - 1.1, 1.2, '#ffffff', 0);
    fillStrokeCircle(ctx, c + eyeSpread - 1.1, eyeY - 1.1, 1.2, '#ffffff', 0);
    if (style.eyeStyle === 'angry') {
      ctx.strokeStyle = INK;
      ctx.lineWidth = 2.6;
      ctx.beginPath();
      ctx.moveTo(c - eyeSpread - 4, eyeY - 6);
      ctx.lineTo(c - eyeSpread + 3.5, eyeY - 3.5);
      ctx.moveTo(c + eyeSpread + 4, eyeY - 6);
      ctx.lineTo(c + eyeSpread - 3.5, eyeY - 3.5);
      ctx.stroke();
    }
  }

  // Mouth / facial hair
  const mY = bodyY + 7.5;
  ctx.strokeStyle = INK;
  ctx.lineWidth = 2.4;
  if (style.mouth === 'beard') {
    ctx.beginPath();
    ctx.moveTo(c - 10, mY - 2);
    ctx.quadraticCurveTo(c, mY + 14, c + 10, mY - 2);
    ctx.closePath();
    ctx.fillStyle = '#f1f5f9';
    ctx.fill();
    ctx.stroke();
  } else if (style.mouth === 'mustache') {
    ctx.beginPath();
    ctx.moveTo(c - 9, mY + 1);
    ctx.quadraticCurveTo(c - 4, mY - 4, c, mY);
    ctx.quadraticCurveTo(c + 4, mY - 4, c + 9, mY + 1);
    ctx.lineWidth = 3.2;
    ctx.strokeStyle = '#4b3621';
    ctx.stroke();
  } else if (style.mouth === 'grin') {
    ctx.beginPath();
    ctx.arc(c, mY - 2, 6, 0.15, Math.PI - 0.15);
    ctx.closePath();
    ctx.fillStyle = '#ffffff';
    ctx.fill();
    ctx.stroke();
  } else if (style.mouth === 'open') {
    fillStrokeCircle(ctx, c, mY + 1, 4.2, '#7f1d1d', 2.2);
  } else if (style.mouth === 'dead') {
    ctx.beginPath();
    ctx.moveTo(c - 7, mY);
    ctx.lineTo(c + 7, mY);
    for (let sx = -4; sx <= 4; sx += 4) {
      ctx.moveTo(c + sx, mY - 3);
      ctx.lineTo(c + sx, mY + 3);
    }
    ctx.stroke();
  } else if (style.mouth === 'frown') {
    ctx.beginPath();
    ctx.arc(c, mY + 5, 5.5, Math.PI + 0.4, Math.PI * 2 - 0.4);
    ctx.stroke();
  } else {
    ctx.beginPath();
    ctx.arc(c, mY - 2, 5.2, 0.2, Math.PI - 0.2);
    ctx.stroke();
  }

  // Hat / Headgear
  if (isBase) return;
  const topY = bodyY - ry + 2;
  ctx.lineWidth = 2.8;
  ctx.strokeStyle = INK;

  switch (style.hat) {
    case 'headband': {
      ctx.fillStyle = style.hatColor;
      roundRectPath(ctx, c - rx + 1, topY + 6, (rx - 1) * 2, 6.5, 3);
      ctx.fill();
      ctx.stroke();
      // Fluttering tails
      ctx.beginPath();
      ctx.moveTo(c + rx - 2, topY + 9);
      ctx.lineTo(c + rx + 8, topY + 5);
      ctx.lineTo(c + rx + 6, topY + 12);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      break;
    }
    case 'wizard': {
      ctx.fillStyle = style.hatColor;
      ctx.beginPath();
      ctx.moveTo(c - 20, topY + 7);
      ctx.lineTo(c + 20, topY + 7);
      ctx.lineTo(c + 12, topY + 2);
      ctx.lineTo(c + 2, topY - 17);
      ctx.lineTo(c - 13, topY + 2);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      // Gold star
      drawStarPolygon(ctx, c, topY - 3, 5, 4.5, 2);
      ctx.fillStyle = style.accent;
      ctx.fill();
      break;
    }
    case 'hood': {
      ctx.fillStyle = style.hatColor;
      ctx.beginPath();
      ctx.arc(c, topY + 9, rx + 2, Math.PI, Math.PI * 2);
      ctx.lineTo(c + rx + 2, topY + 11);
      ctx.quadraticCurveTo(c, topY + 4, c - rx - 2, topY + 11);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      // Feather
      ctx.fillStyle = style.accent;
      ctx.beginPath();
      ctx.ellipse(c + 14, topY - 3, 7, 3, -0.6, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      break;
    }
    case 'viking': {
      ctx.fillStyle = style.hatColor;
      ctx.beginPath();
      ctx.arc(c, topY + 9, rx, Math.PI, Math.PI * 2);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      // Curved horns
      ctx.fillStyle = '#fff5e1';
      for (const dir of [-1, 1]) {
        ctx.beginPath();
        ctx.moveTo(c + dir * (rx - 4), topY + 4);
        ctx.quadraticCurveTo(c + dir * (rx + 9), topY - 4, c + dir * (rx + 5), topY - 12);
        ctx.quadraticCurveTo(c + dir * (rx + 1), topY - 4, c + dir * (rx - 8), topY + 1);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
      }
      break;
    }
    case 'goggles': {
      ctx.fillStyle = '#334155';
      ctx.fillRect(c - rx + 1, topY + 4, (rx - 1) * 2, 5);
      fillStrokeCircle(ctx, c - 7, topY + 6, 5.5, style.hatColor, 2.5);
      fillStrokeCircle(ctx, c + 7, topY + 6, 5.5, style.hatColor, 2.5);
      fillStrokeCircle(ctx, c - 8.5, topY + 4.5, 1.8, '#ffffff', 0);
      fillStrokeCircle(ctx, c + 5.5, topY + 4.5, 1.8, '#ffffff', 0);
      break;
    }
    case 'crown': {
      ctx.fillStyle = style.hatColor;
      ctx.beginPath();
      ctx.moveTo(c - 14, topY + 6);
      ctx.lineTo(c - 16, topY - 8);
      ctx.lineTo(c - 6, topY - 1);
      ctx.lineTo(c, topY - 11);
      ctx.lineTo(c + 6, topY - 1);
      ctx.lineTo(c + 16, topY - 8);
      ctx.lineTo(c + 14, topY + 6);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      fillStrokeCircle(ctx, c, topY + 1, 2.5, style.accent, 1.5);
      break;
    }
    case 'helmet': {
      ctx.fillStyle = style.hatColor;
      ctx.beginPath();
      ctx.arc(c, topY + 10, rx + 2, Math.PI, Math.PI * 2);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = style.accent;
      roundRectPath(ctx, c - 3, topY - 11, 6, 12, 2);
      ctx.fill();
      ctx.stroke();
      break;
    }
    case 'horns': {
      ctx.fillStyle = style.hatColor;
      for (const dir of [-1, 1]) {
        ctx.beginPath();
        ctx.moveTo(c + dir * 7, topY + 4);
        ctx.lineTo(c + dir * 16, topY - 11);
        ctx.lineTo(c + dir * 13, topY + 7);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
      }
      break;
    }
    case 'halo': {
      ctx.strokeStyle = INK;
      ctx.lineWidth = 5.5;
      ctx.beginPath();
      ctx.ellipse(c, topY - 5, 14, 4.2, 0, 0, Math.PI * 2);
      ctx.stroke();
      ctx.strokeStyle = style.hatColor;
      ctx.lineWidth = 2.8;
      ctx.stroke();
      break;
    }
    case 'spiky': {
      ctx.fillStyle = style.hatColor;
      ctx.beginPath();
      ctx.moveTo(c - 14, topY + 7);
      ctx.lineTo(c - 17, topY - 7);
      ctx.lineTo(c - 7, topY - 1);
      ctx.lineTo(c, topY - 13);
      ctx.lineTo(c + 7, topY - 1);
      ctx.lineTo(c + 17, topY - 7);
      ctx.lineTo(c + 14, topY + 7);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      break;
    }
    case 'nurse': {
      ctx.fillStyle = '#ffffff';
      roundRectPath(ctx, c - 12, topY - 7, 24, 13, 3);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = style.accent;
      ctx.fillRect(c - 2, topY - 4.5, 4, 8);
      ctx.fillRect(c - 4.5, topY - 2, 9, 3.5);
      break;
    }
    case 'straw': {
      ctx.fillStyle = style.hatColor;
      ctx.beginPath();
      ctx.ellipse(c, topY + 4, rx + 8, 5, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      roundRectPath(ctx, c - 12, topY - 8, 24, 12, 4);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = style.accent;
      ctx.fillRect(c - 12, topY + 1, 24, 3);
      break;
    }
    case 'visor':
    case 'cap':
    case 'beanie': {
      ctx.fillStyle = style.hatColor;
      ctx.beginPath();
      ctx.arc(c, topY + 8, rx * 0.9, Math.PI, Math.PI * 2);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = style.accent;
      ctx.beginPath();
      ctx.ellipse(c + 6, topY + 8, 12, 3.2, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      break;
    }
    default:
      break;
  }
}

// ----------------------------------------------------------------------------
// Weapon Sprites (64x64, facing right +X)
// ----------------------------------------------------------------------------

function drawWeaponSprite(ctx: CanvasRenderingContext2D, spriteId: string, size: number): void {
  const key = spriteId.replace(/^weapon_(?:icon_)?/, '');
  const c = size / 2;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.strokeStyle = INK;
  ctx.lineWidth = 3;

  switch (key) {
    case 'fist':
    case 'claw':
    case 'flaming_knuckles': {
      const col = key === 'flaming_knuckles' ? '#ff6a1a' : key === 'claw' ? '#cbd5e1' : '#e8c499';
      roundRectPath(ctx, 14, 18, 34, 28, 11);
      ctx.fillStyle = col;
      ctx.fill();
      ctx.stroke();
      // Knuckle lines
      ctx.beginPath();
      ctx.moveTo(32, 20);
      ctx.lineTo(32, 44);
      ctx.moveTo(40, 22);
      ctx.lineTo(40, 42);
      ctx.stroke();
      // Thumb
      roundRectPath(ctx, 20, 38, 16, 10, 5);
      ctx.fill();
      ctx.stroke();
      return;
    }
    case 'knife':
    case 'lightning_shiv': {
      // Handle
      roundRectPath(ctx, 8, c - 4.5, 16, 9, 3);
      ctx.fillStyle = '#991b1b';
      ctx.fill();
      ctx.stroke();
      // Guard
      roundRectPath(ctx, 22, c - 9, 5, 18, 2);
      ctx.fillStyle = '#eab308';
      ctx.fill();
      ctx.stroke();
      // Gleaming curved blade
      ctx.beginPath();
      ctx.moveTo(27, c - 6);
      ctx.lineTo(56, c);
      ctx.lineTo(48, c + 6);
      ctx.lineTo(27, c + 6);
      ctx.closePath();
      ctx.fillStyle = key === 'lightning_shiv' ? '#7dd3fc' : '#e2e8f0';
      ctx.fill();
      ctx.stroke();
      return;
    }
    case 'stick':
    case 'torch': {
      ctx.fillStyle = '#8b5a2b';
      roundRectPath(ctx, 8, c - 4.5, 44, 9, 4);
      ctx.fill();
      ctx.stroke();
      if (key === 'torch') {
        drawStarPolygon(ctx, 51, c, 7, 11, 5.5);
        ctx.fillStyle = '#ff6a1a';
        ctx.fill();
        ctx.stroke();
        fillStrokeCircle(ctx, 50, c, 4.5, '#ffe552', 0);
      } else {
        // Sprouting leaf
        ctx.fillStyle = '#4ade80';
        ctx.beginPath();
        ctx.ellipse(46, c - 10, 8, 4.5, -0.5, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      }
      return;
    }
    case 'sword':
    case 'excalibur': {
      // Pommel + grip
      roundRectPath(ctx, 6, c - 4, 14, 8, 3);
      ctx.fillStyle = key === 'excalibur' ? '#3b82f6' : '#7c2d12';
      ctx.fill();
      ctx.stroke();
      // Crossguard
      roundRectPath(ctx, 18, c - 13, 6, 26, 3);
      ctx.fillStyle = '#facc15';
      ctx.fill();
      ctx.stroke();
      // Broad blade
      ctx.beginPath();
      ctx.moveTo(24, c - 7);
      ctx.lineTo(52, c - 5);
      ctx.lineTo(59, c);
      ctx.lineTo(52, c + 5);
      ctx.lineTo(24, c + 7);
      ctx.closePath();
      ctx.fillStyle = key === 'excalibur' ? '#fef08a' : '#e2e8f0';
      ctx.fill();
      ctx.stroke();
      // Fuller shine
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(28, c - 2);
      ctx.lineTo(52, c - 1);
      ctx.stroke();
      return;
    }
    case 'spear': {
      // Shaft
      roundRectPath(ctx, 4, c - 3, 38, 6, 2);
      ctx.fillStyle = '#92400e';
      ctx.fill();
      ctx.stroke();
      // Crimson tassel
      ctx.fillStyle = '#ef4444';
      ctx.beginPath();
      ctx.ellipse(39, c + 7, 5, 3, 0.4, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      // Spearhead
      ctx.beginPath();
      ctx.moveTo(39, c - 8);
      ctx.lineTo(60, c);
      ctx.lineTo(39, c + 8);
      ctx.lineTo(43, c);
      ctx.closePath();
      ctx.fillStyle = '#e2e8f0';
      ctx.fill();
      ctx.stroke();
      return;
    }
    case 'scissors': {
      // Twin finger rings
      fillStrokeCircle(ctx, 15, c - 9, 7, '#ef4444', 3);
      fillStrokeCircle(ctx, 15, c + 9, 7, '#ef4444', 3);
      fillStrokeCircle(ctx, 15, c - 9, 3, '#15131c', 0);
      fillStrokeCircle(ctx, 15, c + 9, 3, '#15131c', 0);
      // Blades
      ctx.fillStyle = '#e2e8f0';
      ctx.beginPath();
      ctx.moveTo(22, c - 6);
      ctx.lineTo(56, c - 10);
      ctx.lineTo(44, c);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(22, c + 6);
      ctx.lineTo(56, c + 10);
      ctx.lineTo(44, c);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      fillStrokeCircle(ctx, 30, c, 3, '#facc15', 2);
      return;
    }
    case 'wrench': {
      roundRectPath(ctx, 10, c - 4.5, 32, 9, 3);
      ctx.fillStyle = '#94a3b8';
      ctx.fill();
      ctx.stroke();
      // Grip wrap
      roundRectPath(ctx, 12, c - 4.5, 13, 9, 2);
      ctx.fillStyle = '#2563eb';
      ctx.fill();
      ctx.stroke();
      // Open jaw head
      ctx.fillStyle = '#cbd5e1';
      ctx.beginPath();
      ctx.arc(46, c, 12, 0.55, Math.PI * 2 - 0.55);
      ctx.lineTo(45, c - 4.5);
      ctx.lineTo(45, c + 4.5);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      return;
    }
    case 'cactus_mace':
    case 'cacti_club': {
      roundRectPath(ctx, 8, c - 4, 18, 8, 3);
      ctx.fillStyle = '#8b5a2b';
      ctx.fill();
      ctx.stroke();
      // Spiky green cactus club head
      ctx.fillStyle = '#22c55e';
      ctx.beginPath();
      ctx.ellipse(41, c, 16, 11, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      // Spikes
      ctx.strokeStyle = '#fef08a';
      ctx.lineWidth = 2.2;
      for (const [sx, sy, dx, dy] of [
        [34, c - 10, -2, -5],
        [44, c - 11, 1, -5],
        [55, c, 5, 0],
        [44, c + 11, 1, 5],
        [34, c + 10, -2, 5],
      ]) {
        ctx.beginPath();
        ctx.moveTo(sx, sy);
        ctx.lineTo(sx + dx, sy + dy);
        ctx.stroke();
      }
      fillStrokeCircle(ctx, 52, c - 7, 4, '#f472b6', 2);
      return;
    }
    case 'pistol': {
      // Grip
      ctx.fillStyle = '#5c4033';
      ctx.beginPath();
      ctx.moveTo(14, c + 1);
      ctx.lineTo(24, c + 1);
      ctx.lineTo(20, c + 18);
      ctx.lineTo(10, c + 16);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      // Slide & barrel
      roundRectPath(ctx, 13, c - 9, 39, 13, 3);
      ctx.fillStyle = '#64748b';
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = '#cbd5e1';
      ctx.fillRect(17, c - 6.5, 31, 4);
      return;
    }
    case 'smg':
    case 'minigun':
    case 'chain_gun': {
      // Grip + extended mag
      ctx.fillStyle = '#334155';
      roundRectPath(ctx, 13, c + 3, 9, 14, 2);
      ctx.fill();
      ctx.stroke();
      roundRectPath(ctx, 30, c + 3, 8, 17, 2);
      ctx.fillStyle = '#475569';
      ctx.fill();
      ctx.stroke();
      // Receiver
      roundRectPath(ctx, 10, c - 9, 36, 15, 3);
      ctx.fillStyle = '#1e293b';
      ctx.fill();
      ctx.stroke();
      // Barrel
      roundRectPath(ctx, 45, c - 6, 13, 7, 2);
      ctx.fillStyle = '#94a3b8';
      ctx.fill();
      ctx.stroke();
      // Red dot sight
      fillStrokeCircle(ctx, 26, c - 10, 3.5, '#ef4444', 2);
      return;
    }
    case 'double_barrel_shotgun':
    case 'combat_shotgun': {
      // Wooden stock
      ctx.fillStyle = '#9a5b2c';
      ctx.beginPath();
      ctx.moveTo(6, c + 10);
      ctx.lineTo(22, c - 2);
      ctx.lineTo(26, c + 7);
      ctx.lineTo(10, c + 17);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      // Twin steel barrels
      roundRectPath(ctx, 20, c - 8, 38, 7, 2);
      ctx.fillStyle = '#64748b';
      ctx.fill();
      ctx.stroke();
      roundRectPath(ctx, 20, c - 2, 38, 7, 2);
      ctx.fillStyle = '#94a3b8';
      ctx.fill();
      ctx.stroke();
      // Wooden forend
      roundRectPath(ctx, 26, c + 2, 16, 6, 2);
      ctx.fillStyle = '#b45309';
      ctx.fill();
      ctx.stroke();
      return;
    }
    case 'slingshot': {
      ctx.strokeStyle = INK;
      ctx.lineWidth = 8;
      ctx.beginPath();
      ctx.moveTo(12, c);
      ctx.lineTo(30, c);
      ctx.lineTo(48, c - 14);
      ctx.moveTo(30, c);
      ctx.lineTo(48, c + 14);
      ctx.stroke();
      ctx.strokeStyle = '#a16207';
      ctx.lineWidth = 4.5;
      ctx.stroke();
      // Elastic band + pouch
      ctx.strokeStyle = '#ef4444';
      ctx.lineWidth = 2.6;
      ctx.beginPath();
      ctx.moveTo(48, c - 13);
      ctx.lineTo(38, c);
      ctx.lineTo(48, c + 13);
      ctx.stroke();
      fillStrokeCircle(ctx, 37, c, 4.5, '#94a3b8', 2);
      return;
    }
    case 'wand': {
      roundRectPath(ctx, 8, c - 3.5, 36, 7, 3);
      ctx.fillStyle = '#78350f';
      ctx.fill();
      ctx.stroke();
      // Glowing arcane gem
      drawStarPolygon(ctx, 48, c, 6, 11, 6);
      ctx.fillStyle = '#38bdf8';
      ctx.fill();
      ctx.stroke();
      fillStrokeCircle(ctx, 48, c, 4, '#ffffff', 0);
      return;
    }
    case 'laser_gun':
    case 'gatling_laser':
    case 'obliterator': {
      roundRectPath(ctx, 13, c + 2, 10, 14, 3);
      ctx.fillStyle = '#334155';
      ctx.fill();
      ctx.stroke();
      roundRectPath(ctx, 10, c - 10, 40, 17, 6);
      ctx.fillStyle = '#e2e8f0';
      ctx.fill();
      ctx.stroke();
      // Glowing cyan plasma core
      roundRectPath(ctx, 20, c - 5, 22, 7, 3);
      ctx.fillStyle = '#22d3ee';
      ctx.fill();
      ctx.stroke();
      // Emitter ring
      roundRectPath(ctx, 49, c - 7, 9, 11, 2);
      ctx.fillStyle = '#0ea5e9';
      ctx.fill();
      ctx.stroke();
      return;
    }
    case 'shuriken': {
      drawStarPolygon(ctx, c, c, 4, 24, 9, Math.PI / 4);
      ctx.fillStyle = '#cbd5e1';
      ctx.fill();
      ctx.stroke();
      fillStrokeCircle(ctx, c, c, 6.5, '#ef4444', 2.5);
      fillStrokeCircle(ctx, c, c, 2.5, INK, 0);
      return;
    }
    case 'rocket_launcher':
    case 'nuclear_launcher': {
      // Launcher tube
      roundRectPath(ctx, 8, c - 10, 40, 20, 4);
      ctx.fillStyle = key === 'nuclear_launcher' ? '#ca8a04' : '#4d7c0f';
      ctx.fill();
      ctx.stroke();
      // Rear flare
      roundRectPath(ctx, 5, c - 12, 7, 24, 2);
      ctx.fillStyle = '#334155';
      ctx.fill();
      ctx.stroke();
      // Warhead peeking out front
      ctx.beginPath();
      ctx.moveTo(47, c - 8);
      ctx.quadraticCurveTo(60, c, 47, c + 8);
      ctx.closePath();
      ctx.fillStyle = '#ef4444';
      ctx.fill();
      ctx.stroke();
      // Caution stripe
      ctx.fillStyle = '#facc15';
      ctx.fillRect(26, c - 8, 6, 16);
      return;
    }
    default: {
      // Deterministic stylish weapon silhouette for any Wave 2 weapon_*
      const h = hashStr(key);
      const isMelee =
        key.includes('axe') ||
        key.includes('hammer') ||
        key.includes('blade') ||
        key.includes('scythe') ||
        key.includes('shield') ||
        key.includes('club') ||
        key.includes('mace') ||
        key.includes('staff') ||
        key.includes('dagger') ||
        key.includes('lance') ||
        key.includes('pan') ||
        (h & 1) === 0;
      const accent = hsl(h % 360, 75, 55);
      if (isMelee) {
        roundRectPath(ctx, 8, c - 3.5, 30, 7, 3);
        ctx.fillStyle = '#78350f';
        ctx.fill();
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(32, c - 13);
        ctx.lineTo(56, c - 4);
        ctx.lineTo(56, c + 4);
        ctx.lineTo(32, c + 13);
        ctx.closePath();
        ctx.fillStyle = accent;
        ctx.fill();
        ctx.stroke();
      } else {
        roundRectPath(ctx, 14, c + 2, 10, 14, 3);
        ctx.fillStyle = '#334155';
        ctx.fill();
        ctx.stroke();
        roundRectPath(ctx, 10, c - 9, 44, 15, 4);
        ctx.fillStyle = accent;
        ctx.fill();
        ctx.stroke();
        roundRectPath(ctx, 20, c - 5, 20, 6, 2);
        ctx.fillStyle = '#ffffff';
        ctx.fill();
      }
    }
  }
}

// ----------------------------------------------------------------------------
// Enemies, Elites & Bosses
// ----------------------------------------------------------------------------

function drawEnemySprite(ctx: CanvasRenderingContext2D, spriteId: string, size: number): void {
  const key = spriteId.replace(/^enemy_(?:icon_)?/, '');
  const c = size / 2;
  const s = size / 64;
  ctx.save();
  ctx.scale(s, s);
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.strokeStyle = INK;
  ctx.lineWidth = 3.2;

  switch (key) {
    case 'predator': {
      // Imposing Wave 20 Apex Razor-Jaw Boss!
      // Scythe shoulder blades
      ctx.fillStyle = '#dc2626';
      for (const dir of [-1, 1]) {
        ctx.beginPath();
        ctx.moveTo(32 + dir * 16, 22);
        ctx.lineTo(32 + dir * 29, 7);
        ctx.lineTo(32 + dir * 25, 29);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
      }
      // Armored obsidian-crimson carapace
      ctx.beginPath();
      ctx.moveTo(14, 24);
      ctx.lineTo(22, 11);
      ctx.lineTo(42, 11);
      ctx.lineTo(50, 24);
      ctx.lineTo(48, 48);
      ctx.lineTo(32, 56);
      ctx.lineTo(16, 48);
      ctx.closePath();
      ctx.fillStyle = '#3b1526';
      ctx.fill();
      ctx.stroke();
      // Armor ridge plates
      ctx.fillStyle = '#7f1d1d';
      roundRectPath(ctx, 20, 16, 24, 14, 4);
      ctx.fill();
      ctx.stroke();
      // Glowing predator visor eyes
      ctx.fillStyle = '#facc15';
      ctx.beginPath();
      ctx.moveTo(20, 25);
      ctx.lineTo(29, 28);
      ctx.lineTo(21, 31);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(44, 25);
      ctx.lineTo(35, 28);
      ctx.lineTo(43, 31);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      // Razor jaw fangs
      ctx.fillStyle = '#fef2f2';
      for (let i = 0; i < 4; i++) {
        const fx = 22 + i * 6;
        ctx.beginPath();
        ctx.moveTo(fx, 40);
        ctx.lineTo(fx + 3, 49);
        ctx.lineTo(fx + 6, 40);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
      }
      break;
    }
    case 'invoker': {
      // Imposing Wave 20 Floating Arcane Obsidian Construct Boss!
      // Outer levitating rune ring
      ctx.strokeStyle = '#a855f7';
      ctx.lineWidth = 3.5;
      ctx.beginPath();
      ctx.arc(32, 32, 26, 0, Math.PI * 2);
      ctx.stroke();
      // Orbiting crystal shards
      ctx.strokeStyle = INK;
      ctx.lineWidth = 2.6;
      for (let i = 0; i < 4; i++) {
        const a = (i * Math.PI) / 2 + Math.PI / 4;
        const sx = 32 + Math.cos(a) * 24;
        const sy = 32 + Math.sin(a) * 24;
        drawStarPolygon(ctx, sx, sy, 4, 7, 3.5, a);
        ctx.fillStyle = '#f43f5e';
        ctx.fill();
        ctx.stroke();
      }
      // Obsidian diamond monolith body
      ctx.beginPath();
      ctx.moveTo(32, 8);
      ctx.lineTo(50, 32);
      ctx.lineTo(32, 56);
      ctx.lineTo(14, 32);
      ctx.closePath();
      ctx.fillStyle = '#241438';
      ctx.fill();
      ctx.stroke();
      // Blazing arcane eye core
      fillStrokeCircle(ctx, 32, 32, 10, '#ff2a6d', 3);
      fillStrokeCircle(ctx, 32, 32, 4.5, '#ffffff', 0);
      break;
    }
    case 'butcher':
    case 'rhino':
    case 'colossus':
    case 'croc':
    case 'gargoyle':
    case 'mantis':
    case 'mom':
    case 'monk': {
      const isRhino = key === 'rhino';
      const bodyCol = isRhino ? '#b91c1c' : '#9333ea';
      // Elite golden crown / horns
      ctx.fillStyle = '#facc15';
      for (const dir of [-1, 1]) {
        ctx.beginPath();
        ctx.moveTo(32 + dir * 10, 16);
        ctx.lineTo(32 + dir * 24, 6);
        ctx.lineTo(32 + dir * 18, 22);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
      }
      // Heavy elite torso
      roundRectPath(ctx, 11, 14, 42, 40, 13);
      ctx.fillStyle = bodyCol;
      ctx.fill();
      ctx.stroke();
      // Glowing eyes
      fillStrokeCircle(ctx, 23, 28, 4.5, '#fef08a', 2.2);
      fillStrokeCircle(ctx, 41, 28, 4.5, '#fef08a', 2.2);
      // Fanged grin
      ctx.fillStyle = '#ffffff';
      roundRectPath(ctx, 20, 39, 24, 8, 3);
      ctx.fill();
      ctx.stroke();
      break;
    }
    case 'baby_alien': {
      // Round vibrant purple-magenta alien blob
      fillStrokeCircle(ctx, 32, 34, 18, '#c048d8', 3.2);
      // Antennae
      ctx.beginPath();
      ctx.moveTo(24, 17);
      ctx.lineTo(19, 9);
      ctx.moveTo(40, 17);
      ctx.lineTo(45, 9);
      ctx.stroke();
      fillStrokeCircle(ctx, 19, 9, 3.2, '#facc15', 2);
      fillStrokeCircle(ctx, 45, 9, 3.2, '#facc15', 2);
      // Angry yellow eyes
      fillStrokeCircle(ctx, 25, 31, 4.2, '#fef08a', 2);
      fillStrokeCircle(ctx, 39, 31, 4.2, '#fef08a', 2);
      fillStrokeCircle(ctx, 25, 31, 1.8, INK, 0);
      fillStrokeCircle(ctx, 39, 31, 1.8, INK, 0);
      break;
    }
    case 'chaser': {
      // Spiky agile purple-indigo rusher
      drawStarPolygon(ctx, 32, 34, 9, 22, 14);
      ctx.fillStyle = '#7c3aed';
      ctx.fill();
      ctx.stroke();
      fillStrokeCircle(ctx, 24, 31, 4, '#ff5252', 2);
      fillStrokeCircle(ctx, 40, 31, 4, '#ff5252', 2);
      ctx.beginPath();
      ctx.moveTo(23, 42);
      ctx.lineTo(32, 38);
      ctx.lineTo(41, 42);
      ctx.stroke();
      break;
    }
    case 'spitter': {
      // Bloated glowing crimson-orange acid spitter
      fillStrokeCircle(ctx, 32, 35, 19, '#e11d48', 3.2);
      // Glowing cheek sacs
      fillStrokeCircle(ctx, 16, 39, 7, '#fb923c', 2.4);
      fillStrokeCircle(ctx, 48, 39, 7, '#fb923c', 2.4);
      fillStrokeCircle(ctx, 32, 39, 6, '#ffe4e6', 2.4);
      fillStrokeCircle(ctx, 24, 26, 3.5, '#fef08a', 2);
      fillStrokeCircle(ctx, 40, 26, 3.5, '#fef08a', 2);
      break;
    }
    case 'charger': {
      // Sharp horned orange-red ramming alien
      ctx.fillStyle = '#f97316';
      ctx.beginPath();
      ctx.moveTo(32, 11);
      ctx.lineTo(52, 36);
      ctx.lineTo(44, 53);
      ctx.lineTo(20, 53);
      ctx.lineTo(12, 36);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      // Sharp white horns
      ctx.fillStyle = '#fef3c7';
      ctx.beginPath();
      ctx.moveTo(20, 24);
      ctx.lineTo(10, 9);
      ctx.lineTo(27, 18);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(44, 24);
      ctx.lineTo(54, 9);
      ctx.lineTo(37, 18);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      fillStrokeCircle(ctx, 25, 35, 3.8, '#ff2846', 2);
      fillStrokeCircle(ctx, 39, 35, 3.8, '#ff2846', 2);
      break;
    }
    case 'bruiser': {
      // Massive square-shouldered armored juggernaut
      roundRectPath(ctx, 10, 12, 44, 42, 10);
      ctx.fillStyle = '#4f46e5';
      ctx.fill();
      ctx.stroke();
      // Armored chest plate
      roundRectPath(ctx, 17, 34, 30, 15, 4);
      ctx.fillStyle = '#94a3b8';
      ctx.fill();
      ctx.stroke();
      fillStrokeCircle(ctx, 23, 24, 4.2, '#f97316', 2);
      fillStrokeCircle(ctx, 41, 24, 4.2, '#f97316', 2);
      break;
    }
    case 'fly': {
      // Translucent buzz wings
      ctx.fillStyle = 'rgba(203, 245, 255, 0.8)';
      ctx.beginPath();
      ctx.ellipse(15, 26, 12, 7, -0.45, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.beginPath();
      ctx.ellipse(49, 26, 12, 7, 0.45, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      // Insect body
      ctx.fillStyle = '#84cc16';
      ctx.beginPath();
      ctx.ellipse(32, 35, 11, 16, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      fillStrokeCircle(ctx, 27, 27, 4.5, '#ef4444', 2);
      fillStrokeCircle(ctx, 37, 27, 4.5, '#ef4444', 2);
      break;
    }
    case 'spawner':
    case 'egg': {
      // Pulsing hive mother / egg sac
      ctx.fillStyle = key === 'egg' ? '#db2777' : '#9d174d';
      ctx.beginPath();
      ctx.ellipse(32, 34, 18, 22, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      fillStrokeCircle(ctx, 24, 29, 5, '#f472b6', 2);
      fillStrokeCircle(ctx, 39, 34, 5.5, '#f472b6', 2);
      fillStrokeCircle(ctx, 29, 43, 4.5, '#f472b6', 2);
      break;
    }
    case 'buffer': {
      // Arcane purple aura totem
      ctx.strokeStyle = '#c084fc';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(32, 32, 24, 0, Math.PI * 2);
      ctx.stroke();
      ctx.strokeStyle = INK;
      ctx.lineWidth = 3;
      drawStarPolygon(ctx, 32, 32, 6, 17, 11);
      ctx.fillStyle = '#a855f7';
      ctx.fill();
      ctx.stroke();
      fillStrokeCircle(ctx, 32, 32, 5.5, '#f0abfc', 2);
      break;
    }
    case 'healer': {
      // Emerald medic alien with cross halo
      ctx.strokeStyle = '#4ade80';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(32, 32, 24, 0, Math.PI * 2);
      ctx.stroke();
      ctx.strokeStyle = INK;
      ctx.lineWidth = 3;
      fillStrokeCircle(ctx, 32, 33, 17, '#10b981', 3);
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(28, 23, 8, 20);
      ctx.fillRect(22, 29, 20, 8);
      break;
    }
    case 'looter': {
      // Golden treasure alien with bulging loot sack
      fillStrokeCircle(ctx, 42, 38, 13, '#eab308', 3);
      fillStrokeCircle(ctx, 26, 34, 15, '#f59e0b', 3);
      fillStrokeCircle(ctx, 22, 30, 3.5, '#ffffff', 2);
      fillStrokeCircle(ctx, 32, 30, 3.5, '#ffffff', 2);
      // Sparkle star
      drawStarPolygon(ctx, 46, 18, 4, 8, 3);
      ctx.fillStyle = '#fef08a';
      ctx.fill();
      ctx.stroke();
      break;
    }
    default: {
      const h = hashStr(key);
      const col = hsl(h % 360, 72, 52);
      const sides = 5 + (h % 4);
      drawStarPolygon(ctx, 32, 34, sides, 21, 14);
      ctx.fillStyle = col;
      ctx.fill();
      ctx.stroke();
      fillStrokeCircle(ctx, 25, 31, 4, '#fef08a', 2);
      fillStrokeCircle(ctx, 39, 31, 4, '#fef08a', 2);
      break;
    }
  }
  ctx.restore();
}

// ----------------------------------------------------------------------------
// Environment, Structures, Pickups, Upgrades, Items & Projectiles
// ----------------------------------------------------------------------------

function drawPropOrPickupSprite(ctx: CanvasRenderingContext2D, id: string, size: number): void {
  const c = size / 2;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.strokeStyle = INK;
  ctx.lineWidth = 3;

  if (id === 'tree_0' || id === 'tree_jungle') {
    const isJungle = id === 'tree_jungle';
    // Trunk
    roundRectPath(ctx, c - 7, size * 0.56, 14, size * 0.34, 4);
    ctx.fillStyle = '#7c4a26';
    ctx.fill();
    ctx.stroke();
    // Lush cel-shaded crown
    const leafMain = isJungle ? '#16a34a' : '#2d9e48';
    const leafLight = isJungle ? '#4ade80' : '#65d66e';
    fillStrokeCircle(ctx, c - 13, size * 0.44, 14, leafMain, 3);
    fillStrokeCircle(ctx, c + 13, size * 0.44, 14, leafMain, 3);
    fillStrokeCircle(ctx, c, size * 0.33, 18, leafMain, 3);
    fillStrokeCircle(ctx, c - 6, size * 0.28, 7, leafLight, 0);
    // Tiny alien berries
    fillStrokeCircle(ctx, c + 8, size * 0.36, 3.5, '#ff4757', 1.8);
    fillStrokeCircle(ctx, c - 9, size * 0.46, 3.5, '#ff4757', 1.8);
    return;
  }

  if (id.startsWith('structure_')) {
    if (id === 'structure_mine') {
      fillStrokeCircle(ctx, c, c + 4, 17, '#475569', 3);
      fillStrokeCircle(ctx, c, c + 2, 7, '#ef4444', 2.4);
      fillStrokeCircle(ctx, c - 2, c, 2, '#ffffff', 0);
      return;
    }
    if (id === 'structure_garden') {
      ctx.fillStyle = '#713f12';
      ctx.beginPath();
      ctx.ellipse(c, size * 0.72, 22, 10, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      fillStrokeCircle(ctx, c - 9, size * 0.54, 7, '#22c55e', 2.5);
      fillStrokeCircle(ctx, c + 9, size * 0.54, 7, '#22c55e', 2.5);
      fillStrokeCircle(ctx, c, size * 0.44, 9, '#4ade80', 2.5);
      fillStrokeCircle(ctx, c, size * 0.44, 4, '#ef4444', 1.8);
      return;
    }
    // Turret base + barrel
    const accent =
      id === 'structure_medical_turret'
        ? '#22c55e'
        : id === 'structure_laser_turret'
          ? '#38bdf8'
          : id === 'structure_explosive_turret'
            ? '#f97316'
            : '#facc15';
    roundRectPath(ctx, 14, 34, 36, 18, 5);
    ctx.fillStyle = '#475569';
    ctx.fill();
    ctx.stroke();
    fillStrokeCircle(ctx, c, 32, 14, '#94a3b8', 3);
    roundRectPath(ctx, c, 26, 24, 11, 3);
    ctx.fillStyle = accent;
    ctx.fill();
    ctx.stroke();
    return;
  }

  if (id.startsWith('material_') && id !== 'material_bag') {
    // Gleaming lime-green faceted material shard!
    const h = hashStr(id);
    const sides = 5 + (h % 3);
    drawStarPolygon(ctx, c, c, sides, 20, 14, (h % 6) * 0.3);
    ctx.fillStyle = '#5bff2e';
    ctx.fill();
    ctx.stroke();
    // Bright specular inner facet
    drawStarPolygon(ctx, c - 3, c - 3, sides, 10, 7, (h % 6) * 0.3);
    ctx.fillStyle = '#d4ff7a';
    ctx.fill();
    return;
  }

  if (id === 'material_bag') {
    ctx.fillStyle = '#ca8a04';
    ctx.beginPath();
    ctx.arc(c, c + 6, 17, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    roundRectPath(ctx, c - 9, c - 17, 18, 9, 3);
    ctx.fillStyle = '#eab308';
    ctx.fill();
    ctx.stroke();
    fillStrokeCircle(ctx, c, c + 6, 6, '#5bff2e', 2);
    return;
  }

  if (id === 'fruit' || id === 'consumable_fruit' || id === 'fruit_jungle') {
    fillStrokeCircle(ctx, c, c + 4, 16, '#ff334b', 3.2);
    // Shine highlight
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.ellipse(c - 6, c - 2, 4.5, 2.8, -0.6, 0, Math.PI * 2);
    ctx.fill();
    // Leaf
    ctx.fillStyle = '#4ade80';
    ctx.beginPath();
    ctx.ellipse(c + 6, c - 14, 9, 4.5, -0.4, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    return;
  }

  if (id === 'crate' || id === 'crate_normal' || id === 'crate_legendary') {
    const leg = id === 'crate_legendary';
    roundRectPath(ctx, 10, 12, 44, 42, 6);
    ctx.fillStyle = leg ? '#dc2626' : '#a16207';
    ctx.fill();
    ctx.stroke();
    // Horizontal metal/gold bands
    ctx.fillStyle = leg ? '#facc15' : '#cbd5e1';
    ctx.fillRect(11, 24, 42, 6);
    ctx.strokeRect(11, 24, 42, 6);
    // Center latch / gem
    roundRectPath(ctx, c - 7, 21, 14, 14, 3);
    ctx.fillStyle = leg ? '#fef08a' : '#f59e0b';
    ctx.fill();
    ctx.stroke();
    return;
  }

  if (id.startsWith('proj_')) {
    if (id === 'proj_enemy' || id === 'proj_enemy_long') {
      // HIGH-VISIBILITY ENEMY BULLET: blazing crimson halo + dark contrast + pure white core
      const g = ctx.createRadialGradient(c, c, 4, c, c, 28);
      g.addColorStop(0, 'rgba(255, 28, 68, 0.95)');
      g.addColorStop(0.65, 'rgba(255, 23, 68, 0.55)');
      g.addColorStop(1, 'rgba(255, 23, 68, 0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(c, c, 28, 0, Math.PI * 2);
      ctx.fill();

      fillStrokeCircle(ctx, c, c, 15, '#ff1744', 3.5, INK);
      fillStrokeCircle(ctx, c, c, 8.5, '#ffffff', 0);
      return;
    }
    if (id === 'proj_laser' || id === 'proj_railgun') {
      roundRectPath(ctx, 8, c - 6, 48, 12, 6);
      ctx.fillStyle = '#38bdf8';
      ctx.fill();
      ctx.stroke();
      roundRectPath(ctx, 14, c - 2.5, 36, 5, 2.5);
      ctx.fillStyle = '#ffffff';
      ctx.fill();
      return;
    }
    if (id === 'proj_rocket' || id === 'proj_nuclear') {
      ctx.fillStyle = '#ef4444';
      ctx.beginPath();
      ctx.moveTo(14, c - 8);
      ctx.lineTo(44, c - 8);
      ctx.lineTo(56, c);
      ctx.lineTo(44, c + 8);
      ctx.lineTo(14, c + 8);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      fillStrokeCircle(ctx, 10, c, 6, '#facc15', 2);
      return;
    }
    if (id === 'proj_shuriken' || id === 'proj_saw') {
      drawStarPolygon(ctx, c, c, 4, 22, 8, Math.PI / 4);
      ctx.fillStyle = '#e2e8f0';
      ctx.fill();
      ctx.stroke();
      fillStrokeCircle(ctx, c, c, 5, '#ef4444', 2);
      return;
    }
    if (id === 'proj_flame' || id === 'proj_fireball') {
      drawStarPolygon(ctx, c, c, 8, 22, 13);
      ctx.fillStyle = '#ff6a1a';
      ctx.fill();
      ctx.stroke();
      fillStrokeCircle(ctx, c, c, 9, '#fef08a', 0);
      return;
    }
    // Crisp default player projectile (bright yellow/white bullet pill)
    roundRectPath(ctx, 12, c - 8, 40, 16, 8);
    ctx.fillStyle = '#ffe552';
    ctx.fill();
    ctx.stroke();
    roundRectPath(ctx, 20, c - 3.5, 24, 7, 3.5);
    ctx.fillStyle = '#ffffff';
    ctx.fill();
    return;
  }

  if (id.startsWith('upgrade_')) {
    drawUpgradeIcon(ctx, id.replace(/^upgrade_/, '') as CoreStatKey, size);
    return;
  }

  if (id.startsWith('item_')) {
    drawItemIcon(ctx, id.slice(5), size);
    return;
  }

  fillStrokeCircle(ctx, c, c, 18, '#a855f7', 3);
}

function drawUpgradeIcon(ctx: CanvasRenderingContext2D, stat: CoreStatKey, size: number): void {
  const c = size / 2;
  ctx.strokeStyle = INK;
  ctx.lineWidth = 3;
  // Crisp emblem backing
  roundRectPath(ctx, 8, 8, size - 16, size - 16, 12);
  ctx.fillStyle = '#1e1c2b';
  ctx.fill();
  ctx.stroke();

  switch (stat) {
    case 'stat_max_hp': {
      ctx.fillStyle = '#ef4444';
      ctx.beginPath();
      ctx.moveTo(c, 48);
      ctx.bezierCurveTo(10, 34, 14, 16, c, 24);
      ctx.bezierCurveTo(50, 16, 54, 34, c, 48);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      break;
    }
    case 'stat_hp_regen': {
      ctx.fillStyle = '#22c55e';
      roundRectPath(ctx, c - 7, 15, 14, 34, 3);
      ctx.fill();
      ctx.stroke();
      roundRectPath(ctx, 15, c - 7, 34, 14, 3);
      ctx.fill();
      ctx.stroke();
      break;
    }
    case 'stat_lifesteal': {
      ctx.fillStyle = '#e11d48';
      ctx.beginPath();
      ctx.moveTo(c, 13);
      ctx.quadraticCurveTo(49, 34, c, 49);
      ctx.quadraticCurveTo(15, 34, c, 13);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      break;
    }
    case 'stat_percent_damage': {
      drawStarPolygon(ctx, c, c, 8, 20, 11);
      ctx.fillStyle = '#f97316';
      ctx.fill();
      ctx.stroke();
      break;
    }
    case 'stat_melee_damage': {
      ctx.fillStyle = '#f43f5e';
      ctx.beginPath();
      ctx.moveTo(16, 48);
      ctx.lineTo(44, 14);
      ctx.lineTo(50, 20);
      ctx.lineTo(22, 50);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      break;
    }
    case 'stat_ranged_damage': {
      fillStrokeCircle(ctx, c, c, 16, '#38bdf8', 3);
      fillStrokeCircle(ctx, c, c, 8, '#ffffff', 2);
      fillStrokeCircle(ctx, c, c, 3, '#ef4444', 0);
      break;
    }
    case 'stat_elemental_damage': {
      drawStarPolygon(ctx, c, c, 6, 20, 10);
      ctx.fillStyle = '#a855f7';
      ctx.fill();
      ctx.stroke();
      fillStrokeCircle(ctx, c, c, 6, '#38bdf8', 2);
      break;
    }
    case 'stat_attack_speed': {
      ctx.fillStyle = '#facc15';
      ctx.beginPath();
      ctx.moveTo(36, 12);
      ctx.lineTo(18, 35);
      ctx.lineTo(31, 35);
      ctx.lineTo(26, 52);
      ctx.lineTo(46, 28);
      ctx.lineTo(33, 28);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      break;
    }
    case 'stat_crit_chance': {
      drawStarPolygon(ctx, c, c, 5, 20, 8);
      ctx.fillStyle = '#fde047';
      ctx.fill();
      ctx.stroke();
      break;
    }
    case 'stat_engineering': {
      drawStarPolygon(ctx, c, c, 8, 19, 14);
      ctx.fillStyle = '#94a3b8';
      ctx.fill();
      ctx.stroke();
      fillStrokeCircle(ctx, c, c, 7, '#1e1c2b', 2.5);
      break;
    }
    case 'stat_range': {
      ctx.strokeStyle = '#60a5fa';
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.moveTo(16, c);
      ctx.lineTo(48, c);
      ctx.moveTo(38, 20);
      ctx.lineTo(48, c);
      ctx.lineTo(38, 44);
      ctx.stroke();
      break;
    }
    case 'stat_armor': {
      ctx.fillStyle = '#cbd5e1';
      ctx.beginPath();
      ctx.moveTo(16, 16);
      ctx.lineTo(48, 16);
      ctx.lineTo(45, 36);
      ctx.lineTo(c, 50);
      ctx.lineTo(19, 36);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      break;
    }
    case 'stat_dodge': {
      ctx.strokeStyle = '#22d3ee';
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.arc(c, c, 15, 0.3, Math.PI * 1.6);
      ctx.stroke();
      fillStrokeCircle(ctx, 44, 22, 4, '#22d3ee', 2);
      break;
    }
    case 'stat_speed': {
      ctx.fillStyle = '#38bdf8';
      ctx.beginPath();
      ctx.moveTo(15, 38);
      ctx.lineTo(42, 38);
      ctx.lineTo(48, 24);
      ctx.lineTo(35, 28);
      ctx.lineTo(28, 18);
      ctx.lineTo(15, 28);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      break;
    }
    case 'stat_luck': {
      ctx.fillStyle = '#4ade80';
      fillStrokeCircle(ctx, c - 7, c - 7, 8, '#4ade80', 2.5);
      fillStrokeCircle(ctx, c + 7, c - 7, 8, '#4ade80', 2.5);
      fillStrokeCircle(ctx, c - 7, c + 7, 8, '#4ade80', 2.5);
      fillStrokeCircle(ctx, c + 7, c + 7, 8, '#4ade80', 2.5);
      break;
    }
    case 'stat_harvesting': {
      drawStarPolygon(ctx, c, c, 6, 19, 13);
      ctx.fillStyle = '#6bff3b';
      ctx.fill();
      ctx.stroke();
      break;
    }
  }
}

function drawItemIcon(ctx: CanvasRenderingContext2D, key: string, size: number): void {
  const c = size / 2;
  const h = hashStr(key);
  ctx.strokeStyle = INK;
  ctx.lineWidth = 3;

  // Hand-crafted high-impact flagship items + crisp stylized fallback
  switch (key) {
    case 'lemonade': {
      roundRectPath(ctx, 20, 18, 24, 32, 4);
      ctx.fillStyle = '#fde047';
      ctx.fill();
      ctx.stroke();
      ctx.strokeStyle = '#ef4444';
      ctx.lineWidth = 3.5;
      ctx.beginPath();
      ctx.moveTo(36, 18);
      ctx.lineTo(44, 8);
      ctx.stroke();
      return;
    }
    case 'piggy_bank': {
      ctx.fillStyle = '#f472b6';
      ctx.beginPath();
      ctx.ellipse(c, c + 4, 20, 15, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      fillStrokeCircle(ctx, 48, c + 4, 5, '#fb7185', 2.5);
      ctx.fillStyle = INK;
      ctx.fillRect(26, c - 7, 12, 3);
      return;
    }
    case 'crown': {
      ctx.fillStyle = '#facc15';
      ctx.beginPath();
      ctx.moveTo(12, 46);
      ctx.lineTo(10, 20);
      ctx.lineTo(24, 30);
      ctx.lineTo(c, 14);
      ctx.lineTo(40, 30);
      ctx.lineTo(54, 20);
      ctx.lineTo(52, 46);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      fillStrokeCircle(ctx, c, 36, 4.5, '#ef4444', 2);
      return;
    }
    case 'glasses': {
      fillStrokeCircle(ctx, 21, c, 10, '#7dd3fc', 3);
      fillStrokeCircle(ctx, 43, c, 10, '#7dd3fc', 3);
      ctx.beginPath();
      ctx.moveTo(31, c);
      ctx.lineTo(33, c);
      ctx.stroke();
      return;
    }
    case 'coffee': {
      roundRectPath(ctx, 16, 20, 26, 28, 5);
      ctx.fillStyle = '#f8fafc';
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = '#78350f';
      ctx.fillRect(19, 23, 20, 7);
      ctx.beginPath();
      ctx.arc(42, 34, 7, -Math.PI / 2, Math.PI / 2);
      ctx.stroke();
      return;
    }
    case 'tree': {
      drawPropOrPickupSprite(ctx, 'tree_0', size);
      return;
    }
    case 'turret':
    case 'medical_turret':
    case 'landmines':
    case 'garden': {
      const mapKey =
        key === 'landmines'
          ? 'structure_mine'
          : key === 'garden'
            ? 'structure_garden'
            : `structure_${key}`;
      drawPropOrPickupSprite(ctx, mapKey, size);
      return;
    }
    default: {
      // Deterministic comic-inked badge silhouette
      const primary = hsl(h % 360, 75, 56);
      const secondary = hsl((h + 150) % 360, 82, 66);
      const shape = h % 5;
      if (shape === 0) {
        // Potion flask
        fillStrokeCircle(ctx, c, 38, 16, primary, 3);
        roundRectPath(ctx, c - 6, 12, 12, 13, 3);
        ctx.fillStyle = '#cbd5e1';
        ctx.fill();
        ctx.stroke();
        fillStrokeCircle(ctx, c - 5, 35, 4, secondary, 0);
      } else if (shape === 1) {
        // Gem / crystal
        ctx.beginPath();
        ctx.moveTo(c, 10);
        ctx.lineTo(50, 28);
        ctx.lineTo(42, 52);
        ctx.lineTo(22, 52);
        ctx.lineTo(14, 28);
        ctx.closePath();
        ctx.fillStyle = primary;
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = secondary;
        ctx.beginPath();
        ctx.moveTo(c, 16);
        ctx.lineTo(40, 29);
        ctx.lineTo(c, 42);
        ctx.lineTo(24, 29);
        ctx.closePath();
        ctx.fill();
      } else if (shape === 2) {
        // Scroll / coupon / badge
        roundRectPath(ctx, 11, 16, 42, 32, 7);
        ctx.fillStyle = primary;
        ctx.fill();
        ctx.stroke();
        drawStarPolygon(ctx, c, c, 5, 11, 5);
        ctx.fillStyle = secondary;
        ctx.fill();
        ctx.stroke();
      } else if (shape === 3) {
        // Orb / cyberball
        fillStrokeCircle(ctx, c, c, 19, primary, 3.2);
        ctx.strokeStyle = secondary;
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(c, c, 12, 0.4, Math.PI * 1.4);
        ctx.stroke();
        fillStrokeCircle(ctx, c - 6, c - 6, 4, '#ffffff', 0);
      } else {
        // Emblem shield/medallion
        drawStarPolygon(ctx, c, c, 6, 21, 13);
        ctx.fillStyle = primary;
        ctx.fill();
        ctx.stroke();
        fillStrokeCircle(ctx, c, c, 8, secondary, 2.2);
      }
    }
  }
}

// ----------------------------------------------------------------------------
// Atlas Baker (2048x2048 Shelf Packer)
// ----------------------------------------------------------------------------

function createStubCanvas(): HTMLCanvasElement {
  return {
    width: ATLAS_SIZE,
    height: ATLAS_SIZE,
    getContext: () => null,
    toDataURL: () => '',
  } as unknown as HTMLCanvasElement;
}

export function createProceduralKrunkedAtlas(): ProceduralAtlasBundle {
  const hasDom = typeof document !== 'undefined';
  const canvas = hasDom ? document.createElement('canvas') : createStubCanvas();
  canvas.width = ATLAS_SIZE;
  canvas.height = ATLAS_SIZE;
  const ctx = hasDom ? canvas.getContext('2d') : null;

  const regions = new Map<string, AtlasRegion>();
  let cursorX = PAD;
  let cursorY = PAD;
  let rowHeight = 0;
  let version = 1;

  const allocateCell = (id: string, w: number, h: number): AtlasRegion => {
    const existing = regions.get(id);
    if (existing) return existing;

    if (cursorX + w + PAD > ATLAS_SIZE) {
      cursorX = PAD;
      cursorY += rowHeight + PAD;
      rowHeight = 0;
    }
    if (cursorY + h + PAD > ATLAS_SIZE) {
      // Overflow fallback: alias to vfx_circle if atlas ever fills completely
      return (
        regions.get('vfx_circle') ?? {
          id,
          x: 0,
          y: 0,
          w: 64,
          h: 64,
          u0: 0,
          v0: 0,
          u1: 64 / ATLAS_SIZE,
          v1: 64 / ATLAS_SIZE,
        }
      );
    }

    const x = cursorX;
    const y = cursorY;
    cursorX += w + PAD;
    if (h > rowHeight) rowHeight = h;

    const region: AtlasRegion = {
      id,
      x,
      y,
      w,
      h,
      u0: x / ATLAS_SIZE,
      v0: y / ATLAS_SIZE,
      u1: (x + w) / ATLAS_SIZE,
      v1: (y + h) / ATLAS_SIZE,
    };
    regions.set(id, region);
    return region;
  };

  const bakeSprite = (id: string, cellSize = 64): AtlasRegion => {
    const existing = regions.get(id);
    if (existing) return existing;
    const region = allocateCell(id, cellSize, cellSize);
    if (!ctx) return region;

    ctx.save();
    ctx.beginPath();
    ctx.rect(region.x, region.y, region.w, region.h);
    ctx.clip();
    ctx.translate(region.x, region.y);

    if (id.startsWith('vfx_') || id.startsWith('ui_') || id === 'spawn_telegraph') {
      drawVfxSprite(ctx, id, cellSize);
    } else if (id.startsWith('tile_')) {
      drawTileSprite(ctx, id, cellSize);
    } else if (id === 'player_body' || id === 'player_legs' || id.startsWith('char_')) {
      drawSpudCharacter(ctx, id, cellSize);
    } else if (id.startsWith('weapon_')) {
      drawWeaponSprite(ctx, id, cellSize);
    } else if (id.startsWith('enemy_')) {
      drawEnemySprite(ctx, id, cellSize);
    } else {
      drawPropOrPickupSprite(ctx, id, cellSize);
    }

    ctx.restore();
    return region;
  };

  const aliasRegion = (aliasId: string, targetId: string): void => {
    const target = regions.get(targetId);
    if (target && !regions.has(aliasId)) {
      regions.set(aliasId, { ...target, id: aliasId });
    }
  };

  // --- Row Tier 1: Large 128x128 Sprites (Tiles, Bosses, Major VFX) ---
  const largeIds = [
    'tile_crash_0', 'tile_crash_1', 'tile_crash_2', 'tile_crash_3', 'tile_crash_4', 'tile_crash_5', 'tile_crash_6',
    'tile_abyss_0', 'tile_abyss_1', 'tile_abyss_2',
    'tile_jungle_0', 'tile_jungle_1', 'tile_jungle_2',
    'enemy_predator', 'enemy_invoker',
    'vfx_slash', 'vfx_explosion',
  ];
  for (const id of largeIds) bakeSprite(id, 128);

  // --- Row Tier 2: Standard 64x64 Sprites ---
  const coreVfxAndUi = [
    'vfx_white', 'vfx_circle', 'vfx_ring', 'vfx_shadow', 'vfx_spawn_x', 'vfx_spark',
    'vfx_splat', 'vfx_scorch', 'vfx_crater',
    'ui_crosshair', 'ui_manual_cursor', 'ui_warning_arrow',
    'ui_boss_icon', 'ui_elite_icon', 'ui_horde_icon',
  ];
  for (const id of coreVfxAndUi) bakeSprite(id, 64);
  aliasRegion('spawn_telegraph', 'vfx_spawn_x');

  // Player & Characters
  bakeSprite('player_body', 64);
  bakeSprite('player_legs', 64);
  const initialChars = [
    'well_rounded', 'brawler', 'ranger', 'crazy', 'mage', 'chunky', 'speedy', 'multitasker',
    'knight', 'demon', 'bull', 'ghost', 'engineer', 'cyborg', 'doctor', 'farmer', 'king',
    'soldier', 'lucky', 'mutant', 'lich', 'old', 'generalist', 'loud', 'wildling', 'pacifist',
    'gladiator', 'saver', 'sick', 'explorer', 'hunter', 'artificer', 'arms_dealer', 'streamer',
    'glutton', 'jack', 'apprentice', 'cryptid', 'fisherman', 'golem', 'renegade', 'one_armed',
    'masochist',
  ];
  for (const c of initialChars) bakeSprite(`char_${c}`, 64);

  // Weapons
  const initialWeapons = [
    'fist', 'knife', 'stick', 'sword', 'spear', 'scissors', 'wrench', 'cactus_mace',
    'pistol', 'smg', 'double_barrel_shotgun', 'slingshot', 'wand', 'laser_gun', 'shuriken', 'rocket_launcher',
    'minigun', 'sniper_gun', 'flamethrower', 'taser', 'medical_gun', 'crossbow', 'ghost_axe',
    'lightning_shiv', 'spiky_shield', 'torch', 'claw', 'plasma_sledgehammer', 'gatling_laser',
    'nuclear_launcher', 'obliterator', 'chain_gun', 'excalibur', 'scythe', 'flaming_knuckles',
    'combat_shotgun', 'cacti_club',
  ];
  for (const w of initialWeapons) bakeSprite(`weapon_${w}`, 64);

  // Enemies & Elites
  const initialEnemies = [
    'baby_alien', 'chaser', 'spitter', 'charger', 'bruiser', 'fly', 'spawner', 'egg',
    'buffer', 'healer', 'looter', 'junkie', 'fin_alien', 'helmet_alien', 'slasher',
    'lamprey', 'pursuer', 'tentacle',
    'butcher', 'rhino', 'colossus', 'croc', 'gargoyle', 'mantis', 'mom', 'monk',
  ];
  for (const e of initialEnemies) bakeSprite(`enemy_${e}`, 64);

  // Trees, Structures, Pickups
  const envAndPickups = [
    'tree_0', 'tree_jungle',
    'structure_turret', 'structure_medical_turret', 'structure_laser_turret',
    'structure_explosive_turret', 'structure_flame_turret', 'structure_mine', 'structure_garden',
    'material_0', 'material_1', 'material_2', 'material_3', 'material_4', 'material_5',
    'material_6', 'material_7', 'material_8', 'material_9', 'material_10',
    'material_bag', 'material_ui',
    'fruit', 'fruit_jungle', 'crate', 'crate_legendary',
  ];
  for (const id of envAndPickups) bakeSprite(id, 64);
  aliasRegion('consumable_fruit', 'fruit');
  aliasRegion('crate_normal', 'crate');

  // Projectiles
  const projectiles = [
    'proj_bullet', 'proj_enemy', 'proj_enemy_long', 'proj_laser', 'proj_lightning',
    'proj_taser', 'proj_flame', 'proj_rocket', 'proj_nuclear', 'proj_fireball',
    'proj_icicle', 'proj_wand', 'proj_scepter', 'proj_slingshot', 'proj_shuriken',
    'proj_boomerang', 'proj_medical', 'proj_railgun', 'proj_shredder', 'proj_obliterator',
    'proj_potato', 'proj_molotov', 'proj_grenade', 'proj_blowgun', 'proj_flute',
    'proj_acid', 'proj_saw', 'proj_alien_eye',
  ];
  for (const p of projectiles) bakeSprite(p, 64);

  // 16 Core Stat Upgrades
  for (const statKey of CORE_STAT_KEYS) {
    bakeSprite(`upgrade_${statKey}`, 64);
  }

  // Flagship 30 Items
  const initialItems = [
    'lemonade', 'tree', 'coupon', 'bag', 'piggy_bank', 'scared_sausage', 'snake', 'bandana',
    'ricochet', 'turret', 'landmines', 'garden', 'medical_turret', 'cyberball', 'spicy_sauce',
    'adrenaline', 'tardigrade', 'glasses', 'sharp_bullet', 'alien_eyes', 'baby_with_a_beard',
    'hunting_trophy', 'crown', 'padding', 'rip_and_tear', 'blood_donation', 'lumberjack_shirt',
    'coffee', 'weird_food', 'cake',
  ];
  for (const item of initialItems) bakeSprite(`item_${item}`, 64);

  const ensureSprite = (spriteId: string): AtlasRegion => {
    const found = regions.get(spriteId);
    if (found) return found;
    const created = bakeSprite(spriteId, 64);
    version++;
    return created;
  };

  const ensureCatalogSprites = (catalog: GameDataCatalog): boolean => {
    const before = version;
    for (const c of catalog.characters) ensureSprite(c.visual.spriteId || `char_${c.id}`);
    for (const w of catalog.weapons) {
      ensureSprite(w.spriteId || `weapon_${w.id}`);
      if (w.projectileSpriteId) ensureSprite(w.projectileSpriteId);
    }
    for (const it of catalog.items) ensureSprite(it.spriteId || `item_${it.id}`);
    for (const u of catalog.upgrades) ensureSprite(u.iconId || `upgrade_${u.statKey}`);
    for (const e of catalog.enemies) ensureSprite(e.spriteId || `enemy_${e.id}`);
    return version !== before;
  };

  return {
    canvas,
    regions,
    ensureSprite,
    ensureCatalogSprites,
    getVersion: () => version,
  };
}
