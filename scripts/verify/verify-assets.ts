// ============================================================================
// scripts/verify/verify-assets.ts — Gate A Empirical Verification Suite
// Verifies Built-In catalog parity, referential integrity, SPEC.md formula
// oracles, optional local .krunkedtato-assets oracle/manifest cross-checks,
// Brand/IP firewall hygiene, git/dist cleanliness, and TouchOverlay policy.
// ============================================================================

import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import {
  ALL_WEAPON_SET_IDS,
  CORE_STAT_KEYS,
  MAX_ENEMIES,
  MAX_GOLDS,
  NB_SHOP_ITEMS,
  WAVE_DURATIONS_SEC,
} from '../../src/contracts/index.ts';
import { AssetRegistry } from '../../src/assets/AssetRegistry.ts';
import { GAME_CATALOG } from '../../src/data/index.ts';
import { TouchOverlay } from '../../src/input/TouchOverlay.ts';
import {
  computeArmorMultiplier,
  computeEffectiveCooldown,
  computeEffectiveRange,
  computeEndlessFactor,
  computeMoveSpeed,
  computeRegenIntervalTicks,
  createDefaultStatMap,
  getRarityTierRoll,
  getRecycleRefund,
  getRerollCost,
  getShopPrice,
  xpNeededForLevel,
} from '../../src/sim/index.ts';

interface Failure {
  section: string;
  message: string;
}

const failures: Failure[] = [];
let checksPassed = 0;

function check(section: string, condition: boolean, message: string): void {
  if (condition) {
    checksPassed += 1;
  } else {
    failures.push({ section, message });
  }
}

function approxEqual(a: number, b: number, eps = 1e-6): boolean {
  return Math.abs(a - b) <= eps;
}

// ----------------------------------------------------------------------------
// 1. Built-In Catalog Counts & Referential Integrity
// ----------------------------------------------------------------------------
function verifyCatalog(): void {
  const sec = 'Catalog';

  const meleeWeapons = GAME_CATALOG.weapons.filter((w) => w.kind === 'melee');
  const rangedWeapons = GAME_CATALOG.weapons.filter((w) => w.kind === 'ranged');
  const basicEnemies = GAME_CATALOG.enemies.filter((e) => e.kind === 'basic');
  const eliteEnemies = GAME_CATALOG.enemies.filter((e) => e.kind === 'elite');
  const bossEnemies = GAME_CATALOG.enemies.filter((e) => e.kind === 'boss');

  check(sec, GAME_CATALOG.characters.length === 60, `characters.length === 60 (got ${GAME_CATALOG.characters.length})`);
  check(sec, GAME_CATALOG.weapons.length === 80, `weapons.length === 80 (got ${GAME_CATALOG.weapons.length})`);
  check(sec, meleeWeapons.length === 45, `melee weapons === 45 (got ${meleeWeapons.length})`);
  check(sec, rangedWeapons.length === 35, `ranged weapons === 35 (got ${rangedWeapons.length})`);
  check(sec, GAME_CATALOG.sets.length === 17, `sets.length === 17 (got ${GAME_CATALOG.sets.length})`);
  check(sec, GAME_CATALOG.items.length >= 194, `items.length >= 194 (got ${GAME_CATALOG.items.length})`);
  check(sec, GAME_CATALOG.upgrades.length === 64, `upgrades.length === 64 (got ${GAME_CATALOG.upgrades.length})`);
  check(sec, GAME_CATALOG.enemies.length === 38, `enemies.length === 38 (got ${GAME_CATALOG.enemies.length})`);
  check(sec, basicEnemies.length === 28, `basic enemies === 28 (got ${basicEnemies.length})`);
  check(sec, eliteEnemies.length === 8, `elite enemies === 8 (got ${eliteEnemies.length})`);
  check(sec, bossEnemies.length === 2, `boss enemies === 2 (got ${bossEnemies.length})`);
  check(sec, GAME_CATALOG.waves.length === 20, `waves.length === 20 (got ${GAME_CATALOG.waves.length})`);
  check(sec, GAME_CATALOG.difficulties.length === 7, `difficulties.length === 7 (got ${GAME_CATALOG.difficulties.length})`);
  check(sec, GAME_CATALOG.zones.length === 3, `zones.length === 3 (got ${GAME_CATALOG.zones.length})`);
  check(sec, GAME_CATALOG.challenges.length >= 40, `challenges.length >= 40 (got ${GAME_CATALOG.challenges.length})`);

  // Duplicate ID checks across every catalog table
  const assertUnique = (label: string, ids: readonly (string | number)[]): void => {
    const seen = new Set<string | number>();
    const dupes: Array<string | number> = [];
    for (const id of ids) {
      if (seen.has(id)) dupes.push(id);
      seen.add(id);
    }
    check(sec, dupes.length === 0, `${label} has zero duplicate IDs (dupes: ${dupes.join(', ')})`);
  };

  assertUnique('characters', GAME_CATALOG.characters.map((c) => c.id));
  assertUnique('weapons', GAME_CATALOG.weapons.map((w) => w.id));
  assertUnique('sets', GAME_CATALOG.sets.map((s) => s.id));
  assertUnique('items', GAME_CATALOG.items.map((i) => i.id));
  assertUnique('upgrades', GAME_CATALOG.upgrades.map((u) => u.id));
  assertUnique('enemies', GAME_CATALOG.enemies.map((e) => e.id));
  assertUnique('waves', GAME_CATALOG.waves.map((w) => w.wave));
  assertUnique('difficulties', GAME_CATALOG.difficulties.map((d) => d.id));
  assertUnique('zones', GAME_CATALOG.zones.map((z) => z.id));
  assertUnique('challenges', GAME_CATALOG.challenges.map((c) => c.id));

  // All 17 weapon set IDs exist and define 2..6 bonuses
  for (const setId of ALL_WEAPON_SET_IDS) {
    const sDef = GAME_CATALOG.setsById[setId];
    check(sec, Boolean(sDef), `set '${setId}' exists in setsById`);
    if (sDef) {
      for (const count of [2, 3, 4, 5, 6]) {
        check(
          sec,
          Array.isArray(sDef.bonuses[count]) && sDef.bonuses[count].length > 0,
          `set '${setId}' defines bonus for count ${count}`,
        );
      }
    }
  }

  // All 16 core stats x 4 tiers present in upgrades
  for (const statKey of CORE_STAT_KEYS) {
    for (const tier of [0, 1, 2, 3] as const) {
      const found = GAME_CATALOG.upgrades.some((u) => u.statKey === statKey && u.tier === tier);
      check(sec, found, `upgrade exists for ${statKey} tier ${tier}`);
    }
  }

  // Referential integrity: characters
  const challengeIds = new Set(GAME_CATALOG.challenges.map((c) => c.id));
  for (const ch of GAME_CATALOG.characters) {
    for (const wId of ch.startingWeapons) {
      check(sec, Boolean(GAME_CATALOG.weaponsById[wId]), `character '${ch.id}' startingWeapon '${wId}' resolves`);
    }
    for (const iId of ch.startingItems) {
      check(sec, Boolean(GAME_CATALOG.itemsById[iId]), `character '${ch.id}' startingItem '${iId}' resolves`);
    }
    if (ch.unlockChallengeId) {
      check(
        sec,
        challengeIds.has(ch.unlockChallengeId),
        `character '${ch.id}' unlockChallengeId '${ch.unlockChallengeId}' resolves`,
      );
    }
  }

  // Referential integrity: weapons (sets & tiers minTier..4)
  for (const w of GAME_CATALOG.weapons) {
    check(sec, w.sets.length > 0, `weapon '${w.id}' belongs to at least 1 set`);
    for (const setId of w.sets) {
      check(sec, Boolean(GAME_CATALOG.setsById[setId]), `weapon '${w.id}' set '${setId}' resolves`);
    }
    check(
      sec,
      w.minTier >= 1 && w.minTier <= 4 && w.maxTier === 4 && w.minTier <= w.maxTier,
      `weapon '${w.id}' has valid minTier..4 range (${w.minTier}..${w.maxTier})`,
    );
    for (let t = w.minTier; t <= 4; t++) {
      const ts = w.tiers[t as 1 | 2 | 3 | 4];
      check(sec, Boolean(ts), `weapon '${w.id}' defines tier ${t}`);
      if (ts) {
        check(
          sec,
          ts.tier === t && ts.value > 0 && ts.cooldown > 0 && ts.damage > 0 && ts.maxRange > 0,
          `weapon '${w.id}' tier ${t} has valid positive value/cooldown/damage/maxRange`,
        );
      }
    }
  }

  // Referential integrity: waves -> enemies
  for (const wave of GAME_CATALOG.waves) {
    check(sec, wave.groups.length > 0, `wave ${wave.wave} has at least 1 spawn group`);
    for (const grp of wave.groups) {
      check(sec, Boolean(GAME_CATALOG.enemiesById[grp.enemyId]), `wave ${wave.wave} enemyId '${grp.enemyId}' resolves`);
      check(sec, grp.minCount >= 1 && grp.maxCount >= grp.minCount, `wave ${wave.wave} group '${grp.enemyId}' counts valid`);
    }
  }

  // Referential integrity: enemies bosses
  const predator = GAME_CATALOG.enemiesById['predator'];
  const invoker = GAME_CATALOG.enemiesById['invoker'];
  check(sec, predator?.kind === 'boss' && predator.knockbackResistance === 1, `boss 'predator' exists with knockbackResistance === 1`);
  check(sec, invoker?.kind === 'boss' && invoker.knockbackResistance === 1, `boss 'invoker' exists with knockbackResistance === 1`);

  // Referential integrity: challenges -> rewards
  for (const chal of GAME_CATALOG.challenges) {
    const resolved =
      chal.rewardType === 'character'
        ? Boolean(GAME_CATALOG.charactersById[chal.rewardId])
        : chal.rewardType === 'weapon'
          ? Boolean(GAME_CATALOG.weaponsById[chal.rewardId])
          : Boolean(GAME_CATALOG.itemsById[chal.rewardId]);
    check(sec, resolved, `challenge '${chal.id}' reward (${chal.rewardType}:${chal.rewardId}) resolves`);
  }

  // Headless Built-In AssetRegistry coverage for every catalog spriteId
  const registry = new AssetRegistry();
  registry.prepareCatalog(GAME_CATALOG);
  check(sec, registry.getMode() === 'BUILTIN', `AssetRegistry defaults to BUILTIN mode`);
  for (const ch of GAME_CATALOG.characters) {
    const r = registry.getRegion(ch.visual.spriteId);
    check(sec, r.w > 0 && r.h > 0 && r.u1 > r.u0 && r.v1 > r.v0, `Built-In atlas resolves '${ch.visual.spriteId}'`);
  }
  for (const w of GAME_CATALOG.weapons) {
    const r = registry.getRegion(w.spriteId);
    check(sec, r.w > 0 && r.h > 0 && r.u1 > r.u0 && r.v1 > r.v0, `Built-In atlas resolves '${w.spriteId}'`);
  }
  for (const e of GAME_CATALOG.enemies) {
    const r = registry.getRegion(e.spriteId);
    check(sec, r.w > 0 && r.h > 0 && r.u1 > r.u0 && r.v1 > r.v0, `Built-In atlas resolves '${e.spriteId}'`);
  }
  for (const it of GAME_CATALOG.items) {
    const r = registry.getRegion(it.spriteId);
    check(sec, r.w > 0 && r.h > 0 && r.u1 > r.u0 && r.v1 > r.v0, `Built-In atlas resolves '${it.spriteId}'`);
  }
}

// ----------------------------------------------------------------------------
// 2. SPEC.md Exact Formula Oracle Assertions
// ----------------------------------------------------------------------------
function verifyFormulaOracles(): void {
  const sec = 'Formulas';

  // Core cap constants
  check(sec, MAX_ENEMIES === 100, `MAX_ENEMIES === 100`);
  check(sec, MAX_GOLDS === 50, `MAX_GOLDS === 50`);
  check(sec, NB_SHOP_ITEMS === 4, `NB_SHOP_ITEMS === 4`);

  // Wave durations [20,25,30,35,40,45,50,55,60..60,90]
  const expectedDurations = [
    20, 25, 30, 35, 40, 45, 50, 55, 60, 60,
    60, 60, 60, 60, 60, 60, 60, 60, 60, 90,
  ];
  check(
    sec,
    WAVE_DURATIONS_SEC.length === 20 &&
      WAVE_DURATIONS_SEC.every((d, i) => d === expectedDurations[i]),
    `WAVE_DURATIONS_SEC matches [20,25,30,35,40,45,50,55,60..60,90]`,
  );
  for (let i = 0; i < 20; i++) {
    check(
      sec,
      GAME_CATALOG.waves[i]?.durationSec === expectedDurations[i],
      `WAVES[${i}].durationSec === ${expectedDurations[i]}`,
    );
  }

  // Armor mitigation
  check(sec, approxEqual(computeArmorMultiplier(0), 1.0), `armor=0 -> 1.0`);
  check(sec, approxEqual(computeArmorMultiplier(15), 0.5), `armor=15 -> 0.5`);
  check(sec, approxEqual(computeArmorMultiplier(-15), 1.5), `armor=-15 -> 1.5`);

  // Regen cadence
  check(sec, computeRegenIntervalTicks(0) === 0, `hp_regen=0 -> 0 ticks`);
  check(sec, computeRegenIntervalTicks(1) === 300, `hp_regen=1 -> 300 ticks (5.0s)`);
  check(sec, computeRegenIntervalTicks(10) === 60, `hp_regen=10 -> 60 ticks (1.0s)`);

  // XP curve: (level + 3)^2
  check(sec, xpNeededForLevel(0) === 9, `xpNeeded(0) === 9`);
  check(sec, xpNeededForLevel(1) === 16, `xpNeeded(1) === 16`);
  check(sec, xpNeededForLevel(2) === 25, `xpNeeded(2) === 25`);

  // Move speed, effective range, cooldown, endless factor
  const baseStats = createDefaultStatMap();
  check(sec, computeMoveSpeed(baseStats) === 450, `base move speed === 450`);
  check(sec, computeEffectiveRange(150, true, 100) === 200, `melee range adds stat_range/2`);
  check(sec, computeEffectiveRange(300, false, 100) === 400, `ranged range adds stat_range`);
  check(sec, computeEffectiveCooldown(60, 100, 0) === 30, `cooldown halves at +100% atkSpd`);
  check(sec, computeEffectiveCooldown(60, -50, 0) === 90, `cooldown increases by 1.5x at -50% atkSpd`);
  check(sec, computeEndlessFactor(20) === 0 && approxEqual(computeEndlessFactor(25), 0.15), `endlessFactor(20)=0, (25)=0.15`);

  // Shop price & reroll inflation
  const pW1 = getShopPrice(20, false, 1, false, baseStats); // round(20 + 1 + 20*1*0.1) = 23
  const pW10 = getShopPrice(20, false, 10, false, baseStats); // round(20 + 10 + 20*10*0.1) = 50
  const pW25 = getShopPrice(20, false, 25, true, baseStats); // round((20+25+50)*(1+0.15/5)) = round(95*1.03)=98
  check(sec, pW1 === 23, `getShopPrice(20, W1) === 23 (got ${pW1})`);
  check(sec, pW10 === 50, `getShopPrice(20, W10) === 50 (got ${pW10})`);
  check(sec, pW25 === 98, `getShopPrice(20, W25 Endless) === 98 (got ${pW25})`);

  const rW1C0 = getRerollCost(1, false, 0, baseStats); // floor(0.75) + 1 + 0 = 1
  const rW1C1 = getRerollCost(1, false, 1, baseStats); // 0 + 1 + 1 = 2
  const rW10C0 = getRerollCost(10, false, 0, baseStats); // floor(7.5)=7 + floor(4)=4 = 11
  const rW10C2 = getRerollCost(10, false, 2, baseStats); // 7 + 4 + 8 = 19
  check(sec, rW1C0 === 1 && rW1C1 === 2, `reroll W1 progression 1 -> 2 (got ${rW1C0} -> ${rW1C1})`);
  check(sec, rW10C0 === 11 && rW10C2 === 19, `reroll W10 progression 11 -> 19 (got ${rW10C0} -> ${rW10C2})`);
  check(sec, getRecycleRefund(40, baseStats) === 10, `recycle refund 25% of 40 === 10`);

  // Rarity tier caps: T1 0.60, T2 0.25, T3 0.08
  check(sec, getRarityTierRoll(1, 0, () => 0.0001) === 0, `Wave 1 rarity roll is always T0`);
  // On Wave 60 with luck=0, T3 hits its 0.08 cap, T2 hits 0.25 cap, T1 hits 0.60 cap
  check(sec, getRarityTierRoll(60, 0, () => 0.079) === 3, `T3 cap 0.08 accepts 0.079`);
  {
    let step = 0;
    const seq = [0.081, 0.249]; // miss T3 (>0.08), hit T2 (<0.25)
    check(sec, getRarityTierRoll(60, 0, () => seq[step++]) === 2, `T3 rejects 0.081, T2 cap 0.25 accepts 0.249`);
  }
  {
    let step = 0;
    const seq = [0.081, 0.251, 0.599]; // miss T3, miss T2, hit T1 (<0.60)
    check(sec, getRarityTierRoll(60, 0, () => seq[step++]) === 1, `T2 rejects 0.251, T1 cap 0.60 accepts 0.599`);
  }
  {
    let step = 0;
    const seq = [0.081, 0.251, 0.601]; // miss all -> T0
    check(sec, getRarityTierRoll(60, 0, () => seq[step++]) === 0, `T1 rejects 0.601 -> T0`);
  }

  // Danger 0..6 multipliers
  const d = GAME_CATALOG.difficulties;
  check(sec, d[0].enemyHpMult === 1.0 && d[0].enemyDamageMult === 1.0 && !d[0].doubleBoss, `D0 1.00x single boss`);
  check(sec, d[1].enemyHpMult === 1.0 && d[1].enemyDamageMult === 1.0, `D1 1.00x`);
  check(sec, d[2].enemyHpMult === 1.0 && d[2].elitesEnabled, `D2 1.00x elitesEnabled`);
  check(sec, approxEqual(d[3].enemyHpMult, 1.12) && approxEqual(d[3].enemyDamageMult, 1.12), `D3 1.12x`);
  check(sec, approxEqual(d[4].enemyHpMult, 1.26) && approxEqual(d[4].enemyDamageMult, 1.26) && d[4].extraElites, `D4 1.26x + extraElites`);
  check(sec, approxEqual(d[5].enemyHpMult, 1.4) && approxEqual(d[5].enemyDamageMult, 1.4) && d[5].doubleBoss && !d[5].nightmareEvents, `D5 1.40x + doubleBoss`);
  check(
    sec,
    approxEqual(d[6].enemyHpMult, 1.6) &&
      approxEqual(d[6].enemyDamageMult, 1.6) &&
      approxEqual(d[6].enemySpeedMult, 1.1) &&
      d[6].shopInflationBonus === 10 &&
      d[6].doubleBoss &&
      d[6].nightmareEvents,
    `D6 1.60x + 1.10x speed + 10% inflation + doubleBoss + nightmareEvents`,
  );
}

// ----------------------------------------------------------------------------
// 3. Optional Local Oracle & Custom-Pack Manifest Cross-Check
// ----------------------------------------------------------------------------
interface OracleFile {
  characters: Array<{ id: string }>;
  weapons: Array<{ id: string }>;
  enemies: Array<{ id: string }>;
  items: Array<{ id: string }>;
}

interface ManifestFile {
  textures: Record<string, string>;
  audio: Record<string, string>;
}

function verifyLocalOracleAndManifest(): { mode: 'local-oracle' | 'ci-mode'; textureCount: number } {
  const sec = 'LocalOracle';
  const assetsDir = process.env.KRUNKED_ASSETS_DIR
    ? path.resolve(process.env.KRUNKED_ASSETS_DIR)
    : path.resolve(process.cwd(), '.krunkedtato-assets');
  const oraclePath = path.join(assetsDir, 'oracle.json');
  const manifestPath = path.join(assetsDir, 'manifest.json');

  if (!fs.existsSync(oraclePath) || !fs.existsSync(manifestPath)) {
    console.log('[ci-mode] skipping local .krunkedtato-assets check');
    return { mode: 'ci-mode', textureCount: 0 };
  }

  const oracle = JSON.parse(fs.readFileSync(oraclePath, 'utf8')) as OracleFile;
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as ManifestFile;

  check(sec, oracle.characters.length === 60, `oracle.characters.length === 60 (got ${oracle.characters.length})`);
  check(sec, oracle.weapons.length === 80, `oracle.weapons.length === 80 (got ${oracle.weapons.length})`);
  check(sec, oracle.enemies.length === 38, `oracle.enemies.length === 38 (got ${oracle.enemies.length})`);
  check(sec, oracle.items.length >= 192, `oracle.items.length >= 192 (got ${oracle.items.length})`);

  const missingChars = oracle.characters.filter((c) => !GAME_CATALOG.charactersById[c.id]).map((c) => c.id);
  const missingWeapons = oracle.weapons.filter((w) => !GAME_CATALOG.weaponsById[w.id]).map((w) => w.id);
  const missingEnemies = oracle.enemies.filter((e) => !GAME_CATALOG.enemiesById[e.id]).map((e) => e.id);
  const missingItems = oracle.items.filter((i) => !GAME_CATALOG.itemsById[i.id]).map((i) => i.id);

  check(sec, missingChars.length === 0, `100% of oracle characters exist in GAME_CATALOG (missing: ${missingChars.join(', ')})`);
  check(sec, missingWeapons.length === 0, `100% of oracle weapons exist in GAME_CATALOG (missing: ${missingWeapons.join(', ')})`);
  check(sec, missingEnemies.length === 0, `100% of oracle enemies exist in GAME_CATALOG (missing: ${missingEnemies.join(', ')})`);
  check(sec, missingItems.length === 0, `100% of oracle base items exist in GAME_CATALOG (missing: ${missingItems.join(', ')})`);

  const textures = manifest.textures ?? {};
  const checkSpriteInManifest = (label: string, spriteId: string): void => {
    const rel = textures[spriteId];
    const existsOnDisk = typeof rel === 'string' && fs.existsSync(path.join(assetsDir, rel));
    check(sec, Boolean(rel) && existsOnDisk, `manifest resolves & has file for ${label} sprite '${spriteId}'`);
  };

  for (const ch of GAME_CATALOG.characters) checkSpriteInManifest(`char:${ch.id}`, ch.visual.spriteId);
  for (const w of GAME_CATALOG.weapons) checkSpriteInManifest(`weapon:${w.id}`, w.spriteId);
  for (const e of GAME_CATALOG.enemies) checkSpriteInManifest(`enemy:${e.id}`, e.spriteId);
  for (const it of GAME_CATALOG.items) checkSpriteInManifest(`item:${it.id}`, it.spriteId);
  for (const u of GAME_CATALOG.upgrades) checkSpriteInManifest(`upgrade:${u.id}`, u.iconId);

  return { mode: 'local-oracle', textureCount: Object.keys(textures).length };
}

// ----------------------------------------------------------------------------
// 4. Brand Firewall, Git Hygiene, Dist Cleanliness & Touch Policy
// ----------------------------------------------------------------------------
function collectFilesRecursive(targetPath: string): string[] {
  if (!fs.existsSync(targetPath)) return [];
  const stat = fs.statSync(targetPath);
  if (stat.isFile()) return [targetPath];
  const out: string[] = [];
  for (const entry of fs.readdirSync(targetPath, { withFileTypes: true })) {
    const full = path.join(targetPath, entry.name);
    if (entry.isDirectory()) {
      out.push(...collectFilesRecursive(full));
    } else if (entry.isFile()) {
      out.push(full);
    }
  }
  return out;
}

function verifyFirewallAndHygiene(): void {
  const sec = 'Hygiene';
  const root = process.cwd();

  // Brand firewall: scan user-facing & source dirs for zero case-insensitive "brotato" leaks
  const scanTargets = [
    'index.html',
    'README.md',
    'src/contracts/index.ts',
    'src/ui',
    'src/data',
    'src/app',
    'src/render',
    'src/audio',
    'src/input',
    'src/assets',
    'src/sim',
  ];
  const leaks: string[] = [];
  const forbiddenRe = /brotato/i;
  for (const relTarget of scanTargets) {
    const absTarget = path.resolve(root, relTarget);
    for (const filePath of collectFilesRecursive(absTarget)) {
      const content = fs.readFileSync(filePath, 'utf8');
      const lines = content.split(/\r?\n/);
      for (let i = 0; i < lines.length; i++) {
        if (forbiddenRe.test(lines[i])) {
          leaks.push(`${path.relative(root, filePath)}:${i + 1}`);
        }
      }
    }
  }
  check(sec, leaks.length === 0, `zero brand firewall leaks in src/index.html/README.md (leaks: ${leaks.join(', ')})`);

  // Git tracked files check: zero retail binaries or .krunkedtato-assets/
  const trackedRaw = execSync('git ls-files', { cwd: root, encoding: 'utf8' });
  const trackedFiles = trackedRaw.split(/\r?\n/).filter((l) => l.length > 0);
  const bannedExts = ['.pck', '.stex', '.webp', '.mp3str', '.sample', '.exe'];
  const badTracked = trackedFiles.filter((f) => {
    const lower = f.toLowerCase();
    if (lower.startsWith('.krunkedtato-assets/') || lower.includes('/.krunkedtato-assets/')) return true;
    return bannedExts.some((ext) => lower.endsWith(ext));
  });
  check(
    sec,
    badTracked.length === 0,
    `git ls-files contains zero copyrighted retail binaries (found: ${badTracked.join(', ')})`,
  );

  // dist/ cleanliness check (if built)
  const distDir = path.resolve(root, 'dist');
  if (fs.existsSync(distDir)) {
    const distFiles = collectFilesRecursive(distDir);
    const badDist = distFiles
      .map((f) => path.relative(root, f))
      .filter((f) => {
        const lower = f.toLowerCase();
        return ['.pck', '.stex', '.webp', '.mp3str', '.sample'].some((ext) => lower.endsWith(ext));
      });
    check(sec, badDist.length === 0, `dist/ contains zero retail assets (found: ${badDist.join(', ')})`);
  }

  // TouchOverlay strict hidden-on-desktop/gamepad policy check
  const overlay = new TouchOverlay(null, {
    onToggleAutoAim: () => {},
    onToggleStats: () => {},
    onPause: () => {},
    onTouchDetected: () => {},
  });
  const initStatus = overlay.getStatus();
  check(
    sec,
    initStatus.mode === 'keyboard' && !initStatus.visible && initStatus.opacity === 0,
    `TouchOverlay defaults to hidden in keyboard mode`,
  );
  overlay.setInputMode('gamepad');
  const gpStatus = overlay.getStatus();
  check(
    sec,
    gpStatus.mode === 'gamepad' && !gpStatus.visible && gpStatus.opacity === 0,
    `TouchOverlay remains hidden in gamepad mode`,
  );
  overlay.setInputMode('touch');
  const touchStatus = overlay.getStatus();
  check(
    sec,
    touchStatus.mode === 'touch' && touchStatus.visible && touchStatus.opacity > 0 && touchStatus.opacity < 0.6,
    `TouchOverlay reveals translucent overlay (0 < opacity < 0.6) in touch mode`,
  );
  overlay.setInputMode('keyboard');
  const backStatus = overlay.getStatus();
  check(
    sec,
    !backStatus.visible && backStatus.opacity === 0,
    `TouchOverlay immediately hides again on keyboard mode`,
  );
  overlay.dispose();
}

// ----------------------------------------------------------------------------
// Main Entrypoint
// ----------------------------------------------------------------------------
function main(): void {
  const t0 = Date.now();
  verifyCatalog();
  verifyFormulaOracles();
  const oracleInfo = verifyLocalOracleAndManifest();
  verifyFirewallAndHygiene();
  const elapsedMs = Date.now() - t0;

  if (failures.length > 0) {
    console.error(`[verify:assets] FAILED with ${failures.length} error(s) (${checksPassed} passed in ${elapsedMs}ms):`);
    for (const f of failures) {
      console.error(`  ✗ [${f.section}] ${f.message}`);
    }
    process.exit(1);
  }

  const meleeCount = GAME_CATALOG.weapons.filter((w) => w.kind === 'melee').length;
  const rangedCount = GAME_CATALOG.weapons.filter((w) => w.kind === 'ranged').length;
  const basicCount = GAME_CATALOG.enemies.filter((e) => e.kind === 'basic').length;
  const eliteCount = GAME_CATALOG.enemies.filter((e) => e.kind === 'elite').length;
  const bossCount = GAME_CATALOG.enemies.filter((e) => e.kind === 'boss').length;

  console.log(
    `[verify:assets] PASS (${checksPassed} assertions in ${elapsedMs}ms, mode=${oracleInfo.mode}${
      oracleInfo.mode === 'local-oracle' ? `, manifestTextures=${oracleInfo.textureCount}` : ''
    })`,
  );
  console.log(
    `  Catalog: ${GAME_CATALOG.characters.length} chars | ${GAME_CATALOG.weapons.length} weapons (${meleeCount}M/${rangedCount}R) | ${GAME_CATALOG.sets.length} sets | ${GAME_CATALOG.items.length} items | ${GAME_CATALOG.upgrades.length} upgrades | ${GAME_CATALOG.enemies.length} enemies (${basicCount}B/${eliteCount}E/${bossCount}Boss) | ${GAME_CATALOG.waves.length} waves | ${GAME_CATALOG.difficulties.length} difficulties | ${GAME_CATALOG.zones.length} zones | ${GAME_CATALOG.challenges.length} challenges`,
  );
}

main();
