// ============================================================================
// tests/sim-core.test.ts — Gate B Core Simulation, Math, Combat & EffectGraph
// ============================================================================

import { describe, expect, it } from 'vitest';
import {
  BAG_BOOST_SCALE,
  LIFESTEAL_COOLDOWN_TICKS,
  MAX_GOLD_SCALE,
  MAX_GOLDS,
  MAX_IFRAMES_TICKS,
  MIN_IFRAMES_TICKS,
  MIN_WEAPON_COOLDOWN,
  MIN_WEAPON_RANGE,
  type InputFrame,
  type SimState,
} from '../src/contracts/index';
import { GAME_CATALOG } from '../src/data/index';
import {
  applySimCommand,
  computeArmorMultiplier,
  computeEffectiveCooldown,
  computeEffectiveRange,
  computeEndlessFactor,
  computeMoveSpeed,
  computeRegenIntervalTicks,
  createDefaultStatMap,
  createEnemyInstance,
  createInitialSimState,
  damageEnemy,
  damagePlayer,
  DEFAULT_ECONOMY_HOOKS,
  hashSimState,
  nextRand,
  recomputePlayerStats,
  spawnBossDirect,
  spawnMaterialDrop,
  startNewRun,
  stepSim,
  xpNeededForLevel,
} from '../src/sim/index';

function makeInput(overrides: Partial<InputFrame> = {}): InputFrame {
  return {
    moveX: 0,
    moveY: 0,
    aimX: 0,
    aimY: 0,
    aimActive: false,
    aimWorldX: 0,
    aimWorldY: 0,
    hasWorldAim: false,
    toggleAutoAimPressed: false,
    pausePressed: false,
    statsHeld: false,
    activeInputMode: 'keyboard',
    ...overrides,
  };
}

function startRun(
  characterId: string,
  weaponId: string,
  seed = 1337,
  dangerLevel = 0,
  zoneId: 0 | 1 | 2 = 0,
): SimState {
  const state = createInitialSimState(seed);
  startNewRun(state, {
    type: 'start_run',
    characterId,
    weaponId,
    zoneId,
    dangerLevel,
    seed,
  });
  return state;
}

describe('PRNG & FNV-1a Determinism', () => {
  it('produces identical state hashes for identical seeded runs and diverges on different seeds', () => {
    const runWithSeed = (seed: number): string => {
      const st = startRun('well_rounded', 'pistol', seed);
      for (let t = 0; t < 240; t++) {
        const ang = (t / 60) * Math.PI * 0.5;
        stepSim(
          st,
          makeInput({
            moveX: Math.cos(ang),
            moveY: Math.sin(ang),
          }),
        );
      }
      return hashSimState(st);
    };

    const h1 = runWithSeed(424242);
    const h2 = runWithSeed(424242);
    const h3 = runWithSeed(999999);

    expect(h1).toMatch(/^[0-9a-f]{8}$/);
    expect(h1).toBe(h2);
    expect(h1).not.toBe(h3);
  });

  it('generates deterministic bounded Mulberry32 values in [0, 1)', () => {
    const a = createInitialSimState(777);
    const b = createInitialSimState(777);
    const seqA = Array.from({ length: 50 }, () => nextRand(a));
    const seqB = Array.from({ length: 50 }, () => nextRand(b));
    expect(seqA).toEqual(seqB);
    for (const v of seqA) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });
});

describe('SPEC.md Exact Math Formulas', () => {
  it('computes armor mitigation accurately for positive, zero, and negative armor', () => {
    expect(computeArmorMultiplier(0)).toBeCloseTo(1.0, 6);
    expect(computeArmorMultiplier(15)).toBeCloseTo(0.5, 6);
    expect(computeArmorMultiplier(-15)).toBeCloseTo(1.5, 6);
    expect(computeArmorMultiplier(30)).toBeCloseTo(1 / 3, 6);
    expect(computeArmorMultiplier(-30)).toBeCloseTo(5 / 3, 6);
  });

  it('computes HP regen intervals in 60 Hz ticks per SPEC.md', () => {
    expect(computeRegenIntervalTicks(0)).toBe(0);
    expect(computeRegenIntervalTicks(-4)).toBe(0);
    expect(computeRegenIntervalTicks(1)).toBe(300); // 5.0s
    expect(computeRegenIntervalTicks(10)).toBe(60); // 1.0s
    expect(computeRegenIntervalTicks(100)).toBeGreaterThanOrEqual(1);
  });

  it('computes XP needed curve (level + 3)^2', () => {
    expect(xpNeededForLevel(0)).toBe(9);
    expect(xpNeededForLevel(1)).toBe(16);
    expect(xpNeededForLevel(2)).toBe(25);
    expect(xpNeededForLevel(3)).toBe(36);
    expect(xpNeededForLevel(10)).toBe(169);
  });

  it('computes move speed with -80% floor and speed_cap ceiling', () => {
    const stats = createDefaultStatMap();
    expect(computeMoveSpeed(stats)).toBe(450);

    stats.stat_speed = 50;
    expect(computeMoveSpeed(stats)).toBeCloseTo(675, 5);

    stats.stat_speed = -200; // clamped at -80%
    expect(computeMoveSpeed(stats)).toBeCloseTo(90, 5);

    stats.stat_speed = 500; // clamped at default speed_cap 150%
    expect(computeMoveSpeed(stats)).toBeCloseTo(1125, 5);
  });

  it('computes melee/ranged effective range and attack cooldown with floors', () => {
    expect(computeEffectiveRange(150, true, 100)).toBe(200);
    expect(computeEffectiveRange(300, false, 100)).toBe(400);
    expect(computeEffectiveRange(50, true, -500)).toBe(MIN_WEAPON_RANGE);
    expect(computeEffectiveRange(50, false, -500)).toBe(MIN_WEAPON_RANGE);

    expect(computeEffectiveCooldown(60, 100, 0)).toBe(30);
    expect(computeEffectiveCooldown(60, -50, 0)).toBe(90);
    expect(computeEffectiveCooldown(10, 5000, 0)).toBe(MIN_WEAPON_COOLDOWN);
  });

  it('computes Endless factor for W1-20 and W21+', () => {
    expect(computeEndlessFactor(1)).toBe(0);
    expect(computeEndlessFactor(20)).toBe(0);
    expect(computeEndlessFactor(21)).toBeCloseTo(0.01, 6);
    expect(computeEndlessFactor(22)).toBeCloseTo(0.03, 6);
    expect(computeEndlessFactor(25)).toBeCloseTo(0.15, 6);
    expect(computeEndlessFactor(25, 2)).toBeCloseTo(0.3, 6);
  });
});

describe('Combat Mechanics', () => {
  it('supports auto-aim targeting nearest enemy and manual aim override', () => {
    const st = startRun('well_rounded', 'pistol', 101);
    st.enemies.length = 0;
    st.telegraphs.length = 0;
    st.trees.length = 0;

    // Place an enemy directly to the left of player
    const e = createEnemyInstance(st, GAME_CATALOG, 'baby_alien', st.player.x - 160, st.player.y - 24)!;
    e.hp = 500;
    e.maxHp = 500;
    st.enemies.push(e);
    st.player.weapons[0].cooldownTicks = 0;

    // Auto-aim should aim left (~PI or -PI)
    stepSim(st, makeInput());
    expect(Math.abs(Math.cos(st.player.weapons[0].aimAngle) - -1)).toBeLessThan(0.25);

    // Manual aim override pointing straight right (+X)
    st.player.weapons[0].cooldownTicks = 0;
    stepSim(
      st,
      makeInput({
        aimActive: true,
        aimX: 1,
        aimY: 0,
      }),
    );
    expect(Math.cos(st.player.weapons[0].aimAngle)).toBeGreaterThan(0.95);
    expect(st.projectiles.some((p) => p.owner === 'player' && p.vx > 0)).toBe(true);
  });

  it('executes melee thrust and melee sweep attacks and spawns melee_slash hazards', () => {
    // Thrust weapon (dagger: attackType === 0)
    const stThrust = startRun('well_rounded', 'dagger', 201);
    stThrust.enemies.length = 0;
    stThrust.trees.length = 0;
    const e1 = createEnemyInstance(
      stThrust,
      GAME_CATALOG,
      'bruiser',
      stThrust.player.x + 80,
      stThrust.player.y - 24,
    )!;
    e1.hp = 300;
    e1.maxHp = 300;
    stThrust.enemies.push(e1);
    stThrust.player.weapons[0].cooldownTicks = 0;
    stepSim(stThrust, makeInput());

    expect(e1.hp).toBeLessThan(300);
    expect(stThrust.player.weapons[0].swingType).toBe(0);
    expect(stThrust.hazards.some((h) => h.kind === 'melee_slash')).toBe(true);

    // Sweep weapon (chopper: attackType === 1)
    const stSweep = startRun('well_rounded', 'chopper', 202);
    stSweep.enemies.length = 0;
    stSweep.trees.length = 0;
    const e2 = createEnemyInstance(
      stSweep,
      GAME_CATALOG,
      'bruiser',
      stSweep.player.x + 90,
      stSweep.player.y - 24,
    )!;
    const e3 = createEnemyInstance(
      stSweep,
      GAME_CATALOG,
      'bruiser',
      stSweep.player.x + 65,
      stSweep.player.y + 35,
    )!;
    e2.hp = 300;
    e2.maxHp = 300;
    e3.hp = 300;
    e3.maxHp = 300;
    stSweep.enemies.push(e2, e3);
    stSweep.player.weapons[0].cooldownTicks = 0;
    stepSim(stSweep, makeInput());

    expect(e2.hp).toBeLessThan(300);
    expect(e3.hp).toBeLessThan(300);
    expect(stSweep.player.weapons[0].swingType).toBe(1);
    expect(stSweep.hazards.some((h) => h.kind === 'melee_slash' && h.arcSpan > 1.5)).toBe(true);
  });

  it('applies ranged pierce and bounce with damage reduction', () => {
    // Pierce test: two enemies lined up along +X
    const stPierce = startRun('well_rounded', 'pistol', 301);
    stPierce.enemies.length = 0;
    stPierce.trees.length = 0;
    stPierce.player.weapons.length = 0;
    const a = createEnemyInstance(stPierce, GAME_CATALOG, 'bruiser', stPierce.player.x + 120, stPierce.player.y)!;
    const b = createEnemyInstance(stPierce, GAME_CATALOG, 'bruiser', stPierce.player.x + 210, stPierce.player.y)!;
    a.hp = 500;
    a.maxHp = 500;
    b.hp = 500;
    b.maxHp = 500;
    a.speed = 0;
    b.speed = 0;
    stPierce.enemies.push(a, b);

    stPierce.projectiles.push({
      uid: 9991,
      owner: 'player',
      x: stPierce.player.x + 40,
      y: stPierce.player.y,
      prevX: stPierce.player.x + 40,
      prevY: stPierce.player.y,
      vx: 1200,
      vy: 0,
      radius: 10,
      damage: 40,
      isCrit: false,
      knockback: 0,
      lifesteal: 0,
      pierceLeft: 1,
      pierceDmgMult: 0.5,
      bounceLeft: 0,
      bounceDmgMult: 0.5,
      explosionRadius: 0,
      explosionDamage: 0,
      burnDamage: 0,
      burnDurationSec: 0,
      lifeTicks: 60,
      maxLifeTicks: 60,
      spriteId: 'proj_bullet',
      color: '#fff',
      hitEnemyUids: [],
      sourceWeaponUid: 0,
    });

    for (let t = 0; t < 20; t++) stepSim(stPierce, makeInput());
    expect(500 - a.hp).toBe(40);
    expect(500 - b.hp).toBe(20); // 50% pierce reduction

    // Bounce test: second enemy offset perpendicularly (off the original line of fire)
    const stBounce = startRun('well_rounded', 'slingshot', 302);
    stBounce.enemies.length = 0;
    stBounce.trees.length = 0;
    stBounce.player.weapons.length = 0;
    const c = createEnemyInstance(stBounce, GAME_CATALOG, 'bruiser', stBounce.player.x + 110, stBounce.player.y)!;
    const d = createEnemyInstance(stBounce, GAME_CATALOG, 'bruiser', stBounce.player.x + 110, stBounce.player.y + 130)!;
    c.hp = 500;
    c.maxHp = 500;
    d.hp = 500;
    d.maxHp = 500;
    c.speed = 0;
    d.speed = 0;
    stBounce.enemies.push(c, d);

    stBounce.projectiles.push({
      uid: 9992,
      owner: 'player',
      x: stBounce.player.x + 40,
      y: stBounce.player.y,
      prevX: stBounce.player.x + 40,
      prevY: stBounce.player.y,
      vx: 1000,
      vy: 0,
      radius: 10,
      damage: 40,
      isCrit: false,
      knockback: 0,
      lifesteal: 0,
      pierceLeft: 0,
      pierceDmgMult: 0.5,
      bounceLeft: 1,
      bounceDmgMult: 0.5,
      explosionRadius: 0,
      explosionDamage: 0,
      burnDamage: 0,
      burnDurationSec: 0,
      lifeTicks: 60,
      maxLifeTicks: 60,
      spriteId: 'proj_slingshot',
      color: '#fff',
      hitEnemyUids: [],
      sourceWeaponUid: 0,
    });

    for (let t = 0; t < 30; t++) stepSim(stBounce, makeInput());
    expect(500 - c.hp).toBe(40);
    expect(500 - d.hp).toBe(20); // 50% bounce reduction
  });

  it('enforces knockback resistance (boss = 1.0 immune, basic = 0 pushed)', () => {
    const st = startRun('well_rounded', 'pistol', 303);
    st.enemies.length = 0;
    const basic = createEnemyInstance(st, GAME_CATALOG, 'baby_alien', st.player.x + 120, st.player.y)!;
    basic.hp = 500;
    st.enemies.push(basic);

    spawnBossDirect(st, GAME_CATALOG, 'predator', { x: st.player.x - 160, y: st.player.y });
    const boss = st.enemies.find((e) => e.defId === 'predator')!;
    expect(boss.knockbackResistance).toBe(1.0);

    damageEnemy(st, GAME_CATALOG, basic, 5, false, 20, 0, st.player.x, st.player.y);
    damageEnemy(st, GAME_CATALOG, boss, 5, false, 20, 0, st.player.x, st.player.y);

    expect(Math.hypot(basic.kbVx, basic.kbVy)).toBeGreaterThan(100);
    expect(boss.kbVx).toBe(0);
    expect(boss.kbVy).toBe(0);
  });

  it('rate-limits lifesteal to once per 6 ticks (LIFESTEAL_COOLDOWN_TICKS)', () => {
    const st = startRun('well_rounded', 'pistol', 304);
    st.player.permanentStatMods.stat_lifesteal = 100;
    recomputePlayerStats(st, GAME_CATALOG);
    st.player.hp = 5;
    st.player.lifestealCooldownTicks = 0;

    const dummy = createEnemyInstance(st, GAME_CATALOG, 'bruiser', st.player.x + 100, st.player.y)!;
    dummy.hp = 1000;
    st.enemies.push(dummy);

    // 1st hit heals +1 HP and arms 6-tick cooldown
    damageEnemy(st, GAME_CATALOG, dummy, 1, false, 0, 0, st.player.x, st.player.y, 1.0);
    expect(st.player.hp).toBe(6);
    expect(st.player.lifestealCooldownTicks).toBe(LIFESTEAL_COOLDOWN_TICKS);

    // Immediate 2nd hit within cooldown does NOT heal
    damageEnemy(st, GAME_CATALOG, dummy, 1, false, 0, 0, st.player.x, st.player.y, 1.0);
    expect(st.player.hp).toBe(6);

    // Advance 6 ticks -> cooldown expires -> next hit heals again
    st.player.weapons.length = 0;
    st.enemies.length = 0;
    st.enemies.push(dummy);
    for (let t = 0; t < LIFESTEAL_COOLDOWN_TICKS; t++) {
      stepSim(st, makeInput());
    }
    expect(st.player.lifestealCooldownTicks).toBe(0);
    damageEnemy(st, GAME_CATALOG, dummy, 1, false, 0, 0, st.player.x, st.player.y, 1.0);
    expect(st.player.hp).toBe(7);
  });

  it('handles dodge, Tardigrade hit protection, and linear 12..24 tick i-frames', () => {
    // Tardigrade hit protection
    const stTard = startRun('well_rounded', 'pistol', 305);
    applySimCommand(stTard, { type: 'debug_give_item', itemId: 'tardigrade' });
    applySimCommand(stTard, { type: 'debug_warp_wave', wave: 1 });
    expect(stTard.player.hitProtectionLeft).toBe(1);
    stTard.player.iframesTicks = 0;
    const hpBefore = stTard.player.hp;

    const hit1 = damagePlayer(stTard, GAME_CATALOG, 8, stTard.player.x + 50, stTard.player.y);
    expect(hit1).toBe(false);
    expect(stTard.player.hp).toBe(hpBefore);
    expect(stTard.player.hitProtectionLeft).toBe(0);
    expect(stTard.player.iframesTicks).toBeGreaterThanOrEqual(MIN_IFRAMES_TICKS);

    // Next hit after iframes expire deals damage & scales iframes in [12, 24]
    stTard.player.iframesTicks = 0;
    const hitSmall = damagePlayer(stTard, GAME_CATALOG, 1, stTard.player.x + 50, stTard.player.y);
    expect(hitSmall).toBe(true);
    expect(stTard.player.iframesTicks).toBeGreaterThanOrEqual(MIN_IFRAMES_TICKS);
    expect(stTard.player.iframesTicks).toBeLessThanOrEqual(14);

    // Blocked while i-frames active
    const hpMid = stTard.player.hp;
    const hitDuringIframes = damagePlayer(stTard, GAME_CATALOG, 5, stTard.player.x + 50, stTard.player.y);
    expect(hitDuringIframes).toBe(false);
    expect(stTard.player.hp).toBe(hpMid);

    // Large hit (>= maxHp) grants MAX_IFRAMES_TICKS = 24
    stTard.player.permanentStatMods.stat_max_hp = 50;
    recomputePlayerStats(stTard, GAME_CATALOG);
    stTard.player.hp = stTard.player.maxHp;
    stTard.player.iframesTicks = 0;
    damagePlayer(stTard, GAME_CATALOG, stTard.player.maxHp - 1, stTard.player.x + 50, stTard.player.y);
    expect(stTard.player.iframesTicks).toBe(MAX_IFRAMES_TICKS);

    // Dodge roll verification
    const stDodge = startRun('ghost', 'ghost_flint', 306);
    stDodge.player.permanentStatMods.stat_dodge = 60; // total 90% with ghost cap 90
    recomputePlayerStats(stDodge, GAME_CATALOG);
    stDodge.player.hp = stDodge.player.maxHp;
    let dodged = 0;
    for (let i = 0; i < 60; i++) {
      stDodge.player.iframesTicks = 0;
      stDodge.player.hp = stDodge.player.maxHp;
      stDodge.screen = 'combat';
      const took = damagePlayer(stDodge, GAME_CATALOG, 1, stDodge.player.x + 20, stDodge.player.y);
      if (!took) dodged += 1;
    }
    expect(dodged).toBeGreaterThan(40); // ~54 expected at 90%
    expect(stDodge.runStats.dodges).toBe(dodged);
  });
});

describe('MAX_GOLDS Cap & Loot Bag 2x Carry-Over', () => {
  it('enforces MAX_GOLDS = 50 floor cap by merging value and growing scale up to MAX_GOLD_SCALE', () => {
    const st = startRun('well_rounded', 'pistol', 401);
    st.pickups.length = 0;

    const totalDrops = 95;
    for (let i = 0; i < totalDrops; i++) {
      spawnMaterialDrop(st, st.player.x + 300, st.player.y + 200, 2);
    }

    const mats = st.pickups.filter((pk) => pk.kind === 'material');
    expect(mats.length).toBe(MAX_GOLDS);
    const totalValue = mats.reduce((acc, pk) => acc + pk.value, 0);
    expect(totalValue).toBe(totalDrops * 2);
    expect(mats.some((pk) => pk.scale > 1.0)).toBe(true);
    expect(mats.every((pk) => pk.scale <= MAX_GOLD_SCALE)).toBe(true);
  });

  it('carries uncollected floor materials into bonusGold and spawns 2x Loot Bag pickups next wave', () => {
    const st = startRun('well_rounded', 'pistol', 402);
    st.pickups.length = 0;
    st.enemies.length = 0;
    st.telegraphs.length = 0;

    // Spawn materials far from player right at the end of wave
    st.pickups.push({
      uid: 8001,
      kind: 'material',
      x: 1900,
      y: 1400,
      prevX: 1900,
      prevY: 1400,
      vx: 0,
      vy: 0,
      value: 12,
      scale: 1,
      isBagBoosted: false,
      attracted: false,
      attractSpeed: 0,
      ageTicks: 0,
    });

    // Manually simulate wave_end timeout depositing leftover materials into bonusGold
    st.screen = 'wave_end';
    st.waveEndTimer = 1;
    st.harvestTimer = 1;
    stepSim(st, makeInput());
    expect(st.player.bonusGold).toBe(12);

    // Next wave material drop consumes bonusGold to create a 2x boosted pickup
    st.pickups.length = 0;
    spawnMaterialDrop(st, st.player.x + 250, st.player.y, 4);
    expect(st.player.bonusGold).toBe(8);
    expect(st.pickups.length).toBe(1);
    expect(st.pickups[0].value).toBe(8); // 4 + 4 from bonusGold
    expect(st.pickups[0].isBagBoosted).toBe(true);
    expect(st.pickups[0].scale).toBeGreaterThanOrEqual(BAG_BOOST_SCALE);
  });
});

describe('EffectGraph Iconic Characters', () => {
  it('bull: 0 weapon slots and explodes on hit taken damaging nearby enemies', () => {
    const st = startRun('bull', 'pistol', 501);
    expect(st.player.computedStats.weapon_slot).toBe(0);
    expect(st.player.computedStats.no_weapons).toBeGreaterThan(0);
    expect(st.player.weapons.length).toBe(0);

    st.enemies.length = 0;
    const foe = createEnemyInstance(st, GAME_CATALOG, 'bruiser', st.player.x + 60, st.player.y)!;
    foe.hp = 500;
    foe.maxHp = 500;
    st.enemies.push(foe);
    st.player.iframesTicks = 0;

    damagePlayer(st, GAME_CATALOG, 2, foe.x, foe.y);
    expect(st.events.some((ev) => ev.type === 'explosion')).toBe(true);
    expect(foe.hp).toBeLessThan(500);
  });

  it('demon: pays shop offers with Max HP and converts 50% materials to Max HP at wave end', () => {
    const st = startRun('demon', 'wrench', 502);
    expect(st.player.computedStats.hp_shop).toBeGreaterThan(0);
    expect(st.player.computedStats.convert_materials_to_hp).toBe(13);

    // Wave-end material -> HP conversion: 130 materials -> 65 convertible -> +5 Max HP
    st.player.materials = 130;
    const maxHpBefore = st.player.maxHp;
    DEFAULT_ECONOMY_HOOKS.onWaveEndProgression(st, GAME_CATALOG, () => nextRand(st));
    expect(st.player.maxHp).toBeGreaterThanOrEqual(maxHpBefore + 5);
    expect(st.player.materials).toBeLessThan(130);

    // HP shop purchase spends Max HP instead of materials
    st.screen = 'shop';
    st.player.permanentStatMods.stat_max_hp = (st.player.permanentStatMods.stat_max_hp ?? 0) + 40;
    recomputePlayerStats(st, GAME_CATALOG);
    st.player.hp = st.player.maxHp;
    st.player.materials = 0;
    const maxHpBeforeBuy = st.player.maxHp;
    const affordableIdx = st.shop.offers.findIndex((o) => !o.purchased && o.price < st.player.maxHp);
    expect(affordableIdx).toBeGreaterThanOrEqual(0);
    const offerPrice = st.shop.offers[affordableIdx].price;
    applySimCommand(st, { type: 'shop_buy', slotIndex: affordableIdx });
    expect(st.shop.offers[affordableIdx].purchased).toBe(true);
    expect(st.player.maxHp).toBeLessThan(maxHpBeforeBuy);
    expect(maxHpBeforeBuy - st.player.maxHp).toBeGreaterThanOrEqual(Math.min(offerPrice, 1));
  });

  it('one_arm: 1 weapon slot, +200% Attack Speed, rejects buying 2nd different weapon', () => {
    const st = startRun('one_arm', 'scissors', 503);
    expect(st.player.computedStats.weapon_slot).toBe(1);
    expect(st.player.computedStats.stat_attack_speed).toBeGreaterThanOrEqual(200);
    expect(st.player.weapons.length).toBe(1);

    st.screen = 'shop';
    st.player.materials = 9999;
    st.shop.offers = [
      {
        slotIndex: 0,
        kind: 'weapon',
        defId: 'pistol',
        tier: 0,
        price: 10,
        locked: false,
        purchased: false,
      },
    ];
    applySimCommand(st, { type: 'shop_buy', slotIndex: 0 });
    expect(st.player.weapons.length).toBe(1);
    expect(st.shop.offers[0].purchased).toBe(false);
  });

  it('multitasker: supports 12 weapon slots and scales -5% damage per equipped weapon', () => {
    const st = startRun('multitasker', 'stick', 504);
    expect(st.player.computedStats.weapon_slot).toBe(12);
    const dmgWith1 = st.player.computedStats.stat_percent_damage;

    for (let i = 0; i < 11; i++) {
      applySimCommand(st, { type: 'debug_give_weapon', weaponId: 'stick', tier: 1 });
    }
    expect(st.player.weapons.length).toBe(12);
    expect(st.player.computedStats.stat_percent_damage).toBe(dmgWith1 - 55);
  });

  it('pacifist: earns materials & XP per surviving enemy at wave end', () => {
    const st = startRun('pacifist', 'hand', 505);
    expect(st.player.computedStats.pacifist_material_per_enemy).toBeGreaterThan(0);

    st.enemies.length = 0;
    for (let i = 0; i < 20; i++) {
      st.enemies.push(createEnemyInstance(st, GAME_CATALOG, 'baby_alien', 300 + i * 30, 300)!);
    }
    const matsBefore = st.player.materials;
    DEFAULT_ECONOMY_HOOKS.onWaveEndProgression(st, GAME_CATALOG, () => nextRand(st));
    const expectedBonus = Math.floor(20 * st.player.computedStats.pacifist_material_per_enemy);
    expect(st.player.materials - matsBefore).toBeGreaterThanOrEqual(expectedBonus);
  });

  it('knight: melee-only, Tier II+ minimum, and +2 Melee Damage per Armor', () => {
    const st = startRun('knight', 'sword', 506);
    expect(st.player.computedStats.no_ranged_weapons).toBeGreaterThan(0);
    expect(st.player.weapons[0].tier).toBeGreaterThanOrEqual(2);
    const meleeBefore = st.player.computedStats.stat_melee_damage;

    st.player.permanentStatMods.stat_armor = 5;
    recomputePlayerStats(st, GAME_CATALOG);
    expect(st.player.computedStats.stat_melee_damage).toBe(meleeBefore + 10);

    // Rejects ranged weapon purchase
    st.screen = 'shop';
    st.player.materials = 9999;
    st.shop.offers = [
      {
        slotIndex: 0,
        kind: 'weapon',
        defId: 'pistol',
        tier: 1,
        price: 10,
        locked: false,
        purchased: false,
      },
    ];
    applySimCommand(st, { type: 'shop_buy', slotIndex: 0 });
    expect(st.shop.offers[0].purchased).toBe(false);
  });

  it('ghost: raises dodge cap to 90% (vs default 60%)', () => {
    const ghost = startRun('ghost', 'ghost_flint', 507);
    const base = startRun('well_rounded', 'pistol', 507);
    expect(ghost.player.computedStats.dodge_cap).toBe(90);
    expect(base.player.computedStats.dodge_cap).toBe(60);
  });

  it('engineer: spawns turrets at wave start that fire at nearby enemies', () => {
    const st = startRun('engineer', 'wrench', 508);
    expect(st.structures.length).toBeGreaterThanOrEqual(2); // starting turret item + wrench turret
    expect(st.structures.every((s) => s.kind === 'turret')).toBe(true);

    // Place an enemy right next to the first turret and step until it fires
    const turret = st.structures[0];
    turret.cooldownTicks = 1;
    st.enemies.length = 0;
    const foe = createEnemyInstance(st, GAME_CATALOG, 'bruiser', turret.x + 80, turret.y)!;
    foe.hp = 500;
    st.enemies.push(foe);
    st.player.weapons.length = 0;
    stepSim(st, makeInput());
    expect(st.projectiles.some((p) => p.owner === 'structure')).toBe(true);
  });

  it('streamer: earns stand-still passive income every 60 ticks and gains moving damage/AS when moving', () => {
    const st = startRun('streamer', 'fist', 509);
    expect(st.player.computedStats.stand_still_income).toBe(3);

    const matsStart = st.player.materials;
    for (let t = 0; t < 60; t++) {
      stepSim(st, makeInput({ moveX: 0, moveY: 0 }));
    }
    expect(st.player.materials).toBe(matsStart + 3);

    const standStillArmor = st.player.computedStats.stat_armor;
    const standStillDmg = st.player.computedStats.stat_percent_damage;
    stepSim(st, makeInput({ moveX: 1, moveY: 0 }));
    expect(st.player.computedStats.stat_armor).toBeLessThan(standStillArmor);
    expect(st.player.computedStats.stat_percent_damage).toBeGreaterThan(standStillDmg);
  });

  it('baby: supports 24 weapon slots', () => {
    const st = startRun('baby', 'fist', 510);
    expect(st.player.computedStats.weapon_slot).toBe(24);
    for (let i = 0; i < 23; i++) {
      applySimCommand(st, { type: 'debug_give_weapon', weaponId: 'fist', tier: 1 });
    }
    expect(st.player.weapons.length).toBe(24);
  });
});
