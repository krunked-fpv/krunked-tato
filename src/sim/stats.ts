// ============================================================================
// src/sim/stats.ts — Exact StatMap computation & SPEC.md combat/survival math
// ============================================================================

import {
  BASE_HARVESTING_GROWTH,
  CORE_STAT_KEYS,
  MIN_WEAPON_COOLDOWN,
  MIN_WEAPON_RANGE,
  PLAYER_BASE_MAX_HP,
  PLAYER_BASE_SPEED,
  PLAYER_DEFAULT_CRIT_CAP,
  PLAYER_DEFAULT_DODGE_CAP,
  PLAYER_DEFAULT_SPEED_CAP,
  PLAYER_DEFAULT_WEAPON_SLOTS,
  SIM_HZ,
  type CoreStatKey,
  type EffectDef,
  type GameDataCatalog,
  type SimState,
  type StatKey,
  type StatMap,
  type WeaponSetId,
} from '../contracts/index';

export function clamp(val: number, min: number, max: number): number {
  if (val < min) return min;
  if (val > max) return max;
  return val;
}

const CORE_STAT_SET: ReadonlySet<string> = new Set<CoreStatKey>(CORE_STAT_KEYS);

/**
 * Returns a complete `StatMap` with every `CoreStatKey` and `ExtendedStatKey`
 * initialized to its baseline SPEC.md default.
 */
export function createDefaultStatMap(): StatMap {
  return {
    // 16 Core stats
    stat_max_hp: PLAYER_BASE_MAX_HP,
    stat_hp_regen: 0,
    stat_lifesteal: 0,
    stat_percent_damage: 0,
    stat_melee_damage: 0,
    stat_ranged_damage: 0,
    stat_elemental_damage: 0,
    stat_attack_speed: 0,
    stat_crit_chance: 0,
    stat_engineering: 0,
    stat_range: 0,
    stat_armor: 0,
    stat_dodge: 0,
    stat_speed: 0,
    stat_luck: 0,
    stat_harvesting: 0,

    // Extended stats
    consumable_heal: 0,
    xp_gain: 0,
    pickup_range: 0,
    items_price: 0,
    weapons_price: 0,
    reroll_price: 0,
    recycling_gains: 0,
    explosion_damage: 0,
    explosion_size: 0,
    bounce: 0,
    piercing: 0,
    piercing_damage: 0,
    knockback: 0,
    hp_start_wave: 0,
    trees: 0,
    enemies: 0,
    enemy_speed: 0,
    enemy_damage: 0,
    enemy_health: 0,
    materials_per_wave: 0,
    free_rerolls: 0,
    weapon_slot: PLAYER_DEFAULT_WEAPON_SLOTS,
    dodge_cap: PLAYER_DEFAULT_DODGE_CAP,
    speed_cap: PLAYER_DEFAULT_SPEED_CAP,
    crit_cap: PLAYER_DEFAULT_CRIT_CAP,
    bonus_crit_damage: 0,
    hit_protection: 0,
    burn_chance: 0,
    burn_damage: 0,
    burn_duration: 0,
    burn_spread: 0,
    structure_attack_speed: 0,
    structure_range: 0,
    turret_count: 0,
    mine_count: 0,
    garden_count: 0,
    healing_turret_count: 0,
    hp_per_consumable_max: 0,
    double_material_chance: 0,
    crate_chance: 0,
    item_box_gold: 0,
    harvesting_growth: BASE_HARVESTING_GROWTH,
    inflation_modifier: 0,
    damage_against_bosses: 0,
    no_melee_weapons: 0,
    no_ranged_weapons: 0,
    no_weapons: 0,
    hp_shop: 0,
    shop_resets_weapons: 0,
    min_weapon_tier: 1,
    max_weapon_tier: 4,
    stand_still_armor: 0,
    stand_still_dodge: 0,
    stand_still_damage: 0,
    stand_still_attack_speed: 0,
    stand_still_income: 0,
    moving_armor: 0,
    moving_dodge: 0,
    moving_speed_bonus: 0,
    explode_on_hit: 0,
    explode_on_death: 0,
    pacifist_material_per_enemy: 0,
    hp_drain_per_sec: 0,
    extra_enemies_next_wave: 0,
    instant_gold_attracting: 0,
    ban_hp_regen: 0,
    ban_lifesteal: 0,
    ban_consumable_heal: 0,
    life_on_kill_chance: 0,
    gold_on_crit_kill: 0,
    dmg_per_missing_hp: 0,
    piggy_bank_pct: 0,
    padding_hp_per_materials: 0,
    alien_eyes_interval: 0,
    cyberball_chance: 0,
    baby_beard_chance: 0,
    spicy_sauce_chance: 0,
    rip_and_tear_chance: 0,
    blood_donation_gold: 0,
    heal_on_dodge_chance: 0,
    speed_on_dodge: 0,
    atk_spd_per_dodge: 0,
    melee_dmg_per_armor: 0,
    melee_dmg_per_speed: 0,
    ranged_dmg_per_range: 0,
    armor_per_missing_slot: 0,
    damage_per_weapon_diff: 0,
    damage_per_weapon_same: 0,
    mod_all_positive_stats: 0,
    mod_all_negative_stats: 0,
    dmg_with_trees_alive: 0,
    double_structure_effects: 0,
    single_weapon_only: 0,
    no_dodge: 0,
    convert_materials_to_hp: 0,
    xp_per_material: 0,
    boss_spawn_extra: 0,
  };
}

/**
 * SPEC.md: `450 * (1 + clamp(stat_speed, -80, speed_cap) / 100)` px/s.
 */
export function computeMoveSpeed(stats: StatMap): number {
  const cap = stats.speed_cap > 0 ? stats.speed_cap : PLAYER_DEFAULT_SPEED_CAP;
  const clamped = clamp(stats.stat_speed, -80, cap);
  return PLAYER_BASE_SPEED * (1 + clamped / 100);
}

/**
 * SPEC.md: `xpNeeded(level) = (level + 3)^2` (L0->9, L1->16, L2->25, ...).
 */
export function xpNeededForLevel(level: number): number {
  const n = Math.max(0, Math.floor(level)) + 3;
  return n * n;
}

/**
 * SPEC.md Armor mitigation multiplier:
 * - armor >= 0: `10 / (10 + armor / 1.5)`
 * - armor <  0: `2 - 10 / (10 + abs(armor) / 1.5)`
 */
export function computeArmorMultiplier(armor: number): number {
  if (armor >= 0) {
    return 10 / (10 + armor / 1.5);
  }
  return 2 - 10 / (10 + Math.abs(armor) / 1.5);
}

/**
 * SPEC.md HP regeneration interval in 60 Hz ticks:
 * For hp_regen > 0: `round((5.0 / (1.0 + abs(hp_regen - 1) / 2.25)) * 60)` (>= 1).
 * Returns 0 when hpRegen <= 0.
 */
export function computeRegenIntervalTicks(hpRegen: number): number {
  if (hpRegen <= 0) return 0;
  const sec = 5.0 / (1.0 + Math.abs(hpRegen - 1) / 2.25);
  return Math.max(1, Math.round(sec * SIM_HZ));
}

/**
 * SPEC.md Effective weapon range:
 * - Melee:  `max(25, baseRange + statRange / 2)`
 * - Ranged: `max(25, baseRange + statRange)`
 */
export function computeEffectiveRange(
  baseRange: number,
  isMelee: boolean,
  statRange: number,
): number {
  return Math.max(MIN_WEAPON_RANGE, baseRange + (isMelee ? statRange / 2 : statRange));
}

/**
 * SPEC.md Effective attack cooldown in 60 Hz ticks (floored at MIN_WEAPON_COOLDOWN = 2):
 * - atkSpd = (statAtkSpd + weaponMod) / 100
 * - atkSpd >= 0: baseCd / (1 + atkSpd)
 * - atkSpd <  0: baseCd * (1 + abs(atkSpd))
 */
export function computeEffectiveCooldown(
  baseCd: number,
  statAtkSpd: number,
  weaponMod = 0,
): number {
  const atkSpd = (statAtkSpd + weaponMod) / 100;
  const raw = atkSpd >= 0 ? baseCd / (1 + atkSpd) : baseCd * (1 + Math.abs(atkSpd));
  return Math.max(MIN_WEAPON_COOLDOWN, Math.round(raw));
}

/**
 * SPEC.md Endless scaling factor:
 * `wave <= 20 ? 0 : (((wave - 20) * (wave - 19)) / 2) / 100 * mult`
 */
export function computeEndlessFactor(wave: number, mult = 1): number {
  if (wave <= 20) return 0;
  const w = wave - 20;
  return (((w * (w + 1)) / 2) / 100) * mult;
}

/**
 * Helper to apply a single static stat delta onto `stats`, handling special
 * cap/tier fields cleanly whether authored as deltas or overrides.
 */
function applyStatDelta(
  stats: StatMap,
  stat: StatKey,
  value: number,
  isOverrideTrigger: boolean,
): void {
  if (stat === 'dodge_cap') {
    if (isOverrideTrigger || value >= 60) {
      stats.dodge_cap = clamp(value, 0, 95);
    } else {
      stats.dodge_cap = clamp(stats.dodge_cap + value, 0, 95);
    }
    return;
  }

  if (stat === 'speed_cap') {
    if (isOverrideTrigger || value >= 100) {
      stats.speed_cap = Math.max(10, value);
    } else {
      stats.speed_cap = Math.max(10, stats.speed_cap + value);
    }
    return;
  }

  if (stat === 'crit_cap') {
    const normalized = value > 1.5 ? value / 100 : value;
    if (isOverrideTrigger) {
      stats.crit_cap = clamp(normalized, 0, 10);
    } else {
      stats.crit_cap = clamp(stats.crit_cap + normalized, 0, 10);
    }
    return;
  }

  if (stat === 'min_weapon_tier') {
    if (value >= 1 && value <= 4) {
      stats.min_weapon_tier = Math.max(stats.min_weapon_tier, Math.round(value));
    } else {
      stats.min_weapon_tier = clamp(Math.round(stats.min_weapon_tier + value), 1, 4);
    }
    return;
  }

  if (stat === 'max_weapon_tier') {
    if (value >= 1 && value <= 4) {
      stats.max_weapon_tier = Math.min(stats.max_weapon_tier, Math.round(value));
    } else if (value < 0) {
      stats.max_weapon_tier = clamp(Math.round(stats.max_weapon_tier + value), 1, 4);
    }
    return;
  }

  stats[stat] += value;
}

/**
 * Computes scaled gain modifier for a stat delta coming from items/upgrades/mods.
 */
function scaleModValue(
  stat: StatKey,
  value: number,
  perStatGainPct: Partial<Record<StatKey, number>>,
  posAllPct: number,
  negAllPct: number,
): number {
  if (!CORE_STAT_SET.has(stat)) return value;
  const specific = perStatGainPct[stat] ?? 0;
  let pct = specific;
  if (value > 0) {
    pct += posAllPct;
  } else if (value < 0) {
    pct += negAllPct;
  }
  if (pct === 0) return value;
  const mult = Math.max(0, 1 + pct / 100);
  return value > 0 ? Math.round(value * mult) : Math.round(value * mult);
}

/**
 * Recomputes `state.player.computedStats`, `state.player.activeSetCounts`,
 * and syncs `player.maxHp` / clamped `player.hp`.
 */
export function recomputePlayerStats(state: SimState, catalog: GameDataCatalog): void {
  const player = state.player;
  const stats = createDefaultStatMap();

  // Base Max HP = 10 + player.level
  stats.stat_max_hp = PLAYER_BASE_MAX_HP + player.level;

  const charDef = catalog.charactersById[player.characterId];
  if (charDef) {
    stats.weapon_slot = charDef.weaponSlots;
  }

  // Count active weapon sets across equipped weapons
  const activeSetCounts: Partial<Record<WeaponSetId, number>> = {};
  const weaponIdCounts: Record<string, number> = {};
  for (let i = 0; i < player.weapons.length; i++) {
    const eq = player.weapons[i];
    weaponIdCounts[eq.weaponId] = (weaponIdCounts[eq.weaponId] ?? 0) + 1;
    const wDef = catalog.weaponsById[eq.weaponId];
    if (!wDef) continue;
    for (let s = 0; s < wDef.sets.length; s++) {
      const setId = wDef.sets[s];
      activeSetCounts[setId] = (activeSetCounts[setId] ?? 0) + 1;
    }
  }
  player.activeSetCounts = activeSetCounts;

  // Gather effects partitioned by source (character vs external) so stat_mod_gain
  // modifies item/upgrade/set gains accurately without self-multiplying character base.
  const charEffects: EffectDef[] = charDef ? [...charDef.effects] : [];
  const externalEffects: EffectDef[] = [];

  // Item effects
  for (let i = 0; i < player.items.length; i++) {
    const itemDef = catalog.itemsById[player.items[i]];
    if (!itemDef) continue;
    for (let e = 0; e < itemDef.effects.length; e++) {
      externalEffects.push(itemDef.effects[e]);
    }
  }

  // Weapon set bonuses (apply highest bonus tier key <= count, capped at 6)
  for (const setKey in activeSetCounts) {
    const setId = setKey as WeaponSetId;
    const count = activeSetCounts[setId] ?? 0;
    if (count < 2) continue;
    const setDef = catalog.setsById[setId];
    if (!setDef) continue;
    let bestTier = 0;
    const clampedCount = Math.min(6, count);
    for (let t = clampedCount; t >= 2; t--) {
      if (setDef.bonuses[t] && setDef.bonuses[t].length > 0) {
        bestTier = t;
        break;
      }
    }
    if (bestTier >= 2) {
      const bonusEffects = setDef.bonuses[bestTier];
      for (let b = 0; b < bonusEffects.length; b++) {
        externalEffects.push(bonusEffects[b]);
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
      externalEffects.push(tierStats.extraEffects[e]);
    }
  }

  // Pass 0: collect stat_mod_gain modifiers from character & external effects
  const perStatGainPct: Partial<Record<StatKey, number>> = {};
  const scaleRules: EffectDef[] = [];
  const standStillEffects: EffectDef[] = [];
  const movingEffects: EffectDef[] = [];

  const collectMeta = (list: readonly EffectDef[], isChar: boolean): void => {
    for (let i = 0; i < list.length; i++) {
      const eff = list[i];
      if (eff.trigger === 'stat_mod_gain') {
        const val = eff.value ?? 0;
        if (eff.stat) {
          perStatGainPct[eff.stat] = (perStatGainPct[eff.stat] ?? 0) + val;
        } else if (eff.customKey === 'positive_stats') {
          stats.mod_all_positive_stats += val;
        } else if (eff.customKey === 'negative_stats') {
          stats.mod_all_negative_stats += val;
        }
      } else if (eff.trigger === 'stat_scale') {
        scaleRules.push(eff);
      } else if (eff.trigger === 'on_stand_still') {
        standStillEffects.push(eff);
      } else if (eff.trigger === 'on_move') {
        movingEffects.push(eff);
      } else if (
        eff.trigger === 'passive_stat' ||
        eff.trigger === 'special_flag' ||
        eff.trigger === 'weapon_rule'
      ) {
        if (isChar && eff.stat && eff.value !== undefined) {
          applyStatDelta(stats, eff.stat, eff.value, eff.trigger !== 'passive_stat');
        }
      }
    }
  };

  collectMeta(charEffects, true);
  collectMeta(externalEffects, false);

  // Also allow mod_all_positive_stats / mod_all_negative_stats set via passive_stat
  const posAllPct = stats.mod_all_positive_stats;
  const negAllPct = stats.mod_all_negative_stats;

  // Pass 1: apply external passive_stat / special_flag / weapon_rule effects
  for (let i = 0; i < externalEffects.length; i++) {
    const eff = externalEffects[i];
    if (
      eff.trigger !== 'passive_stat' &&
      eff.trigger !== 'special_flag' &&
      eff.trigger !== 'weapon_rule'
    ) {
      continue;
    }
    if (!eff.stat || eff.value === undefined) continue;
    const isOverride = eff.trigger !== 'passive_stat';
    const v = isOverride
      ? eff.value
      : scaleModValue(eff.stat, eff.value, perStatGainPct, posAllPct, negAllPct);
    applyStatDelta(stats, eff.stat, v, isOverride);
  }

  // Pass 1b: permanentStatMods (level-ups, ethereal kill gains, etc.)
  for (const key in player.permanentStatMods) {
    const statKey = key as StatKey;
    const raw = player.permanentStatMods[statKey];
    if (raw === undefined || raw === 0) continue;
    const v = scaleModValue(statKey, raw, perStatGainPct, posAllPct, negAllPct);
    applyStatDelta(stats, statKey, v, false);
  }

  // Pass 1c: tempWaveStatMods (temporary wave buffs e.g. on-dodge speed)
  for (const key in player.tempWaveStatMods) {
    const statKey = key as StatKey;
    const raw = player.tempWaveStatMods[statKey];
    if (raw === undefined || raw === 0) continue;
    applyStatDelta(stats, statKey, raw, false);
  }

  // Dynamic weapon/slot/environment derived modifiers
  if (stats.armor_per_missing_slot !== 0) {
    const emptySlots = Math.max(0, stats.weapon_slot - player.weapons.length);
    stats.stat_armor += emptySlots * stats.armor_per_missing_slot;
  }
  if (stats.damage_per_weapon_diff !== 0) {
    const uniqueCount = Object.keys(weaponIdCounts).length;
    stats.stat_percent_damage += uniqueCount * stats.damage_per_weapon_diff;
  }
  if (stats.damage_per_weapon_same !== 0) {
    let maxSame = 0;
    for (const id in weaponIdCounts) {
      if (weaponIdCounts[id] > maxSame) maxSame = weaponIdCounts[id];
    }
    stats.stat_percent_damage += maxSame * stats.damage_per_weapon_same;
  }
  if (stats.dmg_with_trees_alive !== 0) {
    stats.stat_percent_damage += state.trees.length * stats.dmg_with_trees_alive;
  }
  if (stats.padding_hp_per_materials !== 0) {
    // Padding grants +1 Max HP per 80 materials (or scaled by padding_hp_per_materials)
    const stacks = Math.floor(player.materials / 80);
    stats.stat_max_hp += stacks * stats.padding_hp_per_materials;
  }

  // Pass 2: Conditional Stand-Still vs Moving effects
  const isStandingStill = player.standStillTicks > 0;
  const isMoving = player.moveTicks > 0;

  if (isStandingStill) {
    stats.stat_armor += stats.stand_still_armor;
    stats.stat_dodge += stats.stand_still_dodge;
    stats.stat_percent_damage += stats.stand_still_damage;
    stats.stat_attack_speed += stats.stand_still_attack_speed;
    for (let i = 0; i < standStillEffects.length; i++) {
      const eff = standStillEffects[i];
      if (eff.stat && eff.value !== undefined) {
        applyStatDelta(stats, eff.stat, eff.value, false);
      }
    }
  } else if (isMoving) {
    stats.stat_armor += stats.moving_armor;
    stats.stat_dodge += stats.moving_dodge;
    stats.stat_speed += stats.moving_speed_bonus;
    for (let i = 0; i < movingEffects.length; i++) {
      const eff = movingEffects[i];
      if (eff.stat && eff.value !== undefined) {
        applyStatDelta(stats, eff.stat, eff.value, false);
      }
    }
  }

  // Pass 3: Declarative `stat_scale` rules (Knight armor->melee, Speedy speed->melee, Baby slots, etc.)
  for (let i = 0; i < scaleRules.length; i++) {
    const eff = scaleRules[i];
    if (!eff.stat || eff.value === undefined) continue;
    const per = eff.per && eff.per > 0 ? eff.per : 1;
    let srcVal = 0;
    if (eff.sourceStat) {
      srcVal = stats[eff.sourceStat];
    } else if (eff.customKey === 'materials') {
      srcVal = player.materials;
    } else if (eff.customKey === 'level') {
      srcVal = player.level;
    } else if (eff.customKey === 'weapons_count') {
      srcVal = player.weapons.length;
    } else if (eff.customKey === 'empty_slots') {
      srcVal = Math.max(0, stats.weapon_slot - player.weapons.length);
    } else if (eff.customKey === 'missing_hp') {
      srcVal = Math.max(0, stats.stat_max_hp - player.hp);
    } else if (eff.customKey === 'trees_alive') {
      srcVal = state.trees.length;
    } else if (eff.customKey === 'structures_count') {
      srcVal = state.structures.length;
    }
    const delta = Math.trunc(srcVal / per) * eff.value;
    if (delta !== 0) {
      applyStatDelta(stats, eff.stat, delta, false);
    }
  }

  // Direct extended scale stats
  if (stats.melee_dmg_per_armor !== 0) {
    stats.stat_melee_damage += Math.trunc(stats.stat_armor * stats.melee_dmg_per_armor);
  }
  if (stats.melee_dmg_per_speed !== 0) {
    stats.stat_melee_damage += Math.trunc(stats.stat_speed * stats.melee_dmg_per_speed);
  }
  if (stats.ranged_dmg_per_range !== 0) {
    stats.stat_ranged_damage += Math.trunc(stats.stat_range * stats.ranged_dmg_per_range);
  }
  if (stats.atk_spd_per_dodge !== 0) {
    stats.stat_attack_speed += Math.trunc(stats.stat_dodge * stats.atk_spd_per_dodge);
  }
  if (stats.dmg_per_missing_hp !== 0) {
    const missing = Math.max(0, Math.max(1, Math.round(stats.stat_max_hp)) - player.hp);
    stats.stat_percent_damage += missing * stats.dmg_per_missing_hp;
  }

  // Enforce hard character rules & bans
  if (stats.no_dodge > 0) {
    stats.stat_dodge = 0;
    stats.dodge_cap = 0;
  }
  if (stats.ban_hp_regen > 0) {
    stats.stat_hp_regen = 0;
  }
  if (stats.ban_lifesteal > 0) {
    stats.stat_lifesteal = 0;
  }
  if (stats.single_weapon_only > 0) {
    stats.weapon_slot = 1;
  }
  if (stats.no_weapons > 0) {
    stats.weapon_slot = 0;
  }
  stats.weapon_slot = Math.max(0, Math.round(stats.weapon_slot));
  stats.stat_max_hp = Math.max(1, Math.round(stats.stat_max_hp));

  // Sync onto player
  player.computedStats = stats;
  player.maxHp = stats.stat_max_hp;
  if (player.hp > player.maxHp) {
    player.hp = player.maxHp;
  }
}
