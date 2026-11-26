// ============================================================================
// tools/extract-assets.ts — Strictly READ-ONLY GDPC v1 Texture & Audio Extractor
// Extracts .stex (GDST -> WebP/PNG) textures and RSRC (.mp3str -> MP3,
// .sample -> PCM WAV) audio into .krunkedtato-assets/ with manifest.json.
// Never writes inside Steam.
// ============================================================================

import fs from 'node:fs';
import path from 'node:path';

const DEFAULT_PCK_PATH =
  'C:\\Program Files (x86)\\Steam\\steamapps\\common\\Brotato\\Brotato.pck';
const OUTPUT_DIR = path.resolve(process.cwd(), '.krunkedtato-assets');
const TEXTURES_DIR = path.join(OUTPUT_DIR, 'textures');
const AUDIO_DIR = path.join(OUTPUT_DIR, 'audio');
const MANIFEST_PATH = path.join(OUTPUT_DIR, 'manifest.json');

// ----------------------------------------------------------------------------
// GDPC v1 Reader (Strictly Read-Only)
// ----------------------------------------------------------------------------

interface PckEntry {
  path: string;
  offset: number;
  size: number;
}

class ReadOnlyPckArchive {
  private readonly fd: number;
  public readonly entries: PckEntry[] = [];
  public readonly byPath = new Map<string, PckEntry>();
  public readonly byLowerPath = new Map<string, PckEntry>();

  constructor(pckPath: string) {
    this.fd = fs.openSync(pckPath, 'r');
    const stat = fs.fstatSync(this.fd);
    const hdr = this.readSlice(0, 88);
    const magic = hdr.subarray(0, 4).toString('ascii');
    if (magic !== 'GDPC') {
      fs.closeSync(this.fd);
      throw new Error(`Invalid PCK magic "${magic}"`);
    }
    const fileCount = hdr.readUInt32LE(84);

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
      cursor += 16; // md5

      const entry: PckEntry = { path: rawPath, offset, size };
      this.entries.push(entry);
      this.byPath.set(rawPath, entry);
      this.byLowerPath.set(rawPath.toLowerCase(), entry);
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
    const entry = this.byPath.get(resPath) ?? this.byLowerPath.get(resPath.toLowerCase());
    if (!entry) return null;
    return this.readSlice(entry.offset, entry.size);
  }

  public readText(resPath: string): string | null {
    const buf = this.readBytes(resPath);
    return buf ? buf.toString('utf8') : null;
  }

  public has(resPath: string): boolean {
    return this.byPath.has(resPath) || this.byLowerPath.has(resPath.toLowerCase());
  }

  public close(): void {
    fs.closeSync(this.fd);
  }
}

// ----------------------------------------------------------------------------
// STEX (GDST -> WebP / PNG) Decoder
// ----------------------------------------------------------------------------

interface DecodedTexture {
  ext: 'webp' | 'png';
  bytes: Buffer;
}

function resolveImportTarget(pck: ReadOnlyPckArchive, sourceResPath: string): string | null {
  const importPath = sourceResPath.toLowerCase().endsWith('.import')
    ? sourceResPath
    : `${sourceResPath}.import`;
  const txt = pck.readText(importPath);
  if (!txt) return null;
  const m = txt.match(/^path="([^"]+)"/m);
  return m ? m[1] : null;
}

function decodeStex(stexBytes: Buffer): DecodedTexture | null {
  if (stexBytes.length < 44) return null;
  const headerMagic = stexBytes.subarray(0, 4).toString('ascii');
  if (headerMagic !== 'GDST') return null;

  const formatTag = stexBytes.subarray(28, 32).toString('ascii');
  if (formatTag === 'WEBP') {
    const payload = stexBytes.subarray(32);
    if (
      payload.length >= 12 &&
      payload.subarray(0, 4).toString('ascii') === 'RIFF' &&
      payload.subarray(8, 12).toString('ascii') === 'WEBP'
    ) {
      return { ext: 'webp', bytes: payload };
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
      return { ext: 'png', bytes: payload };
    }
    return null;
  }

  return null;
}

// ----------------------------------------------------------------------------
// Godot RSRC v3 Binary Resource Decoder (.mp3str & .sample -> MP3 / WAV)
// ----------------------------------------------------------------------------

interface RsrcAudioProps {
  resType: string;
  data?: Buffer;
  format?: number; // 0 = 8-bit signed, 1 = 16-bit signed LE, 2 = IMA ADPCM
  mix_rate?: number;
  stereo?: boolean;
}

function parseRsrcAudio(buf: Buffer): RsrcAudioProps | null {
  if (buf.length < 96) return null;
  if (buf.subarray(0, 4).toString('ascii') !== 'RSRC') return null;

  let o = 4;
  const bigEndian = buf.readUInt32LE(o);
  o += 4;
  if (bigEndian !== 0) return null;
  const useReal64 = buf.readUInt32LE(o) !== 0;
  o += 4;
  o += 12; // verMajor, verMinor, verFormat

  const typeLen = buf.readUInt32LE(o);
  o += 4;
  const resType = buf
    .subarray(o, o + typeLen)
    .toString('utf8')
    .replace(/\0+$/, '');
  o += typeLen;

  // importmd_ofs (u64) + flags (u32) + 13 reserved u32 = 64 bytes
  o += 64;

  const strCount = buf.readUInt32LE(o);
  o += 4;
  const strings: string[] = [];
  for (let i = 0; i < strCount; i++) {
    const l = buf.readUInt32LE(o);
    o += 4;
    strings.push(
      buf
        .subarray(o, o + l)
        .toString('utf8')
        .replace(/\0+$/, '')
    );
    o += l;
  }

  const extCount = buf.readUInt32LE(o);
  o += 4;
  for (let i = 0; i < extCount; i++) {
    const tl = buf.readUInt32LE(o);
    o += 4 + tl;
    const pl = buf.readUInt32LE(o);
    o += 4 + pl;
  }

  const intCount = buf.readUInt32LE(o);
  o += 4;
  if (intCount < 1) return null;
  const pl = buf.readUInt32LE(o);
  o += 4 + pl;
  const intOffset = Number(buf.readBigUInt64LE(o));

  o = intOffset;
  const cl = buf.readUInt32LE(o);
  o += 4 + cl;
  const propCount = buf.readUInt32LE(o);
  o += 4;

  const out: RsrcAudioProps = { resType };
  for (let i = 0; i < propCount; i++) {
    const nameIdx = buf.readUInt32LE(o);
    o += 4;
    const name = strings[nameIdx] ?? '';
    const vtype = buf.readUInt32LE(o);
    o += 4;

    if (vtype === 2) {
      const b = buf.readUInt32LE(o) !== 0;
      o += 4;
      if (name === 'stereo') out.stereo = b;
    } else if (vtype === 3) {
      const v = buf.readInt32LE(o);
      o += 4;
      if (name === 'format') out.format = v;
      else if (name === 'mix_rate') out.mix_rate = v;
    } else if (vtype === 4) {
      o += useReal64 ? 8 : 4;
    } else if (vtype === 5) {
      const l = buf.readUInt32LE(o);
      o += 4;
      o += l + ((4 - (l % 4)) % 4);
    } else if (vtype === 31) {
      const l = buf.readUInt32LE(o);
      o += 4;
      if (name === 'data') {
        out.data = buf.subarray(o, o + l);
      }
      o += l + ((4 - (l % 4)) % 4);
    } else {
      break;
    }
  }

  return out;
}

function encodeWavFromSample(props: RsrcAudioProps): Buffer | null {
  if (!props.data || props.data.length === 0) return null;
  const format = props.format ?? 1;
  const sampleRate = props.mix_rate ?? 44100;
  const numChannels = props.stereo ? 2 : 1;

  let pcmData: Buffer;
  let bitsPerSample: number;

  if (format === 0) {
    // Godot 8-bit signed PCM -> standard WAV 8-bit unsigned PCM
    bitsPerSample = 8;
    pcmData = Buffer.allocUnsafe(props.data.length);
    for (let i = 0; i < props.data.length; i++) {
      pcmData[i] = (props.data[i] + 128) & 0xff;
    }
  } else if (format === 1) {
    // Godot 16-bit signed LE PCM -> standard WAV 16-bit signed LE PCM
    bitsPerSample = 16;
    pcmData = props.data;
  } else {
    return null;
  }

  const blockAlign = (numChannels * bitsPerSample) / 8;
  const byteRate = sampleRate * blockAlign;
  const dataSize = pcmData.length;
  const wav = Buffer.allocUnsafe(44 + dataSize);

  wav.write('RIFF', 0, 4, 'ascii');
  wav.writeUInt32LE(36 + dataSize, 4);
  wav.write('WAVE', 8, 4, 'ascii');
  wav.write('fmt ', 12, 4, 'ascii');
  wav.writeUInt32LE(16, 16); // PCM fmt chunk size
  wav.writeUInt16LE(1, 20); // AudioFormat = 1 (PCM)
  wav.writeUInt16LE(numChannels, 22);
  wav.writeUInt32LE(sampleRate, 24);
  wav.writeUInt32LE(byteRate, 28);
  wav.writeUInt16LE(blockAlign, 32);
  wav.writeUInt16LE(bitsPerSample, 34);
  wav.write('data', 36, 4, 'ascii');
  wav.writeUInt32LE(dataSize, 40);
  pcmData.copy(wav, 44);

  return wav;
}

// ----------------------------------------------------------------------------
// Asset Target Collection
// ----------------------------------------------------------------------------

interface TextureTarget {
  logicalId: string;
  category: string;
  resPath: string;
}

interface AudioTarget {
  soundKey: string;
  category: 'sfx' | 'music';
  resPath: string;
}

function collectTextureTargets(pck: ReadOnlyPckArchive): TextureTarget[] {
  const targets = new Map<string, TextureTarget>();
  const add = (logicalId: string, category: string, resPath: string): void => {
    if (!logicalId || !resPath || targets.has(logicalId)) return;
    if (!pck.has(`${resPath}.import`) && !pck.has(resPath)) return;
    targets.set(logicalId, { logicalId, category, resPath });
  };

  // Player
  add('player_body', 'player', 'res://entities/units/player/potato.png');
  add('player_legs', 'player', 'res://entities/units/player/legs.png');

  // Characters (all 60 base characters)
  for (const e of pck.entries) {
    const m = e.path.match(/^res:\/\/items\/characters\/([^/]+)\/\1_icon\.png\.import$/i);
    if (m) {
      add(`char_${m[1]}`, 'characters', e.path.replace(/\.import$/i, ''));
    }
  }
  // Fallback for any character whose icon filename differs from <dir>_icon.png
  for (const e of pck.entries) {
    const m = e.path.match(/^res:\/\/items\/characters\/([^/]+)\/\1_data\.tres$/);
    if (!m || targets.has(`char_${m[1]}`)) continue;
    const txt = pck.readText(e.path);
    const iconM = txt?.match(/path="(res:\/\/[^"]+\.png)" type="Texture"/);
    if (iconM) add(`char_${m[1]}`, 'characters', iconM[1]);
  }

  // Weapons (all 80 base weapons: world sprite + icon, plus weapon_id aliases)
  const weaponDirs = new Map<string, 'melee' | 'ranged'>();
  for (const e of pck.entries) {
    const m = e.path.match(/^res:\/\/weapons\/(melee|ranged)\/([^/]+)\//);
    if (m) weaponDirs.set(m[2], m[1] as 'melee' | 'ranged');
  }
  for (const [dirId, kind] of weaponDirs) {
    const base = `res://weapons/${kind}/${dirId}`;
    const worldPng = `${base}/${dirId}.png`;
    const iconPng = `${base}/${dirId}_icon.png`;
    const chosenWorld = pck.has(`${worldPng}.import`)
      ? worldPng
      : pck.has(`${iconPng}.import`)
        ? iconPng
        : null;

    // Detect canonical weapon_id if it differs from directory name (e.g. cacti_club, bloody_vorpal)
    const ids = new Set<string>([dirId]);
    for (const dataEntry of pck.entries) {
      if (!dataEntry.path.startsWith(`${base}/`) || !dataEntry.path.endsWith('_data.tres')) {
        continue;
      }
      const txt = pck.readText(dataEntry.path);
      const widM = txt?.match(/^weapon_id = "([^"]+)"/m);
      if (widM?.[1]) {
        const cleanId = widM[1].replace(/^weapon_/, '');
        if (cleanId) ids.add(cleanId);
        break;
      }
    }

    for (const id of ids) {
      if (chosenWorld) add(`weapon_${id}`, 'weapons', chosenWorld);
      if (pck.has(`${iconPng}.import`)) add(`weapon_icon_${id}`, 'weapons', iconPng);
    }
  }

  // Items (all 00_base_game items + free update items)
  for (const e of pck.entries) {
    if (!e.path.startsWith('res://items/all/') || !e.path.endsWith('.tres')) continue;
    const txt = pck.readText(e.path);
    if (!txt || !txt.includes('res://items/global/item_data.gd')) continue;
    const idM = txt.match(/^my_id = "([^"]+)"/m);
    const iconExtM = txt.match(/^icon = ExtResource\(\s*(\d+)\s*\)/m);
    if (!idM || !iconExtM) continue;
    const pathM = txt.match(
      new RegExp(`\\[ext_resource path="([^"]+)" type="Texture" id=${iconExtM[1]}\\]`)
    );
    if (pathM) {
      const id = idM[1].replace(/^item_/, '');
      add(`item_${id}`, 'items', pathM[1]);
    }
  }

  // Upgrades (16 core stat icons)
  const upgradeDirToStat: Record<string, string> = {
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
  for (const [dir, statKey] of Object.entries(upgradeDirToStat)) {
    const pngImp = pck.entries.find(
      (e) =>
        e.path.startsWith(`res://items/upgrades/${dir}/`) &&
        e.path.toLowerCase().endsWith('.png.import')
    );
    if (pngImp) {
      add(`upgrade_${statKey}`, 'upgrades', pngImp.path.replace(/\.import$/i, ''));
    }
  }

  // Crash Zone Enemies: Basic (28), Elites (8), Bosses (2)
  for (const e of pck.entries) {
    const m = e.path.match(
      /^res:\/\/entities\/units\/enemies\/crash_zone\/(basic|elites|bosses)\/([^/]+)\/([^/]+)\.tscn$/
    );
    if (!m) continue;
    const category = m[1] === 'bosses' ? 'bosses' : m[1] === 'elites' ? 'elites' : 'enemies';
    const dir = m[2];
    const base = `res://entities/units/enemies/crash_zone/${m[1]}/${dir}`;
    const tscn = pck.readText(e.path) ?? '';
    const idM = tscn.match(/^enemy_id = "([^"]+)"/m);
    const enemyId = idM?.[1] ?? dir;

    const candidates = [
      `${base}/${dir}.png`,
      `${base}/${dir}_0.png`,
      `${base}/${enemyId}.png`,
    ];
    let foundSprite = candidates.find((c) => pck.has(`${c}.import`));
    if (!foundSprite) {
      const texM = tscn.match(/path="(res:\/\/[^"]+\.png)" type="Texture"/);
      if (texM && pck.has(`${texM[1]}.import`)) foundSprite = texM[1];
    }
    if (foundSprite) {
      add(`enemy_${enemyId}`, category, foundSprite);
    }
    const iconPng = `${base}/${dir}_icon.png`;
    if (pck.has(`${iconPng}.import`)) {
      add(`enemy_icon_${enemyId}`, category, iconPng);
    }
  }

  // Trees & Structures
  add('tree_0', 'trees', 'res://entities/units/neutral/tree.png');
  add('tree_jungle', 'trees', 'res://entities/units/neutral/tree_jungle.png');
  add('structure_turret', 'structures', 'res://entities/structures/turret/turret.png');
  add(
    'structure_medical_turret',
    'structures',
    'res://entities/structures/turret/healing/healing_turret.png'
  );
  add(
    'structure_laser_turret',
    'structures',
    'res://entities/structures/turret/laser/laser_turret.png'
  );
  add(
    'structure_explosive_turret',
    'structures',
    'res://entities/structures/turret/rocket/rocket_turret.png'
  );
  add(
    'structure_flame_turret',
    'structures',
    'res://entities/structures/turret/flame/flame_turret.png'
  );
  add('structure_mine', 'structures', 'res://entities/structures/landmine/landmine.png');

  // Materials, Consumables & Crates
  for (let i = 0; i <= 10; i++) {
    const idx = String(i).padStart(4, '0');
    add(`material_${i}`, 'materials', `res://items/materials/material_${idx}.png`);
  }
  add('material_bag', 'materials', 'res://items/materials/material_bag.png');
  add('material_ui', 'materials', 'res://items/materials/material_ui.png');
  add('fruit', 'consumables', 'res://items/consumables/fruit/fruit.png');
  add('fruit_jungle', 'consumables', 'res://items/consumables/fruit/fruit_jungle.png');
  add('crate', 'crates', 'res://items/consumables/item_box/item_box.png');
  add('crate_jungle', 'crates', 'res://items/consumables/item_box/item_box_jungle.png');
  add(
    'crate_legendary',
    'crates',
    'res://items/consumables/legendary_item_box/legendary_item_box.png'
  );
  add('spawn_telegraph', 'vfx', 'res://entities/birth/entity_birth.png');

  // Tiles (Crash Zone, Abyss, Jungle)
  for (let i = 1; i <= 6; i++) {
    add(`tile_crash_${i}`, 'tiles', `res://resources/tiles/tiles_${i}.png`);
  }
  for (let i = 0; i <= 2; i++) {
    add(`tile_abyss_${i}`, 'tiles', `res://dlcs/dlc_1/resources/tiles/tiles_${i}.png`);
  }
  add('tile_jungle_1', 'tiles', 'res://resources/tiles/tiles_jungle_1.png');
  add('tile_jungle_2', 'tiles', 'res://resources/tiles/tiles_jungle_2.png');

  // Projectiles & VFX
  const projMap: Array<[string, string]> = [
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
  ];
  for (const [id, resPath] of projMap) add(id, 'projectiles', resPath);

  // UI Icons
  const uiMap: Array<[string, string]> = [
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
  for (const [id, resPath] of uiMap) add(id, 'ui', resPath);

  return [...targets.values()];
}

function findFirstAudioInDir(pck: ReadOnlyPckArchive, prefix: string): string | null {
  const hit = pck.entries.find(
    (e) =>
      e.path.startsWith(prefix) &&
      (e.path.endsWith('.wav.import') || e.path.endsWith('.mp3.import'))
  );
  return hit ? hit.path.replace(/\.import$/, '') : null;
}

function collectAudioTargets(pck: ReadOnlyPckArchive): AudioTarget[] {
  const targets = new Map<string, AudioTarget>();
  const add = (soundKey: string, category: 'sfx' | 'music', resPath: string | null): void => {
    if (!soundKey || !resPath || targets.has(soundKey)) return;
    if (!pck.has(`${resPath}.import`)) return;
    targets.set(soundKey, { soundKey, category, resPath });
  };

  // Weapon SFX covering all WeaponSoundKind variants
  add('sfx_weapon_pistol', 'sfx', findFirstAudioInDir(pck, 'res://weapons/ranged/pistol/'));
  add('sfx_weapon_smg', 'sfx', findFirstAudioInDir(pck, 'res://weapons/ranged/smg/'));
  add(
    'sfx_weapon_shotgun',
    'sfx',
    findFirstAudioInDir(pck, 'res://weapons/ranged/double_barrel_shotgun/') ??
      findFirstAudioInDir(pck, 'res://weapons/ranged/combat_shotgun/')
  );
  add('sfx_weapon_laser', 'sfx', findFirstAudioInDir(pck, 'res://weapons/ranged/laser_gun/'));
  add('sfx_weapon_sniper', 'sfx', findFirstAudioInDir(pck, 'res://weapons/ranged/sniper_gun/'));
  add(
    'sfx_weapon_rocket',
    'sfx',
    findFirstAudioInDir(pck, 'res://weapons/ranged/rocket_launcher/')
  );
  add('sfx_weapon_flame', 'sfx', findFirstAudioInDir(pck, 'res://weapons/ranged/flamethrower/'));
  add(
    'sfx_weapon_magic',
    'sfx',
    findFirstAudioInDir(pck, 'res://weapons/ranged/wand/') ??
      findFirstAudioInDir(pck, 'res://weapons/ranged/taser/')
  );
  add(
    'sfx_weapon_throw',
    'sfx',
    findFirstAudioInDir(pck, 'res://weapons/ranged/slingshot/') ??
      findFirstAudioInDir(pck, 'res://weapons/ranged/shuriken/')
  );
  add(
    'sfx_weapon_musical',
    'sfx',
    findFirstAudioInDir(pck, 'res://weapons/ranged/pan_flute/') ??
      findFirstAudioInDir(pck, 'res://dlcs/dlc_1/weapons/melee/lute/')
  );
  add(
    'sfx_weapon_melee_light',
    'sfx',
    'res://weapons/melee_sounds/whoosh_weapon_knife_swing_01.wav'
  );
  add(
    'sfx_weapon_melee_heavy',
    'sfx',
    pck.entries
      .find(
        (e) =>
          e.path.startsWith('res://weapons/melee_sounds/') &&
          e.path.endsWith('.wav.import') &&
          (e.path.includes('heavy') || e.path.includes('hammer') || e.path.includes('axe') || e.path.includes('swoosh'))
      )
      ?.path.replace(/\.import$/, '') ??
      findFirstAudioInDir(pck, 'res://weapons/melee_sounds/')
  );
  add(
    'sfx_weapon_melee_blade',
    'sfx',
    pck.entries
      .find(
        (e) =>
          e.path.startsWith('res://weapons/melee_sounds/') &&
          e.path.endsWith('.wav.import') &&
          (e.path.includes('sword') || e.path.includes('blade') || e.path.includes('knife_swing_02'))
      )
      ?.path.replace(/\.import$/, '') ??
      'res://weapons/melee_sounds/whoosh_weapon_knife_swing_02.wav'
  );

  // Combat, pickup, wave & UI SFX
  add('sfx_explosion', 'sfx', 'res://projectiles/rocket/explosion_small_no_tail_01.wav');
  add('sfx_burn', 'sfx', 'res://resources/sounds/burn/fireball_impact_burn_01.wav');
  add('sfx_pickup_material', 'sfx', 'res://items/materials/water_drop_drip_single_01.wav');
  add(
    'sfx_pickup_material_alt',
    'sfx',
    'res://items/materials/alt_sounds/coin_bag_ring_gemstone_item_01.wav'
  );
  add('sfx_pickup_fruit', 'sfx', 'res://items/consumables/fruit/comedy_bite_chew_01.wav');
  add('sfx_pickup_crate', 'sfx', 'res://items/consumables/item_box/item_box_pickup.wav');
  add('sfx_level_up', 'sfx', 'res://resources/sounds/level_up.wav');
  add('sfx_harvest', 'sfx', 'res://resources/sounds/harvest/cartoon_boing_jump_01.wav');
  add('sfx_wave_end', 'sfx', 'res://ui/sounds/end_wave.wav');
  add('sfx_ui_hover', 'sfx', 'res://ui/sounds/button_focus.wav');
  add('sfx_ui_confirm', 'sfx', 'res://ui/sounds/button_press.wav');
  add('sfx_ui_cancel', 'sfx', 'res://ui/sounds/inventory_element_focus.wav');
  add('sfx_ui_buy', 'sfx', 'res://ui/sounds/buy.wav');
  add('sfx_ui_error', 'sfx', 'res://ui/sounds/cant_buy.wav');
  add('sfx_ui_reroll', 'sfx', 'res://ui/sounds/diceroll.wav');
  add('sfx_ui_combine', 'sfx', 'res://ui/sounds/CGM3_Bubble_Button_01_3.wav');
  add('sfx_tick', 'sfx', 'res://ui/sounds/clock_tick_01.wav');
  add('sfx_spawn_begin', 'sfx', 'res://entities/birth/birth_begin_sound.wav');
  add('sfx_spawn_end', 'sfx', 'res://entities/birth/birth_end_sound.wav');
  add('sfx_enemy_hit', 'sfx', 'res://resources/sounds/zombie_voice_attack_grunt_01.wav');
  add('sfx_shield', 'sfx', 'res://ui/sounds/Shield 4.mp3');
  add('sfx_step', 'sfx', 'res://entities/units/player/step_sounds/Step 1.mp3');

  // Representative Music Tracks (.mp3str -> .mp3)
  add(
    'music_menu',
    'music',
    'res://resources/music/after-midnight by luke-melville Artlist.mp3'
  );
  add(
    'music_combat_0',
    'music',
    'res://resources/music/density-wave by _aviad-zinemanas__ Artlist.mp3'
  );
  add(
    'music_combat_1',
    'music',
    'res://resources/music/wasteland-survivors by evgeny-bardyuzha Artlist.mp3'
  );
  add(
    'music_combat_2',
    'music',
    'res://resources/music/time-jumper by 2050 Artlist.mp3'
  );
  add(
    'music_boss',
    'music',
    'res://resources/music/extreme-chaos by 2050 Artlist.mp3'
  );
  add(
    'music_elite',
    'music',
    'res://resources/music/power-punch by 2050 Artlist.mp3'
  );
  add(
    'music_abyss',
    'music',
    'res://dlcs/dlc_1/resources/music/Adonai - Currents.mp3'
  );
  add(
    'music_jungle',
    'music',
    'res://resources/music/streamer_mode/Primal Dread - 1st track (V2).mp3'
  );

  return [...targets.values()];
}

// ----------------------------------------------------------------------------
// Main
// ----------------------------------------------------------------------------

function main(): void {
  const pckPath = process.env.KRUNKED_PCK_PATH || DEFAULT_PCK_PATH;
  if (!fs.existsSync(pckPath)) {
    console.log(
      `[extract-assets] Local .pck archive not found at "${pckPath}". Skipping extraction (exit 0).`
    );
    process.exit(0);
  }

  fs.mkdirSync(TEXTURES_DIR, { recursive: true });
  fs.mkdirSync(AUDIO_DIR, { recursive: true });

  const pck = new ReadOnlyPckArchive(pckPath);
  try {
    const textureTargets = collectTextureTargets(pck);
    const audioTargets = collectAudioTargets(pck);

    const texturesManifest: Record<string, string> = {};
    const audioManifest: Record<string, string> = {};
    const categoryCounts: Record<string, number> = {};
    let webpCount = 0;
    let pngCount = 0;
    let skippedTextures = 0;

    for (const target of textureTargets) {
      const stexPath = resolveImportTarget(pck, target.resPath);
      if (!stexPath) {
        skippedTextures++;
        continue;
      }
      const stexBytes = pck.readBytes(stexPath);
      if (!stexBytes) {
        skippedTextures++;
        continue;
      }
      const decoded = decodeStex(stexBytes);
      if (!decoded) {
        skippedTextures++;
        continue;
      }

      const fileName = `${target.logicalId}.${decoded.ext}`;
      fs.writeFileSync(path.join(TEXTURES_DIR, fileName), decoded.bytes);
      texturesManifest[target.logicalId] = `textures/${fileName}`;
      categoryCounts[target.category] = (categoryCounts[target.category] ?? 0) + 1;
      if (decoded.ext === 'webp') webpCount++;
      else pngCount++;
    }

    let wavCount = 0;
    let mp3Count = 0;
    let skippedAudio = 0;

    for (const target of audioTargets) {
      const impTarget = resolveImportTarget(pck, target.resPath);
      if (!impTarget) {
        skippedAudio++;
        continue;
      }
      const rawBytes = pck.readBytes(impTarget);
      if (!rawBytes) {
        skippedAudio++;
        continue;
      }
      const props = parseRsrcAudio(rawBytes);
      if (!props?.data || props.data.length === 0) {
        skippedAudio++;
        continue;
      }

      if (impTarget.endsWith('.mp3str')) {
        const fileName = `${target.soundKey}.mp3`;
        fs.writeFileSync(path.join(AUDIO_DIR, fileName), props.data);
        audioManifest[target.soundKey] = `audio/${fileName}`;
        mp3Count++;
      } else if (impTarget.endsWith('.sample')) {
        const wavBytes = encodeWavFromSample(props);
        if (!wavBytes) {
          skippedAudio++;
          continue;
        }
        const fileName = `${target.soundKey}.wav`;
        fs.writeFileSync(path.join(AUDIO_DIR, fileName), wavBytes);
        audioManifest[target.soundKey] = `audio/${fileName}`;
        wavCount++;
      } else {
        skippedAudio++;
      }
    }

    const manifest = {
      version: 1,
      generatedAt: new Date().toISOString(),
      textures: texturesManifest,
      audio: audioManifest,
      counts: {
        textures: Object.keys(texturesManifest).length,
        texturesWebp: webpCount,
        texturesPng: pngCount,
        audio: Object.keys(audioManifest).length,
        audioWav: wavCount,
        audioMp3: mp3Count,
        skippedTextures,
        skippedAudio,
        categories: categoryCounts,
      },
    };

    fs.writeFileSync(MANIFEST_PATH, JSON.stringify(manifest, null, 2), 'utf8');

    console.log(`[extract-assets] Wrote ${MANIFEST_PATH}`);
    console.log(
      `[extract-assets] Extracted ${manifest.counts.textures} textures (${webpCount} WebP, ${pngCount} PNG) and ${manifest.counts.audio} audio tracks (${wavCount} WAV, ${mp3Count} MP3).`
    );
    console.log('[extract-assets] Texture categories:', categoryCounts);
  } finally {
    pck.close();
  }
}

main();
