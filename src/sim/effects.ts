// ============================================================================
// src/sim/effects.ts — Declarative EffectGraph Evaluator (Full Wave 2 Rules)
// ============================================================================

import {
  BASE_HARVESTING_GROWTH,
  ENDLESS_HARVESTING_DECAY,
  PLAYABLE_MAX_X,
  PLAYABLE_MAX_Y,
  PLAYABLE_MIN_X,
  PLAYABLE_MIN_Y,
  type EffectDef,
  type EffectTrigger,
  type EnemyState,
  type EquippedWeaponState,
  type GameDataCatalog,
  type SimState,
  type StatKey,
  type StructureState,
  type WeaponSetId,
} from '../contracts/index';
import { allocUid, nextRand, randRange } from './prng';
import { clamp, recomputePlayerStats } from './stats';

export interface EffectContext {
  enemy?: EnemyState;
  damage?: number;
  isCrit?: boolean;
  x?: number;
  y?: number;
  weapon?: EquippedWeaponState;
  depth?: number;
  damageEnemy?: (
    enemy: EnemyState,
    damage: number,
    isCrit: boolean,
    knockback: number,
    sourceWeaponUid: number,
    knockbackFromX: number,
    knockbackFromY: number,
  ) => void;
}

// Per-SimState deterministic tracker for dispatching `on_level_up` exactly once per new level
const lastProcessedLevelByState = new WeakMap<SimState, number>();

/**
 * Normalizes a probability expressed either in [0, 1] or percentage [0, 100].
 */
function normalizeChance(raw: number): number {
  if (raw <= 0) return 0;
  return clamp(raw > 1 ? raw / 100 : raw, 0, 1);
}

/**
 * Collects all active `EffectDef` entries currently owned by the player from
 * character passives, equipped items, active weapon set bonuses, and equipped
 * weapon tier `extraEffects`.
 */
export function collectPlayerEffects(
  state: SimState,
  catalog: GameDataCatalog,
): EffectDef[] {
  const player = state.player;
  const out: EffectDef[] = [];

  const charDef = catalog.charactersById[player.characterId];
  if (charDef) {
    for (let i = 0; i < charDef.effects.length; i++) {
      out.push(charDef.effects[i]);
    }
  }

  for (let i = 0; i < player.items.length; i++) {
    const itemDef = catalog.itemsById[player.items[i]];
    if (!itemDef) continue;
    for (let e = 0; e < itemDef.effects.length; e++) {
      out.push(itemDef.effects[e]);
    }
  }

  // Active weapon set bonuses
  for (const key in player.activeSetCounts) {
    const setId = key as WeaponSetId;
    const count = player.activeSetCounts[setId] ?? 0;
    if (count < 2) continue;
    const setDef = catalog.setsById[setId];
    if (!setDef) continue;
    const clampedCount = Math.min(6, count);
    for (let t = clampedCount; t >= 2; t--) {
      const list = setDef.bonuses[t];
      if (list && list.length > 0) {
        for (let b = 0; b < list.length; b++) {
          out.push(list[b]);
        }
        break;
      }
    }
  }

  // Equipped weapon tier extraEffects
  for (let i = 0; i < player.weapons.length; i++) {
    const eq = player.weapons[i];
    const wDef = catalog.weaponsById[eq.weaponId];
    const tierStats = wDef?.tiers[eq.tier];
    if (!tierStats) continue;
    for (let e = 0; e < tierStats.extraEffects.length; e++) {
      out.push(tierStats.extraEffects[e]);
    }
  }

  return out;
}

/**
 * Spawns an AoE explosion hazard + event and deals damage to enemies inside radius.
 */
export function spawnEffectExplosion(
  state: SimState,
  x: number,
  y: number,
  baseRadius: number,
  baseDamage: number,
  color: string,
  ctx: EffectContext,
): void {
  const stats = state.player.computedStats;
  const radius = Math.max(24, baseRadius * (1 + stats.explosion_size / 100));
  const dmg = Math.max(
    1,
    Math.round(
      baseDamage *
        (1 + (stats.stat_percent_damage + stats.explosion_damage) / 100),
    ),
  );

  state.hazards.push({
    uid: allocUid(state),
    kind: 'explosion',
    owner: 'player',
    x,
    y,
    endX: x,
    endY: y,
    angle: 0,
    arcSpan: Math.PI * 2,
    radius,
    damage: dmg,
    ticksLeft: 14,
    maxTicks: 14,
    activeDelayTicks: 0,
    color,
    hitPlayer: false,
  });

  state.events.push({ type: 'explosion', x, y, radius, color });
  state.events.push({
    type: 'decal',
    kind: 'scorch',
    x,
    y,
    radius: radius * 0.72,
    color: '#1b1720',
  });
  state.camera.shakeTrauma = Math.min(1, state.camera.shakeTrauma + 0.28);

  const rSq = radius * radius;
  const targets: EnemyState[] = [];
  for (let i = 0; i < state.enemies.length; i++) {
    const e = state.enemies[i];
    if (e.hp <= 0) continue;
    const dx = e.x - x;
    const dy = e.y - y;
    const hitR = radius + e.radius;
    if (dx * dx + dy * dy <= hitR * hitR || dx * dx + dy * dy <= rSq) {
      targets.push(e);
    }
  }

  for (let i = 0; i < targets.length; i++) {
    const e = targets[i];
    if (e.hp <= 0) continue;
    if (ctx.damageEnemy) {
      ctx.damageEnemy(e, dmg, false, 18, 0, x, y);
    } else {
      e.hp -= dmg;
      e.hitFlashTicks = 6;
      state.runStats.damageDealt += dmg;
    }
  }
}

/**
 * Applies a burn DoT to an enemy (stacking/refreshing with higher DPS).
 */
export function applyBurnToEnemy(
  state: SimState,
  enemy: EnemyState,
  baseBurnDmg: number,
  durationSec: number,
  tickInterval = 30,
): void {
  const stats = state.player.computedStats;
  const dmg = Math.max(
    1,
    Math.round(
      (baseBurnDmg + stats.burn_damage + stats.stat_elemental_damage * 0.5) *
        (1 + stats.stat_percent_damage / 100),
    ),
  );
  const ticks = Math.max(30, Math.round((durationSec + stats.burn_duration) * 60));
  if (dmg >= enemy.burnDamage || enemy.burnTicksLeft <= 0) {
    enemy.burnDamage = dmg;
  }
  enemy.burnTicksLeft = Math.max(enemy.burnTicksLeft, ticks);
  enemy.burnTickInterval = Math.max(10, tickInterval);
  if (enemy.burnTickTimer <= 0) {
    enemy.burnTickTimer = enemy.burnTickInterval;
  }
}

/**
 * Spawns a deterministic structure inside playable arena bounds.
 */
export function spawnStructure(
  state: SimState,
  kind: StructureState['kind'],
  tier = 1,
): void {
  const stats = state.player.computedStats;
  const margin = 120;
  const x = randRange(state, PLAYABLE_MIN_X + margin, PLAYABLE_MAX_X - margin);
  const y = randRange(state, PLAYABLE_MIN_Y + margin, PLAYABLE_MAX_Y - margin);
  const eng = stats.stat_engineering;
  const atkSpdMult = 1 + Math.max(-0.5, stats.structure_attack_speed / 100);
  const rangeBonus = stats.structure_range;
  const doubleBoost = stats.double_structure_effects > 0 ? 2 : 1;

  let baseCd = 54;
  let range = 360 + rangeBonus;
  let damage = Math.max(1, Math.round((10 + eng * 0.8) * (1 + (tier - 1) * 0.45) * doubleBoost));

  if (kind === 'medical_turret') {
    baseCd = 150;
    range = 420 + rangeBonus;
    damage = Math.max(1, Math.round((3 + eng * 0.15) * doubleBoost));
  } else if (kind === 'mine') {
    baseCd = 240;
    range = 95 + rangeBonus * 0.25;
    damage = Math.max(1, Math.round((20 + eng * 1.1) * doubleBoost));
  } else if (kind === 'garden') {
    baseCd = Math.max(240, 420 - (tier - 1) * 45);
    range = 64;
    damage = 0;
  } else if (kind === 'laser_turret') {
    baseCd = 78;
    range = 520 + rangeBonus;
    damage = Math.max(1, Math.round((24 + eng * 1.25) * (1 + (tier - 1) * 0.35) * doubleBoost));
  } else if (kind === 'explosive_turret') {
    baseCd = 96;
    range = 440 + rangeBonus;
    damage = Math.max(1, Math.round((26 + eng * 1.35) * (1 + (tier - 1) * 0.4) * doubleBoost));
  }

  const maxCd = Math.max(8, Math.round(baseCd / atkSpdMult));
  state.structures.push({
    uid: allocUid(state),
    kind,
    x: clamp(x, PLAYABLE_MIN_X + 48, PLAYABLE_MAX_X - 48),
    y: clamp(y, PLAYABLE_MIN_Y + 48, PLAYABLE_MAX_Y - 48),
    cooldownTicks: Math.round(maxCd * 0.4),
    maxCooldownTicks: maxCd,
    range,
    damage,
    aimAngle: 0,
    triggered: false,
    recoil: 0,
    tier,
  });
}

function addPermanentMod(state: SimState, stat: StatKey, delta: number): void {
  const mods = state.player.permanentStatMods;
  mods[stat] = (mods[stat] ?? 0) + delta;
}

function addTempWaveMod(state: SimState, stat: StatKey, delta: number): void {
  const mods = state.player.tempWaveStatMods;
  mods[stat] = (mods[stat] ?? 0) + delta;
}

function findNearestAliveEnemy(
  state: SimState,
  x: number,
  y: number,
  excludeUid: number,
  maxDist = Infinity,
): EnemyState | null {
  let best: EnemyState | null = null;
  let bestDistSq = maxDist * maxDist;
  for (let i = 0; i < state.enemies.length; i++) {
    const e = state.enemies[i];
    if (e.hp <= 0 || e.uid === excludeUid) continue;
    const dx = e.x - x;
    const dy = e.y - y;
    const dSq = dx * dx + dy * dy;
    if (dSq < bestDistSq) {
      bestDistSq = dSq;
      best = e;
    }
  }
  return best;
}

function pickRandomAliveEnemy(
  state: SimState,
  excludeUid = -1,
): EnemyState | null {
  let aliveCount = 0;
  for (let i = 0; i < state.enemies.length; i++) {
    const e = state.enemies[i];
    if (e.hp > 0 && e.uid !== excludeUid) aliveCount += 1;
  }
  if (aliveCount === 0) return null;
  const pick = Math.floor(nextRand(state) * aliveCount);
  let seen = 0;
  for (let i = 0; i < state.enemies.length; i++) {
    const e = state.enemies[i];
    if (e.hp <= 0 || e.uid === excludeUid) continue;
    if (seen === pick) return e;
    seen += 1;
  }
  return null;
}

/**
 * Fires a Lich arcane heal bolt toward a living enemy scaling with player Max HP.
 */
function fireLichHealBolt(
  state: SimState,
  ctx: EffectContext,
  maxHpScale = 1.0,
): void {
  const target = pickRandomAliveEnemy(state, -1);
  if (!target) return;
  const player = state.player;
  const stats = player.computedStats;
  const dmg = Math.max(
    1,
    Math.round(player.maxHp * maxHpScale * (1 + stats.stat_percent_damage / 100)),
  );
  const angle = Math.atan2(target.y - (player.y - 16), target.x - player.x);
  const speed = 940;
  state.projectiles.push({
    uid: allocUid(state),
    owner: 'player',
    x: player.x,
    y: player.y - 16,
    prevX: player.x,
    prevY: player.y - 16,
    vx: Math.cos(angle) * speed,
    vy: Math.sin(angle) * speed,
    radius: 9,
    damage: dmg,
    isCrit: false,
    knockback: 6,
    lifesteal: 0,
    pierceLeft: 0,
    pierceDmgMult: 0.5,
    bounceLeft: 0,
    bounceDmgMult: 0.5,
    explosionRadius: 0,
    explosionDamage: 0,
    burnDamage: 0,
    burnDurationSec: 0,
    lifeTicks: 54,
    maxLifeTicks: 54,
    spriteId: 'proj_wand',
    color: '#c959ff',
    hitEnemyUids: [],
    sourceWeaponUid: 0,
  });
  // Visual arcane strike flash on target if already close
  if (ctx.damageEnemy && Math.hypot(target.x - player.x, target.y - player.y) < 120) {
    state.events.push({
      type: 'explosion',
      x: target.x,
      y: target.y,
      radius: 32,
      color: '#c959ff',
    });
  }
}

/**
 * Fires a Baby with a Beard bonus bullet from (originX, originY) toward the nearest other enemy.
 */
function fireBabyBeardBullet(
  state: SimState,
  originX: number,
  originY: number,
  excludeUid: number,
): void {
  const stats = state.player.computedStats;
  const target = findNearestAliveEnemy(state, originX, originY, excludeUid, 580);
  const angle = target
    ? Math.atan2(target.y - originY, target.x - originX)
    : nextRand(state) * Math.PI * 2;
  const speed = 790;
  const dmg = Math.max(
    1,
    Math.round((1 + stats.stat_ranged_damage) * (1 + stats.stat_percent_damage / 100)),
  );
  state.projectiles.push({
    uid: allocUid(state),
    owner: 'player',
    x: originX,
    y: originY,
    prevX: originX,
    prevY: originY,
    vx: Math.cos(angle) * speed,
    vy: Math.sin(angle) * speed,
    radius: 7,
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
    spriteId: 'proj_bullet',
    color: '#ffe07d',
    hitEnemyUids: excludeUid > 0 ? [excludeUid] : [],
    sourceWeaponUid: 0,
  });
}

function hasLichHealMechanic(state: SimState, effects: readonly EffectDef[]): boolean {
  if (state.player.characterId === 'lich') return true;
  for (let i = 0; i < effects.length; i++) {
    const k = effects[i].customKey;
    if (k === 'lich_bolt' || k === 'heal_bolt' || k === 'damage_on_heal' || k === 'dmg_when_heal') {
      return true;
    }
  }
  return false;
}

function didPlayerHealThisTick(state: SimState): boolean {
  for (let i = state.events.length - 1; i >= 0; i--) {
    if (state.events[i].type === 'player_heal') return true;
  }
  return false;
}

function healPlayerDirect(
  state: SimState,
  amount: number,
  effects: readonly EffectDef[],
  ctx: EffectContext,
): number {
  if (amount <= 0) return 0;
  const p = state.player;
  const before = p.hp;
  p.hp = Math.min(p.maxHp, p.hp + amount);
  const healed = p.hp - before;
  if (healed > 0) {
    state.events.push({ type: 'player_heal', x: p.x, y: p.y - 24, amount: healed });
    if (hasLichHealMechanic(state, effects)) {
      fireLichHealBolt(state, ctx, 1.0);
    }
  }
  return healed;
}

/**
 * Syncs any pending level-ups since the last check so `on_level_up` triggers cleanly
 * during live combat XP gains and wave-end harvest XP payouts without double-firing.
 */
function syncPendingLevelUpTriggers(
  state: SimState,
  catalog: GameDataCatalog,
  childCtx: EffectContext,
): void {
  const currentLvl = state.player.level;
  const prevLvl = lastProcessedLevelByState.get(state);
  if (prevLvl === undefined || currentLvl < prevLvl) {
    lastProcessedLevelByState.set(state, currentLvl);
    return;
  }
  if (currentLvl > prevLvl) {
    const gained = currentLvl - prevLvl;
    lastProcessedLevelByState.set(state, currentLvl);
    for (let k = 0; k < gained; k++) {
      triggerEffects(state, catalog, 'on_level_up', childCtx);
    }
  }
}

/**
 * Evaluates both stat-driven built-in hooks and declarative `EffectDef` triggers
 * for a given gameplay trigger event.
 */
export function triggerEffects(
  state: SimState,
  catalog: GameDataCatalog,
  trigger: EffectTrigger,
  ctx: EffectContext = {},
): void {
  const depth = ctx.depth ?? 0;
  if (depth > 2) return;
  const childCtx: EffectContext = { ...ctx, depth: depth + 1 };

  const player = state.player;
  const stats = player.computedStats;
  const effects = collectPlayerEffects(state, catalog);
  let statsDirty = false;
  let handledExplosionOnHit = false;
  let handledMasochistHit = false;
  let handledLichBolt = false;
  let handledGluttonExplosion = false;
  let handledApprenticeLevelUp = false;
  let handledBabySlotLevelUp = false;

  // --- Built-in extended stat handlers by trigger ---
  if (trigger === 'on_hit_taken') {
    // Bull / Explosive on hit
    if (stats.explode_on_hit > 0) {
      const dmg = Math.max(
        10,
        Math.round(
          (30 +
            stats.stat_melee_damage * 2 +
            stats.stat_ranged_damage * 2 +
            stats.stat_elemental_damage * 2) *
            stats.explode_on_hit,
        ),
      );
      spawnEffectExplosion(state, player.x, player.y - 16, 175, dmg, '#ff7a2b', childCtx);
      handledExplosionOnHit = true;
    }
    // Blood Donation: gain materials on hit taken
    if (stats.blood_donation_gold > 0) {
      const gain = Math.round(stats.blood_donation_gold);
      player.materials += gain;
      state.runStats.materialsCollected += gain;
    }
  } else if (trigger === 'on_enemy_hit' && ctx.enemy) {
    // Scared Sausage: chance to ignite enemy on hit
    if (stats.burn_chance > 0) {
      const chance = normalizeChance(stats.burn_chance);
      if (nextRand(state) < chance) {
        applyBurnToEnemy(state, ctx.enemy, 3, 3.0, 30);
      }
    }
    // Baby with a Beard: spawn an extra bullet from struck enemy toward nearest other enemy
    // Note: combat.ts invokes on_enemy_hit with depth = 1 so depth <= 1 allows normal weapon hits without infinite recursion
    if (stats.baby_beard_chance > 0 && depth <= 1) {
      const chance = normalizeChance(stats.baby_beard_chance);
      if (nextRand(state) < chance) {
        fireBabyBeardBullet(state, ctx.enemy.x, ctx.enemy.y, ctx.enemy.uid);
      }
    }
    // Lich: if lifesteal healed on this hit, launch arcane heal bolt
    if (hasLichHealMechanic(state, effects) && didPlayerHealThisTick(state)) {
      fireLichHealBolt(state, childCtx, 1.0);
      handledLichBolt = true;
    }
  } else if (trigger === 'on_enemy_kill') {
    const kx = ctx.x ?? ctx.enemy?.x ?? player.x;
    const ky = ctx.y ?? ctx.enemy?.y ?? player.y;

    // Cyberball: chance to zap a random living enemy for Luck-scaled damage
    if (stats.cyberball_chance > 0 && state.enemies.length > 0) {
      const chance = normalizeChance(stats.cyberball_chance);
      if (nextRand(state) < chance) {
        const target = pickRandomAliveEnemy(state, ctx.enemy?.uid ?? -1);
        if (target) {
          const dmg = Math.max(
            1,
            Math.round(
              (5 + Math.max(0, stats.stat_luck) * 0.25) * (1 + stats.stat_percent_damage / 100),
            ),
          );
          if (childCtx.damageEnemy) {
            childCtx.damageEnemy(target, dmg, false, 6, 0, kx, ky);
          } else {
            target.hp -= dmg;
            target.hitFlashTicks = 5;
            state.runStats.damageDealt += dmg;
          }
          state.events.push({
            type: 'explosion',
            x: target.x,
            y: target.y,
            radius: 36,
            color: '#6cf2ff',
          });
        }
      }
    }

    // Rip and Tear / Explode on death
    if (stats.rip_and_tear_chance > 0 || stats.explode_on_death > 0) {
      const chance =
        stats.rip_and_tear_chance > 0
          ? normalizeChance(stats.rip_and_tear_chance)
          : 1.0;
      if (nextRand(state) < chance) {
        const dmg = Math.max(8, Math.round(12 + stats.stat_melee_damage * 0.8));
        spawnEffectExplosion(state, kx, ky, 118, dmg, '#ff4d3b', childCtx);
      }
    }

    // Hunting Trophy: gain materials on critical kill (supports stacked >100% chance cleanly)
    if (ctx.isCrit && stats.gold_on_crit_kill > 0) {
      const rawRate = stats.gold_on_crit_kill > 1 ? stats.gold_on_crit_kill / 100 : stats.gold_on_crit_kill;
      let bonusMats = Math.floor(rawRate);
      if (nextRand(state) < rawRate - bonusMats) {
        bonusMats += 1;
      }
      if (bonusMats > 0) {
        player.materials += bonusMats;
        state.runStats.materialsCollected += bonusMats;
        state.events.push({ type: 'pickup_material', x: kx, y: ky, value: bonusMats, isBoosted: false });
      }
    }

    // Life on kill chance (e.g. Siphon / Ghost / Vampire mechanics)
    if (stats.life_on_kill_chance > 0) {
      const chance = normalizeChance(stats.life_on_kill_chance);
      if (nextRand(state) < chance) {
        healPlayerDirect(state, 1, effects, childCtx);
      }
    }

    // Guaranteed Loot Alien crate drop (ensures killing a looter always yields a crate)
    if (ctx.enemy?.defId === 'looter') {
      let droppedCrate = false;
      for (let p = state.pickups.length - 1; p >= 0 && p >= state.pickups.length - 4; p--) {
        const pk = state.pickups[p];
        if ((pk.kind === 'crate' || pk.kind === 'legendary_crate') && pk.ageTicks === 0) {
          droppedCrate = true;
          break;
        }
      }
      if (!droppedCrate) {
        const pos = clampToArena(kx, ky, 22);
        state.pickups.push({
          uid: allocUid(state),
          kind: 'crate',
          x: pos.x,
          y: pos.y,
          prevX: pos.x,
          prevY: pos.y,
          vx: randRange(state, -45, 45),
          vy: randRange(state, -45, 45),
          value: 1,
          scale: 1.0,
          isBagBoosted: false,
          attracted: false,
          attractSpeed: 0,
          ageTicks: 0,
        });
      }
    }

    // Ethereal weapon permanent stat growth every N kills
    if (ctx.weapon) {
      const wDef = catalog.weaponsById[ctx.weapon.weaponId];
      if (wDef && wDef.sets.includes('ethereal')) {
        const thresholds = [20, 18, 16, 12];
        const needed = thresholds[clamp(ctx.weapon.tier - 1, 0, 3)];
        if (ctx.weapon.killsThisRun > 0 && ctx.weapon.killsThisRun % needed === 0) {
          if (wDef.id.includes('flint')) {
            addPermanentMod(state, 'stat_attack_speed', 1);
            statsDirty = true;
          } else if (wDef.id.includes('axe')) {
            addPermanentMod(state, 'stat_percent_damage', 1);
            statsDirty = true;
          } else if (wDef.id.includes('scepter') || wDef.id.includes('wand')) {
            addPermanentMod(state, 'stat_max_hp', 1);
            statsDirty = true;
          } else {
            addPermanentMod(state, 'stat_percent_damage', 1);
            statsDirty = true;
          }
        }
      }
    }
  } else if (trigger === 'on_dodge') {
    // Adrenaline: chance to heal 5 HP on dodge
    if (stats.heal_on_dodge_chance > 0) {
      const chance = normalizeChance(stats.heal_on_dodge_chance);
      if (nextRand(state) < chance) {
        healPlayerDirect(state, 5, effects, childCtx);
      }
    }
    // Speed on dodge: temporary wave speed boost
    if (stats.speed_on_dodge > 0) {
      addTempWaveMod(state, 'stat_speed', stats.speed_on_dodge);
      statsDirty = true;
    }
  } else if (trigger === 'on_pickup_material') {
    // Sync any level-up caused by collecting material XP
    syncPendingLevelUpTriggers(state, catalog, childCtx);
    // Keep Padding / material-scaled builds live when material count crosses thresholds
    if (stats.padding_hp_per_materials > 0) {
      statsDirty = true;
    }
  } else if (trigger === 'on_pickup_consumable') {
    // Spicy Sauce: chance to explode around player scaling with Max HP
    if (stats.spicy_sauce_chance > 0) {
      const chance = normalizeChance(stats.spicy_sauce_chance);
      if (nextRand(state) < chance) {
        const dmg = Math.max(10, Math.round(player.maxHp * 1.0));
        spawnEffectExplosion(state, player.x, player.y - 16, 145, dmg, '#ff5938', childCtx);
        handledGluttonExplosion = true;
      }
    }
    // Extra Max HP per consumable (Chunky / Glutton / Extra Stomach / Weird Food)
    if (stats.hp_per_consumable_max > 0) {
      addPermanentMod(state, 'stat_max_hp', stats.hp_per_consumable_max);
      statsDirty = true;
    }
    // Lich heal bolt when consumable healed player
    if (hasLichHealMechanic(state, effects) && didPlayerHealThisTick(state)) {
      fireLichHealBolt(state, childCtx, 1.0);
      handledLichBolt = true;
    }
  } else if (trigger === 'on_wave_start') {
    // Initialize or reset level tracking cleanly on wave start
    if (!lastProcessedLevelByState.has(state) || player.level < (lastProcessedLevelByState.get(state) ?? 0)) {
      lastProcessedLevelByState.set(state, player.level);
    }

    // Clear wave structures & temporary mods
    state.structures.length = 0;
    player.tempWaveStatMods = {};
    recomputePlayerStats(state, catalog);
    let freshStats = player.computedStats;

    // Bonus starting materials per wave
    if (freshStats.materials_per_wave > 0) {
      const bonus = Math.round(freshStats.materials_per_wave);
      player.materials += bonus;
      state.runStats.materialsCollected += bonus;
    }

    // Recompute once after starting materials so Padding (`padding_hp_per_materials`) updates maxHp before setting wave HP
    if (freshStats.padding_hp_per_materials > 0) {
      recomputePlayerStats(state, catalog);
      freshStats = player.computedStats;
    }

    // Tardigrade hit protection
    player.hitProtectionLeft = Math.max(0, Math.round(freshStats.hit_protection));

    // HP at start of wave (e.g. Sad Tomato 50% HP, Weird Ghost 1 HP, or full HP)
    if (freshStats.hp_start_wave !== 0) {
      const pct = clamp(freshStats.hp_start_wave, 1, 100) / 100;
      player.hp = Math.max(1, Math.round(player.maxHp * pct));
    } else {
      player.hp = player.maxHp;
    }

    // Spawn item structures (turrets, medical turrets, mines, gardens)
    const turretCount = Math.max(0, Math.round(freshStats.turret_count));
    for (let i = 0; i < turretCount; i++) {
      spawnStructure(state, 'turret', 1);
    }
    const medCount = Math.max(0, Math.round(freshStats.healing_turret_count));
    for (let i = 0; i < medCount; i++) {
      spawnStructure(state, 'medical_turret', 1);
    }
    const mineCount = Math.max(0, Math.round(freshStats.mine_count));
    for (let i = 0; i < mineCount; i++) {
      spawnStructure(state, 'mine', 1);
    }
    const gardenCount = Math.max(0, Math.round(freshStats.garden_count));
    for (let i = 0; i < gardenCount; i++) {
      spawnStructure(state, 'garden', 1);
    }

    // Spawn weapon-bound structures (Wrench -> Turrets, Screwdriver -> Mines, Pruner -> Gardens)
    // Skip built-in spawn if the weapon tier already declares an explicit on_wave_start spawn_* effect
    for (let i = 0; i < player.weapons.length; i++) {
      const eq = player.weapons[i];
      const wTier = catalog.weaponsById[eq.weaponId]?.tiers[eq.tier];
      const hasDeclarativeSpawn = Boolean(
        wTier?.extraEffects.some(
          (eff) =>
            eff.trigger === 'on_wave_start' &&
            typeof eff.customKey === 'string' &&
            eff.customKey.startsWith('spawn_'),
        ),
      );
      if (hasDeclarativeSpawn) continue;

      if (eq.weaponId === 'wrench') {
        if (eq.tier === 4) {
          spawnStructure(state, 'explosive_turret', 4);
        } else if (eq.tier === 3) {
          spawnStructure(state, 'laser_turret', 3);
        } else {
          spawnStructure(state, 'turret', eq.tier);
        }
      } else if (eq.weaponId === 'screwdriver') {
        spawnStructure(state, 'mine', eq.tier);
      } else if (eq.weaponId === 'pruner') {
        spawnStructure(state, 'garden', eq.tier);
      }
    }
  } else if (trigger === 'on_wave_end') {
    // Sync any level-ups awarded by harvest / Pacifist XP during progression
    syncPendingLevelUpTriggers(state, catalog, childCtx);

    // Fallback economy payout if progression hook hasn't already paid harvest
    if (!state.harvestPaid) {
      const harvest = Math.max(0, Math.round(stats.stat_harvesting));
      if (harvest > 0) {
        player.materials += harvest;
        state.runStats.materialsCollected += harvest;
        state.events.push({ type: 'harvest_payout', amount: harvest });
      }
      // Crown / Harvesting growth or Endless decay
      const growthPct = state.isEndless
        ? ENDLESS_HARVESTING_DECAY
        : stats.harvesting_growth || BASE_HARVESTING_GROWTH;
      if (harvest > 0 && growthPct !== 0) {
        const delta =
          growthPct > 0
            ? Math.max(1, Math.ceil((harvest * growthPct) / 100))
            : Math.floor((harvest * growthPct) / 100);
        addPermanentMod(state, 'stat_harvesting', delta);
        statsDirty = true;
      }
      // Pacifist payout per surviving enemy
      if (stats.pacifist_material_per_enemy > 0 && state.enemies.length > 0) {
        const bonus = Math.floor(state.enemies.length * stats.pacifist_material_per_enemy);
        if (bonus > 0) {
          player.materials += bonus;
          state.runStats.materialsCollected += bonus;
        }
      }
      // Piggy Bank interest fallback
      if (stats.piggy_bank_pct > 0 && player.materials > 0) {
        const interest = Math.floor((player.materials * stats.piggy_bank_pct) / 100);
        if (interest > 0) {
          player.materials += interest;
          state.runStats.materialsCollected += interest;
        }
      }
      // Demon: convert 50% of remaining materials into permanent Max HP
      if (stats.convert_materials_to_hp > 0 && player.materials > 0) {
        const ratio = Math.max(1, Math.floor(stats.convert_materials_to_hp));
        const convertible = Math.floor(player.materials * 0.5);
        const gainedHp = Math.floor(convertible / ratio);
        if (gainedHp > 0) {
          player.materials -= gainedHp * ratio;
          addPermanentMod(state, 'stat_max_hp', gainedHp);
          statsDirty = true;
        }
      }
    }

    // Arms Dealer: wipe weapons entering shop
    if (stats.shop_resets_weapons > 0 && player.weapons.length > 0) {
      player.weapons.length = 0;
      statsDirty = true;
    }

    // Clear temp wave mods
    player.tempWaveStatMods = {};
    statsDirty = true;
  } else if (trigger === 'on_stand_still') {
    // Streamer passive income per second standing still (stand_still_armor & Soldier buffs are applied in stats.ts)
    if (stats.stand_still_income > 0 && player.standStillTicks > 0 && player.standStillTicks % 60 === 0) {
      const gain = Math.max(1, Math.round(stats.stand_still_income));
      player.materials += gain;
      state.runStats.materialsCollected += gain;
      state.events.push({
        type: 'pickup_material',
        x: player.x,
        y: player.y - 36,
        value: gain,
        isBoosted: false,
      });
      statsDirty = true;
    }
  } else if (trigger === 'on_level_up') {
    lastProcessedLevelByState.set(state, player.level);
  }

  // --- Declarative EffectDef array evaluation ---
  for (let i = 0; i < effects.length; i++) {
    const eff = effects[i];
    if (eff.trigger !== trigger) continue;

    // Chance gate
    if (eff.chance !== undefined && eff.chance < 1) {
      const c = normalizeChance(eff.chance);
      if (nextRand(state) >= c) continue;
    }

    const key = eff.customKey ?? '';
    const val = eff.value ?? 0;

    if (trigger === 'on_hit_taken') {
      if (key === 'explode_on_hit' || key === 'bull_explosion' || key === 'explode' || key === 'rip_and_tear' || key === 'retaliate') {
        if (!handledExplosionOnHit || key === 'rip_and_tear' || key === 'retaliate') {
          const radius = typeof eff.args?.radius === 'number' ? eff.args.radius : 165;
          spawnEffectExplosion(
            state,
            player.x,
            player.y - 16,
            radius,
            Math.max(15, val || 35),
            '#ff7a2b',
            childCtx,
          );
          handledExplosionOnHit = true;
        }
      } else if (key === 'gain_materials' || key === 'blood_donation') {
        if (val > 0 && stats.blood_donation_gold <= 0) {
          player.materials += val;
          state.runStats.materialsCollected += val;
        }
      } else if (key === 'heal') {
        healPlayerDirect(state, Math.max(1, val || 1), effects, childCtx);
      } else if (
        eff.stat &&
        val !== 0 &&
        (key === 'perm_stat' ||
          key === 'permanent_stat' ||
          key === 'masochist' ||
          key === 'masochist_dmg' ||
          eff.args?.permanent === true)
      ) {
        addPermanentMod(state, eff.stat, val);
        if (eff.stat === 'stat_percent_damage') handledMasochistHit = true;
        statsDirty = true;
      } else if (eff.stat && val !== 0) {
        addTempWaveMod(state, eff.stat, val);
        if (eff.stat === 'stat_percent_damage') handledMasochistHit = true;
        statsDirty = true;
      }
    } else if (trigger === 'on_enemy_hit' && ctx.enemy) {
      if (key === 'burn' || key === 'ignite' || key === 'scared_sausage') {
        const dur = typeof eff.args?.duration === 'number' ? eff.args.duration : 3.0;
        applyBurnToEnemy(state, ctx.enemy, Math.max(1, val || 3), dur, 30);
      } else if (key === 'slow' || key === 'ugly_tooth') {
        ctx.enemy.slowTicks = Math.max(ctx.enemy.slowTicks, Math.round((val || 2) * 60));
      } else if (key === 'baby_beard' || key === 'spawn_bullet') {
        if (depth <= 1) {
          fireBabyBeardBullet(state, ctx.enemy.x, ctx.enemy.y, ctx.enemy.uid);
        }
      } else if (key === 'lich_bolt' || key === 'heal_bolt' || key === 'damage_on_heal' || key === 'dmg_when_heal') {
        if (!handledLichBolt) {
          const scale = val > 2 ? val / 100 : val > 0 ? val : 1.0;
          fireLichHealBolt(state, childCtx, scale);
          handledLichBolt = true;
        }
      } else if (key === 'heal' || key === 'lifesteal') {
        healPlayerDirect(state, Math.max(1, val || 1), effects, childCtx);
      } else if ((key === 'thief_dagger' || key === 'gold_on_crit') && ctx.isCrit) {
        const mats = Math.max(1, Math.round(val || 1));
        player.materials += mats;
        state.runStats.materialsCollected += mats;
        state.events.push({ type: 'pickup_material', x: ctx.enemy.x, y: ctx.enemy.y, value: mats, isBoosted: false });
      } else if (key === 'lightning' || key === 'chain_lightning') {
        const target = findNearestAliveEnemy(state, ctx.enemy.x, ctx.enemy.y, ctx.enemy.uid, 260);
        if (target && childCtx.damageEnemy) {
          const zDmg = Math.max(1, Math.round((val || 6) + stats.stat_elemental_damage * 0.8));
          childCtx.damageEnemy(target, zDmg, false, 2, 0, ctx.enemy.x, ctx.enemy.y);
        }
      }
    } else if (trigger === 'on_enemy_kill') {
      const kx = ctx.x ?? ctx.enemy?.x ?? player.x;
      const ky = ctx.y ?? ctx.enemy?.y ?? player.y;
      if (key === 'explode' || key === 'rip_and_tear') {
        const radius = typeof eff.args?.radius === 'number' ? eff.args.radius : 115;
        spawnEffectExplosion(state, kx, ky, radius, Math.max(8, val || 15), '#ff5533', childCtx);
      } else if (key === 'fire_puddle_on_burning_death' && ctx.enemy && ctx.enemy.burnTicksLeft > 0) {
        spawnEffectExplosion(state, kx, ky, 95, Math.max(6, (val || 4) + stats.stat_elemental_damage), '#ff782b', childCtx);
      } else if (key === 'cyberball' || key === 'zap_random') {
        const target = pickRandomAliveEnemy(state, ctx.enemy?.uid ?? -1);
        if (target) {
          const zDmg = Math.max(1, Math.round((val || 5) + Math.max(0, stats.stat_luck) * 0.25));
          if (childCtx.damageEnemy) {
            childCtx.damageEnemy(target, zDmg, false, 4, 0, kx, ky);
          } else {
            target.hp -= zDmg;
            state.runStats.damageDealt += zDmg;
          }
        }
      } else if (key === 'baby_beard' || key === 'spawn_bullet') {
        fireBabyBeardBullet(state, kx, ky, ctx.enemy?.uid ?? -1);
      } else if ((key === 'hunting_trophy' || key === 'gold_on_crit_kill') && ctx.isCrit) {
        const mats = Math.max(1, Math.round(val || 1));
        player.materials += mats;
        state.runStats.materialsCollected += mats;
        state.events.push({ type: 'pickup_material', x: kx, y: ky, value: mats, isBoosted: false });
      } else if (key === 'heal' || key === 'life_on_kill') {
        healPlayerDirect(state, Math.max(1, val || 1), effects, childCtx);
      } else if (key === 'gain_materials') {
        const mats = Math.max(1, Math.round(val || 1));
        player.materials += mats;
        state.runStats.materialsCollected += mats;
      } else if ((key === 'perm_stat' || key === 'ethereal_stat') && eff.stat && val !== 0) {
        addPermanentMod(state, eff.stat, val);
        statsDirty = true;
      } else if (key === 'temp_stat' && eff.stat && val !== 0) {
        addTempWaveMod(state, eff.stat, val);
        statsDirty = true;
      }
    } else if (trigger === 'on_dodge') {
      if (key === 'heal' || key === 'adrenaline') {
        healPlayerDirect(state, Math.max(1, val || 5), effects, childCtx);
      } else if (key === 'riposte' || key === 'explode') {
        const dmg = Math.max(10, Math.round((val || 18) + stats.stat_melee_damage * 1.5));
        spawnEffectExplosion(state, player.x, player.y - 16, 130, dmg, '#66e6ff', childCtx);
      } else if (key === 'gain_materials') {
        const mats = Math.max(1, Math.round(val || 1));
        player.materials += mats;
        state.runStats.materialsCollected += mats;
      } else if (key === 'perm_stat' && eff.stat && val !== 0) {
        addPermanentMod(state, eff.stat, val);
        statsDirty = true;
      } else if (eff.stat && val !== 0) {
        addTempWaveMod(state, eff.stat, val);
        statsDirty = true;
      }
    } else if (trigger === 'on_pickup_material') {
      if (key === 'heal' || key === 'cute_monkey') {
        healPlayerDirect(state, Math.max(1, val || 1), effects, childCtx);
      } else if (key === 'baby_elephant' || key === 'zap_random') {
        const target = pickRandomAliveEnemy(state, -1);
        if (target) {
          const zDmg = Math.max(1, Math.round((val || 4) + Math.max(0, stats.stat_luck) * 0.25));
          if (childCtx.damageEnemy) {
            childCtx.damageEnemy(target, zDmg, false, 4, 0, player.x, player.y);
          } else {
            target.hp -= zDmg;
            state.runStats.damageDealt += zDmg;
          }
        }
      } else if (key === 'perm_stat' && eff.stat && val !== 0) {
        addPermanentMod(state, eff.stat, val);
        statsDirty = true;
      } else if (key === 'temp_stat' && eff.stat && val !== 0) {
        addTempWaveMod(state, eff.stat, val);
        statsDirty = true;
      }
    } else if (trigger === 'on_pickup_consumable') {
      if (key === 'explode' || key === 'spicy_sauce' || key === 'glutton_explosion') {
        const radius = typeof eff.args?.radius === 'number' ? eff.args.radius : 145;
        const dmg = Math.max(10, Math.round((val || 1) * player.maxHp));
        spawnEffectExplosion(state, player.x, player.y - 16, radius, dmg, '#ff6333', childCtx);
        handledGluttonExplosion = true;
      } else if (key === 'heal') {
        healPlayerDirect(state, Math.max(1, val || 1), effects, childCtx);
      } else if (key === 'gain_materials') {
        const mats = Math.max(1, Math.round(val || 1));
        player.materials += mats;
        state.runStats.materialsCollected += mats;
      } else if (key === 'temp_stat' && eff.stat && val !== 0) {
        addTempWaveMod(state, eff.stat, val);
        statsDirty = true;
      } else if (eff.stat && val !== 0) {
        addPermanentMod(state, eff.stat, val);
        statsDirty = true;
      }
    } else if (trigger === 'on_wave_start') {
      if (key === 'spawn_turret') {
        const count = Math.max(1, Math.round(val || 1));
        for (let k = 0; k < count; k++) spawnStructure(state, 'turret', 1);
      } else if (key === 'spawn_medical_turret') {
        const count = Math.max(1, Math.round(val || 1));
        for (let k = 0; k < count; k++) spawnStructure(state, 'medical_turret', 1);
      } else if (key === 'spawn_mine') {
        const count = Math.max(1, Math.round(val || 1));
        for (let k = 0; k < count; k++) spawnStructure(state, 'mine', 1);
      } else if (key === 'spawn_garden') {
        const count = Math.max(1, Math.round(val || 1));
        for (let k = 0; k < count; k++) spawnStructure(state, 'garden', 1);
      } else if (key === 'spawn_laser_turret') {
        const count = Math.max(1, Math.round(val || 1));
        for (let k = 0; k < count; k++) spawnStructure(state, 'laser_turret', 3);
      } else if (key === 'spawn_explosive_turret') {
        const count = Math.max(1, Math.round(val || 1));
        for (let k = 0; k < count; k++) spawnStructure(state, 'explosive_turret', 4);
      } else if (key === 'piggy_bank' && val > 0 && player.materials > 0 && stats.piggy_bank_pct <= 0) {
        const interest = Math.floor((player.materials * val) / 100);
        if (interest > 0) {
          player.materials += interest;
          state.runStats.materialsCollected += interest;
          statsDirty = true;
        }
      } else if (key === 'padding' && val > 0 && player.materials > 0 && stats.padding_hp_per_materials <= 0) {
        const stacks = Math.floor(player.materials / Math.max(1, val));
        if (stacks > 0) {
          addTempWaveMod(state, 'stat_max_hp', stacks);
          statsDirty = true;
        }
      } else if (key === 'wipe_materials') {
        player.materials = 0;
        statsDirty = true;
      } else if (key === 'arms_dealer_wipe' && state.wave > 1) {
        player.weapons.length = 0;
        statsDirty = true;
      } else if (key === 'gain_materials' && val > 0) {
        player.materials += Math.round(val);
        state.runStats.materialsCollected += Math.round(val);
      } else if (eff.stat && val !== 0 && key === 'perm_stat') {
        addPermanentMod(state, eff.stat, val);
        statsDirty = true;
      } else if (eff.stat && val !== 0 && (key === 'temp_stat' || key === '')) {
        addTempWaveMod(state, eff.stat, val);
        statsDirty = true;
      }
    } else if (trigger === 'on_wave_end') {
      if (key === 'arms_dealer_wipe') {
        player.weapons.length = 0;
        statsDirty = true;
      } else if (key === 'pacifist_payout' && !state.harvestPaid && val > 0) {
        const bonus = Math.floor(state.enemies.length * val);
        if (bonus > 0) {
          player.materials += bonus;
          state.runStats.materialsCollected += bonus;
        }
      } else if (key === 'crown' && !state.harvestPaid && val > 0) {
        const harvest = Math.max(0, Math.round(stats.stat_harvesting));
        if (harvest > 0) {
          addPermanentMod(state, 'stat_harvesting', Math.max(1, Math.ceil((harvest * val) / 100)));
          statsDirty = true;
        }
      } else if (key === 'demon_hp_convert' && !state.harvestPaid && player.materials > 0) {
        const ratio = Math.max(1, Math.floor(val || 13));
        const gainedHp = Math.floor(Math.floor(player.materials * 0.5) / ratio);
        if (gainedHp > 0) {
          player.materials -= gainedHp * ratio;
          addPermanentMod(state, 'stat_max_hp', gainedHp);
          statsDirty = true;
        }
      } else if (key === 'gain_materials' && val > 0) {
        player.materials += Math.round(val);
        state.runStats.materialsCollected += Math.round(val);
      } else if (eff.stat && val !== 0) {
        addPermanentMod(state, eff.stat, val);
        statsDirty = true;
      }
    } else if (trigger === 'on_stand_still') {
      if (player.standStillTicks > 0 && player.standStillTicks % 60 === 0) {
        if ((key === 'income' || key === 'streamer_income' || key === 'stand_still_income') && val > 0 && stats.stand_still_income <= 0) {
          const gain = Math.max(1, Math.round(val));
          player.materials += gain;
          state.runStats.materialsCollected += gain;
          state.events.push({
            type: 'pickup_material',
            x: player.x,
            y: player.y - 36,
            value: gain,
            isBoosted: false,
          });
          statsDirty = true;
        } else if (key === 'streamer_pct_income' && val > 0) {
          const cap = typeof eff.args?.cap === 'number' ? eff.args.cap : 25;
          const gain = clamp(Math.floor((player.materials * val) / 100), 1, cap);
          player.materials += gain;
          state.runStats.materialsCollected += gain;
          state.events.push({
            type: 'pickup_material',
            x: player.x,
            y: player.y - 36,
            value: gain,
            isBoosted: false,
          });
          statsDirty = true;
        } else if (key === 'heal' && val > 0) {
          healPlayerDirect(state, Math.max(1, Math.round(val)), effects, childCtx);
        }
      }
    } else if (trigger === 'on_level_up') {
      if (key === 'baby_weapon_slot' || key === 'weapon_slot_upgrade' || key === 'extra_weapon_slot' || eff.stat === 'weapon_slot') {
        const maxSlots = typeof eff.args?.max === 'number' ? eff.args.max : 24;
        if (stats.weapon_slot < maxSlots) {
          const add = Math.min(Math.max(1, Math.round(val || 1)), maxSlots - stats.weapon_slot);
          addPermanentMod(state, 'weapon_slot', add);
          statsDirty = true;
        }
        handledBabySlotLevelUp = true;
      } else if (key === 'heal' && val > 0) {
        healPlayerDirect(state, Math.max(1, Math.round(val)), effects, childCtx);
      } else if (key === 'gain_materials' && val > 0) {
        player.materials += Math.round(val);
        state.runStats.materialsCollected += Math.round(val);
      } else if (eff.stat && val !== 0) {
        addPermanentMod(state, eff.stat, val);
        handledApprenticeLevelUp = true;
        statsDirty = true;
      }
    } else if (trigger === 'on_shop_buy' || trigger === 'on_shop_reroll') {
      if (key === 'gain_materials' && val > 0) {
        player.materials += Math.round(val);
        state.runStats.materialsCollected += Math.round(val);
      } else if (eff.stat && val !== 0) {
        addPermanentMod(state, eff.stat, val);
        statsDirty = true;
      }
    }
  }

  // --- Character fallback guarantees (never double-fires when declarative EffectDefs handled it) ---
  if (trigger === 'on_hit_taken' && player.characterId === 'masochist' && !handledMasochistHit) {
    addTempWaveMod(state, 'stat_percent_damage', 5);
    statsDirty = true;
  }
  if (trigger === 'on_pickup_consumable' && player.characterId === 'glutton' && !handledGluttonExplosion) {
    const dmg = Math.max(12, Math.round(player.maxHp * 1.0));
    spawnEffectExplosion(state, player.x, player.y - 16, 155, dmg, '#ff6333', childCtx);
    addPermanentMod(state, 'explosion_damage', 1);
    statsDirty = true;
  }
  if (trigger === 'on_level_up') {
    if (player.characterId === 'apprentice' && !handledApprenticeLevelUp) {
      addPermanentMod(state, 'stat_melee_damage', 2);
      addPermanentMod(state, 'stat_ranged_damage', 1);
      addPermanentMod(state, 'stat_elemental_damage', 1);
      addPermanentMod(state, 'stat_engineering', 1);
      addPermanentMod(state, 'stat_max_hp', -2);
      statsDirty = true;
    } else if (player.characterId === 'baby' && !handledBabySlotLevelUp && stats.weapon_slot < 24) {
      addPermanentMod(state, 'weapon_slot', 1);
      statsDirty = true;
    }
  }

  if (statsDirty) {
    recomputePlayerStats(state, catalog);
  }
}

/**
 * Helper used to clamp a coordinate safely inside the arena playable rectangle.
 */
export function clampToArena(
  x: number,
  y: number,
  pad = 0,
): { x: number; y: number } {
  return {
    x: clamp(x, PLAYABLE_MIN_X + pad, PLAYABLE_MAX_X - pad),
    y: clamp(y, PLAYABLE_MIN_Y + pad, PLAYABLE_MAX_Y - pad),
  };
}
