// ============================================================================
// src/ui/Modals.ts
// Modals & Secondary Screens:
// - End-of-Wave Crate Modal (Wooden / Red Legendary, KEEP vs RECYCLE)
// - Level-Up 4-Card Upgrade Picker (with REROLL)
// - Pause Menu (Resume / Options / Abandon Run)
// - Options Screen (FPS 30/60/120, Classic 60 Snap, VFX toggles, Audio sliders,
//   Touch Opacity & Left-Handed layout, Asset Mode switcher, 2-step Reset Save)
// - Codex (Characters / Weapons / Items / Challenges with LB/RB tabs)
// - Victory (CONTINUE ENDLESS + MAIN MENU) & Game Over Run Summary
// ============================================================================

import {
  RARITY_NAMES,
  SIM_HZ,
  type CustomPackStatus,
  type GameDataCatalog,
  type InputMode,
  type SaveData,
  type SimState,
  type TargetFps,
  type UIManagerCallbacks,
} from '../contracts/index';
import type { AssetRegistry } from '../assets/AssetRegistry';
import {
  escapeHtml,
  formatEffectLine,
  formatSignedStat,
  formatStatName,
  getRarityColor,
  renderGlyph,
} from './styles';

export type CodexTab = 'characters' | 'weapons' | 'items' | 'challenges';

export interface ModalContext {
  state: SimState;
  catalog: GameDataCatalog;
  saveData: SaveData;
  assetRegistry: AssetRegistry;
  inputMode: InputMode;
  customPackStatus: CustomPackStatus;
  callbacks: UIManagerCallbacks;
  codexTab: CodexTab;
  confirmResetSave: boolean;
  onSetCodexTab(tab: CodexTab): void;
  onSetConfirmResetSave(confirming: boolean): void;
}

export function renderCrateModal(container: HTMLElement, ctx: ModalContext): void {
  const { state, catalog, assetRegistry, inputMode, callbacks } = ctx;
  const crate = state.crateModal.pendingCrates[0];
  if (!crate) {
    container.innerHTML = '';
    return;
  }
  const item = catalog.itemsById[crate.itemId];
  const tier = crate.isLegendary ? 3 : item?.tier ?? 0;
  const col = getRarityColor(tier);
  const itemIcon = assetRegistry.getIconDataUrl(item?.spriteId || `item_${crate.itemId}`);
  const crateIcon = assetRegistry.getIconDataUrl(crate.isLegendary ? 'crate_legendary' : 'crate_normal');
  const lines = (item?.effects ?? []).map(formatEffectLine);

  container.innerHTML = `
    <div class="kt-modal-backdrop">
      <div class="kt-panel kt-modal-box kt-modal-narrow" style="border-color:${col}">
        <div style="display:flex;align-items:center;justify-content:space-between">
          <div style="display:flex;align-items:center;gap:10px">
            <img src="${crateIcon}" alt="Crate" style="width:42px;height:42px" />
            <div>
              <div style="font-size:20px;font-weight:900;color:${col}">
                ${crate.isLegendary ? 'LEGENDARY CRATE!' : 'SUPPLY CRATE'}
              </div>
              <div style="font-size:12px;color:var(--kt-muted);font-weight:800">
                ${state.crateModal.pendingCrates.length} CRATE${state.crateModal.pendingCrates.length > 1 ? 'S' : ''} REMAINING
              </div>
            </div>
          </div>
          <span class="kt-asset-pill" style="color:${col}">${RARITY_NAMES[tier]}</span>
        </div>

        <div class="kt-detail-head" style="padding:12px;border-radius:12px;background:rgba(0,0,0,0.3);border:2.5px solid ${col}">
          <img class="kt-detail-icon" src="${itemIcon}" alt="${escapeHtml(item?.name ?? crate.itemId)}" />
          <div>
            <div style="font-size:20px;font-weight:900;color:${col}">${escapeHtml(item?.name ?? crate.itemId)}</div>
            <div style="font-size:12px;color:var(--kt-muted);font-weight:700">${escapeHtml(item?.description ?? '')}</div>
          </div>
        </div>

        <div class="kt-effects-list">
          ${lines
            .map((l) => {
              const cls = l.tone === 'pos' ? 'kt-pos' : l.tone === 'neg' ? 'kt-neg' : 'kt-neu';
              return `<div class="${cls}">• ${escapeHtml(l.text)}</div>`;
            })
            .join('')}
        </div>

        <div style="display:flex;gap:10px;margin-top:6px">
          <button type="button" class="kt-btn kt-btn-go" style="flex:1" data-focusable="true" data-focus-default="true" data-action="keep">
            ${renderGlyph(inputMode, 'A', 'ENTER')} TAKE ITEM
          </button>
          <button type="button" class="kt-btn kt-btn-primary" style="flex:1" data-focusable="true" data-action="recycle">
            ${renderGlyph(inputMode, 'X', 'R')} RECYCLE (+${crate.recycleValue})
          </button>
        </div>
      </div>
    </div>
  `;

  container.querySelector('[data-action="keep"]')?.addEventListener('click', () => {
    callbacks.onPlayUiClick('confirm');
    callbacks.onCommand({ type: 'crate_keep' });
  });
  container.querySelector('[data-action="recycle"]')?.addEventListener('click', () => {
    callbacks.onPlayUiClick('buy');
    callbacks.onCommand({ type: 'crate_recycle' });
  });
}

export function renderLevelUpModal(container: HTMLElement, ctx: ModalContext): void {
  const { state, assetRegistry, inputMode, callbacks } = ctx;
  const lu = state.levelUp;
  const canReroll = state.player.materials >= lu.rerollCost;

  const cardsHtml = lu.offers
    .map((u, idx) => {
      const col = getRarityColor(u.tier);
      const icon = assetRegistry.getIconDataUrl(u.iconId || `upgrade_${u.statKey}`);
      return `
        <button
          type="button"
          class="kt-upgrade-card"
          style="border-color:${col}"
          data-focusable="true"
          ${idx === 0 ? 'data-focus-default="true"' : ''}
          data-lu-pick="${idx}"
        >
          <span style="font-size:11px;font-weight:900;color:${col};letter-spacing:0.06em">${RARITY_NAMES[u.tier].toUpperCase()}</span>
          <img src="${icon}" alt="${escapeHtml(u.name)}" style="width:54px;height:54px;object-fit:contain" />
          <div style="font-size:15px;font-weight:900">${escapeHtml(u.name)}</div>
          <div class="kt-pos" style="font-size:17px;font-weight:900">${escapeHtml(formatSignedStat(u.statKey, u.value))} ${escapeHtml(formatStatName(u.statKey))}</div>
        </button>
      `;
    })
    .join('');

  container.innerHTML = `
    <div class="kt-modal-backdrop">
      <div class="kt-panel kt-modal-box">
        <div class="kt-header">
          <div>
            <h2 class="kt-header-title">LEVEL UP! (LV ${state.player.level})</h2>
            <div style="font-size:12px;color:var(--kt-muted);font-weight:800">
              CHOOSE AN UPGRADE · ${Math.max(1, lu.remainingLevelUps)} REMAINING
            </div>
          </div>
          <div style="display:flex;align-items:center;gap:10px">
            <div class="kt-mat-pill">◆ ${Math.floor(state.player.materials)}</div>
            <button type="button" class="kt-btn kt-btn-cyan" data-focusable="true" data-action="reroll" ${canReroll ? '' : 'disabled'}>
              ${renderGlyph(inputMode, 'X', 'R')} REROLL (${lu.rerollCost})
            </button>
          </div>
        </div>
        <div class="kt-upgrade-grid">${cardsHtml}</div>
      </div>
    </div>
  `;

  container.querySelectorAll<HTMLButtonElement>('[data-lu-pick]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const idx = Number(btn.dataset.luPick);
      callbacks.onPlayUiClick('confirm');
      callbacks.onCommand({ type: 'level_up_pick', index: idx });
    });
  });
  container.querySelector('[data-action="reroll"]')?.addEventListener('click', () => {
    callbacks.onPlayUiClick('reroll');
    callbacks.onCommand({ type: 'level_up_reroll' });
  });
}

export function renderPauseModal(container: HTMLElement, ctx: ModalContext): void {
  const { state, inputMode, callbacks } = ctx;
  const rs = state.runStats;
  container.innerHTML = `
    <div class="kt-modal-backdrop">
      <div class="kt-panel kt-modal-box kt-modal-narrow">
        <h2 class="kt-header-title" style="text-align:center">PAUSED — WAVE ${state.wave}</h2>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;font-size:13px;font-weight:800">
          <div class="kt-stat-row"><span>Kills</span><span class="kt-pos">${rs.kills}</span></div>
          <div class="kt-stat-row"><span>Materials</span><span style="color:var(--kt-lime)">${Math.floor(state.player.materials)}</span></div>
          <div class="kt-stat-row"><span>Crits</span><span style="color:var(--kt-gold)">${rs.critsLanded}</span></div>
          <div class="kt-stat-row"><span>Dodges</span><span style="color:var(--kt-cyan)">${rs.dodges}</span></div>
        </div>
        <button type="button" class="kt-btn kt-btn-go" data-focusable="true" data-focus-default="true" data-action="resume">
          ${renderGlyph(inputMode, 'A', 'ESC')} RESUME
        </button>
        <button type="button" class="kt-btn" data-focusable="true" data-action="options">OPTIONS</button>
        <button type="button" class="kt-btn kt-btn-danger" data-focusable="true" data-action="abandon">ABANDON RUN</button>
      </div>
    </div>
  `;

  container.querySelector('[data-action="resume"]')?.addEventListener('click', () => {
    callbacks.onPlayUiClick('confirm');
    callbacks.onCommand({ type: 'toggle_pause' });
  });
  container.querySelector('[data-action="options"]')?.addEventListener('click', () => {
    callbacks.onPlayUiClick('confirm');
    callbacks.onCommand({ type: 'set_screen', screen: 'options' });
  });
  container.querySelector('[data-action="abandon"]')?.addEventListener('click', () => {
    callbacks.onPlayUiClick('cancel');
    callbacks.onCommand({ type: 'set_screen', screen: 'title' });
  });
}

export function renderOptionsScreen(container: HTMLElement, ctx: ModalContext): void {
  const { state, saveData, assetRegistry, inputMode, customPackStatus, callbacks, confirmResetSave, onSetConfirmResetSave } = ctx;
  const r = saveData.renderSettings;
  const a = saveData.audioSettings;
  const t = saveData.touchSettings;
  const backTarget = state.previousScreen === 'pause' ? 'pause' : 'title';

  container.innerHTML = `
    <div class="kt-screen">
      <div class="kt-header">
        <button type="button" class="kt-btn" data-focusable="true" data-focus-default="true" data-action="back">
          ${renderGlyph(inputMode, 'B', 'ESC')} BACK
        </button>
        <h2 class="kt-header-title">OPTIONS</h2>
        <div style="width:90px"></div>
      </div>

      <div style="flex:1;overflow-y:auto;display:grid;grid-template-columns:repeat(auto-fit, minmax(300px, 1fr));gap:12px;align-content:start">
        <div class="kt-panel kt-subpanel">
          <div class="kt-subpanel-title"><span>DISPLAY & GAME FEEL</span></div>
          <div class="kt-options-row">
            <span>Target FPS</span>
            <div style="display:flex;gap:6px">
              ${([30, 60, 120] as TargetFps[])
                .map(
                  (fps) =>
                    `<button type="button" class="kt-btn kt-btn-sm ${r.targetFps === fps ? 'kt-btn-primary' : ''}" data-focusable="true" data-fps="${fps}">${fps}</button>`
                )
                .join('')}
            </div>
          </div>
          <label class="kt-options-row">
            <span>Classic 60 Hz Snap</span>
            <input type="checkbox" data-focusable="true" data-opt="classicSnap60" ${r.classicSnap60 ? 'checked' : ''} style="width:24px;height:24px" />
          </label>
          <label class="kt-options-row">
            <span>Screen Shake</span>
            <input type="checkbox" data-focusable="true" data-opt="screenShake" ${r.screenShake ? 'checked' : ''} style="width:24px;height:24px" />
          </label>
          <label class="kt-options-row">
            <span>Damage Numbers</span>
            <input type="checkbox" data-focusable="true" data-opt="damageNumbers" ${r.damageNumbers ? 'checked' : ''} style="width:24px;height:24px" />
          </label>
          <label class="kt-options-row">
            <span>Hit Flash</span>
            <input type="checkbox" data-focusable="true" data-opt="hitFlash" ${r.hitFlash ? 'checked' : ''} style="width:24px;height:24px" />
          </label>
        </div>

        <div class="kt-panel kt-subpanel">
          <div class="kt-subpanel-title"><span>AUDIO</span></div>
          <label class="kt-options-row">
            <span>Mute All Audio</span>
            <input type="checkbox" data-focusable="true" data-audio-mute ${a.muted ? 'checked' : ''} style="width:24px;height:24px" />
          </label>
          <label class="kt-options-row">
            <span>Master Volume (<span data-vol-label="masterVolume">${Math.round(a.masterVolume * 100)}</span>%)</span>
            <input type="range" min="0" max="1" step="0.05" value="${a.masterVolume}" data-focusable="true" data-vol="masterVolume" />
          </label>
          <label class="kt-options-row">
            <span>SFX Volume (<span data-vol-label="sfxVolume">${Math.round(a.sfxVolume * 100)}</span>%)</span>
            <input type="range" min="0" max="1" step="0.05" value="${a.sfxVolume}" data-focusable="true" data-vol="sfxVolume" />
          </label>
          <label class="kt-options-row">
            <span>Music Volume (<span data-vol-label="musicVolume">${Math.round(a.musicVolume * 100)}</span>%)</span>
            <input type="range" min="0" max="1" step="0.05" value="${a.musicVolume}" data-focusable="true" data-vol="musicVolume" />
          </label>
        </div>

        <div class="kt-panel kt-subpanel">
          <div class="kt-subpanel-title"><span>TOUCH & ASSETS</span></div>
          <label class="kt-options-row">
            <span>Touch Idle Opacity (<span data-touch-label="idleOpacity">${Math.round(t.idleOpacity * 100)}</span>%)</span>
            <input type="range" min="0.12" max="0.45" step="0.02" value="${t.idleOpacity}" data-focusable="true" data-touch="idleOpacity" />
          </label>
          <label class="kt-options-row">
            <span>Touch Active Opacity (<span data-touch-label="activeOpacity">${Math.round(t.activeOpacity * 100)}</span>%)</span>
            <input type="range" min="0.25" max="0.58" step="0.02" value="${t.activeOpacity}" data-focusable="true" data-touch="activeOpacity" />
          </label>
          <label class="kt-options-row">
            <span>Left-Handed Touch Layout</span>
            <input type="checkbox" data-focusable="true" data-touch-lh ${t.leftHanded ? 'checked' : ''} style="width:24px;height:24px" />
          </label>
          <div class="kt-options-row">
            <span>Asset Mode (${assetRegistry.getMode()})</span>
            <div style="display:flex;gap:6px">
              <button type="button" class="kt-btn kt-btn-sm ${assetRegistry.getMode() === 'BUILTIN' ? 'kt-btn-cyan' : ''}" data-focusable="true" data-asset="BUILTIN">BUILT-IN</button>
              <button type="button" class="kt-btn kt-btn-sm ${assetRegistry.getMode() === 'CUSTOM_PACK' ? 'kt-btn-primary' : ''}" data-focusable="true" data-asset="CUSTOM_PACK" ${customPackStatus.available ? '' : 'disabled'}>CUSTOM</button>
            </div>
          </div>
          <div class="kt-options-row">
            <span>Save Profile</span>
            ${
              confirmResetSave
                ? `<div style="display:flex;gap:6px">
                    <button type="button" class="kt-btn kt-btn-sm kt-btn-danger" data-focusable="true" data-action="reset-confirm">CONFIRM RESET</button>
                    <button type="button" class="kt-btn kt-btn-sm" data-focusable="true" data-action="reset-cancel">CANCEL</button>
                  </div>`
                : `<button type="button" class="kt-btn kt-btn-sm kt-btn-danger" data-focusable="true" data-action="reset-ask">RESET SAVE</button>`
            }
          </div>
        </div>
      </div>
    </div>
  `;

  container.querySelector('[data-action="back"]')?.addEventListener('click', () => {
    callbacks.onPlayUiClick('cancel');
    onSetConfirmResetSave(false);
    callbacks.onCommand({ type: 'set_screen', screen: backTarget });
  });

  container.querySelectorAll<HTMLButtonElement>('[data-fps]').forEach((btn) => {
    btn.addEventListener('click', () => {
      callbacks.onPlayUiClick('confirm');
      callbacks.onUpdateRenderSettings({ targetFps: Number(btn.dataset.fps) as TargetFps });
    });
  });

  container.querySelectorAll<HTMLInputElement>('[data-opt]').forEach((el) => {
    el.addEventListener('change', () => {
      const k = el.dataset.opt as 'classicSnap60' | 'screenShake' | 'damageNumbers' | 'hitFlash';
      callbacks.onUpdateRenderSettings({ [k]: el.checked });
    });
  });

  container.querySelector<HTMLInputElement>('[data-audio-mute]')?.addEventListener('change', (e) => {
    callbacks.onUpdateAudioSettings({ muted: (e.target as HTMLInputElement).checked });
  });

  container.querySelectorAll<HTMLInputElement>('[data-vol]').forEach((el) => {
    el.addEventListener('input', () => {
      const k = el.dataset.vol as 'masterVolume' | 'sfxVolume' | 'musicVolume';
      const val = parseFloat(el.value);
      const lbl = container.querySelector(`[data-vol-label="${k}"]`);
      if (lbl) lbl.textContent = String(Math.round(val * 100));
      callbacks.onUpdateAudioSettings({ [k]: val });
    });
  });

  container.querySelectorAll<HTMLInputElement>('[data-touch]').forEach((el) => {
    el.addEventListener('input', () => {
      const k = el.dataset.touch as 'idleOpacity' | 'activeOpacity';
      const val = parseFloat(el.value);
      const lbl = container.querySelector(`[data-touch-label="${k}"]`);
      if (lbl) lbl.textContent = String(Math.round(val * 100));
      callbacks.onUpdateTouchSettings({ [k]: val });
    });
  });

  container.querySelector<HTMLInputElement>('[data-touch-lh]')?.addEventListener('change', (e) => {
    callbacks.onUpdateTouchSettings({ leftHanded: (e.target as HTMLInputElement).checked });
  });

  container.querySelectorAll<HTMLButtonElement>('[data-asset]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const m = btn.dataset.asset as 'BUILTIN' | 'CUSTOM_PACK';
      void callbacks.onSelectAssetMode(m);
    });
  });

  container.querySelector('[data-action="reset-ask"]')?.addEventListener('click', () => onSetConfirmResetSave(true));
  container.querySelector('[data-action="reset-cancel"]')?.addEventListener('click', () => onSetConfirmResetSave(false));
  container.querySelector('[data-action="reset-confirm"]')?.addEventListener('click', () => {
    onSetConfirmResetSave(false);
    callbacks.onResetSave();
  });
}

export function renderCodexScreen(container: HTMLElement, ctx: ModalContext): void {
  const { catalog, saveData, assetRegistry, inputMode, callbacks, codexTab, onSetCodexTab } = ctx;
  const tabs: Array<{ id: CodexTab; label: string }> = [
    { id: 'characters', label: `CHARACTERS (${catalog.characters.length})` },
    { id: 'weapons', label: `WEAPONS (${catalog.weapons.length})` },
    { id: 'items', label: `ITEMS (${catalog.items.length})` },
    { id: 'challenges', label: `CHALLENGES (${saveData.unlockedChallenges.length}/${catalog.challenges.length})` },
  ];

  const unlocked = new Set(saveData.unlockedChallenges);
  let bodyHtml = '';

  if (codexTab === 'characters') {
    bodyHtml = catalog.characters
      .map((c) => {
        const icon = assetRegistry.getIconDataUrl(c.visual.spriteId || `char_${c.id}`);
        const best = saveData.characterMaxDanger[c.id];
        return `<div class="kt-panel" style="padding:12px;display:flex;gap:10px;align-items:center">
          <img src="${icon}" alt="${escapeHtml(c.name)}" style="width:52px;height:52px;object-fit:contain" />
          <div>
            <div style="font-weight:900;color:var(--kt-gold)">${escapeHtml(c.name)}</div>
            <div style="font-size:12px;color:var(--kt-muted)">${escapeHtml(c.tagline)}</div>
            <div style="font-size:11px;font-weight:800;margin-top:3px">Slots: ${c.weaponSlots}${best !== undefined ? ` · Cleared D${best}` : ''}</div>
          </div>
        </div>`;
      })
      .join('');
  } else if (codexTab === 'weapons') {
    bodyHtml = catalog.weapons
      .map((w) => {
        const icon = assetRegistry.getIconDataUrl(w.spriteId || `weapon_${w.id}`);
        const t = w.tiers[w.minTier];
        return `<div class="kt-panel" style="padding:12px;display:flex;gap:10px;align-items:center">
          <img src="${icon}" alt="${escapeHtml(w.name)}" style="width:48px;height:48px;object-fit:contain" />
          <div>
            <div style="font-weight:900;color:${getRarityColor(w.minTier - 1)}">${escapeHtml(w.name)}</div>
            <div style="font-size:11px;color:var(--kt-cyan);font-weight:800">${w.kind.toUpperCase()} · ${w.sets.join(', ')}</div>
            ${t ? `<div style="font-size:11px;color:#d6d1e6">DMG ${t.damage} · RNG ${t.maxRange} · CD ${(t.cooldown / 60).toFixed(2)}s</div>` : ''}
          </div>
        </div>`;
      })
      .join('');
  } else if (codexTab === 'items') {
    bodyHtml = catalog.items
      .map((it) => {
        const icon = assetRegistry.getIconDataUrl(it.spriteId || `item_${it.id}`);
        return `<div class="kt-panel" style="padding:12px;display:flex;gap:10px;align-items:center">
          <img src="${icon}" alt="${escapeHtml(it.name)}" style="width:46px;height:46px;object-fit:contain" />
          <div>
            <div style="font-weight:900;color:${getRarityColor(it.tier)}">${escapeHtml(it.name)}</div>
            <div style="font-size:11px;color:var(--kt-muted)">${escapeHtml(it.description || it.effects.map((e) => formatEffectLine(e).text).join(', '))}</div>
          </div>
        </div>`;
      })
      .join('');
  } else {
    bodyHtml = catalog.challenges
      .map((ch) => {
        const done = unlocked.has(ch.id);
        return `<div class="kt-panel" style="padding:12px;border-color:${done ? '#54f06b' : '#110f17'}">
          <div style="font-weight:900;color:${done ? '#54f06b' : 'var(--kt-gold)'}">
            ${done ? '✓ ' : ''}${escapeHtml(ch.name)}
          </div>
          <div style="font-size:12px;color:var(--kt-muted);margin-top:3px">${escapeHtml(ch.description)}</div>
          <div style="font-size:11px;font-weight:800;margin-top:4px;color:var(--kt-cyan)">Reward: ${escapeHtml(ch.rewardType.toUpperCase())} · ${escapeHtml(ch.rewardId)}</div>
        </div>`;
      })
      .join('');
  }

  container.innerHTML = `
    <div class="kt-screen">
      <div class="kt-header">
        <button type="button" class="kt-btn" data-focusable="true" data-focus-default="true" data-action="back">
          ${renderGlyph(inputMode, 'B', 'ESC')} BACK
        </button>
        <h2 class="kt-header-title">CODEX</h2>
        <div style="display:flex;gap:6px;flex-wrap:wrap">
          ${renderGlyph(inputMode, 'LB')}
          ${tabs
            .map(
              (t) =>
                `<button type="button" class="kt-btn kt-btn-sm ${codexTab === t.id ? 'kt-btn-primary' : ''}" data-focusable="true" data-codex-tab="${t.id}">${t.label}</button>`
            )
            .join('')}
          ${renderGlyph(inputMode, 'RB')}
        </div>
      </div>

      <div style="flex:1;overflow-y:auto;display:grid;grid-template-columns:repeat(auto-fill, minmax(260px, 1fr));gap:10px;align-content:start;padding:2px">
        ${bodyHtml}
      </div>
    </div>
  `;

  container.querySelector('[data-action="back"]')?.addEventListener('click', () => {
    callbacks.onPlayUiClick('cancel');
    callbacks.onCommand({ type: 'set_screen', screen: 'title' });
  });
  container.querySelectorAll<HTMLButtonElement>('[data-codex-tab]').forEach((btn) => {
    btn.addEventListener('click', () => {
      callbacks.onPlayUiClick('hover');
      onSetCodexTab(btn.dataset.codexTab as CodexTab);
    });
  });
}

export function renderEndScreen(container: HTMLElement, ctx: ModalContext, isVictory: boolean): void {
  const { state, catalog, assetRegistry, inputMode, callbacks } = ctx;
  const rs = state.runStats;
  const secs = Math.floor(rs.ticksPlayed / SIM_HZ);
  const mins = Math.floor(secs / 60);
  const remSec = secs % 60;
  const timeStr = `${mins}:${String(remSec).padStart(2, '0')}`;

  const weaponsRow = state.player.weapons
    .map((w) => {
      const def = catalog.weaponsById[w.weaponId];
      const icon = assetRegistry.getIconDataUrl(def?.spriteId || `weapon_${w.weaponId}`);
      return `<div class="kt-item-chip" style="border-color:${getRarityColor(w.tier - 1)};cursor:default">
        <img src="${icon}" alt="${escapeHtml(def?.name ?? w.weaponId)}" />
        <span class="kt-item-count">T${w.tier}</span>
      </div>`;
    })
    .join('');

  container.innerHTML = `
    <div class="kt-modal-backdrop">
      <div class="kt-panel kt-modal-box" style="max-width:620px;border-color:${isVictory ? '#ffe142' : '#ff3b4e'}">
        <h2 class="kt-header-title" style="text-align:center;color:${isVictory ? '#ffe142' : '#ff4757'};font-size:32px">
          ${isVictory ? 'VICTORY! WAVE 20 CLEARED!' : `RUN OVER — WAVE ${state.wave}`}
        </h2>
        <div style="text-align:center;font-size:13px;font-weight:800;color:var(--kt-muted)">
          DANGER ${state.dangerLevel} · TIME ${timeStr} · LEVEL ${state.player.level}
        </div>

        <div style="display:grid;grid-template-columns:repeat(2, 1fr);gap:8px">
          <div class="kt-stat-row"><span>Enemies Defeated</span><span class="kt-pos">${rs.kills}</span></div>
          <div class="kt-stat-row"><span>Elites / Bosses</span><span style="color:var(--kt-gold)">${rs.elitesKilled} / ${rs.bossesKilled}</span></div>
          <div class="kt-stat-row"><span>Damage Dealt</span><span>${Math.round(rs.damageDealt)}</span></div>
          <div class="kt-stat-row"><span>Damage Taken</span><span class="kt-neg">${Math.round(rs.damageTaken)}</span></div>
          <div class="kt-stat-row"><span>Crits / Dodges</span><span style="color:var(--kt-cyan)">${rs.critsLanded} / ${rs.dodges}</span></div>
          <div class="kt-stat-row"><span>Materials Looted</span><span style="color:var(--kt-lime)">${Math.floor(rs.materialsCollected)}</span></div>
        </div>

        <div style="display:flex;flex-wrap:wrap;justify-content:center;gap:8px">${weaponsRow}</div>

        <div style="display:flex;flex-wrap:wrap;gap:10px;justify-content:center;margin-top:6px">
          ${
            isVictory
              ? `<button type="button" class="kt-btn kt-btn-primary" data-focusable="true" data-focus-default="true" data-action="endless">
                  ${renderGlyph(inputMode, 'A', 'ENTER')} CONTINUE ENDLESS (WAVE 21+)
                </button>`
              : `<button type="button" class="kt-btn kt-btn-go" data-focusable="true" data-focus-default="true" data-action="retry">
                  ${renderGlyph(inputMode, 'A', 'ENTER')} PLAY AGAIN
                </button>`
          }
          <button type="button" class="kt-btn" data-focusable="true" data-action="menu">
            ${renderGlyph(inputMode, 'B', 'ESC')} MAIN MENU
          </button>
        </div>
      </div>
    </div>
  `;

  container.querySelector('[data-action="endless"]')?.addEventListener('click', () => {
    callbacks.onPlayUiClick('confirm');
    callbacks.onCommand({ type: 'continue_endless' });
  });
  container.querySelector('[data-action="retry"]')?.addEventListener('click', () => {
    callbacks.onPlayUiClick('confirm');
    callbacks.onCommand({
      type: 'start_run',
      characterId: state.player.characterId || state.selectedCharId,
      weaponId: state.selectedWeaponId || catalog.weapons[0]?.id || 'pistol',
      zoneId: state.zoneId,
      dangerLevel: state.dangerLevel,
    });
  });
  container.querySelector('[data-action="menu"]')?.addEventListener('click', () => {
    callbacks.onPlayUiClick('cancel');
    callbacks.onCommand({ type: 'set_screen', screen: 'title' });
  });
}
