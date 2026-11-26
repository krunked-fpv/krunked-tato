// ============================================================================
// src/assets/CustomPackLoader.ts — 100% Browser-Safe Custom Asset Pack Loader
// Supports Vite dev-middleware (/ __krunked_custom_pack__/), browser-side
// GDPC v1 .pck File parsing (via File.slice()), directory FileList loading,
// and IndexedDB persistence (krunked_tato_custom_pack_v1). Zero Node imports.
// ============================================================================

import type { CustomPackStatus } from '../contracts/index';

const DEV_PACK_PREFIX = '/__krunked_custom_pack__/';
const IDB_NAME = 'krunked_tato_custom_pack_v1';
const IDB_VERSION = 1;
const STORE_META = 'meta';
const STORE_TEXTURES = 'textures';
const STORE_AUDIO = 'audio';

export interface CustomPackManifest {
  version: number;
  generatedAt?: string;
  textures: Record<string, string>;
  audio: Record<string, string>;
  counts?: {
    textures: number;
    audio: number;
  };
}

interface PckEntry {
  path: string;
  offset: number;
  size: number;
}

interface StoredMetaRecord {
  id: 'manifest';
  label: string;
  textureIds: string[];
  audioKeys: string[];
}

const textDecoder = new TextDecoder('utf-8');

function readAscii(bytes: Uint8Array, start: number, len: number): string {
  let out = '';
  const end = Math.min(bytes.length, start + len);
  for (let i = start; i < end; i++) {
    out += String.fromCharCode(bytes[i]);
  }
  return out;
}

function readU64LE(view: DataView, offset: number): number {
  const lo = view.getUint32(offset, true);
  const hi = view.getUint32(offset + 4, true);
  return hi * 4294967296 + lo;
}

// ----------------------------------------------------------------------------
// Browser-Side STEX (GDST -> WebP / PNG) & RSRC (.mp3str / .sample -> WAV)
// ----------------------------------------------------------------------------

function decodeStexBlob(stexBytes: Uint8Array): Blob | null {
  if (stexBytes.length < 44) return null;
  if (readAscii(stexBytes, 0, 4) !== 'GDST') return null;

  const formatTag = readAscii(stexBytes, 28, 4);
  if (formatTag === 'WEBP') {
    const payload = stexBytes.subarray(32);
    if (
      payload.length >= 12 &&
      readAscii(payload, 0, 4) === 'RIFF' &&
      readAscii(payload, 8, 4) === 'WEBP'
    ) {
      return new Blob([payload.slice()], { type: 'image/webp' });
    }
    return null;
  }

  if (formatTag === 'PNG ') {
    const payload = stexBytes.subarray(32);
    if (
      payload.length >= 8 &&
      payload[0] === 0x89 &&
      payload[1] === 0x50 &&
      payload[2] === 0x4e &&
      payload[3] === 0x47
    ) {
      return new Blob([payload.slice()], { type: 'image/png' });
    }
    return null;
  }

  return null;
}

interface ParsedRsrcAudio {
  data?: Uint8Array;
  format?: number;
  mixRate?: number;
  stereo?: boolean;
}

function parseRsrcAudioBytes(bytes: Uint8Array): ParsedRsrcAudio | null {
  if (bytes.length < 96) return null;
  if (readAscii(bytes, 0, 4) !== 'RSRC') return null;

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let o = 4;
  const bigEndian = view.getUint32(o, true);
  o += 4;
  if (bigEndian !== 0) return null;
  const useReal64 = view.getUint32(o, true) !== 0;
  o += 4;
  o += 12; // version major, minor, format

  const typeLen = view.getUint32(o, true);
  o += 4 + typeLen;
  o += 64; // importmd_ofs + flags + reserved

  const strCount = view.getUint32(o, true);
  o += 4;
  const strings: string[] = [];
  for (let i = 0; i < strCount; i++) {
    const l = view.getUint32(o, true);
    o += 4;
    strings.push(textDecoder.decode(bytes.subarray(o, o + l)).replace(/\0+$/, ''));
    o += l;
  }

  const extCount = view.getUint32(o, true);
  o += 4;
  for (let i = 0; i < extCount; i++) {
    const tl = view.getUint32(o, true);
    o += 4 + tl;
    const pl = view.getUint32(o, true);
    o += 4 + pl;
  }

  const intCount = view.getUint32(o, true);
  o += 4;
  if (intCount < 1) return null;
  const pl = view.getUint32(o, true);
  o += 4 + pl;
  const intOffset = readU64LE(view, o);

  o = intOffset;
  const cl = view.getUint32(o, true);
  o += 4 + cl;
  const propCount = view.getUint32(o, true);
  o += 4;

  const result: ParsedRsrcAudio = {};
  for (let i = 0; i < propCount; i++) {
    const nameIdx = view.getUint32(o, true);
    o += 4;
    const name = strings[nameIdx] ?? '';
    const vtype = view.getUint32(o, true);
    o += 4;

    if (vtype === 2) {
      const b = view.getUint32(o, true) !== 0;
      o += 4;
      if (name === 'stereo') result.stereo = b;
    } else if (vtype === 3) {
      const v = view.getInt32(o, true);
      o += 4;
      if (name === 'format') result.format = v;
      else if (name === 'mix_rate') result.mixRate = v;
    } else if (vtype === 4) {
      o += useReal64 ? 8 : 4;
    } else if (vtype === 5) {
      const l = view.getUint32(o, true);
      o += 4;
      o += l + ((4 - (l % 4)) % 4);
    } else if (vtype === 31) {
      const l = view.getUint32(o, true);
      o += 4;
      if (name === 'data') {
        result.data = bytes.subarray(o, o + l);
      }
      o += l + ((4 - (l % 4)) % 4);
    } else {
      break;
    }
  }

  return result;
}

function encodeWavBlobFromSample(sample: ParsedRsrcAudio): Blob | null {
  if (!sample.data || sample.data.length === 0) return null;
  const format = sample.format ?? 1;
  const sampleRate = sample.mixRate ?? 44100;
  const numChannels = sample.stereo ? 2 : 1;

  let pcmBytes: Uint8Array;
  let bitsPerSample: number;
  if (format === 0) {
    bitsPerSample = 8;
    pcmBytes = new Uint8Array(sample.data.length);
    for (let i = 0; i < sample.data.length; i++) {
      pcmBytes[i] = (sample.data[i] + 128) & 0xff;
    }
  } else if (format === 1) {
    bitsPerSample = 16;
    pcmBytes = sample.data;
  } else {
    return null;
  }

  const blockAlign = (numChannels * bitsPerSample) / 8;
  const byteRate = sampleRate * blockAlign;
  const dataSize = pcmBytes.length;
  const out = new Uint8Array(44 + dataSize);
  const view = new DataView(out.buffer);

  const writeStr = (off: number, str: string): void => {
    for (let i = 0; i < str.length; i++) out[off + i] = str.charCodeAt(i);
  };
  writeStr(0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true);
  writeStr(8, 'WAVE');
  writeStr(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bitsPerSample, true);
  writeStr(36, 'data');
  view.setUint32(40, dataSize, true);
  out.set(pcmBytes, 44);

  return new Blob([out], { type: 'audio/wav' });
}

// ----------------------------------------------------------------------------
// IndexedDB Helpers (gracefully degrades if unavailable)
// ----------------------------------------------------------------------------

function openPackDb(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === 'undefined') return Promise.resolve(null);
  return new Promise((resolve) => {
    try {
      const req = indexedDB.open(IDB_NAME, IDB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE_META)) {
          db.createObjectStore(STORE_META, { keyPath: 'id' });
        }
        if (!db.objectStoreNames.contains(STORE_TEXTURES)) {
          db.createObjectStore(STORE_TEXTURES);
        }
        if (!db.objectStoreNames.contains(STORE_AUDIO)) {
          db.createObjectStore(STORE_AUDIO);
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

function idbGet<T>(db: IDBDatabase, storeName: string, key: IDBValidKey): Promise<T | null> {
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(storeName, 'readonly');
      const req = tx.objectStore(storeName).get(key);
      req.onsuccess = () => resolve((req.result as T | undefined) ?? null);
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

async function idbWritePack(
  label: string,
  textures: Map<string, Blob>,
  audio: Map<string, Blob>
): Promise<boolean> {
  const db = await openPackDb();
  if (!db) return false;
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction([STORE_META, STORE_TEXTURES, STORE_AUDIO], 'readwrite');
      const metaStore = tx.objectStore(STORE_META);
      const texStore = tx.objectStore(STORE_TEXTURES);
      const audStore = tx.objectStore(STORE_AUDIO);

      texStore.clear();
      audStore.clear();

      for (const [id, blob] of textures) {
        texStore.put(blob, id);
      }
      for (const [key, blob] of audio) {
        audStore.put(blob, key);
      }

      const meta: StoredMetaRecord = {
        id: 'manifest',
        label,
        textureIds: [...textures.keys()],
        audioKeys: [...audio.keys()],
      };
      metaStore.put(meta);

      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error('IndexedDB write failed'));
      tx.onabort = () => reject(tx.error ?? new Error('IndexedDB transaction aborted'));
    });
    return true;
  } catch {
    return false;
  } finally {
    db.close();
  }
}

async function idbReadAllBlobs(
  db: IDBDatabase,
  storeName: string,
  keys: readonly string[]
): Promise<Map<string, Blob>> {
  const map = new Map<string, Blob>();
  await new Promise<void>((resolve) => {
    try {
      const tx = db.transaction(storeName, 'readonly');
      const store = tx.objectStore(storeName);
      for (const key of keys) {
        const req = store.get(key);
        req.onsuccess = () => {
          if (req.result instanceof Blob) {
            map.set(key, req.result);
          }
        };
      }
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    } catch {
      resolve();
    }
  });
  return map;
}

// ----------------------------------------------------------------------------
// Image Decoding Helper
// ----------------------------------------------------------------------------

async function decodeImageBlob(blob: Blob): Promise<HTMLImageElement | ImageBitmap | null> {
  if (typeof createImageBitmap === 'function') {
    try {
      return await createImageBitmap(blob);
    } catch {
      // Fallback to HTMLImageElement
    }
  }
  if (typeof Image === 'undefined' || typeof URL === 'undefined') return null;
  const url = URL.createObjectURL(blob);
  try {
    const img = new Image();
    img.decoding = 'async';
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error('Image decode failed'));
      img.src = url;
    });
    return img;
  } catch {
    return null;
  } finally {
    URL.revokeObjectURL(url);
  }
}

// ----------------------------------------------------------------------------
// Logical ID Mapping for Browser-Side GDPC .pck Extraction
// ----------------------------------------------------------------------------

const WEAPON_DIR_ALIASES: Readonly<Record<string, string>> = {
  cactus_mace: 'cacti_club',
  flaming_knuckles: 'flaming_brass_knuckles',
  vorpal_sword: 'bloody_vorpal',
};

const UPGRADE_DIR_TO_STAT: Readonly<Record<string, string>> = {
  health: 'stat_max_hp',
  health_regeneration: 'stat_hp_regen',
  lifesteal: 'stat_lifesteal',
  percent_damage: 'stat_percent_damage',
  melee_damage: 'stat_melee_damage',
  ranged_damage: 'stat_ranged_damage',
  elemental_damage: 'stat_elemental_damage',
  attack_speed: 'stat_attack_speed',
  crit_chance: 'stat_crit_chance',
  engineering: 'stat_engineering',
  range: 'stat_range',
  armor: 'stat_armor',
  dodge: 'stat_dodge',
  speed: 'stat_speed',
  luck: 'stat_luck',
  harvesting: 'stat_harvesting',
};

const STATIC_TEXTURE_MAPPINGS: ReadonlyArray<readonly [string, string]> = [
  ['player_body', 'res://entities/units/player/potato.png'],
  ['player_legs', 'res://entities/units/player/legs.png'],
  ['tree_0', 'res://entities/units/neutral/tree.png'],
  ['tree_jungle', 'res://entities/units/neutral/tree_jungle.png'],
  ['structure_turret', 'res://entities/structures/turret/turret.png'],
  ['structure_medical_turret', 'res://entities/structures/turret/healing/healing_turret.png'],
  ['structure_laser_turret', 'res://entities/structures/turret/laser/laser_turret.png'],
  ['structure_explosive_turret', 'res://entities/structures/turret/rocket/rocket_turret.png'],
  ['structure_flame_turret', 'res://entities/structures/turret/flame/flame_turret.png'],
  ['structure_mine', 'res://entities/structures/landmine/landmine.png'],
  ['material_0', 'res://items/materials/material_0000.png'],
  ['material_1', 'res://items/materials/material_0001.png'],
  ['material_2', 'res://items/materials/material_0002.png'],
  ['material_3', 'res://items/materials/material_0003.png'],
  ['material_4', 'res://items/materials/material_0004.png'],
  ['material_5', 'res://items/materials/material_0005.png'],
  ['material_6', 'res://items/materials/material_0006.png'],
  ['material_7', 'res://items/materials/material_0007.png'],
  ['material_8', 'res://items/materials/material_0008.png'],
  ['material_9', 'res://items/materials/material_0009.png'],
  ['material_10', 'res://items/materials/material_0010.png'],
  ['material_bag', 'res://items/materials/material_bag.png'],
  ['material_ui', 'res://items/materials/material_ui.png'],
  ['fruit', 'res://items/consumables/fruit/fruit.png'],
  ['fruit_jungle', 'res://items/consumables/fruit/fruit_jungle.png'],
  ['crate', 'res://items/consumables/item_box/item_box.png'],
  ['crate_legendary', 'res://items/consumables/legendary_item_box/legendary_item_box.png'],
  ['spawn_telegraph', 'res://entities/birth/entity_birth.png'],
  ['tile_crash_1', 'res://resources/tiles/tiles_1.png'],
  ['tile_crash_2', 'res://resources/tiles/tiles_2.png'],
  ['tile_crash_3', 'res://resources/tiles/tiles_3.png'],
  ['tile_crash_4', 'res://resources/tiles/tiles_4.png'],
  ['tile_crash_5', 'res://resources/tiles/tiles_5.png'],
  ['tile_crash_6', 'res://resources/tiles/tiles_6.png'],
  ['tile_abyss_0', 'res://dlcs/dlc_1/resources/tiles/tiles_0.png'],
  ['tile_abyss_1', 'res://dlcs/dlc_1/resources/tiles/tiles_1.png'],
  ['tile_abyss_2', 'res://dlcs/dlc_1/resources/tiles/tiles_2.png'],
  ['tile_jungle_1', 'res://resources/tiles/tiles_jungle_1.png'],
  ['tile_jungle_2', 'res://resources/tiles/tiles_jungle_2.png'],
  ['proj_bullet', 'res://projectiles/bullet/frame0000.png'],
  ['proj_enemy', 'res://projectiles/bullet_enemy/bullet_enemy.png'],
  ['proj_enemy_long', 'res://projectiles/bullet_enemy/bullet_enemy_long.png'],
  ['proj_laser', 'res://projectiles/bullet_laser/bullet_laser_0000.png'],
  ['proj_lightning', 'res://projectiles/bullet_lightning/sprites/bullet_lightning_0000.png'],
  ['proj_taser', 'res://projectiles/bullet_taser/sprites/bullet_taser_0000.png'],
  ['proj_flame', 'res://projectiles/flames/sprites/bullet_flame_0000.png'],
  ['proj_rocket', 'res://projectiles/rocket/rocket.png'],
  ['proj_nuclear', 'res://projectiles/nuclear_launcher/nuclear_rocket.png'],
  ['proj_fireball', 'res://projectiles/fireball_projectile/fireball_projectile.png'],
  ['proj_icicle', 'res://projectiles/icicle/icicle_projectile.png'],
  ['proj_wand', 'res://projectiles/bullet_wand/bullet_wand.png'],
  ['proj_scepter', 'res://projectiles/bullet_ghost_scepter/bullet_scepter_0000.png'],
  ['proj_slingshot', 'res://projectiles/bullet_slingshot/slingshot_projectile.png'],
  ['proj_shuriken', 'res://projectiles/shuriken/shuriken.png'],
  ['proj_boomerang', 'res://projectiles/boomerang/boomerang_projectile.png'],
  ['proj_medical', 'res://projectiles/bullet_medical/bullet_medical_0000.png'],
  ['proj_railgun', 'res://projectiles/bullet_rail_gun/rail_gun_bullet.png'],
  ['proj_shredder', 'res://projectiles/bullet_shredder/bullet_shredder_0000.png'],
  ['proj_obliterator', 'res://projectiles/obliterator/obliterator_bullet.png'],
  ['proj_potato', 'res://projectiles/potato/potato.png'],
  ['proj_molotov', 'res://projectiles/molotov/molotov.png'],
  ['proj_grenade', 'res://projectiles/grenade/grenade_projectile_C.png'],
  ['proj_blowgun', 'res://projectiles/blowgun_projectile/blowgun_projectile.png'],
  ['proj_flute', 'res://projectiles/bullet_flute/flute_projectile.png'],
  ['proj_acid', 'res://projectiles/acid_projectile/acid_projectile.png'],
  ['proj_saw', 'res://projectiles/circular_saw/circular_saw.png'],
  ['proj_alien_eye', 'res://items/all/00_base_game/alien_eyes/alien_eye_projectile.png'],
  ['vfx_explosion', 'res://projectiles/rocket/explosion.png'],
  ['vfx_slash', 'res://projectiles/slash/sprites/slash_0000.png'],
  ['ui_crosshair', 'res://ui/crosshair.png'],
  ['ui_manual_cursor', 'res://ui/manual_cursor.png'],
  ['ui_warning_arrow', 'res://ui/warning_arrow.png'],
  ['ui_boss_icon', 'res://ui/icons/misc/boss_icon.png'],
  ['ui_elite_icon', 'res://ui/icons/misc/elite_icon.png'],
  ['ui_horde_icon', 'res://ui/icons/misc/horde_icon.png'],
  ['ui_weapon_icon', 'res://ui/icons/misc/weapon_icon.png'],
  ['ui_item_icon', 'res://ui/icons/misc/item_icon.png'],
  ['ui_enemy_icon', 'res://ui/icons/misc/enemy_icon.png'],
  ['ui_challenge_icon', 'res://ui/icons/misc/challenge_icon.png'],
  ['ui_fog_icon', 'res://ui/icons/misc/fog_icon.png'],
  ['ui_two_bosses_icon', 'res://ui/icons/misc/two_bosses_icon.png'],
];

const STATIC_AUDIO_MAPPINGS: ReadonlyArray<readonly [string, string]> = [
  ['sfx_weapon_melee_light', 'res://weapons/melee_sounds/whoosh_weapon_knife_swing_01.wav'],
  ['sfx_weapon_melee_blade', 'res://weapons/melee_sounds/whoosh_weapon_knife_swing_02.wav'],
  ['sfx_explosion', 'res://projectiles/rocket/explosion_small_no_tail_01.wav'],
  ['sfx_burn', 'res://resources/sounds/burn/fireball_impact_burn_01.wav'],
  ['sfx_pickup_material', 'res://items/materials/water_drop_drip_single_01.wav'],
  ['sfx_pickup_material_alt', 'res://items/materials/alt_sounds/coin_bag_ring_gemstone_item_01.wav'],
  ['sfx_pickup_fruit', 'res://items/consumables/fruit/comedy_bite_chew_01.wav'],
  ['sfx_pickup_crate', 'res://items/consumables/item_box/item_box_pickup.wav'],
  ['sfx_level_up', 'res://resources/sounds/level_up.wav'],
  ['sfx_harvest', 'res://resources/sounds/harvest/cartoon_boing_jump_01.wav'],
  ['sfx_wave_end', 'res://ui/sounds/end_wave.wav'],
  ['sfx_ui_hover', 'res://ui/sounds/button_focus.wav'],
  ['sfx_ui_confirm', 'res://ui/sounds/button_press.wav'],
  ['sfx_ui_cancel', 'res://ui/sounds/inventory_element_focus.wav'],
  ['sfx_ui_buy', 'res://ui/sounds/buy.wav'],
  ['sfx_ui_error', 'res://ui/sounds/cant_buy.wav'],
  ['sfx_ui_reroll', 'res://ui/sounds/diceroll.wav'],
  ['sfx_ui_combine', 'res://ui/sounds/CGM3_Bubble_Button_01_3.wav'],
  ['sfx_tick', 'res://ui/sounds/clock_tick_01.wav'],
  ['sfx_spawn_begin', 'res://entities/birth/birth_begin_sound.wav'],
  ['sfx_spawn_end', 'res://entities/birth/birth_end_sound.wav'],
  ['sfx_enemy_hit', 'res://resources/sounds/zombie_voice_attack_grunt_01.wav'],
  ['sfx_shield', 'res://ui/sounds/Shield 4.mp3'],
  ['sfx_step', 'res://entities/units/player/step_sounds/Step 1.mp3'],
  ['music_menu', 'res://resources/music/after-midnight by luke-melville Artlist.mp3'],
  ['music_combat_0', 'res://resources/music/density-wave by _aviad-zinemanas__ Artlist.mp3'],
  ['music_combat_1', 'res://resources/music/wasteland-survivors by evgeny-bardyuzha Artlist.mp3'],
  ['music_combat_2', 'res://resources/music/time-jumper by 2050 Artlist.mp3'],
  ['music_boss', 'res://resources/music/extreme-chaos by 2050 Artlist.mp3'],
  ['music_elite', 'res://resources/music/power-punch by 2050 Artlist.mp3'],
  ['music_abyss', 'res://dlcs/dlc_1/resources/music/Adonai - Currents.mp3'],
  ['music_jungle', 'res://resources/music/streamer_mode/Primal Dread - 1st track (V2).mp3'],
];

// ----------------------------------------------------------------------------
// CustomPackLoader Class
// ----------------------------------------------------------------------------

export class CustomPackLoader {
  private status: CustomPackStatus = {
    available: false,
    active: false,
    source: 'none',
    textureCount: 0,
    audioCount: 0,
    label: 'No Custom Pack Loaded',
  };

  private devManifest: CustomPackManifest | null = null;
  private idbMeta: StoredMetaRecord | null = null;
  private memoryTextures = new Map<string, Blob>();
  private memoryAudio = new Map<string, Blob>();
  private decodedTextures: Map<string, HTMLImageElement | ImageBitmap> | null = null;
  private decodedAudio: Map<string, AudioBuffer> | null = null;

  public getStatus(): CustomPackStatus {
    return { ...this.status };
  }

  public async probe(): Promise<CustomPackStatus> {
    // 1. Check Vite dev middleware manifest first
    if (typeof fetch === 'function') {
      try {
        const res = await fetch(`${DEV_PACK_PREFIX}manifest.json`, { cache: 'no-cache' });
        if (res.ok) {
          const manifest = (await res.json()) as CustomPackManifest;
          const texCount = Object.keys(manifest.textures ?? {}).length;
          const audCount = Object.keys(manifest.audio ?? {}).length;
          if (texCount > 0 || audCount > 0) {
            this.devManifest = manifest;
            this.status = {
              available: true,
              active: this.status.active,
              source: 'dev-middleware',
              textureCount: texCount,
              audioCount: audCount,
              label: 'Local Custom Pack (Dev Middleware)',
            };
            return this.getStatus();
          }
        }
      } catch {
        // Dev middleware absent (expected in production builds)
      }
    }

    // 2. Check IndexedDB cached pack
    const db = await openPackDb();
    if (db) {
      try {
        const meta = await idbGet<StoredMetaRecord>(db, STORE_META, 'manifest');
        if (meta && (meta.textureIds.length > 0 || meta.audioKeys.length > 0)) {
          this.idbMeta = meta;
          this.status = {
            available: true,
            active: this.status.active,
            source: 'indexeddb',
            textureCount: meta.textureIds.length,
            audioCount: meta.audioKeys.length,
            label: meta.label || 'Cached Custom Pack',
          };
          return this.getStatus();
        }
      } finally {
        db.close();
      }
    }

    // 3. Check in-memory blobs if already loaded this session
    if (this.memoryTextures.size > 0 || this.memoryAudio.size > 0) {
      this.status = {
        available: true,
        active: this.status.active,
        source: 'memory',
        textureCount: this.memoryTextures.size,
        audioCount: this.memoryAudio.size,
        label: 'Loaded Custom Pack',
      };
      return this.getStatus();
    }

    this.status = {
      available: false,
      active: false,
      source: 'none',
      textureCount: 0,
      audioCount: 0,
      label: 'No Custom Pack Loaded',
    };
    return this.getStatus();
  }

  public async loadFromPckFile(file: File): Promise<CustomPackStatus> {
    if (file.size < 88) {
      throw new Error('Selected file is too small to be a valid Local .pck Pack.');
    }

    const hdrBuf = await file.slice(0, 88).arrayBuffer();
    const hdrBytes = new Uint8Array(hdrBuf);
    if (readAscii(hdrBytes, 0, 4) !== 'GDPC') {
      throw new Error('Selected file is not a valid Local .pck Pack (missing GDPC header).');
    }
    const hdrView = new DataView(hdrBuf);
    const fileCount = hdrView.getUint32(84, true);

    // Read TOC incrementally using file.slice()
    const entries: PckEntry[] = [];
    const byLowerPath = new Map<string, PckEntry>();

    const chunkSize = 4 * 1024 * 1024;
    let filePos = 88;
    let buf = new Uint8Array(
      await file.slice(filePos, Math.min(file.size, filePos + chunkSize)).arrayBuffer()
    );
    let view = new DataView(buf.buffer);
    let cursor = 0;

    const ensureBytes = async (needed: number): Promise<void> => {
      if (cursor + needed <= buf.length) return;
      const remaining = buf.subarray(cursor);
      filePos += cursor;
      const nextStart = filePos + remaining.length;
      const nextEnd = Math.min(file.size, nextStart + Math.max(chunkSize, needed));
      if (nextEnd <= nextStart) {
        buf = remaining.slice();
      } else {
        const nextArr = new Uint8Array(await file.slice(nextStart, nextEnd).arrayBuffer());
        const merged = new Uint8Array(remaining.length + nextArr.length);
        merged.set(remaining, 0);
        merged.set(nextArr, remaining.length);
        buf = merged;
      }
      view = new DataView(buf.buffer);
      cursor = 0;
    };

    for (let i = 0; i < fileCount; i++) {
      await ensureBytes(4);
      const pathLen = view.getUint32(cursor, true);
      cursor += 4;
      await ensureBytes(pathLen + 32);
      const rawPath = textDecoder
        .decode(buf.subarray(cursor, cursor + pathLen))
        .replace(/\0+$/, '');
      cursor += pathLen;
      const offset = readU64LE(view, cursor);
      cursor += 8;
      const size = readU64LE(view, cursor);
      cursor += 8;
      cursor += 16; // md5

      const entry: PckEntry = { path: rawPath, offset, size };
      entries.push(entry);
      byLowerPath.set(rawPath.toLowerCase(), entry);
    }

    const readEntryBytes = async (resPath: string): Promise<Uint8Array | null> => {
      const entry = byLowerPath.get(resPath.toLowerCase());
      if (!entry) return null;
      const ab = await file.slice(entry.offset, entry.offset + entry.size).arrayBuffer();
      return new Uint8Array(ab);
    };

    const readEntryText = async (resPath: string): Promise<string | null> => {
      const bytes = await readEntryBytes(resPath);
      return bytes ? textDecoder.decode(bytes) : null;
    };

    const resolveImport = async (resPath: string): Promise<string | null> => {
      const impPath = resPath.toLowerCase().endsWith('.import') ? resPath : `${resPath}.import`;
      const txt = await readEntryText(impPath);
      if (!txt) return null;
      const m = txt.match(/^path="([^"]+)"/m);
      return m ? m[1] : null;
    };

    // Build logical texture target map
    const texturePaths = new Map<string, string>();
    const addTex = (id: string, resPath: string): void => {
      if (texturePaths.has(id)) return;
      if (!byLowerPath.has(`${resPath}.import`.toLowerCase())) return;
      texturePaths.set(id, resPath);
    };

    for (const [id, resPath] of STATIC_TEXTURE_MAPPINGS) {
      addTex(id, resPath);
    }

    // Dynamic scan for characters, weapons, items, upgrades, and enemies
    for (const e of entries) {
      const p = e.path;
      const lower = p.toLowerCase();
      if (!lower.endsWith('.png.import')) continue;
      const cleanPng = p.slice(0, -'.import'.length);

      let m = cleanPng.match(/^res:\/\/items\/characters\/([^/]+)\/\1_icon\.png$/i);
      if (m) {
        addTex(`char_${m[1]}`, cleanPng);
        continue;
      }

      m = cleanPng.match(/^res:\/\/weapons\/(?:melee|ranged)\/([^/]+)\/\1\.png$/i);
      if (m) {
        addTex(`weapon_${m[1]}`, cleanPng);
        const alias = WEAPON_DIR_ALIASES[m[1]];
        if (alias) addTex(`weapon_${alias}`, cleanPng);
        continue;
      }

      m = cleanPng.match(/^res:\/\/weapons\/(?:melee|ranged)\/([^/]+)\/\1_icon\.png$/i);
      if (m) {
        addTex(`weapon_icon_${m[1]}`, cleanPng);
        if (!texturePaths.has(`weapon_${m[1]}`)) {
          addTex(`weapon_${m[1]}`, cleanPng);
        }
        const alias = WEAPON_DIR_ALIASES[m[1]];
        if (alias) {
          addTex(`weapon_icon_${alias}`, cleanPng);
          if (!texturePaths.has(`weapon_${alias}`)) addTex(`weapon_${alias}`, cleanPng);
        }
        continue;
      }

      m = cleanPng.match(/^res:\/\/items\/all\/[^/]+\/([^/]+)\/[^/]*_icon\.png$/i);
      if (m) {
        addTex(`item_${m[1]}`, cleanPng);
        continue;
      }

      m = cleanPng.match(/^res:\/\/items\/upgrades\/([^/]+)\/[^/]+\.png$/i);
      if (m && UPGRADE_DIR_TO_STAT[m[1]]) {
        addTex(`upgrade_${UPGRADE_DIR_TO_STAT[m[1]]}`, cleanPng);
        continue;
      }

      m = cleanPng.match(
        /^res:\/\/entities\/units\/enemies\/crash_zone\/(?:basic|elites|bosses)\/([^/]+)\/([^/]+)\.png$/i
      );
      if (m) {
        const dir = m[1];
        const fileBase = m[2];
        if (fileBase === dir || fileBase === `${dir}_0`) {
          addTex(`enemy_${dir}`, cleanPng);
        } else if (fileBase === `${dir}_icon`) {
          addTex(`enemy_icon_${dir}`, cleanPng);
        }
      }
    }

    // Build logical audio target map
    const audioPaths = new Map<string, string>();
    const addAud = (key: string, resPath: string | null): void => {
      if (!resPath || audioPaths.has(key)) return;
      if (!byLowerPath.has(`${resPath}.import`.toLowerCase())) return;
      audioPaths.set(key, resPath);
    };

    const findDirAudio = (prefix: string): string | null => {
      const hit = entries.find(
        (e) =>
          e.path.startsWith(prefix) &&
          (e.path.endsWith('.wav.import') || e.path.endsWith('.mp3.import'))
      );
      return hit ? hit.path.slice(0, -'.import'.length) : null;
    };

    for (const [key, resPath] of STATIC_AUDIO_MAPPINGS) {
      addAud(key, resPath);
    }
    addAud('sfx_weapon_pistol', findDirAudio('res://weapons/ranged/pistol/'));
    addAud('sfx_weapon_smg', findDirAudio('res://weapons/ranged/smg/'));
    addAud(
      'sfx_weapon_shotgun',
      findDirAudio('res://weapons/ranged/double_barrel_shotgun/') ??
        findDirAudio('res://weapons/ranged/combat_shotgun/')
    );
    addAud('sfx_weapon_laser', findDirAudio('res://weapons/ranged/laser_gun/'));
    addAud('sfx_weapon_sniper', findDirAudio('res://weapons/ranged/sniper_gun/'));
    addAud('sfx_weapon_rocket', findDirAudio('res://weapons/ranged/rocket_launcher/'));
    addAud('sfx_weapon_flame', findDirAudio('res://weapons/ranged/flamethrower/'));
    addAud(
      'sfx_weapon_magic',
      findDirAudio('res://weapons/ranged/wand/') ?? findDirAudio('res://weapons/ranged/taser/')
    );
    addAud(
      'sfx_weapon_throw',
      findDirAudio('res://weapons/ranged/slingshot/') ??
        findDirAudio('res://weapons/ranged/shuriken/')
    );
    addAud(
      'sfx_weapon_musical',
      findDirAudio('res://weapons/ranged/pan_flute/') ??
        findDirAudio('res://dlcs/dlc_1/weapons/melee/lute/')
    );
    addAud('sfx_weapon_melee_heavy', findDirAudio('res://weapons/melee_sounds/'));

    // Extract WebP/PNG blobs
    const nextTextures = new Map<string, Blob>();
    for (const [logicalId, resPath] of texturePaths) {
      const stexPath = await resolveImport(resPath);
      if (!stexPath) continue;
      const stexBytes = await readEntryBytes(stexPath);
      if (!stexBytes) continue;
      const blob = decodeStexBlob(stexBytes);
      if (blob) nextTextures.set(logicalId, blob);
    }

    // Extract audio blobs
    const nextAudio = new Map<string, Blob>();
    for (const [soundKey, resPath] of audioPaths) {
      const impPath = await resolveImport(resPath);
      if (!impPath) continue;
      const rawBytes = await readEntryBytes(impPath);
      if (!rawBytes) continue;
      const parsed = parseRsrcAudioBytes(rawBytes);
      if (!parsed?.data || parsed.data.length === 0) continue;

      if (impPath.endsWith('.mp3str')) {
        nextAudio.set(soundKey, new Blob([parsed.data.slice()], { type: 'audio/mpeg' }));
      } else if (impPath.endsWith('.sample')) {
        const wavBlob = encodeWavBlobFromSample(parsed);
        if (wavBlob) nextAudio.set(soundKey, wavBlob);
      }
    }

    if (nextTextures.size === 0 && nextAudio.size === 0) {
      throw new Error('No compatible textures or audio assets were found in the Local .pck Pack.');
    }

    this.memoryTextures = nextTextures;
    this.memoryAudio = nextAudio;
    this.decodedTextures = null;
    this.decodedAudio = null;
    this.devManifest = null;

    const label = 'Local .pck Pack';
    const persisted = await idbWritePack(label, nextTextures, nextAudio);
    if (persisted) {
      this.idbMeta = {
        id: 'manifest',
        label,
        textureIds: [...nextTextures.keys()],
        audioKeys: [...nextAudio.keys()],
      };
    }

    this.status = {
      available: true,
      active: true,
      source: persisted ? 'indexeddb' : 'memory',
      textureCount: nextTextures.size,
      audioCount: nextAudio.size,
      label,
    };
    return this.getStatus();
  }

  public async loadFromDirectoryFiles(files: FileList): Promise<CustomPackStatus> {
    const fileArr = Array.from(files);
    if (fileArr.length === 0) {
      throw new Error('No files were selected for the Custom Pack folder.');
    }

    // Normalize paths relative to the selected folder root
    const byRelPath = new Map<string, File>();
    let manifestFile: File | null = null;

    for (const f of fileArr) {
      const rawRel = (f.webkitRelativePath || f.name).replace(/\\/g, '/');
      const parts = rawRel.split('/').filter(Boolean);
      const rel = parts.length > 1 ? parts.slice(1).join('/') : parts[0];
      byRelPath.set(rel, f);
      byRelPath.set(rawRel, f);
      if (rel === 'manifest.json' || f.name === 'manifest.json') {
        manifestFile = f;
      }
    }

    const nextTextures = new Map<string, Blob>();
    const nextAudio = new Map<string, Blob>();

    if (manifestFile) {
      const manifest = JSON.parse(await manifestFile.text()) as CustomPackManifest;
      for (const [logicalId, relPath] of Object.entries(manifest.textures ?? {})) {
        const file = byRelPath.get(relPath);
        if (file) nextTextures.set(logicalId, file);
      }
      for (const [soundKey, relPath] of Object.entries(manifest.audio ?? {})) {
        const file = byRelPath.get(relPath);
        if (file) nextAudio.set(soundKey, file);
      }
    } else {
      // Infer logical IDs directly from textures/* and audio/* filenames
      for (const f of fileArr) {
        const lower = (f.webkitRelativePath || f.name).replace(/\\/g, '/').toLowerCase();
        const baseName = f.name.replace(/\.[^.]+$/, '');
        if (lower.endsWith('.webp') || lower.endsWith('.png')) {
          nextTextures.set(baseName, f);
        } else if (lower.endsWith('.wav') || lower.endsWith('.mp3') || lower.endsWith('.ogg')) {
          nextAudio.set(baseName, f);
        }
      }
    }

    if (nextTextures.size === 0 && nextAudio.size === 0) {
      throw new Error('Selected Custom Pack folder did not contain any recognized textures or audio.');
    }

    this.memoryTextures = nextTextures;
    this.memoryAudio = nextAudio;
    this.decodedTextures = null;
    this.decodedAudio = null;
    this.devManifest = null;

    const label = 'Local Folder Custom Pack';
    const persisted = await idbWritePack(label, nextTextures, nextAudio);
    if (persisted) {
      this.idbMeta = {
        id: 'manifest',
        label,
        textureIds: [...nextTextures.keys()],
        audioKeys: [...nextAudio.keys()],
      };
    }

    this.status = {
      available: true,
      active: true,
      source: persisted ? 'indexeddb' : 'memory',
      textureCount: nextTextures.size,
      audioCount: nextAudio.size,
      label,
    };
    return this.getStatus();
  }

  public async loadTextures(): Promise<Map<string, HTMLImageElement | ImageBitmap>> {
    if (this.decodedTextures && this.decodedTextures.size > 0) {
      this.status.active = true;
      return this.decodedTextures;
    }

    if (!this.status.available) {
      await this.probe();
    }

    const result = new Map<string, HTMLImageElement | ImageBitmap>();

    if (this.memoryTextures.size > 0) {
      await Promise.all(
        [...this.memoryTextures.entries()].map(async ([id, blob]) => {
          const decoded = await decodeImageBlob(blob);
          if (decoded) result.set(id, decoded);
        })
      );
    } else if (this.status.source === 'dev-middleware' && this.devManifest) {
      const entries = Object.entries(this.devManifest.textures ?? {});
      const batchSize = 24;
      for (let i = 0; i < entries.length; i += batchSize) {
        const slice = entries.slice(i, i + batchSize);
        await Promise.all(
          slice.map(async ([id, relPath]) => {
            try {
              const res = await fetch(`${DEV_PACK_PREFIX}${relPath}`);
              if (!res.ok) return;
              const blob = await res.blob();
              const decoded = await decodeImageBlob(blob);
              if (decoded) result.set(id, decoded);
            } catch {
              // Skip individual failed texture
            }
          })
        );
      }
    } else if (this.status.source === 'indexeddb' && this.idbMeta) {
      const db = await openPackDb();
      if (db) {
        try {
          const blobs = await idbReadAllBlobs(db, STORE_TEXTURES, this.idbMeta.textureIds);
          this.memoryTextures = blobs;
          await Promise.all(
            [...blobs.entries()].map(async ([id, blob]) => {
              const decoded = await decodeImageBlob(blob);
              if (decoded) result.set(id, decoded);
            })
          );
        } finally {
          db.close();
        }
      }
    }

    if (result.size > 0) {
      this.decodedTextures = result;
      this.status.active = true;
      this.status.textureCount = result.size;
    }
    return result;
  }

  public async loadAudio(ctx: AudioContext): Promise<Map<string, AudioBuffer>> {
    if (this.decodedAudio && this.decodedAudio.size > 0) {
      return this.decodedAudio;
    }

    if (!this.status.available) {
      await this.probe();
    }

    const result = new Map<string, AudioBuffer>();
    const decodeBlob = async (key: string, blob: Blob): Promise<void> => {
      try {
        const ab = await blob.arrayBuffer();
        const audioBuf = await ctx.decodeAudioData(ab.slice(0));
        result.set(key, audioBuf);
      } catch {
        // Skip unsupported or corrupted individual audio track
      }
    };

    if (this.memoryAudio.size > 0) {
      await Promise.all(
        [...this.memoryAudio.entries()].map(([key, blob]) => decodeBlob(key, blob))
      );
    } else if (this.status.source === 'dev-middleware' && this.devManifest) {
      const entries = Object.entries(this.devManifest.audio ?? {});
      const batchSize = 8;
      for (let i = 0; i < entries.length; i += batchSize) {
        const slice = entries.slice(i, i + batchSize);
        await Promise.all(
          slice.map(async ([key, relPath]) => {
            try {
              const res = await fetch(`${DEV_PACK_PREFIX}${relPath}`);
              if (!res.ok) return;
              const blob = await res.blob();
              await decodeBlob(key, blob);
            } catch {
              // Skip failed audio fetch
            }
          })
        );
      }
    } else if (this.status.source === 'indexeddb' && this.idbMeta) {
      const db = await openPackDb();
      if (db) {
        try {
          const blobs = await idbReadAllBlobs(db, STORE_AUDIO, this.idbMeta.audioKeys);
          this.memoryAudio = blobs;
          await Promise.all([...blobs.entries()].map(([key, blob]) => decodeBlob(key, blob)));
        } finally {
          db.close();
        }
      }
    }

    if (result.size > 0) {
      this.decodedAudio = result;
      this.status.audioCount = result.size;
    }
    return result;
  }

  public async clearCache(): Promise<void> {
    if (this.decodedTextures) {
      for (const tex of this.decodedTextures.values()) {
        if (typeof ImageBitmap !== 'undefined' && tex instanceof ImageBitmap) {
          tex.close();
        }
      }
    }
    this.memoryTextures.clear();
    this.memoryAudio.clear();
    this.decodedTextures = null;
    this.decodedAudio = null;
    this.idbMeta = null;
    this.devManifest = null;

    if (typeof indexedDB !== 'undefined') {
      await new Promise<void>((resolve) => {
        try {
          const req = indexedDB.deleteDatabase(IDB_NAME);
          req.onsuccess = () => resolve();
          req.onerror = () => resolve();
          req.onblocked = () => resolve();
        } catch {
          resolve();
        }
      });
    }

    this.status = {
      available: false,
      active: false,
      source: 'none',
      textureCount: 0,
      audioCount: 0,
      label: 'No Custom Pack Loaded',
    };
  }
}
