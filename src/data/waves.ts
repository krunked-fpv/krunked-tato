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
      g('chaser', 3, 4, 3.2, 1, 23),
      g('baby_alien', 4, 5, 5, 9, 23),
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
      g('chaser', 3, 4, 6.5, 10, 28),
      g('charger', 2, 2, 4.5, 15, 28, { minDanger: 1 }),
      g('fly', 1, 1, 5, 10, 28, { minDanger: 2 }),
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
      g('spitter', 2, 2, 7, 22, 33),
      g('fly', 2, 2, 4, 15, 33, { minDanger: 1 }),
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
      g('baby_alien', 7, 8, 4, 1, 38),
      g('chaser', 3, 4, 5, 3, 38),
      g('spitter', 1, 2, 6, 20, 38),
      g('charger', 2, 2, 4.5, 15, 38, { minDanger: 1 }),
      g('healer', 1, 1, 8, 15, 38, { minDanger: 4 }),
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
      g('chaser', 3, 4, 3.5, 3, 43),
      g('baby_alien', 5, 6, 5, 22, 43),
      g('fly', 2, 3, 5, 15, 43, { minDanger: 1 }),
      g('spawner', 1, 1, 10, 12, 43, { minDanger: 5 }),
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
      g('baby_alien', 6, 7, 2.5, 1, 48),
      g('charger', 5, 6, 5, 10, 48),
      g('spitter', 2, 3, 5, 25, 48),
      g('healer', 1, 1, 14, 4, 48, { minDanger: 1 }),
      g('fly', 2, 3, 7, 18, 48, { minDanger: 4 }),
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
      g('bruiser', 2, 3, 8, 1, 53),
      g('spitter', 1, 2, 3.5, 2, 53),
      g('baby_alien', 3, 4, 5.5, 5, 53),
      g('bruiser', 1, 2, 7, 28, 53, { minDanger: 1 }),
      g('charger', 2, 3, 6, 18, 53, { minDanger: 3 }),
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
      g('chaser', 6, 7, 2.4, 1, 58),
      g('charger', 2, 3, 3.5, 10, 58),
      g('bruiser', 2, 3, 8, 22, 58),
      g('fly', 2, 3, 5, 4, 58, { minDanger: 1 }),
      g('spawner', 1, 2, 10, 6, 58, { minDanger: 5 }),
      g('chaser', 5, 7, 3, 8, 56, { hordeOnly: true }),
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
      g('baby_alien', 8, 9, 2.5, 1, 58),
      g('bruiser', 2, 3, 8, 5, 58),
      g('charger', 2, 3, 5, 20, 58),
      g('chaser', 4, 5, 3.5, 28, 58),
      g('spitter', 2, 3, 7, 16, 58, { minDanger: 1 }),
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
      g('baby_alien', 4, 5, 4.5, 2, 58),
      g('charger', 3, 4, 3.5, 5, 58),
      g('spitter', 2, 3, 4, 20, 58),
      g('fly', 3, 4, 8, 12, 58, { minDanger: 1 }),
      g('bruiser', 2, 3, 9, 10, 58, { hordeOnly: true }),
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
      g('chaser', 8, 10, 2.6, 1, 58),
      g('bruiser', 2, 2, 5.5, 14, 58),
      g('charger', 2, 3, 3.5, 24, 58),
      g('baby_alien', 3, 4, 3.5, 24, 58),
      g('healer', 1, 1, 10, 4, 58, { minDanger: 1 }),
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
      g('baby_alien', 6, 8, 3.5, 1, 58),
      g('spitter', 2, 3, 6.5, 4, 58),
      g('fly', 3, 4, 5, 8, 58),
      g('bruiser', 2, 3, 5.5, 26, 58),
      g('buffer', 1, 1, 10, 12, 58, { minDanger: 2 }),
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
      g('baby_alien', 6, 7, 4, 3, 58),
      g('charger', 3, 4, 5, 16, 58),
      g('bruiser', 2, 2, 9, 34, 58),
      g('healer', 1, 1, 8, 5, 58, { minDanger: 1 }),
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
      g('baby_alien', 7, 8, 4.5, 1, 58),
      g('spawner', 1, 2, 7.5, 2, 56),
      g('spitter', 2, 3, 3.8, 8, 58),
      g('fly', 2, 3, 5, 18, 58),
      g('buffer', 1, 2, 9, 12, 58, { minDanger: 2 }),
      g('charger', 4, 5, 4, 10, 56, { hordeOnly: true }),
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
      g('buffer', 2, 2, 6, 1, 56),
      g('baby_alien', 6, 8, 4, 2, 58),
      g('chaser', 5, 6, 3.5, 16, 58),
      g('bruiser', 2, 2, 4.5, 28, 58),
      g('healer', 1, 1, 6, 18, 58, { minDanger: 1 }),
      g('fly', 3, 4, 6.5, 12, 58, { minDanger: 3 }),
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
      g('charger', 3, 4, 3.2, 1, 58),
      g('buffer', 1, 2, 9, 4, 56),
      g('spawner', 1, 2, 8, 7, 56),
      g('spitter', 3, 4, 4.5, 15, 58),
      g('fly', 4, 5, 5, 26, 58),
      g('baby_alien', 5, 6, 4, 36, 58),
      g('bruiser', 2, 3, 5, 12, 56, { hordeOnly: true }),
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
      g('charger', 5, 6, 3.2, 1, 58),
      g('buffer', 1, 2, 7, 2, 56),
      g('spitter', 2, 3, 3.5, 16, 58),
      g('spawner', 2, 2, 6, 22, 56),
      g('bruiser', 2, 3, 5.5, 28, 58),
      g('healer', 1, 2, 6.5, 4, 58, { minDanger: 1 }),
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
      g('baby_alien', 6, 7, 2.2, 1, 58),
      g('chaser', 4, 5, 2.5, 4, 58),
      g('buffer', 1, 2, 5, 10, 56),
      g('bruiser', 2, 3, 5, 15, 58),
      g('charger', 3, 4, 4.5, 26, 58),
      g('healer', 1, 1, 8, 6, 58, { minDanger: 1 }),
      g('fly', 4, 5, 6, 10, 58, { minDanger: 1 }),
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
      g('baby_alien', 5, 5, 3.5, 2, 86),
      g('chaser', 4, 5, 4, 12, 86),
      g('charger', 3, 4, 5, 20, 86),
      g('bruiser', 1, 2, 6.5, 24, 86),
      g('spawner', 1, 1, 8, 32, 86),
      g('buffer', 1, 1, 8, 32, 86),
      g('spitter', 2, 3, 6, 40, 86, { minDanger: 2 }),
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

  return {
    wave,
    durationSec: isBossWave ? 90 : 60,
    isHordePossible,
    isElitePossible,
    isBossWave,
    groups: [
      g('baby_alien', 5 + densityBoost, 7 + densityBoost, Math.max(1.6, 2.6 * intervalScale), 1, 58),
      g('chaser', 4 + densityBoost, 6 + densityBoost, Math.max(1.8, 3.0 * intervalScale), 4, 58),
      g('charger', 3 + Math.floor(densityBoost / 2), 4 + densityBoost, Math.max(2.2, 4.0 * intervalScale), 8, 58),
      g('spitter', 2 + Math.floor(densityBoost / 2), 3 + Math.floor(densityBoost / 2), Math.max(2.6, 4.5 * intervalScale), 10, 58),
      g('bruiser', 2 + Math.floor(densityBoost / 2), 3 + Math.floor(densityBoost / 2), Math.max(3.2, 5.5 * intervalScale), 14, 58),
      g('fly', 3, 4 + Math.floor(densityBoost / 2), Math.max(2.8, 5.0 * intervalScale), 18, 58),
      g('spawner', 1, 2, Math.max(4.5, 7.5 * intervalScale), 12, 54),
      g('buffer', 1, 2, Math.max(4.5, 7.0 * intervalScale), 16, 54),
      g('healer', 1, 2, Math.max(5.0, 8.0 * intervalScale), 20, 54),
    ],
  };
}

export function getWaveDef(wave: number): WaveDef {
  if (wave >= 1 && wave <= WAVES.length) {
    return WAVES[wave - 1];
  }
  return createEndlessWaveDef(Math.max(21, wave));
}
