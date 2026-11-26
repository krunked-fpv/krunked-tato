// ============================================================================
// src/sim/spawner.ts — Wave Director, Telegraphs, Trees, Elites, Bosses, D6 Events
// ============================================================================

import {
  ARENA_H,
  ARENA_W,
  MAX_ENEMIES,
  PLAYABLE_MAX_X,
  PLAYABLE_MAX_Y,
  PLAYABLE_MIN_X,
  PLAYABLE_MIN_Y,
  SIM_HZ,
  SPAWN_TELEGRAPH_TICKS,
  WAVE_DURATIONS_SEC,
  getWeaponAnchorOffset,
  type EnemyDef,
  type GameDataCatalog,
  type SimEconomyHooks,
  type SimState,
  type WaveDef,
} from '../contracts/index';
import { spawnEnemyProjectile } from './combat';
import { triggerEffects } from './effects';
import { createEnemyInstance } from './enemies';
import { allocUid, nextRand, randChoice, randInt, randRange } from './prng';
import { clamp, recomputePlayerStats } from './stats';

const SAFE_PLAYER_CLEARANCE = 180;

/**
 * Picks a deterministic spawn coordinate strictly inside playable bounds at
 * least `SAFE_PLAYER_CLEARANCE` (180 px) away from the player.
 */
export function pickSafeSpawnPosition(
  state: SimState,
  pad = 44,
  minPlayerDist = SAFE_PLAYER_CLEARANCE,
): { x: number; y: number } {
  const minX = PLAYABLE_MIN_X + pad;
  const maxX = PLAYABLE_MAX_X - pad;
  const minY = PLAYABLE_MIN_Y + pad;
  const maxY = PLAYABLE_MAX_Y - pad;
  const minDistSq = minPlayerDist * minPlayerDist;
  const px = state.player.x;
  const py = state.player.y;

  for (let attempt = 0; attempt < 16; attempt++) {
    const x = randRange(state, minX, maxX);
    const y = randRange(state, minY, maxY);
    const dx = x - px;
    const dy = y - py;
    if (dx * dx + dy * dy >= minDistSq) {
      return { x, y };
    }
  }

  // Deterministic opposite-quadrant fallback guaranteed >= 200 px away
  const fx = px < ARENA_W * 0.5 ? Math.min(maxX, px + 360) : Math.max(minX, px - 360);
  const fy = py < ARENA_H * 0.5 ? Math.min(maxY, py + 280) : Math.max(minY, py - 280);
  return {
    x: clamp(fx, minX, maxX),
    y: clamp(fy, minY, maxY),
  };
}

/**
 * Spawns a destructible arena Tree at a safe distance from the player.
 */
export function spawnArenaTree(state: SimState): void {
  const pos = pickSafeSpawnPosition(state, 72, 160);
  const hp = Math.max(10, Math.round(12 + state.wave * 3));
  state.trees.push({
    uid: allocUid(state),
    x: pos.x,
    y: pos.y,
    hp,
    maxHp: hp,
    radius: 26,
    hitFlashTicks: 0,
    variant: randInt(state, 0, 2),
  });
}

/**
 * Queues a 60-tick pulsing red-X spawn telegraph inside playable arena bounds.
 */
export function queueSpawnTelegraph(
  state: SimState,
  enemyId: string,
  x: number,
  y: number,
  isElite = false,
  isBoss = false,
): void {
  const cx = clamp(x, PLAYABLE_MIN_X + 40, PLAYABLE_MAX_X - 40);
  const cy = clamp(y, PLAYABLE_MIN_Y + 40, PLAYABLE_MAX_Y - 40);
  state.telegraphs.push({
    uid: allocUid(state),
    enemyId,
    x: cx,
    y: cy,
    ticksLeft: SPAWN_TELEGRAPH_TICKS,
    totalTicks: SPAWN_TELEGRAPH_TICKS,
    isElite,
    isBoss,
  });
}

/**
 * Spawns a Boss immediately (used for Wave 20 start or debug_spawn_boss).
 */
export function spawnBossDirect(
  state: SimState,
  catalog: GameDataCatalog,
  bossId?: string,
  posOverride?: { x: number; y: number },
): void {
  const bosses = catalog.enemies.filter((e) => e.kind === 'boss');
  let def: EnemyDef | undefined;
  if (bossId && catalog.enemiesById[bossId]) {
    def = catalog.enemiesById[bossId];
  } else if (bosses.length > 0) {
    def = bosses[0];
  }
  if (!def) return;

  const pos = posOverride ?? pickSafeSpawnPosition(state, 96, 320);
  const boss = createEnemyInstance(state, catalog, def.id, pos.x, pos.y, false);
  if (!boss) return;

  // Stagger attack cooldown cleanly when a partner boss already exists (Double Boss fairness)
  let existingBosses = 0;
  for (let i = 0; i < state.enemies.length; i++) {
    if (state.enemies[i].kind === 'boss' && state.enemies[i].hp > 0) {
      existingBosses += 1;
    }
  }
  boss.attackCooldown = 60 + existingBosses * 50;

  state.enemies.push(boss);
  state.bossSpawned = true;
  state.events.push({
    type: 'boss_spawn',
    bossId: def.id,
    name: def.name,
  });
}

/**
 * Spawns an Elite immediately (used for debug_spawn_elite).
 */
export function spawnEliteDirect(
  state: SimState,
  catalog: GameDataCatalog,
  eliteId?: string,
): void {
  const elites = catalog.enemies.filter((e) => e.kind === 'elite');
  let def: EnemyDef | undefined;
  if (eliteId && catalog.enemiesById[eliteId]) {
    def = catalog.enemiesById[eliteId];
  } else if (elites.length > 0) {
    def = randChoice(state, elites);
  }
  if (!def) return;

  const pos = pickSafeSpawnPosition(state, 72, 260);
  const elite = createEnemyInstance(state, catalog, def.id, pos.x, pos.y, false);
  if (!elite) return;

  state.enemies.push(elite);
  state.eliteSpawned = true;
}

/**
 * Resolves the wave duration in seconds per SPEC.md (W1=20s..W20=90s, Endless 60s).
 */
export function getWaveDurationSec(wave: number): number {
  if (wave >= 1 && wave <= WAVE_DURATIONS_SEC.length) {
    return WAVE_DURATIONS_SEC[wave - 1];
  }
  return 60;
}

function getWaveDef(state: SimState, catalog: GameDataCatalog): WaveDef | undefined {
  if (catalog.waves.length === 0) return undefined;
  if (state.wave <= catalog.waves.length) {
    return catalog.waves[Math.max(0, state.wave - 1)];
  }
  // Endless W21+: reuse late-game wave schedule (W19 or last non-boss wave)
  const fallbackIdx = Math.max(0, catalog.waves.length - 2);
  return catalog.waves[fallbackIdx];
}

/**
 * Initializes and starts the current `state.wave`, resetting combat entities,
 * positioning the player, running `on_wave_start` effects, spawning trees, and
 * setting up wave/boss/elite/nightmare flags.
 */
export function startWave(
  state: SimState,
  catalog: GameDataCatalog,
  _hooks: SimEconomyHooks,
): void {
  // Clear transient combat entities
  state.enemies.length = 0;
  state.projectiles.length = 0;
  state.pickups.length = 0;
  state.trees.length = 0;
  state.telegraphs.length = 0;
  state.hazards.length = 0;
  state.structures.length = 0;

  // Reset player to arena center
  const p = state.player;
  p.x = ARENA_W * 0.5;
  p.y = ARENA_H * 0.5;
  p.prevX = p.x;
  p.prevY = p.y;
  p.vx = 0;
  p.vy = 0;
  p.iframesTicks = 30;
  p.hitFlashTicks = 0;
  p.regenAccumulator = 0;
  p.hpDrainAccumulator = 0;
  p.lifestealCooldownTicks = 0;
  p.standStillTicks = 0;
  p.moveTicks = 0;
  p.alienEyesTimer = 0;

  // Sync camera cleanly onto player at wave start
  state.camera.x = p.x;
  state.camera.y = p.y - 16;
  state.camera.prevX = state.camera.x;
  state.camera.prevY = state.camera.y;
  state.camera.shakeTrauma = 0;
  state.camera.shakeOffsetX = 0;
  state.camera.shakeOffsetY = 0;

  // Position floating weapons neatly on their anchors
  for (let i = 0; i < p.weapons.length; i++) {
    const eq = p.weapons[i];
    const off = getWeaponAnchorOffset(i, p.weapons.length);
    eq.worldX = p.x + off.x;
    eq.worldY = p.y - 24 + off.y;
    eq.prevWorldX = eq.worldX;
    eq.prevWorldY = eq.worldY;
    eq.cooldownTicks = Math.min(eq.cooldownTicks, 6 + (i % 4) * 3);
    eq.recoilTimer = 0;
    eq.swingTimer = 0;
  }

  // Recompute stats & fire on_wave_start effects (structures, hp_start_wave, Tardigrade, etc.)
  recomputePlayerStats(state, catalog);
  triggerEffects(state, catalog, 'on_wave_start', { x: p.x, y: p.y, depth: 0 });
  recomputePlayerStats(state, catalog);

  // Determine wave flags & duration
  const diff =
    catalog.difficulties[
      clamp(state.dangerLevel, 0, Math.max(0, catalog.difficulties.length - 1))
    ];
  const waveDef = getWaveDef(state, catalog);

  const durationSec = getWaveDurationSec(state.wave);
  state.waveDurationTicks = durationSec * SIM_HZ;
  state.waveElapsedTicks = 0;
  state.waveEndTimer = 0;
  state.harvestTimer = 0;
  state.harvestPaid = false;
  state.lootAlienSpawned = false;
  state.bossSpawned = false;
  state.eliteSpawned = false;
  state.screen = 'combat';

  state.isBossWave =
    state.wave === 20 ||
    (state.wave > 20 && state.wave % 10 === 0) ||
    Boolean(waveDef?.isBossWave && state.wave === 20);

  const elitesEnabled = diff ? diff.elitesEnabled : state.dangerLevel >= 2;
  const extraElites = diff ? diff.extraElites : state.dangerLevel >= 4;
  state.isEliteWave =
    !state.isBossWave &&
    elitesEnabled &&
    (Boolean(waveDef?.isElitePossible) ||
      (extraElites && (state.wave === 11 || state.wave === 14 || state.wave === 17 || state.wave === 18)) ||
      (state.wave > 20 && state.wave % 3 === 0));

  state.isHordeWave =
    !state.isBossWave &&
    !state.isEliteWave &&
    Boolean(waveDef?.isHordePossible) &&
    nextRand(state) < (extraElites ? 0.45 : 0.25);

  // D6 Nightmare events
  if (diff?.nightmareEvents && state.wave >= 4) {
    state.nightmareEvent = state.wave % 2 === 0 ? 'bullet_hell' : 'fog_of_war';
  } else {
    state.nightmareEvent = 'none';
  }

  state.runStats.waveReached = Math.max(state.runStats.waveReached, state.wave);

  // Initialize per-group spawn timers
  const groupCount = waveDef ? waveDef.groups.length : 1;
  state.spawnerGroupTimers = new Array<number>(groupCount);
  for (let i = 0; i < groupCount; i++) {
    state.spawnerGroupTimers[i] = 15 + i * 18;
  }

  // Spawn initial arena Trees
  const stats = state.player.computedStats;
  const initialTrees = clamp(1 + Math.max(0, Math.round(stats.trees)), 1, 12);
  for (let t = 0; t < initialTrees; t++) {
    spawnArenaTree(state);
  }
  state.treeSpawnTimer = Math.max(240, 600 - Math.max(0, stats.trees) * 50);

  // Boss Wave setup (Wave 20 or Endless Boss Waves)
  if (state.isBossWave) {
    const doubleBoss =
      (diff ? diff.doubleBoss : state.dangerLevel >= 5) || stats.boss_spawn_extra > 0;
    const bosses = catalog.enemies.filter((e) => e.kind === 'boss');
    const predator = catalog.enemiesById['predator'] ?? bosses[0];
    const invoker = catalog.enemiesById['invoker'] ?? bosses[1] ?? bosses[0];

    if (doubleBoss && predator && invoker && predator.id !== invoker.id) {
      queueSpawnTelegraph(state, predator.id, ARENA_W * 0.28, ARENA_H * 0.35, false, true);
      queueSpawnTelegraph(state, invoker.id, ARENA_W * 0.72, ARENA_H * 0.65, false, true);
    } else if (predator || invoker) {
      const chosen =
        nextRand(state) < 0.5 ? (predator ?? invoker)! : (invoker ?? predator)!;
      queueSpawnTelegraph(state, chosen.id, ARENA_W * 0.5, ARENA_H * 0.25, false, true);
    }
    state.bossSpawned = true;
  }

  state.events.push({
    type: 'wave_start',
    wave: state.wave,
    isBoss: state.isBossWave,
    isElite: state.isEliteWave,
    isHorde: state.isHordeWave,
  });
}

/**
 * Advances active spawn telegraphs, wave group spawn timers, Elite/Loot Alien
 * schedules, Trees, and D6 Nightmare events.
 */
export function updateWaveSpawner(
  state: SimState,
  catalog: GameDataCatalog,
): void {
  // 1. Advance spawn telegraphs -> materialize enemies on 0
  let tgWrite = 0;
  for (let i = 0; i < state.telegraphs.length; i++) {
    const tg = state.telegraphs[i];
    tg.ticksLeft -= 1;
    if (tg.ticksLeft <= 0) {
      if (tg.isBoss || tg.isElite || state.enemies.length < MAX_ENEMIES) {
        if (tg.isBoss) {
          spawnBossDirect(state, catalog, tg.enemyId, { x: tg.x, y: tg.y });
        } else {
          const enemy = createEnemyInstance(state, catalog, tg.enemyId, tg.x, tg.y, false);
          if (enemy) {
            state.enemies.push(enemy);
          }
        }
      }
    } else {
      state.telegraphs[tgWrite] = tg;
      tgWrite += 1;
    }
  }
  state.telegraphs.length = tgWrite;

  // 2. Process wave group schedules
  const elapsedSec = state.waveElapsedTicks / SIM_HZ;
  const remainingSec = (state.waveDurationTicks - state.waveElapsedTicks) / SIM_HZ;
  const stats = state.player.computedStats;
  const densityMult = clamp(
    1 + (stats.enemies + stats.extra_enemies_next_wave) / 100,
    0.4,
    2.5,
  );
  const hordeMult = state.isHordeWave ? 1.45 : 1.0;
  const endlessPace = state.wave > 20 ? 1 + Math.min(1.0, (state.wave - 20) * 0.08) : 1.0;

  // Stop spawning normal mobs in the last 1.5s of wave so wave-end feels clean
  if (remainingSec > 1.5) {
    const waveDef = getWaveDef(state, catalog);
    if (waveDef && waveDef.groups.length > 0) {
      for (let g = 0; g < waveDef.groups.length; g++) {
        const grp = waveDef.groups[g];
        if (grp.minDanger !== undefined && state.dangerLevel < grp.minDanger) continue;
        if (grp.hordeOnly && !state.isHordeWave) continue;
        if (elapsedSec < grp.startSec || elapsedSec > grp.endSec) continue;

        if (state.spawnerGroupTimers[g] === undefined) {
          state.spawnerGroupTimers[g] = 10;
        }
        state.spawnerGroupTimers[g] -= 1;

        if (state.spawnerGroupTimers[g] <= 0) {
          const baseTicks = Math.max(24, Math.round(grp.intervalSec * SIM_HZ));
          state.spawnerGroupTimers[g] = Math.max(
            18,
            Math.round(baseTicks / (densityMult * hordeMult * endlessPace)),
          );

          const count = randInt(state, grp.minCount, grp.maxCount);
          const scaledCount = Math.max(1, Math.round(count * Math.sqrt(hordeMult)));
          for (let k = 0; k < scaledCount; k++) {
            if (state.enemies.length + state.telegraphs.length >= MAX_ENEMIES) break;
            const pos = pickSafeSpawnPosition(state, 44, SAFE_PLAYER_CLEARANCE);
            queueSpawnTelegraph(state, grp.enemyId, pos.x, pos.y, false, false);
          }
        }
      }
    } else if (catalog.enemies.length > 0) {
      // Fallback generic spawner if catalog has no wave defs
      if (state.spawnerGroupTimers[0] === undefined) state.spawnerGroupTimers[0] = 30;
      state.spawnerGroupTimers[0] -= 1;
      if (state.spawnerGroupTimers[0] <= 0) {
        state.spawnerGroupTimers[0] = 90;
        const basics = catalog.enemies.filter((e) => e.kind === 'basic');
        const chosen = randChoice(state, basics.length > 0 ? basics : catalog.enemies);
        if (chosen && state.enemies.length + state.telegraphs.length < MAX_ENEMIES) {
          const pos = pickSafeSpawnPosition(state, 44, SAFE_PLAYER_CLEARANCE);
          queueSpawnTelegraph(state, chosen.id, pos.x, pos.y, false, false);
        }
      }
    }
  }

  // 3. Elite spawn on D2+ Elite waves (~3s into wave)
  if (state.isEliteWave && !state.eliteSpawned && state.waveElapsedTicks >= 180) {
    const elites = catalog.enemies.filter((e) => e.kind === 'elite');
    const chosen = randChoice(state, elites);
    if (chosen) {
      const pos = pickSafeSpawnPosition(state, 80, 280);
      queueSpawnTelegraph(state, chosen.id, pos.x, pos.y, true, false);
    }
    state.eliteSpawned = true;
  }

  // 4. Loot Alien spawn once per wave >= 3
  if (
    !state.lootAlienSpawned &&
    state.wave >= 3 &&
    state.waveElapsedTicks >= Math.round(state.waveDurationTicks * 0.4)
  ) {
    state.lootAlienSpawned = true;
    const looter = catalog.enemiesById['looter'];
    if (looter) {
      const luckBonus = Math.max(0, stats.stat_luck) * 0.004;
      if (nextRand(state) < clamp(0.35 + luckBonus, 0.2, 0.85)) {
        const pos = pickSafeSpawnPosition(state, 80, 300);
        queueSpawnTelegraph(state, looter.id, pos.x, pos.y, false, false);
      }
    }
  }

  // 5. Periodic Tree spawning
  state.treeSpawnTimer -= 1;
  if (state.treeSpawnTimer <= 0) {
    state.treeSpawnTimer = Math.max(210, 620 - Math.max(0, stats.trees) * 55);
    const maxTrees = clamp(6 + Math.max(0, Math.round(stats.trees)), 4, 16);
    if (state.trees.length < maxTrees) {
      spawnArenaTree(state);
    }
  }

  // 6. Danger 6 Nightmare Wave Events
  if (state.nightmareEvent === 'bullet_hell' && state.waveElapsedTicks > 90 && state.waveElapsedTicks % 180 === 0) {
    // Sweeping edge volley of readable crimson orbs
    const fromLeft = ((state.waveElapsedTicks / 180) | 0) % 2 === 0;
    const x = fromLeft ? PLAYABLE_MIN_X + 20 : PLAYABLE_MAX_X - 20;
    const vx = fromLeft ? 250 : -250;
    const dmg = Math.max(2, Math.round(4 + state.wave * 0.9));
    for (let k = 0; k < 5; k++) {
      const y = PLAYABLE_MIN_Y + 140 + k * ((PLAYABLE_MAX_Y - PLAYABLE_MIN_Y - 280) / 4);
      spawnEnemyProjectile(state, x, y, vx, 0, 9, dmg, 480, '#ff2667', 'proj_enemy');
    }
  } else if (state.nightmareEvent === 'fog_of_war' && state.waveElapsedTicks > 120 && state.waveElapsedTicks % 240 === 0) {
    // Telegraphed nightmare fog pulse hazard
    const pos = pickSafeSpawnPosition(state, 100, 140);
    const dmg = Math.max(2, Math.round(5 + state.wave * 0.8));
    state.hazards.push({
      uid: allocUid(state),
      kind: 'fog_pulse',
      owner: 'enemy',
      x: pos.x,
      y: pos.y,
      endX: pos.x,
      endY: pos.y,
      angle: 0,
      arcSpan: Math.PI * 2,
      radius: 120,
      damage: dmg,
      ticksLeft: 24,
      maxTicks: 24,
      activeDelayTicks: 54,
      color: '#7e30ff',
      hitPlayer: false,
    });
  }
}
