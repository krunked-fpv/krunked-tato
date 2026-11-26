// ============================================================================
// src/ui/ShopScreen.ts
// Complete Inter-Wave Shop UI:
// - 4 lockable Shop Offer cards with rarity glow, stats/effects, BUY & LOCK
// - REROLL button (free reroll + material cost), prominent GO (WAVE N+1) CTA
// - Equipped Weapons panel with tap/focus selection, COMBINE (gold highlight
//   when matching duplicate exists) & RECYCLE actions
// - Active Weapon Set synergy badges + Owned Items strip with tap inspector
// - Full 16-stat right sidebar (collapses cleanly on mobile)
// ============================================================================

import {
  RARITY_NAMES,
  type EquippedWeaponState,
  type GameDataCatalog,
  type InputMode,
  type ShopOffer,
  type SimState,
  type UIManagerCallbacks,
  type WeaponSetId,
} from '../contracts/index';
import type { AssetRegistry } from '../assets/AssetRegistry';
import {
  escapeHtml,
  formatEffectLine,
  getRarityColor,
  renderCoreStatsGridHtml,
  renderGlyph,
} from './styles';

export interface ShopRenderContext {
  state: SimState;
  catalog: GameDataCatalog;
  assetRegistry: AssetRegistry;
  inputMode: InputMode;
  callbacks: UIManagerCallbacks;
  selectedWeaponUid: number | null;
  inspectedItemId: string | null;
  onSelectWeaponUid(uid: number | null): void;
  onInspectItemId(id: string | null): void;
}

function hasCombinableDuplicate(weapons: readonly EquippedWeaponState[], target: EquippedWeaponState): boolean {
  if (target.tier >= 4) return false;
  let matches = 0;
  for (const w of weapons) {
    if (w.weaponId === target.weaponId && w.tier === target.tier) matches++;
  }
  return matches >= 2;
}

function canBuyOffer(state: SimState, offer: ShopOffer): { affordable: boolean; willAutoCombine: boolean; usesHp: boolean } {
  const usesHp = (state.player.computedStats.hp_shop ?? 0) > 0;
  const affordable = usesHp
    ? state.player.maxHp - offer.price >= 1
    : state.player.materials >= offer.price;

  if (offer.kind === 'item') {
    return { affordable, willAutoCombine: false, usesHp };
  }

  const maxSlots = Math.max(1, Math.round(state.player.computedStats.weapon_slot || 6));
  const tierNum = Math.min(4, Math.max(1, offer.tier + 1)) as 1 | 2 | 3 | 4;
  if (state.player.weapons.length < maxSlots) {
    return { affordable, willAutoCombine: false, usesHp };
  }
  // Check if auto-combine with an owned matching weapon of same tier < 4 is possible
  const canAutoCombine =
    tierNum < 4 &&
    state.player.weapons.some((w) => w.weaponId === offer.defId && w.tier === tierNum);
  return { affordable: affordable && canAutoCombine, willAutoCombine: canAutoCombine, usesHp };
}

export function renderShopScreen(container: HTMLElement, ctx: ShopRenderContext): void {
  const {
    state,
    catalog,
    assetRegistry,
    inputMode,
    callbacks,
    selectedWeaponUid,
    inspectedItemId,
    onSelectWeaponUid,
    onInspectItemId,
  } = ctx;

  const p = state.player;
  const shop = state.shop;
  const maxSlots = Math.max(1, Math.round(p.computedStats.weapon_slot || 6));
  const rerollFree = shop.freeRerollsLeft > 0;
  const canReroll = rerollFree || p.materials >= shop.rerollCost;

  // Ensure selectedWeaponUid points to a valid weapon if any exist
  const activeWeapon =
    p.weapons.find((w) => w.uid === selectedWeaponUid) ?? p.weapons[0] ?? null;

  // 4 Shop Offer Cards
  const offersHtml = shop.offers
    .map((offer) => {
      const rarityColor = getRarityColor(offer.tier);
      const rarityName = RARITY_NAMES[offer.tier] ?? 'Common';
      const check = canBuyOffer(state, offer);

      let title = offer.defId;
      let subtitle = rarityName;
      let spriteId = `item_${offer.defId}`;
      let detailLines: Array<{ text: string; tone: 'pos' | 'neg' | 'neutral' }> = [];

      if (offer.kind === 'weapon') {
        const wDef = catalog.weaponsById[offer.defId];
        const tierNum = Math.min(4, Math.max(1, offer.tier + 1)) as 1 | 2 | 3 | 4;
        const stats = wDef?.tiers[tierNum] ?? wDef?.tiers[wDef.minTier];
        title = wDef?.name ?? offer.defId;
        subtitle = `T${tierNum} ${wDef?.kind.toUpperCase() ?? 'WEAPON'} · ${(wDef?.sets ?? []).join(', ')}`;
        spriteId = wDef?.spriteId || `weapon_${offer.defId}`;
        if (stats) {
          detailLines = [
            { text: `DMG ${stats.damage} · CD ${(stats.cooldown / 60).toFixed(2)}s · RNG ${stats.maxRange}`, tone: 'neutral' },
            { text: `Crit ${Math.round(stats.critChance * 100)}% (x${stats.critDamage})`, tone: 'pos' },
          ];
          if (stats.projectiles > 1) detailLines.push({ text: `${stats.projectiles} Projectiles`, tone: 'pos' });
          if (stats.piercing > 0) detailLines.push({ text: `Pierce ${stats.piercing}`, tone: 'pos' });
          if (stats.bounce > 0) detailLines.push({ text: `Bounce ${stats.bounce}`, tone: 'pos' });
          if (stats.explosionRadius > 0) detailLines.push({ text: `Explosion ${stats.explosionRadius}px`, tone: 'pos' });
        }
      } else {
        const iDef = catalog.itemsById[offer.defId];
        title = iDef?.name ?? offer.defId;
        subtitle = `${rarityName} Item`;
        spriteId = iDef?.spriteId || `item_${offer.defId}`;
        if (iDef) {
          detailLines = iDef.effects.slice(0, 4).map(formatEffectLine);
          if (detailLines.length === 0 && iDef.description) {
            detailLines.push({ text: iDef.description, tone: 'neutral' });
          }
        }
      }

      const iconUrl = assetRegistry.getIconDataUrl(spriteId);
      const buyLabel = offer.purchased
        ? 'SOLD'
        : check.willAutoCombine
          ? `MERGE (${offer.price}${check.usesHp ? ' HP' : ''})`
          : `BUY (${offer.price}${check.usesHp ? ' HP' : ''})`;

      return `
        <div class="kt-offer-card ${offer.purchased ? 'kt-offer-sold' : ''}" style="border-color:${rarityColor}">
          <div>
            <div class="kt-offer-top">
              <img class="kt-offer-icon" src="${iconUrl}" alt="${escapeHtml(title)}" style="border-color:${rarityColor}" />
              <div style="min-width:0">
                <div style="font-size:15px;font-weight:900;color:${rarityColor};line-height:1.15">${escapeHtml(title)}</div>
                <div style="font-size:11px;font-weight:800;color:var(--kt-muted);margin-top:2px">${escapeHtml(subtitle)}</div>
              </div>
            </div>
            <div class="kt-effects-list" style="margin-top:8px;font-size:12px">
              ${detailLines
                .map((l) => {
                  const cls = l.tone === 'pos' ? 'kt-pos' : l.tone === 'neg' ? 'kt-neg' : 'kt-neu';
                  return `<div class="${cls}">${escapeHtml(l.text)}</div>`;
                })
                .join('')}
            </div>
          </div>

          <div class="kt-offer-actions">
            <button
              type="button"
              class="kt-btn ${offer.purchased ? '' : check.affordable ? 'kt-btn-primary' : ''}"
              data-focusable="true"
              data-focus-group="shop-offers"
              data-shop-buy="${offer.slotIndex}"
              ${offer.purchased || !check.affordable ? 'disabled' : ''}
            >
              ${escapeHtml(buyLabel)}
            </button>
            <button
              type="button"
              class="kt-btn ${offer.locked ? 'kt-btn-cyan' : ''}"
              style="flex:0 0 auto;min-width:60px"
              data-focusable="true"
              data-focus-group="shop-offers"
              data-shop-lock="${offer.slotIndex}"
              ${offer.purchased ? 'disabled' : ''}
            >
              ${offer.locked ? 'LOCKED' : 'LOCK'}
            </button>
          </div>
        </div>
      `;
    })
    .join('');

  // Equipped Weapons Panel
  const weaponsHtml = p.weapons
    .map((w) => {
      const def = catalog.weaponsById[w.weaponId];
      const name = def?.name ?? w.weaponId;
      const col = getRarityColor(w.tier - 1);
      const isSel = activeWeapon?.uid === w.uid;
      const canMerge = hasCombinableDuplicate(p.weapons, w);
      const iconUrl = assetRegistry.getIconDataUrl(def?.spriteId || `weapon_${w.weaponId}`);
      return `
        <button
          type="button"
          class="kt-weapon-slot ${isSel ? 'kt-selected' : ''}"
          style="border-color:${isSel ? '#ffe142' : col}"
          data-focusable="true"
          data-focus-group="weapons"
          data-weapon-uid="${w.uid}"
        >
          <img src="${iconUrl}" alt="${escapeHtml(name)}" />
          <div style="font-size:11px;font-weight:900;color:${col};line-height:1.1">${escapeHtml(name)}</div>
          <div style="font-size:10px;font-weight:800;color:${canMerge ? '#ffe142' : '#aba6bc'}">
            T${w.tier}${canMerge ? ' ★ MERGE' : ''}
          </div>
        </button>
      `;
    })
    .join('');

  const activeCanCombine = activeWeapon ? hasCombinableDuplicate(p.weapons, activeWeapon) : false;

  // Active Weapon Set Synergy Badges
  const setEntries = Object.entries(p.activeSetCounts).filter(([, count]) => (count ?? 0) >= 2) as Array<
    [WeaponSetId, number]
  >;
  const setsHtml =
    setEntries.length > 0
      ? setEntries
          .map(([setId, count]) => {
            const setDef = catalog.setsById[setId];
            const clamped = Math.min(6, count);
            const bonusSummary = (setDef?.bonuses[clamped] ?? [])
              .map((e) => formatEffectLine(e).text)
              .slice(0, 2)
              .join(', ');
            return `<span class="kt-set-badge">${escapeHtml(setDef?.name ?? setId)} (${count})${bonusSummary ? `: ${escapeHtml(bonusSummary)}` : ''}</span>`;
          })
          .join('')
      : '<span style="font-size:12px;color:var(--kt-muted);font-weight:700">Equip 2+ weapons from the same set for synergy bonuses.</span>';

  // Owned Items Bar
  const uniqueOwned = Object.entries(p.itemCounts).filter(([, c]) => c > 0);
  const itemsHtml =
    uniqueOwned.length > 0
      ? uniqueOwned
          .map(([itemId, count]) => {
            const def = catalog.itemsById[itemId];
            const col = getRarityColor(def?.tier ?? 0);
            const icon = assetRegistry.getIconDataUrl(def?.spriteId || `item_${itemId}`);
            return `<button
              type="button"
              class="kt-item-chip ${inspectedItemId === itemId ? 'kt-selected' : ''}"
              style="border-color:${inspectedItemId === itemId ? '#ffe142' : col}"
              data-focusable="true"
              data-focus-group="items"
              data-inspect-item="${escapeHtml(itemId)}"
              aria-label="${escapeHtml(def?.name ?? itemId)}"
            >
              <img src="${icon}" alt="${escapeHtml(def?.name ?? itemId)}" />
              ${count > 1 ? `<span class="kt-item-count">x${count}</span>` : ''}
            </button>`;
          })
          .join('')
      : '<span style="font-size:12px;color:var(--kt-muted);font-weight:700">No items owned yet.</span>';

  const inspectedItem = inspectedItemId ? catalog.itemsById[inspectedItemId] : null;

  container.innerHTML = `
    <div class="kt-screen">
      <div class="kt-header">
        <div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap">
          <h2 class="kt-header-title">SHOP — WAVE ${state.wave}</h2>
          <div class="kt-mat-pill">◆ ${Math.floor(p.materials)}</div>
          ${p.bonusGold > 0 ? `<div class="kt-bag-pill">BAG +${Math.floor(p.bonusGold)} (2x)</div>` : ''}
        </div>
        <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
          <button
            type="button"
            class="kt-btn ${canReroll ? 'kt-btn-cyan' : ''}"
            data-focusable="true"
            data-focus-group="header"
            data-action="reroll"
            ${canReroll ? '' : 'disabled'}
          >
            ${renderGlyph(inputMode, 'X', 'R')} ${rerollFree ? `FREE REROLL (${shop.freeRerollsLeft})` : `REROLL (${shop.rerollCost})`}
          </button>
          <button
            type="button"
            class="kt-btn kt-btn-go"
            data-focusable="true"
            data-focus-group="header"
            data-focus-default="true"
            data-action="next-wave"
          >
            GO (WAVE ${state.wave + 1}) ${renderGlyph(inputMode, 'START')}
          </button>
        </div>
      </div>

      <div class="kt-shop-body">
        <div class="kt-shop-main">
          <div class="kt-shop-offers">${offersHtml}</div>

          <div class="kt-shop-bottom-row">
            <div class="kt-panel kt-subpanel">
              <div class="kt-subpanel-title">
                <span>WEAPONS (${p.weapons.length} / ${maxSlots})</span>
                <div style="display:flex;gap:6px">
                  <button
                    type="button"
                    class="kt-btn kt-btn-sm ${activeCanCombine ? 'kt-btn-primary' : ''}"
                    data-focusable="true"
                    data-focus-group="weapons"
                    data-action="combine"
                    ${activeWeapon && activeCanCombine ? '' : 'disabled'}
                  >
                    ${renderGlyph(inputMode, 'Y', 'L')} COMBINE
                  </button>
                  <button
                    type="button"
                    class="kt-btn kt-btn-sm kt-btn-danger"
                    data-focusable="true"
                    data-focus-group="weapons"
                    data-action="recycle"
                    ${activeWeapon ? '' : 'disabled'}
                  >
                    ${renderGlyph(inputMode, 'X')} RECYCLE
                  </button>
                </div>
              </div>
              <div class="kt-weapons-grid">${weaponsHtml || '<span style="font-size:12px;color:var(--kt-muted)">No weapons equipped</span>'}</div>
              <div class="kt-set-badges">${setsHtml}</div>
            </div>

            <div class="kt-panel kt-subpanel">
              <div class="kt-subpanel-title">
                <span>OWNED ITEMS (${p.items.length})</span>
                <span style="font-size:11px;color:var(--kt-muted)">${inputMode === 'touch' ? 'TAP TO INSPECT' : inputMode === 'gamepad' ? 'SELECT TO INSPECT' : 'CLICK TO INSPECT'}</span>
              </div>
              <div class="kt-items-strip">${itemsHtml}</div>
              ${
                inspectedItem
                  ? `<div style="margin-top:auto;padding:8px;border-radius:9px;background:rgba(0,0,0,0.28);font-size:12px">
                      <div style="font-weight:900;color:${getRarityColor(inspectedItem.tier)}">${escapeHtml(inspectedItem.name)}</div>
                      <div style="color:#d6d1e6;margin-top:2px">${escapeHtml(inspectedItem.description || inspectedItem.effects.map((e) => formatEffectLine(e).text).join(' · '))}</div>
                    </div>`
                  : ''
              }
            </div>
          </div>
        </div>

        <aside class="kt-panel kt-stats-sidebar">
          <div class="kt-subpanel-title" style="margin-bottom:4px">
            <span>STATS</span>
            <span>LV ${p.level}</span>
          </div>
          ${renderCoreStatsGridHtml(p.computedStats)}
        </aside>
      </div>
    </div>
  `;

  container.querySelector('[data-action="reroll"]')?.addEventListener('click', () => {
    callbacks.onPlayUiClick('reroll');
    callbacks.onCommand({ type: 'shop_reroll' });
  });

  container.querySelector('[data-action="next-wave"]')?.addEventListener('click', () => {
    callbacks.onPlayUiClick('confirm');
    callbacks.onCommand({ type: 'shop_next_wave' });
  });

  container.querySelectorAll<HTMLButtonElement>('[data-shop-buy]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const idx = Number(btn.dataset.shopBuy);
      callbacks.onPlayUiClick('buy');
      callbacks.onCommand({ type: 'shop_buy', slotIndex: idx });
    });
  });

  container.querySelectorAll<HTMLButtonElement>('[data-shop-lock]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const idx = Number(btn.dataset.shopLock);
      callbacks.onPlayUiClick('hover');
      callbacks.onCommand({ type: 'shop_lock', slotIndex: idx });
    });
  });

  container.querySelectorAll<HTMLButtonElement>('[data-weapon-uid]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const uid = Number(btn.dataset.weaponUid);
      callbacks.onPlayUiClick('hover');
      onSelectWeaponUid(uid);
    });
  });

  container.querySelector('[data-action="combine"]')?.addEventListener('click', () => {
    if (!activeWeapon) return;
    callbacks.onPlayUiClick('combine');
    callbacks.onCommand({ type: 'shop_combine', weaponUid: activeWeapon.uid });
  });

  container.querySelector('[data-action="recycle"]')?.addEventListener('click', () => {
    if (!activeWeapon) return;
    callbacks.onPlayUiClick('cancel');
    callbacks.onCommand({ type: 'shop_recycle', weaponUid: activeWeapon.uid });
  });

  container.querySelectorAll<HTMLButtonElement>('[data-inspect-item]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const id = btn.dataset.inspectItem ?? null;
      callbacks.onPlayUiClick('hover');
      onInspectItemId(inspectedItemId === id ? null : id);
    });
  });
}
