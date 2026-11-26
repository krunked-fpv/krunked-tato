import type { SetDef, WeaponSetId } from '../contracts/index.ts';

export const SETS: readonly SetDef[] = [
  {
    id: 'blade',
    name: 'Blade',
    bonuses: {
      2: [
        { trigger: 'passive_stat', stat: 'stat_melee_damage', value: 1, text: '+1 Melee Damage' },
        { trigger: 'passive_stat', stat: 'stat_lifesteal', value: 1, text: '+1% Life Steal' },
      ],
      3: [
        { trigger: 'passive_stat', stat: 'stat_melee_damage', value: 2, text: '+2 Melee Damage' },
        { trigger: 'passive_stat', stat: 'stat_lifesteal', value: 2, text: '+2% Life Steal' },
      ],
      4: [
        { trigger: 'passive_stat', stat: 'stat_melee_damage', value: 3, text: '+3 Melee Damage' },
        { trigger: 'passive_stat', stat: 'stat_lifesteal', value: 3, text: '+3% Life Steal' },
      ],
      5: [
        { trigger: 'passive_stat', stat: 'stat_melee_damage', value: 4, text: '+4 Melee Damage' },
        { trigger: 'passive_stat', stat: 'stat_lifesteal', value: 4, text: '+4% Life Steal' },
      ],
      6: [
        { trigger: 'passive_stat', stat: 'stat_melee_damage', value: 5, text: '+5 Melee Damage' },
        { trigger: 'passive_stat', stat: 'stat_lifesteal', value: 5, text: '+5% Life Steal' },
      ],
    },
  },
  {
    id: 'blunt',
    name: 'Blunt',
    bonuses: {
      2: [
        { trigger: 'passive_stat', stat: 'stat_armor', value: 1, text: '+1 Armor' },
        { trigger: 'passive_stat', stat: 'stat_speed', value: -2, text: '-2% Speed' },
      ],
      3: [
        { trigger: 'passive_stat', stat: 'stat_armor', value: 1, text: '+1 Armor' },
        { trigger: 'passive_stat', stat: 'stat_max_hp', value: 3, text: '+3 Max HP' },
        { trigger: 'passive_stat', stat: 'stat_speed', value: -4, text: '-4% Speed' },
      ],
      4: [
        { trigger: 'passive_stat', stat: 'stat_armor', value: 2, text: '+2 Armor' },
        { trigger: 'passive_stat', stat: 'stat_max_hp', value: 3, text: '+3 Max HP' },
        { trigger: 'passive_stat', stat: 'stat_speed', value: -6, text: '-6% Speed' },
      ],
      5: [
        { trigger: 'passive_stat', stat: 'stat_armor', value: 2, text: '+2 Armor' },
        { trigger: 'passive_stat', stat: 'stat_max_hp', value: 6, text: '+6 Max HP' },
        { trigger: 'passive_stat', stat: 'stat_speed', value: -8, text: '-8% Speed' },
      ],
      6: [
        { trigger: 'passive_stat', stat: 'stat_armor', value: 3, text: '+3 Armor' },
        { trigger: 'passive_stat', stat: 'stat_max_hp', value: 6, text: '+6 Max HP' },
        { trigger: 'passive_stat', stat: 'stat_speed', value: -10, text: '-10% Speed' },
      ],
    },
  },
  {
    id: 'ethereal',
    name: 'Ethereal',
    bonuses: {
      2: [
        { trigger: 'passive_stat', stat: 'stat_dodge', value: 6, text: '+6% Dodge' },
        { trigger: 'passive_stat', stat: 'stat_armor', value: -1, text: '-1 Armor' },
      ],
      3: [
        { trigger: 'passive_stat', stat: 'stat_dodge', value: 12, text: '+12% Dodge' },
        { trigger: 'passive_stat', stat: 'stat_armor', value: -2, text: '-2 Armor' },
      ],
      4: [
        { trigger: 'passive_stat', stat: 'stat_dodge', value: 18, text: '+18% Dodge' },
        { trigger: 'passive_stat', stat: 'stat_armor', value: -3, text: '-3 Armor' },
      ],
      5: [
        { trigger: 'passive_stat', stat: 'stat_dodge', value: 24, text: '+24% Dodge' },
        { trigger: 'passive_stat', stat: 'stat_armor', value: -4, text: '-4 Armor' },
      ],
      6: [
        { trigger: 'passive_stat', stat: 'stat_dodge', value: 30, text: '+30% Dodge' },
        { trigger: 'passive_stat', stat: 'stat_armor', value: -5, text: '-5 Armor' },
      ],
    },
  },
  {
    id: 'explosive',
    name: 'Explosive',
    bonuses: {
      2: [{ trigger: 'passive_stat', stat: 'explosion_size', value: 5, text: '+5% Explosion Size' }],
      3: [{ trigger: 'passive_stat', stat: 'explosion_size', value: 10, text: '+10% Explosion Size' }],
      4: [{ trigger: 'passive_stat', stat: 'explosion_size', value: 15, text: '+15% Explosion Size' }],
      5: [{ trigger: 'passive_stat', stat: 'explosion_size', value: 20, text: '+20% Explosion Size' }],
      6: [{ trigger: 'passive_stat', stat: 'explosion_size', value: 25, text: '+25% Explosion Size' }],
    },
  },
  {
    id: 'fire',
    name: 'Elemental',
    bonuses: {
      2: [{ trigger: 'passive_stat', stat: 'stat_elemental_damage', value: 1, text: '+1 Elemental Damage' }],
      3: [{ trigger: 'passive_stat', stat: 'stat_elemental_damage', value: 2, text: '+2 Elemental Damage' }],
      4: [{ trigger: 'passive_stat', stat: 'stat_elemental_damage', value: 3, text: '+3 Elemental Damage' }],
      5: [{ trigger: 'passive_stat', stat: 'stat_elemental_damage', value: 4, text: '+4 Elemental Damage' }],
      6: [{ trigger: 'passive_stat', stat: 'stat_elemental_damage', value: 5, text: '+5 Elemental Damage' }],
    },
  },
  {
    id: 'gun',
    name: 'Gun',
    bonuses: {
      2: [{ trigger: 'passive_stat', stat: 'stat_range', value: 10, text: '+10 Range' }],
      3: [{ trigger: 'passive_stat', stat: 'stat_range', value: 20, text: '+20 Range' }],
      4: [{ trigger: 'passive_stat', stat: 'stat_range', value: 30, text: '+30 Range' }],
      5: [{ trigger: 'passive_stat', stat: 'stat_range', value: 40, text: '+40 Range' }],
      6: [{ trigger: 'passive_stat', stat: 'stat_range', value: 50, text: '+50 Range' }],
    },
  },
  {
    id: 'heavy',
    name: 'Heavy',
    bonuses: {
      2: [{ trigger: 'passive_stat', stat: 'stat_percent_damage', value: 5, text: '+5% Damage' }],
      3: [{ trigger: 'passive_stat', stat: 'stat_percent_damage', value: 10, text: '+10% Damage' }],
      4: [{ trigger: 'passive_stat', stat: 'stat_percent_damage', value: 15, text: '+15% Damage' }],
      5: [{ trigger: 'passive_stat', stat: 'stat_percent_damage', value: 20, text: '+20% Damage' }],
      6: [{ trigger: 'passive_stat', stat: 'stat_percent_damage', value: 25, text: '+25% Damage' }],
    },
  },
  {
    id: 'legendary',
    name: 'Legendary',
    bonuses: {
      2: [{ trigger: 'passive_stat', stat: 'stat_max_hp', value: -20, text: '-20 Max HP' }],
      3: [{ trigger: 'passive_stat', stat: 'stat_max_hp', value: -40, text: '-40 Max HP' }],
      4: [{ trigger: 'passive_stat', stat: 'stat_max_hp', value: -60, text: '-60 Max HP' }],
      5: [{ trigger: 'passive_stat', stat: 'stat_max_hp', value: -80, text: '-80 Max HP' }],
      6: [{ trigger: 'passive_stat', stat: 'stat_max_hp', value: -100, text: '-100 Max HP' }],
    },
  },
  {
    id: 'medical',
    name: 'Medical',
    bonuses: {
      2: [{ trigger: 'passive_stat', stat: 'stat_hp_regen', value: 1, text: '+1 HP Regeneration' }],
      3: [{ trigger: 'passive_stat', stat: 'stat_hp_regen', value: 2, text: '+2 HP Regeneration' }],
      4: [{ trigger: 'passive_stat', stat: 'stat_hp_regen', value: 3, text: '+3 HP Regeneration' }],
      5: [{ trigger: 'passive_stat', stat: 'stat_hp_regen', value: 4, text: '+4 HP Regeneration' }],
      6: [{ trigger: 'passive_stat', stat: 'stat_hp_regen', value: 5, text: '+5 HP Regeneration' }],
    },
  },
  {
    id: 'medieval',
    name: 'Medieval',
    bonuses: {
      2: [{ trigger: 'passive_stat', stat: 'stat_armor', value: 1, text: '+1 Armor' }],
      3: [
        { trigger: 'passive_stat', stat: 'stat_armor', value: 1, text: '+1 Armor' },
        { trigger: 'passive_stat', stat: 'stat_dodge', value: 3, text: '+3% Dodge' },
      ],
      4: [
        { trigger: 'passive_stat', stat: 'stat_armor', value: 2, text: '+2 Armor' },
        { trigger: 'passive_stat', stat: 'stat_dodge', value: 3, text: '+3% Dodge' },
      ],
      5: [
        { trigger: 'passive_stat', stat: 'stat_armor', value: 2, text: '+2 Armor' },
        { trigger: 'passive_stat', stat: 'stat_dodge', value: 6, text: '+6% Dodge' },
      ],
      6: [
        { trigger: 'passive_stat', stat: 'stat_armor', value: 3, text: '+3 Armor' },
        { trigger: 'passive_stat', stat: 'stat_dodge', value: 6, text: '+6% Dodge' },
      ],
    },
  },
  {
    id: 'musical',
    name: 'Musical',
    bonuses: {
      2: [{ trigger: 'passive_stat', stat: 'stat_luck', value: 5, text: '+5 Luck' }],
      3: [{ trigger: 'passive_stat', stat: 'stat_luck', value: 10, text: '+10 Luck' }],
      4: [{ trigger: 'passive_stat', stat: 'stat_luck', value: 15, text: '+15 Luck' }],
      5: [{ trigger: 'passive_stat', stat: 'stat_luck', value: 20, text: '+20 Luck' }],
      6: [{ trigger: 'passive_stat', stat: 'stat_luck', value: 25, text: '+25 Luck' }],
    },
  },
  {
    id: 'naval',
    name: 'Naval',
    bonuses: {
      2: [
        { trigger: 'passive_stat', stat: 'stat_luck', value: 3, text: '+3 Luck' },
        { trigger: 'passive_stat', stat: 'stat_attack_speed', value: 3, text: '+3% Attack Speed' },
      ],
      3: [
        { trigger: 'passive_stat', stat: 'stat_luck', value: 6, text: '+6 Luck' },
        { trigger: 'passive_stat', stat: 'stat_attack_speed', value: 6, text: '+6% Attack Speed' },
      ],
      4: [
        { trigger: 'passive_stat', stat: 'stat_luck', value: 9, text: '+9 Luck' },
        { trigger: 'passive_stat', stat: 'stat_attack_speed', value: 9, text: '+9% Attack Speed' },
      ],
      5: [
        { trigger: 'passive_stat', stat: 'stat_luck', value: 12, text: '+12 Luck' },
        { trigger: 'passive_stat', stat: 'stat_attack_speed', value: 12, text: '+12% Attack Speed' },
      ],
      6: [
        { trigger: 'passive_stat', stat: 'stat_luck', value: 15, text: '+15 Luck' },
        { trigger: 'passive_stat', stat: 'stat_attack_speed', value: 15, text: '+15% Attack Speed' },
      ],
    },
  },
  {
    id: 'precise',
    name: 'Precise',
    bonuses: {
      2: [{ trigger: 'passive_stat', stat: 'stat_crit_chance', value: 3, text: '+3% Crit Chance' }],
      3: [{ trigger: 'passive_stat', stat: 'stat_crit_chance', value: 6, text: '+6% Crit Chance' }],
      4: [{ trigger: 'passive_stat', stat: 'stat_crit_chance', value: 9, text: '+9% Crit Chance' }],
      5: [{ trigger: 'passive_stat', stat: 'stat_crit_chance', value: 12, text: '+12% Crit Chance' }],
      6: [{ trigger: 'passive_stat', stat: 'stat_crit_chance', value: 15, text: '+15% Crit Chance' }],
    },
  },
  {
    id: 'primitive',
    name: 'Primitive',
    bonuses: {
      2: [{ trigger: 'passive_stat', stat: 'stat_max_hp', value: 3, text: '+3 Max HP' }],
      3: [{ trigger: 'passive_stat', stat: 'stat_max_hp', value: 6, text: '+6 Max HP' }],
      4: [{ trigger: 'passive_stat', stat: 'stat_max_hp', value: 9, text: '+9 Max HP' }],
      5: [{ trigger: 'passive_stat', stat: 'stat_max_hp', value: 12, text: '+12 Max HP' }],
      6: [{ trigger: 'passive_stat', stat: 'stat_max_hp', value: 15, text: '+15 Max HP' }],
    },
  },
  {
    id: 'support',
    name: 'Support',
    bonuses: {
      2: [{ trigger: 'passive_stat', stat: 'stat_harvesting', value: 5, text: '+5 Harvesting' }],
      3: [{ trigger: 'passive_stat', stat: 'stat_harvesting', value: 10, text: '+10 Harvesting' }],
      4: [{ trigger: 'passive_stat', stat: 'stat_harvesting', value: 15, text: '+15 Harvesting' }],
      5: [{ trigger: 'passive_stat', stat: 'stat_harvesting', value: 20, text: '+20 Harvesting' }],
      6: [{ trigger: 'passive_stat', stat: 'stat_harvesting', value: 25, text: '+25 Harvesting' }],
    },
  },
  {
    id: 'tool',
    name: 'Tool',
    bonuses: {
      2: [{ trigger: 'passive_stat', stat: 'stat_engineering', value: 1, text: '+1 Engineering' }],
      3: [{ trigger: 'passive_stat', stat: 'stat_engineering', value: 2, text: '+2 Engineering' }],
      4: [{ trigger: 'passive_stat', stat: 'stat_engineering', value: 3, text: '+3 Engineering' }],
      5: [{ trigger: 'passive_stat', stat: 'stat_engineering', value: 4, text: '+4 Engineering' }],
      6: [{ trigger: 'passive_stat', stat: 'stat_engineering', value: 5, text: '+5 Engineering' }],
    },
  },
  {
    id: 'unarmed',
    name: 'Unarmed',
    bonuses: {
      2: [{ trigger: 'passive_stat', stat: 'stat_dodge', value: 3, text: '+3% Dodge' }],
      3: [{ trigger: 'passive_stat', stat: 'stat_dodge', value: 6, text: '+6% Dodge' }],
      4: [{ trigger: 'passive_stat', stat: 'stat_dodge', value: 9, text: '+9% Dodge' }],
      5: [{ trigger: 'passive_stat', stat: 'stat_dodge', value: 12, text: '+12% Dodge' }],
      6: [{ trigger: 'passive_stat', stat: 'stat_dodge', value: 15, text: '+15% Dodge' }],
    },
  },
];

export const SETS_BY_ID: Readonly<Record<WeaponSetId, SetDef>> = Object.fromEntries(
  SETS.map((s) => [s.id, s]),
) as Readonly<Record<WeaponSetId, SetDef>>;
