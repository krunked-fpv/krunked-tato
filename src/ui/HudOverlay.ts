// ============================================================================
// src/ui/HudOverlay.ts
// High-clarity Combat HUD with incremental DOM updates (zero per-frame DOM
// teardown): HP/XP bars, Materials + 2x Loot Bag badge, bold Wave + urgent
// crimson timer (<5s), Boss HP bar(s), toggleable 16-stat drawer, and dynamic
// Keyboard / Xbox glyph hint strip.
// ============================================================================

import {
  SIM_HZ,
  type GameDataCatalog,
  type InputMode,
  type SimState,
} from '../contracts/index';
import { escapeHtml, renderCoreStatsGridHtml, renderGlyph } from './styles';

export interface HudCallbacks {
  onTogglePause(): void;
  onToggleAutoAim(): void;
  onToggleStats(): void;
}

export class HudOverlay {
  private readonly root: HTMLDivElement;
  private readonly hpFill: HTMLDivElement;
  private readonly hpLabel: HTMLSpanElement;
  private readonly xpFill: HTMLDivElement;
  private readonly lvLabel: HTMLSpanElement;
  private readonly matValue: HTMLSpanElement;
  private readonly bagPill: HTMLDivElement;
  private readonly waveTitle: HTMLDivElement;
  private readonly timerEl: HTMLDivElement;
  private readonly bossBarsEl: HTMLDivElement;
  private readonly rightBar: HTMLDivElement;
  private readonly aimChip: HTMLButtonElement;
  private readonly hintsEl: HTMLDivElement;
  private readonly statsDrawer: HTMLDivElement;

  private lastInputMode: InputMode | null = null;
  private lastStatsSig = '';
  private lastBossSig = '';

  constructor(parent: HTMLElement, callbacks: HudCallbacks) {
    const root = document.createElement('div');
    root.className = 'kt-hud';
    root.style.display = 'none';

    const top = document.createElement('div');
    top.className = 'kt-hud-top';

    // Top-Left: HP, XP, Materials + Loot Bag
    const left = document.createElement('div');
    left.className = 'kt-hud-left';

    const hpWrap = document.createElement('div');
    hpWrap.className = 'kt-bar-wrap';
    const hpFill = document.createElement('div');
    hpFill.className = 'kt-bar-fill kt-bar-hp';
    const hpLabelRow = document.createElement('div');
    hpLabelRow.className = 'kt-bar-label';
    const hpTag = document.createElement('span');
    hpTag.textContent = 'HP';
    const hpLabel = document.createElement('span');
    hpLabelRow.append(hpTag, hpLabel);
    hpWrap.append(hpFill, hpLabelRow);

    const xpWrap = document.createElement('div');
    xpWrap.className = 'kt-bar-wrap kt-bar-wrap-sm';
    const xpFill = document.createElement('div');
    xpFill.className = 'kt-bar-fill kt-bar-xp';
    const xpLabelRow = document.createElement('div');
    xpLabelRow.className = 'kt-bar-label';
    const lvLabel = document.createElement('span');
    xpLabelRow.append(lvLabel);
    xpWrap.append(xpFill, xpLabelRow);

    const currency = document.createElement('div');
    currency.className = 'kt-hud-currency';
    const matPill = document.createElement('div');
    matPill.className = 'kt-mat-pill';
    const matDot = document.createElement('span');
    matDot.textContent = '◆';
    const matValue = document.createElement('span');
    matValue.textContent = '0';
    matPill.append(matDot, matValue);

    const bagPill = document.createElement('div');
    bagPill.className = 'kt-bag-pill';
    bagPill.style.display = 'none';
    currency.append(matPill, bagPill);

    left.append(hpWrap, xpWrap, currency);

    // Top-Center: Wave + Timer + Boss HP Bars
    const center = document.createElement('div');
    center.className = 'kt-hud-center';
    const waveTitle = document.createElement('div');
    waveTitle.className = 'kt-wave-title';
    const timerEl = document.createElement('div');
    timerEl.className = 'kt-timer';
    const bossBarsEl = document.createElement('div');
    bossBarsEl.className = 'kt-boss-bars';
    center.append(waveTitle, timerEl, bossBarsEl);

    // Top-Right: Desktop/Mouse quick pills (hidden in touch mode where TouchOverlay draws translucent pills)
    const rightBar = document.createElement('div');
    rightBar.className = 'kt-hud-right';

    const aimChip = document.createElement('button');
    aimChip.type = 'button';
    aimChip.className = 'kt-hud-chip';
    aimChip.dataset.focusSkip = 'true';
    aimChip.addEventListener('click', () => callbacks.onToggleAutoAim());

    const statsChip = document.createElement('button');
    statsChip.type = 'button';
    statsChip.className = 'kt-hud-chip';
    statsChip.dataset.focusSkip = 'true';
    statsChip.textContent = 'STATS';
    statsChip.addEventListener('click', () => callbacks.onToggleStats());

    const pauseChip = document.createElement('button');
    pauseChip.type = 'button';
    pauseChip.className = 'kt-hud-chip';
    pauseChip.dataset.focusSkip = 'true';
    pauseChip.textContent = 'PAUSE';
    pauseChip.addEventListener('click', () => callbacks.onTogglePause());

    rightBar.append(aimChip, statsChip, pauseChip);
    top.append(left, center, rightBar);

    const hintsEl = document.createElement('div');
    hintsEl.className = 'kt-hud-hints';

    const statsDrawer = document.createElement('div');
    statsDrawer.className = 'kt-stats-drawer';
    statsDrawer.style.display = 'none';

    root.append(top, hintsEl, statsDrawer);
    parent.appendChild(root);

    this.root = root;
    this.hpFill = hpFill;
    this.hpLabel = hpLabel;
    this.xpFill = xpFill;
    this.lvLabel = lvLabel;
    this.matValue = matValue;
    this.bagPill = bagPill;
    this.waveTitle = waveTitle;
    this.timerEl = timerEl;
    this.bossBarsEl = bossBarsEl;
    this.rightBar = rightBar;
    this.aimChip = aimChip;
    this.hintsEl = hintsEl;
    this.statsDrawer = statsDrawer;
  }

  public setVisible(visible: boolean): void {
    this.root.style.display = visible ? 'flex' : 'none';
  }

  public update(
    state: SimState,
    catalog: GameDataCatalog,
    inputMode: InputMode,
    statsOpen: boolean
  ): void {
    const p = state.player;
    const hpPct = Math.max(0, Math.min(100, (p.hp / Math.max(1, p.maxHp)) * 100));
    this.hpFill.style.width = `${hpPct.toFixed(1)}%`;
    this.hpLabel.textContent = `${Math.max(0, Math.ceil(p.hp))} / ${Math.max(1, Math.round(p.maxHp))}`;

    const xpPct = Math.max(0, Math.min(100, (p.xp / Math.max(1, p.xpToNext)) * 100));
    this.xpFill.style.width = `${xpPct.toFixed(1)}%`;
    this.lvLabel.textContent = `LV ${p.level}${p.pendingLevelUps > 0 ? ` (+${p.pendingLevelUps})` : ''}`;

    this.matValue.textContent = String(Math.floor(p.materials));
    if (p.bonusGold > 0) {
      this.bagPill.style.display = 'inline-flex';
      this.bagPill.textContent = `BAG +${Math.floor(p.bonusGold)} (2x)`;
    } else {
      this.bagPill.style.display = 'none';
    }

    // Wave badge + Countdown
    const badges: string[] = [];
    if (state.isEndless) badges.push('<span class="kt-wave-badge" style="background:#ad5aff;color:#fff">ENDLESS</span>');
    if (state.isBossWave) badges.push('<span class="kt-wave-badge" style="background:#ff3b4e;color:#fff">BOSS</span>');
    else if (state.isEliteWave) badges.push('<span class="kt-wave-badge" style="background:#ffd43b">ELITE</span>');
    if (state.isHordeWave) badges.push('<span class="kt-wave-badge" style="background:#ff922b">HORDE</span>');
    if (state.nightmareEvent !== 'none') {
      badges.push(`<span class="kt-wave-badge" style="background:#e11d48;color:#fff">${state.nightmareEvent.replace('_', ' ').toUpperCase()}</span>`);
    }
    this.waveTitle.innerHTML = `WAVE ${state.wave}${badges.length > 0 ? ` ${badges.join(' ')}` : ''}`;

    const remTicks = Math.max(0, state.waveDurationTicks - state.waveElapsedTicks);
    const remSec = Math.ceil(remTicks / SIM_HZ);
    this.timerEl.textContent = state.screen === 'wave_end' ? 'CLEAR!' : String(remSec);
    this.timerEl.classList.toggle('kt-timer-urgent', state.screen === 'combat' && remSec <= 5 && remSec > 0);

    // Boss HP Bars (supports single or Double Boss!)
    const bosses = state.enemies.filter((e) => e.kind === 'boss');
    const bossSig = bosses.map((b) => `${b.uid}:${Math.ceil(b.hp)}/${Math.ceil(b.maxHp)}`).join('|');
    if (bossSig !== this.lastBossSig) {
      this.lastBossSig = bossSig;
      if (bosses.length === 0) {
        this.bossBarsEl.innerHTML = '';
      } else {
        this.bossBarsEl.innerHTML = bosses
          .map((b) => {
            const def = catalog.enemiesById[b.defId];
            const name = def?.name ?? b.defId.toUpperCase();
            const pct = Math.max(0, Math.min(100, (b.hp / Math.max(1, b.maxHp)) * 100));
            return `<div class="kt-bar-wrap">
              <div class="kt-bar-fill kt-bar-boss" style="width:${pct.toFixed(1)}%"></div>
              <div class="kt-bar-label"><span>${escapeHtml(name)}</span><span>${Math.max(0, Math.ceil(b.hp))} / ${Math.ceil(b.maxHp)}</span></div>
            </div>`;
          })
          .join('');
      }
    }

    // Aim chip & touch-mode HUD visibility
    this.rightBar.style.display = inputMode === 'touch' ? 'none' : 'flex';
    this.aimChip.textContent = state.autoAim ? 'AIM: AUTO' : 'AIM: MANUAL';
    this.aimChip.style.borderColor = state.autoAim ? '#110f17' : '#ffe142';

    // Control hints strip
    if (inputMode !== this.lastInputMode) {
      this.lastInputMode = inputMode;
      if (inputMode === 'touch') {
        this.hintsEl.style.display = 'none';
      } else if (inputMode === 'gamepad') {
        this.hintsEl.style.display = 'inline-flex';
        this.hintsEl.innerHTML = `
          <span>${renderGlyph('gamepad', 'LB').replace('LB', 'LS')} Move</span>
          <span>${renderGlyph('gamepad', 'RB').replace('RB', 'RS')} Aim</span>
          <span>${renderGlyph('gamepad', 'X')} Auto-Aim</span>
          <span>${renderGlyph('gamepad', 'VIEW')} Stats</span>
          <span>${renderGlyph('gamepad', 'START')} Pause</span>
        `;
      } else {
        this.hintsEl.style.display = 'inline-flex';
        this.hintsEl.innerHTML = `
          <span><span class="kt-keycap">WASD</span> Move</span>
          <span><span class="kt-keycap">SPACE / Click</span> Auto-Aim</span>
          <span><span class="kt-keycap">TAB</span> Stats</span>
          <span><span class="kt-keycap">ESC</span> Pause</span>
        `;
      }
    }

    // Stats drawer
    this.statsDrawer.style.display = statsOpen ? 'block' : 'none';
    if (statsOpen) {
      const sig = JSON.stringify(p.computedStats);
      if (sig !== this.lastStatsSig) {
        this.lastStatsSig = sig;
        this.statsDrawer.innerHTML = `<div class="kt-subpanel-title" style="margin-bottom:8px"><span>LIVE STATS</span><span>LV ${p.level}</span></div>${renderCoreStatsGridHtml(p.computedStats)}`;
      }
    }
  }

  public dispose(): void {
    this.root.remove();
  }
}
