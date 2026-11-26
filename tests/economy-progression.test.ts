// ============================================================================
// tests/economy-progression.test.ts — Gate B Shop, Rarity, Crates, Progression
// ============================================================================

import { describe, expect, it } from 'vitest';
import { NB_SHOP_ITEMS, type InputFrame, type SimState } from '../src/contracts/index';
import { GAME_CATALOG } from '../src/data/index';
import {
  applySimCommand,
  buyShopOffer,
  combineWeapon,
  createDefaultStatMap,
  createInitialSimState,
  createRngFn,
  DEFAULT_ECONOMY_HOOKS,
  enqueueCrate,
  getRarityTierRoll,
  getRecycleRefund,
  getRerollCost,
  getShopPrice,
  lockShopOffer,
  onWaveEndProgression,
  pickLevelUpUpgrade,
  recomputePlayerStats,
  recycleWeapon,
  rerollLevelUpOffers,
  rerollShop,
  resolveCrate,
  rollLevelUpOffers,
  rollShop,
  startNewRun,
  stepSim,
} from '../src/sim/index';

function idleInput(): InputFrame {
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
  };
}

function makeShopState(wave: number, seed = 2026, charId = 'well_rounded'): SimState {
  const st = createInitialSimState(seed);
  startNewRun(st, {
    type: 'start_run',
    characterId: charId,
    weaponId: 'pistol',
    zoneId: 0,
    dangerLevel: 0,
    seed,
  });
  st.wave = wave;
  st.isEndless = wave > 20;
  st.screen = 'shop';
  st.shop.rerollCount = 0;
  st.shop.freeRerollsLeft = 0;
  return st;
}

describe('Shop Guarantees, Locks, Rerolls, Inflation & Recycling', () => {
  it('guarantees >= 2 weapons on Waves 1-2 and >= 1 weapon on Waves 3-5 across seeds', () => {
    for (const wave of [1, 2]) {
      for (let seed = 1; seed <= 12; seed++) {
        const st = makeShopState(wave, seed * 37);
        rollShop(st, GAME_CATALOG, createRngFn(st), false);
        expect(st.shop.offers.length).toBe(NB_SHOP_ITEMS);
        const weaponCount = st.shop.offers.filter((o) => o.kind === 'weapon').length;
        expect(weaponCount).toBeGreaterThanOrEqual(2);
      }
    }

    for (const wave of [3, 4, 5]) {
      for (let seed = 1; seed <= 12; seed++) {
        const st = makeShopState(wave, seed * 53);
        rollShop(st, GAME_CATALOG, createRngFn(st), false);
        expect(st.shop.offers.length).toBe(NB_SHOP_ITEMS);
        const weaponCount = st.shop.offers.filter((o) => o.kind === 'weapon').length;
        expect(weaponCount).toBeGreaterThanOrEqual(1);
      }
    }
  });

  it('preserves locked offers across shop rerolls and across waves', () => {
    const st = makeShopState(2, 7001);
    const rng = createRngFn(st);
    rollShop(st, GAME_CATALOG, rng, false);

    const lockedSlot = 1;
    const original = { ...st.shop.offers[lockedSlot] };
    expect(lockShopOffer(st, lockedSlot)).toBe(true);
    expect(st.shop.offers[lockedSlot].locked).toBe(true);

    // Reroll preserves locked slot
    st.player.materials = 500;
    expect(rerollShop(st, GAME_CATALOG, rng)).toBe(true);
    expect(st.shop.offers[lockedSlot].defId).toBe(original.defId);
    expect(st.shop.offers[lockedSlot].kind).toBe(original.kind);
    expect(st.shop.offers[lockedSlot].tier).toBe(original.tier);
    expect(st.shop.offers[lockedSlot].locked).toBe(true);

    // Advance to next wave and finish wave_end -> locked slot still preserved in next shop
    applySimCommand(st, { type: 'shop_next_wave' });
    expect(st.wave).toBe(3);
    expect(st.screen).toBe('combat');

    st.harvestPaid = false;
    onWaveEndProgression(st, GAME_CATALOG, rng);
    // Drain any pending level-ups
    while (st.screen === 'level_up') {
      applySimCommand(st, { type: 'level_up_pick', index: 0 });
    }
    expect(st.screen).toBe('shop');
    expect(st.shop.offers[lockedSlot].defId).toBe(original.defId);
    expect(st.shop.offers[lockedSlot].locked).toBe(true);
  });

  it('scales reroll costs monotonically and honors free rerolls without charging materials', () => {
    const st = makeShopState(5, 7002);
    const rng = createRngFn(st);
    rollShop(st, GAME_CATALOG, rng, false);

    const c0 = getRerollCost(5, false, 0, st.player.computedStats);
    const c1 = getRerollCost(5, false, 1, st.player.computedStats);
    const c2 = getRerollCost(5, false, 2, st.player.computedStats);
    expect(c1).toBeGreaterThan(c0);
    expect(c2).toBeGreaterThan(c1);

    // Free reroll consumes freeRerollsLeft without spending materials or raising rerollCount
    st.shop.freeRerollsLeft = 1;
    st.player.materials = 0;
    expect(rerollShop(st, GAME_CATALOG, rng)).toBe(true);
    expect(st.shop.freeRerollsLeft).toBe(0);
    expect(st.shop.rerollCount).toBe(0);

    // Next reroll with 0 materials fails cleanly
    expect(rerollShop(st, GAME_CATALOG, rng)).toBe(false);

    // Give exact materials -> succeeds and increments rerollCount
    st.player.materials = c0;
    expect(rerollShop(st, GAME_CATALOG, rng)).toBe(true);
    expect(st.player.materials).toBe(0);
    expect(st.shop.rerollCount).toBe(1);
    expect(st.shop.rerollCost).toBe(c1);
  });

  it('inflates shop prices with wave and Endless scaling and refunds accurately on recycle', () => {
    const stats = createDefaultStatMap();
    const p1 = getShopPrice(30, true, 1, false, stats);
    const p10 = getShopPrice(30, true, 10, false, stats);
    const p20 = getShopPrice(30, true, 20, false, stats);
    const p30 = getShopPrice(30, true, 30, true, stats);
    expect(p10).toBeGreaterThan(p1);
    expect(p20).toBeGreaterThan(p10);
    expect(p30).toBeGreaterThan(p20);

    // Recycle refund base 25% vs boosted +35% = 60%
    expect(getRecycleRefund(100, stats)).toBe(25);
    stats.recycling_gains = 35;
    expect(getRecycleRefund(100, stats)).toBe(60);

    const st = makeShopState(4, 7003);
    applySimCommand(st, { type: 'debug_give_weapon', weaponId: 'smg', tier: 1 });
    const countBefore = st.player.weapons.length;
    const matsBefore = st.player.materials;
    const targetUid = st.player.weapons[countBefore - 1].uid;

    expect(recycleWeapon(st, GAME_CATALOG, targetUid)).toBe(true);
    expect(st.player.weapons.length).toBe(countBefore - 1);
    expect(st.player.materials).toBeGreaterThan(matsBefore);
  });

  it('combines weapons T1->T2->T3->T4 and auto-combines when all slots are full', () => {
    const st = makeShopState(3, 7004);
    st.player.weapons.length = 0;

    // Combine T1 -> T2 -> T3 -> T4
    applySimCommand(st, { type: 'debug_give_weapon', weaponId: 'pistol', tier: 1 });
    applySimCommand(st, { type: 'debug_give_weapon', weaponId: 'pistol', tier: 1 });
    st.player.weapons[0].killsThisRun = 7;
    st.player.weapons[1].killsThisRun = 5;
    expect(combineWeapon(st, GAME_CATALOG, st.player.weapons[0].uid)).toBe(true);
    expect(st.player.weapons.length).toBe(1);
    expect(st.player.weapons[0].tier).toBe(2);
    expect(st.player.weapons[0].killsThisRun).toBe(12);

    applySimCommand(st, { type: 'debug_give_weapon', weaponId: 'pistol', tier: 2 });
    expect(combineWeapon(st, GAME_CATALOG, st.player.weapons[0].uid)).toBe(true);
    expect(st.player.weapons[0].tier).toBe(3);

    applySimCommand(st, { type: 'debug_give_weapon', weaponId: 'pistol', tier: 3 });
    expect(combineWeapon(st, GAME_CATALOG, st.player.weapons[0].uid)).toBe(true);
    expect(st.player.weapons[0].tier).toBe(4);

    // Cannot combine two T4 weapons
    applySimCommand(st, { type: 'debug_give_weapon', weaponId: 'pistol', tier: 4 });
    expect(combineWeapon(st, GAME_CATALOG, st.player.weapons[0].uid)).toBe(false);

    // Fill all 6 slots (with one T2 smg inside) and buy a matching T2 smg -> auto-combines to T3!
    st.player.weapons.length = 0;
    for (let i = 0; i < 5; i++) {
      applySimCommand(st, { type: 'debug_give_weapon', weaponId: 'pistol', tier: 1 });
    }
    applySimCommand(st, { type: 'debug_give_weapon', weaponId: 'smg', tier: 2 });
    expect(st.player.weapons.length).toBe(6);

    st.player.materials = 1000;
    st.shop.offers = [
      {
        slotIndex: 0,
        kind: 'weapon',
        defId: 'smg',
        tier: 1, // tier 0..3 -> weapon tier 2
        price: 40,
        locked: false,
        purchased: false,
      },
      {
        slotIndex: 1,
        kind: 'weapon',
        defId: 'knife',
        tier: 0,
        price: 20,
        locked: false,
        purchased: false,
      },
    ];

    expect(buyShopOffer(st, GAME_CATALOG, 0, createRngFn(st))).toBe(true);
    expect(st.player.weapons.length).toBe(6);
    expect(st.player.weapons.find((w) => w.weaponId === 'smg')?.tier).toBe(3);
    expect(st.events.some((e) => e.type === 'shop_combine' && e.weaponId === 'smg' && e.newTier === 3)).toBe(true);

    // Non-matching weapon rejected when slots full
    expect(buyShopOffer(st, GAME_CATALOG, 1, createRngFn(st))).toBe(false);
  });
});

describe('Rarity Distribution, Crates, Level-Ups, Harvesting & Endless Transition', () => {
  it('rolls only Tier 0 on Wave 1 and produces T1/T2/T3 on Wave 15 with high Luck', () => {
    const st = createInitialSimState(8080);
    const rng = createRngFn(st);

    for (let i = 0; i < 500; i++) {
      expect(getRarityTierRoll(1, 100, rng)).toBe(0);
    }

    const counts = [0, 0, 0, 0];
    for (let i = 0; i < 2000; i++) {
      counts[getRarityTierRoll(15, 100, rng)] += 1;
    }
    expect(counts[1]).toBeGreaterThan(200);
    expect(counts[2]).toBeGreaterThan(200);
    expect(counts[3]).toBeGreaterThan(20);
  });

  it('handles crate keep vs recycle and guarantees Tier 3 Red item from Legendary crates', () => {
    const st = makeShopState(11, 8081);
    const rng = createRngFn(st);

    // Regular crate: keep
    enqueueCrate(st, GAME_CATALOG, false, rng);
    expect(st.crateModal.pendingCrates.length).toBe(1);
    const keepItemId = st.crateModal.pendingCrates[0].itemId;
    expect(resolveCrate(st, GAME_CATALOG, true, rng)).toBe(true);
    expect(st.player.items).toContain(keepItemId);

    // Regular crate: recycle
    enqueueCrate(st, GAME_CATALOG, false, rng);
    const recycleVal = st.crateModal.pendingCrates[0].recycleValue;
    const matsBefore = st.player.materials;
    const itemsBefore = st.player.items.length;
    expect(resolveCrate(st, GAME_CATALOG, false, rng)).toBe(true);
    expect(st.player.materials).toBe(matsBefore + recycleVal);
    expect(st.player.items.length).toBe(itemsBefore);

    // Legendary crates always guarantee Tier 3 Red items
    for (let i = 0; i < 20; i++) {
      enqueueCrate(st, GAME_CATALOG, true, rng);
      const pending = st.crateModal.pendingCrates[st.crateModal.pendingCrates.length - 1];
      const itemDef = GAME_CATALOG.itemsById[pending.itemId];
      expect(itemDef).toBeDefined();
      expect(itemDef.tier).toBe(3);
      resolveCrate(st, GAME_CATALOG, false, rng);
    }
  });

  it('offers 4 distinct level-up stats, supports pick & reroll, and compounds/decays harvesting', () => {
    const st = makeShopState(6, 8082);
    const rng = createRngFn(st);
    st.player.pendingLevelUps = 2;
    st.screen = 'level_up';
    rollLevelUpOffers(st, GAME_CATALOG, rng);

    expect(st.levelUp.offers.length).toBe(4);
    const distinctKeys = new Set(st.levelUp.offers.map((o) => o.statKey));
    expect(distinctKeys.size).toBe(4);

    // Reroll level-up offers
    st.player.materials = 500;
    const matsBeforeReroll = st.player.materials;
    expect(rerollLevelUpOffers(st, GAME_CATALOG, rng)).toBe(true);
    expect(st.player.materials).toBeLessThan(matsBeforeReroll);
    expect(st.levelUp.offers.length).toBe(4);
    expect(new Set(st.levelUp.offers.map((o) => o.statKey)).size).toBe(4);

    // Pick first upgrade -> still 1 pending -> stays on level_up; pick second -> moves to shop
    const chosenCard = st.levelUp.offers[0];
    const modBefore = st.player.permanentStatMods[chosenCard.statKey] ?? 0;
    expect(pickLevelUpUpgrade(st, GAME_CATALOG, 0, rng)).toBe(true);
    expect(st.player.permanentStatMods[chosenCard.statKey]).toBe(modBefore + chosenCard.value);
    expect(st.player.pendingLevelUps).toBe(1);
    expect(st.screen).toBe('level_up');

    expect(pickLevelUpUpgrade(st, GAME_CATALOG, 0, rng)).toBe(true);
    expect(st.player.pendingLevelUps).toBe(0);
    expect(st.screen).toBe('shop');

    // Harvesting growth (+5% W1-20) vs Endless decay (-20% W21+)
    const stHarv = makeShopState(10, 8083);
    stHarv.player.permanentStatMods.stat_harvesting = 100;
    recomputePlayerStats(stHarv, GAME_CATALOG);
    const hBefore = stHarv.player.computedStats.stat_harvesting; // 108 (well_rounded +8 + 100)
    stHarv.harvestPaid = false;
    onWaveEndProgression(stHarv, GAME_CATALOG, createRngFn(stHarv));
    recomputePlayerStats(stHarv, GAME_CATALOG);
    expect(stHarv.player.computedStats.stat_harvesting).toBe(hBefore + Math.ceil(hBefore * 0.05));

    // Endless Wave 21 decays by -20%
    stHarv.wave = 21;
    stHarv.isEndless = true;
    const hEndlessBefore = stHarv.player.computedStats.stat_harvesting;
    stHarv.harvestPaid = false;
    onWaveEndProgression(stHarv, GAME_CATALOG, createRngFn(stHarv));
    recomputePlayerStats(stHarv, GAME_CATALOG);
    expect(stHarv.player.computedStats.stat_harvesting).toBe(
      hEndlessBefore - Math.ceil(hEndlessBefore * 0.2),
    );
  });

  it('transitions Wave 20 Victory -> Continue Endless -> Wave 21 combat with zero softlocks', () => {
    const st = createInitialSimState(9090);
    startNewRun(st, {
      type: 'start_run',
      characterId: 'well_rounded',
      weaponId: 'pistol',
      zoneId: 0,
      dangerLevel: 0,
      seed: 9090,
    });

    // Warp to Wave 20 and trigger wave completion
    applySimCommand(st, { type: 'debug_warp_wave', wave: 20 });
    expect(st.wave).toBe(20);
    expect(st.isBossWave).toBe(true);
    expect(st.victoryTriggered).toBe(false);

    // Queue a pending crate & level-up so post-victory queue is exercised too
    enqueueCrate(st, GAME_CATALOG, true, createRngFn(st));
    st.player.pendingLevelUps = 1;

    // Fast-forward wave timer to wave_end -> finalize -> victory
    st.waveElapsedTicks = st.waveDurationTicks;
    stepSim(st, idleInput());
    expect(st.screen).toBe('wave_end');

    let guard = 0;
    while (st.screen === 'wave_end' && guard < 300) {
      stepSim(st, idleInput());
      guard += 1;
    }
    expect(st.screen).toBe('victory');
    expect(st.victoryTriggered).toBe(true);

    // Continue Endless -> resolves crate -> level_up -> shop -> Wave 21 combat!
    applySimCommand(st, { type: 'continue_endless' });
    expect(st.isEndless).toBe(true);
    expect(st.screen).toBe('crate_modal');

    applySimCommand(st, { type: 'crate_keep' });
    expect(st.screen).toBe('level_up');

    applySimCommand(st, { type: 'level_up_pick', index: 0 });
    expect(st.screen).toBe('shop');

    applySimCommand(st, { type: 'shop_next_wave' });
    expect(st.wave).toBe(21);
    expect(st.isEndless).toBe(true);
    expect(st.screen).toBe('combat');

    // Step combat on Wave 21 cleanly
    for (let t = 0; t < 10; t++) stepSim(st, idleInput());
    expect(st.screen).toBe('combat');
    expect(DEFAULT_ECONOMY_HOOKS).toBeDefined();
  });
});
