// ============================================================================
// tools/oracle-dump.ts — Strictly READ-ONLY Godot GDPC v1 Oracle Dumper
// Parses plain-text .tres / .tscn resources from local Brotato.pck into
// .krunkedtato-assets/oracle.json. Never writes inside Steam.
// ============================================================================

import fs from 'node:fs';
import path from 'node:path';
import {
  ARENA_H,
  ARENA_TILES_H,
  ARENA_TILES_W,
  ARENA_W,
  BASE_FRUIT_HEAL,
  BASE_HARVESTING_GROWTH,
  CORE_STAT_KEYS,
  EDGE_MAP_DIST,
  EDGE_SIZE,
  ENDLESS_HARVESTING_DECAY,
  END_WAVE_TICKS,
  FIXED_DT,
  HARVEST_TICKS,
  LIFESTEAL_COOLDOWN_TICKS,
  MAX_ENEMIES,
  MAX_GOLDS,
  MAX_IFRAMES_TICKS,
  MIN_IFRAMES_TICKS,
  MIN_SWEEP_DISTANCE,
  MIN_WEAPON_COOLDOWN,
  MIN_WEAPON_RANGE,
  NB_SHOP_ITEMS,
  PLAYER_BASE_MAX_HP,
  PLAYER_BASE_SPEED,
  PLAYER_DEFAULT_DODGE_CAP,
  PLAYER_DEFAULT_WEAPON_SLOTS,
  RARITY_COLORS,
  RARITY_NAMES,
  REF_HEIGHT,
  REF_WIDTH,
  SIM_HZ,
  SPAWN_TELEGRAPH_TICKS,
  TILE_SIZE,
  WAVE_DURATIONS_SEC,
  type CoreStatKey,
} from '../src/contracts/index';

const DEFAULT_PCK_PATH =
  'C:\\Program Files (x86)\\Steam\\steamapps\\common\\Brotato\\Brotato.pck';
const OUTPUT_DIR = path.resolve(process.cwd(), '.krunkedtato-assets');
const OUTPUT_PATH = path.join(OUTPUT_DIR, 'oracle.json');

// ----------------------------------------------------------------------------
// GDPC v1 Reader (Strictly Read-Only)
// ----------------------------------------------------------------------------

interface PckEntry {
  path: string;
  offset: number;
  size: number;
  md5: string;
}

interface PckHeader {
  magic: string;
  formatVer: number;
  godotVersion: string;
  fileCount: number;
}

class ReadOnlyPckArchive {
  private readonly fd: number;
  public readonly header: PckHeader;
  public readonly entries: PckEntry[] = [];
  public readonly byPath = new Map<string, PckEntry>();

  constructor(pckPath: string) {
    this.fd = fs.openSync(pckPath, 'r');
    const stat = fs.fstatSync(this.fd);
    const hdr = this.readSlice(0, 88);
    const magic = hdr.subarray(0, 4).toString('ascii');
    if (magic !== 'GDPC') {
      fs.closeSync(this.fd);
      throw new Error(`Unexpected PCK magic "${magic}" (expected "GDPC")`);
    }
    const formatVer = hdr.readUInt32LE(4);
    const maj = hdr.readUInt32LE(8);
    const min = hdr.readUInt32LE(12);
    const pat = hdr.readUInt32LE(16);
    const fileCount = hdr.readUInt32LE(84);

    this.header = {
      magic,
      formatVer,
      godotVersion: `${maj}.${min}.${pat}`,
      fileCount,
    };

    // Stream TOC sequentially from offset 88 in generous chunks
    const chunkSize = 4 * 1024 * 1024;
    let filePos = 88;
    let buf = this.readSlice(filePos, Math.min(chunkSize, stat.size - filePos));
    let cursor = 0;

    const ensureBytes = (needed: number): void => {
      if (cursor + needed <= buf.length) return;
      const remaining = buf.subarray(cursor);
      filePos += cursor;
      const toRead = Math.min(
        Math.max(chunkSize, needed),
        stat.size - (filePos + remaining.length)
      );
      if (toRead <= 0) {
        buf = remaining;
        cursor = 0;
        return;
      }
      const nextChunk = this.readSlice(filePos + remaining.length, toRead);
      buf = Buffer.concat([remaining, nextChunk]);
      cursor = 0;
    };

    for (let i = 0; i < fileCount; i++) {
      ensureBytes(4);
      const pathLen = buf.readUInt32LE(cursor);
      cursor += 4;
      ensureBytes(pathLen + 32);
      const rawPath = buf
        .subarray(cursor, cursor + pathLen)
        .toString('utf8')
        .replace(/\0+$/, '');
      cursor += pathLen;
      const offset = Number(buf.readBigUInt64LE(cursor));
      cursor += 8;
      const size = Number(buf.readBigUInt64LE(cursor));
      cursor += 8;
      const md5 = buf.subarray(cursor, cursor + 16).toString('hex');
      cursor += 16;

      const entry: PckEntry = { path: rawPath, offset, size, md5 };
      this.entries.push(entry);
      this.byPath.set(rawPath, entry);
    }
  }

  private readSlice(offset: number, length: number): Buffer {
    const buf = Buffer.allocUnsafe(length);
    let totalRead = 0;
    while (totalRead < length) {
      const n = fs.readSync(this.fd, buf, totalRead, length - totalRead, offset + totalRead);
      if (n === 0) break;
      totalRead += n;
    }
    return totalRead === length ? buf : buf.subarray(0, totalRead);
  }

  public readBytes(resPath: string): Buffer | null {
    const entry = this.byPath.get(resPath);
    if (!entry) return null;
    return this.readSlice(entry.offset, entry.size);
  }

  public readText(resPath: string): string | null {
    const buf = this.readBytes(resPath);
    return buf ? buf.toString('utf8') : null;
  }

  public close(): void {
    fs.closeSync(this.fd);
  }
}

// ----------------------------------------------------------------------------
// Godot Plain-Text .tres / .tscn Parser
// ----------------------------------------------------------------------------

interface ExtRef {
  __ext: string;
  path: string;
  type: string;
}

interface SubRef {
  __sub: string;
}

type GodotValue =
  | string
  | number
  | boolean
  | null
  | ExtRef
  | SubRef
  | { __vec2: [number, number] }
  | { __color: [number, number, number, number] }
  | { __rect2: [number, number, number, number] }
  | GodotValue[]
  | Record<string, unknown>;

interface ParsedGodotResource {
  extResources: Map<string, { path: string; type: string }>;
  subResources: Map<string, { type: string; props: Record<string, GodotValue> }>;
  resourceProps: Record<string, GodotValue>;
  nodes: Array<{
    name: string;
    parent?: string;
    type?: string;
    instance?: ExtRef;
    props: Record<string, GodotValue>;
  }>;
}

function isExtRef(v: unknown): v is ExtRef {
  return typeof v === 'object' && v !== null && '__ext' in v;
}

function isSubRef(v: unknown): v is SubRef {
  return typeof v === 'object' && v !== null && '__sub' in v;
}

function parseGodotValue(
  raw: string,
  extMap: Map<string, { path: string; type: string }>
): GodotValue {
  let idx = 0;
  const s = raw.trim();

  const skipWs = (): void => {
    while (idx < s.length && /\s/.test(s[idx])) idx++;
  };

  const parseExpr = (): GodotValue => {
    skipWs();
    if (idx >= s.length) return null;
    const ch = s[idx];

    // String literal
    if (ch === '"') {
      idx++;
      let out = '';
      while (idx < s.length) {
        const c = s[idx++];
        if (c === '\\' && idx < s.length) {
          const esc = s[idx++];
          if (esc === 'n') out += '\n';
          else if (esc === 't') out += '\t';
          else if (esc === 'r') out += '\r';
          else out += esc;
        } else if (c === '"') {
          break;
        } else {
          out += c;
        }
      }
      return out;
    }

    // Array literal
    if (ch === '[') {
      idx++;
      const arr: GodotValue[] = [];
      skipWs();
      while (idx < s.length && s[idx] !== ']') {
        arr.push(parseExpr());
        skipWs();
        if (s[idx] === ',') {
          idx++;
          skipWs();
        } else {
          break;
        }
      }
      if (s[idx] === ']') idx++;
      return arr;
    }

    // Dictionary literal
    if (ch === '{') {
      idx++;
      const obj: Record<string, unknown> = {};
      skipWs();
      while (idx < s.length && s[idx] !== '}') {
        const key = parseExpr();
        skipWs();
        if (s[idx] === ':') idx++;
        const val = parseExpr();
        obj[String(key)] = val;
        skipWs();
        if (s[idx] === ',') {
          idx++;
          skipWs();
        } else {
          break;
        }
      }
      if (s[idx] === '}') idx++;
      return obj;
    }

    // Read identifier / constructor / number / keyword
    const rest = s.slice(idx);

    const extMatch = rest.match(/^ExtResource\(\s*(\d+)\s*\)/);
    if (extMatch) {
      idx += extMatch[0].length;
      const extId = extMatch[1];
      const info = extMap.get(extId);
      return {
        __ext: extId,
        path: info?.path ?? '',
        type: info?.type ?? '',
      };
    }

    const subMatch = rest.match(/^SubResource\(\s*(\d+)\s*\)/);
    if (subMatch) {
      idx += subMatch[0].length;
      return { __sub: subMatch[1] };
    }

    const vec2Match = rest.match(/^Vector2\(\s*([^,]+),\s*([^)]+)\)/);
    if (vec2Match) {
      idx += vec2Match[0].length;
      return { __vec2: [Number(vec2Match[1]), Number(vec2Match[2])] };
    }

    const colorMatch = rest.match(/^Color\(\s*([^,]+),\s*([^,]+),\s*([^,]+),\s*([^)]+)\)/);
    if (colorMatch) {
      idx += colorMatch[0].length;
      return {
        __color: [
          Number(colorMatch[1]),
          Number(colorMatch[2]),
          Number(colorMatch[3]),
          Number(colorMatch[4]),
        ],
      };
    }

    const rectMatch = rest.match(/^Rect2\(\s*([^,]+),\s*([^,]+),\s*([^,]+),\s*([^)]+)\)/);
    if (rectMatch) {
      idx += rectMatch[0].length;
      return {
        __rect2: [
          Number(rectMatch[1]),
          Number(rectMatch[2]),
          Number(rectMatch[3]),
          Number(rectMatch[4]),
        ],
      };
    }

    // Generic constructor like PoolStringArray(...) / NodePath(...)
    const ctorMatch = rest.match(/^([A-Za-z_][A-Za-z0-9_]*)\(/);
    if (ctorMatch) {
      const name = ctorMatch[1];
      idx += ctorMatch[0].length;
      const args: GodotValue[] = [];
      skipWs();
      while (idx < s.length && s[idx] !== ')') {
        args.push(parseExpr());
        skipWs();
        if (s[idx] === ',') {
          idx++;
          skipWs();
        } else {
          break;
        }
      }
      if (s[idx] === ')') idx++;
      if (name === 'NodePath' && args.length === 1) return args[0];
      if (name.startsWith('Pool') && name.endsWith('Array')) return args;
      return { __ctor: name, args };
    }

    // Number
    const numMatch = rest.match(/^-?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/);
    if (numMatch) {
      idx += numMatch[0].length;
      return Number(numMatch[0]);
    }

    // Keywords
    const kwMatch = rest.match(/^(true|false|null|inf|nan)\b/);
    if (kwMatch) {
      idx += kwMatch[0].length;
      if (kwMatch[1] === 'true') return true;
      if (kwMatch[1] === 'false') return false;
      if (kwMatch[1] === 'inf') return Infinity;
      return null;
    }

    // Fallback bare token up to delimiter
    const tokMatch = rest.match(/^[^,\s\]})]+/);
    if (tokMatch) {
      idx += tokMatch[0].length;
      return tokMatch[0];
    }
    return null;
  };

  return parseExpr();
}

function parseGodotText(text: string): ParsedGodotResource {
  const extResources = new Map<string, { path: string; type: string }>();
  const subResources = new Map<string, { type: string; props: Record<string, GodotValue> }>();
  const resourceProps: Record<string, GodotValue> = {};
  const nodes: ParsedGodotResource['nodes'] = [];

  const lines = text.replace(/\r\n/g, '\n').split('\n');
  let currentProps: Record<string, GodotValue> | null = null;

  let i = 0;
  while (i < lines.length) {
    const line = lines[i].trim();
    i++;
    if (!line || line.startsWith(';')) continue;

    if (line.startsWith('[')) {
      currentProps = null;
      if (line.startsWith('[ext_resource ')) {
        const pathM = line.match(/path="([^"]+)"/);
        const typeM = line.match(/type="([^"]+)"/);
        const idM = line.match(/id=(\d+)/);
        if (pathM && idM) {
          extResources.set(idM[1], { path: pathM[1], type: typeM?.[1] ?? '' });
        }
      } else if (line.startsWith('[sub_resource ')) {
        const typeM = line.match(/type="([^"]+)"/);
        const idM = line.match(/id=(\d+)/);
        if (idM) {
          const entry = { type: typeM?.[1] ?? '', props: {} as Record<string, GodotValue> };
          subResources.set(idM[1], entry);
          currentProps = entry.props;
        }
      } else if (line === '[resource]') {
        currentProps = resourceProps;
      } else if (line.startsWith('[node ')) {
        const nameM = line.match(/name="([^"]+)"/);
        const parentM = line.match(/parent="([^"]+)"/);
        const typeM = line.match(/type="([^"]+)"/);
        const instM = line.match(/instance=ExtResource\(\s*(\d+)\s*\)/);
        const instId = instM?.[1];
        const instInfo = instId ? extResources.get(instId) : undefined;
        const nodeEntry = {
          name: nameM?.[1] ?? '',
          parent: parentM?.[1],
          type: typeM?.[1],
          instance: instId
            ? { __ext: instId, path: instInfo?.path ?? '', type: instInfo?.type ?? '' }
            : undefined,
          props: {} as Record<string, GodotValue>,
        };
        nodes.push(nodeEntry);
        currentProps = nodeEntry.props;
      }
      continue;
    }

    if (!currentProps) continue;
    const eqIdx = line.indexOf('=');
    if (eqIdx <= 0) continue;

    const key = line.slice(0, eqIdx).trim();
    let valStr = line.slice(eqIdx + 1).trim();

    // Accumulate multi-line brackets/braces if unclosed
    let depth = 0;
    let inQuotes = false;
    const countBrackets = (str: string): void => {
      for (let c = 0; c < str.length; c++) {
        const ch = str[c];
        if (ch === '\\' && inQuotes) {
          c++;
          continue;
        }
        if (ch === '"') inQuotes = !inQuotes;
        if (!inQuotes) {
          if (ch === '[' || ch === '{' || ch === '(') depth++;
          else if (ch === ']' || ch === '}' || ch === ')') depth--;
        }
      }
    };
    countBrackets(valStr);
    while (depth > 0 && i < lines.length) {
      const nextLine = lines[i++];
      valStr += '\n' + nextLine;
      countBrackets(nextLine);
    }

    currentProps[key] = parseGodotValue(valStr, extResources);
  }

  return { extResources, subResources, resourceProps, nodes };
}

// ----------------------------------------------------------------------------
// Helpers
// ----------------------------------------------------------------------------

function humanizeKey(raw: string, stripPrefixes: string[]): string {
  let clean = raw;
  for (const p of stripPrefixes) {
    if (clean.toUpperCase().startsWith(p.toUpperCase())) {
      clean = clean.slice(p.length);
      break;
    }
  }
  return clean
    .toLowerCase()
    .split('_')
    .filter(Boolean)
    .map((w) => w[0].toUpperCase() + w.slice(1))
    .join(' ');
}

function asNumber(v: unknown, fallback = 0): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
}

function asString(v: unknown, fallback = ''): string {
  return typeof v === 'string' ? v : fallback;
}

function asBool(v: unknown, fallback = false): boolean {
  return typeof v === 'boolean' ? v : fallback;
}

function getScriptPath(parsed: ParsedGodotResource): string {
  const s = parsed.resourceProps.script;
  return isExtRef(s) ? s.path : '';
}

interface ParsedEffect {
  sourcePath: string;
  script: string;
  key: string;
  value: number;
  textKey: string;
  customKey: string;
  effectSign: number;
  storageMethod: number;
  extra?: Record<string, unknown>;
}

const parsedTresCache = new Map<string, ParsedGodotResource | null>();
function loadTres(pck: ReadOnlyPckArchive, resPath: string): ParsedGodotResource | null {
  if (parsedTresCache.has(resPath)) return parsedTresCache.get(resPath) ?? null;
  const txt = pck.readText(resPath);
  const parsed = txt ? parseGodotText(txt) : null;
  parsedTresCache.set(resPath, parsed);
  return parsed;
}

function resolveEffect(pck: ReadOnlyPckArchive, ref: GodotValue): ParsedEffect | null {
  if (!isExtRef(ref) || !ref.path) return null;
  const effRes = loadTres(pck, ref.path);
  if (!effRes) return null;
  const p = effRes.resourceProps;
  const script = getScriptPath(effRes);

  const extra: Record<string, unknown> = {};
  const coreKeys = new Set([
    'script',
    'key',
    'text_key',
    'value',
    'custom_key',
    'storage_method',
    'effect_sign',
    'custom_args',
  ]);

  for (const [k, v] of Object.entries(p)) {
    if (coreKeys.has(k)) continue;
    if (k === 'burning_data' && isExtRef(v) && v.path) {
      const burnRes = loadTres(pck, v.path);
      if (burnRes) {
        extra.burningData = {
          chance: asNumber(burnRes.resourceProps.chance, 1),
          damage: asNumber(burnRes.resourceProps.damage, 0),
          duration: asNumber(burnRes.resourceProps.duration, 0),
          spread: asNumber(burnRes.resourceProps.spread, 0),
          scalingStats: Array.isArray(burnRes.resourceProps.scaling_stats)
            ? burnRes.resourceProps.scaling_stats
            : [],
        };
      }
    } else if (isExtRef(v)) {
      extra[k] = v.path;
    } else if (!isSubRef(v)) {
      extra[k] = v;
    }
  }

  return {
    sourcePath: ref.path,
    script: script.replace(/^res:\/\//, ''),
    key: asString(p.key),
    value: asNumber(p.value, 0),
    textKey: asString(p.text_key),
    customKey: asString(p.custom_key),
    effectSign: asNumber(p.effect_sign, 0),
    storageMethod: asNumber(p.storage_method, 0),
    ...(Object.keys(extra).length > 0 ? { extra } : {}),
  };
}

function resolveEffectsArray(pck: ReadOnlyPckArchive, val: GodotValue): ParsedEffect[] {
  if (!Array.isArray(val)) return [];
  const out: ParsedEffect[] = [];
  for (const item of val) {
    const eff = resolveEffect(pck, item);
    if (eff) out.push(eff);
  }
  return out;
}

// ----------------------------------------------------------------------------
// Main Oracle Extraction
// ----------------------------------------------------------------------------

function main(): void {
  const pckPath = process.env.KRUNKED_PCK_PATH || DEFAULT_PCK_PATH;
  if (!fs.existsSync(pckPath)) {
    console.log(
      `[oracle-dump] Local .pck archive not found at "${pckPath}". Skipping oracle dump (exit 0).`
    );
    process.exit(0);
  }

  const pck = new ReadOnlyPckArchive(pckPath);
  try {
    // 1. Base Characters (60 playable base characters under res://items/characters/)
    const characters: Array<{
      id: string;
      rawId: string;
      name: string;
      nameKey: string;
      unlockedByDefault: boolean;
      iconPath: string;
      startingWeapons: string[];
      startingItems: string[];
      wantedTags: string[];
      effects: ParsedEffect[];
    }> = [];

    for (const entry of pck.entries) {
      if (!entry.path.startsWith('res://items/characters/') || !entry.path.endsWith('.tres')) {
        continue;
      }
      const parsed = loadTres(pck, entry.path);
      if (!parsed || getScriptPath(parsed) !== 'res://items/characters/character_data.gd') {
        continue;
      }
      const p = parsed.resourceProps;
      const rawId = asString(p.my_id);
      const id = rawId.replace(/^character_/, '') || entry.path.split('/')[4];
      const nameKey = asString(p.name, `CHARACTER_${id.toUpperCase()}`);
      const iconPath = isExtRef(p.icon) ? p.icon.path : '';

      const startingWeapons: string[] = [];
      if (Array.isArray(p.starting_weapons)) {
        for (const wRef of p.starting_weapons) {
          if (isExtRef(wRef) && wRef.path) {
            const wParsed = loadTres(pck, wRef.path);
            const wId = wParsed
              ? asString(wParsed.resourceProps.weapon_id).replace(/^weapon_/, '')
              : '';
            if (wId) startingWeapons.push(wId);
          }
        }
      }

      const startingItems: string[] = [];
      if (Array.isArray(p.starting_items)) {
        for (const iRef of p.starting_items) {
          if (isExtRef(iRef) && iRef.path) {
            const iParsed = loadTres(pck, iRef.path);
            const iId = iParsed
              ? asString(iParsed.resourceProps.my_id).replace(/^item_/, '')
              : '';
            if (iId) startingItems.push(iId);
          }
        }
      }

      const wantedTags = Array.isArray(p.wanted_tags)
        ? p.wanted_tags.filter((t): t is string => typeof t === 'string')
        : [];

      characters.push({
        id,
        rawId,
        name: humanizeKey(nameKey, ['CHARACTER_']),
        nameKey,
        unlockedByDefault: asBool(p.unlocked_by_default, false),
        iconPath,
        startingWeapons,
        startingItems,
        wantedTags,
        effects: resolveEffectsArray(pck, p.effects),
      });
    }
    characters.sort((a, b) => a.id.localeCompare(b.id));

    // 2. Base Weapons (45 melee + 35 ranged = 80 base weapons, all tier variants)
    // Parse explosion base radius from res://projectiles/explosion.tscn
    let baseExplosionRadius = 147;
    const explosionTscn = loadTres(pck, 'res://projectiles/explosion.tscn');
    if (explosionTscn) {
      for (const sr of explosionTscn.subResources.values()) {
        if (sr.type === 'CircleShape2D' && typeof sr.props.radius === 'number') {
          baseExplosionRadius = Math.round(sr.props.radius);
          break;
        }
      }
    }

    interface ParsedWeaponTier {
      tier: 1 | 2 | 3 | 4;
      myId: string;
      value: number;
      cooldown: number;
      damage: number;
      accuracy: number;
      critChance: number;
      critDamage: number;
      minRange: number;
      maxRange: number;
      knockback: number;
      lifesteal: number;
      scalingStats: Array<[string, number]>;
      projectiles: number;
      projectileSpeed: number;
      piercing: number;
      piercingDamageReduction: number;
      bounce: number;
      bounceDamageReduction: number;
      explosionRadius: number;
      burnDamage: number;
      burnDuration: number;
      attackType: 0 | 1 | 2;
      recoil: number;
      recoilDuration: number;
      isHealing: boolean;
      effects: ParsedEffect[];
    }

    interface ParsedWeapon {
      id: string;
      rawId: string;
      name: string;
      nameKey: string;
      kind: 'melee' | 'ranged';
      sets: string[];
      iconPath: string;
      scenePath: string;
      unlockedByDefault: boolean;
      minTier: number;
      maxTier: number;
      tiers: Partial<Record<1 | 2 | 3 | 4, ParsedWeaponTier>>;
    }

    const weaponsById = new Map<string, ParsedWeapon>();
    let totalWeaponTierVariants = 0;

    for (const entry of pck.entries) {
      const m = entry.path.match(/^res:\/\/weapons\/(melee|ranged)\/([^/]+)\/.*\.tres$/);
      if (!m) continue;
      const parsed = loadTres(pck, entry.path);
      if (!parsed || getScriptPath(parsed) !== 'res://items/global/weapon_data.gd') {
        continue;
      }

      const kind = m[1] as 'melee' | 'ranged';
      const dirId = m[2];
      const p = parsed.resourceProps;
      const rawWeaponId =
        asString(p.weapon_id) || asString(p.my_id) || `weapon_${dirId}`;
      const id = rawWeaponId.replace(/^weapon_/, '') || dirId;
      const nameKey = asString(p.name, `WEAPON_${id.toUpperCase()}`);
      const tierNum = (Math.min(4, Math.max(1, asNumber(p.tier, 0) + 1))) as 1 | 2 | 3 | 4;

      const sets: string[] = [];
      if (Array.isArray(p.sets)) {
        for (const sRef of p.sets) {
          if (isExtRef(sRef) && sRef.path) {
            const setRes = loadTres(pck, sRef.path);
            const setId = setRes
              ? asString(setRes.resourceProps.my_id).replace(/^set_/, '')
              : '';
            if (setId) sets.push(setId);
          }
        }
      }

      const statsRes = isExtRef(p.stats) && p.stats.path ? loadTres(pck, p.stats.path) : null;
      const sp = statsRes?.resourceProps ?? {};

      const scalingStats: Array<[string, number]> = [];
      if (Array.isArray(sp.scaling_stats)) {
        for (const pair of sp.scaling_stats) {
          if (Array.isArray(pair) && pair.length >= 2) {
            scalingStats.push([asString(pair[0]), asNumber(pair[1], 0)]);
          }
        }
      }

      const tierEffects = resolveEffectsArray(pck, p.effects);
      let explosionRadius = 0;
      let burnDamage = 0;
      let burnDuration = 0;

      for (const eff of tierEffects) {
        if (
          eff.script.includes('exploding_effect') ||
          eff.key.includes('explode')
        ) {
          const scale = asNumber(eff.extra?.scale, 1.0);
          explosionRadius = Math.max(explosionRadius, Math.round(baseExplosionRadius * scale));
        }
        const bd = eff.extra?.burningData as
          | { damage?: number; duration?: number }
          | undefined;
        if (bd && typeof bd.damage === 'number') {
          burnDamage = Math.max(burnDamage, bd.damage);
          burnDuration = Math.max(burnDuration, bd.duration ?? 0);
        }
      }

      const rawAttackType = asNumber(sp.attack_type, 0);
      const alternateAttackType = asBool(sp.alternate_attack_type, false);
      const attackType: 0 | 1 | 2 = alternateAttackType
        ? 2
        : rawAttackType === 1
          ? 1
          : 0;

      const tierStats: ParsedWeaponTier = {
        tier: tierNum,
        myId: asString(p.my_id, `${rawWeaponId}_${tierNum}`),
        value: asNumber(p.value, 0),
        cooldown: asNumber(sp.cooldown, 60),
        damage: asNumber(sp.damage, 1),
        accuracy: asNumber(sp.accuracy, 1.0),
        critChance: asNumber(sp.crit_chance, 0),
        critDamage: asNumber(sp.crit_damage, 1.5),
        minRange: asNumber(sp.min_range, 0),
        maxRange: asNumber(sp.max_range, 150),
        knockback: asNumber(sp.knockback, 0),
        lifesteal: asNumber(sp.lifesteal, 0),
        scalingStats,
        projectiles: kind === 'ranged' ? asNumber(sp.nb_projectiles, 1) : 0,
        projectileSpeed: kind === 'ranged' ? asNumber(sp.projectile_speed, 0) : 0,
        piercing: kind === 'ranged' ? asNumber(sp.piercing, 0) : 0,
        piercingDamageReduction:
          kind === 'ranged' ? asNumber(sp.piercing_dmg_reduction, 0.5) : 0,
        bounce: kind === 'ranged' ? asNumber(sp.bounce, 0) : 0,
        bounceDamageReduction:
          kind === 'ranged' ? asNumber(sp.bounce_dmg_reduction, 0.5) : 0,
        explosionRadius,
        burnDamage,
        burnDuration,
        attackType,
        recoil: asNumber(sp.recoil, 25),
        recoilDuration: asNumber(sp.recoil_duration, 0.1),
        isHealing: asBool(sp.is_healing, false),
        effects: tierEffects,
      };

      let weapon = weaponsById.get(id);
      if (!weapon) {
        weapon = {
          id,
          rawId: rawWeaponId,
          name: humanizeKey(nameKey, ['WEAPON_']),
          nameKey,
          kind,
          sets,
          iconPath: isExtRef(p.icon) ? p.icon.path : '',
          scenePath: isExtRef(p.scene) ? p.scene.path : '',
          unlockedByDefault: asBool(p.unlocked_by_default, false),
          minTier: tierNum,
          maxTier: tierNum,
          tiers: {},
        };
        weaponsById.set(id, weapon);
      } else {
        weapon.minTier = Math.min(weapon.minTier, tierNum);
        weapon.maxTier = Math.max(weapon.maxTier, tierNum);
        if (!weapon.iconPath && isExtRef(p.icon)) weapon.iconPath = p.icon.path;
      }

      if (!weapon.tiers[tierNum]) {
        totalWeaponTierVariants++;
      }
      weapon.tiers[tierNum] = tierStats;
    }

    const weapons = [...weaponsById.values()].sort((a, b) => a.id.localeCompare(b.id));
    const meleeCount = weapons.filter((w) => w.kind === 'melee').length;
    const rangedCount = weapons.filter((w) => w.kind === 'ranged').length;

    // 3. Sets (17 weapon sets, bonuses for counts 2..6)
    const sets: Array<{
      id: string;
      rawId: string;
      name: string;
      nameKey: string;
      bonuses: Record<number, ParsedEffect[]>;
    }> = [];

    for (const entry of pck.entries) {
      if (!entry.path.startsWith('res://items/sets/') || !entry.path.endsWith('_set_data.tres')) {
        continue;
      }
      const parsed = loadTres(pck, entry.path);
      if (!parsed || getScriptPath(parsed) !== 'res://items/sets/set_data.gd') {
        continue;
      }
      const p = parsed.resourceProps;
      const rawId = asString(p.my_id);
      const id = rawId.replace(/^set_/, '');
      const nameKey = asString(p.name, `WEAPON_CLASS_${id.toUpperCase()}`);
      const bonuses: Record<number, ParsedEffect[]> = {};
      if (Array.isArray(p.set_bonuses)) {
        p.set_bonuses.forEach((tierArr, idx) => {
          bonuses[idx + 2] = resolveEffectsArray(pck, tierArr);
        });
      }
      sets.push({
        id,
        rawId,
        name: humanizeKey(nameKey, ['WEAPON_CLASS_']),
        nameKey,
        bonuses,
      });
    }
    sets.sort((a, b) => a.id.localeCompare(b.id));

    // 4. Items (base items in 00_base_game + free-update items in res://items/all/)
    interface ParsedItem {
      id: string;
      rawId: string;
      name: string;
      nameKey: string;
      bucket: string;
      tier: number;
      value: number;
      maxCount: number;
      tags: string[];
      unlockedByDefault: boolean;
      iconPath: string;
      effects: ParsedEffect[];
    }

    const baseItems: ParsedItem[] = [];
    const updateItems: ParsedItem[] = [];

    for (const entry of pck.entries) {
      if (!entry.path.startsWith('res://items/all/') || !entry.path.endsWith('.tres')) {
        continue;
      }
      const parsed = loadTres(pck, entry.path);
      if (!parsed || getScriptPath(parsed) !== 'res://items/global/item_data.gd') {
        continue;
      }
      const p = parsed.resourceProps;
      const bucket = entry.path.split('/')[4] ?? '00_base_game';
      const rawId = asString(p.my_id);
      const id = rawId.replace(/^item_/, '');
      const nameKey = asString(p.name, `ITEM_${id.toUpperCase()}`);
      const tags = Array.isArray(p.tags)
        ? p.tags.filter((t): t is string => typeof t === 'string')
        : [];

      const itemObj: ParsedItem = {
        id,
        rawId,
        name: humanizeKey(nameKey, ['ITEM_']),
        nameKey,
        bucket,
        tier: asNumber(p.tier, 0),
        value: asNumber(p.value, 0),
        maxCount: asNumber(p.max_nb, -1),
        tags,
        unlockedByDefault: asBool(p.unlocked_by_default, false),
        iconPath: isExtRef(p.icon) ? p.icon.path : '',
        effects: resolveEffectsArray(pck, p.effects),
      };

      if (bucket === '00_base_game') {
        baseItems.push(itemObj);
      } else {
        updateItems.push(itemObj);
      }
    }
    baseItems.sort((a, b) => a.id.localeCompare(b.id));
    updateItems.sort((a, b) => a.id.localeCompare(b.id));

    // 5. Upgrades (16 core stats x 4 tiers = 64 entries)
    const coreStatSet = new Set<string>(CORE_STAT_KEYS);
    const statKeyAliases: Record<string, CoreStatKey> = {
      stat_hp_regeneration: 'stat_hp_regen',
    };
    const upgrades: Array<{
      id: string;
      statKey: CoreStatKey;
      rawStatKey: string;
      name: string;
      nameKey: string;
      tier: number;
      value: number;
      iconPath: string;
      effects: ParsedEffect[];
    }> = [];

    for (const entry of pck.entries) {
      if (!entry.path.startsWith('res://items/upgrades/') || !entry.path.endsWith('_data.tres')) {
        continue;
      }
      const parsed = loadTres(pck, entry.path);
      if (!parsed || getScriptPath(parsed) !== 'res://items/upgrades/upgrade_data.gd') {
        continue;
      }
      const p = parsed.resourceProps;
      const effects = resolveEffectsArray(pck, p.effects);
      const rawStatKey = effects[0]?.key ?? '';
      const normalizedStatKey = statKeyAliases[rawStatKey] ?? rawStatKey;
      if (!coreStatSet.has(normalizedStatKey)) continue;

      const id = asString(p.my_id);
      const nameKey = asString(
        p.name,
        `UPGRADE_${normalizedStatKey.replace(/^stat_/, '').toUpperCase()}`
      );
      upgrades.push({
        id,
        statKey: normalizedStatKey as CoreStatKey,
        rawStatKey,
        name: humanizeKey(nameKey, ['UPGRADE_']),
        nameKey,
        tier: asNumber(p.tier, 0),
        value: effects[0]?.value ?? asNumber(p.value, 0),
        iconPath: isExtRef(p.icon) ? p.icon.path : '',
        effects,
      });
    }
    upgrades.sort((a, b) =>
      a.statKey === b.statKey ? a.tier - b.tier : a.statKey.localeCompare(b.statKey)
    );

    // 6. Crash Zone Enemies (28 basic + 8 elites + 2 bosses = 38)
    const baseEnemyTscn = loadTres(pck, 'res://entities/units/enemies/enemy.tscn');
    const baseEnemySprite =
      [...(baseEnemyTscn?.extResources.values() ?? [])].find((e) => e.path.endsWith('.png'))
        ?.path ?? 'res://entities/units/enemies/crash_zone/basic/baby_alien/baby_alien.png';

    const enemies: Array<{
      id: string;
      kind: 'basic' | 'elite' | 'boss';
      scenePath: string;
      hp: number;
      hpPerWave: number;
      damage: number;
      damagePerWave: number;
      speed: number;
      speedRandomization: number;
      radius: number;
      knockbackResistance: number;
      armor: number;
      armorPerWave: number;
      dropStats: {
        value: number;
        goldSpread: number;
        canDropConsumables: boolean;
        alwaysDropConsumables: boolean;
        baseDropChance: number;
        itemDropChance: number;
        minConsumableTier: number;
        maxConsumableTier: number;
      };
      spritePath: string;
      iconPath: string;
    }> = [];

    for (const entry of pck.entries) {
      const m = entry.path.match(
        /^res:\/\/entities\/units\/enemies\/crash_zone\/(basic|elites|bosses)\/([^/]+)\/([^/]+)\.tscn$/
      );
      if (!m) continue;
      const folderKind = m[1];
      const dirName = m[2];
      const kind: 'basic' | 'elite' | 'boss' =
        folderKind === 'bosses' ? 'boss' : folderKind === 'elites' ? 'elite' : 'basic';

      const tscn = loadTres(pck, entry.path);
      if (!tscn) continue;

      const rootNode = tscn.nodes[0];
      const enemyId = asString(rootNode?.props.enemy_id, dirName);

      // Resolve stats .tres linked by root node
      let statsPath = isExtRef(rootNode?.props.stats) ? rootNode.props.stats.path : '';
      if (!statsPath) {
        const fallbackStats = `res://entities/units/enemies/crash_zone/${folderKind}/${dirName}/${dirName}_stats.tres`;
        if (pck.byPath.has(fallbackStats)) statsPath = fallbackStats;
      }
      const statsRes = statsPath ? loadTres(pck, statsPath) : null;
      const sp = statsRes?.resourceProps ?? {};

      // Resolve radius from Collision sub_resource
      let radius = kind === 'boss' ? 40 : kind === 'elite' ? 32 : 22;
      const collNode = tscn.nodes.find((n) => n.name === 'Collision' && n.parent === '.');
      if (collNode && isSubRef(collNode.props.shape)) {
        const sr = tscn.subResources.get(collNode.props.shape.__sub);
        if (sr && typeof sr.props.radius === 'number') {
          radius = Math.round(sr.props.radius * 100) / 100;
        }
      }

      // Resolve sprite path from Sprite node or textures_evolution or fallback to enemy.tscn
      let spritePath = '';
      const spriteNode = tscn.nodes.find((n) => n.name === 'Sprite');
      if (spriteNode && isExtRef(spriteNode.props.texture) && spriteNode.props.texture.path) {
        spritePath = spriteNode.props.texture.path;
      }
      if (!spritePath) {
        const defaultPng = `res://entities/units/enemies/crash_zone/${folderKind}/${dirName}/${dirName}.png`;
        if (pck.byPath.has(`${defaultPng}.import`)) {
          spritePath = defaultPng;
        } else {
          spritePath = baseEnemySprite;
        }
      }
      const iconPath = isExtRef(sp.icon) ? sp.icon.path : spritePath;

      enemies.push({
        id: enemyId,
        kind,
        scenePath: entry.path,
        hp: asNumber(sp.health, 3),
        hpPerWave: asNumber(sp.health_increase_each_wave, 2),
        damage: asNumber(sp.damage, 1),
        damagePerWave: asNumber(sp.damage_increase_each_wave, 0.6),
        speed: asNumber(sp.speed, 250),
        speedRandomization: asNumber(sp.speed_randomization, 50),
        radius,
        knockbackResistance: asNumber(sp.knockback_resistance, 0),
        armor: asNumber(sp.armor, 0),
        armorPerWave: asNumber(sp.armor_increase_each_wave, 0),
        dropStats: {
          value: asNumber(sp.value, 1),
          goldSpread: asNumber(sp.gold_spread, 0),
          canDropConsumables: asBool(sp.can_drop_consumables, true),
          alwaysDropConsumables: asBool(sp.always_drop_consumables, false),
          baseDropChance: asNumber(sp.base_drop_chance, 0.01),
          itemDropChance: asNumber(sp.item_drop_chance, 0.01),
          minConsumableTier: asNumber(sp.min_consumable_tier, 0),
          maxConsumableTier: asNumber(sp.max_consumable_tier, 0),
        },
        spritePath,
        iconPath,
      });
    }
    enemies.sort((a, b) =>
      a.kind === b.kind ? a.id.localeCompare(b.id) : a.kind.localeCompare(b.kind)
    );

    const enemiesBasicCount = enemies.filter((e) => e.kind === 'basic').length;
    const enemiesElitesCount = enemies.filter((e) => e.kind === 'elite').length;
    const enemiesBossesCount = enemies.filter((e) => e.kind === 'boss').length;

    // 7. Crash Zone Waves 1..20 (res://zones/zone_1_crash/001..020/wave_*.tres)
    const waves: Array<{
      wave: number;
      durationSec: number;
      maxEnemies: number;
      groups: Array<{
        spawnChance: number;
        spawnTiming: number;
        repeating: number;
        repeatingInterval: number;
        reduceRepeatingInterval: number;
        minRepeatingInterval: number;
        isBoss: boolean;
        isHorde: boolean;
        isLoot: boolean;
        isNeutral: boolean;
        minDifficulty: number;
        maxDifficulty: number;
        units: Array<{
          enemyId: string;
          scenePath: string;
          minCount: number;
          maxCount: number;
          spawnChance: number;
        }>;
      }>;
    }> = [];

    for (let w = 1; w <= 20; w++) {
      const dir = String(w).padStart(3, '0');
      const wavePath = `res://zones/zone_1_crash/${dir}/wave_${w}.tres`;
      const waveRes = loadTres(pck, wavePath);
      if (!waveRes) continue;
      const wp = waveRes.resourceProps;

      const parsedGroups: (typeof waves)[number]['groups'] = [];
      const groupRefs = [
        ...(Array.isArray(wp.groups_data) ? wp.groups_data : []),
        ...(Array.isArray(wp.conditional_groups_data) ? wp.conditional_groups_data : []),
      ];

      for (const gRef of groupRefs) {
        if (!isExtRef(gRef) || !gRef.path) continue;
        const gRes = loadTres(pck, gRef.path);
        if (!gRes) continue;
        const gp = gRes.resourceProps;

        const units: (typeof parsedGroups)[number]['units'] = [];
        if (Array.isArray(gp.wave_units_data)) {
          for (const uRef of gp.wave_units_data) {
            if (!isExtRef(uRef) || !uRef.path) continue;
            const uRes = loadTres(pck, uRef.path);
            if (!uRes) continue;
            const up = uRes.resourceProps;
            const scenePath = isExtRef(up.unit_scene) ? up.unit_scene.path : '';
            const rawSceneName = asString(up.unit_scene_name);
            let enemyId = rawSceneName.replace(/\.tscn$/, '');
            if (!enemyId && scenePath) {
              enemyId = path.posix.basename(scenePath, '.tscn');
            }
            units.push({
              enemyId,
              scenePath,
              minCount: asNumber(up.min_number, 1),
              maxCount: asNumber(up.max_number, 1),
              spawnChance: asNumber(up.spawn_chance, 1),
            });
          }
        }

        parsedGroups.push({
          spawnChance: asNumber(gp.spawn_chance, 1),
          spawnTiming: asNumber(gp.spawn_timing, 0),
          repeating: asNumber(gp.repeating, 0),
          repeatingInterval: asNumber(gp.repeating_interval, 1),
          reduceRepeatingInterval: asNumber(gp.reduce_repeating_interval, 0),
          minRepeatingInterval: asNumber(gp.min_repeating_interval, 1),
          isBoss: asBool(gp.is_boss, false),
          isHorde: asBool(gp.is_horde, false),
          isLoot: asBool(gp.is_loot, false),
          isNeutral: asBool(gp.is_neutral, false),
          minDifficulty: asNumber(gp.min_difficulty, 0),
          maxDifficulty: asNumber(gp.max_difficulty, 9999),
          units,
        });
      }

      waves.push({
        wave: w,
        durationSec: asNumber(wp.wave_duration, WAVE_DURATIONS_SEC[w - 1] ?? 60),
        maxEnemies: asNumber(wp.max_enemies, MAX_ENEMIES),
        groups: parsedGroups,
      });
    }

    const parsedWaveDurations =
      waves.length === 20 ? waves.map((w) => w.durationSec) : [...WAVE_DURATIONS_SEC];

    // 8. Verified Constants & Formulas matching SPEC.md + .pck resources
    const constants = {
      simHz: SIM_HZ,
      fixedDt: FIXED_DT,
      refWidth: REF_WIDTH,
      refHeight: REF_HEIGHT,
      tileSize: TILE_SIZE,
      arenaTilesW: ARENA_TILES_W,
      arenaTilesH: ARENA_TILES_H,
      arenaW: ARENA_W,
      arenaH: ARENA_H,
      edgeMapDist: EDGE_MAP_DIST,
      edgeSize: EDGE_SIZE,
      maxEnemies: MAX_ENEMIES,
      maxGolds: MAX_GOLDS,
      nbShopItems: NB_SHOP_ITEMS,
      playerBaseSpeed: PLAYER_BASE_SPEED,
      playerBaseMaxHp: PLAYER_BASE_MAX_HP,
      playerDefaultWeaponSlots: PLAYER_DEFAULT_WEAPON_SLOTS,
      playerDefaultDodgeCap: PLAYER_DEFAULT_DODGE_CAP,
      minIframesTicks: MIN_IFRAMES_TICKS,
      maxIframesTicks: MAX_IFRAMES_TICKS,
      lifestealCooldownTicks: LIFESTEAL_COOLDOWN_TICKS,
      minWeaponRange: MIN_WEAPON_RANGE,
      minWeaponCooldown: MIN_WEAPON_COOLDOWN,
      minSweepDistance: MIN_SWEEP_DISTANCE,
      spawnTelegraphTicks: SPAWN_TELEGRAPH_TICKS,
      endWaveTicks: END_WAVE_TICKS,
      harvestTicks: HARVEST_TICKS,
      baseHarvestingGrowth: BASE_HARVESTING_GROWTH,
      endlessHarvestingDecay: ENDLESS_HARVESTING_DECAY,
      baseFruitHeal: BASE_FRUIT_HEAL,
      baseExplosionRadius,
      waveDurationsSec: parsedWaveDurations,
      rarityTiers: [
        { tier: 0, name: RARITY_NAMES[0], color: RARITY_COLORS[0], minWave: 1, chancePerWave: 0, maxChance: 1.0 },
        { tier: 1, name: RARITY_NAMES[1], color: RARITY_COLORS[1], minWave: 2, chancePerWave: 0.06, maxChance: 0.60 },
        { tier: 2, name: RARITY_NAMES[2], color: RARITY_COLORS[2], minWave: 4, chancePerWave: 0.02, maxChance: 0.25 },
        { tier: 3, name: RARITY_NAMES[3], color: RARITY_COLORS[3], minWave: 8, chancePerWave: 0.0023, maxChance: 0.08 },
      ],
      difficultyMultipliers: [
        { level: 0, name: 'Danger 0', enemyHpMult: 1.0, enemyDamageMult: 1.0, enemySpeedMult: 1.0, shopInflationBonus: 0, elitesEnabled: false, extraElites: false, doubleBoss: false, nightmareEvents: false },
        { level: 1, name: 'Danger 1', enemyHpMult: 1.0, enemyDamageMult: 1.0, enemySpeedMult: 1.0, shopInflationBonus: 0, elitesEnabled: false, extraElites: false, doubleBoss: false, nightmareEvents: false },
        { level: 2, name: 'Danger 2', enemyHpMult: 1.0, enemyDamageMult: 1.0, enemySpeedMult: 1.0, shopInflationBonus: 0, elitesEnabled: true, extraElites: false, doubleBoss: false, nightmareEvents: false },
        { level: 3, name: 'Danger 3', enemyHpMult: 1.12, enemyDamageMult: 1.12, enemySpeedMult: 1.0, shopInflationBonus: 0, elitesEnabled: true, extraElites: false, doubleBoss: false, nightmareEvents: false },
        { level: 4, name: 'Danger 4', enemyHpMult: 1.26, enemyDamageMult: 1.26, enemySpeedMult: 1.0, shopInflationBonus: 0, elitesEnabled: true, extraElites: true, doubleBoss: false, nightmareEvents: false },
        { level: 5, name: 'Danger 5', enemyHpMult: 1.4, enemyDamageMult: 1.4, enemySpeedMult: 1.0, shopInflationBonus: 0, elitesEnabled: true, extraElites: true, doubleBoss: true, nightmareEvents: false },
        { level: 6, name: 'Danger 6 Nightmare', enemyHpMult: 1.6, enemyDamageMult: 1.6, enemySpeedMult: 1.1, shopInflationBonus: 10, elitesEnabled: true, extraElites: true, doubleBoss: true, nightmareEvents: true },
      ],
      formulas: {
        armorPositive: '10 / (10 + armor / 1.5)',
        armorNegative: '2 - 10 / (10 + abs(armor) / 1.5)',
        hpRegenIntervalSec: '5.0 / (1.0 + abs(hp_regen - 1) / 2.25)',
        xpToNextLevel: '(level + 3)^2',
        rerollDelta: 'max(1, floor(0.4 * wave * sqrt(1 + endlessFactor)))',
        rerollCost: 'ceil((floor(wave * 0.75) + delta + delta * rerollCount) * max(0.1, 1 + reroll_price / 100))',
        inflationRate: '0.1 * (1 + inflation_modifier / 100)',
        shopPrice: 'max(1, round((baseMod + wave + baseMod * wave * inflation) * (1 + items_price / 100) * (1 + endlessFactor / 5)))',
        recycleRefund: 'max(1, floor(shopPrice * clamp(0.25 + recycling_gains / 100, 0.01, 1.0)))',
      },
    };

    const oracle = {
      generatedAt: new Date().toISOString(),
      engine: pck.header,
      constants,
      counts: {
        characters: characters.length,
        weapons: weapons.length,
        meleeWeapons: meleeCount,
        rangedWeapons: rangedCount,
        weaponTierVariants: totalWeaponTierVariants,
        sets: sets.length,
        items: baseItems.length,
        updateItems: updateItems.length,
        itemsTotalNonDlc: baseItems.length + updateItems.length,
        upgrades: upgrades.length,
        enemiesBasic: enemiesBasicCount,
        enemiesElites: enemiesElitesCount,
        enemiesBosses: enemiesBossesCount,
        enemiesTotal: enemies.length,
        waves: waves.length,
      },
      characters,
      weapons,
      sets,
      items: baseItems,
      updateItems,
      upgrades,
      enemies,
      waves,
    };

    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
    fs.writeFileSync(OUTPUT_PATH, JSON.stringify(oracle, null, 2), 'utf8');

    console.log(`[oracle-dump] Wrote ${OUTPUT_PATH}`);
    console.log(`[oracle-dump] Engine: ${pck.header.magic} v${pck.header.formatVer} (Godot ${pck.header.godotVersion}, ${pck.header.fileCount} files)`);
    console.log(
      `[oracle-dump] Counts: characters=${oracle.counts.characters}, weapons=${oracle.counts.weapons} (${meleeCount} melee + ${rangedCount} ranged, ${totalWeaponTierVariants} tier variants), sets=${oracle.counts.sets}, items=${oracle.counts.items} (+${oracle.counts.updateItems} update items), upgrades=${oracle.counts.upgrades}, enemies=${oracle.counts.enemiesTotal} (${enemiesBasicCount} basic + ${enemiesElitesCount} elites + ${enemiesBossesCount} bosses), waves=${oracle.counts.waves}`
    );
  } finally {
    pck.close();
  }
}

main();
