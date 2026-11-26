// ============================================================================
// src/ui/SelectScreens.ts
// Title Screen (with live Built-In / Custom Pack switcher & .pck/folder loader)
// plus responsive Select Flow: Character -> Starting Weapon -> Arena Zone ->
// Danger 0-6. Zero hover-only tooltips, >=48x48px touch targets, full Gamepad
// & Keyboard navigation support, and 100% krunkedtato branding.
// ============================================================================

import {
  BRAND_NAME,
  type CustomPackStatus,
  type GameDataCatalog,
  type InputMode,
  type SaveData,
  type SimState,
  type UIManagerCallbacks,
} from '../contracts/index';
import type { AssetRegistry } from '../assets/AssetRegistry';
import { escapeHtml, formatEffectLine, renderGlyph } from './styles';

export interface SelectFlowContext {
  state: SimState;
  catalog: GameDataCatalog;
  saveData: SaveData;
  assetRegistry: AssetRegistry;
  inputMode: InputMode;
  customPackStatus: CustomPackStatus;
  customPackMessage: { text: string; isError: boolean } | null;
  callbacks: UIManagerCallbacks;
  onSelectLocal(patch: {
    charId?: string;
    weaponId?: string;
    zoneId?: 0 | 1 | 2;
    danger?: number;
  }): void;
}

export function renderTitleScreen(container: HTMLElement, ctx: SelectFlowContext): void {
  const { saveData, assetRegistry, inputMode, customPackStatus, customPackMessage, callbacks } = ctx;
  const activeMode = assetRegistry.getMode();
  const hasSavedRun = Boolean(saveData.activeRun);
  const spudIcon = assetRegistry.getIconDataUrl('char_well_rounded');

  const statusText = customPackStatus.available
    ? `${activeMode === 'CUSTOM_PACK' ? 'ACTIVE' : 'READY'}: ${customPackStatus.label} (${customPackStatus.textureCount} tex · ${customPackStatus.audioCount} audio)`
    : 'BUILT-IN PROCEDURAL ART ACTIVE';

  container.innerHTML = `
    <div class="kt-screen kt-title-screen">
      <div class="kt-logo-box">
        ${spudIcon ? `<img src="${spudIcon}" alt="${BRAND_NAME}" style="width:86px;height:86px;filter:drop-shadow(0 6px 0 #110f17)" />` : ''}
        <h1 class="kt-logo-title">${BRAND_NAME}</h1>
        <div class="kt-logo-sub">60 HZ ARENA ROGUELITE · MULTI-DEVICE EDITION</div>
      </div>

      <div class="kt-title-menu">
        <button type="button" class="kt-btn kt-btn-primary" data-focusable="true" data-focus-default="true" data-action="play">
          ${renderGlyph(inputMode, 'A', 'ENTER')} PLAY NEW RUN
        </button>
        ${
          hasSavedRun && saveData.activeRun
            ? `<button type="button" class="kt-btn kt-btn-go" data-focusable="true" data-action="continue">
                CONTINUE · WAVE ${saveData.activeRun.wave}
              </button>`
            : ''
        }
        <button type="button" class="kt-btn" data-focusable="true" data-action="codex">CODEX</button>
        <button type="button" class="kt-btn" data-focusable="true" data-action="options">OPTIONS</button>
      </div>

      <div class="kt-panel kt-asset-bar">
        <span class="kt-asset-pill">${escapeHtml(statusText)}</span>
        <button type="button" class="kt-btn kt-btn-sm ${activeMode === 'BUILTIN' ? 'kt-btn-cyan' : ''}" data-focusable="true" data-action="mode-builtin">
          USE BUILT-IN ART
        </button>
        <button type="button" class="kt-btn kt-btn-sm ${activeMode === 'CUSTOM_PACK' ? 'kt-btn-primary' : ''}" data-focusable="true" data-action="mode-custom" ${customPackStatus.available ? '' : 'disabled'}>
          USE CUSTOM PACK
        </button>
        <button type="button" class="kt-btn kt-btn-sm" data-focusable="true" data-action="pick-pck">
          LOAD .PCK PACK
        </button>
        <button type="button" class="kt-btn kt-btn-sm" data-focusable="true" data-action="pick-dir">
          LOAD PACK FOLDER
        </button>
        ${
          customPackStatus.available && customPackStatus.source !== 'dev-middleware'
            ? `<button type="button" class="kt-btn kt-btn-sm kt-btn-danger" data-focusable="true" data-action="clear-pack">CLEAR</button>`
            : ''
        }
        <input type="file" id="kt-pck-input" accept=".pck" style="display:none" />
        <input type="file" id="kt-dir-input" webkitdirectory directory multiple style="display:none" />
        ${
          customPackMessage
            ? `<div class="kt-asset-msg ${customPackMessage.isError ? 'kt-asset-msg-err' : ''}">${escapeHtml(customPackMessage.text)}</div>`
            : ''
        }
      </div>
    </div>
  `;

  container.querySelector('[data-action="play"]')?.addEventListener('click', () => {
    callbacks.onPlayUiClick('confirm');
    callbacks.onCommand({ type: 'set_screen', screen: 'select_character' });
  });
  container.querySelector('[data-action="continue"]')?.addEventListener('click', () => {
    callbacks.onPlayUiClick('confirm');
    callbacks.onContinueSavedRun();
  });
  container.querySelector('[data-action="codex"]')?.addEventListener('click', () => {
    callbacks.onPlayUiClick('confirm');
    callbacks.onCommand({ type: 'set_screen', screen: 'codex' });
  });
  container.querySelector('[data-action="options"]')?.addEventListener('click', () => {
    callbacks.onPlayUiClick('confirm');
    callbacks.onCommand({ type: 'set_screen', screen: 'options' });
  });
  container.querySelector('[data-action="mode-builtin"]')?.addEventListener('click', () => {
    callbacks.onPlayUiClick('confirm');
    void callbacks.onSelectAssetMode('BUILTIN');
  });
  container.querySelector('[data-action="mode-custom"]')?.addEventListener('click', () => {
    callbacks.onPlayUiClick('confirm');
    void callbacks.onSelectAssetMode('CUSTOM_PACK');
  });

  const pckInput = container.querySelector<HTMLInputElement>('#kt-pck-input');
  const dirInput = container.querySelector<HTMLInputElement>('#kt-dir-input');

  container.querySelector('[data-action="pick-pck"]')?.addEventListener('click', () => pckInput?.click());
  container.querySelector('[data-action="pick-dir"]')?.addEventListener('click', () => dirInput?.click());
  container.querySelector('[data-action="clear-pack"]')?.addEventListener('click', () => {
    callbacks.onPlayUiClick('cancel');
    void callbacks.onClearCustomPack();
  });

  pckInput?.addEventListener('change', () => {
    const file = pckInput.files?.[0];
    if (file) void callbacks.onUploadPckFile(file);
  });
  dirInput?.addEventListener('change', () => {
    if (dirInput.files && dirInput.files.length > 0) {
      void callbacks.onUploadPackDirectory(dirInput.files);
    }
  });
}

export function renderCharacterSelect(container: HTMLElement, ctx: SelectFlowContext): void {
  const { state, catalog, saveData, assetRegistry, inputMode, callbacks, onSelectLocal } = ctx;
  const unlockedSet = new Set(saveData.unlockedChallenges);
  const selected =
    catalog.charactersById[state.selectedCharId] ?? catalog.characters[0];

  const cardsHtml = catalog.characters
    .map((c) => {
      const unlocked = c.unlockedByDefault || !c.unlockChallengeId || unlockedSet.has(c.unlockChallengeId);
      const isSel = selected && c.id === selected.id;
      const icon = assetRegistry.getIconDataUrl(c.visual.spriteId || `char_${c.id}`);
      const bestDanger = saveData.characterMaxDanger[c.id];
      return `<button
        type="button"
        class="kt-pick-card ${isSel ? 'kt-selected' : ''}"
        data-focusable="true"
        data-focus-group="grid"
        ${isSel ? 'data-focus-default="true"' : ''}
        data-char-id="${escapeHtml(c.id)}"
        ${unlocked ? '' : 'disabled'}
      >
        <img class="kt-card-icon" src="${icon}" alt="${escapeHtml(c.name)}" />
        <div class="kt-card-name">${escapeHtml(c.name)}</div>
        <div style="font-size:11px;color:${unlocked ? '#aba6bc' : '#ff5c6c'};font-weight:800">
          ${unlocked ? `${c.weaponSlots} Slots${bestDanger !== undefined ? ` · D${bestDanger}` : ''}` : 'LOCKED'}
        </div>
      </button>`;
    })
    .join('');

  const detailEffects = (selected?.effects ?? [])
    .map((eff) => {
      const line = formatEffectLine(eff);
      const cls = line.tone === 'pos' ? 'kt-pos' : line.tone === 'neg' ? 'kt-neg' : 'kt-neu';
      return `<div class="${cls}">• ${escapeHtml(line.text)}</div>`;
    })
    .join('');

  const selIcon = selected ? assetRegistry.getIconDataUrl(selected.visual.spriteId || `char_${selected.id}`) : '';

  container.innerHTML = `
    <div class="kt-screen">
      <div class="kt-header">
        <button type="button" class="kt-btn" data-focusable="true" data-focus-group="nav" data-action="back">
          ${renderGlyph(inputMode, 'B', 'ESC')} BACK
        </button>
        <h2 class="kt-header-title">SELECT SPUD CHARACTER</h2>
        <button type="button" class="kt-btn kt-btn-primary" data-focusable="true" data-focus-group="nav" data-action="next">
          NEXT: WEAPON ${renderGlyph(inputMode, 'A', 'ENTER')}
        </button>
      </div>

      <div class="kt-select-layout">
        <div class="kt-card-grid">${cardsHtml}</div>
        <div class="kt-panel kt-detail-panel">
          ${
            selected
              ? `
              <div class="kt-detail-head">
                <img class="kt-detail-icon" src="${selIcon}" alt="${escapeHtml(selected.name)}" />
                <div>
                  <div style="font-size:22px;font-weight:900;color:var(--kt-gold)">${escapeHtml(selected.name)}</div>
                  <div style="font-size:13px;color:var(--kt-muted);font-weight:700">${escapeHtml(selected.tagline)}</div>
                  <div style="font-size:12px;margin-top:4px;font-weight:800">Weapon Slots: ${selected.weaponSlots}</div>
                </div>
              </div>
              <div class="kt-effects-list">${detailEffects || '<div class="kt-neu">Balanced all-purpose spud.</div>'}</div>
              <button type="button" class="kt-btn kt-btn-go" style="margin-top:auto" data-focusable="true" data-focus-group="nav" data-action="next-cta">
                CHOOSE ${escapeHtml(selected.name.toUpperCase())} ${renderGlyph(inputMode, 'A')}
              </button>
            `
              : ''
          }
        </div>
      </div>
    </div>
  `;

  container.querySelector('[data-action="back"]')?.addEventListener('click', () => {
    callbacks.onPlayUiClick('cancel');
    callbacks.onCommand({ type: 'set_screen', screen: 'title' });
  });

  const goNext = (): void => {
    if (!selected) return;
    callbacks.onPlayUiClick('confirm');
    const defaultWep = selected.startingWeapons[0] ?? catalog.weapons[0]?.id ?? 'pistol';
    onSelectLocal({ charId: selected.id, weaponId: defaultWep });
    callbacks.onCommand({ type: 'set_screen', screen: 'select_weapon' });
  };
  container.querySelector('[data-action="next"]')?.addEventListener('click', goNext);
  container.querySelector('[data-action="next-cta"]')?.addEventListener('click', goNext);

  container.querySelectorAll<HTMLButtonElement>('[data-char-id]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const id = btn.dataset.charId;
      if (!id) return;
      if (id === selected?.id) {
        goNext();
      } else {
        callbacks.onPlayUiClick('hover');
        const c = catalog.charactersById[id];
        onSelectLocal({ charId: id, weaponId: c?.startingWeapons[0] ?? state.selectedWeaponId });
      }
    });
  });
}

export function renderWeaponSelect(container: HTMLElement, ctx: SelectFlowContext): void {
  const { state, catalog, assetRegistry, inputMode, callbacks, onSelectLocal } = ctx;
  const char = catalog.charactersById[state.selectedCharId] ?? catalog.characters[0];
  const preferred = new Set(char?.startingWeapons ?? []);
  const t1Weapons = catalog.weapons.filter((w) => w.minTier <= 1);
  const ordered = [
    ...t1Weapons.filter((w) => preferred.has(w.id)),
    ...t1Weapons.filter((w) => !preferred.has(w.id)),
  ];
  const selected =
    ordered.find((w) => w.id === state.selectedWeaponId) ?? ordered[0] ?? catalog.weapons[0];
  const t1 = selected?.tiers[1] ?? selected?.tiers[selected.minTier];

  const cardsHtml = ordered
    .map((w) => {
      const isSel = selected && w.id === selected.id;
      const isRec = preferred.has(w.id);
      const icon = assetRegistry.getIconDataUrl(w.spriteId || `weapon_${w.id}`);
      return `<button
        type="button"
        class="kt-pick-card ${isSel ? 'kt-selected' : ''}"
        data-focusable="true"
        data-focus-group="grid"
        ${isSel ? 'data-focus-default="true"' : ''}
        data-weapon-id="${escapeHtml(w.id)}"
      >
        <img class="kt-card-icon" src="${icon}" alt="${escapeHtml(w.name)}" />
        <div class="kt-card-name">${escapeHtml(w.name)}</div>
        <div style="font-size:11px;font-weight:800;color:${isRec ? '#6bff3b' : '#aba6bc'}">
          ${isRec ? '★ SIGNATURE' : w.kind.toUpperCase()}
        </div>
      </button>`;
    })
    .join('');

  const selIcon = selected ? assetRegistry.getIconDataUrl(selected.spriteId || `weapon_${selected.id}`) : '';

  container.innerHTML = `
    <div class="kt-screen">
      <div class="kt-header">
        <button type="button" class="kt-btn" data-focusable="true" data-focus-group="nav" data-action="back">
          ${renderGlyph(inputMode, 'B', 'ESC')} BACK
        </button>
        <h2 class="kt-header-title">SELECT STARTING WEAPON</h2>
        <button type="button" class="kt-btn kt-btn-primary" data-focusable="true" data-focus-group="nav" data-action="next">
          NEXT: ARENA ZONE ${renderGlyph(inputMode, 'A', 'ENTER')}
        </button>
      </div>

      <div class="kt-select-layout">
        <div class="kt-card-grid">${cardsHtml}</div>
        <div class="kt-panel kt-detail-panel">
          ${
            selected && t1
              ? `
              <div class="kt-detail-head">
                <img class="kt-detail-icon" src="${selIcon}" alt="${escapeHtml(selected.name)}" />
                <div>
                  <div style="font-size:22px;font-weight:900;color:var(--kt-gold)">${escapeHtml(selected.name)}</div>
                  <div style="font-size:12px;color:var(--kt-cyan);font-weight:800">${selected.kind.toUpperCase()} · ${selected.sets.map((s) => s.toUpperCase()).join(', ')}</div>
                </div>
              </div>
              <div class="kt-effects-list">
                <div class="kt-neu">Base Damage: <strong>${t1.damage}</strong></div>
                <div class="kt-neu">Cooldown: <strong>${(t1.cooldown / 60).toFixed(2)}s</strong></div>
                <div class="kt-neu">Range: <strong>${t1.maxRange}</strong></div>
                <div class="kt-neu">Crit: <strong>${Math.round(t1.critChance * 100)}% (x${t1.critDamage})</strong></div>
                ${t1.projectiles > 1 ? `<div class="kt-pos">Projectiles: ${t1.projectiles}</div>` : ''}
                ${t1.piercing > 0 ? `<div class="kt-pos">Piercing: ${t1.piercing}</div>` : ''}
                ${t1.bounce > 0 ? `<div class="kt-pos">Bounce: ${t1.bounce}</div>` : ''}
                ${t1.explosionRadius > 0 ? `<div class="kt-pos">Explosive AoE: ${t1.explosionRadius}px</div>` : ''}
                ${t1.burnDamage > 0 ? `<div class="kt-pos">Ignite Burn: ${t1.burnDamage}/tick</div>` : ''}
              </div>
              <button type="button" class="kt-btn kt-btn-go" style="margin-top:auto" data-focusable="true" data-focus-group="nav" data-action="next-cta">
                EQUIP ${escapeHtml(selected.name.toUpperCase())} ${renderGlyph(inputMode, 'A')}
              </button>
            `
              : ''
          }
        </div>
      </div>
    </div>
  `;

  container.querySelector('[data-action="back"]')?.addEventListener('click', () => {
    callbacks.onPlayUiClick('cancel');
    callbacks.onCommand({ type: 'set_screen', screen: 'select_character' });
  });

  const goNext = (): void => {
    if (!selected) return;
    callbacks.onPlayUiClick('confirm');
    onSelectLocal({ weaponId: selected.id });
    callbacks.onCommand({ type: 'set_screen', screen: 'select_zone' });
  };
  container.querySelector('[data-action="next"]')?.addEventListener('click', goNext);
  container.querySelector('[data-action="next-cta"]')?.addEventListener('click', goNext);

  container.querySelectorAll<HTMLButtonElement>('[data-weapon-id]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const id = btn.dataset.weaponId;
      if (!id) return;
      if (id === selected?.id) goNext();
      else {
        callbacks.onPlayUiClick('hover');
        onSelectLocal({ weaponId: id });
      }
    });
  });
}

export function renderZoneSelect(container: HTMLElement, ctx: SelectFlowContext): void {
  const { state, catalog, inputMode, callbacks, onSelectLocal } = ctx;
  const zones = catalog.zones;

  const cardsHtml = zones
    .map((z) => {
      const isSel = z.id === state.selectedZoneId;
      return `<button
        type="button"
        class="kt-zone-card ${isSel ? 'kt-selected' : ''}"
        data-focusable="true"
        data-focus-group="grid"
        ${isSel ? 'data-focus-default="true"' : ''}
        data-zone-id="${z.id}"
      >
        <div class="kt-zone-swatch" style="background:linear-gradient(135deg, ${z.floorPrimary}, ${z.floorSecondary});border-color:${z.accentColor}"></div>
        <div style="font-size:21px;font-weight:900;color:var(--kt-gold)">${escapeHtml(z.name)}</div>
        <div style="font-size:13px;color:var(--kt-muted);font-weight:700">${escapeHtml(z.subtitle)}</div>
        <div style="font-size:12px;font-weight:800;color:${z.accentColor};margin-top:auto">
          HAZARD: ${escapeHtml(z.ambientHazard.replace(/_/g, ' ').toUpperCase())}
        </div>
      </button>`;
    })
    .join('');

  container.innerHTML = `
    <div class="kt-screen">
      <div class="kt-header">
        <button type="button" class="kt-btn" data-focusable="true" data-focus-group="nav" data-action="back">
          ${renderGlyph(inputMode, 'B', 'ESC')} BACK
        </button>
        <h2 class="kt-header-title">SELECT ARENA ZONE</h2>
        <button type="button" class="kt-btn kt-btn-primary" data-focusable="true" data-focus-group="nav" data-action="next">
          NEXT: DANGER ${renderGlyph(inputMode, 'A', 'ENTER')}
        </button>
      </div>
      <div class="kt-zone-grid">${cardsHtml}</div>
    </div>
  `;

  container.querySelector('[data-action="back"]')?.addEventListener('click', () => {
    callbacks.onPlayUiClick('cancel');
    callbacks.onCommand({ type: 'set_screen', screen: 'select_weapon' });
  });
  const goNext = (): void => {
    callbacks.onPlayUiClick('confirm');
    callbacks.onCommand({ type: 'set_screen', screen: 'select_danger' });
  };
  container.querySelector('[data-action="next"]')?.addEventListener('click', goNext);

  container.querySelectorAll<HTMLButtonElement>('[data-zone-id]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const zid = Number(btn.dataset.zoneId) as 0 | 1 | 2;
      if (zid === state.selectedZoneId) goNext();
      else {
        callbacks.onPlayUiClick('hover');
        onSelectLocal({ zoneId: zid });
      }
    });
  });
}

export function renderDangerSelect(container: HTMLElement, ctx: SelectFlowContext): void {
  const { state, catalog, inputMode, callbacks, onSelectLocal } = ctx;
  const diffs = catalog.difficulties;

  const cardsHtml = diffs
    .map((d) => {
      const isSel = d.level === state.selectedDanger;
      const mods: string[] = [];
      mods.push(`Enemy HP: ${Math.round(d.enemyHpMult * 100)}%`);
      mods.push(`Enemy DMG: ${Math.round(d.enemyDamageMult * 100)}%`);
      if (d.enemySpeedMult > 1) mods.push(`Enemy Speed: +${Math.round((d.enemySpeedMult - 1) * 100)}%`);
      if (d.elitesEnabled) mods.push(d.extraElites ? 'Extra Elites & Hordes' : 'Elite Waves Enabled');
      if (d.doubleBoss) mods.push('DOUBLE WAVE 20 BOSS!');
      if (d.nightmareEvents) mods.push('Bullet-Hell & Fog Events');

      return `<button
        type="button"
        class="kt-zone-card ${isSel ? 'kt-selected' : ''}"
        style="min-height:152px"
        data-focusable="true"
        data-focus-group="grid"
        ${isSel ? 'data-focus-default="true"' : ''}
        data-danger="${d.level}"
      >
        <div style="font-size:19px;font-weight:900;color:${d.level >= 5 ? '#ff4757' : d.level >= 2 ? '#ffe142' : '#54f06b'}">
          DANGER ${d.level} · ${escapeHtml(d.name)}
        </div>
        <div style="font-size:12px;color:var(--kt-muted);font-weight:700">${escapeHtml(d.description)}</div>
        <div class="kt-effects-list" style="font-size:12px;margin-top:auto">
          ${mods.map((m) => `<div class="kt-neu">• ${escapeHtml(m)}</div>`).join('')}
        </div>
      </button>`;
    })
    .join('');

  container.innerHTML = `
    <div class="kt-screen">
      <div class="kt-header">
        <button type="button" class="kt-btn" data-focusable="true" data-focus-group="nav" data-action="back">
          ${renderGlyph(inputMode, 'B', 'ESC')} BACK
        </button>
        <h2 class="kt-header-title">SELECT DANGER LEVEL (0–6)</h2>
        <button type="button" class="kt-btn kt-btn-go" data-focusable="true" data-focus-group="nav" data-action="start-run">
          START RUN! ${renderGlyph(inputMode, 'A', 'ENTER')}
        </button>
      </div>
      <div class="kt-danger-grid">${cardsHtml}</div>
    </div>
  `;

  container.querySelector('[data-action="back"]')?.addEventListener('click', () => {
    callbacks.onPlayUiClick('cancel');
    callbacks.onCommand({ type: 'set_screen', screen: 'select_zone' });
  });

  const startRun = (dangerOverride?: number): void => {
    callbacks.onPlayUiClick('confirm');
    callbacks.onCommand({
      type: 'start_run',
      characterId: state.selectedCharId || catalog.characters[0]?.id || 'well_rounded',
      weaponId: state.selectedWeaponId || catalog.weapons[0]?.id || 'pistol',
      zoneId: state.selectedZoneId,
      dangerLevel: dangerOverride ?? state.selectedDanger,
    });
  };

  container.querySelector('[data-action="start-run"]')?.addEventListener('click', () => startRun());

  container.querySelectorAll<HTMLButtonElement>('[data-danger]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const lv = Number(btn.dataset.danger);
      if (lv === state.selectedDanger) startRun(lv);
      else {
        callbacks.onPlayUiClick('hover');
        onSelectLocal({ danger: lv });
      }
    });
  });
}
