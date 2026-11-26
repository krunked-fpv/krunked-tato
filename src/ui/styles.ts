// ============================================================================
// src/ui/styles.ts
// Complete comic-arcade CSS design system + shared UI formatting helpers for
// Desktop (1920x1080 / 1280x720), Tesla (1280x800), and Mobile (landscape &
// portrait), with >=48x48px touch targets, safe-area-inset padding, and
// translucent TouchOverlay styling.
// ============================================================================

import {
  CORE_STAT_KEYS,
  RARITY_COLORS,
  type CoreStatKey,
  type EffectDef,
  type InputMode,
  type StatKey,
  type StatMap,
} from '../contracts/index';

const STYLE_ELEMENT_ID = 'krunkedtato-ui-styles';

export const CORE_STAT_LABELS: Readonly<Record<CoreStatKey, { name: string; suffix: string }>> = {
  stat_max_hp: { name: 'Max HP', suffix: '' },
  stat_hp_regen: { name: 'HP Regen', suffix: '' },
  stat_lifesteal: { name: 'Life Steal', suffix: '%' },
  stat_percent_damage: { name: '% Damage', suffix: '%' },
  stat_melee_damage: { name: 'Melee Dmg', suffix: '' },
  stat_ranged_damage: { name: 'Ranged Dmg', suffix: '' },
  stat_elemental_damage: { name: 'Elemental', suffix: '' },
  stat_attack_speed: { name: 'Attack Spd', suffix: '%' },
  stat_crit_chance: { name: 'Crit Chance', suffix: '%' },
  stat_engineering: { name: 'Engineering', suffix: '' },
  stat_range: { name: 'Range', suffix: '' },
  stat_armor: { name: 'Armor', suffix: '' },
  stat_dodge: { name: 'Dodge', suffix: '%' },
  stat_speed: { name: 'Speed', suffix: '%' },
  stat_luck: { name: 'Luck', suffix: '' },
  stat_harvesting: { name: 'Harvesting', suffix: '' },
};

export function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function formatStatName(key: StatKey): string {
  if (key in CORE_STAT_LABELS) {
    return CORE_STAT_LABELS[key as CoreStatKey].name;
  }
  return key
    .replace(/^stat_/, '')
    .split('_')
    .map((w) => (w.length > 0 ? w[0].toUpperCase() + w.slice(1) : ''))
    .join(' ');
}

export function formatSignedStat(key: StatKey, val: number): string {
  const rounded = Math.round(val * 10) / 10;
  const sign = rounded > 0 ? '+' : '';
  const suffix = key in CORE_STAT_LABELS ? CORE_STAT_LABELS[key as CoreStatKey].suffix : '';
  return `${sign}${rounded}${suffix}`;
}

export function formatEffectLine(eff: EffectDef): { text: string; tone: 'pos' | 'neg' | 'neutral' } {
  if (eff.text) {
    const tone = eff.text.trim().startsWith('-') ? 'neg' : eff.text.trim().startsWith('+') ? 'pos' : 'neutral';
    return { text: eff.text, tone };
  }
  if (eff.stat && typeof eff.value === 'number') {
    const tone = eff.value > 0 ? 'pos' : eff.value < 0 ? 'neg' : 'neutral';
    return {
      text: `${formatSignedStat(eff.stat, eff.value)} ${formatStatName(eff.stat)}`,
      tone,
    };
  }
  if (eff.customKey) {
    return { text: formatStatName(eff.customKey as StatKey), tone: 'neutral' };
  }
  return { text: eff.trigger.replace(/_/g, ' '), tone: 'neutral' };
}

export function renderGlyph(
  inputMode: InputMode,
  button: 'A' | 'B' | 'X' | 'Y' | 'LB' | 'RB' | 'START' | 'VIEW',
  kbHint?: string
): string {
  if (inputMode === 'gamepad') {
    const cls =
      button === 'A'
        ? 'kt-glyph kt-glyph-a'
        : button === 'B'
          ? 'kt-glyph kt-glyph-b'
          : button === 'X'
            ? 'kt-glyph kt-glyph-x'
            : button === 'Y'
              ? 'kt-glyph kt-glyph-y'
              : 'kt-glyph kt-glyph-bump';
    return `<span class="${cls}">${button}</span>`;
  }
  if (inputMode === 'keyboard' && kbHint) {
    return `<span class="kt-keycap">${escapeHtml(kbHint)}</span>`;
  }
  return '';
}

export function getRarityColor(tier: number): string {
  return RARITY_COLORS[Math.max(0, Math.min(3, tier))] ?? RARITY_COLORS[0];
}

export function renderCoreStatsGridHtml(stats: StatMap): string {
  return CORE_STAT_KEYS.map((key) => {
    const meta = CORE_STAT_LABELS[key];
    const val = Math.round((stats[key] ?? 0) * 10) / 10;
    const tone = val > 0 ? 'kt-stat-pos' : val < 0 ? 'kt-stat-neg' : 'kt-stat-zero';
    return `<div class="kt-stat-row">
      <span class="kt-stat-name">${escapeHtml(meta.name)}</span>
      <span class="kt-stat-val ${tone}">${val}${meta.suffix}</span>
    </div>`;
  }).join('');
}

const STYLES_CSS = `
:root {
  --kt-bg: #13111c;
  --kt-panel: #1c1929;
  --kt-panel-hi: #272338;
  --kt-ink: #110f17;
  --kt-text: #f6f4ee;
  --kt-muted: #aba6bc;
  --kt-gold: #ffe142;
  --kt-lime: #6bff3b;
  --kt-crimson: #ff3b4e;
  --kt-cyan: #4ee4ff;
  --kt-purple: #ad5aff;
  --kt-safe-t: env(safe-area-inset-top, 0px);
  --kt-safe-r: env(safe-area-inset-right, 0px);
  --kt-safe-b: env(safe-area-inset-bottom, 0px);
  --kt-safe-l: env(safe-area-inset-left, 0px);
}

/* ---------- Shared Comic-Arcade Surfaces & Controls ---------- */
.kt-screen {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  padding: calc(14px + var(--kt-safe-t)) calc(18px + var(--kt-safe-r)) calc(14px + var(--kt-safe-b)) calc(18px + var(--kt-safe-l));
  background: radial-gradient(circle at 50% 18%, rgba(44, 34, 68, 0.94), rgba(16, 14, 24, 0.98));
  color: var(--kt-text);
  pointer-events: auto;
  overflow: hidden;
  gap: 12px;
}

.kt-modal-backdrop {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: calc(14px + var(--kt-safe-t)) calc(16px + var(--kt-safe-r)) calc(14px + var(--kt-safe-b)) calc(16px + var(--kt-safe-l));
  background: rgba(10, 9, 16, 0.78);
  backdrop-filter: blur(5px);
  pointer-events: auto;
  overflow-y: auto;
}

.kt-panel {
  background: var(--kt-panel);
  border: 3px solid var(--kt-ink);
  border-radius: 14px;
  box-shadow: 0 5px 0 var(--kt-ink), inset 0 1px 0 rgba(255, 255, 255, 0.08);
}

.kt-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  min-width: 48px;
  min-height: 48px;
  padding: 10px 18px;
  font-family: inherit;
  font-size: 15px;
  font-weight: 800;
  letter-spacing: 0.03em;
  color: var(--kt-text);
  background: #2c2740;
  border: 3px solid var(--kt-ink);
  border-radius: 11px;
  box-shadow: 0 4px 0 var(--kt-ink);
  cursor: pointer;
  transition: transform 0.08s ease, background 0.12s ease, border-color 0.12s ease;
  touch-action: manipulation;
}

.kt-btn:hover:not(:disabled) {
  background: #383252;
  transform: translateY(-1px);
}

.kt-btn:active:not(:disabled) {
  transform: translateY(2px);
  box-shadow: 0 2px 0 var(--kt-ink);
}

.kt-btn:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

.kt-btn-primary {
  background: linear-gradient(180deg, #ffba26, #e68814);
  color: #16111c;
}
.kt-btn-primary:hover:not(:disabled) {
  background: linear-gradient(180deg, #ffca4d, #f5981d);
}

.kt-btn-go {
  background: linear-gradient(180deg, #4be045, #22a82a);
  color: #0e190f;
}
.kt-btn-go:hover:not(:disabled) {
  background: linear-gradient(180deg, #64ef5e, #2ec237);
}

.kt-btn-danger {
  background: linear-gradient(180deg, #ff4757, #cc2336);
  color: #ffffff;
}
.kt-btn-danger:hover:not(:disabled) {
  background: linear-gradient(180deg, #ff6170, #de2b3f);
}

.kt-btn-cyan {
  background: linear-gradient(180deg, #43c6ff, #1f8ad6);
  color: #0b141f;
}

.kt-btn-sm {
  min-height: 48px;
  padding: 6px 12px;
  font-size: 13px;
}

.kt-focused {
  outline: 3px solid var(--kt-gold) !important;
  outline-offset: 2px;
  box-shadow: 0 0 0 6px rgba(255, 225, 66, 0.25), 0 4px 0 var(--kt-ink) !important;
  transform: translateY(-2px);
  z-index: 5;
}

/* ---------- Xbox / Keyboard Glyphs ---------- */
.kt-glyph {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 22px;
  height: 22px;
  padding: 0 5px;
  border-radius: 999px;
  font-size: 11px;
  font-weight: 900;
  color: #100e16;
  border: 2px solid #100e16;
  line-height: 1;
}
.kt-glyph-a { background: #34d399; }
.kt-glyph-b { background: #f87171; }
.kt-glyph-x { background: #60a5fa; }
.kt-glyph-y { background: #facc15; }
.kt-glyph-bump { background: #cbd5e1; border-radius: 6px; }

.kt-keycap {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 2px 6px;
  border-radius: 5px;
  font-size: 11px;
  font-weight: 800;
  background: rgba(255, 255, 255, 0.14);
  border: 1.5px solid rgba(255, 255, 255, 0.28);
  color: #f4f2ec;
  line-height: 1.2;
}

/* ---------- Combat HUD Overlay ---------- */
.kt-hud {
  position: absolute;
  inset: 0;
  pointer-events: none;
  padding: calc(12px + var(--kt-safe-t)) calc(16px + var(--kt-safe-r)) calc(12px + var(--kt-safe-b)) calc(16px + var(--kt-safe-l));
  display: flex;
  flex-direction: column;
  justify-content: space-between;
}

.kt-hud-top {
  display: grid;
  grid-template-columns: minmax(210px, 280px) 1fr minmax(140px, 260px);
  align-items: start;
  gap: 12px;
}

.kt-hud-left {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.kt-bar-wrap {
  position: relative;
  height: 24px;
  background: rgba(17, 15, 23, 0.88);
  border: 3px solid var(--kt-ink);
  border-radius: 9px;
  overflow: hidden;
  box-shadow: 0 3px 0 var(--kt-ink);
}
.kt-bar-wrap-sm {
  height: 18px;
}
.kt-bar-fill {
  height: 100%;
  transition: width 0.08s linear;
}
.kt-bar-hp {
  background: linear-gradient(90deg, #e11d48, #ff4757);
}
.kt-bar-xp {
  background: linear-gradient(90deg, #2563eb, #38bdf8);
}
.kt-bar-boss {
  background: linear-gradient(90deg, #991b1b, #ff2846);
}
.kt-bar-label {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 8px;
  font-size: 12px;
  font-weight: 900;
  text-shadow: 0 1.5px 0 #000, 1px 0 0 #000, -1px 0 0 #000;
}

.kt-hud-currency {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}
.kt-mat-pill {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 4px 10px;
  background: rgba(18, 16, 26, 0.88);
  border: 2.5px solid var(--kt-ink);
  border-radius: 9px;
  font-size: 15px;
  font-weight: 900;
  color: var(--kt-lime);
  box-shadow: 0 3px 0 var(--kt-ink);
}
.kt-bag-pill {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 3px 9px;
  background: rgba(30, 56, 22, 0.9);
  border: 2.5px solid var(--kt-ink);
  border-radius: 9px;
  font-size: 13px;
  font-weight: 900;
  color: #d4ff70;
}

.kt-hud-center {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
}
.kt-wave-title {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  font-size: 18px;
  font-weight: 900;
  letter-spacing: 0.08em;
  text-shadow: 0 3px 0 #110f17, 2px 0 0 #110f17, -2px 0 0 #110f17, 0 -2px 0 #110f17;
}
.kt-wave-badge {
  padding: 2px 8px;
  border-radius: 6px;
  font-size: 11px;
  font-weight: 900;
  border: 2px solid var(--kt-ink);
  color: #110f17;
  text-shadow: none;
}
.kt-timer {
  font-size: 40px;
  line-height: 1;
  font-weight: 900;
  font-variant-numeric: tabular-nums;
  color: #ffffff;
  text-shadow: 0 4px 0 #110f17, 2px 0 0 #110f17, -2px 0 0 #110f17, 0 -2px 0 #110f17;
}
.kt-timer-urgent {
  color: #ff4757;
  animation: ktPulseUrgent 0.55s ease-in-out infinite;
}
@keyframes ktPulseUrgent {
  0%, 100% { transform: scale(1); }
  50% { transform: scale(1.1); }
}

.kt-boss-bars {
  width: min(460px, 90%);
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin-top: 2px;
}

.kt-hud-right {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  pointer-events: auto;
}
.kt-hud-chip {
  min-height: 48px;
  min-width: 48px;
  padding: 6px 12px;
  border-radius: 10px;
  background: rgba(20, 18, 30, 0.8);
  border: 2.5px solid var(--kt-ink);
  color: var(--kt-text);
  font-size: 12px;
  font-weight: 800;
  cursor: pointer;
}

.kt-hud-hints {
  align-self: center;
  display: inline-flex;
  align-items: center;
  gap: 12px;
  padding: 5px 14px;
  border-radius: 999px;
  background: rgba(15, 13, 22, 0.72);
  border: 2px solid rgba(255, 255, 255, 0.12);
  font-size: 12px;
  font-weight: 700;
  color: #d7d3e3;
}

.kt-stats-drawer {
  position: absolute;
  top: calc(78px + var(--kt-safe-t));
  right: calc(16px + var(--kt-safe-r));
  width: 248px;
  max-height: calc(100vh - 140px);
  overflow-y: auto;
  padding: 12px;
  pointer-events: auto;
  background: rgba(22, 19, 34, 0.94);
  border: 3px solid var(--kt-ink);
  border-radius: 13px;
  box-shadow: 0 5px 0 var(--kt-ink);
}

/* ---------- Title Screen ---------- */
.kt-title-screen {
  align-items: center;
  justify-content: center;
  gap: 18px;
}
.kt-logo-box {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
}
.kt-logo-title {
  margin: 0;
  font-size: clamp(44px, 7.5vw, 76px);
  font-weight: 900;
  letter-spacing: -0.02em;
  color: var(--kt-gold);
  text-shadow: 0 6px 0 #110f17, 3px 0 0 #110f17, -3px 0 0 #110f17, 0 -3px 0 #110f17;
  line-height: 1;
}
.kt-logo-sub {
  font-size: 13px;
  font-weight: 800;
  letter-spacing: 0.22em;
  text-transform: uppercase;
  color: #d6d1e6;
}
.kt-title-menu {
  display: flex;
  flex-direction: column;
  width: min(340px, 92vw);
  gap: 10px;
}
.kt-asset-bar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 10px 14px;
  max-width: min(740px, 96vw);
}
.kt-asset-pill {
  padding: 5px 10px;
  border-radius: 8px;
  font-size: 12px;
  font-weight: 800;
  background: rgba(255, 255, 255, 0.08);
  border: 2px solid var(--kt-ink);
}
.kt-asset-msg {
  width: 100%;
  text-align: center;
  font-size: 12px;
  font-weight: 700;
  color: var(--kt-lime);
}
.kt-asset-msg-err {
  color: var(--kt-crimson);
}

/* ---------- Select Screens ---------- */
.kt-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
}
.kt-header-title {
  margin: 0;
  font-size: clamp(20px, 2.8vw, 30px);
  font-weight: 900;
  letter-spacing: 0.04em;
  color: var(--kt-gold);
  text-shadow: 0 3px 0 var(--kt-ink);
}

.kt-select-layout {
  flex: 1;
  min-height: 0;
  display: grid;
  grid-template-columns: 1fr minmax(280px, 360px);
  gap: 14px;
}
.kt-card-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(128px, 1fr));
  gap: 10px;
  overflow-y: auto;
  padding: 4px;
  align-content: start;
}
.kt-pick-card {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 6px;
  min-height: 112px;
  min-width: 48px;
  padding: 10px 8px;
  background: var(--kt-panel);
  border: 3px solid var(--kt-ink);
  border-radius: 12px;
  color: var(--kt-text);
  cursor: pointer;
  text-align: center;
  box-shadow: 0 4px 0 var(--kt-ink);
  transition: transform 0.08s ease, background 0.1s ease;
}
.kt-pick-card:hover {
  background: var(--kt-panel-hi);
}
.kt-pick-card.kt-selected {
  border-color: var(--kt-gold);
  background: #30294a;
}
.kt-card-icon {
  width: 52px;
  height: 52px;
  object-fit: contain;
  image-rendering: auto;
}
.kt-card-name {
  font-size: 13px;
  font-weight: 800;
  line-height: 1.15;
}
.kt-detail-panel {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 16px;
  overflow-y: auto;
}
.kt-detail-head {
  display: flex;
  align-items: center;
  gap: 12px;
}
.kt-detail-icon {
  width: 68px;
  height: 68px;
  padding: 6px;
  background: rgba(0, 0, 0, 0.3);
  border: 3px solid var(--kt-ink);
  border-radius: 12px;
  object-fit: contain;
}
.kt-effects-list {
  display: flex;
  flex-direction: column;
  gap: 5px;
  font-size: 13px;
  font-weight: 700;
}
.kt-pos { color: #54f06b; }
.kt-neg { color: #ff5c6c; }
.kt-neu { color: #d5d0e6; }

.kt-zone-grid {
  flex: 1;
  min-height: 0;
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 14px;
  align-content: center;
  overflow-y: auto;
}
.kt-zone-card {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 16px;
  min-height: 220px;
  text-align: left;
  background: var(--kt-panel);
  border: 3px solid var(--kt-ink);
  border-radius: 14px;
  color: var(--kt-text);
  cursor: pointer;
  box-shadow: 0 5px 0 var(--kt-ink);
}
.kt-zone-card.kt-selected {
  border-color: var(--kt-gold);
  background: #2f2848;
}
.kt-zone-swatch {
  height: 64px;
  border-radius: 10px;
  border: 3px solid var(--kt-ink);
}

.kt-danger-grid {
  flex: 1;
  min-height: 0;
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(210px, 1fr));
  gap: 10px;
  overflow-y: auto;
  align-content: start;
  padding: 4px;
}

/* ---------- Shop Screen ---------- */
.kt-shop-body {
  flex: 1;
  min-height: 0;
  display: grid;
  grid-template-columns: 1fr 252px;
  gap: 12px;
}
.kt-shop-main {
  display: flex;
  flex-direction: column;
  gap: 10px;
  min-height: 0;
  overflow-y: auto;
  padding-right: 2px;
}
.kt-shop-offers {
  display: grid;
  grid-template-columns: repeat(4, minmax(150px, 1fr));
  gap: 10px;
}
.kt-offer-card {
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  gap: 8px;
  padding: 11px;
  background: var(--kt-panel);
  border: 3px solid var(--kt-ink);
  border-radius: 13px;
  box-shadow: 0 4px 0 var(--kt-ink);
  min-height: 210px;
}
.kt-offer-card.kt-offer-sold {
  opacity: 0.42;
}
.kt-offer-top {
  display: flex;
  align-items: center;
  gap: 9px;
}
.kt-offer-icon {
  width: 48px;
  height: 48px;
  border-radius: 9px;
  padding: 4px;
  background: rgba(0, 0, 0, 0.34);
  border: 2.5px solid var(--kt-ink);
  object-fit: contain;
  flex-shrink: 0;
}
.kt-offer-actions {
  display: flex;
  gap: 6px;
}
.kt-offer-actions .kt-btn {
  flex: 1;
  padding: 6px 8px;
  font-size: 13px;
}

.kt-shop-bottom-row {
  display: grid;
  grid-template-columns: 1.25fr 1fr;
  gap: 10px;
}
.kt-subpanel {
  padding: 10px 12px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.kt-subpanel-title {
  font-size: 13px;
  font-weight: 900;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--kt-muted);
  display: flex;
  justify-content: space-between;
  align-items: center;
}
.kt-weapons-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(112px, 1fr));
  gap: 7px;
}
.kt-weapon-slot {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  padding: 7px 6px;
  min-height: 76px;
  background: rgba(15, 13, 22, 0.65);
  border: 3px solid var(--kt-ink);
  border-radius: 10px;
  color: var(--kt-text);
  cursor: pointer;
}
.kt-weapon-slot.kt-selected {
  background: #332b4f;
  border-color: var(--kt-gold);
}
.kt-weapon-slot img {
  width: 36px;
  height: 36px;
  object-fit: contain;
}
.kt-set-badges {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.kt-set-badge {
  padding: 4px 8px;
  border-radius: 7px;
  font-size: 11px;
  font-weight: 800;
  background: rgba(255, 225, 66, 0.14);
  border: 2px solid var(--kt-ink);
  color: var(--kt-gold);
}
.kt-items-strip {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.kt-item-chip {
  position: relative;
  width: 48px;
  height: 48px;
  padding: 4px;
  background: rgba(15, 13, 22, 0.72);
  border: 2.5px solid var(--kt-ink);
  border-radius: 9px;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
}
.kt-item-chip img {
  width: 34px;
  height: 34px;
  object-fit: contain;
}
.kt-item-count {
  position: absolute;
  right: 2px;
  bottom: 1px;
  font-size: 11px;
  font-weight: 900;
  color: #ffffff;
  text-shadow: 0 1.5px 0 #000;
}

.kt-stats-sidebar {
  padding: 12px;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.kt-stat-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 3px 6px;
  border-radius: 6px;
  background: rgba(255, 255, 255, 0.04);
  font-size: 13px;
  font-weight: 700;
}
.kt-stat-name { color: #d5d0e6; }
.kt-stat-val { font-weight: 900; font-variant-numeric: tabular-nums; }
.kt-stat-pos { color: #54f06b; }
.kt-stat-neg { color: #ff5c6c; }
.kt-stat-zero { color: #a7a2b8; }

/* ---------- Modals (Crate, Level-Up, Pause, Options, Codex, End) ---------- */
.kt-modal-box {
  width: min(860px, 96vw);
  max-height: 92vh;
  overflow-y: auto;
  padding: 20px;
  display: flex;
  flex-direction: column;
  gap: 14px;
}
.kt-modal-narrow {
  width: min(480px, 94vw);
}
.kt-upgrade-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(140px, 1fr));
  gap: 10px;
}
.kt-upgrade-card {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  padding: 14px 10px;
  min-height: 170px;
  background: var(--kt-panel-hi);
  border: 3px solid var(--kt-ink);
  border-radius: 13px;
  color: var(--kt-text);
  cursor: pointer;
  box-shadow: 0 4px 0 var(--kt-ink);
  text-align: center;
}
.kt-upgrade-card:hover {
  background: #363050;
}
.kt-options-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 8px 10px;
  background: rgba(255, 255, 255, 0.04);
  border-radius: 9px;
  font-size: 14px;
  font-weight: 700;
}
.kt-options-row input[type="range"] {
  width: 150px;
  min-height: 40px;
  accent-color: var(--kt-gold);
}

/* ---------- Translucent Mobile & Tesla Touch Overlay ---------- */
.kt-touch-overlay {
  position: absolute;
  inset: 0;
  transition: opacity 0.14s ease;
  touch-action: none;
  user-select: none;
}
.kt-touch-zone {
  position: absolute;
  top: 0;
  bottom: 0;
  width: 50%;
  touch-action: none;
}
.kt-touch-zone-left { left: 0; }
.kt-touch-zone-right { right: 0; }

.kt-touch-stick-base {
  position: fixed;
  width: 124px;
  height: 124px;
  margin-left: -62px;
  margin-top: -62px;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.16);
  border: 3px solid rgba(255, 255, 255, 0.65);
  box-shadow: 0 0 18px rgba(0, 0, 0, 0.35);
  pointer-events: none;
}
.kt-touch-move-base {
  left: calc(96px + var(--kt-safe-l));
  top: calc(100vh - 104px - var(--kt-safe-b));
}
.kt-touch-left-handed .kt-touch-move-base:not(.kt-stick-active) {
  left: calc(100vw - 96px - var(--kt-safe-r));
}
.kt-touch-aim-base {
  left: calc(100vw - 96px - var(--kt-safe-r));
  top: calc(100vh - 104px - var(--kt-safe-b));
  border-color: rgba(255, 225, 66, 0.75);
}
.kt-touch-stick-nub {
  position: absolute;
  left: 50%;
  top: 50%;
  width: 50px;
  height: 50px;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.72);
  border: 3px solid rgba(17, 15, 23, 0.75);
  transform: translate(-50%, -50%);
}
.kt-touch-aim-nub {
  background: rgba(255, 225, 66, 0.78);
}

.kt-touch-pills {
  position: fixed;
  top: calc(12px + var(--kt-safe-t));
  right: calc(12px + var(--kt-safe-r));
  display: flex;
  gap: 8px;
}
.kt-touch-pill {
  min-width: 52px;
  min-height: 52px;
  padding: 0 12px;
  border-radius: 14px;
  background: rgba(24, 22, 36, 0.78);
  border: 2.5px solid rgba(255, 255, 255, 0.62);
  color: #ffffff;
  font-family: inherit;
  font-size: 12px;
  font-weight: 900;
  letter-spacing: 0.04em;
  backdrop-filter: blur(6px);
  touch-action: manipulation;
}
.kt-touch-pill.kt-pill-active {
  border-color: var(--kt-gold);
  color: var(--kt-gold);
}

/* ---------- Responsive Breakpoints (Tesla 1280x800, Mobile Landscape & Portrait) ---------- */
@media (max-width: 1020px) {
  .kt-shop-body {
    grid-template-columns: 1fr;
  }
  .kt-shop-offers {
    grid-template-columns: repeat(2, minmax(140px, 1fr));
  }
  .kt-shop-bottom-row {
    grid-template-columns: 1fr;
  }
  .kt-stats-sidebar {
    max-height: 220px;
  }
  .kt-select-layout {
    grid-template-columns: 1fr;
  }
  .kt-zone-grid {
    grid-template-columns: 1fr;
  }
  .kt-upgrade-grid {
    grid-template-columns: repeat(2, minmax(130px, 1fr));
  }
}

@media (max-width: 640px) {
  .kt-hud-top {
    grid-template-columns: 1fr auto;
  }
  .kt-hud-right {
    display: none;
  }
  .kt-timer {
    font-size: 30px;
  }
  .kt-shop-offers {
    grid-template-columns: 1fr;
  }
}

@media (max-height: 460px) {
  .kt-screen {
    padding: calc(8px + var(--kt-safe-t)) calc(12px + var(--kt-safe-r)) calc(8px + var(--kt-safe-b)) calc(12px + var(--kt-safe-l));
    gap: 8px;
  }
  .kt-timer {
    font-size: 28px;
  }
  .kt-offer-card {
    min-height: 150px;
    padding: 8px;
  }
}
`;

export function injectKrunkedStyles(): void {
  if (typeof document === 'undefined') return;
  if (document.getElementById(STYLE_ELEMENT_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ELEMENT_ID;
  style.textContent = STYLES_CSS;
  document.head.appendChild(style);
}
