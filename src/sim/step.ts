// ============================================================================
// src/sim/step.ts — Master 60 Hz Deterministic Simulation Step & Command Router
// ============================================================================

import {
  ARENA_H,
  ARENA_W,
  END_WAVE_TICKS,
  FIXED_DT,
  HARVEST_TICKS,
  MANUAL_CROSSHAIR_DIST,
  PLAYER_BASE_MAX_HP,
  PLAYER_MOVE_RADIUS,
  PLAYABLE_MAX_X,
  PLAYABLE_MAX_Y,
  PLAYABLE_MIN_X,
  PLAYABLE_MIN_Y,
  getWeaponAnchorOffset,
  type EquippedWeaponState,
  type GameDataCatalog,
  type InputFrame,
  type SimCommand,
  type SimEconomyHooks,
  type SimState,
} from '../contracts/index';
import { updateBossEntity } from './bosses';
import {
  addXp,
  damageEnemy,
  updateEnemyBurn,
  updateHazards,
  updatePickups,
  updatePlayerTickEffects,
  updateProjectiles,
  updateStructures,
  updateWeapons,
} from './combat';
import { triggerEffects } from './effects';
import { updateEnemies } from './enemies';
import { allocUid, createRngFn, normalizeSeed } from './prng';
import { SpatialHashGrid } from './spatial';
import {
  spawnBossDirect,
  spawnEliteDirect,
  startWave,
  updateWaveSpawner,
} from './spawner';
import {
  clamp,
  computeMoveSpeed,
  createDefaultStatMap,
  recomputePlayerStats,
  xpNeededForLevel,
} from './stats';

// Single reusable spatial grid for zero-GC 60 Hz queries
const sharedEnemyGrid = new SpatialHashGrid(ARENA_W, ARENA_H);

/**
 * Helper to create a cleanly initialized `EquippedWeaponState`.
 */
export function createEquippedWeapon(
  state: SimState,
  weaponId: string,
  tier: 1 | 2 | 3 | 4,
): EquippedWeaponState {
  const px = state.player.x;
  const py = state.player.y - 24;
  return {
    uid: allocUid(state),
    weaponId,
    tier,
    cooldownTicks: 0,
    maxCooldownTicks: 30,
    aimAngle: 0,
    recoilOffset: 0,
    recoilTimer: 0,
    swingTimer: 0,
    swingDuration: 10,
    swingType: 0,
    swingDir: 1,
    alternateNext: 0,
    targetEnemyUid: 0,
    killsThisRun: 0,
    bonusDamage: 0,
    worldX: px,
    worldY: py,
    prevWorldX: px,
    prevWorldY: py,
  };
}

/**
 * Constructs a clean initial `SimState` positioned on the Title screen.
 */
export function createInitialSimState(
  catalog: GameDataCatalog,
  seed = 1337,
): SimState {
  const normSeed = normalizeSeed(seed);
  const defaultChar =
    catalog.charactersById['well_rounded']?.id ??
    catalog.characters[0]?.id ??
    'well_rounded';
  const defaultWeapon =
    catalog.weaponsById['pistol']?.id ??
    catalog.weapons[0]?.id ??
    'pistol';

  const centerX = ARENA_W * 0.5;
  const centerY = ARENA_H * 0.5;

  const state: SimState = {
    seed: normSeed,
    rngState: normSeed,
    tick: 0,
    nextUid: 1,
    screen: 'title',
    previousScreen: 'title',
    zoneId: 0,
    dangerLevel: 0,
    wave: 1,
    isEndless: false,
    isHordeWave: false,
    isEliteWave: false,
    isBossWave: false,
    nightmareEvent: 'none',
    waveDurationTicks: 20 * 60,
    waveElapsedTicks: 0,
    waveEndTimer: 0,
    harvestTimer: 0,
    harvestPaid: false,
    autoAim: true,
    manualAimWorldX: centerX + MANUAL_CROSSHAIR_DIST,
    manualAimWorldY: centerY,
    aimActive: false,
    spawnerGroupTimers: [],
    treeSpawnTimer: 600,
    lootAlienSpawned: false,
    bossSpawned: false,
    eliteSpawned: false,
    player: {
      x: centerX,
      y: centerY,
      prevX: centerX,
      prevY: centerY,
      vx: 0,
      vy: 0,
      facingX: 1,
      hp: PLAYER_BASE_MAX_HP,
      maxHp: PLAYER_BASE_MAX_HP,
      xp: 0,
      xpToNext: xpNeededForLevel(0),
      level: 0,
      pendingLevelUps: 0,
      materials: 0,
      bonusGold: 0,
      iframesTicks: 0,
      hitFlashTicks: 0,
      regenAccumulator: 0,
      lifestealCooldownTicks: 0,
      hitProtectionLeft: 0,
      standStillTicks: 0,
      moveTicks: 0,
      alienEyesTimer: 0,
      hpDrainAccumulator: 0,
      walkAnimPhase: 0,
      characterId: defaultChar,
      weapons: [],
      items: [],
      itemCounts: {},
      permanentStatMods: {},
      tempWaveStatMods: {},
      computedStats: createDefaultStatMap(),
      activeSetCounts: {},
      godMode: false,
    },
    enemies: [],
    projectiles: [],
    structures: [],
    pickups: [],
    trees: [],
    telegraphs: [],
    hazards: [],
    shop: {
      offers: [],
      rerollCount: 0,
      freeRerollsLeft: 0,
      rerollCost: 2,
    },
    levelUp: {
      offers: [],
      rerollCount: 0,
      rerollCost: 2,
      remainingLevelUps: 0,
    },
    crateModal: {
      pendingCrates: [],
    },
    camera: {
      x: centerX,
      y: centerY - 16,
      prevX: centerX,
      prevY: centerY - 16,
      shakeTrauma: 0,
      shakeOffsetX: 0,
      shakeOffsetY: 0,
      shakeDirX: 0,
      shakeDirY: 0,
      zoom: 1,
    },
    runStats: {
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
      waveReached: 1,
      ticksPlayed: 0,
    },
    events: [],
    selectedCharId: defaultChar,
    selectedWeaponId: defaultWeapon,
    selectedZoneId: 0,
    selectedDanger: 0,
    victoryTriggered: false,
  };

  recomputePlayerStats(state, catalog);
  state.player.hp = state.player.maxHp;
  return state;
}

/**
 * Transitions cleanly into the post-wave queue: Crates -> Level-Ups -> Shop.
 */
function openPostWaveQueue(
  state: SimState,
  catalog: GameDataCatalog,
  hooks: SimEconomyHooks,
): void {
  const rngFn = createRngFn(state);
  if (state.crateModal.pendingCrates.length > 0) {
    state.screen = 'crate_modal';
    return;
  }
  if (state.player.pendingLevelUps > 0) {
    state.levelUp.remainingLevelUps = state.player.pendingLevelUps;
    state.levelUp.rerollCount = 0;
    hooks.rollLevelUpOffers(state, catalog, rngFn);
    state.screen = 'level_up';
    return;
  }
  state.shop.rerollCount = 0;
  state.shop.freeRerollsLeft = Math.max(0, Math.round(state.player.computedStats.free_rerolls));
  hooks.rollShop(state, catalog, rngFn, true);
  state.screen = 'shop';
}

/**
 * Initializes a brand-new run from a `start_run` command and starts Wave 1.
 */
export function startNewRun(
  state: SimState,
  cmd: Extract<SimCommand, { type: 'start_run' }>,
  catalog: GameDataCatalog,
  hooks: SimEconomyHooks,
): void {
  const nextSeed = normalizeSeed(cmd.seed !== undefined ? cmd.seed : state.seed);
  state.seed = nextSeed;
  state.rngState = nextSeed;
  state.tick = 0;
  state.nextUid = 1;
  state.zoneId = cmd.zoneId;
  state.dangerLevel = clamp(Math.floor(cmd.dangerLevel), 0, Math.max(0, catalog.difficulties.length - 1));
  state.wave = 1;
  state.isEndless = false;
  state.victoryTriggered = false;
  state.events.length = 0;

  const charDef = catalog.charactersById[cmd.characterId] ?? catalog.characters[0];
  const charId = charDef?.id ?? cmd.characterId;

  state.selectedCharId = charId;
  state.selectedWeaponId = cmd.weaponId;
  state.selectedZoneId = cmd.zoneId;
  state.selectedDanger = state.dangerLevel;

  // Reset player
  const p = state.player;
  p.characterId = charId;
  p.level = 0;
  p.xp = 0;
  p.xpToNext = xpNeededForLevel(0);
  p.pendingLevelUps = 0;
  p.materials = 0;
  p.bonusGold = 0;
  p.weapons = [];
  p.items = [];
  p.itemCounts = {};
  p.permanentStatMods = {};
  p.tempWaveStatMods = {};
  p.godMode = false;

  // Grant character starting items
  if (charDef) {
    for (let i = 0; i < charDef.startingItems.length; i++) {
      const itemId = charDef.startingItems[i];
      if (!catalog.itemsById[itemId]) continue;
      p.items.push(itemId);
      p.itemCounts[itemId] = (p.itemCounts[itemId] ?? 0) + 1;
    }
  }

  // First stat pass to check weapon slots / min tier / no_weapons
  recomputePlayerStats(state, catalog);

  // Equip starting weapon if allowed by character rules
  const maxSlots = p.computedStats.weapon_slot;
  if (maxSlots > 0 && p.computedStats.no_weapons <= 0) {
    const requestedWeapon =
      catalog.weaponsById[cmd.weaponId] ??
      (charDef?.startingWeapons[0] ? catalog.weaponsById[charDef.startingWeapons[0]] : undefined) ??
      catalog.weapons[0];
    if (requestedWeapon) {
      const tier = clamp(
        Math.max(requestedWeapon.minTier, p.computedStats.min_weapon_tier),
        1,
        4,
      ) as 1 | 2 | 3 | 4;
      p.weapons.push(createEquippedWeapon(state, requestedWeapon.id, tier));
    }
  }

  // Reset modal & shop states + run stats
  state.shop = {
    offers: [],
    rerollCount: 0,
    freeRerollsLeft: 0,
    rerollCost: 2,
  };
  state.levelUp = {
    offers: [],
    rerollCount: 0,
    rerollCost: 2,
    remainingLevelUps: 0,
  };
  state.crateModal = {
    pendingCrates: [],
  };
  state.runStats = {
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
    waveReached: 1,
    ticksPlayed: 0,
  };

  recomputePlayerStats(state, catalog);
  p.hp = p.maxHp;

  startWave(state, catalog, hooks);
}

/**
 * Executes a single `SimCommand` against `SimState`.
 */
export function applySimCommand(
  state: SimState,
  cmd: SimCommand,
  catalog: GameDataCatalog,
  hooks: SimEconomyHooks,
): void {
  const rngFn = createRngFn(state);

  switch (cmd.type) {
    case 'start_run': {
      startNewRun(state, cmd, catalog, hooks);
      break;
    }

    case 'shop_buy': {
      if (state.screen === 'shop') {
        if (hooks.buyShopOffer(state, catalog, cmd.slotIndex, rngFn)) {
          recomputePlayerStats(state, catalog);
        }
      }
      break;
    }

    case 'shop_lock': {
      if (state.screen === 'shop') {
        hooks.lockShopOffer(state, cmd.slotIndex);
      }
      break;
    }

    case 'shop_reroll': {
      if (state.screen === 'shop') {
        hooks.rerollShop(state, catalog, rngFn);
      }
      break;
    }

    case 'shop_combine': {
      if (state.screen === 'shop') {
        if (hooks.combineWeapon(state, catalog, cmd.weaponUid)) {
          recomputePlayerStats(state, catalog);
        }
      }
      break;
    }

    case 'shop_recycle': {
      if (state.screen === 'shop') {
        if (hooks.recycleWeapon(state, catalog, cmd.weaponUid)) {
          recomputePlayerStats(state, catalog);
        }
      }
      break;
    }

    case 'shop_next_wave': {
      if (state.screen === 'shop') {
        state.wave += 1;
        if (state.wave > 20) state.isEndless = true;
        startWave(state, catalog, hooks);
      }
      break;
    }

    case 'level_up_pick': {
      if (state.screen === 'level_up') {
        if (hooks.pickLevelUpUpgrade(state, catalog, cmd.index, rngFn)) {
          recomputePlayerStats(state, catalog);
        }
      }
      break;
    }

    case 'level_up_reroll': {
      if (state.screen === 'level_up') {
        hooks.rerollLevelUpOffers(state, catalog, rngFn);
      }
      break;
    }

    case 'crate_keep': {
      if (state.screen === 'crate_modal') {
        if (hooks.resolveCrate(state, catalog, true, rngFn)) {
          recomputePlayerStats(state, catalog);
        }
      }
      break;
    }

    case 'crate_recycle': {
      if (state.screen === 'crate_modal') {
        if (hooks.resolveCrate(state, catalog, false, rngFn)) {
          recomputePlayerStats(state, catalog);
        }
      }
      break;
    }

    case 'continue_endless': {
      state.isEndless = true;
      openPostWaveQueue(state, catalog, hooks);
      break;
    }

    case 'set_screen': {
      state.previousScreen = state.screen;
      state.screen = cmd.screen;
      break;
    }

    case 'toggle_pause': {
      if (state.screen === 'combat') {
        state.previousScreen = 'combat';
        state.screen = 'pause';
      } else if (state.screen === 'pause') {
        state.screen = state.previousScreen === 'pause' ? 'combat' : state.previousScreen;
      }
      break;
    }

    case 'toggle_auto_aim': {
      state.autoAim = !state.autoAim;
      break;
    }

    case 'debug_warp_wave': {
      state.wave = Math.max(1, Math.floor(cmd.wave));
      state.isEndless = state.wave > 20;
      startWave(state, catalog, hooks);
      break;
    }

    case 'debug_spawn_boss': {
      spawnBossDirect(state, catalog, cmd.bossId);
      break;
    }

    case 'debug_spawn_elite': {
      spawnEliteDirect(state, catalog, cmd.eliteId);
      break;
    }

    case 'debug_give_weapon': {
      const wDef = catalog.weaponsById[cmd.weaponId];
      if (wDef) {
        const tier = clamp(cmd.tier ?? wDef.minTier, 1, 4) as 1 | 2 | 3 | 4;
        const eq = createEquippedWeapon(state, wDef.id, tier);
        const idx = state.player.weapons.length;
        state.player.weapons.push(eq);
        const off = getWeaponAnchorOffset(idx, state.player.weapons.length);
        eq.worldX = state.player.x + off.x;
        eq.worldY = state.player.y - 24 + off.y;
        eq.prevWorldX = eq.worldX;
        eq.prevWorldY = eq.worldY;
        recomputePlayerStats(state, catalog);
      }
      break;
    }

    case 'debug_give_item': {
      if (catalog.itemsById[cmd.itemId]) {
        state.player.items.push(cmd.itemId);
        state.player.itemCounts[cmd.itemId] = (state.player.itemCounts[cmd.itemId] ?? 0) + 1;
        recomputePlayerStats(state, catalog);
      }
      break;
    }

    case 'debug_set_godmode': {
      state.player.godMode = cmd.enabled;
      break;
    }

    case 'debug_give_materials': {
      state.player.materials = Math.max(0, state.player.materials + Math.round(cmd.amount));
      if (cmd.amount > 0) {
        state.runStats.materialsCollected += Math.round(cmd.amount);
      }
      break;
    }

    case 'debug_force_level_up': {
      const needed = Math.max(1, state.player.xpToNext - state.player.xp);
      addXp(state, catalog, needed);
      break;
    }

    case 'debug_kill_all': {
      const snapshot = [...state.enemies];
      for (let i = 0; i < snapshot.length; i++) {
        const e = snapshot[i];
        if (e.hp > 0) {
          damageEnemy(state, catalog, e, e.hp + 9999, false, 0, 0, state.player.x, state.player.y);
        }
      }
      state.enemies.length = 0;
      state.projectiles = state.projectiles.filter((p) => p.owner !== 'enemy');
      state.hazards = state.hazards.filter((h) => h.owner !== 'enemy');
      break;
    }
  }
}

/**
 * Smooth camera look-ahead & directional trauma shake update (does NOT touch PRNG).
 */
function updateCamera(state: SimState): void {
  const cam = state.camera;
  const p = state.player;
  cam.prevX = cam.x;
  cam.prevY = cam.y;

  const targetX = clamp(p.x + p.vx * 0.14, 240, ARENA_W - 240);
  const targetY = clamp(p.y - 16 + p.vy * 0.14, 180, ARENA_H - 180);

  cam.x += (targetX - cam.x) * 0.14;
  cam.y += (targetY - cam.y) * 0.14;

  if (cam.shakeTrauma > 0) {
    cam.shakeTrauma = Math.max(0, cam.shakeTrauma - 0.045);
    const mag = cam.shakeTrauma * cam.shakeTrauma * 24;
    const t = state.tick;
    const jitterX = Math.sin(t * 2.7 + 0.4) * 0.65 + cam.shakeDirX * 0.55;
    const jitterY = Math.cos(t * 3.3 + 1.1) * 0.65 + cam.shakeDirY * 0.55;
    cam.shakeOffsetX = jitterX * mag;
    cam.shakeOffsetY = jitterY * mag;
  } else {
    cam.shakeOffsetX = 0;
    cam.shakeOffsetY = 0;
  }
}

/**
 * Updates player movement with normalized vector, stand-still / moving trackers,
 * dynamic conditional stat refresh, walk animation phase, and strict arena clamping.
 */
function updatePlayerMovement(
  state: SimState,
  input: InputFrame,
  catalog: GameDataCatalog,
): void {
  const p = state.player;
  p.prevX = p.x;
  p.prevY = p.y;

  let mx = Number.isFinite(input.moveX) ? input.moveX : 0;
  let my = Number.isFinite(input.moveY) ? input.moveY : 0;
  const mag = Math.hypot(mx, my);
  if (mag > 1) {
    mx /= mag;
    my /= mag;
  }

  const wasStanding = p.standStillTicks > 0;
  const wasMoving = p.moveTicks > 0;
  if (mag < 0.05) {
    mx = 0;
    my = 0;
    p.standStillTicks += 1;
    p.moveTicks = 0;
  } else {
    p.moveTicks += 1;
    p.standStillTicks = 0;
    if (Math.abs(mx) > 0.05) {
      p.facingX = mx >= 0 ? 1 : -1;
    }
  }

  const nowStanding = p.standStillTicks > 0;
  const nowMoving = p.moveTicks > 0;
  if (wasStanding !== nowStanding || wasMoving !== nowMoving) {
    recomputePlayerStats(state, catalog);
  }

  const speed = computeMoveSpeed(p.computedStats);
  p.vx = mx * speed;
  p.vy = my * speed;
  p.x += p.vx * FIXED_DT;
  p.y += p.vy * FIXED_DT;

  // Strict playable arena bounds clamp
  p.x = clamp(p.x, PLAYABLE_MIN_X + PLAYER_MOVE_RADIUS, PLAYABLE_MAX_X - PLAYER_MOVE_RADIUS);
  p.y = clamp(p.y, PLAYABLE_MIN_Y + PLAYER_MOVE_RADIUS, PLAYABLE_MAX_Y - PLAYER_MOVE_RADIUS);

  if (mag >= 0.05) {
    p.walkAnimPhase = (p.walkAnimPhase + mag * 0.24) % (Math.PI * 2);
  } else {
    p.walkAnimPhase *= 0.85;
  }
}

/**
 * Transitions from active combat into the safe `wave_end` cadence (120t magnet + 40t harvest).
 */
function beginWaveEnd(state: SimState): void {
  state.screen = 'wave_end';
  state.waveEndTimer = END_WAVE_TICKS;
  state.harvestTimer = HARVEST_TICKS;
  state.harvestPaid = false;

  // Zero-damage guarantee during wave_end: clear enemy bullets, hazards, and telegraphs
  state.projectiles.length = 0;
  state.hazards.length = 0;
  state.telegraphs.length = 0;
  for (let i = 0; i < state.enemies.length; i++) {
    state.enemies[i].vx = 0;
    state.enemies[i].vy = 0;
  }

  state.events.push({ type: 'wave_end', wave: state.wave });
}

/**
 * Finalizes the `wave_end` harvest phase, invoking economy progression hooks,
 * Victory trigger at Wave 20, or Crate -> Level-Up -> Shop progression cleanly.
 */
function finalizeWaveEnd(
  state: SimState,
  catalog: GameDataCatalog,
  hooks: SimEconomyHooks,
): void {
  const rngFn = createRngFn(state);

  // Invoke economy hook first (handles harvesting + compounding growth + Pacifist + Piggy Bank + screen queue)
  hooks.onWaveEndProgression(state, catalog, rngFn);

  // Fire declarative on_wave_end effects (safe against double-harvest via state.harvestPaid)
  triggerEffects(state, catalog, 'on_wave_end', {
    x: state.player.x,
    y: state.player.y,
    depth: 0,
  });
  state.harvestPaid = true;

  // Clear dissolved enemies & transient wave entities
  state.enemies.length = 0;
  state.structures.length = 0;
  state.trees.length = 0;
  recomputePlayerStats(state, catalog);

  // Wave 20 Victory check (unless already in Endless mode)
  if (state.wave === 20 && !state.isEndless && !state.victoryTriggered) {
    state.victoryTriggered = true;
    state.screen = 'victory';
    state.events.push({ type: 'victory', wave: state.wave });
    return;
  }

  // Fallback transition guard: ensure we NEVER stay stuck on 'wave_end'
  if (state.screen === 'wave_end') {
    openPostWaveQueue(state, catalog, hooks);
  }
}

/**
 * Master 60 Hz deterministic simulation step. Mutates and returns `state`.
 */
export function stepSim(
  state: SimState,
  input: InputFrame,
  commands: readonly SimCommand[],
  catalog: GameDataCatalog,
  hooks: SimEconomyHooks,
): SimState {
  // 1. Clear previous tick's transient events
  state.events.length = 0;

  // 2. Process edge-triggered input toggles
  if (input.toggleAutoAimPressed) {
    state.autoAim = !state.autoAim;
  }
  if (input.pausePressed) {
    if (state.screen === 'combat') {
      state.previousScreen = 'combat';
      state.screen = 'pause';
    } else if (state.screen === 'pause') {
      state.screen = state.previousScreen === 'pause' ? 'combat' : state.previousScreen;
    }
  }

  // 3. Apply all queued commands
  for (let i = 0; i < commands.length; i++) {
    applySimCommand(state, commands[i], catalog, hooks);
  }

  // 4. Sync manual aim state
  state.aimActive = input.aimActive;
  if (input.hasWorldAim) {
    state.manualAimWorldX = input.aimWorldX;
    state.manualAimWorldY = input.aimWorldY;
  } else if (input.aimActive && (Math.abs(input.aimX) > 0.05 || Math.abs(input.aimY) > 0.05)) {
    const len = Math.hypot(input.aimX, input.aimY) || 1;
    state.manualAimWorldX = state.player.x + (input.aimX / len) * MANUAL_CROSSHAIR_DIST;
    state.manualAimWorldY = state.player.y - 24 + (input.aimY / len) * MANUAL_CROSSHAIR_DIST;
  }

  // 5. Screen-specific tick progression
  if (state.screen === 'combat') {
    state.tick += 1;
    state.runStats.ticksPlayed += 1;
    state.waveElapsedTicks += 1;

    // Player movement
    updatePlayerMovement(state, input, catalog);

    // Populate zero-GC SpatialHashGrid with living enemy indices
    sharedEnemyGrid.clear();
    for (let i = 0; i < state.enemies.length; i++) {
      const e = state.enemies[i];
      if (e.hp > 0) {
        sharedEnemyGrid.insert(i, e.x, e.y, e.radius);
      }
    }

    // Wave spawner & telegraphs
    updateWaveSpawner(state, catalog);

    // Player regen / drain / Alien Eyes / stand-still income
    updatePlayerTickEffects(state, catalog);

    // Weapons, Structures, Projectiles, Burn DoT, Hazards
    updateWeapons(state, input, catalog, sharedEnemyGrid);
    updateStructures(state, catalog, sharedEnemyGrid);
    updateProjectiles(state, catalog, sharedEnemyGrid);
    updateEnemyBurn(state, catalog);
    updateHazards(state, catalog);

    // Enemies & Wave-20 Bosses
    updateEnemies(state, catalog, (boss, spawns) =>
      updateBossEntity(state, catalog, boss, spawns),
    );

    // Floor pickups (materials, fruits, crates)
    updatePickups(state, catalog, hooks, false);

    // Wave completion check (player survived!)
    if (state.screen === 'combat') {
      let allBossesDefeated = false;
      if (state.isBossWave && state.bossSpawned && state.waveElapsedTicks > 90) {
        let bossAliveOrPending = false;
        for (let i = 0; i < state.enemies.length; i++) {
          if (state.enemies[i].kind === 'boss' && state.enemies[i].hp > 0) {
            bossAliveOrPending = true;
            break;
          }
        }
        if (!bossAliveOrPending) {
          for (let i = 0; i < state.telegraphs.length; i++) {
            if (state.telegraphs[i].isBoss) {
              bossAliveOrPending = true;
              break;
            }
          }
        }
        allBossesDefeated = !bossAliveOrPending;
      }

      if (state.waveElapsedTicks >= state.waveDurationTicks || allBossesDefeated) {
        beginWaveEnd(state);
      }
    }

    updateCamera(state);
  } else if (state.screen === 'wave_end') {
    state.tick += 1;
    state.runStats.ticksPlayed += 1;

    // Player can continue gliding smoothly while floor materials zip in (zero enemy damage)
    updatePlayerMovement(state, input, catalog);

    // Keep weapons visually anchored on player during wave_end
    const p = state.player;
    for (let i = 0; i < p.weapons.length; i++) {
      const eq = p.weapons[i];
      eq.prevWorldX = eq.worldX;
      eq.prevWorldY = eq.worldY;
      const off = getWeaponAnchorOffset(i, p.weapons.length);
      eq.worldX = p.x + off.x;
      eq.worldY = p.y - 24 + off.y;
    }

    if (state.waveEndTimer > 0) {
      state.waveEndTimer -= 1;
      updatePickups(state, catalog, hooks, true);

      if (state.waveEndTimer === 0) {
        // Deposit any uncollected floor materials into Loot Bag (bonusGold) and auto-collect crates
        const rngFn = createRngFn(state);
        for (let i = 0; i < state.pickups.length; i++) {
          const pk = state.pickups[i];
          if (pk.kind === 'material') {
            state.player.bonusGold += pk.value;
          } else if (pk.kind === 'crate' || pk.kind === 'legendary_crate') {
            hooks.enqueueCrate(state, catalog, pk.kind === 'legendary_crate', rngFn);
            state.runStats.cratesOpened += 1;
          }
        }
        state.pickups.length = 0;
      }
    } else if (state.harvestTimer > 0) {
      state.harvestTimer -= 1;
      if (state.harvestTimer === 0) {
        finalizeWaveEnd(state, catalog, hooks);
      }
    } else {
      finalizeWaveEnd(state, catalog, hooks);
    }

    updateCamera(state);
  }

  return state;
}
