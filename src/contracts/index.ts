// ============================================================================
// krunkedtato — Single Source of Truth Contracts (Leaf Module — Zero Imports)
// ============================================================================

export const BRAND_NAME = 'krunkedtato';
export const SAVE_STORAGE_KEY = 'krunked_tato_save_v1';
export const SAVE_SCHEMA_VERSION = 1;

// --- Core Simulation & Spatial Constants ---
export const SIM_HZ = 60;
export const FIXED_DT = 1 / SIM_HZ;
export const REF_WIDTH = 1920;
export const REF_HEIGHT = 1080;

export const TILE_SIZE = 64;
export const ARENA_TILES_W = 32;
export const ARENA_TILES_H = 24;
export const ARENA_W = ARENA_TILES_W * TILE_SIZE; // 2048
export const ARENA_H = ARENA_TILES_H * TILE_SIZE; // 1536
export const EDGE_MAP_DIST = 64;
export const EDGE_SIZE = 96;

export const PLAYABLE_MIN_X = EDGE_MAP_DIST;
export const PLAYABLE_MAX_X = ARENA_W - EDGE_MAP_DIST;
export const PLAYABLE_MIN_Y = EDGE_MAP_DIST;
export const PLAYABLE_MAX_Y = ARENA_H - EDGE_MAP_DIST;

// --- Player Collider & Movement Constants ---
export const PLAYER_BASE_SPEED = 450; // px/s
export const PLAYER_MOVE_RADIUS = 24;
export const PLAYER_MOVE_OFFSET_Y = -12;
export const PLAYER_HURT_RADIUS = 21;
export const PLAYER_HURT_OFFSET_Y = -12;
export const PLAYER_PICKUP_RADIUS = 32;
export const PLAYER_PICKUP_OFFSET_Y = -24;
export const PLAYER_MAGNET_BASE = 150;
export const PLAYER_BASE_MAX_HP = 10;
export const PLAYER_DEFAULT_WEAPON_SLOTS = 6;
export const PLAYER_DEFAULT_DODGE_CAP = 60;
export const PLAYER_DEFAULT_SPEED_CAP = 150;
export const PLAYER_DEFAULT_CRIT_CAP = 1.0;

// --- Combat & Timing Constants ---
export const MIN_IFRAMES_TICKS = 12; // 0.2s
export const MAX_IFRAMES_TICKS = 24; // 0.4s
export const LIFESTEAL_COOLDOWN_TICKS = 6; // 0.1s (max 10 HP/s)
export const MIN_WEAPON_RANGE = 25;
export const MIN_WEAPON_COOLDOWN = 2; // ticks
export const MIN_SWEEP_DISTANCE = 250;
export const WEAPON_RECOIL_PX = 25;
export const WEAPON_RECOIL_TICKS = 6; // 0.1s
export const MANUAL_CROSSHAIR_DIST = 200;

// --- Wave, Economy & Entity Cap Constants ---
export const MAX_ENEMIES = 100;
export const MAX_GOLDS = 50;
export const MAX_GOLD_SCALE = 2.0;
export const GOLD_MERGE_SCALE_STEP = 0.05;
export const BAG_BOOST_SCALE = 1.25;
export const NB_SHOP_ITEMS = 4;
export const SPAWN_TELEGRAPH_TICKS = 60; // 1.0s
export const END_WAVE_TICKS = 120; // 2.0s
export const HARVEST_TICKS = 40; // 0.66s
export const BASE_HARVESTING_GROWTH = 5; // +5% per wave W1-20
export const ENDLESS_HARVESTING_DECAY = -20; // -20% per wave W21+
export const BASE_FRUIT_HEAL = 3;

export const WAVE_DURATIONS_SEC: readonly number[] = [
  20, 25, 30, 35, 40, 45, 50, 55, 60, 60,
  60, 60, 60, 60, 60, 60, 60, 60, 60, 90,
];

export const RARITY_COLORS: readonly [string, string, string, string] = [
  '#E6E6E6', // Tier 0 / T1 Common
  '#5ABEFF', // Tier 1 / T2 Uncommon
  '#AD5AFF', // Tier 2 / T3 Rare
  '#FF3B3B', // Tier 3 / T4 Legendary
];

export const RARITY_NAMES: readonly [string, string, string, string] = [
  'Common',
  'Uncommon',
  'Rare',
  'Legendary',
];

export const WEAPON_ANCHOR_TABLE: Readonly<Record<number, readonly Readonly<{ x: number; y: number }>[]>> = {
  1: [{ x: 0, y: 30 }],
  2: [{ x: 40, y: 20 }, { x: -40, y: 20 }],
  3: [{ x: 40, y: 20 }, { x: -40, y: 20 }, { x: 0, y: -45 }],
  4: [{ x: 40, y: 35 }, { x: -40, y: 35 }, { x: -40, y: -30 }, { x: 40, y: -30 }],
  5: [{ x: 35, y: 35 }, { x: -35, y: 35 }, { x: -55, y: -20 }, { x: 55, y: -20 }, { x: 0, y: -55 }],
  6: [{ x: 35, y: 45 }, { x: -35, y: 45 }, { x: -60, y: 0 }, { x: 60, y: 0 }, { x: -35, y: -45 }, { x: 35, y: -45 }],
};

export function getWeaponAnchorOffset(index: number, count: number): { x: number; y: number } {
  if (count <= 0) return { x: 0, y: 30 };
  if (count <= 6) {
    const table = WEAPON_ANCHOR_TABLE[count];
    const p = table[index % table.length];
    return { x: p.x, y: p.y };
  }
  const innerMax = Math.min(12, count);
  if (index < innerMax) {
    const angle = (index / innerMax) * Math.PI * 2 - Math.PI / 2;
    return { x: Math.cos(angle) * 58, y: Math.sin(angle) * 58 };
  }
  const outerCount = Math.max(1, count - innerMax);
  const angle = ((index - innerMax) / outerCount) * Math.PI * 2 - Math.PI / 2;
  return { x: Math.cos(angle) * 84, y: Math.sin(angle) * 84 };
}

// --- Modes & Screens ---
export type InputMode = 'keyboard' | 'gamepad' | 'touch';
export type AssetMode = 'BUILTIN' | 'CUSTOM_PACK';
export type TargetFps = 30 | 60 | 120;

export type GameScreen =
  | 'title'
  | 'select_character'
  | 'select_weapon'
  | 'select_zone'
  | 'select_danger'
  | 'combat'
  | 'wave_end'
  | 'crate_modal'
  | 'level_up'
  | 'shop'
  | 'pause'
  | 'victory'
  | 'game_over'
  | 'codex'
  | 'options';

export type WeaponSetId =
  | 'blade'
  | 'blunt'
  | 'ethereal'
  | 'explosive'
  | 'fire'
  | 'gun'
  | 'heavy'
  | 'legendary'
  | 'medical'
  | 'medieval'
  | 'musical'
  | 'naval'
  | 'precise'
  | 'primitive'
  | 'support'
  | 'tool'
  | 'unarmed';

export const ALL_WEAPON_SET_IDS: readonly WeaponSetId[] = [
  'blade', 'blunt', 'ethereal', 'explosive', 'fire', 'gun', 'heavy', 'legendary',
  'medical', 'medieval', 'musical', 'naval', 'precise', 'primitive', 'support', 'tool', 'unarmed',
];

export type CoreStatKey =
  | 'stat_max_hp'
  | 'stat_hp_regen'
  | 'stat_lifesteal'
  | 'stat_percent_damage'
  | 'stat_melee_damage'
  | 'stat_ranged_damage'
  | 'stat_elemental_damage'
  | 'stat_attack_speed'
  | 'stat_crit_chance'
  | 'stat_engineering'
  | 'stat_range'
  | 'stat_armor'
  | 'stat_dodge'
  | 'stat_speed'
  | 'stat_luck'
  | 'stat_harvesting';

export const CORE_STAT_KEYS: readonly CoreStatKey[] = [
  'stat_max_hp',
  'stat_hp_regen',
  'stat_lifesteal',
  'stat_percent_damage',
  'stat_melee_damage',
  'stat_ranged_damage',
  'stat_elemental_damage',
  'stat_attack_speed',
  'stat_crit_chance',
  'stat_engineering',
  'stat_range',
  'stat_armor',
  'stat_dodge',
  'stat_speed',
  'stat_luck',
  'stat_harvesting',
];

export type ExtendedStatKey =
  | 'consumable_heal'
  | 'xp_gain'
  | 'pickup_range'
  | 'items_price'
  | 'weapons_price'
  | 'reroll_price'
  | 'recycling_gains'
  | 'explosion_damage'
  | 'explosion_size'
  | 'bounce'
  | 'piercing'
  | 'piercing_damage'
  | 'knockback'
  | 'hp_start_wave'
  | 'trees'
  | 'enemies'
  | 'enemy_speed'
  | 'enemy_damage'
  | 'enemy_health'
  | 'materials_per_wave'
  | 'free_rerolls'
  | 'weapon_slot'
  | 'dodge_cap'
  | 'speed_cap'
  | 'crit_cap'
  | 'bonus_crit_damage'
  | 'hit_protection'
  | 'burn_chance'
  | 'burn_damage'
  | 'burn_duration'
  | 'burn_spread'
  | 'structure_attack_speed'
  | 'structure_range'
  | 'turret_count'
  | 'mine_count'
  | 'garden_count'
  | 'healing_turret_count'
  | 'hp_per_consumable_max'
  | 'double_material_chance'
  | 'crate_chance'
  | 'item_box_gold'
  | 'harvesting_growth'
  | 'inflation_modifier'
  | 'damage_against_bosses'
  | 'no_melee_weapons'
  | 'no_ranged_weapons'
  | 'no_weapons'
  | 'hp_shop'
  | 'shop_resets_weapons'
  | 'min_weapon_tier'
  | 'max_weapon_tier'
  | 'stand_still_armor'
  | 'stand_still_dodge'
  | 'stand_still_damage'
  | 'stand_still_attack_speed'
  | 'stand_still_income'
  | 'moving_armor'
  | 'moving_dodge'
  | 'moving_speed_bonus'
  | 'explode_on_hit'
  | 'explode_on_death'
  | 'pacifist_material_per_enemy'
  | 'hp_drain_per_sec'
  | 'extra_enemies_next_wave'
  | 'instant_gold_attracting'
  | 'ban_hp_regen'
  | 'ban_lifesteal'
  | 'ban_consumable_heal'
  | 'life_on_kill_chance'
  | 'gold_on_crit_kill'
  | 'dmg_per_missing_hp'
  | 'piggy_bank_pct'
  | 'padding_hp_per_materials'
  | 'alien_eyes_interval'
  | 'cyberball_chance'
  | 'baby_beard_chance'
  | 'spicy_sauce_chance'
  | 'rip_and_tear_chance'
  | 'blood_donation_gold'
  | 'heal_on_dodge_chance'
  | 'speed_on_dodge'
  | 'atk_spd_per_dodge'
  | 'melee_dmg_per_armor'
  | 'melee_dmg_per_speed'
  | 'ranged_dmg_per_range'
  | 'armor_per_missing_slot'
  | 'damage_per_weapon_diff'
  | 'damage_per_weapon_same'
  | 'mod_all_positive_stats'
  | 'mod_all_negative_stats'
  | 'dmg_with_trees_alive'
  | 'double_structure_effects'
  | 'single_weapon_only'
  | 'no_dodge'
  | 'convert_materials_to_hp'
  | 'xp_per_material'
  | 'boss_spawn_extra';

export type StatKey = CoreStatKey | ExtendedStatKey;
export type StatMap = Record<StatKey, number>;

// --- Declarative EffectGraph ---
export type EffectTrigger =
  | 'passive_stat'
  | 'stat_scale'
  | 'stat_mod_gain'
  | 'on_hit_taken'
  | 'on_enemy_hit'
  | 'on_enemy_kill'
  | 'on_dodge'
  | 'on_pickup_material'
  | 'on_pickup_consumable'
  | 'on_wave_start'
  | 'on_wave_end'
  | 'on_shop_buy'
  | 'on_shop_reroll'
  | 'on_level_up'
  | 'on_stand_still'
  | 'on_move'
  | 'weapon_rule'
  | 'special_flag';

export interface EffectDef {
  trigger: EffectTrigger;
  stat?: StatKey;
  value?: number;
  sourceStat?: StatKey;
  per?: number;
  chance?: number; // 0..1
  cooldownTicks?: number;
  customKey?: string;
  args?: Record<string, number | string | boolean>;
  text?: string;
}

// --- Static Content Definitions ---
export interface CharacterVisualDef {
  skinColor: string;
  outlineColor: string;
  hatId: string;
  accessoryId: string;
  eyeStyle: number;
  mouthStyle: number;
  spriteId: string;
}

export interface CharacterDef {
  id: string;
  name: string;
  tagline: string;
  unlockedByDefault: boolean;
  unlockChallengeId?: string;
  weaponSlots: number;
  wantedTags: string[];
  startingWeapons: string[];
  startingItems: string[];
  effects: EffectDef[];
  visual: CharacterVisualDef;
}

export type MeleeAttackType = 0 | 1 | 2; // 0 = thrust, 1 = sweep, 2 = alternate

export interface WeaponTierStats {
  tier: 1 | 2 | 3 | 4;
  value: number;
  cooldown: number; // ticks @ 60Hz
  damage: number;
  accuracy: number; // 0..1
  critChance: number; // 0..1
  critDamage: number; // multiplier e.g. 2.0
  minRange: number;
  maxRange: number;
  knockback: number;
  lifesteal: number; // 0..1 bonus
  scalingStats: ReadonlyArray<readonly [StatKey, number]>;
  projectiles: number;
  projectileSpeed: number; // px/s
  piercing: number;
  piercingDamageReduction: number; // 0..1 (0.5 default)
  bounce: number;
  bounceDamageReduction: number; // 0..1 (0.5 default)
  explosionRadius: number;
  explosionDamage: number;
  burnDamage: number;
  burnDuration: number; // seconds
  burnTicks: number; // ticks between burn hits
  attackType: MeleeAttackType;
  recoil: number;
  recoilDuration: number; // seconds
  isHealing: boolean;
  extraEffects: EffectDef[];
}

export type WeaponSoundKind =
  | 'pistol'
  | 'smg'
  | 'shotgun'
  | 'laser'
  | 'sniper'
  | 'rocket'
  | 'flame'
  | 'magic'
  | 'melee_light'
  | 'melee_heavy'
  | 'melee_blade'
  | 'musical'
  | 'throw';

export interface WeaponDef {
  id: string;
  name: string;
  kind: 'melee' | 'ranged';
  sets: WeaponSetId[];
  minTier: 1 | 2 | 3 | 4;
  maxTier: 1 | 2 | 3 | 4;
  unlockedByDefault: boolean;
  unlockChallengeId?: string;
  tags: string[];
  spriteId: string;
  projectileSpriteId?: string;
  soundKind: WeaponSoundKind;
  color: string;
  tiers: Partial<Record<1 | 2 | 3 | 4, WeaponTierStats>>;
}

export interface SetDef {
  id: WeaponSetId;
  name: string;
  bonuses: Record<number, EffectDef[]>; // keys: 2, 3, 4, 5, 6
}

export interface ItemDef {
  id: string;
  name: string;
  tier: 0 | 1 | 2 | 3; // 0=Common, 1=Uncommon, 2=Rare, 3=Legendary
  value: number;
  maxCount: number; // -1 = unlimited, 1 = unique, N = limited
  tags: string[];
  unlockedByDefault: boolean;
  unlockChallengeId?: string;
  effects: EffectDef[];
  description: string;
  spriteId: string;
}

export interface UpgradeDef {
  id: string;
  statKey: CoreStatKey;
  name: string;
  tier: 0 | 1 | 2 | 3;
  value: number;
  iconId: string;
}

export type EnemyBehavior =
  | 'chaser'
  | 'spitter'
  | 'charger'
  | 'bruiser'
  | 'fly'
  | 'junkie'
  | 'fin_alien'
  | 'helmet_alien'
  | 'slasher'
  | 'egg'
  | 'spawner'
  | 'buffer'
  | 'healer'
  | 'lamprey'
  | 'pursuer'
  | 'tentacle'
  | 'looter'
  | 'elite_butcher'
  | 'elite_colossus'
  | 'elite_croc'
  | 'elite_gargoyle'
  | 'elite_mantis'
  | 'elite_mom'
  | 'elite_monk'
  | 'elite_rhino'
  | 'boss_predator'
  | 'boss_invoker';

export interface EnemyDef {
  id: string;
  name: string;
  kind: 'basic' | 'elite' | 'boss';
  zone: 0 | 1 | 2;
  baseHp: number;
  hpPerWave: number;
  baseDamage: number;
  damagePerWave: number;
  speed: number; // px/s
  radius: number;
  knockbackResistance: number; // 0..1 (1 = immune)
  materialDrops: number;
  materialValue: number;
  crateDropChance: number;
  consumableDropChance: number;
  behavior: EnemyBehavior;
  projectileSpeed?: number;
  attackCooldownTicks?: number;
  spawnChildId?: string;
  spriteId: string;
  color: string;
  accentColor: string;
  scale: number;
}

export interface WaveGroupDef {
  enemyId: string;
  minCount: number;
  maxCount: number;
  intervalSec: number;
  startSec: number;
  endSec: number;
  minDanger?: number;
  hordeOnly?: boolean;
}

export interface WaveDef {
  wave: number;
  durationSec: number;
  isHordePossible: boolean;
  isElitePossible: boolean;
  isBossWave: boolean;
  groups: WaveGroupDef[];
}

export interface DifficultyDef {
  level: number; // 0..6
  id: string;
  name: string;
  description: string;
  enemyHpMult: number;
  enemyDamageMult: number;
  enemySpeedMult: number;
  shopInflationBonus: number;
  elitesEnabled: boolean;
  extraElites: boolean;
  doubleBoss: boolean;
  nightmareEvents: boolean;
  unlockRequirementDanger: number; // -1 if unlocked by default
}

export interface ZoneDef {
  id: number; // 0, 1, 2
  key: string;
  name: string;
  subtitle: string;
  floorPrimary: string;
  floorSecondary: string;
  borderColor: string;
  accentColor: string;
  propSpritePrefix: string;
  ambientHazard: 'none' | 'abyss_currents' | 'jungle_spores';
}

export interface ChallengeDef {
  id: string;
  name: string;
  description: string;
  rewardType: 'character' | 'weapon' | 'item';
  rewardId: string;
  conditionType: 'win_character' | 'win_danger' | 'reach_stat' | 'kill_count' | 'materials_collected';
  targetId?: string;
  targetValue: number;
}

export interface GameDataCatalog {
  characters: readonly CharacterDef[];
  weapons: readonly WeaponDef[];
  sets: readonly SetDef[];
  items: readonly ItemDef[];
  upgrades: readonly UpgradeDef[];
  enemies: readonly EnemyDef[];
  waves: readonly WaveDef[];
  difficulties: readonly DifficultyDef[];
  zones: readonly ZoneDef[];
  challenges: readonly ChallengeDef[];
  charactersById: Readonly<Record<string, CharacterDef>>;
  weaponsById: Readonly<Record<string, WeaponDef>>;
  setsById: Readonly<Record<WeaponSetId, SetDef>>;
  itemsById: Readonly<Record<string, ItemDef>>;
  upgradesById: Readonly<Record<string, UpgradeDef>>;
  enemiesById: Readonly<Record<string, EnemyDef>>;
}

// --- Live Simulation Entities ---
export interface EquippedWeaponState {
  uid: number;
  weaponId: string;
  tier: 1 | 2 | 3 | 4;
  cooldownTicks: number;
  maxCooldownTicks: number;
  aimAngle: number;
  recoilOffset: number;
  recoilTimer: number;
  swingTimer: number;
  swingDuration: number;
  swingType: 0 | 1; // 0 thrust, 1 sweep
  swingDir: number; // +1 or -1
  alternateNext: 0 | 1;
  targetEnemyUid: number;
  killsThisRun: number;
  bonusDamage: number;
  worldX: number;
  worldY: number;
  prevWorldX: number;
  prevWorldY: number;
}

export interface PlayerState {
  x: number;
  y: number;
  prevX: number;
  prevY: number;
  vx: number;
  vy: number;
  facingX: number;
  hp: number;
  maxHp: number;
  xp: number;
  xpToNext: number;
  level: number;
  pendingLevelUps: number;
  materials: number;
  bonusGold: number; // Loot Bag 2x pool
  iframesTicks: number;
  hitFlashTicks: number;
  regenAccumulator: number;
  lifestealCooldownTicks: number;
  hitProtectionLeft: number;
  standStillTicks: number;
  moveTicks: number;
  alienEyesTimer: number;
  hpDrainAccumulator: number;
  walkAnimPhase: number;
  characterId: string;
  weapons: EquippedWeaponState[];
  items: string[];
  itemCounts: Record<string, number>;
  permanentStatMods: Partial<Record<StatKey, number>>;
  tempWaveStatMods: Partial<Record<StatKey, number>>;
  computedStats: StatMap;
  activeSetCounts: Partial<Record<WeaponSetId, number>>;
  godMode: boolean;
}

export interface EnemyState {
  uid: number;
  defId: string;
  kind: 'basic' | 'elite' | 'boss';
  behavior: EnemyBehavior;
  x: number;
  y: number;
  prevX: number;
  prevY: number;
  vx: number;
  vy: number;
  kbVx: number;
  kbVy: number;
  radius: number;
  hp: number;
  maxHp: number;
  damage: number;
  speed: number;
  knockbackResistance: number;
  facingX: number;
  state: 'idle' | 'move' | 'windup' | 'dash' | 'attack' | 'recover' | 'enraged';
  stateTimer: number;
  attackCooldown: number;
  phase: number; // Boss / Elite phase 1..3
  patternIndex: number;
  targetX: number;
  targetY: number;
  hitFlashTicks: number;
  burnDamage: number;
  burnTicksLeft: number;
  burnTickInterval: number;
  burnTickTimer: number;
  buffedTicks: number;
  buffSpeedMult: number;
  buffDmgMult: number;
  slowTicks: number;
  ageTicks: number;
  spawnedFromBoss: boolean;
}

export interface ProjectileState {
  uid: number;
  owner: 'player' | 'enemy' | 'structure';
  x: number;
  y: number;
  prevX: number;
  prevY: number;
  vx: number;
  vy: number;
  radius: number;
  damage: number;
  isCrit: boolean;
  knockback: number;
  lifesteal: number;
  pierceLeft: number;
  pierceDmgMult: number;
  bounceLeft: number;
  bounceDmgMult: number;
  explosionRadius: number;
  explosionDamage: number;
  burnDamage: number;
  burnDurationSec: number;
  lifeTicks: number;
  maxLifeTicks: number;
  spriteId: string;
  color: string;
  hitEnemyUids: number[];
  sourceWeaponUid: number;
}

export interface StructureState {
  uid: number;
  kind: 'turret' | 'medical_turret' | 'mine' | 'garden' | 'laser_turret' | 'explosive_turret';
  x: number;
  y: number;
  cooldownTicks: number;
  maxCooldownTicks: number;
  range: number;
  damage: number;
  aimAngle: number;
  triggered: boolean;
  recoil: number;
  tier: number;
}

export interface PickupState {
  uid: number;
  kind: 'material' | 'consumable' | 'crate' | 'legendary_crate';
  x: number;
  y: number;
  prevX: number;
  prevY: number;
  vx: number;
  vy: number;
  value: number;
  scale: number;
  isBagBoosted: boolean; // 2x Loot Bag pickup
  attracted: boolean;
  attractSpeed: number;
  ageTicks: number;
}

export interface TreeState {
  uid: number;
  x: number;
  y: number;
  hp: number;
  maxHp: number;
  radius: number;
  hitFlashTicks: number;
  variant: number;
}

export interface SpawnTelegraphState {
  uid: number;
  enemyId: string;
  x: number;
  y: number;
  ticksLeft: number;
  totalTicks: number;
  isElite: boolean;
  isBoss: boolean;
}

export interface HazardState {
  uid: number;
  kind: 'boss_beam' | 'boss_ring' | 'boss_orb_zone' | 'explosion' | 'melee_slash' | 'fog_pulse' | 'acid_pool';
  owner: 'player' | 'enemy';
  x: number;
  y: number;
  endX: number;
  endY: number;
  angle: number;
  arcSpan: number;
  radius: number;
  damage: number;
  ticksLeft: number;
  maxTicks: number;
  activeDelayTicks: number;
  color: string;
  hitPlayer: boolean;
}

export interface ShopOffer {
  slotIndex: number;
  kind: 'weapon' | 'item';
  defId: string;
  tier: 0 | 1 | 2 | 3; // items 0..3; weapons 0..3 maps to weapon tier 1..4
  price: number;
  locked: boolean;
  purchased: boolean;
}

export interface ShopState {
  offers: ShopOffer[];
  rerollCount: number;
  freeRerollsLeft: number;
  rerollCost: number;
}

export interface LevelUpState {
  offers: UpgradeDef[];
  rerollCount: number;
  rerollCost: number;
  remainingLevelUps: number;
}

export interface CrateModalState {
  pendingCrates: Array<{
    isLegendary: boolean;
    itemId: string;
    recycleValue: number;
  }>;
}

export interface CameraState {
  x: number;
  y: number;
  prevX: number;
  prevY: number;
  shakeTrauma: number;
  shakeOffsetX: number;
  shakeOffsetY: number;
  shakeDirX: number;
  shakeDirY: number;
  zoom: number;
}

export interface RunStats {
  kills: number;
  elitesKilled: number;
  bossesKilled: number;
  damageDealt: number;
  damageTaken: number;
  materialsCollected: number;
  cratesOpened: number;
  treesChopped: number;
  critsLanded: number;
  dodges: number;
  waveReached: number;
  ticksPlayed: number;
}

export type SimEvent =
  | { type: 'weapon_fire'; weaponId: string; soundKind: WeaponSoundKind; x: number; y: number; angle: number; isMelee: boolean }
  | { type: 'enemy_hit'; x: number; y: number; damage: number; isCrit: boolean; enemyId: string; isBoss: boolean }
  | { type: 'enemy_die'; x: number; y: number; enemyId: string; color: string; isElite: boolean; isBoss: boolean }
  | { type: 'player_hit'; x: number; y: number; damage: number }
  | { type: 'player_dodge'; x: number; y: number }
  | { type: 'player_heal'; x: number; y: number; amount: number }
  | { type: 'pickup_material'; x: number; y: number; value: number; isBoosted: boolean }
  | { type: 'pickup_consumable'; x: number; y: number; heal: number }
  | { type: 'pickup_crate'; x: number; y: number; isLegendary: boolean }
  | { type: 'explosion'; x: number; y: number; radius: number; color: string }
  | { type: 'level_up'; level: number; x: number; y: number }
  | { type: 'wave_start'; wave: number; isBoss: boolean; isElite: boolean; isHorde: boolean }
  | { type: 'wave_end'; wave: number }
  | { type: 'harvest_payout'; amount: number }
  | { type: 'shop_buy'; kind: 'weapon' | 'item'; defId: string }
  | { type: 'shop_combine'; weaponId: string; newTier: number }
  | { type: 'shop_recycle'; refund: number }
  | { type: 'shop_reroll' }
  | { type: 'boss_spawn'; bossId: string; name: string }
  | { type: 'victory'; wave: number }
  | { type: 'game_over'; wave: number }
  | { type: 'decal'; kind: 'splat' | 'scorch' | 'crater'; x: number; y: number; radius: number; color: string };

export interface SimState {
  seed: number;
  rngState: number;
  tick: number;
  nextUid: number;
  screen: GameScreen;
  previousScreen: GameScreen;
  zoneId: 0 | 1 | 2;
  dangerLevel: number;
  wave: number;
  isEndless: boolean;
  isHordeWave: boolean;
  isEliteWave: boolean;
  isBossWave: boolean;
  nightmareEvent: 'none' | 'bullet_hell' | 'fog_of_war';
  waveDurationTicks: number;
  waveElapsedTicks: number;
  waveEndTimer: number;
  harvestTimer: number;
  harvestPaid: boolean;
  autoAim: boolean;
  manualAimWorldX: number;
  manualAimWorldY: number;
  aimActive: boolean;
  spawnerGroupTimers: number[];
  treeSpawnTimer: number;
  lootAlienSpawned: boolean;
  bossSpawned: boolean;
  eliteSpawned: boolean;
  player: PlayerState;
  enemies: EnemyState[];
  projectiles: ProjectileState[];
  structures: StructureState[];
  pickups: PickupState[];
  trees: TreeState[];
  telegraphs: SpawnTelegraphState[];
  hazards: HazardState[];
  shop: ShopState;
  levelUp: LevelUpState;
  crateModal: CrateModalState;
  camera: CameraState;
  runStats: RunStats;
  events: SimEvent[];
  selectedCharId: string;
  selectedWeaponId: string;
  selectedZoneId: 0 | 1 | 2;
  selectedDanger: number;
  victoryTriggered: boolean;
}

// --- Input & Navigation ---
export interface InputFrame {
  moveX: number; // -1..1
  moveY: number; // -1..1
  aimX: number; // -1..1 (right stick or manual vector)
  aimY: number; // -1..1
  aimActive: boolean;
  aimWorldX: number;
  aimWorldY: number;
  hasWorldAim: boolean;
  toggleAutoAimPressed: boolean;
  pausePressed: boolean;
  statsHeld: boolean;
  activeInputMode: InputMode;
}

export type UiNavAction =
  | 'up'
  | 'down'
  | 'left'
  | 'right'
  | 'confirm'
  | 'back'
  | 'x_action'
  | 'y_action'
  | 'lb'
  | 'rb'
  | 'pause'
  | 'stats';

// --- Simulation Commands ---
export type SimCommand =
  | { type: 'start_run'; characterId: string; weaponId: string; zoneId: 0 | 1 | 2; dangerLevel: number; seed?: number }
  | { type: 'shop_buy'; slotIndex: number }
  | { type: 'shop_lock'; slotIndex: number }
  | { type: 'shop_reroll' }
  | { type: 'shop_combine'; weaponUid: number }
  | { type: 'shop_recycle'; weaponUid: number }
  | { type: 'shop_next_wave' }
  | { type: 'level_up_pick'; index: number }
  | { type: 'level_up_reroll' }
  | { type: 'crate_keep' }
  | { type: 'crate_recycle' }
  | { type: 'continue_endless' }
  | { type: 'set_screen'; screen: GameScreen }
  | { type: 'toggle_pause' }
  | { type: 'toggle_auto_aim' }
  | { type: 'debug_warp_wave'; wave: number }
  | { type: 'debug_spawn_boss'; bossId?: string }
  | { type: 'debug_spawn_elite'; eliteId?: string }
  | { type: 'debug_give_weapon'; weaponId: string; tier?: 1 | 2 | 3 | 4 }
  | { type: 'debug_give_item'; itemId: string }
  | { type: 'debug_set_godmode'; enabled: boolean }
  | { type: 'debug_give_materials'; amount: number }
  | { type: 'debug_force_level_up' }
  | { type: 'debug_kill_all' };

// --- Settings & Persistence ---
export interface RenderSettings {
  targetFps: TargetFps;
  classicSnap60: boolean;
  screenShake: boolean;
  damageNumbers: boolean;
  hitFlash: boolean;
}

export interface AudioSettings {
  masterVolume: number; // 0..1
  sfxVolume: number; // 0..1
  musicVolume: number; // 0..1
  muted: boolean;
}

export interface TouchSettings {
  idleOpacity: number; // default 0.24
  activeOpacity: number; // default 0.46
  leftHanded: boolean;
}

export interface KeyBindings {
  moveUp: string;
  moveDown: string;
  moveLeft: string;
  moveRight: string;
  toggleAutoAim: string;
  pause: string;
  stats: string;
}

export interface ActiveRunSnapshot {
  seed: number;
  rngState: number;
  wave: number;
  zoneId: 0 | 1 | 2;
  dangerLevel: number;
  isEndless: boolean;
  screen: GameScreen;
  player: PlayerState;
  shop: ShopState;
  levelUp: LevelUpState;
  crateModal: CrateModalState;
  runStats: RunStats;
  autoAim: boolean;
}

export interface SaveData {
  schemaVersion: number;
  assetMode: AssetMode;
  renderSettings: RenderSettings;
  audioSettings: AudioSettings;
  touchSettings: TouchSettings;
  keyBindings: KeyBindings;
  highestDangerCleared: number;
  characterMaxDanger: Record<string, number>;
  unlockedChallenges: string[];
  lifetimeKills: number;
  lifetimeRuns: number;
  lifetimeWins: number;
  activeRun: ActiveRunSnapshot | null;
}

// --- Assets, Rendering, Audio, Performance & Debug Contracts ---
export interface AtlasRegion {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  u0: number;
  v0: number;
  u1: number;
  v1: number;
}

export interface CustomPackStatus {
  available: boolean;
  active: boolean;
  source: 'none' | 'dev-middleware' | 'indexeddb' | 'memory';
  textureCount: number;
  audioCount: number;
  label: string;
}

export interface PerfStats {
  fps: number;
  simHz: number;
  frameMs: number;
  backend: 'webgl2' | 'canvas2d';
  drawCalls: number;
  quadCount: number;
  enemyCount: number;
  projectileCount: number;
  pickupCount: number;
}

export interface RendererAPI {
  readonly backend: 'webgl2' | 'canvas2d';
  resize(width: number, height: number, dpr: number): void;
  render(state: SimState, interpAlpha: number, settings: RenderSettings): void;
  onSimEvents(events: readonly SimEvent[], state: SimState): void;
  clearDecals(): void;
  setAtlasSource(canvas: HTMLCanvasElement, regions: Map<string, AtlasRegion>, customImages?: Map<string, HTMLImageElement | ImageBitmap>): void;
  getPerfSnapshot(): { drawCalls: number; quadCount: number };
  dispose(): void;
}

export interface AudioEngineAPI {
  unlock(): void;
  applySettings(settings: AudioSettings): void;
  updateMusic(screen: GameScreen, isBoss: boolean, isElite: boolean, zoneId: 0 | 1 | 2): void;
  processEvents(events: readonly SimEvent[], cameraX: number): void;
  playUiClick(kind: 'hover' | 'confirm' | 'cancel' | 'buy' | 'reroll' | 'combine' | 'error'): void;
  setCustomAudioBuffers(buffers: Map<string, AudioBuffer>): void;
  dispose(): void;
}

export interface SimEconomyHooks {
  rollShop(state: SimState, catalog: GameDataCatalog, nextRand: () => number, preserveLocked: boolean): void;
  buyShopOffer(state: SimState, catalog: GameDataCatalog, slotIndex: number, nextRand: () => number): boolean;
  lockShopOffer(state: SimState, slotIndex: number): boolean;
  rerollShop(state: SimState, catalog: GameDataCatalog, nextRand: () => number): boolean;
  combineWeapon(state: SimState, catalog: GameDataCatalog, weaponUid: number): boolean;
  recycleWeapon(state: SimState, catalog: GameDataCatalog, weaponUid: number): boolean;
  rollLevelUpOffers(state: SimState, catalog: GameDataCatalog, nextRand: () => number): void;
  pickLevelUpUpgrade(state: SimState, catalog: GameDataCatalog, index: number, nextRand: () => number): boolean;
  rerollLevelUpOffers(state: SimState, catalog: GameDataCatalog, nextRand: () => number): boolean;
  enqueueCrate(state: SimState, catalog: GameDataCatalog, isLegendary: boolean, nextRand: () => number): void;
  resolveCrate(state: SimState, catalog: GameDataCatalog, keep: boolean, nextRand: () => number): boolean;
  onWaveEndProgression(state: SimState, catalog: GameDataCatalog, nextRand: () => number): void;
  getShopPrice(baseValue: number, isWeapon: boolean, wave: number, isEndless: boolean, stats: StatMap): number;
  getRerollCost(wave: number, isEndless: boolean, rerollCount: number, stats: StatMap): number;
  getRecycleRefund(shopPrice: number, stats: StatMap): number;
  getRarityTierRoll(wave: number, luck: number, nextRand: () => number): 0 | 1 | 2 | 3;
}

export interface UIManagerCallbacks {
  onCommand(cmd: SimCommand): void;
  onUpdateRenderSettings(patch: Partial<RenderSettings>): void;
  onUpdateAudioSettings(patch: Partial<AudioSettings>): void;
  onUpdateTouchSettings(patch: Partial<TouchSettings>): void;
  onUpdateKeyBindings(patch: Partial<KeyBindings>): void;
  onSelectAssetMode(mode: AssetMode): Promise<void>;
  onUploadPckFile(file: File): Promise<void>;
  onUploadPackDirectory(files: FileList): Promise<void>;
  onClearCustomPack(): Promise<void>;
  onContinueSavedRun(): void;
  onResetSave(): void;
  onPlayUiClick(kind: 'hover' | 'confirm' | 'cancel' | 'buy' | 'reroll' | 'combine' | 'error'): void;
}

export interface DebugBridge {
  readonly version: string;
  getState(): SimState;
  getHash(): string;
  getPerf(): PerfStats;
  getInputMode(): InputMode;
  setInputMode(mode: InputMode): void;
  getTouchOverlayStatus(): { visible: boolean; opacity: number; mode: InputMode };
  getAssetMode(): AssetMode;
  setAssetMode(mode: AssetMode): Promise<void>;
  dispatch(cmd: SimCommand): void;
  stepTicks(count: number, input?: Partial<InputFrame>): string;
  simulateNav(action: UiNavAction): void;
  startQuickRun(opts?: { characterId?: string; weaponId?: string; zoneId?: 0 | 1 | 2; dangerLevel?: number; seed?: number }): void;
  resetSave(): void;
}

declare global {
  interface Window {
    __KRUNKED_DEBUG__?: DebugBridge;
  }
}
