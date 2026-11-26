import {
  NB_SHOP_ITEMS,
  PLAYER_DEFAULT_WEAPON_SLOTS,
  type EquippedWeaponState,
  type GameDataCatalog,
  type ItemDef,
  type ShopOffer,
  type SimState,
  type StatMap,
  type WeaponDef,
  type WeaponSetId,
} from '../contracts/index.ts';

function clamp(v: number, min: number, max: number): number {
  return v < min ? min : v > max ? max : v;
}

export function computeEndlessFactor(wave: number, isEndless: boolean): number {
  if (!isEndless && wave <= 20) return 0;
  const w = Math.max(0, wave - 20);
  if (w <= 0) return 0;
  return ((w * (w + 1)) / 2) / 100;
}

export function getShopPrice(
  baseValue: number,
  isWeapon: boolean,
  wave: number,
  isEndless: boolean,
  stats: StatMap,
): number {
  const safeWave = Math.max(1, wave);
  const endlessFactor = computeEndlessFactor(safeWave, isEndless);
  const weaponsPriceMod = stats.weapons_price ?? 0;
  const itemsPriceMod = stats.items_price ?? 0;
  const inflationMod = stats.inflation_modifier ?? 0;

  const baseMod = isWeapon
    ? baseValue * Math.max(0.1, 1 + weaponsPriceMod / 100)
    : baseValue;
  const inflation = 0.1 * Math.max(0, 1 + inflationMod / 100);
  const endlessMultPrice = 1 + endlessFactor / 5;
  const itemsPriceMult = Math.max(0.1, 1 + itemsPriceMod / 100);

  return Math.max(
    1,
    Math.round((baseMod + safeWave + baseMod * safeWave * inflation) * itemsPriceMult * endlessMultPrice),
  );
}

export function getRerollCost(
  wave: number,
  isEndless: boolean,
  rerollCount: number,
  stats: StatMap,
): number {
  const safeWave = Math.max(1, wave);
  const safeCount = Math.max(0, rerollCount);
  const endlessFactor = computeEndlessFactor(safeWave, isEndless);
  const delta = Math.max(1, Math.floor(0.4 * safeWave * Math.sqrt(1 + endlessFactor)));
  const normal = Math.floor(safeWave * 0.75) + delta + delta * safeCount;
  const rerollPriceMod = stats.reroll_price ?? 0;
  return Math.max(1, Math.ceil(normal * Math.max(0.1, 1 + rerollPriceMod / 100)));
}

export function getRecycleRefund(shopPrice: number, stats: StatMap): number {
  const recyclingGains = stats.recycling_gains ?? 0;
  const pct = clamp(0.25 + recyclingGains / 100, 0.01, 1.0);
  return Math.max(1, Math.floor(Math.max(1, shopPrice) * pct));
}

interface TierCurve {
  tier: 1 | 2 | 3;
  minWave: number;
  chancePerWave: number;
  maxChance: number;
}

const RARITY_CURVES: readonly TierCurve[] = [
  { tier: 3, minWave: 8, chancePerWave: 0.0023, maxChance: 0.08 },
  { tier: 2, minWave: 4, chancePerWave: 0.02, maxChance: 0.25 },
  { tier: 1, minWave: 2, chancePerWave: 0.06, maxChance: 0.6 },
];

export function getRarityTierRoll(
  wave: number,
  luck: number,
  nextRand: () => number,
): 0 | 1 | 2 | 3 {
  const safeWave = Math.max(1, wave);
  const luckMult = luck >= 0 ? 1 + luck / 100 : 1 / (1 + Math.abs(luck) / 100);

  for (let i = 0; i < RARITY_CURVES.length; i++) {
    const curve = RARITY_CURVES[i];
    if (safeWave < curve.minWave) continue;
    const baseChance = Math.min(curve.maxChance, (safeWave - curve.minWave + 1) * curve.chancePerWave);
    const finalChance = clamp(baseChance * luckMult, 0, 0.95);
    if (nextRand() < finalChance) {
      return curve.tier;
    }
  }
  return 0;
}

function toDisplayPrice(rawPrice: number, stats: StatMap): number {
  if ((stats.hp_shop ?? 0) > 0) {
    return Math.max(1, Math.ceil(rawPrice * 0.5));
  }
  return rawPrice;
}

function pickRandom<T>(arr: readonly T[], nextRand: () => number): T {
  const idx = Math.min(arr.length - 1, Math.floor(nextRand() * arr.length));
  return arr[idx];
}

function recomputeActiveSets(state: SimState, catalog: GameDataCatalog): void {
  const counts: Partial<Record<WeaponSetId, number>> = {};
  for (let i = 0; i < state.player.weapons.length; i++) {
    const wDef = catalog.weaponsById[state.player.weapons[i].weaponId];
    if (!wDef) continue;
    for (let s = 0; s < wDef.sets.length; s++) {
      const setId = wDef.sets[s];
      counts[setId] = (counts[setId] ?? 0) + 1;
    }
  }
  state.player.activeSetCounts = counts;
}

function getWeaponTierRange(stats: StatMap): { minTier: 1 | 2 | 3 | 4; maxTier: 1 | 2 | 3 | 4 } {
  const rawMin = stats.min_weapon_tier ?? 0;
  const rawMax = stats.max_weapon_tier ?? 0;
  const minTier = clamp(rawMin > 0 ? Math.round(rawMin) : 1, 1, 4) as 1 | 2 | 3 | 4;
  const maxTier = clamp(rawMax > 0 ? Math.round(rawMax) : 4, minTier, 4) as 1 | 2 | 3 | 4;
  return { minTier, maxTier };
}

function getEligibleWeapons(catalog: GameDataCatalog, stats: StatMap): WeaponDef[] {
  if ((stats.no_weapons ?? 0) > 0) return [];
  const noMelee = (stats.no_melee_weapons ?? 0) > 0;
  const noRanged = (stats.no_ranged_weapons ?? 0) > 0;
  const { minTier, maxTier } = getWeaponTierRange(stats);

  return catalog.weapons.filter((w) => {
    if (noMelee && w.kind === 'melee') return false;
    if (noRanged && w.kind === 'ranged') return false;
    if (w.minTier > maxTier || w.maxTier < minTier) return false;
    return true;
  });
}

function resolveWeaponTier(
  weapon: WeaponDef,
  rolledTier: 1 | 2 | 3 | 4,
  minAllowed: 1 | 2 | 3 | 4,
  maxAllowed: 1 | 2 | 3 | 4,
): 1 | 2 | 3 | 4 {
  const lo = Math.max(weapon.minTier, minAllowed);
  const hi = Math.min(weapon.maxTier, maxAllowed);
  const target = clamp(rolledTier, lo, hi) as 1 | 2 | 3 | 4;
  if (weapon.tiers[target]) return target;
  for (let t = target; t >= 1; t--) {
    if (weapon.tiers[t as 1 | 2 | 3 | 4]) return t as 1 | 2 | 3 | 4;
  }
  for (let t = target; t <= 4; t++) {
    if (weapon.tiers[t as 1 | 2 | 3 | 4]) return t as 1 | 2 | 3 | 4;
  }
  return 1;
}

function rollWeaponOffer(
  slotIndex: number,
  state: SimState,
  catalog: GameDataCatalog,
  eligibleWeapons: readonly WeaponDef[],
  usedKeys: Set<string>,
  nextRand: () => number,
): ShopOffer | null {
  if (eligibleWeapons.length === 0) return null;
  const stats = state.player.computedStats;
  const { minTier, maxTier } = getWeaponTierRange(stats);

  const rolledTier0 = getRarityTierRoll(state.wave, stats.stat_luck ?? 0, nextRand);
  const desiredTier = clamp(rolledTier0 + 1, minTier, maxTier) as 1 | 2 | 3 | 4;

  // Match weapons that naturally support the desired tier, falling back if none
  let tierPool = eligibleWeapons.filter(
    (w) => w.minTier <= desiredTier && w.maxTier >= desiredTier && Boolean(w.tiers[desiredTier]),
  );
  if (tierPool.length === 0) {
    tierPool = [...eligibleWeapons];
  }

  // Owned weapon synergy bias (SPEC.md section 4)
  const ownedWeaponIds = new Set<string>();
  const ownedSetIds = new Set<WeaponSetId>();
  for (let i = 0; i < state.player.weapons.length; i++) {
    const owned = state.player.weapons[i];
    ownedWeaponIds.add(owned.weaponId);
    const def = catalog.weaponsById[owned.weaponId];
    if (def) {
      for (let s = 0; s < def.sets.length; s++) {
        ownedSetIds.add(def.sets[s]);
      }
    }
  }

  let candidatePool: readonly WeaponDef[] = tierPool;
  const uniqueOwned = ownedWeaponIds.size;

  if (uniqueOwned > 0) {
    const sameWeaponChance = 0.23 + 0.02 * Math.min(6, uniqueOwned) + 0.07;
    const sameSetChance = 0.35 + 0.01 * Math.min(6, uniqueOwned) + 0.20;

    if (nextRand() < sameWeaponChance) {
      const samePool = tierPool.filter((w) => ownedWeaponIds.has(w.id));
      if (samePool.length > 0) candidatePool = samePool;
    } else if (ownedSetIds.size > 0 && nextRand() < sameSetChance) {
      const setPool = tierPool.filter((w) => w.sets.some((s) => ownedSetIds.has(s)));
      if (setPool.length > 0) candidatePool = setPool;
    }
  }

  // Character wanted-tag bias
  const charDef = catalog.charactersById[state.player.characterId];
  if (charDef && charDef.wantedTags.length > 0 && nextRand() < 0.1) {
    const tagged = candidatePool.filter((w) =>
      w.tags.some((t) => charDef.wantedTags.includes(t)),
    );
    if (tagged.length > 0) candidatePool = tagged;
  }

  // Prefer weapons not already offered in the same shop roll
  const freshPool = candidatePool.filter((w) => {
    const resolved = resolveWeaponTier(w, desiredTier, minTier, maxTier);
    return !usedKeys.has(`weapon:${w.id}:${resolved}`);
  });
  const finalPool = freshPool.length > 0 ? freshPool : candidatePool;
  const chosen = pickRandom(finalPool, nextRand);
  const actualTier = resolveWeaponTier(chosen, desiredTier, minTier, maxTier);
  const tierStats = chosen.tiers[actualTier]!;
  const rawPrice = getShopPrice(tierStats.value, true, state.wave, state.isEndless, stats);
  const price = toDisplayPrice(rawPrice, stats);

  usedKeys.add(`weapon:${chosen.id}:${actualTier}`);
  return {
    slotIndex,
    kind: 'weapon',
    defId: chosen.id,
    tier: (actualTier - 1) as 0 | 1 | 2 | 3,
    price,
    locked: false,
    purchased: false,
  };
}

function getEligibleItems(
  state: SimState,
  catalog: GameDataCatalog,
  slotItemCounts: Map<string, number>,
): ItemDef[] {
  return catalog.items.filter((item) => {
    if (item.maxCount < 0) return true;
    const owned = state.player.itemCounts[item.id] ?? 0;
    const inShop = slotItemCounts.get(item.id) ?? 0;
    return owned + inShop < item.maxCount;
  });
}

function rollItemOffer(
  slotIndex: number,
  state: SimState,
  catalog: GameDataCatalog,
  usedKeys: Set<string>,
  slotItemCounts: Map<string, number>,
  nextRand: () => number,
): ShopOffer | null {
  const eligible = getEligibleItems(state, catalog, slotItemCounts);
  if (eligible.length === 0) return null;

  const stats = state.player.computedStats;
  const targetTier = getRarityTierRoll(state.wave, stats.stat_luck ?? 0, nextRand);

  let tierPool: ItemDef[] = [];
  for (let t = targetTier; t >= 0; t--) {
    tierPool = eligible.filter((it) => it.tier === t);
    if (tierPool.length > 0) break;
  }
  if (tierPool.length === 0) {
    tierPool = eligible;
  }

  // Character wanted-tag bias
  let candidatePool: readonly ItemDef[] = tierPool;
  const charDef = catalog.charactersById[state.player.characterId];
  if (charDef && charDef.wantedTags.length > 0 && nextRand() < 0.1) {
    const tagged = tierPool.filter((it) =>
      it.tags.some((t) => charDef.wantedTags.includes(t)),
    );
    if (tagged.length > 0) candidatePool = tagged;
  }

  const freshPool = candidatePool.filter((it) => !usedKeys.has(`item:${it.id}`));
  const finalPool = freshPool.length > 0 ? freshPool : candidatePool;
  const chosen = pickRandom(finalPool, nextRand);
  const rawPrice = getShopPrice(chosen.value, false, state.wave, state.isEndless, stats);
  const price = toDisplayPrice(rawPrice, stats);

  usedKeys.add(`item:${chosen.id}`);
  slotItemCounts.set(chosen.id, (slotItemCounts.get(chosen.id) ?? 0) + 1);

  return {
    slotIndex,
    kind: 'item',
    defId: chosen.id,
    tier: chosen.tier,
    price,
    locked: false,
    purchased: false,
  };
}

export function rollShop(
  state: SimState,
  catalog: GameDataCatalog,
  nextRand: () => number,
  preserveLocked: boolean,
): void {
  const stats = state.player.computedStats;
  const eligibleWeapons = getEligibleWeapons(catalog, stats);
  const canRollWeapons = eligibleWeapons.length > 0;

  const nextOffers: Array<ShopOffer | null> = new Array<ShopOffer | null>(NB_SHOP_ITEMS).fill(null);
  const usedKeys = new Set<string>();
  const slotItemCounts = new Map<string, number>();

  let lockedWeaponCount = 0;
  const unlockedIndices: number[] = [];

  for (let i = 0; i < NB_SHOP_ITEMS; i++) {
    const prev = state.shop.offers[i];
    if (preserveLocked && prev && prev.locked && !prev.purchased) {
      let refreshedPrice = prev.price;
      if (prev.kind === 'weapon') {
        const wDef = catalog.weaponsById[prev.defId];
        const wTier = clamp(prev.tier + 1, 1, 4) as 1 | 2 | 3 | 4;
        const tStats = wDef?.tiers[wTier];
        if (tStats) {
          refreshedPrice = toDisplayPrice(
            getShopPrice(tStats.value, true, state.wave, state.isEndless, stats),
            stats,
          );
        }
        lockedWeaponCount++;
        usedKeys.add(`weapon:${prev.defId}:${wTier}`);
      } else {
        const iDef = catalog.itemsById[prev.defId];
        if (iDef) {
          refreshedPrice = toDisplayPrice(
            getShopPrice(iDef.value, false, state.wave, state.isEndless, stats),
            stats,
          );
        }
        usedKeys.add(`item:${prev.defId}`);
        slotItemCounts.set(prev.defId, (slotItemCounts.get(prev.defId) ?? 0) + 1);
      }

      nextOffers[i] = {
        ...prev,
        slotIndex: i,
        price: refreshedPrice,
      };
    } else {
      unlockedIndices.push(i);
    }
  }

  // Guaranteed weapon counts: Waves 1-2 >= 2 weapons, Waves 3-5 >= 1 weapon, W6+ 35% chance
  const minWeapons = !canRollWeapons
    ? 0
    : state.wave <= 2
      ? 2
      : state.wave <= 5
        ? 1
        : 0;
  let guaranteedRemaining = Math.max(0, minWeapons - lockedWeaponCount);

  for (let u = 0; u < unlockedIndices.length; u++) {
    const slotIndex = unlockedIndices[u];
    const forceWeapon = canRollWeapons && guaranteedRemaining > 0;
    const rollWeapon = forceWeapon || (canRollWeapons && nextRand() < 0.35);

    let offer: ShopOffer | null = null;
    if (rollWeapon) {
      offer = rollWeaponOffer(slotIndex, state, catalog, eligibleWeapons, usedKeys, nextRand);
      if (offer && guaranteedRemaining > 0) {
        guaranteedRemaining--;
      }
    }
    if (!offer) {
      offer = rollItemOffer(slotIndex, state, catalog, usedKeys, slotItemCounts, nextRand);
    }
    if (!offer && canRollWeapons) {
      offer = rollWeaponOffer(slotIndex, state, catalog, eligibleWeapons, usedKeys, nextRand);
    }
    if (offer) {
      nextOffers[slotIndex] = offer;
    }
  }

  state.shop.offers = nextOffers.filter((o): o is ShopOffer => o !== null);
  state.shop.rerollCost = getRerollCost(state.wave, state.isEndless, state.shop.rerollCount, stats);
}

function createEquippedWeapon(
  state: SimState,
  weaponId: string,
  tier: 1 | 2 | 3 | 4,
): EquippedWeaponState {
  return {
    uid: state.nextUid++,
    weaponId,
    tier,
    cooldownTicks: 0,
    maxCooldownTicks: 10,
    aimAngle: 0,
    recoilOffset: 0,
    recoilTimer: 0,
    swingTimer: 0,
    swingDuration: 0,
    swingType: 0,
    swingDir: 1,
    alternateNext: 0,
    targetEnemyUid: -1,
    killsThisRun: 0,
    bonusDamage: 0,
    worldX: state.player.x,
    worldY: state.player.y,
    prevWorldX: state.player.x,
    prevWorldY: state.player.y,
  };
}

function canAffordOffer(state: SimState, price: number): boolean {
  const hpShop = (state.player.computedStats.hp_shop ?? 0) > 0;
  if (hpShop) {
    return state.player.maxHp - price >= 1;
  }
  return state.player.materials >= price;
}

function payForOffer(state: SimState, price: number): void {
  const hpShop = (state.player.computedStats.hp_shop ?? 0) > 0;
  if (hpShop) {
    state.player.permanentStatMods.stat_max_hp =
      (state.player.permanentStatMods.stat_max_hp ?? 0) - price;
    state.player.maxHp = Math.max(1, state.player.maxHp - price);
    state.player.hp = Math.min(state.player.hp, state.player.maxHp);
    state.player.computedStats.stat_max_hp = state.player.maxHp;
  } else {
    state.player.materials -= price;
  }
}

export function buyShopOffer(
  state: SimState,
  catalog: GameDataCatalog,
  slotIndex: number,
  _nextRand: () => number,
): boolean {
  if (slotIndex < 0 || slotIndex >= state.shop.offers.length) return false;
  const offer = state.shop.offers[slotIndex];
  if (!offer || offer.purchased) return false;
  if (!canAffordOffer(state, offer.price)) return false;

  const stats = state.player.computedStats;

  if (offer.kind === 'weapon') {
    const wDef = catalog.weaponsById[offer.defId];
    if (!wDef) return false;
    if ((stats.no_weapons ?? 0) > 0) return false;
    if (wDef.kind === 'melee' && (stats.no_melee_weapons ?? 0) > 0) return false;
    if (wDef.kind === 'ranged' && (stats.no_ranged_weapons ?? 0) > 0) return false;

    const weaponTier = clamp(offer.tier + 1, 1, 4) as 1 | 2 | 3 | 4;
    const maxSlots =
      (stats.single_weapon_only ?? 0) > 0
        ? 1
        : Math.max(1, Math.floor(stats.weapon_slot || PLAYER_DEFAULT_WEAPON_SLOTS));

    if (state.player.weapons.length < maxSlots) {
      payForOffer(state, offer.price);
      state.player.weapons.push(createEquippedWeapon(state, wDef.id, weaponTier));
      recomputeActiveSets(state, catalog);
      offer.purchased = true;
      offer.locked = false;
      state.events.push({ type: 'shop_buy', kind: 'weapon', defId: wDef.id });
      return true;
    }

    // Slots full -> auto-combine if an identical lower-tier weapon exists
    if (weaponTier < 4 && weaponTier < wDef.maxTier) {
      const match = state.player.weapons.find(
        (w) => w.weaponId === wDef.id && w.tier === weaponTier,
      );
      if (match) {
        payForOffer(state, offer.price);
        match.tier = (match.tier + 1) as 1 | 2 | 3 | 4;
        recomputeActiveSets(state, catalog);
        offer.purchased = true;
        offer.locked = false;
        state.events.push({ type: 'shop_combine', weaponId: wDef.id, newTier: match.tier });
        return true;
      }
    }

    return false;
  }

  // Item purchase
  const itemDef = catalog.itemsById[offer.defId];
  if (!itemDef) return false;
  const ownedCount = state.player.itemCounts[itemDef.id] ?? 0;
  if (itemDef.maxCount > 0 && ownedCount >= itemDef.maxCount) return false;

  payForOffer(state, offer.price);
  state.player.items.push(itemDef.id);
  state.player.itemCounts[itemDef.id] = ownedCount + 1;
  offer.purchased = true;
  offer.locked = false;
  state.events.push({ type: 'shop_buy', kind: 'item', defId: itemDef.id });
  return true;
}

export function lockShopOffer(state: SimState, slotIndex: number): boolean {
  if (slotIndex < 0 || slotIndex >= state.shop.offers.length) return false;
  const offer = state.shop.offers[slotIndex];
  if (!offer || offer.purchased) return false;
  offer.locked = !offer.locked;
  return true;
}

export function rerollShop(
  state: SimState,
  catalog: GameDataCatalog,
  nextRand: () => number,
): boolean {
  const stats = state.player.computedStats;
  if (state.shop.freeRerollsLeft > 0) {
    state.shop.freeRerollsLeft -= 1;
  } else {
    const cost = getRerollCost(state.wave, state.isEndless, state.shop.rerollCount, stats);
    if (state.player.materials < cost) return false;
    state.player.materials -= cost;
    state.shop.rerollCount += 1;
  }

  rollShop(state, catalog, nextRand, true);
  state.events.push({ type: 'shop_reroll' });
  return true;
}

export function combineWeapon(
  state: SimState,
  catalog: GameDataCatalog,
  weaponUid: number,
): boolean {
  const idxA = state.player.weapons.findIndex((w) => w.uid === weaponUid);
  if (idxA === -1) return false;

  const wA = state.player.weapons[idxA];
  const wDef = catalog.weaponsById[wA.weaponId];
  if (!wDef || wA.tier >= 4 || wA.tier >= wDef.maxTier) return false;

  const idxB = state.player.weapons.findIndex(
    (w, i) => i !== idxA && w.weaponId === wA.weaponId && w.tier === wA.tier,
  );
  if (idxB === -1) return false;

  const wB = state.player.weapons[idxB];
  wA.tier = (wA.tier + 1) as 1 | 2 | 3 | 4;
  wA.killsThisRun += wB.killsThisRun;
  wA.bonusDamage += wB.bonusDamage;
  state.player.weapons.splice(idxB, 1);

  recomputeActiveSets(state, catalog);
  state.events.push({ type: 'shop_combine', weaponId: wA.weaponId, newTier: wA.tier });
  return true;
}

export function recycleWeapon(
  state: SimState,
  catalog: GameDataCatalog,
  weaponUid: number,
): boolean {
  const idx = state.player.weapons.findIndex((w) => w.uid === weaponUid);
  if (idx === -1) return false;

  const weapon = state.player.weapons[idx];
  const wDef = catalog.weaponsById[weapon.weaponId];
  const tierStats = wDef?.tiers[weapon.tier] ?? wDef?.tiers[1];
  const baseValue = tierStats ? tierStats.value : 15;

  const stats = state.player.computedStats;
  const shopPrice = getShopPrice(baseValue, true, state.wave, state.isEndless, stats);
  const refund = getRecycleRefund(shopPrice, stats);

  state.player.weapons.splice(idx, 1);
  state.player.materials += refund;
  recomputeActiveSets(state, catalog);
  state.events.push({ type: 'shop_recycle', refund });
  return true;
}
