import { WAVE_DURATIONS_SEC, type WaveDef, type WaveGroupDef } from '../contracts/index.ts';

function g(
  enemyId: string,
  minCount: number,
  maxCount: number,
  intervalSec: number,
  startSec: number,
  endSec: number,
  opts?: { minDanger?: number; hordeOnly?: boolean },
): WaveGroupDef {
  return {
    enemyId,
    minCount,
    maxCount,
    intervalSec,
    startSec,
    endSec,
    ...(opts?.minDanger !== undefined ? { minDanger: opts.minDanger } : {}),
    ...(opts?.hordeOnly ? { hordeOnly: true } : {}),
  };
}

export const WAVES: readonly WaveDef[] = [
  // Wave 1 (20s)
  {
    wave: 1,
    durationSec: WAVE_DURATIONS_SEC[0],
    isHordePossible: false,
    isElitePossible: false,
    isBossWave: false,
    groups: [
      g('baby_alien', 4, 5, 3, 1, 18),
    ],
  },
  // Wave 2 (25s)
  {
    wave: 2,
    durationSec: WAVE_DURATIONS_SEC[1],
    isHordePossible: false,
    isElitePossible: false,
    isBossWave: false,
    groups: [
      g('chaser', 3, 4, 3, 1, 23),
      g('baby_alien', 4, 5, 5, 10, 23),
    ],
  },
  // Wave 3 (30s)
  {
    wave: 3,
    durationSec: WAVE_DURATIONS_SEC[2],
    isHordePossible: false,
    isElitePossible: false,
    isBossWave: false,
    groups: [
      g('baby_alien', 5, 6, 3, 1, 28),
      g('chaser', 3, 4, 7, 10, 28),
      g('charger', 2, 2, 5, 15, 28, { minDanger: 1 }),
      g('fly', 1, 1, 5.5, 10, 28, { minDanger: 2 }),
      g('charger', 2, 2, 5, 10, 28, { minDanger: 5 }),
    ],
  },
  // Wave 4 (35s)
  {
    wave: 4,
    durationSec: WAVE_DURATIONS_SEC[3],
    isHordePossible: false,
    isElitePossible: false,
    isBossWave: false,
    groups: [
      g('spitter', 2, 2, 5, 1, 33),
      g('baby_alien', 6, 7, 3, 4, 33),
      g('spitter', 2, 2, 7, 25, 33),
      g('fly', 2, 2, 4.5, 15, 33, { minDanger: 1 }),
      g('helmet_alien', 2, 2, 5, 3, 33, { minDanger: 5 }),
      g('horned_fly', 2, 2, 5, 15, 33, { minDanger: 6 }),
    ],
  },
  // Wave 5 (40s)
  {
    wave: 5,
    durationSec: WAVE_DURATIONS_SEC[4],
    isHordePossible: false,
    isElitePossible: false,
    isBossWave: false,
    groups: [
      g('baby_alien', 8, 8, 4, 1, 38),
      g('chaser', 3, 4, 5, 3, 38),
      g('spitter', 1, 2, 6, 25, 38),
      g('charger', 2, 2, 4, 15, 38, { minDanger: 1 }),
      g('chaser', 1, 2, 8, 7, 38, { minDanger: 2 }),
      g('horned_charger', 1, 1, 8, 15, 38, { minDanger: 4 }),
      g('healer', 1, 1, 8, 15, 38, { minDanger: 6 }),
    ],
  },
  // Wave 6 (45s)
  {
    wave: 6,
    durationSec: WAVE_DURATIONS_SEC[5],
    isHordePossible: false,
    isElitePossible: false,
    isBossWave: false,
    groups: [
      g('charger', 4, 5, 5, 1, 43),
      g('chaser', 3, 4, 3, 3, 43),
      g('baby_alien', 5, 6, 5, 25, 43),
      g('fly', 2, 3, 5, 15, 43, { minDanger: 1 }),
      g('horned_charger', 1, 1, 8, 10, 43, { minDanger: 5 }),
      g('slasher_egg', 2, 3, 18, 1, 26, { minDanger: 6 }),
      g('spawner', 1, 1, 10, 10, 43, { minDanger: 6 }),
    ],
  },
  // Wave 7 (50s)
  {
    wave: 7,
    durationSec: WAVE_DURATIONS_SEC[6],
    isHordePossible: false,
    isElitePossible: false,
    isBossWave: false,
    groups: [
      g('baby_alien', 6, 7, 2.2, 1, 48),
      g('charger', 5, 6, 5, 10, 48),
      g('spitter', 2, 3, 5, 30, 48),
      g('healer', 1, 1, 15, 2, 48, { minDanger: 1 }),
      g('slasher_egg', 1, 2, 10, 3, 46, { minDanger: 5 }),
      g('horned_charger', 3, 3, 10, 10, 48, { minDanger: 6 }),
      g('horned_spitter', 1, 1, 18, 20, 48, { minDanger: 6 }),
    ],
  },
  // Wave 8 (55s)
  {
    wave: 8,
    durationSec: WAVE_DURATIONS_SEC[7],
    isHordePossible: false,
    isElitePossible: false,
    isBossWave: false,
    groups: [
      g('bruiser', 3, 3, 8, 1, 53),
      g('spitter', 1, 2, 3.2, 2, 53),
      g('baby_alien', 3, 4, 6, 5, 53),
      g('horned_bruiser', 1, 1, 10, 30, 53, { minDanger: 1 }),
      g('horned_bruiser', 1, 1, 8, 15, 53, { minDanger: 3 }),
      g('horned_bruiser', 1, 1, 5, 40, 53, { minDanger: 6 }),
    ],
  },
  // Wave 9 (60s — Swarm / Horde candidate)
  {
    wave: 9,
    durationSec: WAVE_DURATIONS_SEC[8],
    isHordePossible: true,
    isElitePossible: false,
    isBossWave: false,
    groups: [
      g('chaser', 6, 7, 2.2, 1, 58),
      g('charger', 2, 3, 3.2, 10, 58),
      g('bruiser', 2, 3, 8, 22, 58),
      g('fin_alien', 2, 3, 5, 3, 58, { minDanger: 1 }),
      g('fin_alien', 3, 4, 5, 3, 58, { minDanger: 4 }),
      g('spawner', 1, 2, 10, 3, 56, { minDanger: 6 }),
      g('chaser', 5, 7, 3, 8, 56, { hordeOnly: true }),
      g('dire_junkie', 2, 3, 6, 14, 56, { hordeOnly: true }),
    ],
  },
  // Wave 10 (60s)
  {
    wave: 10,
    durationSec: WAVE_DURATIONS_SEC[9],
    isHordePossible: false,
    isElitePossible: false,
    isBossWave: false,
    groups: [
      g('baby_alien', 8, 9, 2.2, 1, 58),
      g('bruiser', 2, 3, 8, 5, 58),
      g('charger', 2, 2, 5, 20, 58),
      g('chaser', 4, 5, 3, 30, 58),
      g('helmet_alien', 3, 4, 12, 20, 58, { minDanger: 1 }),
      g('chaser', 2, 2, 6, 20, 58, { minDanger: 2 }),
      g('bruiser', 2, 2, 4, 45, 58, { minDanger: 6 }),
    ],
  },
  // Wave 11 (60s — Primary Elite / Horde Wave)
  {
    wave: 11,
    durationSec: WAVE_DURATIONS_SEC[10],
    isHordePossible: true,
    isElitePossible: true,
    isBossWave: false,
    groups: [
      g('pursuer', 2, 3, 5, 1, 58),
      g('baby_alien', 3, 4, 6, 3, 58),
      g('charger', 3, 3, 3.2, 5, 58),
      g('spitter', 2, 3, 3.5, 25, 58),
      g('fly', 3, 4, 10, 12, 58, { minDanger: 1 }),
      g('lamprey', 2, 3, 9, 14, 58, { minDanger: 2 }),
      g('pursuer', 1, 1, 10, 3, 58, { minDanger: 5 }),
      g('horned_spitter', 1, 2, 8, 6, 58, { minDanger: 6 }),
      g('bruiser', 2, 3, 8, 10, 56, { hordeOnly: true }),
    ],
  },
  // Wave 12 (60s — Secondary Elite / Horde Wave)
  {
    wave: 12,
    durationSec: WAVE_DURATIONS_SEC[11],
    isHordePossible: true,
    isElitePossible: true,
    isBossWave: false,
    groups: [
      g('chaser', 8, 10, 2.4, 1, 24),
      g('pursuer', 1, 1, 5, 5, 58),
      g('bruiser', 2, 2, 5, 15, 58),
      g('charger', 2, 3, 3.2, 25, 58),
      g('baby_alien', 3, 4, 3.2, 25, 58),
      g('healer', 1, 1, 10, 3, 58, { minDanger: 1 }),
      g('evil_mob', 1, 1, 22, 20, 48, { minDanger: 2 }),
      g('tentacle', 2, 3, 12, 15, 58, { minDanger: 6 }),
      g('chaser', 6, 8, 3.2, 10, 56, { hordeOnly: true }),
    ],
  },
  // Wave 13 (60s)
  {
    wave: 13,
    durationSec: WAVE_DURATIONS_SEC[12],
    isHordePossible: false,
    isElitePossible: false,
    isBossWave: false,
    groups: [
      g('helmet_alien', 7, 8, 4, 1, 58),
      g('spitter', 2, 3, 8, 4, 58),
      g('baby_alien', 4, 5, 5, 8, 58),
      g('bruiser', 1, 2, 5.5, 30, 58),
      g('horned_bruiser', 1, 1, 6, 30, 58),
      g('fly', 3, 4, 5, 8, 58, { minDanger: 1 }),
      g('lamprey', 2, 3, 8.5, 18, 58, { minDanger: 2 }),
      g('tentacle', 2, 2, 8, 8, 58, { minDanger: 3 }),
    ],
  },
  // Wave 14 (60s — Primary Elite / Horde Wave)
  {
    wave: 14,
    durationSec: WAVE_DURATIONS_SEC[13],
    isHordePossible: true,
    isElitePossible: true,
    isBossWave: false,
    groups: [
      g('spawner', 2, 2, 8, 1, 56),
      g('helmet_alien', 6, 6, 5, 2, 58),
      g('baby_alien', 6, 6, 5, 15, 58),
      g('junkie', 1, 2, 6, 22, 58),
      g('bruiser', 2, 2, 10, 40, 58),
      g('healer', 1, 1, 8, 5, 58, { minDanger: 1 }),
      g('dire_junkie', 2, 3, 8, 18, 58, { minDanger: 2 }),
      g('slasher', 1, 1, 12, 16, 56, { minDanger: 3 }),
      g('spawner', 1, 2, 8, 8, 56, { minDanger: 4 }),
      g('bloated_spawner', 1, 2, 10, 8, 56, { minDanger: 6 }),
      g('fly', 3, 4, 4.5, 10, 56, { hordeOnly: true }),
    ],
  },
  // Wave 15 (60s — Secondary Elite / Horde Wave)
  {
    wave: 15,
    durationSec: WAVE_DURATIONS_SEC[14],
    isHordePossible: true,
    isElitePossible: true,
    isBossWave: false,
    groups: [
      g('baby_alien', 7, 8, 5, 1, 58),
      g('spawner', 1, 2, 7.5, 1, 56),
      g('helmet_alien', 6, 6, 3.2, 2, 58),
      g('spitter', 2, 2, 3.2, 8, 58),
      g('fin_alien', 1, 2, 5, 20, 58),
      g('junkie', 1, 1, 6, 35, 58),
      g('tentacle', 1, 2, 15, 10, 58, { minDanger: 1 }),
      g('dire_junkie', 2, 3, 8, 14, 58, { minDanger: 3 }),
      g('slasher_egg', 1, 1, 12, 5, 54, { minDanger: 4 }),
      g('bloated_spawner', 1, 2, 7, 2, 56, { minDanger: 6 }),
      g('infected_slasher_egg', 1, 2, 12, 5, 54, { minDanger: 6 }),
      g('horned_charger', 3, 4, 4.2, 10, 56, { hordeOnly: true }),
    ],
  },
  // Wave 16 (60s)
  {
    wave: 16,
    durationSec: WAVE_DURATIONS_SEC[15],
    isHordePossible: false,
    isElitePossible: false,
    isBossWave: false,
    groups: [
      g('buffer', 2, 2, 5, 1, 56),
      g('helmet_alien', 8, 10, 4.5, 1, 58),
      g('baby_alien', 5, 5, 5, 5, 58),
      g('fin_alien', 3, 3, 3.2, 20, 58),
      g('horned_bruiser', 1, 1, 4.2, 32, 58),
      g('bruiser', 1, 1, 4.2, 32, 58),
      g('healer', 1, 1, 5.5, 20, 58, { minDanger: 1 }),
      g('lamprey', 2, 3, 7.5, 14, 58, { minDanger: 3 }),
      g('evil_mob', 1, 2, 18, 22, 52, { minDanger: 3 }),
      g('horned_fly', 3, 4, 7, 15, 58, { minDanger: 6 }),
      g('corrupted_buffer', 2, 3, 14, 10, 56, { minDanger: 6 }),
    ],
  },
  // Wave 17 (60s — Primary Elite / Horde Wave)
  {
    wave: 17,
    durationSec: WAVE_DURATIONS_SEC[16],
    isHordePossible: true,
    isElitePossible: true,
    isBossWave: false,
    groups: [
      g('pursuer', 3, 4, 3.2, 1, 58),
      g('buffer', 1, 1, 10, 4, 56),
      g('spawner', 1, 2, 8, 7, 56),
      g('helmet_alien', 3, 4, 5, 15, 58),
      g('fin_alien', 4, 5, 5, 30, 58),
      g('baby_alien', 4, 4, 5, 40, 58),
      g('tentacle', 1, 1, 5.5, 15, 58, { minDanger: 1 }),
      g('slasher', 1, 2, 9.5, 12, 58, { minDanger: 3 }),
      g('bloated_spawner', 1, 1, 15, 5, 56, { minDanger: 6 }),
      g('corrupted_buffer', 1, 1, 10, 4, 56, { minDanger: 6 }),
      g('horned_bruiser', 2, 3, 5.5, 12, 56, { hordeOnly: true }),
    ],
  },
  // Wave 18 (60s — Secondary Elite / Horde Wave)
  {
    wave: 18,
    durationSec: WAVE_DURATIONS_SEC[17],
    isHordePossible: true,
    isElitePossible: true,
    isBossWave: false,
    groups: [
      g('horned_charger', 5, 6, 3.2, 1, 58),
      g('buffer', 1, 1, 6, 1, 56),
      g('helmet_alien', 2, 3, 5, 4, 58),
      g('spitter', 2, 2, 3.2, 20, 58),
      g('spawner', 2, 2, 4.5, 24, 56),
      g('healer', 1, 2, 6, 1, 56, { minDanger: 1 }),
      g('dire_junkie', 3, 4, 7, 10, 58, { minDanger: 3 }),
      g('slasher_egg', 2, 3, 6.5, 36, 54, { minDanger: 4 }),
      g('bloated_spawner', 1, 1, 15, 5, 56, { minDanger: 6 }),
      g('corrupted_buffer', 2, 3, 8, 10, 56, { minDanger: 6 }),
      g('infected_slasher_egg', 2, 3, 7, 14, 54, { minDanger: 6 }),
      g('chaser', 6, 8, 3, 8, 56, { hordeOnly: true }),
    ],
  },
  // Wave 19 (60s — Pre-Boss Climax)
  {
    wave: 19,
    durationSec: WAVE_DURATIONS_SEC[18],
    isHordePossible: true,
    isElitePossible: false,
    isBossWave: false,
    groups: [
      g('baby_alien', 6, 6, 1.8, 1, 58),
      g('helmet_alien', 3, 3, 2.2, 4, 58),
      g('buffer', 1, 1, 4, 10, 56),
      g('horned_bruiser', 2, 2, 5, 15, 58),
      g('pursuer', 1, 2, 5, 25, 58),
      g('horned_charger', 3, 3, 5, 30, 58),
      g('healer', 1, 1, 8, 5, 58, { minDanger: 1 }),
      g('tentacle', 2, 3, 8, 5, 58, { minDanger: 1 }),
      g('fin_alien', 4, 5, 8, 8, 58, { minDanger: 1 }),
      g('lamprey', 2, 3, 7, 16, 58, { minDanger: 2 }),
      g('evil_mob', 1, 2, 16, 18, 52, { minDanger: 4 }),
      g('mad_slasher', 1, 1, 14, 24, 56, { minDanger: 5 }),
      g('slasher_egg', 2, 3, 12, 1, 36, { minDanger: 6 }),
      g('corrupted_buffer', 2, 3, 12, 10, 56, { minDanger: 6 }),
    ],
  },
  // Wave 20 (90s — Boss Wave: Predator / Invoker)
  {
    wave: 20,
    durationSec: WAVE_DURATIONS_SEC[19],
    isHordePossible: false,
    isElitePossible: false,
    isBossWave: true,
    groups: [
      g('baby_alien', 5, 5, 3.2, 1, 22),
      g('helmet_alien', 5, 5, 3.2, 10, 32),
      g('fin_alien', 4, 5, 3.5, 20, 44),
      g('horned_bruiser', 1, 1, 5, 20, 86),
      g('spawner', 1, 1, 7, 30, 86),
      g('buffer', 1, 1, 7, 30, 86),
      g('helmet_alien', 3, 3, 6, 30, 86),
      g('horned_spitter', 2, 3, 6.5, 40, 86, { minDanger: 2 }),
      g('bloated_spawner', 1, 1, 15, 5, 84, { minDanger: 6 }),
      g('mad_slasher', 1, 1, 12, 58, 86, { minDanger: 6 }),
    ],
  },
];

export function createEndlessWaveDef(wave: number): WaveDef {
  const endlessDepth = Math.max(1, wave - 20);
  const densityBoost = Math.min(4, Math.floor(endlessDepth / 3));
  const intervalScale = Math.max(0.55, 1 - endlessDepth * 0.025);
  const isBossWave = wave % 10 === 0;
  const isElitePossible = !isBossWave && endlessDepth % 3 === 0;
  const isHordePossible = !isBossWave && endlessDepth % 4 === 0;
  const durationSec = isBossWave ? 90 : 60;
  const endSec = durationSec - 2;
  const theme = endlessDepth % 4;

  const baseGroups: WaveGroupDef[] = [
    g('helmet_alien', 4 + densityBoost, 6 + densityBoost, Math.max(1.8, 2.8 * intervalScale), 1, endSec),
    g('fin_alien', 4 + densityBoost, 6 + densityBoost, Math.max(1.9, 3.2 * intervalScale), 4, endSec),
    g('horned_charger', 3 + Math.floor(densityBoost / 2), 4 + densityBoost, Math.max(2.2, 4.0 * intervalScale), 8, endSec),
    g('horned_spitter', 2 + Math.floor(densityBoost / 2), 3 + Math.floor(densityBoost / 2), Math.max(2.6, 4.6 * intervalScale), 10, endSec),
    g('horned_bruiser', 2 + Math.floor(densityBoost / 2), 3 + Math.floor(densityBoost / 2), Math.max(3.2, 5.4 * intervalScale), 14, endSec),
    g('bloated_spawner', 1, 2, Math.max(4.8, 8.0 * intervalScale), 12, endSec - 4),
    g('corrupted_buffer', 1, 2, Math.max(4.8, 7.5 * intervalScale), 16, endSec - 4),
    g('healer', 1, 2, Math.max(5.0, 8.0 * intervalScale), 20, endSec - 4),
  ];

  if (theme === 0) {
    baseGroups.push(
      g('slasher', 2, 3, Math.max(3.5, 6.0 * intervalScale), 6, endSec),
      g('mad_slasher', 1, 2, Math.max(5.5, 9.0 * intervalScale), 18, endSec),
      g('infected_slasher_egg', 2, 3, Math.max(5.0, 8.5 * intervalScale), 10, endSec - 6),
    );
  } else if (theme === 1) {
    baseGroups.push(
      g('lamprey', 3, 4 + Math.floor(densityBoost / 2), Math.max(2.8, 4.8 * intervalScale), 6, endSec),
      g('pursuer', 2, 3 + Math.floor(densityBoost / 2), Math.max(3.0, 5.2 * intervalScale), 12, endSec),
      g('tentacle', 2, 3, Math.max(4.2, 7.0 * intervalScale), 16, endSec),
    );
  } else if (theme === 2) {
    baseGroups.push(
      g('horned_fly', 3, 5, Math.max(2.6, 4.5 * intervalScale), 6, endSec),
      g('dire_junkie', 4, 6, Math.max(2.4, 4.0 * intervalScale), 10, endSec),
      g('evil_mob', 1, 2, Math.max(7.0, 12.0 * intervalScale), 16, endSec - 4),
    );
  } else {
    baseGroups.push(
      g('slasher_egg', 2, 3, Math.max(5.0, 8.0 * intervalScale), 6, endSec - 6),
      g('mad_slasher', 1, 2, Math.max(5.0, 8.5 * intervalScale), 14, endSec),
      g('tentacle', 2, 3, Math.max(4.0, 6.8 * intervalScale), 12, endSec),
      g('pursuer', 2, 4, Math.max(3.0, 5.0 * intervalScale), 20, endSec),
    );
  }

  return {
    wave,
    durationSec,
    isHordePossible,
    isElitePossible,
    isBossWave,
    groups: baseGroups,
  };
}

export function getWaveDef(wave: number): WaveDef {
  if (wave >= 1 && wave <= WAVES.length) {
    return WAVES[wave - 1];
  }
  return createEndlessWaveDef(Math.max(21, wave));
}
