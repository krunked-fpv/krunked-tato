// ============================================================================
// src/app/SaveManager.ts — Schema-Validated Persistence & Corruption Recovery
// ============================================================================

import {
  SAVE_SCHEMA_VERSION,
  SAVE_STORAGE_KEY,
  type ActiveRunSnapshot,
  type AssetMode,
  type AudioSettings,
  type KeyBindings,
  type RenderSettings,
  type SaveData,
  type SimState,
  type TargetFps,
  type TouchSettings,
} from '../contracts/index';

export function createDefaultRenderSettings(): RenderSettings {
  return {
    targetFps: 120,
    classicSnap60: false,
    screenShake: true,
    damageNumbers: true,
    hitFlash: true,
  };
}

export function createDefaultAudioSettings(): AudioSettings {
  return {
    masterVolume: 0.8,
    sfxVolume: 0.85,
    musicVolume: 0.65,
    muted: false,
  };
}

export function createDefaultTouchSettings(): TouchSettings {
  return {
    idleOpacity: 0.24,
    activeOpacity: 0.46,
    leftHanded: false,
  };
}

export function createDefaultKeyBindings(): KeyBindings {
  return {
    moveUp: 'KeyW',
    moveDown: 'KeyS',
    moveLeft: 'KeyA',
    moveRight: 'KeyD',
    toggleAutoAim: 'KeyM',
    pause: 'Escape',
    stats: 'Tab',
  };
}

export function createDefaultSaveData(): SaveData {
  return {
    schemaVersion: SAVE_SCHEMA_VERSION,
    assetMode: 'BUILTIN',
    renderSettings: createDefaultRenderSettings(),
    audioSettings: createDefaultAudioSettings(),
    touchSettings: createDefaultTouchSettings(),
    keyBindings: createDefaultKeyBindings(),
    highestDangerCleared: -1,
    characterMaxDanger: {},
    unlockedChallenges: [],
    lifetimeKills: 0,
    lifetimeRuns: 0,
    lifetimeWins: 0,
    activeRun: null,
  };
}

function clampNum(v: unknown, min: number, max: number, fallback: number): number {
  if (typeof v !== 'number' || !Number.isFinite(v)) return fallback;
  return Math.max(min, Math.min(max, v));
}

function asBool(v: unknown, fallback: boolean): boolean {
  return typeof v === 'boolean' ? v : fallback;
}

function asStr(v: unknown, fallback: string): string {
  return typeof v === 'string' && v.length > 0 ? v : fallback;
}

function validateTargetFps(v: unknown): TargetFps {
  if (v === 30 || v === 60 || v === 120) return v;
  return 120;
}

function validateAssetMode(v: unknown): AssetMode {
  return v === 'CUSTOM_PACK' ? 'CUSTOM_PACK' : 'BUILTIN';
}

function validateActiveRun(raw: unknown): ActiveRunSnapshot | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (
    typeof r.seed !== 'number' ||
    !Number.isFinite(r.seed) ||
    typeof r.wave !== 'number' ||
    !Number.isFinite(r.wave) ||
    r.wave < 1 ||
    !r.player ||
    typeof r.player !== 'object'
  ) {
    return null;
  }
  const p = r.player as Record<string, unknown>;
  if (
    typeof p.characterId !== 'string' ||
    !Array.isArray(p.weapons) ||
    !Array.isArray(p.items) ||
    typeof p.hp !== 'number' ||
    !Number.isFinite(p.hp)
  ) {
    return null;
  }
  const zoneId = r.zoneId === 1 || r.zoneId === 2 ? r.zoneId : 0;
  return {
    seed: r.seed >>> 0,
    rngState: typeof r.rngState === 'number' && Number.isFinite(r.rngState) ? r.rngState >>> 0 : r.seed >>> 0,
    wave: Math.max(1, Math.floor(r.wave)),
    zoneId,
    dangerLevel: clampNum(r.dangerLevel, 0, 6, 0),
    isEndless: asBool(r.isEndless, false),
    screen:
      r.screen === 'shop' || r.screen === 'level_up' || r.screen === 'crate_modal' || r.screen === 'combat'
        ? r.screen
        : 'shop',
    player: structuredClone(r.player) as ActiveRunSnapshot['player'],
    shop:
      r.shop && typeof r.shop === 'object'
        ? (structuredClone(r.shop) as ActiveRunSnapshot['shop'])
        : { offers: [], rerollCount: 0, freeRerollsLeft: 0, rerollCost: 2 },
    levelUp:
      r.levelUp && typeof r.levelUp === 'object'
        ? (structuredClone(r.levelUp) as ActiveRunSnapshot['levelUp'])
        : { offers: [], rerollCount: 0, rerollCost: 2, remainingLevelUps: 0 },
    crateModal:
      r.crateModal && typeof r.crateModal === 'object'
        ? (structuredClone(r.crateModal) as ActiveRunSnapshot['crateModal'])
        : { pendingCrates: [] },
    runStats:
      r.runStats && typeof r.runStats === 'object'
        ? (structuredClone(r.runStats) as ActiveRunSnapshot['runStats'])
        : {
            kills: 0,
            elitesKilled: 0,
            bossesKilled: 0,
            damageDealt: 0,
            damageTaken: 0,
            materialsCollected: 0,
            cratesOpened: 0,
            treesChopped: 0,
            critsLanded: 0,
            dodges: 0,
            waveReached: Math.max(1, Math.floor(r.wave)),
            ticksPlayed: 0,
          },
    autoAim: asBool(r.autoAim, true),
  };
}

export function validateSaveData(raw: unknown): SaveData {
  const def = createDefaultSaveData();
  if (!raw || typeof raw !== 'object') return def;
  const obj = raw as Record<string, unknown>;

  const rs = (obj.renderSettings && typeof obj.renderSettings === 'object'
    ? obj.renderSettings
    : {}) as Record<string, unknown>;
  const as = (obj.audioSettings && typeof obj.audioSettings === 'object'
    ? obj.audioSettings
    : {}) as Record<string, unknown>;
  const ts = (obj.touchSettings && typeof obj.touchSettings === 'object'
    ? obj.touchSettings
    : {}) as Record<string, unknown>;
  const kb = (obj.keyBindings && typeof obj.keyBindings === 'object'
    ? obj.keyBindings
    : {}) as Record<string, unknown>;

  const charMaxDanger: Record<string, number> = {};
  if (obj.characterMaxDanger && typeof obj.characterMaxDanger === 'object') {
    for (const [k, v] of Object.entries(obj.characterMaxDanger as Record<string, unknown>)) {
      if (typeof v === 'number' && Number.isFinite(v)) {
        charMaxDanger[k] = Math.max(-1, Math.min(6, Math.floor(v)));
      }
    }
  }

  const unlockedChallenges: string[] = Array.isArray(obj.unlockedChallenges)
    ? obj.unlockedChallenges.filter((x): x is string => typeof x === 'string')
    : [];

  return {
    schemaVersion: SAVE_SCHEMA_VERSION,
    assetMode: validateAssetMode(obj.assetMode),
    renderSettings: {
      targetFps: validateTargetFps(rs.targetFps),
      classicSnap60: asBool(rs.classicSnap60, def.renderSettings.classicSnap60),
      screenShake: asBool(rs.screenShake, def.renderSettings.screenShake),
      damageNumbers: asBool(rs.damageNumbers, def.renderSettings.damageNumbers),
      hitFlash: asBool(rs.hitFlash, def.renderSettings.hitFlash),
    },
    audioSettings: {
      masterVolume: clampNum(as.masterVolume, 0, 1, def.audioSettings.masterVolume),
      sfxVolume: clampNum(as.sfxVolume, 0, 1, def.audioSettings.sfxVolume),
      musicVolume: clampNum(as.musicVolume, 0, 1, def.audioSettings.musicVolume),
      muted: asBool(as.muted, def.audioSettings.muted),
    },
    touchSettings: {
      idleOpacity: clampNum(ts.idleOpacity, 0.1, 0.55, def.touchSettings.idleOpacity),
      activeOpacity: clampNum(ts.activeOpacity, 0.2, 0.59, def.touchSettings.activeOpacity),
      leftHanded: asBool(ts.leftHanded, def.touchSettings.leftHanded),
    },
    keyBindings: {
      moveUp: asStr(kb.moveUp, def.keyBindings.moveUp),
      moveDown: asStr(kb.moveDown, def.keyBindings.moveDown),
      moveLeft: asStr(kb.moveLeft, def.keyBindings.moveLeft),
      moveRight: asStr(kb.moveRight, def.keyBindings.moveRight),
      toggleAutoAim: asStr(kb.toggleAutoAim, def.keyBindings.toggleAutoAim),
      pause: asStr(kb.pause, def.keyBindings.pause),
      stats: asStr(kb.stats, def.keyBindings.stats),
    },
    highestDangerCleared: Math.floor(clampNum(obj.highestDangerCleared, -1, 6, -1)),
    characterMaxDanger: charMaxDanger,
    unlockedChallenges,
    lifetimeKills: Math.max(0, Math.floor(clampNum(obj.lifetimeKills, 0, 1e9, 0))),
    lifetimeRuns: Math.max(0, Math.floor(clampNum(obj.lifetimeRuns, 0, 1e9, 0))),
    lifetimeWins: Math.max(0, Math.floor(clampNum(obj.lifetimeWins, 0, 1e9, 0))),
    activeRun: validateActiveRun(obj.activeRun),
  };
}

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export class SaveManager {
  private readonly storage: StorageLike | null;
  private readonly key: string;
  private data: SaveData;

  constructor(storage?: StorageLike | null, key = SAVE_STORAGE_KEY) {
    this.key = key;
    if (storage !== undefined) {
      this.storage = storage;
    } else if (typeof window !== 'undefined' && typeof window.localStorage !== 'undefined') {
      this.storage = window.localStorage;
    } else {
      this.storage = null;
    }
    this.data = this.load();
  }

  load(): SaveData {
    if (!this.storage) {
      this.data = createDefaultSaveData();
      return this.data;
    }
    try {
      const raw = this.storage.getItem(this.key);
      if (!raw) {
        this.data = createDefaultSaveData();
        return this.data;
      }
      const parsed: unknown = JSON.parse(raw);
      this.data = validateSaveData(parsed);
      return this.data;
    } catch {
      // Corruption recovery: reset cleanly and persist defaults
      this.data = createDefaultSaveData();
      this.save();
      return this.data;
    }
  }

  get(): SaveData {
    return this.data;
  }

  save(): void {
    if (!this.storage) return;
    try {
      this.storage.setItem(this.key, JSON.stringify(this.data));
    } catch {
      // Ignore quota / private browsing errors safely
    }
  }

  update(patch: Partial<SaveData>): SaveData {
    this.data = validateSaveData({ ...this.data, ...patch });
    this.save();
    return this.data;
  }

  saveActiveRun(state: SimState): void {
    const screen =
      state.screen === 'shop' || state.screen === 'level_up' || state.screen === 'crate_modal'
        ? state.screen
        : 'shop';
    this.data.activeRun = {
      seed: state.seed,
      rngState: state.rngState,
      wave: state.wave,
      zoneId: state.zoneId,
      dangerLevel: state.dangerLevel,
      isEndless: state.isEndless,
      screen,
      player: structuredClone(state.player),
      shop: structuredClone(state.shop),
      levelUp: structuredClone(state.levelUp),
      crateModal: structuredClone(state.crateModal),
      runStats: structuredClone(state.runStats),
      autoAim: state.autoAim,
    };
    this.save();
  }

  clearActiveRun(): void {
    this.data.activeRun = null;
    this.save();
  }

  recordRunEnd(state: SimState, won: boolean): void {
    this.data.lifetimeRuns += 1;
    this.data.lifetimeKills += state.runStats.kills;
    if (won) {
      this.data.lifetimeWins += 1;
      if (state.dangerLevel > this.data.highestDangerCleared) {
        this.data.highestDangerCleared = state.dangerLevel;
      }
      const prevCharDanger = this.data.characterMaxDanger[state.player.characterId] ?? -1;
      if (state.dangerLevel > prevCharDanger) {
        this.data.characterMaxDanger[state.player.characterId] = state.dangerLevel;
      }
      const chalId = `win_${state.player.characterId}`;
      if (!this.data.unlockedChallenges.includes(chalId)) {
        this.data.unlockedChallenges.push(chalId);
      }
      const dangerChal = `win_danger_${state.dangerLevel}`;
      if (!this.data.unlockedChallenges.includes(dangerChal)) {
        this.data.unlockedChallenges.push(dangerChal);
      }
    }
    this.data.activeRun = null;
    this.save();
  }

  reset(): SaveData {
    this.data = createDefaultSaveData();
    if (this.storage) {
      try {
        this.storage.removeItem(this.key);
      } catch {
        // Ignore storage error
      }
    }
    this.save();
    return this.data;
  }
}
