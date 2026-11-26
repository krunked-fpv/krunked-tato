// ============================================================================
// src/sim/combat.ts — Weapons, Projectiles, Structures, Hazards, Pickups, HP/XP
// ============================================================================

import {
  BAG_BOOST_SCALE,
  BASE_FRUIT_HEAL,
  FIXED_DT,
  GOLD_MERGE_SCALE_STEP,
  LIFESTEAL_COOLDOWN_TICKS,
  MAX_GOLD_SCALE,
  MAX_GOLDS,
  MAX_IFRAMES_TICKS,
  MIN_IFRAMES_TICKS,
  MIN_SWEEP_DISTANCE,
  PLAYER_HURT_OFFSET_Y,
  PLAYER_HURT_RADIUS,
  PLAYER_MAGNET_BASE,
  PLAYER_PICKUP_OFFSET_Y,
  PLAYER_PICKUP_RADIUS,
  PLAYABLE_MAX_X,
  PLAYABLE_MAX_Y,
  PLAYABLE_MIN_X,
  PLAYABLE_MIN_Y,
  SIM_HZ,
  WEAPON_RECOIL_PX,
  WEAPON_RECOIL_TICKS,
  getWeaponAnchorOffset,
  type EnemyState,
  type EquippedWeaponState,
  type GameDataCatalog,
  type InputFrame,
  type PickupState,
  type SimEconomyHooks,
  type SimState,
  type TreeState,
} from '../contracts/index';
import {
  applyBurnToEnemy,
  clampToArena,
  spawnEffectExplosion,
  triggerEffects,
  type EffectContext,
} from './effects';
import { allocUid, createRngFn, nextRand, randRange } from './prng';
import type { SpatialHashGrid } from './spatial';
import {
  clamp,
  computeArmorMultiplier,
  computeEffectiveCooldown,
  computeEffectiveRange,
  computeRegenIntervalTicks,
  recomputePlayerStats,
  xpNeededForLevel,
} from './stats';

// Reusable scratch buffer for spatial grid queries (zero per-frame GC)
const queryScratch: number[] = [];

/**
 * Computes squared distance from point (px, py) to line segment (ax, ay)-(bx, by).
 */
export function pointToSegmentDistSq(
  px: number,
  py: number,
  ax: number,
  ay: number,
  bx: number,
  by: number,
): number {
  const vx = bx - ax;
  const vy = by - ay;
  const wx = px - ax;
  const wy = py - ay;
  const lenSq = vx * vx + vy * vy;
  if (lenSq <= 0.0001) {
    return wx * wx + wy * wy;
  }
  const t = clamp((wx * vx + wy * vy) / lenSq, 0, 1);
  const cx = ax + t * vx;
  const cy = ay + t * vy;
  const dx = px - cx;
  const dy = py - cy;
  return dx * dx + dy * dy;
}

/**
 * Normalizes an angle difference into [-PI, PI].
 */
export function angleDiff(a: number, b: number): number {
  let d = a - b;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return d;
}

/**
 * Grants XP (scaled by xp_gain), handling multi-level-up carry-over and +1 Max HP per level.
 */
export function addXp(state: SimState, catalog: GameDataCatalog, rawAmount: number): void {
  if (rawAmount <= 0) return;
  const player = state.player;
  const stats = player.computedStats;
  const mult = Math.max(0.1, 1 + stats.xp_gain / 100);
  player.xp += rawAmount * mult;

  let leveled = false;
  while (player.xp >= player.xpToNext) {
    player.xp -= player.xpToNext;
    player.level += 1;
    player.pendingLevelUps += 1;
    player.xpToNext = xpNeededForLevel(player.level);
    leveled = true;
    state.events.push({
      type: 'level_up',
      level: player.level,
      x: player.x,
      y: player.y - 24,
    });
  }

  if (leveled) {
    const prevMax = player.maxHp;
    recomputePlayerStats(state, catalog);
    const gained = Math.max(1, player.maxHp - prevMax);
    player.hp = Math.min(player.maxHp, player.hp + gained);
  }
}

/**
 * Heals the player up to maxHp (respecting ban_consumable_heal for consumables).
 */
export function healPlayer(
  state: SimState,
  amount: number,
  isConsumable = false,
): number {
  if (amount <= 0) return 0;
  const player = state.player;
  if (isConsumable && player.computedStats.ban_consumable_heal > 0) {
    return 0;
  }
  const before = player.hp;
  player.hp = Math.min(player.maxHp, player.hp + amount);
  const healed = player.hp - before;
  if (healed > 0) {
    state.events.push({
      type: 'player_heal',
      x: player.x,
      y: player.y - 24,
      amount: healed,
    });
  }
  return healed;
}

/**
 * Creates a reusable EffectContext callback binding damageEnemy safely.
 */
function makeDamageCallback(state: SimState, catalog: GameDataCatalog, depth: number) {
  return (
    enemy: EnemyState,
    damage: number,
    isCrit: boolean,
    knockback: number,
    sourceWeaponUid: number,
    fromX: number,
    fromY: number,
  ) => {
    damageEnemy(
      state,
      catalog,
      enemy,
      damage,
      isCrit,
      knockback,
      sourceWeaponUid,
      fromX,
      fromY,
      0,
      0,
      0,
      depth,
    );
  };
}

/**
 * Applies damage to the player with Dodge, Tardigrade Hit Protection, Armor
 * mitigation, linear 12..24 tick i-frames, directional camera trauma, and
 * `on_hit_taken` / `on_dodge` triggers.
 */
export function damagePlayer(
  state: SimState,
  catalog: GameDataCatalog,
  rawDamage: number,
  fromX: number,
  fromY: number,
  ignoreIframes = false,
): boolean {
  const player = state.player;
  if (state.screen !== 'combat') return false;
  if (player.godMode || player.hp <= 0) return false;
  if (!ignoreIframes && player.iframesTicks > 0) return false;

  const stats = player.computedStats;
  const effCtx: EffectContext = {
    x: player.x,
    y: player.y,
    depth: 0,
    damageEnemy: makeDamageCallback(state, catalog, 1),
  };

  // 1. Dodge roll (skip dodge on self-drain / ignoreIframes hits)
  if (!ignoreIframes && stats.no_dodge <= 0) {
    const cap = clamp(stats.dodge_cap, 0, 95);
    const dodgeChance = clamp(stats.stat_dodge, 0, cap) / 100;
    if (dodgeChance > 0 && nextRand(state) < dodgeChance) {
      player.iframesTicks = Math.max(player.iframesTicks, MIN_IFRAMES_TICKS);
      state.runStats.dodges += 1;
      state.events.push({ type: 'player_dodge', x: player.x, y: player.y - 16 });
      triggerEffects(state, catalog, 'on_dodge', effCtx);
      return false;
    }
  }

  // 2. Hit protection (Tardigrade)
  if (!ignoreIframes && player.hitProtectionLeft > 0) {
    player.hitProtectionLeft -= 1;
    player.iframesTicks = Math.max(player.iframesTicks, MIN_IFRAMES_TICKS);
    state.events.push({ type: 'player_dodge', x: player.x, y: player.y - 16 });
    return false;
  }

  // 3. Armor mitigation
  const mult = ignoreIframes ? 1 : computeArmorMultiplier(stats.stat_armor);
  const finalDmg = Math.max(1, Math.round(rawDamage * mult));

  player.hp = Math.max(0, player.hp - finalDmg);
  state.runStats.damageTaken += finalDmg;

  // Linearly interpolate iframes between 12 and 24 ticks by fraction of max HP lost
  if (!ignoreIframes) {
    const frac = clamp(finalDmg / Math.max(1, player.maxHp), 0, 1);
    const iframes = Math.round(
      MIN_IFRAMES_TICKS + (MAX_IFRAMES_TICKS - MIN_IFRAMES_TICKS) * frac,
    );
    player.iframesTicks = Math.max(player.iframesTicks, iframes);
  }
  player.hitFlashTicks = 8;

  // Directional camera trauma kick
  const dx = player.x - fromX;
  const dy = player.y - fromY;
  const len = Math.hypot(dx, dy) || 1;
  state.camera.shakeDirX = dx / len;
  state.camera.shakeDirY = dy / len;
  const traumaAdd = clamp(0.28 + 0.45 * (finalDmg / Math.max(1, player.maxHp)), 0.25, 0.8);
  state.camera.shakeTrauma = Math.min(1, state.camera.shakeTrauma + traumaAdd);

  state.events.push({
    type: 'player_hit',
    x: player.x,
    y: player.y - 16,
    damage: finalDmg,
  });

  effCtx.damage = finalDmg;
  triggerEffects(state, catalog, 'on_hit_taken', effCtx);

  if (player.hp <= 0) {
    state.screen = 'game_over';
    state.events.push({ type: 'game_over', wave: state.wave });
  }

  return true;
}

/**
 * Spawns an enemy projectile cleanly with standard defaults.
 */
export function spawnEnemyProjectile(
  state: SimState,
  x: number,
  y: number,
  vx: number,
  vy: number,
  radius: number,
  damage: number,
  lifeTicks = 240,
  color = '#ff385c',
  spriteId = 'proj_enemy',
): void {
  state.projectiles.push({
    uid: allocUid(state),
    owner: 'enemy',
    x,
    y,
    prevX: x,
    prevY: y,
    vx,
    vy,
    radius,
    damage: Math.max(1, Math.round(damage)),
    isCrit: false,
    knockback: 0,
    lifesteal: 0,
    pierceLeft: 0,
    pierceDmgMult: 1,
    bounceLeft: 0,
    bounceDmgMult: 1,
    explosionRadius: 0,
    explosionDamage: 0,
    burnDamage: 0,
    burnDurationSec: 0,
    lifeTicks,
    maxLifeTicks: lifeTicks,
    spriteId,
    color,
    hitEnemyUids: [],
    sourceWeaponUid: 0,
  });
}

/**
 * Spawns a ground material drop respecting Loot Bag 2x bonusGold and MAX_GOLDS=50 merge cap.
 */
export function spawnMaterialDrop(
  state: SimState,
  x: number,
  y: number,
  baseValue = 1,
): void {
  const player = state.player;
  const stats = player.computedStats;
  let value = Math.max(1, Math.round(baseValue));

  // Double material chance
  if (stats.double_material_chance > 0) {
    const chance = clamp(
      stats.double_material_chance > 1
        ? stats.double_material_chance / 100
        : stats.double_material_chance,
      0,
      1,
    );
    if (nextRand(state) < chance) {
      value *= 2;
    }
  }

  // Consume from Loot Bag bonusGold for 2x lime boosted pickup
  let isBagBoosted = false;
  let scale = 1.0;
  if (player.bonusGold > 0) {
    const consume = Math.min(player.bonusGold, value);
    player.bonusGold -= consume;
    value += consume;
    isBagBoosted = true;
    scale = BAG_BOOST_SCALE;
  }

  // Enforce MAX_GOLDS = 50 cap by merging into a random existing material pickup
  let matCount = 0;
  for (let i = 0; i < state.pickups.length; i++) {
    if (state.pickups[i].kind === 'material') matCount += 1;
  }

  if (matCount >= MAX_GOLDS) {
    const targetIdx = Math.floor(nextRand(state) * matCount);
    let seen = 0;
    for (let i = 0; i < state.pickups.length; i++) {
      const pk = state.pickups[i];
      if (pk.kind !== 'material') continue;
      if (seen === targetIdx) {
        pk.value += value;
        pk.scale = Math.min(MAX_GOLD_SCALE, pk.scale + GOLD_MERGE_SCALE_STEP);
        if (isBagBoosted) {
          pk.isBagBoosted = true;
          pk.scale = Math.max(pk.scale, BAG_BOOST_SCALE);
        }
        return;
      }
      seen += 1;
    }
  }

  const pos = clampToArena(x, y, 16);
  const angle = nextRand(state) * Math.PI * 2;
  const popSpd = randRange(state, 45, 110);
  state.pickups.push({
    uid: allocUid(state),
    kind: 'material',
    x: pos.x,
    y: pos.y,
    prevX: pos.x,
    prevY: pos.y,
    vx: Math.cos(angle) * popSpd,
    vy: Math.sin(angle) * popSpd,
    value,
    scale,
    isBagBoosted,
    attracted: stats.instant_gold_attracting > 0,
    attractSpeed: 0,
    ageTicks: 0,
  });
}

/**
 * Spawns a healing consumable fruit clamped inside the arena.
 */
export function spawnConsumableDrop(state: SimState, x: number, y: number): void {
  const pos = clampToArena(x, y, 18);
  const angle = nextRand(state) * Math.PI * 2;
  const popSpd = randRange(state, 35, 85);
  state.pickups.push({
    uid: allocUid(state),
    kind: 'consumable',
    x: pos.x,
    y: pos.y,
    prevX: pos.x,
    prevY: pos.y,
    vx: Math.cos(angle) * popSpd,
    vy: Math.sin(angle) * popSpd,
    value: 1,
    scale: 1.0,
    isBagBoosted: false,
    attracted: false,
    attractSpeed: 0,
    ageTicks: 0,
  });
}

/**
 * Spawns a regular or legendary item crate clamped inside the arena.
 */
export function spawnCrateDrop(
  state: SimState,
  x: number,
  y: number,
  isLegendary = false,
): void {
  const pos = clampToArena(x, y, 22);
  const angle = nextRand(state) * Math.PI * 2;
  const popSpd = randRange(state, 30, 75);
  state.pickups.push({
    uid: allocUid(state),
    kind: isLegendary ? 'legendary_crate' : 'crate',
    x: pos.x,
    y: pos.y,
    prevX: pos.x,
    prevY: pos.y,
    vx: Math.cos(angle) * popSpd,
    vy: Math.sin(angle) * popSpd,
    value: 1,
    scale: isLegendary ? 1.25 : 1.0,
    isBagBoosted: false,
    attracted: false,
    attractSpeed: 0,
    ageTicks: 0,
  });
}

/**
 * Deals damage to a destructible arena Tree, spawning fruit/materials/crate when felled.
 */
export function damageTree(
  state: SimState,
  tree: TreeState,
  damage: number,
): void {
  if (tree.hp <= 0) return;
  tree.hp -= Math.max(1, Math.round(damage));
  tree.hitFlashTicks = 6;

  if (tree.hp <= 0) {
    state.runStats.treesChopped += 1;
    state.events.push({
      type: 'decal',
      kind: 'splat',
      x: tree.x,
      y: tree.y,
      radius: 24,
      color: '#4f7a38',
    });

    // Drop guaranteed healing fruit + materials + luck-scaled crate chance
    spawnConsumableDrop(state, tree.x, tree.y);
    const matDrops = 2;
    for (let i = 0; i < matDrops; i++) {
      spawnMaterialDrop(state, tree.x, tree.y, 1);
    }
    const stats = state.player.computedStats;
    const luckMult =
      stats.stat_luck >= 0
        ? 1 + stats.stat_luck / 100
        : 1 / (1 + Math.abs(stats.stat_luck) / 100);
    const crateChance = clamp((0.2 + stats.crate_chance / 100) * luckMult, 0, 0.75);
    if (nextRand(state) < crateChance) {
      spawnCrateDrop(state, tree.x, tree.y, false);
    }
  }
}

/**
 * Handles enemy death: drops, stats, Snake burn spread, Ethereal weapon kill tracking,
 * and `on_enemy_kill` EffectGraph hooks.
 */
export function killEnemy(
  state: SimState,
  catalog: GameDataCatalog,
  enemy: EnemyState,
  isCrit: boolean,
  sourceWeaponUid: number,
  depth = 0,
): void {
  const def = catalog.enemiesById[enemy.defId];
  const stats = state.player.computedStats;

  state.runStats.kills += 1;
  if (enemy.kind === 'elite') state.runStats.elitesKilled += 1;
  if (enemy.kind === 'boss') state.runStats.bossesKilled += 1;

  state.events.push({
    type: 'enemy_die',
    x: enemy.x,
    y: enemy.y,
    enemyId: enemy.defId,
    color: def?.color ?? '#d44c5c',
    isElite: enemy.kind === 'elite',
    isBoss: enemy.kind === 'boss',
  });
  state.events.push({
    type: 'decal',
    kind: enemy.kind === 'boss' ? 'crater' : 'splat',
    x: enemy.x,
    y: enemy.y,
    radius: Math.max(16, enemy.radius * 0.9),
    color: def?.color ?? '#5a2330',
  });

  // Track weapon kills for Ethereal weapon scaling
  let sourceWeapon: EquippedWeaponState | undefined;
  if (sourceWeaponUid > 0) {
    for (let i = 0; i < state.player.weapons.length; i++) {
      if (state.player.weapons[i].uid === sourceWeaponUid) {
        sourceWeapon = state.player.weapons[i];
        sourceWeapon.killsThisRun += 1;
        break;
      }
    }
  }

  // Spawn drops
  const dropCount = def ? def.materialDrops : 1;
  const dropVal = def ? Math.max(1, def.materialValue) : 1;
  for (let i = 0; i < dropCount; i++) {
    spawnMaterialDrop(state, enemy.x, enemy.y, dropVal);
  }

  const luckMult =
    stats.stat_luck >= 0
      ? 1 + stats.stat_luck / 100
      : 1 / (1 + Math.abs(stats.stat_luck) / 100);

  if (enemy.kind === 'boss' || enemy.kind === 'elite') {
    // Guaranteed Legendary Crate from Elites & Bosses
    spawnCrateDrop(state, enemy.x, enemy.y, true);
    state.camera.shakeTrauma = Math.min(1, state.camera.shakeTrauma + 0.55);
  } else {
    const baseFruit = def ? def.consumableDropChance : 0.02;
    const fruitChance = clamp(baseFruit * luckMult, 0, 0.45);
    if (nextRand(state) < fruitChance) {
      spawnConsumableDrop(state, enemy.x, enemy.y);
    }
    const baseCrate = def ? def.crateDropChance : 0.008;
    const crateChance = clamp(baseCrate * Math.max(0, 1 + stats.crate_chance / 100) * luckMult, 0, 0.25);
    if (nextRand(state) < crateChance) {
      spawnCrateDrop(state, enemy.x, enemy.y, false);
    }
  }

  // Snake burn spread on death
  if (enemy.burnTicksLeft > 0 && stats.burn_spread > 0) {
    const maxTargets = Math.max(1, Math.round(stats.burn_spread));
    let spreadCount = 0;
    for (let i = 0; i < state.enemies.length && spreadCount < maxTargets; i++) {
      const other = state.enemies[i];
      if (other.hp <= 0 || other.uid === enemy.uid) continue;
      const dx = other.x - enemy.x;
      const dy = other.y - enemy.y;
      if (dx * dx + dy * dy <= 220 * 220) {
        applyBurnToEnemy(state, other, Math.max(1, enemy.burnDamage), 3.0, enemy.burnTickInterval);
        spreadCount += 1;
      }
    }
  }

  // Trigger on_enemy_kill effects (Cyberball, Rip and Tear, Hunting Trophy, Ethereal, etc.)
  triggerEffects(state, catalog, 'on_enemy_kill', {
    enemy,
    isCrit,
    x: enemy.x,
    y: enemy.y,
    weapon: sourceWeapon,
    depth,
    damageEnemy: makeDamageCallback(state, catalog, depth + 1),
  });
}

/**
 * Deals damage to an enemy with Boss damage modifier, knockback resistance,
 * rate-limited Lifesteal, Burn application, hit-flash, and kill handling.
 */
export function damageEnemy(
  state: SimState,
  catalog: GameDataCatalog,
  enemy: EnemyState,
  rawDamage: number,
  isCrit: boolean,
  knockback: number,
  sourceWeaponUid: number,
  fromX: number,
  fromY: number,
  lifestealBonus = 0,
  burnDmg = 0,
  burnDurSec = 0,
  depth = 0,
): void {
  if (enemy.hp <= 0) return;

  const player = state.player;
  const stats = player.computedStats;

  let dmg = rawDamage;
  if ((enemy.kind === 'boss' || enemy.kind === 'elite') && stats.damage_against_bosses !== 0) {
    dmg *= Math.max(0.1, 1 + stats.damage_against_bosses / 100);
  }
  const finalDmg = Math.max(1, Math.round(dmg));

  enemy.hp -= finalDmg;
  enemy.hitFlashTicks = 6;
  state.runStats.damageDealt += finalDmg;
  if (isCrit) {
    state.runStats.critsLanded += 1;
  }

  // Knockback scaled by (1 - enemy.knockbackResistance)
  const kbTotal = Math.max(0, knockback + stats.knockback);
  const kbResist = clamp(enemy.knockbackResistance, 0, 1);
  if (kbTotal > 0 && kbResist < 1) {
    const dx = enemy.x - fromX;
    const dy = enemy.y - fromY;
    const dist = Math.hypot(dx, dy) || 1;
    const impulse = kbTotal * 14 * (1 - kbResist);
    enemy.kbVx += (dx / dist) * impulse;
    enemy.kbVy += (dy / dist) * impulse;
  }

  // Lifesteal with global LIFESTEAL_COOLDOWN_TICKS = 6 rate limiter
  if (player.lifestealCooldownTicks <= 0 && stats.ban_lifesteal <= 0) {
    const lsChance = clamp(lifestealBonus + stats.stat_lifesteal / 100, 0, 1);
    if (lsChance > 0 && nextRand(state) < lsChance) {
      healPlayer(state, 1, false);
      player.lifestealCooldownTicks = LIFESTEAL_COOLDOWN_TICKS;
    }
  }

  // Weapon burn application
  if (burnDmg > 0) {
    applyBurnToEnemy(state, enemy, burnDmg, burnDurSec > 0 ? burnDurSec : 3, 30);
  }

  state.events.push({
    type: 'enemy_hit',
    x: enemy.x,
    y: enemy.y,
    damage: finalDmg,
    isCrit,
    enemyId: enemy.defId,
    isBoss: enemy.kind === 'boss',
  });

  if (depth === 0) {
    triggerEffects(state, catalog, 'on_enemy_hit', {
      enemy,
      damage: finalDmg,
      isCrit,
      x: enemy.x,
      y: enemy.y,
      depth: 1,
      damageEnemy: makeDamageCallback(state, catalog, 1),
    });
  }

  if (enemy.hp <= 0) {
    killEnemy(state, catalog, enemy, isCrit, sourceWeaponUid, depth);
  }
}

/**
 * Finds the nearest alive enemy within `maxRange` using the spatial hash grid.
 */
function findNearestEnemyInRange(
  state: SimState,
  enemyGrid: SpatialHashGrid,
  x: number,
  y: number,
  maxRange: number,
): EnemyState | null {
  const candidates = enemyGrid.queryCircle(x, y, maxRange + 64, queryScratch);
  let best: EnemyState | null = null;
  let bestDistSq = Infinity;

  for (let i = 0; i < candidates.length; i++) {
    const idx = candidates[i];
    const e = state.enemies[idx];
    if (!e || e.hp <= 0) continue;
    const dx = e.x - x;
    const dy = e.y - y;
    const reach = maxRange + e.radius;
    const dSq = dx * dx + dy * dy;
    if (dSq <= reach * reach && dSq < bestDistSq) {
      bestDistSq = dSq;
      best = e;
    }
  }
  return best;
}

/**
 * Finds the nearest alive tree within `maxRange` when no enemy is in range.
 */
function findNearestTreeInRange(
  state: SimState,
  x: number,
  y: number,
  maxRange: number,
): TreeState | null {
  let best: TreeState | null = null;
  let bestDistSq = Infinity;
  for (let i = 0; i < state.trees.length; i++) {
    const tr = state.trees[i];
    if (tr.hp <= 0) continue;
    const dx = tr.x - x;
    const dy = tr.y - y;
    const reach = maxRange + tr.radius;
    const dSq = dx * dx + dy * dy;
    if (dSq <= reach * reach && dSq < bestDistSq) {
      bestDistSq = dSq;
      best = tr;
    }
  }
  return best;
}

/**
 * Updates all equipped floating weapons: anchor placement, auto/manual aim,
 * cooldowns, melee thrust/sweep hitboxes, ranged multi-shot/spread/pierce/bounce,
 * recoil animation, Stick stacking, and Shuriken crit bounces.
 */
export function updateWeapons(
  state: SimState,
  input: InputFrame,
  catalog: GameDataCatalog,
  enemyGrid: SpatialHashGrid,
): void {
  const player = state.player;
  const stats = player.computedStats;
  const weapons = player.weapons;
  const count = weapons.length;
  if (count === 0) return;

  const pivotX = player.x;
  const pivotY = player.y - 24;

  // Count Stick weapons for Stick stacking bonus (+4 / +6 / +8 / +10 per additional Stick)
  let stickCount = 0;
  for (let i = 0; i < count; i++) {
    if (weapons[i].weaponId === 'stick') stickCount += 1;
  }
  const stickPerOther = [4, 6, 8, 10];

  const manualMode = !state.autoAim || input.aimActive;

  for (let i = 0; i < count; i++) {
    const eq = weapons[i];
    const wDef = catalog.weaponsById[eq.weaponId];
    if (!wDef) continue;
    const tierStats = wDef.tiers[eq.tier] ?? wDef.tiers[wDef.minTier];
    if (!tierStats) continue;

    eq.prevWorldX = eq.worldX;
    eq.prevWorldY = eq.worldY;

    if (eq.cooldownTicks > 0) eq.cooldownTicks -= 1;
    if (eq.recoilTimer > 0) eq.recoilTimer -= 1;
    if (eq.swingTimer > 0) eq.swingTimer -= 1;

    const anchor = getWeaponAnchorOffset(i, count);
    const anchorX = pivotX + anchor.x;
    const anchorY = pivotY + anchor.y;

    const isMelee = wDef.kind === 'melee';
    const effectiveRange = computeEffectiveRange(
      tierStats.maxRange,
      isMelee,
      stats.stat_range,
    );

    let hasTarget = false;
    eq.targetEnemyUid = 0;

    if (manualMode) {
      if (input.hasWorldAim && !input.aimActive) {
        eq.aimAngle = Math.atan2(
          state.manualAimWorldY - anchorY,
          state.manualAimWorldX - anchorX,
        );
      } else if (Math.abs(input.aimX) > 0.05 || Math.abs(input.aimY) > 0.05) {
        eq.aimAngle = Math.atan2(input.aimY, input.aimX);
      } else if (input.hasWorldAim) {
        eq.aimAngle = Math.atan2(
          state.manualAimWorldY - anchorY,
          state.manualAimWorldX - anchorX,
        );
      }
      // In manual mode: fire if player actively holds aim OR any enemy/tree is within range
      if (input.aimActive) {
        hasTarget = true;
      } else {
        const nearest = findNearestEnemyInRange(state, enemyGrid, anchorX, anchorY, effectiveRange * 1.15);
        if (nearest) {
          hasTarget = true;
          eq.targetEnemyUid = nearest.uid;
        } else if (findNearestTreeInRange(state, anchorX, anchorY, effectiveRange)) {
          hasTarget = true;
        }
      }
    } else {
      const targetEnemy = findNearestEnemyInRange(state, enemyGrid, anchorX, anchorY, effectiveRange);
      if (targetEnemy) {
        eq.aimAngle = Math.atan2(targetEnemy.y - anchorY, targetEnemy.x - anchorX);
        eq.targetEnemyUid = targetEnemy.uid;
        hasTarget = true;
      } else {
        const targetTree = findNearestTreeInRange(state, anchorX, anchorY, effectiveRange);
        if (targetTree) {
          eq.aimAngle = Math.atan2(targetTree.y - anchorY, targetTree.x - anchorX);
          hasTarget = true;
        } else if (eq.swingTimer <= 0) {
          eq.aimAngle = player.facingX >= 0 ? 0 : Math.PI;
        }
      }
    }

    // Fire when ready & target available
    if (eq.cooldownTicks <= 0 && hasTarget) {
      // Damage calculation
      let baseScaled = tierStats.damage + eq.bonusDamage;
      for (let s = 0; s < tierStats.scalingStats.length; s++) {
        const [statKey, weight] = tierStats.scalingStats[s];
        baseScaled += (stats[statKey] ?? 0) * weight;
      }

      // Stick stacking bonus
      if (eq.weaponId === 'stick' && stickCount > 1) {
        const per = stickPerOther[clamp(eq.tier - 1, 0, 3)];
        baseScaled += (stickCount - 1) * per;
      }

      const dmgMult = Math.max(0.1, 1 + stats.stat_percent_damage / 100);
      const baseDmg = Math.max(1, Math.round(baseScaled * dmgMult));

      const critCap = stats.crit_cap > 0 ? stats.crit_cap : 1.0;
      const critChance = clamp(
        tierStats.critChance + stats.stat_crit_chance / 100,
        0,
        critCap,
      );
      const isCrit = nextRand(state) < critChance;
      const critMult = Math.max(1.1, tierStats.critDamage + stats.bonus_crit_damage / 100);
      const finalDmg = isCrit ? Math.max(1, Math.round(baseDmg * critMult)) : baseDmg;

      const cd = computeEffectiveCooldown(tierStats.cooldown, stats.stat_attack_speed);
      eq.cooldownTicks = cd;
      eq.maxCooldownTicks = cd;

      const recoilDur = Math.max(
        2,
        Math.round((tierStats.recoilDuration || WEAPON_RECOIL_TICKS / SIM_HZ) * SIM_HZ),
      );
      eq.recoilTimer = recoilDur;
      eq.recoilOffset = tierStats.recoil || WEAPON_RECOIL_PX;

      state.events.push({
        type: 'weapon_fire',
        weaponId: wDef.id,
        soundKind: wDef.soundKind,
        x: anchorX,
        y: anchorY,
        angle: eq.aimAngle,
        isMelee,
      });

      if (isMelee) {
        // Resolve attack mode: 0 = thrust, 1 = sweep, 2 = alternate
        let mode: 0 | 1;
        if (tierStats.attackType === 2) {
          mode = eq.alternateNext;
          eq.alternateNext = eq.alternateNext === 0 ? 1 : 0;
        } else {
          mode = tierStats.attackType;
        }

        eq.swingType = mode;
        eq.swingDir = eq.swingDir >= 0 ? -1 : 1;
        eq.swingDuration = clamp(Math.round(cd * 0.45), 6, 16);
        eq.swingTimer = eq.swingDuration;

        const dirX = Math.cos(eq.aimAngle);
        const dirY = Math.sin(eq.aimAngle);

        if (mode === 0) {
          // Thrust: directional linear swept hitbox out to effectiveRange
          const tipX = anchorX + dirX * effectiveRange;
          const tipY = anchorY + dirY * effectiveRange;
          const thrustHalfWidth = 28;

          state.hazards.push({
            uid: allocUid(state),
            kind: 'melee_slash',
            owner: 'player',
            x: anchorX,
            y: anchorY,
            endX: tipX,
            endY: tipY,
            angle: eq.aimAngle,
            arcSpan: 0.42,
            radius: effectiveRange,
            damage: finalDmg,
            ticksLeft: eq.swingDuration,
            maxTicks: eq.swingDuration,
            activeDelayTicks: 0,
            color: wDef.color,
            hitPlayer: false,
          });

          const midX = (anchorX + tipX) * 0.5;
          const midY = (anchorY + tipY) * 0.5;
          const candidates = enemyGrid.queryCircle(
            midX,
            midY,
            effectiveRange * 0.5 + thrustHalfWidth + 64,
            queryScratch,
          );
          const hitTargets: EnemyState[] = [];
          for (let c = 0; c < candidates.length; c++) {
            const e = state.enemies[candidates[c]];
            if (!e || e.hp <= 0) continue;
            const hitR = thrustHalfWidth + e.radius;
            if (pointToSegmentDistSq(e.x, e.y, anchorX, anchorY, tipX, tipY) <= hitR * hitR) {
              hitTargets.push(e);
            }
          }
          for (let h = 0; h < hitTargets.length; h++) {
            const e = hitTargets[h];
            damageEnemy(
              state,
              catalog,
              e,
              finalDmg,
              isCrit,
              tierStats.knockback,
              eq.uid,
              anchorX,
              anchorY,
              tierStats.lifesteal,
              tierStats.burnDamage,
              tierStats.burnDuration,
              0,
            );
            if (tierStats.explosionRadius > 0) {
              spawnEffectExplosion(
                state,
                e.x,
                e.y,
                tierStats.explosionRadius,
                tierStats.explosionDamage || finalDmg,
                wDef.color,
                { depth: 1, damageEnemy: makeDamageCallback(state, catalog, 1) },
              );
            }
          }

          // Hit trees along thrust line
          for (let t = 0; t < state.trees.length; t++) {
            const tr = state.trees[t];
            if (tr.hp <= 0) continue;
            const hitR = thrustHalfWidth + tr.radius;
            if (pointToSegmentDistSq(tr.x, tr.y, anchorX, anchorY, tipX, tipY) <= hitR * hitR) {
              damageTree(state, tr, finalDmg);
            }
          }
        } else {
          // Sweep: cleaving arc over swing duration
          const sweepReach = Math.max(
            effectiveRange,
            Math.min(MIN_SWEEP_DISTANCE, effectiveRange * 1.05),
          );
          const halfArc = 1.08; // ~124 degree wide cleave

          state.hazards.push({
            uid: allocUid(state),
            kind: 'melee_slash',
            owner: 'player',
            x: anchorX,
            y: anchorY,
            endX: anchorX + dirX * sweepReach,
            endY: anchorY + dirY * sweepReach,
            angle: eq.aimAngle,
            arcSpan: halfArc * 2,
            radius: sweepReach,
            damage: finalDmg,
            ticksLeft: eq.swingDuration,
            maxTicks: eq.swingDuration,
            activeDelayTicks: 0,
            color: wDef.color,
            hitPlayer: false,
          });

          const candidates = enemyGrid.queryCircle(anchorX, anchorY, sweepReach + 64, queryScratch);
          const hitTargets: EnemyState[] = [];
          for (let c = 0; c < candidates.length; c++) {
            const e = state.enemies[candidates[c]];
            if (!e || e.hp <= 0) continue;
            const dx = e.x - anchorX;
            const dy = e.y - anchorY;
            const maxR = sweepReach + e.radius;
            const dSq = dx * dx + dy * dy;
            if (dSq > maxR * maxR) continue;
            // Enemies very close to anchor always get cleaved
            if (dSq <= 42 * 42 || Math.abs(angleDiff(Math.atan2(dy, dx), eq.aimAngle)) <= halfArc) {
              hitTargets.push(e);
            }
          }
          for (let h = 0; h < hitTargets.length; h++) {
            const e = hitTargets[h];
            damageEnemy(
              state,
              catalog,
              e,
              finalDmg,
              isCrit,
              tierStats.knockback,
              eq.uid,
              anchorX,
              anchorY,
              tierStats.lifesteal,
              tierStats.burnDamage,
              tierStats.burnDuration,
              0,
            );
            if (tierStats.explosionRadius > 0) {
              spawnEffectExplosion(
                state,
                e.x,
                e.y,
                tierStats.explosionRadius,
                tierStats.explosionDamage || finalDmg,
                wDef.color,
                { depth: 1, damageEnemy: makeDamageCallback(state, catalog, 1) },
              );
            }
          }

          // Hit trees in sweep arc
          for (let t = 0; t < state.trees.length; t++) {
            const tr = state.trees[t];
            if (tr.hp <= 0) continue;
            const dx = tr.x - anchorX;
            const dy = tr.y - anchorY;
            const maxR = sweepReach + tr.radius;
            if (dx * dx + dy * dy <= maxR * maxR) {
              if (Math.abs(angleDiff(Math.atan2(dy, dx), eq.aimAngle)) <= halfArc) {
                damageTree(state, tr, finalDmg);
              }
            }
          }
        }

        // Bonus secondary projectiles on melee weapons like Cactus Mace
        if (tierStats.projectiles > 0) {
          const extraCount = tierStats.projectiles;
          const speed = Math.max(420, tierStats.projectileSpeed || 720);
          for (let p = 0; p < extraCount; p++) {
            const a = eq.aimAngle + ((p - (extraCount - 1) / 2) * 0.25);
            state.projectiles.push({
              uid: allocUid(state),
              owner: 'player',
              x: anchorX + Math.cos(a) * 18,
              y: anchorY + Math.sin(a) * 18,
              prevX: anchorX,
              prevY: anchorY,
              vx: Math.cos(a) * speed,
              vy: Math.sin(a) * speed,
              radius: 7,
              damage: Math.max(1, Math.round(finalDmg * 0.5)),
              isCrit: false,
              knockback: 2,
              lifesteal: 0,
              pierceLeft: 0,
              pierceDmgMult: 0.5,
              bounceLeft: 0,
              bounceDmgMult: 0.5,
              explosionRadius: 0,
              explosionDamage: 0,
              burnDamage: 0,
              burnDurationSec: 0,
              lifeTicks: 36,
              maxLifeTicks: 36,
              spriteId: wDef.projectileSpriteId ?? 'proj_bullet',
              color: wDef.color,
              hitEnemyUids: [],
              sourceWeaponUid: eq.uid,
            });
          }
        }
      } else {
        // Ranged weapon projectile emission
        const projCount = Math.max(1, tierStats.projectiles);
        const speed = Math.max(280, tierStats.projectileSpeed || 860);
        const spreadCone = (1 - clamp(tierStats.accuracy, 0, 1)) * 0.62;
        const fanTotal = projCount > 1 ? Math.min(0.65, (projCount - 1) * 0.12) : 0;

        const pierceCount = Math.max(0, Math.round(tierStats.piercing + stats.piercing));
        let bounceCount = Math.max(0, Math.round(tierStats.bounce + stats.bounce));

        // Shuriken crit bounce mechanic
        if (wDef.id === 'shuriken' && isCrit) {
          bounceCount += eq.tier;
        }

        const pierceDmgMult = clamp(
          1 - tierStats.piercingDamageReduction + stats.piercing_damage / 100,
          0.1,
          1.5,
        );
        const bounceDmgMult = clamp(1 - tierStats.bounceDamageReduction, 0.1, 1.5);
        const lifeTicks = clamp(
          Math.ceil(((effectiveRange * 1.25) / speed) * SIM_HZ),
          12,
          180,
        );

        const muzzleDist = 18;
        for (let p = 0; p < projCount; p++) {
          const fanOffset =
            projCount > 1 ? -fanTotal * 0.5 + (fanTotal * p) / (projCount - 1) : 0;
          const jitter = spreadCone > 0 ? randRange(state, -spreadCone * 0.5, spreadCone * 0.5) : 0;
          const angle = eq.aimAngle + fanOffset + jitter;
          const sx = anchorX + Math.cos(angle) * muzzleDist;
          const sy = anchorY + Math.sin(angle) * muzzleDist;

          state.projectiles.push({
            uid: allocUid(state),
            owner: 'player',
            x: sx,
            y: sy,
            prevX: anchorX,
            prevY: anchorY,
            vx: Math.cos(angle) * speed,
            vy: Math.sin(angle) * speed,
            radius: tierStats.explosionRadius > 0 ? 10 : 7,
            damage: finalDmg,
            isCrit,
            knockback: tierStats.knockback,
            lifesteal: tierStats.lifesteal,
            pierceLeft: pierceCount,
            pierceDmgMult,
            bounceLeft: bounceCount,
            bounceDmgMult,
            explosionRadius: tierStats.explosionRadius,
            explosionDamage: tierStats.explosionDamage || finalDmg,
            burnDamage: tierStats.burnDamage,
            burnDurationSec: tierStats.burnDuration,
            lifeTicks,
            maxLifeTicks: lifeTicks,
            spriteId: wDef.projectileSpriteId ?? 'proj_bullet',
            color: wDef.color,
            hitEnemyUids: [],
            sourceWeaponUid: eq.uid,
          });
        }
      }
    }

    // Update animated world position (recoil kickback + melee jab/sweep visual)
    let wx = anchorX;
    let wy = anchorY;
    if (isMelee && eq.swingTimer > 0 && eq.swingDuration > 0) {
      const progress = 1 - eq.swingTimer / eq.swingDuration;
      if (eq.swingType === 0) {
        const thrustWave = progress < 0.45 ? progress / 0.45 : (1 - progress) / 0.55;
        const reach = Math.min(effectiveRange * 0.78, 150);
        wx += Math.cos(eq.aimAngle) * reach * thrustWave;
        wy += Math.sin(eq.aimAngle) * reach * thrustWave;
      } else {
        const sweepAngle = eq.aimAngle + (progress * 2 - 1) * 0.95 * eq.swingDir;
        const radius = Math.min(effectiveRange * 0.55, 95);
        wx += Math.cos(sweepAngle) * radius;
        wy += Math.sin(sweepAngle) * radius;
      }
    } else if (eq.recoilTimer > 0) {
      const frac = eq.recoilTimer / WEAPON_RECOIL_TICKS;
      const dist = eq.recoilOffset * clamp(frac, 0, 1);
      wx -= Math.cos(eq.aimAngle) * dist;
      wy -= Math.sin(eq.aimAngle) * dist;
    }

    eq.worldX = wx;
    eq.worldY = wy;
  }
}

/**
 * Advances all player, structure, and enemy projectiles with swept segment
 * collision detection, pierce, bounce, AoE explosions, and tree hits.
 */
export function updateProjectiles(
  state: SimState,
  catalog: GameDataCatalog,
  enemyGrid: SpatialHashGrid,
): void {
  const player = state.player;
  const pHurtX = player.x;
  const pHurtY = player.y + PLAYER_HURT_OFFSET_Y;

  let writeIdx = 0;
  for (let i = 0; i < state.projectiles.length; i++) {
    const pr = state.projectiles[i];
    pr.prevX = pr.x;
    pr.prevY = pr.y;
    pr.x += pr.vx * FIXED_DT;
    pr.y += pr.vy * FIXED_DT;
    pr.lifeTicks -= 1;

    let alive = pr.lifeTicks > 0;
    if (
      pr.x < PLAYABLE_MIN_X - 48 ||
      pr.x > PLAYABLE_MAX_X + 48 ||
      pr.y < PLAYABLE_MIN_Y - 48 ||
      pr.y > PLAYABLE_MAX_Y + 48
    ) {
      alive = false;
    }

    if (alive && pr.owner === 'enemy') {
      const hitR = PLAYER_HURT_RADIUS + pr.radius;
      if (pointToSegmentDistSq(pHurtX, pHurtY, pr.prevX, pr.prevY, pr.x, pr.y) <= hitR * hitR) {
        damagePlayer(state, catalog, pr.damage, pr.prevX, pr.prevY, false);
        alive = false;
      }
    } else if (alive) {
      // Player or Structure projectile vs Enemies
      const segLen = Math.hypot(pr.x - pr.prevX, pr.y - pr.prevY);
      const midX = (pr.x + pr.prevX) * 0.5;
      const midY = (pr.y + pr.prevY) * 0.5;
      const candidates = enemyGrid.queryCircle(
        midX,
        midY,
        segLen * 0.5 + pr.radius + 64,
        queryScratch,
      );

      for (let c = 0; c < candidates.length && alive; c++) {
        const e = state.enemies[candidates[c]];
        if (!e || e.hp <= 0) continue;
        if (pr.hitEnemyUids.includes(e.uid)) continue;

        const hitR = pr.radius + e.radius;
        if (pointToSegmentDistSq(e.x, e.y, pr.prevX, pr.prevY, pr.x, pr.y) > hitR * hitR) {
          continue;
        }

        pr.hitEnemyUids.push(e.uid);
        damageEnemy(
          state,
          catalog,
          e,
          pr.damage,
          pr.isCrit,
          pr.knockback,
          pr.sourceWeaponUid,
          pr.prevX,
          pr.prevY,
          pr.lifesteal,
          pr.burnDamage,
          pr.burnDurationSec,
          0,
        );

        if (pr.explosionRadius > 0) {
          spawnEffectExplosion(
            state,
            pr.x,
            pr.y,
            pr.explosionRadius,
            pr.explosionDamage || pr.damage,
            pr.color,
            { depth: 1, damageEnemy: makeDamageCallback(state, catalog, 1) },
          );
        }

        // Bounce to nearest un-hit living enemy
        if (pr.bounceLeft > 0) {
          let nextTarget: EnemyState | null = null;
          let bestDistSq = 380 * 380;
          for (let j = 0; j < state.enemies.length; j++) {
            const other = state.enemies[j];
            if (other.hp <= 0 || pr.hitEnemyUids.includes(other.uid)) continue;
            const dx = other.x - pr.x;
            const dy = other.y - pr.y;
            const dSq = dx * dx + dy * dy;
            if (dSq < bestDistSq) {
              bestDistSq = dSq;
              nextTarget = other;
            }
          }
          if (nextTarget) {
            const spd = Math.hypot(pr.vx, pr.vy) || 600;
            const ang = Math.atan2(nextTarget.y - pr.y, nextTarget.x - pr.x);
            pr.vx = Math.cos(ang) * spd;
            pr.vy = Math.sin(ang) * spd;
            pr.bounceLeft -= 1;
            pr.damage = Math.max(1, Math.round(pr.damage * pr.bounceDmgMult));
            pr.lifeTicks = Math.max(pr.lifeTicks, 30);
            continue;
          }
        }

        // Pierce through enemy
        if (pr.pierceLeft > 0) {
          pr.pierceLeft -= 1;
          pr.damage = Math.max(1, Math.round(pr.damage * pr.pierceDmgMult));
        } else {
          alive = false;
        }
      }

      // Check Trees if projectile is still alive
      if (alive) {
        for (let t = 0; t < state.trees.length; t++) {
          const tr = state.trees[t];
          if (tr.hp <= 0) continue;
          const hitR = pr.radius + tr.radius;
          if (pointToSegmentDistSq(tr.x, tr.y, pr.prevX, pr.prevY, pr.x, pr.y) <= hitR * hitR) {
            damageTree(state, tr, pr.damage);
            if (pr.explosionRadius > 0) {
              spawnEffectExplosion(
                state,
                pr.x,
                pr.y,
                pr.explosionRadius,
                pr.explosionDamage || pr.damage,
                pr.color,
                { depth: 1, damageEnemy: makeDamageCallback(state, catalog, 1) },
              );
            }
            if (pr.pierceLeft > 0) {
              pr.pierceLeft -= 1;
            } else {
              alive = false;
              break;
            }
          }
        }
      }
    }

    if (alive) {
      state.projectiles[writeIdx] = pr;
      writeIdx += 1;
    }
  }
  state.projectiles.length = writeIdx;
}

/**
 * Updates all player structures (turret, medical_turret, mine, garden, laser_turret, explosive_turret).
 */
export function updateStructures(
  state: SimState,
  catalog: GameDataCatalog,
  enemyGrid: SpatialHashGrid,
): void {
  const player = state.player;
  const stats = player.computedStats;

  for (let i = 0; i < state.structures.length; i++) {
    const st = state.structures[i];
    if (st.recoil > 0) st.recoil = Math.max(0, st.recoil - 1.5);
    if (st.cooldownTicks > 0) st.cooldownTicks -= 1;

    if (st.kind === 'garden') {
      if (st.cooldownTicks <= 0) {
        spawnConsumableDrop(
          state,
          st.x + randRange(state, -28, 28),
          st.y + randRange(state, -28, 28),
        );
        st.cooldownTicks = st.maxCooldownTicks;
      }
      continue;
    }

    if (st.kind === 'medical_turret') {
      if (st.cooldownTicks <= 0 && player.hp < player.maxHp) {
        const dx = player.x - st.x;
        const dy = player.y - st.y;
        if (dx * dx + dy * dy <= st.range * st.range) {
          st.aimAngle = Math.atan2(dy, dx);
          st.recoil = 8;
          healPlayer(state, Math.max(1, st.damage), false);
          st.cooldownTicks = st.maxCooldownTicks;
        }
      }
      continue;
    }

    if (st.kind === 'mine') {
      if (st.triggered) {
        if (st.cooldownTicks <= 0) {
          st.triggered = false;
        }
        continue;
      }
      const triggerR = 46;
      const nearby = enemyGrid.queryCircle(st.x, st.y, triggerR + 36, queryScratch);
      let detonated = false;
      for (let c = 0; c < nearby.length; c++) {
        const e = state.enemies[nearby[c]];
        if (!e || e.hp <= 0) continue;
        const dx = e.x - st.x;
        const dy = e.y - st.y;
        const hr = triggerR + e.radius;
        if (dx * dx + dy * dy <= hr * hr) {
          detonated = true;
          break;
        }
      }
      if (detonated) {
        st.triggered = true;
        st.cooldownTicks = st.maxCooldownTicks;
        spawnEffectExplosion(state, st.x, st.y, st.range, st.damage, '#ff8533', {
          depth: 1,
          damageEnemy: makeDamageCallback(state, catalog, 1),
        });
      }
      continue;
    }

    // Offensive turrets: turret, laser_turret, explosive_turret
    const target = findNearestEnemyInRange(state, enemyGrid, st.x, st.y, st.range);
    if (!target) continue;
    st.aimAngle = Math.atan2(target.y - st.y, target.x - st.x);

    if (st.cooldownTicks <= 0) {
      st.cooldownTicks = st.maxCooldownTicks;
      st.recoil = 10;

      const isLaser = st.kind === 'laser_turret';
      const isExplosive = st.kind === 'explosive_turret';
      const speed = isLaser ? 1150 : isExplosive ? 640 : 820;
      const lifeTicks = clamp(Math.ceil(((st.range * 1.25) / speed) * SIM_HZ), 15, 120);

      state.projectiles.push({
        uid: allocUid(state),
        owner: 'structure',
        x: st.x + Math.cos(st.aimAngle) * 18,
        y: st.y + Math.sin(st.aimAngle) * 18,
        prevX: st.x,
        prevY: st.y,
        vx: Math.cos(st.aimAngle) * speed,
        vy: Math.sin(st.aimAngle) * speed,
        radius: isExplosive ? 9 : 6,
        damage: st.damage,
        isCrit: false,
        knockback: isExplosive ? 10 : 3,
        lifesteal: 0,
        pierceLeft: isLaser ? 3 + Math.max(0, stats.piercing) : Math.max(0, stats.piercing),
        pierceDmgMult: 0.75,
        bounceLeft: Math.max(0, stats.bounce),
        bounceDmgMult: 0.5,
        explosionRadius: isExplosive ? 105 : 0,
        explosionDamage: isExplosive ? st.damage : 0,
        burnDamage: st.tier === 2 && st.kind === 'turret' ? Math.max(2, Math.round(st.damage * 0.4)) : 0,
        burnDurationSec: st.tier === 2 && st.kind === 'turret' ? 3 : 0,
        lifeTicks,
        maxLifeTicks: lifeTicks,
        spriteId: isLaser ? 'proj_laser' : isExplosive ? 'proj_rocket' : 'proj_bullet',
        color: isLaser ? '#59f2ff' : isExplosive ? '#ff7b33' : '#ffd859',
        hitEnemyUids: [],
        sourceWeaponUid: 0,
      });

      state.events.push({
        type: 'weapon_fire',
        weaponId: st.kind,
        soundKind: isLaser ? 'laser' : isExplosive ? 'rocket' : 'pistol',
        x: st.x,
        y: st.y,
        angle: st.aimAngle,
        isMelee: false,
      });
    }
  }
}

/**
 * Updates active ground/telegraphed hazards (boss beams/rings, melee slashes, explosions).
 */
export function updateHazards(state: SimState, catalog: GameDataCatalog): void {
  const player = state.player;
  const pHurtX = player.x;
  const pHurtY = player.y + PLAYER_HURT_OFFSET_Y;

  let writeIdx = 0;
  for (let i = 0; i < state.hazards.length; i++) {
    const hz = state.hazards[i];
    if (hz.activeDelayTicks > 0) {
      hz.activeDelayTicks -= 1;
    } else {
      hz.ticksLeft -= 1;
      if (hz.owner === 'enemy' && !hz.hitPlayer && hz.damage > 0) {
        let hit = false;
        if (hz.kind === 'boss_beam') {
          const r = hz.radius + PLAYER_HURT_RADIUS;
          if (pointToSegmentDistSq(pHurtX, pHurtY, hz.x, hz.y, hz.endX, hz.endY) <= r * r) {
            hit = true;
          }
        } else if (hz.kind === 'boss_ring') {
          const dist = Math.hypot(pHurtX - hz.x, pHurtY - hz.y);
          // Ring band around radius (or solid shockwave if small)
          const inner = Math.max(0, hz.radius - 36);
          const outer = hz.radius + PLAYER_HURT_RADIUS;
          if (dist >= inner && dist <= outer) {
            hit = true;
          }
        } else {
          const r = hz.radius + PLAYER_HURT_RADIUS;
          const dx = pHurtX - hz.x;
          const dy = pHurtY - hz.y;
          if (dx * dx + dy * dy <= r * r) {
            hit = true;
          }
        }
        if (hit) {
          hz.hitPlayer = true;
          damagePlayer(state, catalog, hz.damage, hz.x, hz.y, false);
        }
      }
    }

    if (hz.ticksLeft > 0 || hz.activeDelayTicks > 0) {
      state.hazards[writeIdx] = hz;
      writeIdx += 1;
    }
  }
  state.hazards.length = writeIdx;
}

/**
 * Updates burning DoT timers across all living enemies.
 */
export function updateEnemyBurn(state: SimState, catalog: GameDataCatalog): void {
  for (let i = 0; i < state.enemies.length; i++) {
    const e = state.enemies[i];
    if (e.hp <= 0 || e.burnTicksLeft <= 0) continue;
    e.burnTicksLeft -= 1;
    e.burnTickTimer -= 1;
    if (e.burnTickTimer <= 0) {
      e.burnTickTimer = Math.max(10, e.burnTickInterval);
      damageEnemy(
        state,
        catalog,
        e,
        Math.max(1, e.burnDamage),
        false,
        0,
        0,
        e.x,
        e.y,
        0,
        0,
        0,
        1,
      );
    }
  }
}

/**
 * Updates all floor pickups: scatter damping, magnet pull, wave-end rapid zip,
 * direct pickup collection, Loot Bag accounting, fruit healing, and crate queueing.
 */
export function updatePickups(
  state: SimState,
  catalog: GameDataCatalog,
  hooks: SimEconomyHooks,
  rapidWaveEndZip = false,
): void {
  const player = state.player;
  const stats = player.computedStats;
  const collectX = player.x;
  const collectY = player.y + PLAYER_PICKUP_OFFSET_Y;
  const magnetR = Math.max(
    40,
    PLAYER_MAGNET_BASE * (1 + stats.pickup_range / 100),
  );
  const magnetRSq = magnetR * magnetR;
  const pickupRSq = PLAYER_PICKUP_RADIUS * PLAYER_PICKUP_RADIUS;
  const rngFn = createRngFn(state);

  const canUseFruit =
    player.hp < player.maxHp ||
    stats.spicy_sauce_chance > 0 ||
    stats.hp_per_consumable_max > 0;

  let writeIdx = 0;
  for (let i = 0; i < state.pickups.length; i++) {
    const pk: PickupState = state.pickups[i];
    pk.prevX = pk.x;
    pk.prevY = pk.y;
    pk.ageTicks += 1;

    const dx = collectX - pk.x;
    const dy = collectY - pk.y;
    const distSq = dx * dx + dy * dy;

    const isCrate = pk.kind === 'crate' || pk.kind === 'legendary_crate';
    const isMaterial = pk.kind === 'material';
    const isConsumable = pk.kind === 'consumable';

    if (rapidWaveEndZip && (isMaterial || isCrate)) {
      pk.attracted = true;
      pk.attractSpeed = Math.max(pk.attractSpeed, 850);
    } else if (!pk.attracted) {
      if (isMaterial && (stats.instant_gold_attracting > 0 || distSq <= magnetRSq)) {
        pk.attracted = true;
      } else if (isCrate && distSq <= Math.max(magnetRSq, 180 * 180)) {
        pk.attracted = true;
      } else if (isConsumable && canUseFruit && distSq <= magnetRSq) {
        pk.attracted = true;
      }
    }

    if (pk.attracted && (!isConsumable || canUseFruit)) {
      const dist = Math.sqrt(distSq) || 1;
      pk.attractSpeed = Math.min(rapidWaveEndZip ? 1400 : 920, pk.attractSpeed + (rapidWaveEndZip ? 55 : 32));
      pk.vx = (dx / dist) * pk.attractSpeed;
      pk.vy = (dy / dist) * pk.attractSpeed;
      pk.x += pk.vx * FIXED_DT;
      pk.y += pk.vy * FIXED_DT;
    } else {
      pk.x += pk.vx * FIXED_DT;
      pk.y += pk.vy * FIXED_DT;
      pk.vx *= 0.86;
      pk.vy *= 0.86;
    }

    // Strict arena playable clamp so zero pickups ever leave the arena
    pk.x = clamp(pk.x, PLAYABLE_MIN_X + 12, PLAYABLE_MAX_X - 12);
    pk.y = clamp(pk.y, PLAYABLE_MIN_Y + 12, PLAYABLE_MAX_Y - 12);

    const postDx = collectX - pk.x;
    const postDy = collectY - pk.y;
    const postDistSq = postDx * postDx + postDy * postDy;
    const collectThresholdSq = rapidWaveEndZip ? (PLAYER_PICKUP_RADIUS + 18) ** 2 : pickupRSq;

    let collected = false;
    if (postDistSq <= collectThresholdSq) {
      if (isMaterial) {
        collected = true;
        player.materials += pk.value;
        state.runStats.materialsCollected += pk.value;
        const extraXp = stats.xp_per_material > 0 ? pk.value * stats.xp_per_material : 0;
        addXp(state, catalog, pk.value + extraXp);
        state.events.push({
          type: 'pickup_material',
          x: pk.x,
          y: pk.y,
          value: pk.value,
          isBoosted: pk.isBagBoosted,
        });
        triggerEffects(state, catalog, 'on_pickup_material', {
          x: pk.x,
          y: pk.y,
          depth: 0,
          damageEnemy: makeDamageCallback(state, catalog, 1),
        });
      } else if (isConsumable && canUseFruit) {
        collected = true;
        const healAmt = Math.max(1, BASE_FRUIT_HEAL + stats.consumable_heal);
        const actualHeal = healPlayer(state, healAmt, true);
        state.events.push({
          type: 'pickup_consumable',
          x: pk.x,
          y: pk.y,
          heal: actualHeal,
        });
        triggerEffects(state, catalog, 'on_pickup_consumable', {
          x: pk.x,
          y: pk.y,
          depth: 0,
          damageEnemy: makeDamageCallback(state, catalog, 1),
        });
      } else if (isCrate) {
        collected = true;
        const isLegendary = pk.kind === 'legendary_crate';
        hooks.enqueueCrate(state, catalog, isLegendary, rngFn);
        state.runStats.cratesOpened += 1;
        if (stats.item_box_gold > 0) {
          player.materials += Math.round(stats.item_box_gold);
          state.runStats.materialsCollected += Math.round(stats.item_box_gold);
        }
        state.events.push({
          type: 'pickup_crate',
          x: pk.x,
          y: pk.y,
          isLegendary,
        });
      }
    }

    if (!collected) {
      state.pickups[writeIdx] = pk;
      writeIdx += 1;
    }
  }
  state.pickups.length = writeIdx;
}

/**
 * Updates per-tick player survival & passive effects: HP regen, HP drain,
 * Alien Eyes bursts, stand-still income, and lifesteal/iframe/hitFlash timers.
 */
export function updatePlayerTickEffects(
  state: SimState,
  catalog: GameDataCatalog,
): void {
  const player = state.player;
  const stats = player.computedStats;

  if (player.iframesTicks > 0) player.iframesTicks -= 1;
  if (player.hitFlashTicks > 0) player.hitFlashTicks -= 1;
  if (player.lifestealCooldownTicks > 0) player.lifestealCooldownTicks -= 1;

  // HP Regeneration
  if (stats.ban_hp_regen <= 0 && stats.stat_hp_regen > 0 && player.hp < player.maxHp) {
    const interval = computeRegenIntervalTicks(stats.stat_hp_regen);
    if (interval > 0) {
      player.regenAccumulator += 1;
      if (player.regenAccumulator >= interval) {
        player.regenAccumulator -= interval;
        healPlayer(state, 1, false);
      }
    }
  } else {
    player.regenAccumulator = 0;
  }

  // Self HP Drain (e.g., Blood Donation, Sick)
  if (stats.hp_drain_per_sec > 0 && player.hp > 1 && !player.godMode) {
    player.hpDrainAccumulator += stats.hp_drain_per_sec * FIXED_DT;
    if (player.hpDrainAccumulator >= 1) {
      player.hpDrainAccumulator -= 1;
      damagePlayer(state, catalog, 1, player.x, player.y, true);
    }
  }

  // Alien Eyes periodic radial projectile ring
  if (stats.alien_eyes_interval > 0) {
    player.alienEyesTimer += 1;
    const periodTicks = Math.max(30, Math.round(stats.alien_eyes_interval * SIM_HZ));
    if (player.alienEyesTimer >= periodTicks) {
      player.alienEyesTimer = 0;
      const dmg = Math.max(
        1,
        Math.round((5 + player.maxHp * 0.5) * (1 + stats.stat_percent_damage / 100)),
      );
      const count = 6;
      const speed = 640;
      for (let k = 0; k < count; k++) {
        const ang = (k / count) * Math.PI * 2;
        state.projectiles.push({
          uid: allocUid(state),
          owner: 'player',
          x: player.x + Math.cos(ang) * 20,
          y: player.y - 16 + Math.sin(ang) * 20,
          prevX: player.x,
          prevY: player.y - 16,
          vx: Math.cos(ang) * speed,
          vy: Math.sin(ang) * speed,
          radius: 8,
          damage: dmg,
          isCrit: false,
          knockback: 4,
          lifesteal: 0,
          pierceLeft: 0,
          pierceDmgMult: 0.5,
          bounceLeft: 0,
          bounceDmgMult: 0.5,
          explosionRadius: 0,
          explosionDamage: 0,
          burnDamage: 0,
          burnDurationSec: 0,
          lifeTicks: 48,
          maxLifeTicks: 48,
          spriteId: 'proj_wand',
          color: '#7ef2ff',
          hitEnemyUids: [],
          sourceWeaponUid: 0,
        });
      }
    }
  }

  // Stand-still periodic effects (Streamer income, etc.)
  if (player.standStillTicks > 0) {
    triggerEffects(state, catalog, 'on_stand_still', {
      x: player.x,
      y: player.y,
      depth: 0,
      damageEnemy: makeDamageCallback(state, catalog, 1),
    });
  }

  // Prune felled trees cleanly
  let treeWrite = 0;
  for (let i = 0; i < state.trees.length; i++) {
    const tr = state.trees[i];
    if (tr.hitFlashTicks > 0) tr.hitFlashTicks -= 1;
    if (tr.hp > 0) {
      state.trees[treeWrite] = tr;
      treeWrite += 1;
    }
  }
  state.trees.length = treeWrite;
}
