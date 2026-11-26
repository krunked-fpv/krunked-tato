// ============================================================================
// tests/input-save-assets.test.ts — Gate B TouchOverlay, SaveManager, Audio, Assets
// ============================================================================

import { describe, expect, it } from 'vitest';
import { SAVE_SCHEMA_VERSION, SAVE_STORAGE_KEY } from '../src/contracts/index';
import { SaveManager, validateSaveData, type StorageLike } from '../src/app/SaveManager';
import { AssetRegistry } from '../src/assets/AssetRegistry';
import { AudioEngine } from '../src/audio/AudioEngine';
import { GAME_CATALOG } from '../src/data/index';
import { TouchOverlay } from '../src/input/TouchOverlay';
import { createInitialSimState, startNewRun } from '../src/sim/index';

class MemoryStorage implements StorageLike {
  public readonly map = new Map<string, string>();
  getItem(key: string): string | null {
    return this.map.has(key) ? this.map.get(key)! : null;
  }
  setItem(key: string, value: string): void {
    this.map.set(key, value);
  }
  removeItem(key: string): void {
    this.map.delete(key);
  }
}

describe('TouchOverlay Auto-Hide Visibility State Machine', () => {
  it('stays hidden in keyboard & gamepad modes, reveals translucent in touch mode, and hides again on keyboard', () => {
    const overlay = new TouchOverlay(null, {
      onToggleAutoAim: () => {},
      onToggleStats: () => {},
      onPause: () => {},
      onTouchDetected: () => {},
    });

    // Initial default: keyboard -> hidden
    expect(overlay.getStatus()).toEqual({ visible: false, opacity: 0, mode: 'keyboard' });

    // Switch to touch -> visible with 0 < opacity < 0.6
    overlay.setInputMode('touch');
    const touchStatus = overlay.getStatus();
    expect(touchStatus.visible).toBe(true);
    expect(touchStatus.mode).toBe('touch');
    expect(touchStatus.opacity).toBeGreaterThan(0);
    expect(touchStatus.opacity).toBeLessThan(0.6);

    // Excessive user opacity settings are strictly clamped below 0.6
    overlay.applySettings({ idleOpacity: 0.99, activeOpacity: 1.0, leftHanded: true });
    const clampedTouch = overlay.getStatus();
    expect(clampedTouch.visible).toBe(true);
    expect(clampedTouch.opacity).toBeLessThan(0.6);

    // Switch to gamepad -> completely hidden
    overlay.setInputMode('gamepad');
    expect(overlay.getStatus()).toEqual({ visible: false, opacity: 0, mode: 'gamepad' });

    // Switch back to touch -> visible again
    overlay.setInputMode('touch');
    expect(overlay.getStatus().visible).toBe(true);

    // Switch to keyboard -> completely hidden
    overlay.setInputMode('keyboard');
    expect(overlay.getStatus()).toEqual({ visible: false, opacity: 0, mode: 'keyboard' });

    overlay.dispose();
  });
});

describe('SaveManager Persistence, Validation & Corruption Recovery', () => {
  it('persists under krunked_tato_save_v1 and clamps invalid settings cleanly', () => {
    const storage = new MemoryStorage();
    const sm = new SaveManager(storage);

    const validated = validateSaveData({
      assetMode: 'INVALID_MODE',
      renderSettings: { targetFps: 999, classicSnap60: 'nope', screenShake: false },
      audioSettings: { masterVolume: 5, sfxVolume: -3, musicVolume: Number.NaN, muted: true },
      touchSettings: { idleOpacity: 0.95, activeOpacity: 0.01, leftHanded: true },
      highestDangerCleared: 99,
      lifetimeKills: -100,
    });

    expect(validated.schemaVersion).toBe(SAVE_SCHEMA_VERSION);
    expect(validated.assetMode).toBe('BUILTIN');
    expect(validated.renderSettings.targetFps).toBe(120);
    expect(validated.renderSettings.classicSnap60).toBe(false);
    expect(validated.renderSettings.screenShake).toBe(false);
    expect(validated.audioSettings.masterVolume).toBe(1);
    expect(validated.audioSettings.sfxVolume).toBe(0);
    expect(validated.audioSettings.musicVolume).toBe(0.65);
    expect(validated.audioSettings.muted).toBe(true);
    expect(validated.touchSettings.idleOpacity).toBeLessThanOrEqual(0.55);
    expect(validated.touchSettings.activeOpacity).toBeGreaterThanOrEqual(0.2);
    expect(validated.touchSettings.activeOpacity).toBeLessThan(0.6);
    expect(validated.highestDangerCleared).toBe(6);
    expect(validated.lifetimeKills).toBe(0);

    sm.update({ audioSettings: { masterVolume: 0.5, sfxVolume: 0.4, musicVolume: 0.3, muted: false } });
    expect(storage.getItem(SAVE_STORAGE_KEY)).toBeTruthy();

    const reloaded = new SaveManager(storage);
    expect(reloaded.get().audioSettings.masterVolume).toBe(0.5);
  });

  it('saves/reloads active runs and records run completion unlocks cleanly', () => {
    const storage = new MemoryStorage();
    const sm = new SaveManager(storage);

    const sim = createInitialSimState(5555);
    startNewRun(sim, {
      type: 'start_run',
      characterId: 'knight',
      weaponId: 'sword',
      zoneId: 1,
      dangerLevel: 5,
      seed: 5555,
    });
    sim.wave = 12;
    sim.screen = 'shop';
    sim.runStats.kills = 240;

    sm.saveActiveRun(sim);
    const reloaded = new SaveManager(storage);
    expect(reloaded.get().activeRun).not.toBeNull();
    expect(reloaded.get().activeRun?.wave).toBe(12);
    expect(reloaded.get().activeRun?.zoneId).toBe(1);
    expect(reloaded.get().activeRun?.dangerLevel).toBe(5);
    expect(reloaded.get().activeRun?.player.characterId).toBe('knight');

    reloaded.recordRunEnd(sim, true);
    const afterWin = new SaveManager(storage).get();
    expect(afterWin.activeRun).toBeNull();
    expect(afterWin.lifetimeRuns).toBe(1);
    expect(afterWin.lifetimeWins).toBe(1);
    expect(afterWin.lifetimeKills).toBe(240);
    expect(afterWin.highestDangerCleared).toBe(5);
    expect(afterWin.characterMaxDanger['knight']).toBe(5);
    expect(afterWin.unlockedChallenges).toContain('win_knight');
    expect(afterWin.unlockedChallenges).toContain('win_danger_5');
  });

  it('recovers gracefully from corrupted JSON without throwing', () => {
    const storage = new MemoryStorage();
    storage.setItem(SAVE_STORAGE_KEY, '{not valid json!!! [[[broken');

    const sm = new SaveManager(storage);
    const data = sm.get();
    expect(data.schemaVersion).toBe(SAVE_SCHEMA_VERSION);
    expect(data.assetMode).toBe('BUILTIN');
    expect(data.activeRun).toBeNull();

    // Storage was overwritten with clean JSON defaults
    expect(() => JSON.parse(storage.getItem(SAVE_STORAGE_KEY)!)).not.toThrow();
  });
});

describe('AudioEngine Headless Safety', () => {
  it('runs full API surface in headless Node without throwing', () => {
    const audio = new AudioEngine();
    expect(() => audio.unlock()).not.toThrow();
    expect(() =>
      audio.applySettings({ masterVolume: 0.7, sfxVolume: 0.8, musicVolume: 0.5, muted: false }),
    ).not.toThrow();
    expect(() => audio.updateMusic('title', false, false, 0)).not.toThrow();
    expect(() => audio.updateMusic('combat', true, false, 1)).not.toThrow();
    expect(() => audio.updateMusic('pause', true, false, 1)).not.toThrow();
    expect(() =>
      audio.processEvents(
        [
          { type: 'weapon_fire', weaponId: 'pistol', soundKind: 'pistol', x: 500, y: 500, angle: 0, isMelee: false },
          { type: 'enemy_hit', x: 600, y: 500, damage: 12, isCrit: true, enemyId: 'baby_alien', isBoss: false },
          { type: 'pickup_material', x: 510, y: 500, value: 2, isBoosted: true },
          { type: 'explosion', x: 550, y: 520, radius: 120, color: '#ff6622' },
          { type: 'level_up', level: 1, x: 500, y: 500 },
        ],
        500,
      ),
    ).not.toThrow();
    expect(() => audio.playNamedSfx('sfx_burn', 500, 500)).not.toThrow();
    expect(() => audio.playUiClick('buy')).not.toThrow();
    expect(() => audio.setCustomAudioBuffers(new Map())).not.toThrow();
    expect(() => audio.dispose()).not.toThrow();
  });
});

describe('AssetRegistry Headless Safety', () => {
  it('initializes cleanly in BUILTIN mode and falls back safely when CUSTOM_PACK is unavailable', async () => {
    const registry = new AssetRegistry();
    expect(registry.getMode()).toBe('BUILTIN');

    registry.prepareCatalog(GAME_CATALOG);
    const charRegion = registry.getRegion('char_well_rounded');
    const bossRegion = registry.getRegion('enemy_predator');
    expect(charRegion.w).toBeGreaterThan(0);
    expect(bossRegion.w).toBeGreaterThan(0);
    expect(charRegion.u1).toBeGreaterThan(charRegion.u0);

    // Attempting CUSTOM_PACK without a pack falls back cleanly to BUILTIN
    const modeAfter = await registry.setMode('CUSTOM_PACK');
    expect(modeAfter).toBe('BUILTIN');
    expect(registry.getMode()).toBe('BUILTIN');
    expect(registry.getCustomPackStatus().active).toBe(false);

    // Headless icon data URL returns empty string safely without DOM canvas
    expect(registry.getIconDataUrl('char_well_rounded')).toBe('');

    const atlas = registry.getActiveAtlas();
    expect(atlas.regions.size).toBeGreaterThan(100);
  });
});
