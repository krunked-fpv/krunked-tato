import type { CoreStatKey, UpgradeDef } from '../contracts/index.ts';

interface UpgradeSpec {
  statKey: CoreStatKey;
  label: string;
  values: readonly [number, number, number, number];
}

const UPGRADE_SPECS: readonly UpgradeSpec[] = [
  { statKey: 'stat_max_hp', label: 'Max HP', values: [3, 6, 9, 12] },
  { statKey: 'stat_hp_regen', label: 'HP Regen', values: [2, 3, 4, 5] },
  { statKey: 'stat_lifesteal', label: 'Life Steal', values: [1, 2, 3, 4] },
  { statKey: 'stat_percent_damage', label: '% Damage', values: [5, 8, 12, 16] },
  { statKey: 'stat_melee_damage', label: 'Melee Damage', values: [2, 4, 6, 8] },
  { statKey: 'stat_ranged_damage', label: 'Ranged Damage', values: [1, 2, 3, 4] },
  { statKey: 'stat_elemental_damage', label: 'Elemental Damage', values: [1, 2, 3, 4] },
  { statKey: 'stat_attack_speed', label: '% Attack Speed', values: [5, 10, 15, 20] },
  { statKey: 'stat_crit_chance', label: '% Crit Chance', values: [3, 5, 7, 9] },
  { statKey: 'stat_engineering', label: 'Engineering', values: [2, 3, 4, 5] },
  { statKey: 'stat_range', label: 'Range', values: [15, 30, 45, 60] },
  { statKey: 'stat_armor', label: 'Armor', values: [1, 2, 3, 4] },
  { statKey: 'stat_dodge', label: '% Dodge', values: [3, 6, 9, 12] },
  { statKey: 'stat_speed', label: '% Speed', values: [3, 6, 9, 12] },
  { statKey: 'stat_luck', label: 'Luck', values: [5, 10, 15, 20] },
  { statKey: 'stat_harvesting', label: 'Harvesting', values: [5, 8, 10, 12] },
];

const TIER_PREFIXES: readonly [string, string, string, string] = [
  'Minor',
  'Enhanced',
  'Superior',
  'Apex',
];

export const UPGRADES: readonly UpgradeDef[] = UPGRADE_SPECS.flatMap((spec) =>
  ([0, 1, 2, 3] as const).map((tier): UpgradeDef => ({
    id: `upgrade_${spec.statKey}_${tier + 1}`,
    statKey: spec.statKey,
    name: `${TIER_PREFIXES[tier]} ${spec.label}`,
    tier,
    value: spec.values[tier],
    iconId: `upgrade_${spec.statKey}`,
  })),
);

export const UPGRADES_BY_ID: Readonly<Record<string, UpgradeDef>> = Object.fromEntries(
  UPGRADES.map((u) => [u.id, u]),
);
