// ============================================================================
// src/sim/effects.ts — Declarative EffectGraph Evaluator
// ============================================================================

import {
  ARENA_H,
  ARENA_W,
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
  // Snapshot length because killing enemies may mutate state.enemies or spawn children
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
    baseCd = 420; // drops fruit every ~7s
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

function healPlayerDirect(state: SimState, amount: number): void {
  if (amount <= 0) return;
  const p = state.player;
  const before = p.hp;
  p.hp = Math.min(p.maxHp, p.hp + amount);
  const healed = p.hp - before;
  if (healed > 0) {
    state.events.push({ type: 'player_heal', x: p.x, y: p.y - 24, amount: healed });
  }
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

  // --- Built-in extended stat handlers by trigger ---
  if (trigger === 'on_hit_taken') {
    // Bull / Explosive on hit
    if (stats.explode_on_hit > 0) {
      const dmg = Math.max(
        10,
        Math.round(
          (30 + stats.stat_melee_damage * 2 + stats.stat_ranged_damage * 2 + stats.stat_elemental_damage * 2) *
            stats.explode_on_hit,
        ),
      );
      spawnEffectExplosion(state, player.x, player.y - 16, 170, dmg, '#ff7a2b', childCtx);
    }
    // Blood Donation: gain materials on hit taken (also handled via hp_drain_per_sec)
    if (stats.blood_donation_gold > 0) {
      player.materials += Math.round(stats.blood_donation_gold);
      state.runStats.materialsCollected += Math.round(stats.blood_donation_gold);
    }
  } else if (trigger === 'on_enemy_hit' && ctx.enemy) {
    // Scared Sausage: chance to ignite enemy on hit
    if (stats.burn_chance > 0) {
      const chance = clamp(stats.burn_chance > 1 ? stats.burn_chance / 100 : stats.burn_chance, 0, 1);
      if (nextRand(state) < chance) {
        applyBurnToEnemy(state, ctx.enemy, 3, 3.0, 30);
      }
    }
    // Baby with a Beard: spawn an extra bullet from enemy towards nearest other enemy
    if (stats.baby_beard_chance > 0 && depth === 0) {
      const chance = clamp(
        stats.baby_beard_chance > 1 ? stats.baby_beard_chance / 100 : stats.baby_beard_chance,
        0,
        1,
      );
      if (nextRand(state) < chance) {
        const target = findNearestAliveEnemy(state, ctx.enemy.x, ctx.enemy.y, ctx.enemy.uid, 550);
        const angle = target
          ? Math.atan2(target.y - ctx.enemy.y, target.x - ctx.enemy.x)
          : nextRand(state) * Math.PI * 2;
        const speed = 780;
        const dmg = Math.max(
          1,
          Math.round((1 + stats.stat_ranged_damage) * (1 + stats.stat_percent_damage / 100)),
        );
        state.projectiles.push({
          uid: allocUid(state),
          owner: 'player',
          x: ctx.enemy.x,
          y: ctx.enemy.y,
          prevX: ctx.enemy.x,
          prevY: ctx.enemy.y,
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
          hitEnemyUids: [ctx.enemy.uid],
          sourceWeaponUid: 0,
        });
      }
    }
  } else if (trigger === 'on_enemy_kill') {
    const kx = ctx.x ?? ctx.enemy?.x ?? player.x;
    const ky = ctx.y ?? ctx.enemy?.y ?? player.y;

    // Cyberball: chance to zap a random living enemy for Luck-scaled damage
    if (stats.cyberball_chance > 0 && state.enemies.length > 0) {
      const chance = clamp(
        stats.cyberball_chance > 1 ? stats.cyberball_chance / 100 : stats.cyberball_chance,
        0,
        1,
      );
      if (nextRand(state) < chance) {
        const alive = state.enemies.filter((e) => e.hp > 0 && e.uid !== ctx.enemy?.uid);
        if (alive.length > 0) {
          const target = alive[Math.floor(nextRand(state) * alive.length)];
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

    // Rip and Tear: chance for slain enemy to explode
    if (stats.rip_and_tear_chance > 0 || stats.explode_on_death > 0) {
      const rawChance = Math.max(stats.rip_and_tear_chance, stats.explode_on_death > 0 ? 1 : 0);
      const chance = clamp(rawChance > 1 ? rawChance / 100 : rawChance, 0, 1);
      if (nextRand(state) < chance) {
        const dmg = Math.max(8, Math.round(12 + stats.stat_melee_damage * 0.8));
        spawnEffectExplosion(state, kx, ky, 115, dmg, '#ff4d3b', childCtx);
      }
    }

    // Hunting Trophy: gain materials on critical kill
    if (ctx.isCrit && stats.gold_on_crit_kill > 0) {
      const chance = clamp(stats.gold_on_crit_kill > 1 ? stats.gold_on_crit_kill / 100 : stats.gold_on_crit_kill, 0, 1);
      if (nextRand(state) < chance) {
        player.materials += 1;
        state.runStats.materialsCollected += 1;
        state.events.push({ type: 'pickup_material', x: kx, y: ky, value: 1, isBoosted: false });
      }
    }

    // Life on kill chance (e.g. Ghost / Siphon)
    if (stats.life_on_kill_chance > 0) {
      const chance = clamp(
        stats.life_on_kill_chance > 1 ? stats.life_on_kill_chance / 100 : stats.life_on_kill_chance,
        0,
        1,
      );
      if (nextRand(state) < chance) {
        healPlayerDirect(state, 1);
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
      const chance = clamp(
        stats.heal_on_dodge_chance > 1 ? stats.heal_on_dodge_chance / 100 : stats.heal_on_dodge_chance,
        0,
        1,
      );
      if (nextRand(state) < chance) {
        healPlayerDirect(state, 5);
      }
    }
    // Speed on dodge: temporary wave speed boost
    if (stats.speed_on_dodge > 0) {
      addTempWaveMod(state, 'stat_speed', stats.speed_on_dodge);
      statsDirty = true;
    }
  } else if (trigger === 'on_pickup_consumable') {
    // Spicy Sauce: chance to explode around player scaling with Max HP
    if (stats.spicy_sauce_chance > 0) {
      const chance = clamp(
        stats.spicy_sauce_chance > 1 ? stats.spicy_sauce_chance / 100 : stats.spicy_sauce_chance,
        0,
        1,
      );
      if (nextRand(state) < chance) {
        const dmg = Math.max(10, Math.round(player.maxHp * 1.0));
        spawnEffectExplosion(state, player.x, player.y - 16, 140, dmg, '#ff5938', childCtx);
      }
    }
    // Extra Max HP per consumable (e.g. Chunky / Gluttons / Weird Food bonuses)
    if (stats.hp_per_consumable_max > 0) {
      addPermanentMod(state, 'stat_max_hp', stats.hp_per_consumable_max);
      statsDirty = true;
    }
  } else if (trigger === 'on_wave_start') {
    // Clear wave structures & temporary mods
    state.structures.length = 0;
    player.tempWaveStatMods = {};
    recomputePlayerStats(state, catalog);
    const freshStats = player.computedStats;

    // Tardigrade hit protection
    player.hitProtectionLeft = Math.max(0, Math.round(freshStats.hit_protection));

    // HP at start of wave (e.g. start at 50% HP or full HP)
    if (freshStats.hp_start_wave !== 0) {
      const pct = clamp(freshStats.hp_start_wave, 1, 100) / 100;
      player.hp = Math.max(1, Math.round(player.maxHp * pct));
    } else {
      player.hp = player.maxHp;
    }

    // Bonus starting materials per wave
    if (freshStats.materials_per_wave > 0) {
      player.materials += Math.round(freshStats.materials_per_wave);
      state.runStats.materialsCollected += Math.round(freshStats.materials_per_wave);
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

    // Spawn Wrench / Screwdriver weapon turrets
    for (let i = 0; i < player.weapons.length; i++) {
      const eq = player.weapons[i];
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
      }
    }
  } else if (trigger === 'on_wave_end') {
    // Only run fallback economy logic if progression hook hasn't already paid harvest
    if (!state.harvestPaid) {
      const harvest = Math.max(0, Math.round(stats.stat_harvesting));
      if (harvest > 0) {
        player.materials += harvest;
        state.runStats.materialsCollected += harvest;
        state.events.push({ type: 'harvest_payout', amount: harvest });
      }
      // Harvesting growth/decay
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
      // Pacifist material per surviving enemy
      if (stats.pacifist_material_per_enemy > 0) {
        const bonus = Math.round(state.enemies.length * stats.pacifist_material_per_enemy);
        if (bonus > 0) {
          player.materials += bonus;
          state.runStats.materialsCollected += bonus;
        }
      }
      // Piggy bank interest fallback
      if (stats.piggy_bank_pct > 0 && player.materials > 0) {
        const interest = Math.floor((player.materials * stats.piggy_bank_pct) / 100);
        if (interest > 0) {
          player.materials += interest;
          state.runStats.materialsCollected += interest;
        }
      }
      // Demon: convert excess materials to Max HP if flagged
      if (stats.convert_materials_to_hp > 0 && player.materials > 0) {
        const gainedHp = Math.floor(player.materials / Math.max(1, stats.convert_materials_to_hp));
        if (gainedHp > 0) {
          addPermanentMod(state, 'stat_max_hp', gainedHp);
          player.materials = 0;
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
    // Streamer passive income per second standing still
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
    }
  }

  // --- Declarative EffectDef array evaluation ---
  for (let i = 0; i < effects.length; i++) {
    const eff = effects[i];
    if (eff.trigger !== trigger) continue;

    // Chance gate
    if (eff.chance !== undefined && eff.chance < 1) {
      const c = eff.chance > 1 ? eff.chance / 100 : eff.chance;
      if (nextRand(state) >= clamp(c, 0, 1)) continue;
    }

    const key = eff.customKey ?? '';
    const val = eff.value ?? 0;

    if (trigger === 'on_hit_taken') {
      if (key === 'explode_on_hit' || key === 'bull_explosion') {
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
      } else if (key === 'gain_materials' || key === 'blood_donation') {
        if (val > 0) {
          player.materials += val;
          state.runStats.materialsCollected += val;
        }
      } else if (eff.stat && val !== 0) {
        addTempWaveMod(state, eff.stat, val);
        statsDirty = true;
      }
    } else if (trigger === 'on_enemy_hit' && ctx.enemy) {
      if (key === 'burn' || key === 'ignite') {
        const dur = typeof eff.args?.duration === 'number' ? eff.args.duration : 3.0;
        applyBurnToEnemy(state, ctx.enemy, Math.max(1, val || 3), dur, 30);
      } else if (key === 'slow') {
        ctx.enemy.slowTicks = Math.max(ctx.enemy.slowTicks, Math.round((val || 2) * 60));
      }
    } else if (trigger === 'on_enemy_kill') {
      const kx = ctx.x ?? ctx.enemy?.x ?? player.x;
      const ky = ctx.y ?? ctx.enemy?.y ?? player.y;
      if (key === 'explode') {
        const radius = typeof eff.args?.radius === 'number' ? eff.args.radius : 110;
        spawnEffectExplosion(state, kx, ky, radius, Math.max(8, val || 15), '#ff5533', childCtx);
      } else if (key === 'heal') {
        healPlayerDirect(state, Math.max(1, val || 1));
      } else if (key === 'gain_materials') {
        player.materials += Math.max(1, val || 1);
        state.runStats.materialsCollected += Math.max(1, val || 1);
      } else if (key === 'perm_stat' && eff.stat && val !== 0) {
        addPermanentMod(state, eff.stat, val);
        statsDirty = true;
      }
    } else if (trigger === 'on_dodge') {
      if (key === 'heal') {
        healPlayerDirect(state, Math.max(1, val || 5));
      } else if (eff.stat && val !== 0) {
        addTempWaveMod(state, eff.stat, val);
        statsDirty = true;
      }
    } else if (trigger === 'on_pickup_consumable') {
      if (key === 'explode') {
        const radius = typeof eff.args?.radius === 'number' ? eff.args.radius : 140;
        const dmg = Math.max(10, Math.round((val || 1) * player.maxHp));
        spawnEffectExplosion(state, player.x, player.y - 16, radius, dmg, '#ff6333', childCtx);
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
      } else if (key === 'piggy_bank' && val > 0 && player.materials > 0) {
        const interest = Math.floor((player.materials * val) / 100);
        if (interest > 0) {
          player.materials += interest;
          state.runStats.materialsCollected += interest;
        }
      } else if (key === 'arms_dealer_wipe') {
        player.weapons.length = 0;
        statsDirty = true;
      } else if (eff.stat && val !== 0 && key === 'temp_stat') {
        addTempWaveMod(state, eff.stat, val);
        statsDirty = true;
      }
    } else if (trigger === 'on_wave_end') {
      if (key === 'arms_dealer_wipe') {
        player.weapons.length = 0;
        statsDirty = true;
      } else if (eff.stat && val !== 0 && key === 'perm_stat') {
        addPermanentMod(state, eff.stat, val);
        statsDirty = true;
      }
    } else if (trigger === 'on_stand_still') {
      if (key === 'income' && val > 0 && player.standStillTicks > 0 && player.standStillTicks % 60 === 0) {
        player.materials += val;
        state.runStats.materialsCollected += val;
      }
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
  const minX = PLAYABLE_MIN_X + pad;
  const maxX = Math.max(minX, Math.min(ARENA_W - PLAYABLE_MIN_X, PLAYABLE_MAX_X) - pad);
  const minY = PLAYABLE_MIN_Y + pad;
  const maxY = Math.max(minY, Math.min(ARENA_H - PLAYABLE_MIN_Y, PLAYABLE_MAX_Y) - pad);
  return {
    x: clamp(x, minX, maxX),
    y: clamp(y, minY, maxY),
  };
}
