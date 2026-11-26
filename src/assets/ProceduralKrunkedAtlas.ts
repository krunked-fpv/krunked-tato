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

  // 100% seamless base floor fill (zero outer border stroke!)
  if (isAbyss) {
    ctx.fillStyle = h % 2 === 0 ? '#182834' : '#1a2c39';
  } else if (isJungle) {
    ctx.fillStyle = h % 2 === 0 ? '#233422' : '#263925';
  } else {
    // Crash Zone warm alien dusty basalt-ochre crater floor
    ctx.fillStyle = h % 2 === 0 ? '#3a312b' : '#3d332d';
  }
  ctx.fillRect(0, 0, size, size);

  // Seamless periodically wrapped organic ground patches (zero edge seams!)
  for (let i = 0; i < 6; i++) {
    const px = seededFloat(h, i * 3 + 1) * size;
    const py = seededFloat(h, i * 3 + 2) * size;
    const rx = 10 + seededFloat(h, i * 3 + 3) * 20;
    const ry = rx * (0.55 + seededFloat(h, i * 3 + 4) * 0.35);
    const ang = seededFloat(h, i + 40) * Math.PI;
    if (isAbyss) {
      ctx.fillStyle = i % 2 === 0 ? 'rgba(13, 21, 30, 0.32)' : 'rgba(42, 102, 128, 0.16)';
    } else if (isJungle) {
      ctx.fillStyle = i % 2 === 0 ? 'rgba(20, 32, 18, 0.32)' : 'rgba(78, 122, 58, 0.17)';
    } else {
      ctx.fillStyle = i % 2 === 0 ? 'rgba(34, 26, 22, 0.26)' : 'rgba(108, 86, 68, 0.15)';
    }
    for (let ox = -1; ox <= 1; ox++) {
      const cx = px + ox * size;
      if (cx + rx < 0 || cx - rx > size) continue;
      for (let oy = -1; oy <= 1; oy++) {
        const cy = py + oy * size;
        if (cy + rx < 0 || cy - rx > size) continue;
        ctx.beginPath();
        ctx.ellipse(cx, cy, rx, ry, ang, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }

  // Scattered interior pebbles / bioluminescent specks / forest loam dots (kept clear of outer edge)
  const margin = 12;
  for (let i = 0; i < 9; i++) {
    const px = margin + seededFloat(h, 100 + i * 2) * (size - margin * 2);
    const py = margin + seededFloat(h, 101 + i * 2) * (size - margin * 2);
    const r = 1.8 + seededFloat(h, 130 + i) * 3.2;
    ctx.beginPath();
    ctx.arc(px, py, r, 0, Math.PI * 2);
    if (isAbyss) {
      ctx.fillStyle = i < 2 ? 'rgba(66, 234, 255, 0.30)' : 'rgba(11, 19, 28, 0.42)';
    } else if (isJungle) {
      ctx.fillStyle = i < 2 ? 'rgba(142, 238, 96, 0.26)' : 'rgba(17, 29, 15, 0.40)';
    } else {
      ctx.fillStyle = i % 3 === 0 ? 'rgba(138, 114, 94, 0.25)' : 'rgba(26, 20, 17, 0.38)';
    }
    ctx.fill();
  }

  // Subtle organic ground crack safely inside tile interior
  if (h % 3 === 0) {
    ctx.strokeStyle = isAbyss
      ? 'rgba(64, 216, 255, 0.18)'
      : isJungle
        ? 'rgba(14, 24, 14, 0.34)'
        : 'rgba(24, 18, 15, 0.34)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    const sx = size * (0.22 + seededFloat(h, 201) * 0.22);
    const sy = size * (0.24 + seededFloat(h, 202) * 0.22);
    ctx.moveTo(sx, sy);
    ctx.lineTo(sx + 16, sy + 10);
    ctx.lineTo(sx + 29, sy + 6);
    ctx.lineTo(sx + 42, sy + 18);
    ctx.stroke();
  }
}

// ----------------------------------------------------------------------------
// Player & Character Sprites (64x64)
// ----------------------------------------------------------------------------

type CharHat =
  | 'none'
  | 'headband'
  | 'hood'
  | 'wizard'
  | 'viking'
  | 'goggles'
  | 'crown'
  | 'helmet'
  | 'horns'
  | 'halo'
  | 'beanie'
  | 'cap'
  | 'spiky'
  | 'nurse'
  | 'straw'
  | 'visor'
  | 'fedora'
  | 'tophat'
  | 'chef'
  | 'jester'
  | 'mohawk'
  | 'beret'
  | 'rainhat'
  | 'safari'
  | 'wolf_hood'
  | 'bone_hair'
  | 'antlers'
  | 'antenna'
  | 'flowers'
  | 'icepack'
  | 'headset'
  | 'clock_halo'
  | 'turban'
  | 'vamp_hair'
  | 'bandage'
  | 'flame_crest'
  | 'crystal_brow'
  | 'clover_hat'
  | 'baby_curl'
  | 'cage_band'
  | 'cyber_wiz'
  | 'prism_crest'
  | 'leaf_crown'
  | 'cowboy'
  | 'mad_hair'
  | 'slouch';

type CharAccessory =
  | 'none'
  | 'blush'
  | 'bandaid'
  | 'scar'
  | 'eyepatch'
  | 'monocle'
  | 'spectacles'
  | 'warpaint'
  | 'collar_vamp'
  | 'scarf'
  | 'nose_ring'
  | 'third_eye'
  | 'freckles'
  | 'spark_coils'
  | 'thermometer'
  | 'orbit_beads'
  | 'star_lapel'
  | 'headlamp'
  | 'bandage_cheek'
  | 'rune_sparkle'
  | 'ear_wings';

type CharEye =
  | 'cute'
  | 'angry'
  | 'crazy'
  | 'glow'
  | 'shades'
  | 'cyclops'
  | 'dead'
  | 'hetero'
  | 'tired'
  | 'happy'
  | 'pixel'
  | 'slit';

type CharMouth =
  | 'smile'
  | 'grin'
  | 'frown'
  | 'open'
  | 'mustache'
  | 'beard'
  | 'dead'
  | 'pacifier'
  | 'fangs'
  | 'bandana'
  | 'wheat'
  | 'grille'
  | 'wavy'
  | 'clenched';

type CharBodyShape = 'spud' | 'chubby' | 'baby' | 'ghost' | 'rock' | 'droid';

interface CharStyle {
  skin: string;
  shade: string;
  hat: CharHat;
  hatColor: string;
  accent: string;
  accessory: CharAccessory;
  bodyShape: CharBodyShape;
  widthScale: number;
  eyeStyle: CharEye;
  mouth: CharMouth;
}

// Complete handcrafted styles for ALL 60 Base Characters from oracle.json (zero generic duplicates!)
const KNOWN_CHAR_STYLES: Record<string, Partial<CharStyle>> = {
  apprentice: {
    skin: '#e8d7f0', shade: '#bc9fd1', hat: 'wizard', hatColor: '#3b82f6', accent: '#38bdf8',
    accessory: 'rune_sparkle', bodyShape: 'spud', widthScale: 0.94, eyeStyle: 'cute', mouth: 'smile',
  },
  archaeologist: {
    skin: '#dfc296', shade: '#b59262', hat: 'fedora', hatColor: '#92400e', accent: '#f59e0b',
    accessory: 'scar', bodyShape: 'spud', widthScale: 1.0, eyeStyle: 'angry', mouth: 'grin',
  },
  arms_dealer: {
    skin: '#d2c29d', shade: '#9e8d68', hat: 'fedora', hatColor: '#1f2937', accent: '#ef4444',
    accessory: 'scarf', bodyShape: 'spud', widthScale: 1.02, eyeStyle: 'shades', mouth: 'grin',
  },
  arsonist: {
    skin: '#e4b898', shade: '#b57b58', hat: 'flame_crest', hatColor: '#f97316', accent: '#fde047',
    accessory: 'warpaint', bodyShape: 'spud', widthScale: 1.0, eyeStyle: 'glow', mouth: 'open',
  },
  artificer: {
    skin: '#e2c496', shade: '#b6905d', hat: 'goggles', hatColor: '#f97316', accent: '#22d3ee',
    accessory: 'spark_coils', bodyShape: 'spud', widthScale: 1.04, eyeStyle: 'glow', mouth: 'frown',
  },
  baby: {
    skin: '#f6dec4', shade: '#dfb995', hat: 'baby_curl', hatColor: '#60a5fa', accent: '#f472b6',
    accessory: 'blush', bodyShape: 'baby', widthScale: 0.96, eyeStyle: 'cute', mouth: 'pacifier',
  },
  beast_master: {
    skin: '#d9a579', shade: '#a87148', hat: 'wolf_hood', hatColor: '#64748b', accent: '#fbbf24',
    accessory: 'warpaint', bodyShape: 'spud', widthScale: 1.05, eyeStyle: 'slit', mouth: 'fangs',
  },
  brawler: {
    skin: '#e5be91', shade: '#be8f5d', hat: 'headband', hatColor: '#e63946', accent: '#ffffff',
    accessory: 'bandaid', bodyShape: 'spud', widthScale: 1.06, eyeStyle: 'angry', mouth: 'grin',
  },
  bull: {
    skin: '#c48f65', shade: '#8d5b36', hat: 'horns', hatColor: '#f5efe6', accent: '#ff3b3b',
    accessory: 'nose_ring', bodyShape: 'chubby', widthScale: 1.15, eyeStyle: 'angry', mouth: 'frown',
  },
  caveman: {
    skin: '#d8ab7c', shade: '#a4774c', hat: 'bone_hair', hatColor: '#4a2e1b', accent: '#fef3c7',
    accessory: 'warpaint', bodyShape: 'chubby', widthScale: 1.08, eyeStyle: 'angry', mouth: 'beard',
  },
  chunky: {
    skin: '#e6c29a', shade: '#bf9368', hat: 'viking', hatColor: '#8d99ae', accent: '#ffd166',
    accessory: 'blush', bodyShape: 'chubby', widthScale: 1.22, eyeStyle: 'happy', mouth: 'grin',
  },
  crazy: {
    skin: '#ecd5ad', shade: '#c4a678', hat: 'spiky', hatColor: '#ff7b29', accent: '#ffe552',
    accessory: 'none', bodyShape: 'spud', widthScale: 0.98, eyeStyle: 'crazy', mouth: 'open',
  },
  cryptid: {
    skin: '#72b896', shade: '#458366', hat: 'antlers', hatColor: '#5c4033', accent: '#bef264',
    accessory: 'none', bodyShape: 'spud', widthScale: 1.04, eyeStyle: 'glow', mouth: 'wavy',
  },
  cyborg: {
    skin: '#cbd5e1', shade: '#8a99ad', hat: 'visor', hatColor: '#06b6d4', accent: '#ef4444',
    accessory: 'spark_coils', bodyShape: 'spud', widthScale: 1.02, eyeStyle: 'shades', mouth: 'grille',
  },
  demon: {
    skin: '#d94848', shade: '#9e2626', hat: 'horns', hatColor: '#2b1b22', accent: '#ffbe0b',
    accessory: 'none', bodyShape: 'spud', widthScale: 1.03, eyeStyle: 'glow', mouth: 'fangs',
  },
  doctor: {
    skin: '#f0dec2', shade: '#c9b18e', hat: 'nurse', hatColor: '#ffffff', accent: '#ef4444',
    accessory: 'spectacles', bodyShape: 'spud', widthScale: 1.0, eyeStyle: 'cute', mouth: 'smile',
  },
  droid: {
    skin: '#94c5cc', shade: '#5e8f99', hat: 'antenna', hatColor: '#38bdf8', accent: '#fde047',
    accessory: 'none', bodyShape: 'droid', widthScale: 1.04, eyeStyle: 'pixel', mouth: 'grille',
  },
  engineer: {
    skin: '#e7cb9d', shade: '#bd9b68', hat: 'goggles', hatColor: '#f59e0b', accent: '#38bdf8',
    accessory: 'none', bodyShape: 'spud', widthScale: 1.03, eyeStyle: 'cute', mouth: 'mustache',
  },
  entrepreneur: {
    skin: '#f1d9ad', shade: '#c9aa76', hat: 'tophat', hatColor: '#1e1b2e', accent: '#facc15',
    accessory: 'monocle', bodyShape: 'spud', widthScale: 1.02, eyeStyle: 'cute', mouth: 'mustache',
  },
  explorer: {
    skin: '#e3c391', shade: '#b5925d', hat: 'safari', hatColor: '#c2a15f', accent: '#22c55e',
    accessory: 'scarf', bodyShape: 'spud', widthScale: 0.98, eyeStyle: 'cute', mouth: 'smile',
  },
  farmer: {
    skin: '#e8cc9c', shade: '#be9d6b', hat: 'straw', hatColor: '#eab308', accent: '#ef4444',
    accessory: 'freckles', bodyShape: 'spud', widthScale: 1.02, eyeStyle: 'happy', mouth: 'wheat',
  },
  fisherman: {
    skin: '#dfb98e', shade: '#b2885c', hat: 'rainhat', hatColor: '#facc15', accent: '#0284c7',
    accessory: 'none', bodyShape: 'spud', widthScale: 1.04, eyeStyle: 'angry', mouth: 'beard',
  },
  generalist: {
    skin: '#ead0a3', shade: '#c2a270', hat: 'beret', hatColor: '#2563eb', accent: '#facc15',
    accessory: 'star_lapel', bodyShape: 'spud', widthScale: 1.0, eyeStyle: 'cute', mouth: 'smile',
  },
  ghost: {
    skin: '#d8f3ff', shade: '#90d5f5', hat: 'none', hatColor: '#ffffff', accent: '#38bdf8',
    accessory: 'none', bodyShape: 'ghost', widthScale: 0.96, eyeStyle: 'glow', mouth: 'open',
  },
  gladiator: {
    skin: '#d8a675', shade: '#a67447', hat: 'helmet', hatColor: '#d97706', accent: '#dc2626',
    accessory: 'scar', bodyShape: 'spud', widthScale: 1.08, eyeStyle: 'angry', mouth: 'clenched',
  },
  glutton: {
    skin: '#f2c8a2', shade: '#cb996e', hat: 'chef', hatColor: '#f8fafc', accent: '#f43f5e',
    accessory: 'blush', bodyShape: 'chubby', widthScale: 1.2, eyeStyle: 'happy', mouth: 'open',
  },
  golem: {
    skin: '#8d96a5', shade: '#5c6473', hat: 'crystal_brow', hatColor: '#f97316', accent: '#fb923c',
    accessory: 'none', bodyShape: 'rock', widthScale: 1.16, eyeStyle: 'glow', mouth: 'clenched',
  },
  hunter: {
    skin: '#d9bd92', shade: '#aa8b61', hat: 'hood', hatColor: '#3f6212', accent: '#ef4444',
    accessory: 'monocle', bodyShape: 'spud', widthScale: 0.98, eyeStyle: 'slit', mouth: 'frown',
  },
  jack: {
    skin: '#f3b763', shade: '#c98532', hat: 'jester', hatColor: '#7c3aed', accent: '#facc15',
    accessory: 'none', bodyShape: 'spud', widthScale: 0.98, eyeStyle: 'slit', mouth: 'dead',
  },
  king: {
    skin: '#efd5a7', shade: '#c7a470', hat: 'crown', hatColor: '#facc15', accent: '#ef4444',
    accessory: 'none', bodyShape: 'chubby', widthScale: 1.08, eyeStyle: 'angry', mouth: 'beard',
  },
  knight: {
    skin: '#cfd8e3', shade: '#94a3b8', hat: 'helmet', hatColor: '#94a3b8', accent: '#ef4444',
    accessory: 'none', bodyShape: 'spud', widthScale: 1.05, eyeStyle: 'slit', mouth: 'grille',
  },
  lich: {
    skin: '#c7c2d6', shade: '#8b83a3', hat: 'crown', hatColor: '#7e22ce', accent: '#22d3ee',
    accessory: 'rune_sparkle', bodyShape: 'spud', widthScale: 0.96, eyeStyle: 'glow', mouth: 'dead',
  },
  loud: {
    skin: '#f0b88f', shade: '#c7875c', hat: 'mohawk', hatColor: '#ec4899', accent: '#fde047',
    accessory: 'none', bodyShape: 'spud', widthScale: 1.02, eyeStyle: 'crazy', mouth: 'open',
  },
  lucky: {
    skin: '#d8f0b8', shade: '#9ec76b', hat: 'clover_hat', hatColor: '#16a34a', accent: '#facc15',
    accessory: 'freckles', bodyShape: 'spud', widthScale: 1.0, eyeStyle: 'happy', mouth: 'grin',
  },
  mad_scientist: {
    skin: '#e5ecd8', shade: '#b7c4a5', hat: 'mad_hair', hatColor: '#f1f5f9', accent: '#4ade80',
    accessory: 'spectacles', bodyShape: 'spud', widthScale: 0.98, eyeStyle: 'crazy', mouth: 'grin',
  },
  mage: {
    skin: '#dfd0ef', shade: '#b39ed0', hat: 'wizard', hatColor: '#6c3ce9', accent: '#ffe552',
    accessory: 'none', bodyShape: 'spud', widthScale: 1.0, eyeStyle: 'glow', mouth: 'beard',
  },
  masochist: {
    skin: '#dea19e', shade: '#ae6c69', hat: 'cage_band', hatColor: '#475569', accent: '#ef4444',
    accessory: 'bandaid', bodyShape: 'spud', widthScale: 1.04, eyeStyle: 'crazy', mouth: 'clenched',
  },
  multitasker: {
    skin: '#e8d4b0', shade: '#bda175', hat: 'halo', hatColor: '#ffd166', accent: '#5abeff',
    accessory: 'orbit_beads', bodyShape: 'spud', widthScale: 1.0, eyeStyle: 'glow', mouth: 'smile',
  },
  mutant: {
    skin: '#9ee37d', shade: '#68b048', hat: 'spiky', hatColor: '#a855f7', accent: '#bef264',
    accessory: 'third_eye', bodyShape: 'spud', widthScale: 1.04, eyeStyle: 'crazy', mouth: 'open',
  },
  old: {
    skin: '#e5d4be', shade: '#baa58b', hat: 'beanie', hatColor: '#64748b', accent: '#cbd5e1',
    accessory: 'spectacles', bodyShape: 'spud', widthScale: 0.96, eyeStyle: 'tired', mouth: 'beard',
  },
  one_arm: {
    skin: '#deb78a', shade: '#b08458', hat: 'headband', hatColor: '#b91c1c', accent: '#f59e0b',
    accessory: 'eyepatch', bodyShape: 'spud', widthScale: 1.0, eyeStyle: 'angry', mouth: 'frown',
  },
  pacifist: {
    skin: '#e7ecd6', shade: '#bcc4a6', hat: 'flowers', hatColor: '#f472b6', accent: '#fde047',
    accessory: 'blush', bodyShape: 'spud', widthScale: 1.0, eyeStyle: 'happy', mouth: 'smile',
  },
  poacher: {
    skin: '#cfb089', shade: '#9e7e58', hat: 'slouch', hatColor: '#65a30d', accent: '#fde68a',
    accessory: 'scar', bodyShape: 'spud', widthScale: 1.0, eyeStyle: 'slit', mouth: 'mustache',
  },
  ranger: {
    skin: '#e2cc9f', shade: '#b99d6e', hat: 'hood', hatColor: '#2d8a4e', accent: '#f4d35e',
    accessory: 'none', bodyShape: 'spud', widthScale: 0.98, eyeStyle: 'angry', mouth: 'smile',
  },
  renegade: {
    skin: '#d9c0cf', shade: '#a7899b', hat: 'cowboy', hatColor: '#4c1d95', accent: '#f43f5e',
    accessory: 'none', bodyShape: 'spud', widthScale: 1.0, eyeStyle: 'glow', mouth: 'bandana',
  },
  saver: {
    skin: '#f0da8a', shade: '#c5a94c', hat: 'visor', hatColor: '#15803d', accent: '#facc15',
    accessory: 'monocle', bodyShape: 'spud', widthScale: 1.0, eyeStyle: 'cute', mouth: 'grin',
  },
  sick: {
    skin: '#cde39e', shade: '#9bb568', hat: 'icepack', hatColor: '#38bdf8', accent: '#ef4444',
    accessory: 'thermometer', bodyShape: 'spud', widthScale: 0.96, eyeStyle: 'tired', mouth: 'wavy',
  },
  soldier: {
    skin: '#dec59c', shade: '#b5966a', hat: 'helmet', hatColor: '#4d7c0f', accent: '#facc15',
    accessory: 'warpaint', bodyShape: 'spud', widthScale: 1.04, eyeStyle: 'angry', mouth: 'frown',
  },
  speedy: {
    skin: '#f1d6a7', shade: '#c8a36c', hat: 'goggles', hatColor: '#00b4d8', accent: '#ffe552',
    accessory: 'ear_wings', bodyShape: 'spud', widthScale: 0.94, eyeStyle: 'shades', mouth: 'grin',
  },
  streamer: {
    skin: '#f2dec3', shade: '#c8ae8e', hat: 'headset', hatColor: '#a855f7', accent: '#22d3ee',
    accessory: 'blush', bodyShape: 'spud', widthScale: 1.0, eyeStyle: 'cute', mouth: 'open',
  },
  survivor: {
    skin: '#d6b68d', shade: '#a6855c', hat: 'beanie', hatColor: '#9a3412', accent: '#facc15',
    accessory: 'headlamp', bodyShape: 'spud', widthScale: 1.02, eyeStyle: 'angry', mouth: 'frown',
  },
  technomage: {
    skin: '#c9d1f0', shade: '#8e9ac7', hat: 'cyber_wiz', hatColor: '#312e81', accent: '#22d3ee',
    accessory: 'rune_sparkle', bodyShape: 'spud', widthScale: 1.0, eyeStyle: 'glow', mouth: 'beard',
  },
  time_shifter: {
    skin: '#c4def5', shade: '#86b0d6', hat: 'clock_halo', hatColor: '#facc15', accent: '#38bdf8',
    accessory: 'orbit_beads', bodyShape: 'spud', widthScale: 0.98, eyeStyle: 'glow', mouth: 'smile',
  },
  vagabond: {
    skin: '#dec096', shade: '#b08e60', hat: 'turban', hatColor: '#b45309', accent: '#38bdf8',
    accessory: 'scarf', bodyShape: 'spud', widthScale: 1.0, eyeStyle: 'angry', mouth: 'bandana',
  },
  vampire: {
    skin: '#eceaf2', shade: '#c1bdd1', hat: 'vamp_hair', hatColor: '#1e1b2e', accent: '#e11d48',
    accessory: 'collar_vamp', bodyShape: 'spud', widthScale: 0.98, eyeStyle: 'glow', mouth: 'fangs',
  },
  variant: {
    skin: '#d9b8f2', shade: '#a47dc7', hat: 'prism_crest', hatColor: '#ec4899', accent: '#22d3ee',
    accessory: 'none', bodyShape: 'spud', widthScale: 1.0, eyeStyle: 'hetero', mouth: 'grin',
  },
  veteran: {
    skin: '#d8b288', shade: '#a88157', hat: 'beret', hatColor: '#1e3a5f', accent: '#facc15',
    accessory: 'eyepatch', bodyShape: 'spud', widthScale: 1.04, eyeStyle: 'angry', mouth: 'mustache',
  },
  well_rounded: {
    skin: '#ebd1a7', shade: '#caa472', hat: 'none', hatColor: '#ff5252', accent: '#ff5252',
    accessory: 'blush', bodyShape: 'spud', widthScale: 1.0, eyeStyle: 'cute', mouth: 'smile',
  },
  wildling: {
    skin: '#d49f6a', shade: '#a16e3d', hat: 'leaf_crown', hatColor: '#16a34a', accent: '#fef08a',
    accessory: 'warpaint', bodyShape: 'spud', widthScale: 1.04, eyeStyle: 'angry', mouth: 'fangs',
  },
  wounded: {
    skin: '#e8d4c8', shade: '#c2a697', hat: 'bandage', hatColor: '#f8fafc', accent: '#ef4444',
    accessory: 'bandage_cheek', bodyShape: 'spud', widthScale: 0.98, eyeStyle: 'tired', mouth: 'clenched',
  },
};

function resolveCharStyle(charKey: string): CharStyle {
  const normalized = charKey === 'one_armed' ? 'one_arm' : charKey;
  const preset = KNOWN_CHAR_STYLES[normalized];
  const h = hashStr(normalized);
  const hats: CharHat[] = ['headband', 'hood', 'wizard', 'viking', 'goggles', 'crown', 'helmet', 'horns', 'beanie', 'cap', 'spiky', 'straw', 'visor'];
  const eyes: CharEye[] = ['cute', 'angry', 'crazy', 'glow', 'shades'];
  const mouths: CharMouth[] = ['smile', 'grin', 'frown', 'mustache', 'beard'];
  const hue = h % 360;

  return {
    skin: preset?.skin ?? hsl(32 + (h % 24) - 12, 52, 78),
    shade: preset?.shade ?? hsl(32 + (h % 24) - 12, 46, 62),
    hat: preset?.hat ?? hats[h % hats.length],
    hatColor: preset?.hatColor ?? hsl(hue, 72, 48),
    accent: preset?.accent ?? hsl((hue + 140) % 360, 88, 60),
    accessory: preset?.accessory ?? 'none',
    bodyShape: preset?.bodyShape ?? 'spud',
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

  const rx = 18 * style.widthScale;
  const ry = style.bodyShape === 'baby' ? 18 : 21;
  const bodyY = c + (style.bodyShape === 'baby' ? 6 : 4);

  // Back accessories behind body (vampire high collar, racing wings, spark coils, floating orbit beads)
  if (!isBase) {
    ctx.lineWidth = 2.6;
    ctx.strokeStyle = INK;
    if (style.accessory === 'collar_vamp') {
      ctx.fillStyle = '#1e1b2e';
      ctx.beginPath();
      ctx.moveTo(c - rx - 4, bodyY - 8);
      ctx.lineTo(c - rx + 4, bodyY + 14);
      ctx.lineTo(c + rx - 4, bodyY + 14);
      ctx.lineTo(c + rx + 4, bodyY - 8);
      ctx.lineTo(c + rx - 6, bodyY + 2);
      ctx.lineTo(c - rx + 6, bodyY + 2);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = style.accent;
      ctx.beginPath();
      ctx.moveTo(c - rx - 1, bodyY - 5);
      ctx.lineTo(c, bodyY + 5);
      ctx.lineTo(c + rx + 1, bodyY - 5);
      ctx.closePath();
      ctx.fill();
    } else if (style.accessory === 'ear_wings') {
      ctx.fillStyle = style.accent;
      for (const dir of [-1, 1]) {
        ctx.beginPath();
        ctx.moveTo(c + dir * (rx - 2), bodyY - 3);
        ctx.lineTo(c + dir * (rx + 10), bodyY - 12);
        ctx.lineTo(c + dir * (rx + 7), bodyY - 2);
        ctx.lineTo(c + dir * (rx + 10), bodyY + 3);
        ctx.lineTo(c + dir * (rx - 2), bodyY + 4);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
      }
    } else if (style.accessory === 'spark_coils') {
      for (const dir of [-1, 1]) {
        roundRectPath(ctx, c + dir * (rx + 1) - 3, bodyY - 6, 6, 12, 2);
        ctx.fillStyle = '#64748b';
        ctx.fill();
        ctx.stroke();
        fillStrokeCircle(ctx, c + dir * (rx + 3), bodyY - 7, 3, style.accent, 1.8);
      }
    }
  }

  // Stubby feet (except floating ghost!)
  if (style.bodyShape !== 'ghost') {
    const footY = size * 0.84;
    const footR = style.bodyShape === 'baby' ? 4.5 : 5.5;
    fillStrokeCircle(ctx, c - 9 * style.widthScale, footY, footR, style.shade, 2.8);
    fillStrokeCircle(ctx, c + 9 * style.widthScale, footY, footR, style.shade, 2.8);
  }

  // Expressive body silhouette
  ctx.save();
  ctx.beginPath();
  if (style.bodyShape === 'ghost') {
    ctx.arc(c, bodyY - 2, rx, Math.PI, Math.PI * 2);
    ctx.lineTo(c + rx, bodyY + ry - 2);
    ctx.quadraticCurveTo(c + rx * 0.6, bodyY + ry + 5, c + rx * 0.3, bodyY + ry - 2);
    ctx.quadraticCurveTo(c, bodyY + ry + 5, c - rx * 0.3, bodyY + ry - 2);
    ctx.quadraticCurveTo(c - rx * 0.6, bodyY + ry + 5, c - rx, bodyY + ry - 2);
    ctx.closePath();
  } else if (style.bodyShape === 'droid') {
    roundRectPath(ctx, c - rx, bodyY - ry + 2, rx * 2, ry * 2 - 4, 11);
  } else if (style.bodyShape === 'rock') {
    ctx.moveTo(c - rx * 0.72, bodyY - ry);
    ctx.lineTo(c + rx * 0.68, bodyY - ry);
    ctx.lineTo(c + rx, bodyY - ry * 0.2);
    ctx.lineTo(c + rx * 0.92, bodyY + ry * 0.78);
    ctx.lineTo(c + rx * 0.35, bodyY + ry);
    ctx.lineTo(c - rx * 0.45, bodyY + ry);
    ctx.lineTo(c - rx * 0.95, bodyY + ry * 0.72);
    ctx.lineTo(c - rx, bodyY - ry * 0.25);
    ctx.closePath();
  } else {
    ctx.ellipse(c, bodyY, rx, ry, 0, 0, Math.PI * 2);
  }
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

  // Subtle stone cracks on Golem body
  if (style.bodyShape === 'rock') {
    ctx.globalAlpha = 0.65;
    ctx.strokeStyle = INK;
    ctx.lineWidth = 1.8;
    ctx.beginPath();
    ctx.moveTo(c - rx + 2, bodyY + 5);
    ctx.lineTo(c - 7, bodyY + 8);
    ctx.lineTo(c - 4, bodyY + 14);
    ctx.moveTo(c + rx - 2, bodyY - 8);
    ctx.lineTo(c + 9, bodyY - 5);
    ctx.stroke();
  }
  ctx.restore();

  // Bold outer ink
  ctx.lineWidth = 3.4;
  ctx.strokeStyle = INK;
  ctx.stroke();
  ctx.restore();

  // Cheek / Face accessories beneath eyes
  const eyeY = bodyY - 2;
  const eyeSpread = 7.2 * style.widthScale;
  if (!isBase) {
    if (style.accessory === 'blush') {
      ctx.fillStyle = 'rgba(255, 110, 140, 0.52)';
      ctx.beginPath();
      ctx.ellipse(c - eyeSpread - 3.5, eyeY + 5.5, 4, 2.3, 0, 0, Math.PI * 2);
      ctx.ellipse(c + eyeSpread + 3.5, eyeY + 5.5, 4, 2.3, 0, 0, Math.PI * 2);
      ctx.fill();
    } else if (style.accessory === 'freckles') {
      ctx.fillStyle = '#92400e';
      for (const fx of [-eyeSpread - 3, -eyeSpread, eyeSpread, eyeSpread + 3]) {
        ctx.fillRect(c + fx, eyeY + 4.5, 1.8, 1.8);
      }
    } else if (style.accessory === 'warpaint') {
      ctx.strokeStyle = style.accent;
      ctx.lineWidth = 2.2;
      for (const dir of [-1, 1]) {
        ctx.beginPath();
        ctx.moveTo(c + dir * (eyeSpread - 1), eyeY + 4.5);
        ctx.lineTo(c + dir * (eyeSpread + 5), eyeY + 6.5);
        ctx.stroke();
      }
    } else if (style.accessory === 'bandaid' || style.accessory === 'bandage_cheek') {
      ctx.save();
      ctx.translate(c + eyeSpread + 1, eyeY + 6);
      ctx.rotate(-0.3);
      roundRectPath(ctx, -5, -2.5, 10, 5, 1.5);
      ctx.fillStyle = '#fef3c7';
      ctx.fill();
      ctx.lineWidth = 1.6;
      ctx.strokeStyle = INK;
      ctx.stroke();
      ctx.restore();
    } else if (style.accessory === 'scar') {
      ctx.strokeStyle = '#991b1b';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(c + eyeSpread - 2, eyeY - 6);
      ctx.lineTo(c + eyeSpread + 3, eyeY + 6);
      ctx.stroke();
    } else if (style.accessory === 'scarf') {
      roundRectPath(ctx, c - rx * 0.78, bodyY + 11, rx * 1.56, 6.5, 3);
      ctx.fillStyle = style.accent;
      ctx.fill();
      ctx.lineWidth = 2.2;
      ctx.strokeStyle = INK;
      ctx.stroke();
    } else if (style.accessory === 'star_lapel') {
      drawStarPolygon(ctx, c + 9, bodyY + 13, 5, 4.5, 2);
      ctx.fillStyle = style.accent;
      ctx.fill();
      ctx.lineWidth = 1.6;
      ctx.strokeStyle = INK;
      ctx.stroke();
    }
  }

  // Eyes
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
  } else if (style.eyeStyle === 'hetero') {
    fillStrokeCircle(ctx, c - eyeSpread, eyeY, 4.4, '#22d3ee', 2.2);
    fillStrokeCircle(ctx, c + eyeSpread, eyeY, 4.4, '#facc15', 2.2);
    fillStrokeCircle(ctx, c - eyeSpread, eyeY, 1.6, INK, 0);
    fillStrokeCircle(ctx, c + eyeSpread, eyeY, 1.6, INK, 0);
  } else if (style.eyeStyle === 'crazy') {
    fillStrokeCircle(ctx, c - eyeSpread, eyeY, 5.2, '#ffffff', 2.2);
    fillStrokeCircle(ctx, c + eyeSpread, eyeY - 1, 3.8, '#ffffff', 2.2);
    fillStrokeCircle(ctx, c - eyeSpread + 1, eyeY + 1, 2.2, INK, 0);
    fillStrokeCircle(ctx, c + eyeSpread - 1, eyeY - 1.5, 1.8, INK, 0);
  } else if (style.eyeStyle === 'happy') {
    ctx.strokeStyle = INK;
    ctx.lineWidth = 2.8;
    ctx.beginPath();
    ctx.arc(c - eyeSpread, eyeY + 1, 3.8, Math.PI + 0.3, Math.PI * 2 - 0.3);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(c + eyeSpread, eyeY + 1, 3.8, Math.PI + 0.3, Math.PI * 2 - 0.3);
    ctx.stroke();
  } else if (style.eyeStyle === 'tired') {
    fillStrokeCircle(ctx, c - eyeSpread, eyeY + 1, 3.5, '#ffffff', 2);
    fillStrokeCircle(ctx, c + eyeSpread, eyeY + 1, 3.5, '#ffffff', 2);
    fillStrokeCircle(ctx, c - eyeSpread, eyeY + 1.5, 1.6, INK, 0);
    fillStrokeCircle(ctx, c + eyeSpread, eyeY + 1.5, 1.6, INK, 0);
    ctx.strokeStyle = INK;
    ctx.lineWidth = 2.4;
    ctx.beginPath();
    ctx.moveTo(c - eyeSpread - 4, eyeY - 2);
    ctx.lineTo(c - eyeSpread + 4, eyeY - 1);
    ctx.moveTo(c + eyeSpread - 4, eyeY - 1);
    ctx.lineTo(c + eyeSpread + 4, eyeY - 2);
    ctx.stroke();
  } else if (style.eyeStyle === 'pixel') {
    ctx.fillStyle = INK;
    ctx.fillRect(c - eyeSpread - 4, eyeY - 4, 8, 8);
    ctx.fillRect(c + eyeSpread - 4, eyeY - 4, 8, 8);
    ctx.fillStyle = style.accent;
    ctx.fillRect(c - eyeSpread - 2, eyeY - 2, 4, 4);
    ctx.fillRect(c + eyeSpread - 2, eyeY - 2, 4, 4);
  } else if (style.eyeStyle === 'slit') {
    ctx.fillStyle = style.accent;
    ctx.strokeStyle = INK;
    ctx.lineWidth = 2.2;
    ctx.beginPath();
    ctx.moveTo(c - eyeSpread - 4.5, eyeY - 2.5);
    ctx.lineTo(c - eyeSpread + 4, eyeY);
    ctx.lineTo(c - eyeSpread - 3.5, eyeY + 3);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(c + eyeSpread + 4.5, eyeY - 2.5);
    ctx.lineTo(c + eyeSpread - 4, eyeY);
    ctx.lineTo(c + eyeSpread + 3.5, eyeY + 3);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
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

  // Eye-over accessories (eyepatch, monocle, spectacles, third eye)
  if (!isBase) {
    if (style.accessory === 'eyepatch') {
      ctx.strokeStyle = INK;
      ctx.lineWidth = 2.4;
      ctx.beginPath();
      ctx.moveTo(c - rx + 2, eyeY - 7);
      ctx.lineTo(c + rx - 2, eyeY + 2);
      ctx.stroke();
      fillStrokeCircle(ctx, c - eyeSpread, eyeY, 5.2, '#1e1b2e', 2.2);
    } else if (style.accessory === 'monocle') {
      ctx.strokeStyle = '#facc15';
      ctx.lineWidth = 2.2;
      ctx.beginPath();
      ctx.arc(c + eyeSpread, eyeY, 6, 0, Math.PI * 2);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(c + eyeSpread + 6, eyeY + 2);
      ctx.lineTo(c + eyeSpread + 7, eyeY + 12);
      ctx.stroke();
    } else if (style.accessory === 'spectacles') {
      ctx.strokeStyle = INK;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(c - eyeSpread, eyeY, 5.6, 0, Math.PI * 2);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(c + eyeSpread, eyeY, 5.6, 0, Math.PI * 2);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(c - eyeSpread + 5.6, eyeY);
      ctx.lineTo(c + eyeSpread - 5.6, eyeY);
      ctx.stroke();
    } else if (style.accessory === 'third_eye') {
      fillStrokeCircle(ctx, c, eyeY - 7.5, 4, '#bef264', 2);
      fillStrokeCircle(ctx, c, eyeY - 7.5, 1.5, INK, 0);
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
    ctx.fillStyle = charKey === 'caveman' || charKey === 'fisherman' ? '#7c4a26' : '#f1f5f9';
    ctx.fill();
    ctx.stroke();
  } else if (style.mouth === 'mustache') {
    ctx.beginPath();
    ctx.moveTo(c - 9, mY + 1);
    ctx.quadraticCurveTo(c - 4, mY - 4, c, mY);
    ctx.quadraticCurveTo(c + 4, mY - 4, c + 9, mY + 1);
    ctx.lineWidth = 3.2;
    ctx.strokeStyle = charKey === 'veteran' ? '#cbd5e1' : '#4b3621';
    ctx.stroke();
  } else if (style.mouth === 'grin') {
    ctx.beginPath();
    ctx.arc(c, mY - 2, 6, 0.15, Math.PI - 0.15);
    ctx.closePath();
    ctx.fillStyle = '#ffffff';
    ctx.fill();
    ctx.stroke();
  } else if (style.mouth === 'fangs') {
    ctx.beginPath();
    ctx.moveTo(c - 7, mY - 1);
    ctx.lineTo(c + 7, mY - 1);
    ctx.stroke();
    ctx.fillStyle = '#ffffff';
    for (const dir of [-1, 1]) {
      ctx.beginPath();
      ctx.moveTo(c + dir * 2.5, mY - 1);
      ctx.lineTo(c + dir * 4.5, mY + 4.5);
      ctx.lineTo(c + dir * 6.5, mY - 1);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    }
  } else if (style.mouth === 'open') {
    fillStrokeCircle(ctx, c, mY + 1, 4.2, '#7f1d1d', 2.2);
  } else if (style.mouth === 'pacifier') {
    fillStrokeCircle(ctx, c, mY + 1, 5.2, '#60a5fa', 2.2);
    fillStrokeCircle(ctx, c, mY + 2, 2.6, '#fde047', 1.6);
  } else if (style.mouth === 'bandana') {
    ctx.beginPath();
    ctx.moveTo(c - rx + 2, mY - 4);
    ctx.lineTo(c + rx - 2, mY - 4);
    ctx.lineTo(c, mY + 12);
    ctx.closePath();
    ctx.fillStyle = style.accent;
    ctx.fill();
    ctx.stroke();
  } else if (style.mouth === 'wheat') {
    ctx.beginPath();
    ctx.arc(c, mY - 2, 5, 0.2, Math.PI - 0.2);
    ctx.stroke();
    ctx.strokeStyle = '#facc15';
    ctx.lineWidth = 2.4;
    ctx.beginPath();
    ctx.moveTo(c + 3, mY + 1);
    ctx.lineTo(c + 13, mY + 5);
    ctx.stroke();
  } else if (style.mouth === 'grille') {
    roundRectPath(ctx, c - 8, mY - 2, 16, 6, 2);
    ctx.fillStyle = '#334155';
    ctx.fill();
    ctx.stroke();
    ctx.strokeStyle = style.accent;
    ctx.lineWidth = 1.6;
    for (let gx = -4; gx <= 4; gx += 4) {
      ctx.beginPath();
      ctx.moveTo(c + gx, mY - 1);
      ctx.lineTo(c + gx, mY + 3);
      ctx.stroke();
    }
  } else if (style.mouth === 'wavy') {
    ctx.beginPath();
    ctx.moveTo(c - 7, mY + 1);
    ctx.quadraticCurveTo(c - 3.5, mY - 3, c, mY + 1);
    ctx.quadraticCurveTo(c + 3.5, mY + 5, c + 7, mY + 1);
    ctx.stroke();
  } else if (style.mouth === 'clenched') {
    roundRectPath(ctx, c - 7, mY - 2, 14, 5.5, 2);
    ctx.fillStyle = '#ffffff';
    ctx.fill();
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(c - 2, mY - 2);
    ctx.lineTo(c - 2, mY + 3.5);
    ctx.moveTo(c + 2, mY - 2);
    ctx.lineTo(c + 2, mY + 3.5);
    ctx.stroke();
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

  // Mouth/nose-over accessories
  if (!isBase) {
    if (style.accessory === 'nose_ring') {
      ctx.strokeStyle = '#facc15';
      ctx.lineWidth = 2.4;
      ctx.beginPath();
      ctx.arc(c, bodyY + 3.5, 3.6, 0, Math.PI * 1.65);
      ctx.stroke();
    } else if (style.accessory === 'thermometer') {
      ctx.strokeStyle = '#f8fafc';
      ctx.lineWidth = 3.5;
      ctx.beginPath();
      ctx.moveTo(c + 4, mY + 1);
      ctx.lineTo(c + 15, mY - 5);
      ctx.stroke();
      fillStrokeCircle(ctx, c + 15, mY - 5, 2.8, '#ef4444', 1.4);
    }
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
      ctx.beginPath();
      ctx.moveTo(c + rx - 2, topY + 9);
      ctx.lineTo(c + rx + 8, topY + 5);
      ctx.lineTo(c + rx + 6, topY + 12);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      break;
    }
    case 'wizard':
    case 'cyber_wiz': {
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
      if (style.hat === 'cyber_wiz') {
        ctx.strokeStyle = style.accent;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(c - 12, topY + 4);
        ctx.lineTo(c + 12, topY + 4);
        ctx.moveTo(c, topY - 11);
        ctx.lineTo(c, topY + 2);
        ctx.stroke();
      } else {
        drawStarPolygon(ctx, c, topY - 3, 5, 4.5, 2);
        ctx.fillStyle = style.accent;
        ctx.fill();
      }
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
      ctx.fillStyle = style.accent;
      ctx.beginPath();
      ctx.ellipse(c + 14, topY - 3, 7, 3, -0.6, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      break;
    }
    case 'wolf_hood': {
      ctx.fillStyle = style.hatColor;
      ctx.beginPath();
      ctx.arc(c, topY + 10, rx + 3, Math.PI, Math.PI * 2);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      for (const dir of [-1, 1]) {
        ctx.beginPath();
        ctx.moveTo(c + dir * 7, topY + 2);
        ctx.lineTo(c + dir * 15, topY - 11);
        ctx.lineTo(c + dir * 16, topY + 5);
        ctx.closePath();
        ctx.fillStyle = style.hatColor;
        ctx.fill();
        ctx.stroke();
      }
      fillStrokeCircle(ctx, c - 6, topY + 4, 2, style.accent, 0);
      fillStrokeCircle(ctx, c + 6, topY + 4, 2, style.accent, 0);
      break;
    }
    case 'viking': {
      ctx.fillStyle = style.hatColor;
      ctx.beginPath();
      ctx.arc(c, topY + 9, rx, Math.PI, Math.PI * 2);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
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
        ctx.lineTo(c + dir * 18, topY - 11);
        ctx.lineTo(c + dir * 13, topY + 7);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
      }
      break;
    }
    case 'antlers': {
      ctx.strokeStyle = style.hatColor;
      ctx.lineWidth = 4;
      for (const dir of [-1, 1]) {
        ctx.beginPath();
        ctx.moveTo(c + dir * 7, topY + 4);
        ctx.lineTo(c + dir * 15, topY - 10);
        ctx.moveTo(c + dir * 11, topY - 3);
        ctx.lineTo(c + dir * 19, topY - 4);
        ctx.stroke();
        fillStrokeCircle(ctx, c + dir * 15, topY - 10, 2.6, style.accent, 1.4);
      }
      break;
    }
    case 'halo':
    case 'clock_halo': {
      ctx.strokeStyle = INK;
      ctx.lineWidth = 5.5;
      ctx.beginPath();
      ctx.ellipse(c, topY - 5, 14, 4.2, 0, 0, Math.PI * 2);
      ctx.stroke();
      ctx.strokeStyle = style.hatColor;
      ctx.lineWidth = 2.8;
      ctx.stroke();
      if (style.hat === 'clock_halo') {
        fillStrokeCircle(ctx, c, topY - 5, 4.5, style.accent, 1.8);
      }
      break;
    }
    case 'spiky':
    case 'flame_crest':
    case 'prism_crest': {
      ctx.fillStyle = style.hatColor;
      ctx.beginPath();
      ctx.moveTo(c - 14, topY + 7);
      ctx.lineTo(c - 17, topY - 7);
      ctx.lineTo(c - 7, topY - 1);
      ctx.lineTo(c, topY - 14);
      ctx.lineTo(c + 7, topY - 1);
      ctx.lineTo(c + 17, topY - 7);
      ctx.lineTo(c + 14, topY + 7);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      if (style.hat !== 'spiky') {
        fillStrokeCircle(ctx, c, topY - 2, 3.5, style.accent, 1.4);
      }
      break;
    }
    case 'mohawk': {
      ctx.fillStyle = style.hatColor;
      ctx.beginPath();
      ctx.moveTo(c - 6, topY + 6);
      ctx.lineTo(c - 8, topY - 12);
      ctx.lineTo(c, topY - 7);
      ctx.lineTo(c + 5, topY - 15);
      ctx.lineTo(c + 8, topY + 6);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      break;
    }
    case 'mad_hair': {
      ctx.fillStyle = style.hatColor;
      for (const [ox, oy, rad] of [[-14, 0, 6], [-8, -6, 6.5], [0, -8, 7], [9, -6, 6.5], [14, 0, 6]]) {
        fillStrokeCircle(ctx, c + ox, topY + oy + 4, rad, style.hatColor, 2.2);
      }
      break;
    }
    case 'bone_hair': {
      ctx.fillStyle = style.hatColor;
      ctx.beginPath();
      ctx.arc(c, topY + 8, rx * 0.92, Math.PI, Math.PI * 2);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      // Prehistoric bone hair pin
      ctx.strokeStyle = INK;
      ctx.lineWidth = 5;
      ctx.beginPath();
      ctx.moveTo(c - 14, topY - 2);
      ctx.lineTo(c + 14, topY - 5);
      ctx.stroke();
      ctx.strokeStyle = style.accent;
      ctx.lineWidth = 2.6;
      ctx.stroke();
      fillStrokeCircle(ctx, c - 14, topY - 2, 3, style.accent, 1.6);
      fillStrokeCircle(ctx, c + 14, topY - 5, 3, style.accent, 1.6);
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
    case 'straw':
    case 'safari':
    case 'cowboy':
    case 'slouch': {
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
    case 'fedora': {
      ctx.fillStyle = style.hatColor;
      ctx.beginPath();
      ctx.ellipse(c, topY + 5, rx + 7, 4.5, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(c - 13, topY + 4);
      ctx.lineTo(c - 10, topY - 9);
      ctx.lineTo(c, topY - 6);
      ctx.lineTo(c + 10, topY - 9);
      ctx.lineTo(c + 13, topY + 4);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = style.accent;
      ctx.fillRect(c - 12, topY + 1, 24, 3);
      break;
    }
    case 'tophat':
    case 'clover_hat': {
      ctx.fillStyle = style.hatColor;
      ctx.beginPath();
      ctx.ellipse(c, topY + 5, rx + 5, 4, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      roundRectPath(ctx, c - 11, topY - 14, 22, 19, 3);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = style.accent;
      ctx.fillRect(c - 11, topY + 0.5, 22, 3.5);
      if (style.hat === 'clover_hat') {
        fillStrokeCircle(ctx, c + 6, topY - 5, 3, '#4ade80', 1.4);
      }
      break;
    }
    case 'chef': {
      ctx.fillStyle = style.hatColor;
      fillStrokeCircle(ctx, c - 8, topY - 4, 7, style.hatColor, 2.4);
      fillStrokeCircle(ctx, c + 8, topY - 4, 7, style.hatColor, 2.4);
      fillStrokeCircle(ctx, c, topY - 7, 8, style.hatColor, 2.4);
      roundRectPath(ctx, c - 12, topY - 1, 24, 8, 2);
      ctx.fill();
      ctx.stroke();
      break;
    }
    case 'jester': {
      for (const dir of [-1, 1]) {
        ctx.fillStyle = dir < 0 ? style.hatColor : style.accent;
        ctx.beginPath();
        ctx.moveTo(c, topY + 5);
        ctx.quadraticCurveTo(c + dir * 12, topY - 12, c + dir * 19, topY - 3);
        ctx.quadraticCurveTo(c + dir * 10, topY + 1, c + dir * 12, topY + 7);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
        fillStrokeCircle(ctx, c + dir * 19, topY - 3, 2.8, '#fde047', 1.6);
      }
      break;
    }
    case 'beret': {
      ctx.fillStyle = style.hatColor;
      ctx.beginPath();
      ctx.ellipse(c - 2, topY + 2, rx * 0.95, 7, -0.18, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      drawStarPolygon(ctx, c + 5, topY + 2, 5, 3.5, 1.6);
      ctx.fillStyle = style.accent;
      ctx.fill();
      break;
    }
    case 'rainhat': {
      ctx.fillStyle = style.hatColor;
      ctx.beginPath();
      ctx.moveTo(c - rx - 6, topY + 7);
      ctx.quadraticCurveTo(c, topY - 14, c + rx + 6, topY + 7);
      ctx.quadraticCurveTo(c, topY + 11, c - rx - 6, topY + 7);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      break;
    }
    case 'antenna': {
      ctx.strokeStyle = INK;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(c - 6, topY + 3);
      ctx.lineTo(c - 10, topY - 10);
      ctx.moveTo(c + 6, topY + 3);
      ctx.lineTo(c + 10, topY - 10);
      ctx.stroke();
      fillStrokeCircle(ctx, c - 10, topY - 10, 3.2, style.hatColor, 1.8);
      fillStrokeCircle(ctx, c + 10, topY - 10, 3.2, style.accent, 1.8);
      break;
    }
    case 'flowers':
    case 'leaf_crown': {
      for (let i = -2; i <= 2; i++) {
        const fx = c + i * 7;
        const fy = topY + 3 + Math.abs(i) * 1.2;
        fillStrokeCircle(ctx, fx, fy, 4.2, i % 2 === 0 ? style.hatColor : style.accent, 2);
      }
      break;
    }
    case 'icepack': {
      ctx.fillStyle = style.hatColor;
      ctx.beginPath();
      ctx.ellipse(c, topY + 1, 14, 7, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      roundRectPath(ctx, c - 4, topY - 9, 8, 5, 2);
      ctx.fillStyle = style.accent;
      ctx.fill();
      ctx.stroke();
      break;
    }
    case 'headset': {
      ctx.strokeStyle = INK;
      ctx.lineWidth = 5.5;
      ctx.beginPath();
      ctx.arc(c, bodyY - 2, rx + 2, Math.PI * 1.05, Math.PI * 1.95);
      ctx.stroke();
      ctx.strokeStyle = style.hatColor;
      ctx.lineWidth = 2.8;
      ctx.stroke();
      roundRectPath(ctx, c - rx - 4, bodyY - 6, 6, 13, 3);
      ctx.fillStyle = style.accent;
      ctx.fill();
      ctx.stroke();
      roundRectPath(ctx, c + rx - 2, bodyY - 6, 6, 13, 3);
      ctx.fill();
      ctx.stroke();
      break;
    }
    case 'turban': {
      ctx.fillStyle = style.hatColor;
      ctx.beginPath();
      ctx.ellipse(c, topY + 3, rx + 2, 9, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      fillStrokeCircle(ctx, c, topY + 1, 4, style.accent, 2);
      break;
    }
    case 'vamp_hair': {
      ctx.fillStyle = style.hatColor;
      ctx.beginPath();
      ctx.arc(c, topY + 9, rx + 1, Math.PI, Math.PI * 2);
      ctx.lineTo(c + 5, topY + 7);
      ctx.lineTo(c, topY + 13);
      ctx.lineTo(c - 5, topY + 7);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      break;
    }
    case 'bandage': {
      ctx.fillStyle = style.hatColor;
      roundRectPath(ctx, c - rx + 1, topY + 3, (rx - 1) * 2, 9, 3);
      ctx.fill();
      ctx.stroke();
      fillStrokeCircle(ctx, c - 5, topY + 7, 2.5, style.accent, 0);
      break;
    }
    case 'crystal_brow': {
      ctx.fillStyle = style.hatColor;
      ctx.beginPath();
      ctx.moveTo(c - 10, topY + 4);
      ctx.lineTo(c - 5, topY - 10);
      ctx.lineTo(c + 2, topY - 4);
      ctx.lineTo(c + 8, topY - 12);
      ctx.lineTo(c + 12, topY + 4);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      break;
    }
    case 'baby_curl': {
      ctx.strokeStyle = INK;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(c + 2, topY - 2, 5, 0.2, Math.PI * 1.75);
      ctx.stroke();
      break;
    }
    case 'cage_band': {
      ctx.fillStyle = style.hatColor;
      roundRectPath(ctx, c - rx + 1, topY + 5, (rx - 1) * 2, 6, 2);
      ctx.fill();
      ctx.stroke();
      for (let sx = -10; sx <= 10; sx += 10) {
        ctx.beginPath();
        ctx.moveTo(c + sx - 3, topY + 5);
        ctx.lineTo(c + sx, topY - 4);
        ctx.lineTo(c + sx + 3, topY + 5);
        ctx.closePath();
        ctx.fillStyle = '#cbd5e1';
        ctx.fill();
        ctx.stroke();
      }
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
      if (style.accessory === 'headlamp') {
        fillStrokeCircle(ctx, c, topY + 3, 4.2, '#fef08a', 2);
      }
      break;
    }
    default:
      break;
  }

  // Floating front/outer accessories (rune sparkle, orbit beads)
  if (style.accessory === 'rune_sparkle') {
    drawStarPolygon(ctx, c + rx + 4, topY + 4, 4, 5.5, 2);
    ctx.fillStyle = style.accent;
    ctx.fill();
    ctx.lineWidth = 1.6;
    ctx.strokeStyle = INK;
    ctx.stroke();
  } else if (style.accessory === 'orbit_beads') {
    fillStrokeCircle(ctx, c - rx - 4, bodyY - 8, 3.2, style.accent, 1.6);
    fillStrokeCircle(ctx, c + rx + 4, bodyY - 8, 3.2, style.hatColor, 1.6);
  }
}

// ----------------------------------------------------------------------------
// Weapon Sprites (64x64, facing right +X) — ALL 80 Base Weapons from oracle.json
// ----------------------------------------------------------------------------

function drawWeaponSprite(ctx: CanvasRenderingContext2D, spriteId: string, size: number): void {
  const key = spriteId.replace(/^weapon_(?:icon_)?/, '');
  const c = size / 2;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.strokeStyle = INK;
  ctx.lineWidth = 3;

  switch (key) {
    // --- UNARMED / FISTS / CLAWS ---
    case 'fist': {
      roundRectPath(ctx, 14, 18, 34, 28, 11);
      ctx.fillStyle = '#e8c499';
      ctx.fill();
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(32, 20);
      ctx.lineTo(32, 44);
      ctx.moveTo(40, 22);
      ctx.lineTo(40, 42);
      ctx.stroke();
      roundRectPath(ctx, 20, 38, 16, 10, 5);
      ctx.fill();
      ctx.stroke();
      return;
    }
    case 'hand': {
      roundRectPath(ctx, 12, 22, 24, 22, 8);
      ctx.fillStyle = '#ebd0a8';
      ctx.fill();
      ctx.stroke();
      for (const fy of [18, 25, 32, 39]) {
        roundRectPath(ctx, 32, fy, 20, 6.5, 3);
        ctx.fillStyle = '#ebd0a8';
        ctx.fill();
        ctx.stroke();
      }
      roundRectPath(ctx, 20, 14, 14, 8, 4);
      ctx.fill();
      ctx.stroke();
      return;
    }
    case 'knuckles':
    case 'flaming_brass_knuckles':
    case 'flaming_knuckles': {
      const flaming = key !== 'knuckles';
      if (flaming) {
        drawStarPolygon(ctx, 45, c, 9, 17, 10);
        ctx.fillStyle = '#ff6a1a';
        ctx.fill();
        ctx.stroke();
      }
      roundRectPath(ctx, 14, 16, 32, 32, 9);
      ctx.fillStyle = flaming ? '#fbbf24' : '#eab308';
      ctx.fill();
      ctx.stroke();
      for (const cy of [23, 32, 41]) {
        fillStrokeCircle(ctx, 33, cy, 4.2, '#1e1b2e', 2.2);
      }
      if (flaming) {
        fillStrokeCircle(ctx, 48, c - 4, 4, '#fef08a', 0);
        fillStrokeCircle(ctx, 48, c + 5, 3.2, '#fef08a', 0);
      }
      return;
    }
    case 'cestus': {
      roundRectPath(ctx, 12, 16, 36, 32, 10);
      ctx.fillStyle = '#7c4a26';
      ctx.fill();
      ctx.stroke();
      roundRectPath(ctx, 28, 17, 18, 30, 5);
      ctx.fillStyle = '#64748b';
      ctx.fill();
      ctx.stroke();
      for (const sy of [22, 32, 42]) {
        ctx.beginPath();
        ctx.moveTo(45, sy - 4);
        ctx.lineTo(56, sy);
        ctx.lineTo(45, sy + 4);
        ctx.closePath();
        ctx.fillStyle = '#e2e8f0';
        ctx.fill();
        ctx.stroke();
      }
      return;
    }
    case 'power_fist': {
      roundRectPath(ctx, 8, 22, 14, 20, 4);
      ctx.fillStyle = '#475569';
      ctx.fill();
      ctx.stroke();
      roundRectPath(ctx, 18, 13, 36, 38, 10);
      ctx.fillStyle = '#f59e0b';
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = '#1e293b';
      ctx.fillRect(24, 16, 6, 32);
      roundRectPath(ctx, 34, 19, 16, 26, 5);
      ctx.fillStyle = '#fde047';
      ctx.fill();
      ctx.stroke();
      fillStrokeCircle(ctx, 27, c, 4, '#38bdf8', 2);
      return;
    }
    case 'claw': {
      roundRectPath(ctx, 10, 20, 14, 24, 5);
      ctx.fillStyle = '#334155';
      ctx.fill();
      ctx.stroke();
      for (const [y0, y1] of [[22, 15], [32, 32], [42, 49]]) {
        ctx.beginPath();
        ctx.moveTo(24, y0 - 3);
        ctx.quadraticCurveTo(42, y0 - 4, 57, y1);
        ctx.quadraticCurveTo(42, y0 + 3, 24, y0 + 3);
        ctx.closePath();
        ctx.fillStyle = '#e2e8f0';
        ctx.fill();
        ctx.stroke();
      }
      return;
    }

    // --- BLADES / KNIVES / SWORDS / AXES / SCYTHES ---
    case 'knife':
    case 'dagger':
    case 'lightning_shiv':
    case 'ghost_flint': {
      const gripCol = key === 'dagger' ? '#6d28d9' : key === 'ghost_flint' ? '#38bdf8' : '#991b1b';
      const bladeCol =
        key === 'lightning_shiv' ? '#7dd3fc' : key === 'ghost_flint' ? '#bae6fd' : '#e2e8f0';
      roundRectPath(ctx, 8, c - 4.5, 16, 9, 3);
      ctx.fillStyle = gripCol;
      ctx.fill();
      ctx.stroke();
      roundRectPath(ctx, 22, c - 9, 5, 18, 2);
      ctx.fillStyle = key === 'ghost_flint' ? '#818cf8' : '#eab308';
      ctx.fill();
      ctx.stroke();
      ctx.beginPath();
      if (key === 'dagger') {
        ctx.moveTo(27, c - 5);
        ctx.lineTo(58, c);
        ctx.lineTo(27, c + 5);
      } else if (key === 'lightning_shiv') {
        ctx.moveTo(27, c - 6);
        ctx.lineTo(40, c - 2);
        ctx.lineTo(37, c - 7);
        ctx.lineTo(58, c);
        ctx.lineTo(41, c + 7);
        ctx.lineTo(43, c + 2);
        ctx.lineTo(27, c + 6);
      } else {
        ctx.moveTo(27, c - 6);
        ctx.lineTo(56, c);
        ctx.lineTo(48, c + 6);
        ctx.lineTo(27, c + 6);
      }
      ctx.closePath();
      ctx.fillStyle = bladeCol;
      ctx.fill();
      ctx.stroke();
      // Specular edge
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 1.8;
      ctx.beginPath();
      ctx.moveTo(30, c - 2);
      ctx.lineTo(49, c - 0.5);
      ctx.stroke();
      return;
    }
    case 'sharp_tooth': {
      roundRectPath(ctx, 8, c - 4, 15, 8, 3);
      ctx.fillStyle = '#92400e';
      ctx.fill();
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(22, c - 8);
      ctx.quadraticCurveTo(42, c - 10, 56, c + 3);
      ctx.quadraticCurveTo(38, c + 10, 22, c + 7);
      ctx.closePath();
      ctx.fillStyle = '#fef3c7';
      ctx.fill();
      ctx.stroke();
      return;
    }
    case 'chopper': {
      roundRectPath(ctx, 7, c + 3, 18, 9, 3);
      ctx.fillStyle = '#78350f';
      ctx.fill();
      ctx.stroke();
      roundRectPath(ctx, 22, c - 15, 34, 26, 4);
      ctx.fillStyle = '#cbd5e1';
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = '#f8fafc';
      ctx.fillRect(24, c - 13, 30, 5);
      fillStrokeCircle(ctx, 48, c - 7, 3.2, '#1e1b2e', 2);
      return;
    }
    case 'circular_saw': {
      roundRectPath(ctx, 6, c - 5, 22, 10, 4);
      ctx.fillStyle = '#dc2626';
      ctx.fill();
      ctx.stroke();
      drawStarPolygon(ctx, 42, c, 12, 18, 12);
      ctx.fillStyle = '#e2e8f0';
      ctx.fill();
      ctx.stroke();
      fillStrokeCircle(ctx, 42, c, 6, '#ef4444', 2.4);
      return;
    }
    case 'hatchet': {
      roundRectPath(ctx, 8, c - 3.5, 36, 7, 3);
      ctx.fillStyle = '#92400e';
      ctx.fill();
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(35, c - 7);
      ctx.lineTo(52, c - 17);
      ctx.quadraticCurveTo(59, c, 52, c + 17);
      ctx.lineTo(35, c + 7);
      ctx.closePath();
      ctx.fillStyle = '#cbd5e1';
      ctx.fill();
      ctx.stroke();
      return;
    }
    case 'ghost_axe': {
      roundRectPath(ctx, 6, c - 3, 38, 6, 3);
      ctx.fillStyle = '#6366f1';
      ctx.fill();
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(36, c - 4);
      ctx.quadraticCurveTo(46, c - 22, 57, c - 15);
      ctx.quadraticCurveTo(50, c, 57, c + 15);
      ctx.quadraticCurveTo(46, c + 22, 36, c + 4);
      ctx.closePath();
      ctx.fillStyle = '#7dd3fc';
      ctx.fill();
      ctx.stroke();
      fillStrokeCircle(ctx, 44, c, 4, '#ffffff', 1.8);
      return;
    }
    case 'sword':
    case 'excalibur':
    case 'bloody_vorpal':
    case 'vorpal_sword':
    case 'thunder_sword':
    case 'dextroyer': {
      const isExcal = key === 'excalibur';
      const isVorpal = key === 'bloody_vorpal' || key === 'vorpal_sword';
      const isThunder = key === 'thunder_sword';
      const isDex = key === 'dextroyer';
      roundRectPath(ctx, 5, c - 4, 14, 8, 3);
      ctx.fillStyle = isExcal ? '#2563eb' : isVorpal ? '#450a0a' : isThunder ? '#0284c7' : isDex ? '#1e293b' : '#7c2d12';
      ctx.fill();
      ctx.stroke();
      roundRectPath(ctx, 17, c - 14, 6, 28, 3);
      ctx.fillStyle = isExcal ? '#facc15' : isVorpal ? '#ef4444' : isDex ? '#f97316' : '#eab308';
      ctx.fill();
      ctx.stroke();
      ctx.beginPath();
      if (isThunder) {
        ctx.moveTo(23, c - 6);
        ctx.lineTo(39, c - 9);
        ctx.lineTo(36, c - 2);
        ctx.lineTo(59, c);
        ctx.lineTo(38, c + 8);
        ctx.lineTo(41, c + 2);
        ctx.lineTo(23, c + 6);
      } else {
        ctx.moveTo(23, c - 7);
        ctx.lineTo(52, c - (isDex ? 9 : 5));
        ctx.lineTo(60, c);
        ctx.lineTo(52, c + (isDex ? 9 : 5));
        ctx.lineTo(23, c + 7);
      }
      ctx.closePath();
      ctx.fillStyle = isExcal
        ? '#fef08a'
        : isVorpal
          ? '#991b1b'
          : isThunder
            ? '#38bdf8'
            : isDex
              ? '#fb923c'
              : '#e2e8f0';
      ctx.fill();
      ctx.stroke();
      ctx.strokeStyle = isVorpal ? '#fca5a5' : '#ffffff';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(27, c - 1.5);
      ctx.lineTo(52, c - 0.5);
      ctx.stroke();
      if (isDex) {
        fillStrokeCircle(ctx, 36, c, 4.5, '#ef4444', 2);
      }
      return;
    }
    case 'light_saber': {
      roundRectPath(ctx, 6, c - 4.5, 17, 9, 3);
      ctx.fillStyle = '#94a3b8';
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = '#1e293b';
      ctx.fillRect(10, c - 4, 5, 8);
      roundRectPath(ctx, 22, c - 5.5, 36, 11, 5);
      ctx.fillStyle = '#22d3ee';
      ctx.fill();
      ctx.stroke();
      roundRectPath(ctx, 25, c - 2.2, 30, 4.4, 2);
      ctx.fillStyle = '#ffffff';
      ctx.fill();
      return;
    }
    case 'scythe': {
      roundRectPath(ctx, 6, c + 2, 42, 6, 3);
      ctx.fillStyle = '#4c1d95';
      ctx.fill();
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(42, c + 4);
      ctx.quadraticCurveTo(58, c - 10, 48, c - 22);
      ctx.quadraticCurveTo(36, c - 18, 22, c - 14);
      ctx.quadraticCurveTo(38, c - 10, 38, c + 4);
      ctx.closePath();
      ctx.fillStyle = '#e2e8f0';
      ctx.fill();
      ctx.stroke();
      fillStrokeCircle(ctx, 44, c + 4, 4, '#ef4444', 2);
      return;
    }
    case 'scissors': {
      fillStrokeCircle(ctx, 15, c - 9, 7, '#ef4444', 3);
      fillStrokeCircle(ctx, 15, c + 9, 7, '#ef4444', 3);
      fillStrokeCircle(ctx, 15, c - 9, 3, INK, 0);
      fillStrokeCircle(ctx, 15, c + 9, 3, INK, 0);
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

    // --- POLEARMS / BLUNT / PRIMITIVE / TOOLS ---
    case 'stick':
    case 'fighting_stick':
    case 'hiking_stick':
    case 'torch': {
      ctx.fillStyle = key === 'fighting_stick' ? '#b45309' : '#8b5a2b';
      roundRectPath(ctx, 6, c - 4.5, 48, 9, 4);
      ctx.fill();
      ctx.stroke();
      if (key === 'torch') {
        drawStarPolygon(ctx, 52, c, 7, 11, 5.5);
        ctx.fillStyle = '#ff6a1a';
        ctx.fill();
        ctx.stroke();
        fillStrokeCircle(ctx, 51, c, 4.5, '#ffe552', 0);
      } else if (key === 'fighting_stick') {
        ctx.fillStyle = '#dc2626';
        ctx.fillRect(18, c - 4.5, 6, 9);
        ctx.fillRect(36, c - 4.5, 6, 9);
      } else {
        ctx.fillStyle = '#4ade80';
        ctx.beginPath();
        ctx.ellipse(46, c - 10, 8, 4.5, -0.5, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      }
      return;
    }
    case 'spear': {
      roundRectPath(ctx, 4, c - 3, 38, 6, 2);
      ctx.fillStyle = '#92400e';
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = '#ef4444';
      ctx.beginPath();
      ctx.ellipse(39, c + 7, 5, 3, 0.4, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
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
    case 'jousting_lance': {
      roundRectPath(ctx, 5, c - 3.5, 12, 7, 2);
      ctx.fillStyle = '#78350f';
      ctx.fill();
      ctx.stroke();
      // Funnel vamplate guard
      ctx.beginPath();
      ctx.moveTo(16, c - 13);
      ctx.lineTo(26, c - 8);
      ctx.lineTo(26, c + 8);
      ctx.lineTo(16, c + 13);
      ctx.closePath();
      ctx.fillStyle = '#facc15';
      ctx.fill();
      ctx.stroke();
      // Tapered tournament cone
      ctx.beginPath();
      ctx.moveTo(26, c - 7);
      ctx.lineTo(60, c);
      ctx.lineTo(26, c + 7);
      ctx.closePath();
      ctx.fillStyle = '#ef4444';
      ctx.fill();
      ctx.stroke();
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.moveTo(33, c - 4);
      ctx.lineTo(37, c + 4);
      ctx.moveTo(43, c - 3);
      ctx.lineTo(46, c + 3);
      ctx.stroke();
      return;
    }
    case 'cactus_mace':
    case 'cacti_club': {
      roundRectPath(ctx, 8, c - 4, 18, 8, 3);
      ctx.fillStyle = '#8b5a2b';
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = '#22c55e';
      ctx.beginPath();
      ctx.ellipse(41, c, 16, 11, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.strokeStyle = '#fef08a';
      ctx.lineWidth = 2.2;
      for (const [sx, sy, dx, dy] of [
        [34, c - 10, -2, -5], [44, c - 11, 1, -5], [55, c, 5, 0], [44, c + 11, 1, 5], [34, c + 10, -2, 5],
      ]) {
        ctx.beginPath();
        ctx.moveTo(sx, sy);
        ctx.lineTo(sx + dx, sy + dy);
        ctx.stroke();
      }
      fillStrokeCircle(ctx, 52, c - 7, 4, '#f472b6', 2);
      return;
    }
    case 'rock':
    case 'brick': {
      if (key === 'brick') {
        roundRectPath(ctx, 13, 20, 38, 24, 4);
        ctx.fillStyle = '#b91c1c';
        ctx.fill();
        ctx.stroke();
        return;
      }
      ctx.beginPath();
      ctx.moveTo(15, 24);
      ctx.lineTo(28, 13);
      ctx.lineTo(47, 17);
      ctx.lineTo(53, 35);
      ctx.lineTo(42, 50);
      ctx.lineTo(20, 48);
      ctx.lineTo(11, 36);
      ctx.closePath();
      ctx.fillStyle = '#94a3b8';
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = '#cbd5e1';
      ctx.beginPath();
      ctx.moveTo(22, 22);
      ctx.lineTo(35, 19);
      ctx.lineTo(31, 30);
      ctx.closePath();
      ctx.fill();
      return;
    }
    case 'plank': {
      roundRectPath(ctx, 7, c - 8, 46, 16, 3);
      ctx.fillStyle = '#b45309';
      ctx.fill();
      ctx.stroke();
      // Strapped explosive bundle
      roundRectPath(ctx, 32, c - 11, 16, 22, 3);
      ctx.fillStyle = '#dc2626';
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = '#1e293b';
      ctx.fillRect(38, c - 11, 4, 22);
      fillStrokeCircle(ctx, 49, c - 11, 3.5, '#fde047', 1.5);
      return;
    }
    case 'hammer':
    case 'plasma_sledgehammer':
    case 'meat_tenderizer': {
      const isPlasma = key === 'plasma_sledgehammer';
      const isTend = key === 'meat_tenderizer';
      roundRectPath(ctx, 6, c - 3.5, 34, 7, 3);
      ctx.fillStyle = isPlasma ? '#334155' : '#8b5a2b';
      ctx.fill();
      ctx.stroke();
      roundRectPath(ctx, 35, c - 16, 19, 32, 4);
      ctx.fillStyle = isPlasma ? '#a855f7' : isTend ? '#cbd5e1' : '#64748b';
      ctx.fill();
      ctx.stroke();
      if (isPlasma) {
        roundRectPath(ctx, 40, c - 11, 9, 22, 3);
        ctx.fillStyle = '#38bdf8';
        ctx.fill();
      } else if (isTend) {
        for (const sy of [c - 10, c, c + 10]) {
          fillStrokeCircle(ctx, 54, sy, 3, '#e2e8f0', 2);
        }
      }
      return;
    }
    case 'flail': {
      roundRectPath(ctx, 6, c - 3.5, 22, 7, 3);
      ctx.fillStyle = '#78350f';
      ctx.fill();
      ctx.stroke();
      ctx.strokeStyle = '#94a3b8';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(28, c);
      ctx.lineTo(39, c);
      ctx.stroke();
      ctx.strokeStyle = INK;
      drawStarPolygon(ctx, 48, c, 8, 13, 8);
      ctx.fillStyle = '#64748b';
      ctx.fill();
      ctx.stroke();
      return;
    }
    case 'spiky_shield': {
      fillStrokeCircle(ctx, c, c, 21, '#64748b', 3.4);
      fillStrokeCircle(ctx, c, c, 15, '#94a3b8', 2.4);
      for (let i = 0; i < 6; i++) {
        const a = (i * Math.PI) / 3;
        const sx = c + Math.cos(a) * 19;
        const sy = c + Math.sin(a) * 19;
        const tx = c + Math.cos(a) * 27;
        const ty = c + Math.sin(a) * 27;
        ctx.beginPath();
        ctx.moveTo(sx - Math.sin(a) * 3.5, sy + Math.cos(a) * 3.5);
        ctx.lineTo(tx, ty);
        ctx.lineTo(sx + Math.sin(a) * 3.5, sy - Math.cos(a) * 3.5);
        ctx.closePath();
        ctx.fillStyle = '#e2e8f0';
        ctx.fill();
        ctx.stroke();
      }
      fillStrokeCircle(ctx, c, c, 5, '#facc15', 2.2);
      return;
    }
    case 'whip': {
      roundRectPath(ctx, 7, c + 6, 15, 7, 3);
      ctx.fillStyle = '#78350f';
      ctx.fill();
      ctx.stroke();
      ctx.strokeStyle = INK;
      ctx.lineWidth = 6.5;
      ctx.beginPath();
      ctx.moveTo(21, c + 9);
      ctx.bezierCurveTo(36, c + 16, 48, c - 18, 28, c - 12);
      ctx.bezierCurveTo(18, c - 8, 42, c - 2, 56, c - 10);
      ctx.stroke();
      ctx.strokeStyle = '#b45309';
      ctx.lineWidth = 3.2;
      ctx.stroke();
      fillStrokeCircle(ctx, 56, c - 10, 3, '#fde047', 1.6);
      return;
    }
    case 'wrench': {
      roundRectPath(ctx, 10, c - 4.5, 32, 9, 3);
      ctx.fillStyle = '#94a3b8';
      ctx.fill();
      ctx.stroke();
      roundRectPath(ctx, 12, c - 4.5, 13, 9, 2);
      ctx.fillStyle = '#2563eb';
      ctx.fill();
      ctx.stroke();
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
    case 'screwdriver': {
      roundRectPath(ctx, 7, c - 6, 20, 12, 5);
      ctx.fillStyle = '#facc15';
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = '#1e293b';
      ctx.fillRect(11, c - 6, 4, 12);
      roundRectPath(ctx, 27, c - 2.5, 25, 5, 1.5);
      ctx.fillStyle = '#cbd5e1';
      ctx.fill();
      ctx.stroke();
      roundRectPath(ctx, 51, c - 4, 7, 8, 1.5);
      ctx.fillStyle = '#94a3b8';
      ctx.fill();
      ctx.stroke();
      return;
    }
    case 'crowbar': {
      ctx.strokeStyle = INK;
      ctx.lineWidth = 9;
      ctx.beginPath();
      ctx.moveTo(10, c + 8);
      ctx.lineTo(44, c - 6);
      ctx.quadraticCurveTo(56, c - 10, 52, c + 5);
      ctx.stroke();
      ctx.strokeStyle = '#dc2626';
      ctx.lineWidth = 5;
      ctx.stroke();
      return;
    }
    case 'shovel':
    case 'spoon': {
      roundRectPath(ctx, 6, c - 3, 30, 6, 2);
      ctx.fillStyle = key === 'spoon' ? '#cbd5e1' : '#92400e';
      ctx.fill();
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(35, c - 11);
      ctx.lineTo(49, c - 10);
      ctx.quadraticCurveTo(60, c, 49, c + 10);
      ctx.lineTo(35, c + 11);
      ctx.closePath();
      ctx.fillStyle = '#cbd5e1';
      ctx.fill();
      ctx.stroke();
      return;
    }
    case 'pruner': {
      roundRectPath(ctx, 9, c - 11, 22, 7, 3);
      ctx.fillStyle = '#16a34a';
      ctx.fill();
      ctx.stroke();
      roundRectPath(ctx, 9, c + 4, 22, 7, 3);
      ctx.fillStyle = '#16a34a';
      ctx.fill();
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(30, c - 6);
      ctx.quadraticCurveTo(46, c - 13, 56, c + 1);
      ctx.lineTo(30, c + 2);
      ctx.closePath();
      ctx.fillStyle = '#e2e8f0';
      ctx.fill();
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(30, c + 6);
      ctx.quadraticCurveTo(45, c + 12, 54, c - 1);
      ctx.lineTo(30, c - 1);
      ctx.closePath();
      ctx.fillStyle = '#cbd5e1';
      ctx.fill();
      ctx.stroke();
      fillStrokeCircle(ctx, 33, c, 3.5, '#facc15', 2);
      return;
    }
    case 'awl': {
      fillStrokeCircle(ctx, 16, c, 9, '#92400e', 3);
      ctx.beginPath();
      ctx.moveTo(24, c - 3.5);
      ctx.lineTo(58, c);
      ctx.lineTo(24, c + 3.5);
      ctx.closePath();
      ctx.fillStyle = '#e2e8f0';
      ctx.fill();
      ctx.stroke();
      return;
    }
    case 'drill': {
      roundRectPath(ctx, 10, c + 4, 9, 14, 3);
      ctx.fillStyle = '#1e293b';
      ctx.fill();
      ctx.stroke();
      roundRectPath(ctx, 8, c - 10, 22, 18, 5);
      ctx.fillStyle = '#eab308';
      ctx.fill();
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(30, c - 9);
      ctx.lineTo(59, c);
      ctx.lineTo(30, c + 9);
      ctx.closePath();
      ctx.fillStyle = '#cbd5e1';
      ctx.fill();
      ctx.stroke();
      ctx.strokeStyle = '#ef4444';
      ctx.lineWidth = 2.2;
      ctx.beginPath();
      ctx.moveTo(36, c - 6);
      ctx.lineTo(39, c + 6);
      ctx.moveTo(45, c - 4);
      ctx.lineTo(48, c + 4);
      ctx.stroke();
      return;
    }

    // --- RANGED GUNS / LASERS / HEAVY LAUNCHERS ---
    case 'pistol': {
      ctx.fillStyle = '#5c4033';
      ctx.beginPath();
      ctx.moveTo(14, c + 1);
      ctx.lineTo(24, c + 1);
      ctx.lineTo(20, c + 18);
      ctx.lineTo(10, c + 16);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      roundRectPath(ctx, 13, c - 9, 39, 13, 3);
      ctx.fillStyle = '#64748b';
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = '#cbd5e1';
      ctx.fillRect(17, c - 6.5, 31, 4);
      return;
    }
    case 'revolver': {
      ctx.fillStyle = '#92400e';
      ctx.beginPath();
      ctx.moveTo(12, c + 2);
      ctx.lineTo(22, c + 2);
      ctx.lineTo(17, c + 19);
      ctx.lineTo(8, c + 16);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      roundRectPath(ctx, 21, c - 8, 36, 8, 2);
      ctx.fillStyle = '#94a3b8';
      ctx.fill();
      ctx.stroke();
      fillStrokeCircle(ctx, 27, c, 8, '#cbd5e1', 2.8);
      fillStrokeCircle(ctx, 27, c, 2.5, INK, 0);
      return;
    }
    case 'smg': {
      ctx.fillStyle = '#334155';
      roundRectPath(ctx, 13, c + 3, 9, 14, 2);
      ctx.fill();
      ctx.stroke();
      roundRectPath(ctx, 30, c + 3, 8, 17, 2);
      ctx.fillStyle = '#475569';
      ctx.fill();
      ctx.stroke();
      roundRectPath(ctx, 10, c - 9, 36, 15, 3);
      ctx.fillStyle = '#1e293b';
      ctx.fill();
      ctx.stroke();
      roundRectPath(ctx, 45, c - 6, 13, 7, 2);
      ctx.fillStyle = '#94a3b8';
      ctx.fill();
      ctx.stroke();
      fillStrokeCircle(ctx, 26, c - 10, 3.5, '#ef4444', 2);
      return;
    }
    case 'machinegun': {
      roundRectPath(ctx, 6, c - 5, 14, 12, 2);
      ctx.fillStyle = '#475569';
      ctx.fill();
      ctx.stroke();
      roundRectPath(ctx, 18, c - 9, 26, 16, 3);
      ctx.fillStyle = '#334155';
      ctx.fill();
      ctx.stroke();
      roundRectPath(ctx, 27, c + 6, 13, 12, 2);
      ctx.fillStyle = '#4d7c0f';
      ctx.fill();
      ctx.stroke();
      roundRectPath(ctx, 43, c - 6, 16, 7, 2);
      ctx.fillStyle = '#94a3b8';
      ctx.fill();
      ctx.stroke();
      return;
    }
    case 'minigun':
    case 'chain_gun': {
      const isChain = key === 'chain_gun';
      roundRectPath(ctx, 8, c - 12, 24, 24, 5);
      ctx.fillStyle = isChain ? '#991b1b' : '#334155';
      ctx.fill();
      ctx.stroke();
      // Multi rotary barrels
      for (const by of [c - 9, c - 3, c + 3]) {
        roundRectPath(ctx, 31, by, 27, 5, 1.5);
        ctx.fillStyle = isChain ? '#facc15' : '#94a3b8';
        ctx.fill();
        ctx.stroke();
      }
      roundRectPath(ctx, 46, c - 11, 5, 22, 2);
      ctx.fillStyle = '#1e293b';
      ctx.fill();
      ctx.stroke();
      return;
    }
    case 'double_barrel_shotgun': {
      ctx.fillStyle = '#9a5b2c';
      ctx.beginPath();
      ctx.moveTo(6, c + 10);
      ctx.lineTo(22, c - 2);
      ctx.lineTo(26, c + 7);
      ctx.lineTo(10, c + 17);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      roundRectPath(ctx, 20, c - 8, 38, 7, 2);
      ctx.fillStyle = '#64748b';
      ctx.fill();
      ctx.stroke();
      roundRectPath(ctx, 20, c - 2, 38, 7, 2);
      ctx.fillStyle = '#94a3b8';
      ctx.fill();
      ctx.stroke();
      roundRectPath(ctx, 26, c + 2, 16, 6, 2);
      ctx.fillStyle = '#b45309';
      ctx.fill();
      ctx.stroke();
      return;
    }
    case 'combat_shotgun': {
      roundRectPath(ctx, 6, c - 5, 15, 13, 3);
      ctx.fillStyle = '#1e293b';
      ctx.fill();
      ctx.stroke();
      roundRectPath(ctx, 19, c - 8, 39, 10, 2);
      ctx.fillStyle = '#334155';
      ctx.fill();
      ctx.stroke();
      roundRectPath(ctx, 30, c + 1, 18, 7, 2);
      ctx.fillStyle = '#ef4444';
      ctx.fill();
      ctx.stroke();
      return;
    }
    case 'shredder': {
      roundRectPath(ctx, 12, c + 4, 10, 13, 2);
      ctx.fillStyle = '#334155';
      ctx.fill();
      ctx.stroke();
      roundRectPath(ctx, 9, c - 10, 44, 18, 4);
      ctx.fillStyle = '#ea580c';
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = '#facc15';
      ctx.fillRect(26, c - 9, 6, 16);
      roundRectPath(ctx, 48, c - 8, 10, 14, 2);
      ctx.fillStyle = '#1e293b';
      ctx.fill();
      ctx.stroke();
      return;
    }
    case 'sniper_gun':
    case 'tranq_rifle': {
      const isTranq = key === 'tranq_rifle';
      roundRectPath(ctx, 5, c - 3, 16, 10, 2);
      ctx.fillStyle = isTranq ? '#0f766e' : '#5c4033';
      ctx.fill();
      ctx.stroke();
      roundRectPath(ctx, 19, c - 6, 40, 7, 2);
      ctx.fillStyle = isTranq ? '#e2e8f0' : '#475569';
      ctx.fill();
      ctx.stroke();
      // Scope
      roundRectPath(ctx, 24, c - 14, 18, 6, 2);
      ctx.fillStyle = isTranq ? '#38bdf8' : '#1e293b';
      ctx.fill();
      ctx.stroke();
      return;
    }
    case 'medical_gun': {
      roundRectPath(ctx, 14, c + 2, 10, 14, 3);
      ctx.fillStyle = '#cbd5e1';
      ctx.fill();
      ctx.stroke();
      roundRectPath(ctx, 11, c - 10, 40, 17, 6);
      ctx.fillStyle = '#f8fafc';
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = '#ef4444';
      ctx.fillRect(26, c - 7, 4, 11);
      ctx.fillRect(22.5, c - 3.5, 11, 4);
      roundRectPath(ctx, 48, c - 5, 9, 8, 2);
      ctx.fillStyle = '#22c55e';
      ctx.fill();
      ctx.stroke();
      return;
    }
    case 'taser': {
      roundRectPath(ctx, 13, c + 2, 10, 14, 3);
      ctx.fillStyle = '#1e293b';
      ctx.fill();
      ctx.stroke();
      roundRectPath(ctx, 10, c - 9, 34, 15, 4);
      ctx.fillStyle = '#facc15';
      ctx.fill();
      ctx.stroke();
      ctx.strokeStyle = '#38bdf8';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(44, c - 5);
      ctx.lineTo(56, c - 7);
      ctx.moveTo(44, c + 2);
      ctx.lineTo(56, c + 4);
      ctx.stroke();
      return;
    }
    case 'laser_gun':
    case 'gatling_laser':
    case 'obliterator':
    case 'rail_gun':
    case 'particle_accelerator': {
      const coreCol =
        key === 'obliterator'
          ? '#f43f5e'
          : key === 'particle_accelerator'
            ? '#a855f7'
            : key === 'gatling_laser'
              ? '#fde047'
              : '#22d3ee';
      roundRectPath(ctx, 12, c + 3, 10, 13, 3);
      ctx.fillStyle = '#334155';
      ctx.fill();
      ctx.stroke();
      roundRectPath(ctx, 9, c - 10, 42, 17, 5);
      ctx.fillStyle = key === 'obliterator' ? '#1e1b2e' : '#e2e8f0';
      ctx.fill();
      ctx.stroke();
      roundRectPath(ctx, 19, c - 5, 23, 7, 3);
      ctx.fillStyle = coreCol;
      ctx.fill();
      ctx.stroke();
      if (key === 'rail_gun') {
        roundRectPath(ctx, 46, c - 9, 13, 5, 1.5);
        ctx.fillStyle = '#38bdf8';
        ctx.fill();
        ctx.stroke();
        roundRectPath(ctx, 46, c + 2, 13, 5, 1.5);
        ctx.fill();
        ctx.stroke();
      } else if (key === 'particle_accelerator') {
        for (const rxPos of [34, 43, 52]) {
          roundRectPath(ctx, rxPos, c - 11, 4, 20, 2);
          ctx.fillStyle = '#c084fc';
          ctx.fill();
          ctx.stroke();
        }
      } else {
        roundRectPath(ctx, 49, c - 7, 9, 11, 2);
        ctx.fillStyle = coreCol;
        ctx.fill();
        ctx.stroke();
      }
      return;
    }
    case 'flamethrower': {
      roundRectPath(ctx, 10, c + 3, 24, 13, 6);
      ctx.fillStyle = '#dc2626';
      ctx.fill();
      ctx.stroke();
      roundRectPath(ctx, 8, c - 8, 42, 11, 3);
      ctx.fillStyle = '#475569';
      ctx.fill();
      ctx.stroke();
      drawStarPolygon(ctx, 54, c - 2, 6, 8, 4);
      ctx.fillStyle = '#fb923c';
      ctx.fill();
      ctx.stroke();
      return;
    }
    case 'rocket_launcher':
    case 'nuclear_launcher': {
      const isNuke = key === 'nuclear_launcher';
      roundRectPath(ctx, 8, c - 10, 40, 20, 4);
      ctx.fillStyle = isNuke ? '#ca8a04' : '#4d7c0f';
      ctx.fill();
      ctx.stroke();
      roundRectPath(ctx, 5, c - 12, 7, 24, 2);
      ctx.fillStyle = '#334155';
      ctx.fill();
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(47, c - 8);
      ctx.quadraticCurveTo(60, c, 47, c + 8);
      ctx.closePath();
      ctx.fillStyle = isNuke ? '#4ade80' : '#ef4444';
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = isNuke ? '#1e293b' : '#facc15';
      ctx.fillRect(26, c - 8, 6, 16);
      return;
    }
    case 'potato_thrower': {
      roundRectPath(ctx, 8, c - 9, 34, 18, 5);
      ctx.fillStyle = '#b45309';
      ctx.fill();
      ctx.stroke();
      roundRectPath(ctx, 12, c - 5, 16, 10, 3);
      ctx.fillStyle = '#facc15';
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = '#e5be91';
      ctx.beginPath();
      ctx.ellipse(49, c, 9, 11, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      return;
    }

    // --- BOWS / THROWN / ARCANE / MUSICAL ---
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
    case 'crossbow': {
      roundRectPath(ctx, 8, c - 4, 38, 8, 3);
      ctx.fillStyle = '#8b5a2b';
      ctx.fill();
      ctx.stroke();
      ctx.strokeStyle = INK;
      ctx.lineWidth = 7;
      ctx.beginPath();
      ctx.arc(32, c, 20, -Math.PI * 0.42, Math.PI * 0.42);
      ctx.stroke();
      ctx.strokeStyle = '#cbd5e1';
      ctx.lineWidth = 3.5;
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(44, c - 5);
      ctx.lineTo(59, c);
      ctx.lineTo(44, c + 5);
      ctx.closePath();
      ctx.fillStyle = '#e2e8f0';
      ctx.fill();
      ctx.stroke();
      return;
    }
    case 'carbon_bow': {
      ctx.strokeStyle = INK;
      ctx.lineWidth = 7.5;
      ctx.beginPath();
      ctx.arc(24, c, 22, -Math.PI * 0.44, Math.PI * 0.44);
      ctx.stroke();
      ctx.strokeStyle = '#334155';
      ctx.lineWidth = 4;
      ctx.stroke();
      ctx.strokeStyle = '#38bdf8';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(28, c - 20);
      ctx.lineTo(16, c);
      ctx.lineTo(28, c + 20);
      ctx.stroke();
      ctx.strokeStyle = '#facc15';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(16, c);
      ctx.lineTo(55, c);
      ctx.stroke();
      return;
    }
    case 'blowgun': {
      roundRectPath(ctx, 7, c - 3.5, 42, 7, 3);
      ctx.fillStyle = '#65a30d';
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = '#dc2626';
      ctx.fillRect(18, c - 3.5, 5, 7);
      ctx.fillRect(34, c - 3.5, 5, 7);
      ctx.beginPath();
      ctx.moveTo(49, c - 4);
      ctx.lineTo(59, c);
      ctx.lineTo(49, c + 4);
      ctx.closePath();
      ctx.fillStyle = '#a3e635';
      ctx.fill();
      ctx.stroke();
      return;
    }
    case 'boomerang': {
      ctx.beginPath();
      ctx.moveTo(14, 16);
      ctx.quadraticCurveTo(54, 14, 50, 50);
      ctx.quadraticCurveTo(38, 52, 36, 40);
      ctx.quadraticCurveTo(36, 28, 22, 28);
      ctx.quadraticCurveTo(10, 26, 14, 16);
      ctx.closePath();
      ctx.fillStyle = '#d97706';
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = '#ef4444';
      ctx.fillRect(36, 22, 9, 6);
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
    case 'icicle': {
      ctx.beginPath();
      ctx.moveTo(10, c - 10);
      ctx.lineTo(58, c);
      ctx.lineTo(10, c + 10);
      ctx.lineTo(18, c);
      ctx.closePath();
      ctx.fillStyle = '#7dd3fc';
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = '#e0f2fe';
      ctx.beginPath();
      ctx.moveTo(18, c - 4);
      ctx.lineTo(46, c);
      ctx.lineTo(18, c + 1);
      ctx.closePath();
      ctx.fill();
      return;
    }
    case 'wand':
    case 'ghost_scepter': {
      const isGhost = key === 'ghost_scepter';
      roundRectPath(ctx, 8, c - 3.5, 34, 7, 3);
      ctx.fillStyle = isGhost ? '#4c1d95' : '#78350f';
      ctx.fill();
      ctx.stroke();
      drawStarPolygon(ctx, 48, c, isGhost ? 5 : 6, 11, 6);
      ctx.fillStyle = isGhost ? '#c084fc' : '#38bdf8';
      ctx.fill();
      ctx.stroke();
      fillStrokeCircle(ctx, 48, c, 4, '#ffffff', 0);
      return;
    }
    case 'fireball': {
      drawStarPolygon(ctx, c + 2, c, 10, 22, 13);
      ctx.fillStyle = '#f97316';
      ctx.fill();
      ctx.stroke();
      fillStrokeCircle(ctx, c + 2, c, 10, '#fde047', 2);
      fillStrokeCircle(ctx, c + 4, c - 2, 4, '#ffffff', 0);
      return;
    }
    case 'molotov': {
      roundRectPath(ctx, 18, 22, 24, 30, 8);
      ctx.fillStyle = '#15803d';
      ctx.fill();
      ctx.stroke();
      roundRectPath(ctx, 25, 13, 10, 12, 3);
      ctx.fillStyle = '#22c55e';
      ctx.fill();
      ctx.stroke();
      drawStarPolygon(ctx, 36, 11, 6, 8, 4);
      ctx.fillStyle = '#fb923c';
      ctx.fill();
      ctx.stroke();
      return;
    }
    case 'sticky_grenade': {
      fillStrokeCircle(ctx, c, c + 4, 16, '#4d7c0f', 3.2);
      roundRectPath(ctx, c - 6, 11, 12, 8, 2);
      ctx.fillStyle = '#94a3b8';
      ctx.fill();
      ctx.stroke();
      fillStrokeCircle(ctx, c, c + 4, 6.5, '#ef4444', 2.2);
      fillStrokeCircle(ctx, c + 9, 14, 4, '#facc15', 2);
      return;
    }
    case 'pan_flute':
    case 'flute':
    case 'lute': {
      if (key === 'lute') {
        fillStrokeCircle(ctx, 22, c + 4, 14, '#b45309', 3);
        roundRectPath(ctx, 32, c - 4, 24, 8, 2);
        ctx.fillStyle = '#78350f';
        ctx.fill();
        ctx.stroke();
        fillStrokeCircle(ctx, 22, c + 4, 5, '#1e1b2e', 2);
        return;
      }
      const cols = ['#fde047', '#facc15', '#eab308', '#facc15', '#fde047'];
      for (let i = 0; i < 5; i++) {
        const hBar = 34 - i * 4.5;
        roundRectPath(ctx, 12 + i * 8, 15, 7, hBar, 3);
        ctx.fillStyle = cols[i];
        ctx.fill();
        ctx.stroke();
      }
      roundRectPath(ctx, 10, 24, 42, 6, 2);
      ctx.fillStyle = '#dc2626';
      ctx.fill();
      ctx.stroke();
      return;
    }
    default: {
      const h = hashStr(key);
      const isMelee = (h & 1) === 0;
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
// Enemies, Elites & Bosses — ALL 38 Crash Zone Enemies (28 Basic + 8 Elites + 2 Bosses)
// ----------------------------------------------------------------------------

function drawEnemyHorns(ctx: CanvasRenderingContext2D, y: number, spread: number, height: number, fill = '#fef3c7'): void {
  ctx.fillStyle = fill;
  for (const dir of [-1, 1]) {
    ctx.beginPath();
    ctx.moveTo(32 + dir * (spread - 4), y + 4);
    ctx.quadraticCurveTo(32 + dir * (spread + 8), y - height * 0.4, 32 + dir * (spread + 5), y - height);
    ctx.quadraticCurveTo(32 + dir * (spread - 1), y - height * 0.3, 32 + dir * (spread + 2), y + 5);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  }
}

function drawEnemySprite(ctx: CanvasRenderingContext2D, spriteId: string, size: number): void {
  const key = spriteId.replace(/^enemy_(?:icon_)?/, '');
  const s = size / 64;
  ctx.save();
  ctx.scale(s, s);
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.strokeStyle = INK;
  ctx.lineWidth = 3.2;

  switch (key) {
    // ==================== WAVE-20 BOSSES (2) ====================
    case 'predator': {
      // Imposing Wave 20 Apex Razor-Jaw Boss!
      ctx.fillStyle = '#dc2626';
      for (const dir of [-1, 1]) {
        ctx.beginPath();
        ctx.moveTo(32 + dir * 15, 22);
        ctx.lineTo(32 + dir * 30, 5);
        ctx.lineTo(32 + dir * 26, 30);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
      }
      ctx.beginPath();
      ctx.moveTo(13, 24);
      ctx.lineTo(22, 10);
      ctx.lineTo(42, 10);
      ctx.lineTo(51, 24);
      ctx.lineTo(49, 49);
      ctx.lineTo(32, 58);
      ctx.lineTo(15, 49);
      ctx.closePath();
      ctx.fillStyle = '#3b1526';
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = '#7f1d1d';
      roundRectPath(ctx, 19, 15, 26, 15, 4);
      ctx.fill();
      ctx.stroke();
      // Glowing gold predator visor eyes
      ctx.fillStyle = '#facc15';
      for (const dir of [-1, 1]) {
        ctx.beginPath();
        ctx.moveTo(32 + dir * 12, 24);
        ctx.lineTo(32 + dir * 3, 28);
        ctx.lineTo(32 + dir * 11, 31);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
      }
      // Razor jaw fangs
      ctx.fillStyle = '#fef2f2';
      for (let i = 0; i < 4; i++) {
        const fx = 21 + i * 5.5;
        ctx.beginPath();
        ctx.moveTo(fx, 40);
        ctx.lineTo(fx + 2.8, 50);
        ctx.lineTo(fx + 5.5, 40);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
      }
      break;
    }
    case 'invoker': {
      // Imposing Wave 20 Floating Arcane Obsidian Construct Boss!
      ctx.strokeStyle = '#a855f7';
      ctx.lineWidth = 3.5;
      ctx.beginPath();
      ctx.arc(32, 32, 27, 0, Math.PI * 2);
      ctx.stroke();
      ctx.strokeStyle = '#f43f5e';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(32, 32, 21, 0, Math.PI * 2);
      ctx.stroke();
      ctx.strokeStyle = INK;
      ctx.lineWidth = 2.6;
      for (let i = 0; i < 4; i++) {
        const a = (i * Math.PI) / 2 + Math.PI / 4;
        drawStarPolygon(ctx, 32 + Math.cos(a) * 24, 32 + Math.sin(a) * 24, 4, 7.5, 3.5, a);
        ctx.fillStyle = '#f43f5e';
        ctx.fill();
        ctx.stroke();
      }
      ctx.beginPath();
      ctx.moveTo(32, 7);
      ctx.lineTo(51, 32);
      ctx.lineTo(32, 57);
      ctx.lineTo(13, 32);
      ctx.closePath();
      ctx.fillStyle = '#241438';
      ctx.fill();
      ctx.stroke();
      fillStrokeCircle(ctx, 32, 32, 10.5, '#ff2a6d', 3);
      fillStrokeCircle(ctx, 32, 32, 4.5, '#ffffff', 0);
      break;
    }

    // ==================== 8 DISTINCT ELITES ====================
    case 'butcher': {
      // Twin massive cleaver blades behind hulking crimson torso + gold crown
      ctx.fillStyle = '#cbd5e1';
      for (const dir of [-1, 1]) {
        roundRectPath(ctx, dir < 0 ? 4 : 49, 18, 11, 26, 2);
        ctx.fill();
        ctx.stroke();
      }
      roundRectPath(ctx, 13, 14, 38, 42, 11);
      ctx.fillStyle = '#b91c1c';
      ctx.fill();
      ctx.stroke();
      drawEnemyHorns(ctx, 16, 13, 12, '#facc15');
      // Butcher apron cross-strap
      ctx.fillStyle = '#450a0a';
      ctx.fillRect(16, 36, 32, 16);
      fillStrokeCircle(ctx, 24, 27, 4.2, '#fde047', 2);
      fillStrokeCircle(ctx, 40, 27, 4.2, '#fde047', 2);
      roundRectPath(ctx, 21, 38, 22, 8, 2);
      ctx.fillStyle = '#ffffff';
      ctx.fill();
      ctx.stroke();
      break;
    }
    case 'colossus': {
      // Towering obsidian-gold armored stone titan with magma chest core
      ctx.beginPath();
      ctx.moveTo(14, 16);
      ctx.lineTo(24, 8);
      ctx.lineTo(40, 8);
      ctx.lineTo(50, 16);
      ctx.lineTo(56, 38);
      ctx.lineTo(48, 56);
      ctx.lineTo(16, 56);
      ctx.lineTo(8, 38);
      ctx.closePath();
      ctx.fillStyle = '#334155';
      ctx.fill();
      ctx.stroke();
      drawEnemyHorns(ctx, 12, 12, 10, '#facc15');
      fillStrokeCircle(ctx, 32, 41, 8.5, '#f97316', 2.6);
      fillStrokeCircle(ctx, 32, 41, 4, '#fef08a', 0);
      fillStrokeCircle(ctx, 23, 24, 4, '#fde047', 2);
      fillStrokeCircle(ctx, 41, 24, 4, '#fde047', 2);
      break;
    }
    case 'croc': {
      // Savage emerald-crimson armored crocodile behemoth with snapping jaws
      roundRectPath(ctx, 11, 16, 42, 36, 12);
      ctx.fillStyle = '#15803d';
      ctx.fill();
      ctx.stroke();
      // Gold dorsal crown spines
      ctx.fillStyle = '#facc15';
      for (const sx of [20, 32, 44]) {
        ctx.beginPath();
        ctx.moveTo(sx - 5, 16);
        ctx.lineTo(sx, 6);
        ctx.lineTo(sx + 5, 16);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
      }
      fillStrokeCircle(ctx, 22, 26, 4.5, '#ef4444', 2);
      fillStrokeCircle(ctx, 42, 26, 4.5, '#ef4444', 2);
      // Snapping zigzag croc jaws
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.moveTo(16, 38);
      for (let i = 0; i < 4; i++) {
        ctx.lineTo(20 + i * 8, 47);
        ctx.lineTo(24 + i * 8, 38);
      }
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      break;
    }
    case 'gargoyle': {
      // Winged slate-violet stone demon with bat wings & gold horns
      ctx.fillStyle = '#581c87';
      for (const dir of [-1, 1]) {
        ctx.beginPath();
        ctx.moveTo(32 + dir * 12, 28);
        ctx.lineTo(32 + dir * 29, 12);
        ctx.lineTo(32 + dir * 26, 36);
        ctx.lineTo(32 + dir * 18, 33);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
      }
      fillStrokeCircle(ctx, 32, 35, 17, '#64748b', 3.2);
      drawEnemyHorns(ctx, 20, 10, 12, '#facc15');
      fillStrokeCircle(ctx, 25, 32, 4.2, '#f43f5e', 2);
      fillStrokeCircle(ctx, 39, 32, 4.2, '#f43f5e', 2);
      break;
    }
    case 'mantis': {
      // Lethal armored cyber-mantis with massive dual scythe arms
      ctx.fillStyle = '#bef264';
      for (const dir of [-1, 1]) {
        ctx.beginPath();
        ctx.moveTo(32 + dir * 13, 30);
        ctx.lineTo(32 + dir * 28, 16);
        ctx.lineTo(32 + dir * 23, 44);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
      }
      ctx.beginPath();
      ctx.moveTo(32, 12);
      ctx.lineTo(48, 28);
      ctx.lineTo(40, 54);
      ctx.lineTo(24, 54);
      ctx.lineTo(16, 28);
      ctx.closePath();
      ctx.fillStyle = '#16a34a';
      ctx.fill();
      ctx.stroke();
      drawEnemyHorns(ctx, 14, 8, 10, '#facc15');
      fillStrokeCircle(ctx, 25, 28, 4.5, '#fde047', 2);
      fillStrokeCircle(ctx, 39, 28, 4.5, '#fde047', 2);
      break;
    }
    case 'mom': {
      // Terrifying Brood Queen with spiked gold crown & glowing egg belly
      fillStrokeCircle(ctx, 32, 36, 21, '#9d174d', 3.2);
      drawEnemyHorns(ctx, 17, 13, 12, '#facc15');
      // Glowing brood pods
      fillStrokeCircle(ctx, 23, 42, 5.5, '#f472b6', 2);
      fillStrokeCircle(ctx, 32, 46, 5.5, '#f472b6', 2);
      fillStrokeCircle(ctx, 41, 42, 5.5, '#f472b6', 2);
      fillStrokeCircle(ctx, 24, 27, 4.5, '#fef08a', 2);
      fillStrokeCircle(ctx, 40, 27, 4.5, '#fef08a', 2);
      break;
    }
    case 'monk': {
      // Levitating arcane mystic with golden halo & orbiting shield orbs
      ctx.strokeStyle = '#facc15';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(32, 32, 25, 0, Math.PI * 2);
      ctx.stroke();
      ctx.strokeStyle = INK;
      ctx.beginPath();
      ctx.moveTo(32, 10);
      ctx.lineTo(48, 52);
      ctx.lineTo(16, 52);
      ctx.closePath();
      ctx.fillStyle = '#4338ca';
      ctx.fill();
      ctx.stroke();
      fillStrokeCircle(ctx, 32, 24, 11, '#facc15', 2.8);
      fillStrokeCircle(ctx, 28, 24, 2.8, '#22d3ee', 1.5);
      fillStrokeCircle(ctx, 36, 24, 2.8, '#22d3ee', 1.5);
      fillStrokeCircle(ctx, 11, 32, 4.5, '#38bdf8', 2);
      fillStrokeCircle(ctx, 53, 32, 4.5, '#38bdf8', 2);
      break;
    }
    case 'rhino': {
      // Massive crimson armored stampede beast with giant ivory nose horn
      roundRectPath(ctx, 10, 15, 44, 40, 12);
      ctx.fillStyle = '#b91c1c';
      ctx.fill();
      ctx.stroke();
      drawEnemyHorns(ctx, 16, 15, 11, '#facc15');
      // Giant central ivory rhino horn
      ctx.beginPath();
      ctx.moveTo(26, 36);
      ctx.lineTo(32, 13);
      ctx.lineTo(38, 36);
      ctx.closePath();
      ctx.fillStyle = '#fef3c7';
      ctx.fill();
      ctx.stroke();
      fillStrokeCircle(ctx, 21, 31, 4, '#fde047', 2);
      fillStrokeCircle(ctx, 43, 31, 4, '#fde047', 2);
      break;
    }

    // ==================== 28 BASIC CRASH ZONE ENEMIES ====================
    case 'baby_alien': {
      fillStrokeCircle(ctx, 32, 34, 18, '#c048d8', 3.2);
      ctx.beginPath();
      ctx.moveTo(24, 17);
      ctx.lineTo(19, 9);
      ctx.moveTo(40, 17);
      ctx.lineTo(45, 9);
      ctx.stroke();
      fillStrokeCircle(ctx, 19, 9, 3.2, '#facc15', 2);
      fillStrokeCircle(ctx, 45, 9, 3.2, '#facc15', 2);
      fillStrokeCircle(ctx, 25, 31, 4.2, '#fef08a', 2);
      fillStrokeCircle(ctx, 39, 31, 4.2, '#fef08a', 2);
      fillStrokeCircle(ctx, 25, 31, 1.8, INK, 0);
      fillStrokeCircle(ctx, 39, 31, 1.8, INK, 0);
      break;
    }
    case 'chaser': {
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
    case 'spitter':
    case 'horned_spitter': {
      const horned = key === 'horned_spitter';
      fillStrokeCircle(ctx, 32, 36, 18.5, horned ? '#be123c' : '#e11d48', 3.2);
      if (horned) drawEnemyHorns(ctx, 19, 11, 12, '#fef08a');
      fillStrokeCircle(ctx, 16, 40, 6.8, '#fb923c', 2.4);
      fillStrokeCircle(ctx, 48, 40, 6.8, '#fb923c', 2.4);
      fillStrokeCircle(ctx, 32, 40, 6, horned ? '#bef264' : '#ffe4e6', 2.4);
      fillStrokeCircle(ctx, 24, 27, 3.5, '#fef08a', 2);
      fillStrokeCircle(ctx, 40, 27, 3.5, '#fef08a', 2);
      break;
    }
    case 'charger':
    case 'horned_charger': {
      const horned = key === 'horned_charger';
      ctx.fillStyle = horned ? '#dc2626' : '#f97316';
      ctx.beginPath();
      ctx.moveTo(32, 13);
      ctx.lineTo(52, 36);
      ctx.lineTo(44, 53);
      ctx.lineTo(20, 53);
      ctx.lineTo(12, 36);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      drawEnemyHorns(ctx, 21, 12, horned ? 16 : 11, horned ? '#fde047' : '#fef3c7');
      if (horned) {
        ctx.beginPath();
        ctx.moveTo(28, 22);
        ctx.lineTo(32, 7);
        ctx.lineTo(36, 22);
        ctx.closePath();
        ctx.fillStyle = '#fef3c7';
        ctx.fill();
        ctx.stroke();
      }
      fillStrokeCircle(ctx, 25, 36, 3.8, '#fef08a', 2);
      fillStrokeCircle(ctx, 39, 36, 3.8, '#fef08a', 2);
      break;
    }
    case 'bruiser':
    case 'horned_bruiser': {
      const horned = key === 'horned_bruiser';
      roundRectPath(ctx, 10, 14, 44, 41, 10);
      ctx.fillStyle = horned ? '#7e22ce' : '#4f46e5';
      ctx.fill();
      ctx.stroke();
      if (horned) drawEnemyHorns(ctx, 15, 14, 13, '#fef3c7');
      roundRectPath(ctx, 17, 35, 30, 14, 4);
      ctx.fillStyle = horned ? '#cbd5e1' : '#94a3b8';
      ctx.fill();
      ctx.stroke();
      fillStrokeCircle(ctx, 23, 25, 4.2, '#f97316', 2);
      fillStrokeCircle(ctx, 41, 25, 4.2, '#f97316', 2);
      break;
    }
    case 'fly':
    case 'horned_fly': {
      const horned = key === 'horned_fly';
      ctx.fillStyle = horned ? 'rgba(253, 224, 71, 0.78)' : 'rgba(203, 245, 255, 0.8)';
      ctx.beginPath();
      ctx.ellipse(15, 26, 12, 7, -0.45, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.beginPath();
      ctx.ellipse(49, 26, 12, 7, 0.45, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = horned ? '#15803d' : '#84cc16';
      ctx.beginPath();
      ctx.ellipse(32, 36, 11.5, 16, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      if (horned) drawEnemyHorns(ctx, 21, 7, 11, '#fde047');
      fillStrokeCircle(ctx, 27, 29, 4.5, '#ef4444', 2);
      fillStrokeCircle(ctx, 37, 29, 4.5, '#ef4444', 2);
      break;
    }
    case 'junkie':
    case 'dire_junkie': {
      const dire = key === 'dire_junkie';
      ctx.fillStyle = dire ? '#9f1239' : '#a21caf';
      ctx.beginPath();
      ctx.ellipse(32, 36, dire ? 19 : 16, 19, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      if (dire) drawEnemyHorns(ctx, 18, 10, 11, '#f43f5e');
      fillStrokeCircle(ctx, 24, 30, 5.2, '#ffffff', 2.2);
      fillStrokeCircle(ctx, 40, 32, 3.8, '#ffffff', 2.2);
      fillStrokeCircle(ctx, 25, 31, 2, '#ef4444', 0);
      fillStrokeCircle(ctx, 39, 31, 1.8, '#ef4444', 0);
      ctx.beginPath();
      ctx.moveTo(22, 43);
      ctx.quadraticCurveTo(32, 49, 42, 42);
      ctx.stroke();
      break;
    }
    case 'evil_mob': {
      // Snarling pack fiend with pointy goblin ears
      ctx.fillStyle = '#be185d';
      for (const dir of [-1, 1]) {
        ctx.beginPath();
        ctx.moveTo(32 + dir * 11, 24);
        ctx.lineTo(32 + dir * 25, 14);
        ctx.lineTo(32 + dir * 16, 34);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
      }
      fillStrokeCircle(ctx, 32, 35, 16, '#db2777', 3.2);
      fillStrokeCircle(ctx, 26, 31, 3.8, '#fde047', 2);
      fillStrokeCircle(ctx, 38, 31, 3.8, '#fde047', 2);
      ctx.fillStyle = '#ffffff';
      roundRectPath(ctx, 24, 39, 16, 6, 2);
      ctx.fill();
      ctx.stroke();
      break;
    }
    case 'fin_alien': {
      // Sleek shark-finned aquatic teal-indigo alien
      ctx.fillStyle = '#0891b2';
      ctx.beginPath();
      ctx.moveTo(26, 20);
      ctx.lineTo(33, 6);
      ctx.lineTo(42, 22);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      fillStrokeCircle(ctx, 32, 36, 18, '#0e7490', 3.2);
      fillStrokeCircle(ctx, 24, 32, 4, '#67e8f9', 2);
      fillStrokeCircle(ctx, 40, 32, 4, '#67e8f9', 2);
      ctx.beginPath();
      ctx.moveTo(23, 43);
      ctx.lineTo(41, 43);
      ctx.stroke();
      break;
    }
    case 'helmet_alien': {
      fillStrokeCircle(ctx, 32, 36, 17, '#c048d8', 3.2);
      // Heavy steel combat dome helmet
      ctx.fillStyle = '#94a3b8';
      ctx.beginPath();
      ctx.arc(32, 32, 19, Math.PI, Math.PI * 2);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      roundRectPath(ctx, 18, 29, 28, 7, 2);
      ctx.fillStyle = '#1e293b';
      ctx.fill();
      ctx.stroke();
      fillStrokeCircle(ctx, 25, 32.5, 2.5, '#ef4444', 0);
      fillStrokeCircle(ctx, 39, 32.5, 2.5, '#ef4444', 0);
      break;
    }
    case 'slasher':
    case 'mad_slasher': {
      const mad = key === 'mad_slasher';
      // Dual curved sickle foreblades
      ctx.fillStyle = mad ? '#fde047' : '#e2e8f0';
      for (const dir of [-1, 1]) {
        ctx.beginPath();
        ctx.moveTo(32 + dir * 13, 30);
        ctx.lineTo(32 + dir * 28, 17);
        ctx.lineTo(32 + dir * 22, 40);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
      }
      ctx.beginPath();
      ctx.moveTo(32, 14);
      ctx.lineTo(46, 34);
      ctx.lineTo(32, 54);
      ctx.lineTo(18, 34);
      ctx.closePath();
      ctx.fillStyle = mad ? '#dc2626' : '#7f1d1d';
      ctx.fill();
      ctx.stroke();
      fillStrokeCircle(ctx, 26, 30, 3.8, mad ? '#fef08a' : '#ff5252', 2);
      fillStrokeCircle(ctx, 38, 30, 3.8, mad ? '#fef08a' : '#ff5252', 2);
      break;
    }
    case 'slasher_egg':
    case 'infected_slasher_egg':
    case 'egg': {
      const infected = key === 'infected_slasher_egg';
      ctx.fillStyle = infected ? '#4d7c0f' : '#db2777';
      ctx.beginPath();
      ctx.ellipse(32, 35, 17, 21, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      // Organic cracks / glowing spores
      ctx.strokeStyle = infected ? '#bef264' : '#fbcfe8';
      ctx.lineWidth = 2.4;
      ctx.beginPath();
      ctx.moveTo(22, 28);
      ctx.lineTo(31, 35);
      ctx.lineTo(42, 30);
      ctx.moveTo(31, 35);
      ctx.lineTo(28, 46);
      ctx.stroke();
      fillStrokeCircle(ctx, 32, 24, 4.5, infected ? '#a3e635' : '#f472b6', 1.8);
      break;
    }
    case 'spawner':
    case 'bloated_spawner': {
      const bloated = key === 'bloated_spawner';
      ctx.fillStyle = bloated ? '#701a75' : '#9d174d';
      ctx.beginPath();
      ctx.ellipse(32, 35, bloated ? 22 : 18, bloated ? 23 : 21, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      fillStrokeCircle(ctx, 23, 29, 5.2, bloated ? '#e879f9' : '#f472b6', 2);
      fillStrokeCircle(ctx, 40, 34, 5.8, bloated ? '#e879f9' : '#f472b6', 2);
      fillStrokeCircle(ctx, 29, 44, 4.8, bloated ? '#fde047' : '#f472b6', 2);
      if (bloated) fillStrokeCircle(ctx, 35, 22, 4.2, '#fde047', 2);
      break;
    }
    case 'buffer':
    case 'corrupted_buffer': {
      const corrupt = key === 'corrupted_buffer';
      ctx.strokeStyle = corrupt ? '#ef4444' : '#c084fc';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(32, 32, 24, 0, Math.PI * 2);
      ctx.stroke();
      ctx.strokeStyle = INK;
      drawStarPolygon(ctx, 32, 32, corrupt ? 8 : 6, 18, 11);
      ctx.fillStyle = corrupt ? '#450a0a' : '#a855f7';
      ctx.fill();
      ctx.stroke();
      fillStrokeCircle(ctx, 32, 32, 6, corrupt ? '#f43f5e' : '#f0abfc', 2);
      break;
    }
    case 'healer': {
      ctx.strokeStyle = '#4ade80';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(32, 32, 24, 0, Math.PI * 2);
      ctx.stroke();
      ctx.strokeStyle = INK;
      fillStrokeCircle(ctx, 32, 33, 17, '#10b981', 3);
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(28, 23, 8, 20);
      ctx.fillRect(22, 29, 20, 8);
      break;
    }
    case 'lamprey': {
      // Wriggling crimson-violet eel-worm with toothed circular sucker maw
      ctx.strokeStyle = INK;
      ctx.lineWidth = 17;
      ctx.beginPath();
      ctx.moveTo(14, 48);
      ctx.quadraticCurveTo(22, 36, 32, 34);
      ctx.quadraticCurveTo(44, 32, 48, 20);
      ctx.stroke();
      ctx.strokeStyle = '#9f1239';
      ctx.lineWidth = 11;
      ctx.stroke();
      ctx.strokeStyle = INK;
      ctx.lineWidth = 2.8;
      fillStrokeCircle(ctx, 47, 20, 8.5, '#f43f5e', 2.8);
      fillStrokeCircle(ctx, 47, 20, 4.2, '#fef08a', 1.8);
      break;
    }
    case 'pursuer': {
      // Streamlined dark-crimson accelerator hound with swept jet-fins
      ctx.fillStyle = '#991b1b';
      ctx.beginPath();
      ctx.moveTo(32, 9);
      ctx.lineTo(52, 42);
      ctx.lineTo(42, 52);
      ctx.lineTo(32, 44);
      ctx.lineTo(22, 52);
      ctx.lineTo(12, 42);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      fillStrokeCircle(ctx, 26, 30, 3.8, '#38bdf8', 2);
      fillStrokeCircle(ctx, 38, 30, 3.8, '#38bdf8', 2);
      break;
    }
    case 'tentacle': {
      // Emerging coiled alien tentacle with suckers & glaring eye-tip
      ctx.strokeStyle = INK;
      ctx.lineWidth = 18;
      ctx.beginPath();
      ctx.moveTo(28, 55);
      ctx.bezierCurveTo(14, 40, 48, 30, 32, 14);
      ctx.stroke();
      ctx.strokeStyle = '#a855f7';
      ctx.lineWidth = 12;
      ctx.stroke();
      ctx.strokeStyle = INK;
      ctx.lineWidth = 2.4;
      fillStrokeCircle(ctx, 24, 43, 3.5, '#f472b6', 1.8);
      fillStrokeCircle(ctx, 39, 31, 3.5, '#f472b6', 1.8);
      fillStrokeCircle(ctx, 32, 15, 7, '#fde047', 2.4);
      fillStrokeCircle(ctx, 32, 15, 2.8, INK, 0);
      break;
    }
    case 'looter': {
      // Golden treasure goblin alien hoisting a bulging glittering coin sack
      fillStrokeCircle(ctx, 43, 38, 13.5, '#eab308', 3);
      fillStrokeCircle(ctx, 25, 34, 15, '#f59e0b', 3);
      fillStrokeCircle(ctx, 21, 30, 3.5, '#ffffff', 2);
      fillStrokeCircle(ctx, 31, 30, 3.5, '#ffffff', 2);
      fillStrokeCircle(ctx, 43, 38, 5, '#fef08a', 1.8);
      drawStarPolygon(ctx, 46, 17, 4, 8.5, 3);
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

  // Player & ALL 60 Base Characters from oracle.json
  bakeSprite('player_body', 64);
  bakeSprite('player_legs', 64);
  const initialChars = [
    'apprentice', 'archaeologist', 'arms_dealer', 'arsonist', 'artificer', 'baby',
    'beast_master', 'brawler', 'bull', 'caveman', 'chunky', 'crazy',
    'cryptid', 'cyborg', 'demon', 'doctor', 'droid', 'engineer',
    'entrepreneur', 'explorer', 'farmer', 'fisherman', 'generalist', 'ghost',
    'gladiator', 'glutton', 'golem', 'hunter', 'jack', 'king',
    'knight', 'lich', 'loud', 'lucky', 'mad_scientist', 'mage',
    'masochist', 'multitasker', 'mutant', 'old', 'one_arm', 'pacifist',
    'poacher', 'ranger', 'renegade', 'saver', 'sick', 'soldier',
    'speedy', 'streamer', 'survivor', 'technomage', 'time_shifter', 'vagabond',
    'vampire', 'variant', 'veteran', 'well_rounded', 'wildling', 'wounded',
  ];
  for (const c of initialChars) bakeSprite(`char_${c}`, 64);
  aliasRegion('char_one_armed', 'char_one_arm');

  // ALL 80 Base Weapons from oracle.json
  const initialWeapons = [
    'awl', 'bloody_vorpal', 'blowgun', 'boomerang', 'cacti_club', 'carbon_bow',
    'cestus', 'chain_gun', 'chopper', 'circular_saw', 'claw', 'combat_shotgun',
    'crossbow', 'crowbar', 'dagger', 'dextroyer', 'double_barrel_shotgun', 'drill',
    'excalibur', 'fighting_stick', 'fireball', 'fist', 'flail', 'flamethrower',
    'flaming_brass_knuckles', 'gatling_laser', 'ghost_axe', 'ghost_flint', 'ghost_scepter', 'hammer',
    'hand', 'hatchet', 'icicle', 'jousting_lance', 'knife', 'knuckles',
    'laser_gun', 'light_saber', 'lightning_shiv', 'machinegun', 'meat_tenderizer', 'medical_gun',
    'minigun', 'molotov', 'nuclear_launcher', 'obliterator', 'pan_flute', 'particle_accelerator',
    'pistol', 'plank', 'plasma_sledgehammer', 'potato_thrower', 'power_fist', 'pruner',
    'rail_gun', 'revolver', 'rock', 'rocket_launcher', 'scissors', 'screwdriver',
    'scythe', 'sharp_tooth', 'shovel', 'shredder', 'shuriken', 'slingshot',
    'smg', 'sniper_gun', 'spear', 'spiky_shield', 'stick', 'sticky_grenade',
    'sword', 'taser', 'thunder_sword', 'torch', 'tranq_rifle', 'wand',
    'whip', 'wrench',
  ];
  for (const w of initialWeapons) bakeSprite(`weapon_${w}`, 64);
  aliasRegion('weapon_cactus_mace', 'weapon_cacti_club');
  aliasRegion('weapon_flaming_knuckles', 'weapon_flaming_brass_knuckles');
  aliasRegion('weapon_vorpal_sword', 'weapon_bloody_vorpal');

  // ALL 36 Crash Zone Basic (28) + Elites (8) (2 Bosses baked at 128x128 above -> 38 total!)
  const initialEnemies = [
    'baby_alien', 'bloated_spawner', 'bruiser', 'buffer', 'charger', 'chaser',
    'corrupted_buffer', 'dire_junkie', 'evil_mob', 'fin_alien', 'fly', 'healer',
    'helmet_alien', 'horned_bruiser', 'horned_charger', 'horned_fly', 'horned_spitter',
    'infected_slasher_egg', 'junkie', 'lamprey', 'looter', 'mad_slasher',
    'pursuer', 'slasher', 'slasher_egg', 'spawner', 'spitter', 'tentacle',
    'butcher', 'colossus', 'croc', 'gargoyle', 'mantis', 'mom', 'monk', 'rhino',
  ];
  for (const e of initialEnemies) bakeSprite(`enemy_${e}`, 64);
  aliasRegion('enemy_egg', 'enemy_slasher_egg');

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
