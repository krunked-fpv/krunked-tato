// ============================================================================
// src/ui/UIManager.ts
// Root UI orchestrator connecting HudOverlay, SelectScreens, ShopScreen,
// Modals, and FocusNavigator across every krunkedtato screen.
// Uses smart render-key diffing so combat runs with ZERO DOM rebuilds and
// menu screens preserve keyboard/gamepad focus cleanly across interactions.
// ============================================================================

import type {
  CustomPackStatus,
  GameDataCatalog,
  GameScreen,
  InputMode,
  SaveData,
  SimState,
  UIManagerCallbacks,
  UiNavAction,
} from '../contracts/index';
import type { AssetRegistry } from '../assets/AssetRegistry';
import { FocusNavigator } from '../input/FocusNavigator';
import { HudOverlay } from './HudOverlay';
import {
  renderCodexScreen,
  renderCrateModal,
  renderEndScreen,
  renderLevelUpModal,
  renderOptionsScreen,
  renderPauseModal,
  type CodexTab,
} from './Modals';
import {
  renderCharacterSelect,
  renderDangerSelect,
  renderTitleScreen,
  renderWeaponSelect,
  renderZoneSelect,
  type SelectFlowContext,
} from './SelectScreens';
import { renderShopScreen } from './ShopScreen';
import { injectKrunkedStyles } from './styles';

const CODEX_TABS: readonly CodexTab[] = ['characters', 'weapons', 'items', 'challenges'];

export class UIManager {
  private readonly root: HTMLElement;
  private readonly catalog: GameDataCatalog;
  private readonly assetRegistry: AssetRegistry;
  private readonly callbacks: UIManagerCallbacks;

  private readonly hud: HudOverlay;
  private readonly menuLayer: HTMLDivElement;
  private readonly focusNav = new FocusNavigator();

  private lastScreen: GameScreen | null = null;
  private lastRenderKey = '';
  private customPackMessage: { text: string; isError: boolean } | null = null;
  private selectedWeaponUid: number | null = null;
  private inspectedItemId: string | null = null;
  private codexTab: CodexTab = 'characters';
  private confirmResetSave = false;
  private statsDrawerOpen = false;
  private localSelection = {
    charId: '',
    weaponId: '',
    zoneId: 0 as 0 | 1 | 2,
    danger: 0,
    initialized: false,
  };
  private lastStateRef: SimState | null = null;
  private unsubscribeAssets: () => void;

  constructor(
    root: HTMLElement,
    catalog: GameDataCatalog,
    assetRegistry: AssetRegistry,
    callbacks: UIManagerCallbacks
  ) {
    injectKrunkedStyles();
    this.root = root;
    this.catalog = catalog;
    this.assetRegistry = assetRegistry;
    this.callbacks = callbacks;

    this.root.innerHTML = '';

    this.hud = new HudOverlay(this.root, {
      onTogglePause: () => this.callbacks.onCommand({ type: 'toggle_pause' }),
      onToggleAutoAim: () => this.callbacks.onCommand({ type: 'toggle_auto_aim' }),
      onToggleStats: () => {
        this.statsDrawerOpen = !this.statsDrawerOpen;
      },
    });

    const menuLayer = document.createElement('div');
    menuLayer.style.position = 'absolute';
    menuLayer.style.inset = '0';
    menuLayer.style.pointerEvents = 'none';
    this.root.appendChild(menuLayer);
    this.menuLayer = menuLayer;

    this.focusNav.attach(this.menuLayer, {
      onFocusMove: (el) => {
        this.callbacks.onPlayUiClick('hover');
        this.syncSelectFromFocusedElement(el);
      },
      onBack: () => this.handleBackAction(),
      onXAction: (el) => this.handleXAction(el),
      onYAction: (el) => this.handleYAction(el),
      onLb: () => this.handleBumper(-1),
      onRb: () => this.handleBumper(1),
      onPause: () => this.handlePauseNav(),
      onStats: () => {
        this.statsDrawerOpen = !this.statsDrawerOpen;
      },
    });

    this.unsubscribeAssets = this.assetRegistry.subscribe(() => {
      this.invalidate();
    });
  }

  public setCustomPackMessage(text: string | null, isError = false): void {
    this.customPackMessage = text ? { text, isError } : null;
    this.invalidate();
  }

  public invalidate(): void {
    this.lastRenderKey = '';
  }

  public isStatsDrawerOpen(): boolean {
    return this.statsDrawerOpen;
  }

  public setStatsDrawerOpen(open: boolean): void {
    this.statsDrawerOpen = open;
  }

  public handleNavAction(action: UiNavAction, state: SimState): void {
    this.lastStateRef = state;
    if (state.screen === 'combat' || state.screen === 'wave_end') {
      if (action === 'stats') {
        this.statsDrawerOpen = !this.statsDrawerOpen;
      } else if (action === 'pause') {
        this.callbacks.onCommand({ type: 'toggle_pause' });
      }
      return;
    }
    this.focusNav.handleAction(action);
  }

  private syncSelectFromFocusedElement(el: HTMLElement | null): void {
    if (!el || !this.lastStateRef) return;
    const scr = this.lastStateRef.screen;
    if (scr === 'select_character' && el.dataset.charId) {
      const id = el.dataset.charId;
      if (id !== this.localSelection.charId) {
        const c = this.catalog.charactersById[id];
        this.localSelection.charId = id;
        if (c?.startingWeapons[0]) {
          this.localSelection.weaponId = c.startingWeapons[0];
        }
        this.invalidate();
      }
    } else if (scr === 'select_weapon' && el.dataset.weaponId) {
      const id = el.dataset.weaponId;
      if (id !== this.localSelection.weaponId) {
        this.localSelection.weaponId = id;
        this.invalidate();
      }
    } else if (scr === 'select_zone' && el.dataset.zoneId !== undefined) {
      const zid = Number(el.dataset.zoneId) as 0 | 1 | 2;
      if (zid !== this.localSelection.zoneId) {
        this.localSelection.zoneId = zid;
        this.invalidate();
      }
    } else if (scr === 'select_danger' && el.dataset.danger !== undefined) {
      const lv = Number(el.dataset.danger);
      if (lv !== this.localSelection.danger) {
        this.localSelection.danger = lv;
        this.invalidate();
      }
    }
  }

  private handleBackAction(): void {
    const screen = this.lastStateRef?.screen;
    if (!screen) return;
    switch (screen) {
      case 'select_character':
      case 'codex':
      case 'victory':
      case 'game_over':
        this.callbacks.onPlayUiClick('cancel');
        this.callbacks.onCommand({ type: 'set_screen', screen: 'title' });
        break;
      case 'select_weapon':
        this.callbacks.onPlayUiClick('cancel');
        this.callbacks.onCommand({ type: 'set_screen', screen: 'select_character' });
        break;
      case 'select_zone':
        this.callbacks.onPlayUiClick('cancel');
        this.callbacks.onCommand({ type: 'set_screen', screen: 'select_weapon' });
        break;
      case 'select_danger':
        this.callbacks.onPlayUiClick('cancel');
        this.callbacks.onCommand({ type: 'set_screen', screen: 'select_zone' });
        break;
      case 'pause':
        this.callbacks.onPlayUiClick('confirm');
        this.callbacks.onCommand({ type: 'toggle_pause' });
        break;
      case 'options':
        this.callbacks.onPlayUiClick('cancel');
        this.callbacks.onCommand({
          type: 'set_screen',
          screen: this.lastStateRef?.previousScreen === 'pause' ? 'pause' : 'title',
        });
        break;
      default:
        break;
    }
  }

  private handlePauseNav(): void {
    const screen = this.lastStateRef?.screen;
    if (screen === 'pause') {
      this.callbacks.onCommand({ type: 'toggle_pause' });
    } else if (screen === 'shop') {
      this.callbacks.onPlayUiClick('confirm');
      this.callbacks.onCommand({ type: 'shop_next_wave' });
    }
  }

  private handleXAction(focused: HTMLElement | null): void {
    const screen = this.lastStateRef?.screen;
    if (screen === 'shop') {
      if (focused?.dataset.weaponUid) {
        const uid = Number(focused.dataset.weaponUid);
        this.callbacks.onPlayUiClick('cancel');
        this.callbacks.onCommand({ type: 'shop_recycle', weaponUid: uid });
      } else {
        this.callbacks.onPlayUiClick('reroll');
        this.callbacks.onCommand({ type: 'shop_reroll' });
      }
    } else if (screen === 'level_up') {
      this.callbacks.onPlayUiClick('reroll');
      this.callbacks.onCommand({ type: 'level_up_reroll' });
    } else if (screen === 'crate_modal') {
      this.callbacks.onPlayUiClick('buy');
      this.callbacks.onCommand({ type: 'crate_recycle' });
    }
  }

  private handleYAction(focused: HTMLElement | null): void {
    const screen = this.lastStateRef?.screen;
    if (screen !== 'shop') return;
    if (focused?.dataset.shopBuy !== undefined) {
      const idx = Number(focused.dataset.shopBuy);
      this.callbacks.onPlayUiClick('hover');
      this.callbacks.onCommand({ type: 'shop_lock', slotIndex: idx });
    } else if (focused?.dataset.weaponUid) {
      const uid = Number(focused.dataset.weaponUid);
      this.callbacks.onPlayUiClick('combine');
      this.callbacks.onCommand({ type: 'shop_combine', weaponUid: uid });
    } else if (this.selectedWeaponUid !== null) {
      this.callbacks.onPlayUiClick('combine');
      this.callbacks.onCommand({ type: 'shop_combine', weaponUid: this.selectedWeaponUid });
    }
  }

  private handleBumper(delta: -1 | 1): boolean {
    if (this.lastStateRef?.screen === 'codex') {
      const idx = CODEX_TABS.indexOf(this.codexTab);
      this.codexTab = CODEX_TABS[(idx + delta + CODEX_TABS.length) % CODEX_TABS.length];
      this.callbacks.onPlayUiClick('hover');
      this.invalidate();
      return true;
    }
    return false;
  }

  private computeRenderKey(
    state: SimState,
    saveData: SaveData,
    inputMode: InputMode,
    customPackStatus: CustomPackStatus
  ): string {
    const assetMode = this.assetRegistry.getMode();
    const base = `${state.screen}|${inputMode}|${assetMode}|${customPackStatus.available}:${customPackStatus.textureCount}:${customPackStatus.audioCount}|${this.customPackMessage?.text ?? ''}`;

    switch (state.screen) {
      case 'title':
        return `${base}|run:${saveData.activeRun?.wave ?? 'none'}`;
      case 'select_character':
      case 'select_weapon':
      case 'select_zone':
      case 'select_danger':
        return `${base}|${this.localSelection.charId}|${this.localSelection.weaponId}|${this.localSelection.zoneId}|${this.localSelection.danger}`;
      case 'shop': {
        const offersSig = state.shop.offers
          .map((o) => `${o.defId}:${o.tier}:${o.price}:${o.locked ? 1 : 0}:${o.purchased ? 1 : 0}`)
          .join(',');
        const wepSig = state.player.weapons.map((w) => `${w.uid}:${w.weaponId}:${w.tier}`).join(',');
        return `${base}|w${state.wave}|m${Math.floor(state.player.materials)}|r${state.shop.rerollCost}:${state.shop.freeRerollsLeft}|${offersSig}|${wepSig}|i${state.player.items.length}|sw${this.selectedWeaponUid}|ii${this.inspectedItemId}`;
      }
      case 'crate_modal': {
        const first = state.crateModal.pendingCrates[0];
        return `${base}|crates:${state.crateModal.pendingCrates.length}|${first?.itemId ?? ''}:${first?.isLegendary ?? false}`;
      }
      case 'level_up':
        return `${base}|lu:${state.levelUp.remainingLevelUps}:${state.levelUp.rerollCost}:${state.levelUp.offers.map((u) => u.id).join(',')}|m${Math.floor(state.player.materials)}`;
      case 'options':
        return `${base}|${JSON.stringify(saveData.renderSettings)}|${JSON.stringify(saveData.audioSettings)}|${JSON.stringify(saveData.touchSettings)}|rst:${this.confirmResetSave}`;
      case 'codex':
        return `${base}|tab:${this.codexTab}|u:${saveData.unlockedChallenges.length}`;
      case 'pause':
      case 'victory':
      case 'game_over':
        return `${base}|w${state.wave}|k${state.runStats.kills}`;
      default:
        return base;
    }
  }

  public update(
    state: SimState,
    saveData: SaveData,
    inputMode: InputMode,
    customPackStatus: CustomPackStatus,
    statsHeld: boolean
  ): void {
    this.lastStateRef = state;

    if (!this.localSelection.initialized) {
      this.localSelection.charId = state.selectedCharId || this.catalog.characters[0]?.id || 'well_rounded';
      this.localSelection.weaponId = state.selectedWeaponId || this.catalog.weapons[0]?.id || 'pistol';
      this.localSelection.zoneId = state.selectedZoneId ?? 0;
      this.localSelection.danger = state.selectedDanger ?? 0;
      this.localSelection.initialized = true;
    }

    const isCombat = state.screen === 'combat' || state.screen === 'wave_end';
    this.hud.setVisible(isCombat);

    if (isCombat) {
      if (this.lastScreen !== state.screen) {
        this.menuLayer.innerHTML = '';
        this.focusNav.clearFocus();
        this.lastScreen = state.screen;
        this.lastRenderKey = '';
      }
      this.hud.update(state, this.catalog, inputMode, statsHeld || this.statsDrawerOpen);
      return;
    }

    // Menu / Modal Screen
    const nextKey = this.computeRenderKey(state, saveData, inputMode, customPackStatus);
    if (nextKey === this.lastRenderKey) return;

    // Avoid rebuilding options DOM mid-drag on an active range slider
    if (
      state.screen === 'options' &&
      this.lastScreen === 'options' &&
      typeof document !== 'undefined' &&
      document.activeElement instanceof HTMLInputElement &&
      document.activeElement.type === 'range' &&
      this.menuLayer.contains(document.activeElement)
    ) {
      this.lastRenderKey = nextKey;
      return;
    }

    const screenChanged = this.lastScreen !== state.screen;
    const prevFocused = this.focusNav.getFocusedElement();
    const prevFocusIdx = prevFocused ? this.focusNav.getFocusableElements().indexOf(prevFocused) : -1;

    this.lastScreen = state.screen;
    this.lastRenderKey = nextKey;

    // Mirror local selection cleanly onto state for rendering select screens
    const viewState: SimState = {
      ...state,
      selectedCharId: this.localSelection.charId,
      selectedWeaponId: this.localSelection.weaponId,
      selectedZoneId: this.localSelection.zoneId,
      selectedDanger: this.localSelection.danger,
    };

    const selectCtx: SelectFlowContext = {
      state: viewState,
      catalog: this.catalog,
      saveData,
      assetRegistry: this.assetRegistry,
      inputMode,
      customPackStatus,
      customPackMessage: this.customPackMessage,
      callbacks: this.callbacks,
      onSelectLocal: (patch) => {
        if (patch.charId !== undefined) this.localSelection.charId = patch.charId;
        if (patch.weaponId !== undefined) this.localSelection.weaponId = patch.weaponId;
        if (patch.zoneId !== undefined) this.localSelection.zoneId = patch.zoneId;
        if (patch.danger !== undefined) this.localSelection.danger = patch.danger;
        this.invalidate();
      },
    };

    const modalCtx = {
      state,
      catalog: this.catalog,
      saveData,
      assetRegistry: this.assetRegistry,
      inputMode,
      customPackStatus,
      callbacks: this.callbacks,
      codexTab: this.codexTab,
      confirmResetSave: this.confirmResetSave,
      onSetCodexTab: (tab: CodexTab) => {
        this.codexTab = tab;
        this.invalidate();
      },
      onSetConfirmResetSave: (val: boolean) => {
        this.confirmResetSave = val;
        this.invalidate();
      },
    };

    switch (state.screen) {
      case 'title':
        renderTitleScreen(this.menuLayer, selectCtx);
        break;
      case 'select_character':
        renderCharacterSelect(this.menuLayer, selectCtx);
        break;
      case 'select_weapon':
        renderWeaponSelect(this.menuLayer, selectCtx);
        break;
      case 'select_zone':
        renderZoneSelect(this.menuLayer, selectCtx);
        break;
      case 'select_danger':
        renderDangerSelect(this.menuLayer, selectCtx);
        break;
      case 'shop':
        renderShopScreen(this.menuLayer, {
          state,
          catalog: this.catalog,
          assetRegistry: this.assetRegistry,
          inputMode,
          callbacks: this.callbacks,
          selectedWeaponUid: this.selectedWeaponUid,
          inspectedItemId: this.inspectedItemId,
          onSelectWeaponUid: (uid) => {
            this.selectedWeaponUid = uid;
            this.invalidate();
          },
          onInspectItemId: (id) => {
            this.inspectedItemId = id;
            this.invalidate();
          },
        });
        break;
      case 'crate_modal':
        renderCrateModal(this.menuLayer, modalCtx);
        break;
      case 'level_up':
        renderLevelUpModal(this.menuLayer, modalCtx);
        break;
      case 'pause':
        renderPauseModal(this.menuLayer, modalCtx);
        break;
      case 'options':
        renderOptionsScreen(this.menuLayer, modalCtx);
        break;
      case 'codex':
        renderCodexScreen(this.menuLayer, modalCtx);
        break;
      case 'victory':
        renderEndScreen(this.menuLayer, modalCtx, true);
        break;
      case 'game_over':
        renderEndScreen(this.menuLayer, modalCtx, false);
        break;
      default:
        this.menuLayer.innerHTML = '';
        break;
    }

    // Restore or initialize keyboard/gamepad focus cleanly
    if (screenChanged || prevFocusIdx < 0) {
      this.focusNav.syncFocus(true);
    } else {
      const nextItems = this.focusNav.getFocusableElements();
      if (nextItems.length > 0) {
        const clamped = Math.min(prevFocusIdx, nextItems.length - 1);
        this.focusNav.focusElement(nextItems[clamped], true);
      }
    }
  }

  public dispose(): void {
    this.unsubscribeAssets();
    this.focusNav.clearFocus();
    this.hud.dispose();
    this.menuLayer.remove();
  }
}
