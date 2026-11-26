import {
  BASE_HARVESTING_GROWTH,
  ENDLESS_HARVESTING_DECAY,
  type CoreStatKey,
  type GameDataCatalog,
  type ItemDef,
  type SimEconomyHooks,
  type SimState,
  type UpgradeDef,
} from '../contracts/index.ts';
import {
  buyShopOffer,
  combineWeapon,
  getRarityTierRoll,
  getRecycleRefund,
  getRerollCost,
  getShopPrice,
  lockShopOffer,
  recycleWeapon,
  rerollShop,
  rollShop,
} from './shop.ts';

function pickRandom<T>(arr: readonly T[], nextRand: () => number): T {
  const idx = Math.min(arr.length - 1, Math.floor(nextRand() * arr.length));
  return arr[idx];
}

function awardXpAndProcessLevels(state: SimState, xpGain: number): void {
  if (xpGain <= 0) return;
  state.player.xp += xpGain;
  while (state.player.xp >= state.player.xpToNext) {
    state.player.xp -= state.player.xpToNext;
    state.player.level += 1;
    state.player.pendingLevelUps += 1;
    state.player.xpToNext = (state.player.level + 3) * (state.player.level + 3);
    state.player.maxHp += 1;
    state.player.hp = Math.min(state.player.maxHp, state.player.hp + 1);
    state.events.push({
      type: 'level_up',
      level: state.player.level,
      x: state.player.x,
      y: state.player.y,
    });
  }
}

function advancePostWaveFlow(
  state: SimState,
  catalog: GameDataCatalog,
  nextRand: () => number,
): void {
  if (state.crateModal.pendingCrates.length > 0) {
    state.screen = 'crate_modal';
    return;
  }
  if (state.player.pendingLevelUps > 0) {
    state.screen = 'level_up';
    state.levelUp.rerollCount = 0;
    rollLevelUpOffers(state, catalog, nextRand);
    return;
  }

  state.screen = 'shop';
  state.shop.rerollCount = 0;
  state.shop.freeRerollsLeft = Math.max(
    0,
    Math.floor(state.player.computedStats.free_rerolls ?? 0),
  );
  rollShop(state, catalog, nextRand, true);
}

export function rollLevelUpOffers(
  state: SimState,
  catalog: GameDataCatalog,
  nextRand: () => number,
): void {
  const byStat = new Map<CoreStatKey, UpgradeDef[]>();
  for (let i = 0; i < catalog.upgrades.length; i++) {
    const u = catalog.upgrades[i];
    const bucket = byStat.get(u.statKey);
    if (bucket) {
      bucket.push(u);
    } else {
      byStat.set(u.statKey, [u]);
    }
  }

  const statPool = Array.from(byStat.keys());
  const offers: UpgradeDef[] = [];
  const count = Math.min(4, statPool.length);
  const luck = state.player.computedStats.stat_luck ?? 0;

  for (let i = 0; i < count; i++) {
    const pickIdx = i + Math.floor(nextRand() * (statPool.length - i));
    const chosenStat = statPool[pickIdx];
    statPool[pickIdx] = statPool[i];
    statPool[i] = chosenStat;

    const bucket = byStat.get(chosenStat)!;
    const rolledTier = getRarityTierRoll(state.wave, luck, nextRand);

    let card = bucket.find((u) => u.tier === rolledTier);
    if (!card) {
      for (let t = rolledTier - 1; t >= 0; t--) {
        card = bucket.find((u) => u.tier === t);
        if (card) break;
      }
    }
    if (!card) {
      card = bucket[0];
    }
    offers.push(card);
  }

  state.levelUp.offers = offers;
  state.levelUp.remainingLevelUps = state.player.pendingLevelUps;
  state.levelUp.rerollCost = getRerollCost(
    state.wave,
    state.isEndless,
    state.levelUp.rerollCount,
    state.player.computedStats,
  );
}

export function pickLevelUpUpgrade(
  state: SimState,
  catalog: GameDataCatalog,
  index: number,
  nextRand: () => number,
): boolean {
  if (index < 0 || index >= state.levelUp.offers.length) return false;
  const chosen = state.levelUp.offers[index];
  if (!chosen) return false;

  state.player.permanentStatMods[chosen.statKey] =
    (state.player.permanentStatMods[chosen.statKey] ?? 0) + chosen.value;
  state.player.computedStats[chosen.statKey] =
    (state.player.computedStats[chosen.statKey] ?? 0) + chosen.value;

  if (chosen.statKey === 'stat_max_hp') {
    state.player.maxHp = Math.max(1, state.player.maxHp + chosen.value);
    state.player.hp = Math.min(state.player.maxHp, state.player.hp + chosen.value);
  }

  state.player.pendingLevelUps = Math.max(0, state.player.pendingLevelUps - 1);
  state.levelUp.rerollCount = 0;
  state.levelUp.remainingLevelUps = state.player.pendingLevelUps;

  if (state.player.pendingLevelUps > 0) {
    state.screen = 'level_up';
    rollLevelUpOffers(state, catalog, nextRand);
  } else {
    advancePostWaveFlow(state, catalog, nextRand);
  }
  return true;
}

export function rerollLevelUpOffers(
  state: SimState,
  catalog: GameDataCatalog,
  nextRand: () => number,
): boolean {
  const stats = state.player.computedStats;
  const cost = getRerollCost(state.wave, state.isEndless, state.levelUp.rerollCount, stats);
  if (state.player.materials < cost) return false;

  state.player.materials -= cost;
  state.levelUp.rerollCount += 1;
  rollLevelUpOffers(state, catalog, nextRand);
  state.events.push({ type: 'shop_reroll' });
  return true;
}

function getEligibleCrateItems(state: SimState, catalog: GameDataCatalog): ItemDef[] {
  const pendingCounts = new Map<string, number>();
  for (let i = 0; i < state.crateModal.pendingCrates.length; i++) {
    const id = state.crateModal.pendingCrates[i].itemId;
    pendingCounts.set(id, (pendingCounts.get(id) ?? 0) + 1);
  }

  const eligible = catalog.items.filter((item) => {
    if (item.maxCount < 0) return true;
    const owned = state.player.itemCounts[item.id] ?? 0;
    const queued = pendingCounts.get(item.id) ?? 0;
    return owned + queued < item.maxCount;
  });

  return eligible.length > 0 ? eligible : [...catalog.items];
}

export function enqueueCrate(
  state: SimState,
  catalog: GameDataCatalog,
  isLegendary: boolean,
  nextRand: () => number,
): void {
  const stats = state.player.computedStats;

  // Bag bonus: grant extra materials when picking up a Crate
  const boxGold = Math.floor(stats.item_box_gold ?? 0);
  if (boxGold > 0) {
    state.player.materials += boxGold;
    state.runStats.materialsCollected += boxGold;
  }

  const eligible = getEligibleCrateItems(state, catalog);
  if (eligible.length === 0) return;

  let pool: ItemDef[] = [];
  if (isLegendary) {
    // Legendary Crates guarantee Tier 3 Red legendary items (falling back only if exhausted)
    for (let t = 3; t >= 0; t--) {
      pool = eligible.filter((it) => it.tier === t);
      if (pool.length > 0) break;
    }
  } else {
    const rolledTier = getRarityTierRoll(state.wave, stats.stat_luck ?? 0, nextRand);
    for (let t = rolledTier; t >= 0; t--) {
      pool = eligible.filter((it) => it.tier === t);
      if (pool.length > 0) break;
    }
  }
  if (pool.length === 0) {
    pool = eligible;
  }

  const charDef = catalog.charactersById[state.player.characterId];
  if (charDef && charDef.wantedTags.length > 0 && nextRand() < 0.1) {
    const tagged = pool.filter((it) => it.tags.some((t) => charDef.wantedTags.includes(t)));
    if (tagged.length > 0) pool = tagged;
  }

  const chosen = pickRandom(pool, nextRand);
  const shopPrice = getShopPrice(chosen.value, false, state.wave, state.isEndless, stats);
  const recycleValue = getRecycleRefund(shopPrice, stats);

  state.crateModal.pendingCrates.push({
    isLegendary,
    itemId: chosen.id,
    recycleValue,
  });
}

export function resolveCrate(
  state: SimState,
  catalog: GameDataCatalog,
  keep: boolean,
  nextRand: () => number,
): boolean {
  if (state.crateModal.pendingCrates.length === 0) {
    advancePostWaveFlow(state, catalog, nextRand);
    return false;
  }

  const crate = state.crateModal.pendingCrates.shift()!;
  state.runStats.cratesOpened += 1;

  if (keep) {
    const itemDef = catalog.itemsById[crate.itemId];
    if (itemDef) {
      state.player.items.push(itemDef.id);
      state.player.itemCounts[itemDef.id] = (state.player.itemCounts[itemDef.id] ?? 0) + 1;
      state.events.push({ type: 'shop_buy', kind: 'item', defId: itemDef.id });
    }
  } else {
    state.player.materials += crate.recycleValue;
    state.runStats.materialsCollected += crate.recycleValue;
    state.events.push({ type: 'shop_recycle', refund: crate.recycleValue });
  }

  advancePostWaveFlow(state, catalog, nextRand);
  return true;
}

export function onWaveEndProgression(
  state: SimState,
  catalog: GameDataCatalog,
  nextRand: () => number,
): void {
  const stats = state.player.computedStats;

  if (!state.harvestPaid) {
    // 1. Harvesting payout (Materials + XP) & compounding growth/decay
    const harvesting = Math.max(0, Math.floor(stats.stat_harvesting ?? 0));
    if (harvesting > 0) {
      state.player.materials += harvesting;
      state.runStats.materialsCollected += harvesting;
      awardXpAndProcessLevels(state, harvesting);
      state.events.push({ type: 'harvest_payout', amount: harvesting });

      if (state.isEndless || state.wave > 20) {
        const decay = Math.ceil(harvesting * (Math.abs(ENDLESS_HARVESTING_DECAY) / 100));
        state.player.permanentStatMods.stat_harvesting =
          (state.player.permanentStatMods.stat_harvesting ?? 0) - decay;
      } else {
        const growthPct = stats.harvesting_growth ?? BASE_HARVESTING_GROWTH;
        if (growthPct !== 0) {
          const growth =
            growthPct > 0
              ? Math.ceil(harvesting * (growthPct / 100))
              : Math.floor(harvesting * (growthPct / 100));
          state.player.permanentStatMods.stat_harvesting =
            (state.player.permanentStatMods.stat_harvesting ?? 0) + growth;
        }
      }
    }

    // 2. Materials per wave passive income
    const flatWaveIncome = Math.floor(stats.materials_per_wave ?? 0);
    if (flatWaveIncome > 0) {
      state.player.materials += flatWaveIncome;
      state.runStats.materialsCollected += flatWaveIncome;
    }

    // 3. Pacifist surviving-enemy bonus
    const pacifistPerEnemy = stats.pacifist_material_per_enemy ?? 0;
    if (pacifistPerEnemy > 0 && state.enemies.length > 0) {
      const pacifistBonus = Math.floor(state.enemies.length * pacifistPerEnemy);
      if (pacifistBonus > 0) {
        state.player.materials += pacifistBonus;
        state.runStats.materialsCollected += pacifistBonus;
        awardXpAndProcessLevels(state, pacifistBonus);
      }
    }

    // 4. Piggy Bank interest on banked materials
    const piggyPct = stats.piggy_bank_pct ?? 0;
    if (piggyPct > 0 && state.player.materials > 0) {
      const interest = Math.floor(state.player.materials * (piggyPct / 100));
      if (interest > 0) {
        state.player.materials += interest;
        state.runStats.materialsCollected += interest;
      }
    }

    // 5. Demon HP conversion (converts 50% of remaining materials into Max HP)
    const matToHpRatio = stats.convert_materials_to_hp ?? 0;
    if (matToHpRatio > 0 && state.player.materials > 0) {
      const convertible = Math.floor(state.player.materials * 0.5);
      const ratio = Math.max(1, Math.floor(matToHpRatio));
      const hpGained = Math.floor(convertible / ratio);
      if (hpGained > 0) {
        state.player.materials -= hpGained * ratio;
        state.player.permanentStatMods.stat_max_hp =
          (state.player.permanentStatMods.stat_max_hp ?? 0) + hpGained;
        state.player.maxHp += hpGained;
        state.player.hp = Math.min(state.player.maxHp, state.player.hp + hpGained);
      }
    }

    state.harvestPaid = true;
  }

  // Victory check after Wave 20 unless continuing in Endless mode
  if (state.wave >= 20 && !state.isEndless && !state.victoryTriggered) {
    state.victoryTriggered = true;
    state.screen = 'victory';
    state.events.push({ type: 'victory', wave: state.wave });
    return;
  }

  advancePostWaveFlow(state, catalog, nextRand);
}

export function createEconomyHooks(): SimEconomyHooks {
  return {
    rollShop,
    buyShopOffer,
    lockShopOffer,
    rerollShop,
    combineWeapon,
    recycleWeapon,
    rollLevelUpOffers,
    pickLevelUpUpgrade,
    rerollLevelUpOffers,
    enqueueCrate,
    resolveCrate,
    onWaveEndProgression,
    getShopPrice,
    getRerollCost,
    getRecycleRefund,
    getRarityTierRoll,
  };
}
