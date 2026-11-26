// ============================================================================
// src/input/FocusNavigator.ts
// Spatial 2D keyboard + Xbox Gamepad focus manager for every UI screen.
// Supports Left Stick / D-Pad / Arrows spatial navigation, LB/RB group cycling,
// A/Enter activation, and crisp `.kt-focused` ring highlighting.
// ============================================================================

import type { UiNavAction } from '../contracts/index';

export interface FocusActionHandlers {
  onBack?: () => void;
  onXAction?: (focused: HTMLElement | null) => void;
  onYAction?: (focused: HTMLElement | null) => void;
  onLb?: () => boolean | void;
  onRb?: () => boolean | void;
  onPause?: () => void;
  onStats?: () => void;
  onFocusMove?: (el: HTMLElement) => void;
  onConfirm?: (el: HTMLElement) => void;
}

const FOCUSABLE_SELECTOR =
  '[data-focusable="true"]:not([disabled]):not([aria-disabled="true"]), button:not([disabled]):not([data-focus-skip="true"]), input[type="range"]:not([disabled]), input[type="checkbox"]:not([disabled])';

export class FocusNavigator {
  private root: HTMLElement | null = null;
  private focusedEl: HTMLElement | null = null;
  private handlers: FocusActionHandlers = {};

  public attach(root: HTMLElement, handlers: FocusActionHandlers = {}): void {
    this.root = root;
    this.handlers = handlers;
  }

  public setHandlers(handlers: FocusActionHandlers): void {
    this.handlers = handlers;
  }

  public getFocusedElement(): HTMLElement | null {
    if (this.focusedEl && this.root && this.root.contains(this.focusedEl) && this.isElementVisible(this.focusedEl)) {
      return this.focusedEl;
    }
    this.focusedEl = null;
    return null;
  }

  private isElementVisible(el: HTMLElement): boolean {
    if (el.hidden) return false;
    if (typeof window === 'undefined') return true;
    const style = window.getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden' || style.pointerEvents === 'none') {
      return false;
    }
    return true;
  }

  public getFocusableElements(): HTMLElement[] {
    if (!this.root) return [];
    const nodes = Array.from(this.root.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR));
    return nodes.filter((el) => this.isElementVisible(el));
  }

  public focusElement(el: HTMLElement | null, silent = false): void {
    if (this.focusedEl && this.focusedEl !== el) {
      this.focusedEl.classList.remove('kt-focused');
      this.focusedEl.removeAttribute('data-kt-focused');
    }
    this.focusedEl = el;
    if (el) {
      el.classList.add('kt-focused');
      el.setAttribute('data-kt-focused', 'true');
      try {
        el.scrollIntoView({ block: 'nearest', inline: 'nearest' });
      } catch {
        // Ignore in headless/non-layout environments
      }
      if (!silent) {
        this.handlers.onFocusMove?.(el);
      }
    }
  }

  public syncFocus(preferDefault = true): HTMLElement | null {
    const items = this.getFocusableElements();
    if (items.length === 0) {
      this.focusElement(null, true);
      return null;
    }
    if (this.focusedEl && items.includes(this.focusedEl)) {
      this.focusedEl.classList.add('kt-focused');
      return this.focusedEl;
    }
    const preferred = preferDefault
      ? items.find((el) => el.dataset.focusDefault === 'true') ?? items[0]
      : items[0];
    this.focusElement(preferred, true);
    return preferred;
  }

  public clearFocus(): void {
    this.focusElement(null, true);
  }

  public handleAction(action: UiNavAction): boolean {
    switch (action) {
      case 'up':
      case 'down':
      case 'left':
      case 'right':
        return this.moveDirection(action);

      case 'confirm': {
        const current = this.syncFocus();
        if (!current) return false;
        this.handlers.onConfirm?.(current);
        if (current instanceof HTMLInputElement && current.type === 'checkbox') {
          current.checked = !current.checked;
          current.dispatchEvent(new Event('change', { bubbles: true }));
        } else {
          current.click();
        }
        return true;
      }

      case 'back':
        this.handlers.onBack?.();
        return true;

      case 'x_action':
        this.handlers.onXAction?.(this.getFocusedElement());
        return true;

      case 'y_action':
        this.handlers.onYAction?.(this.getFocusedElement());
        return true;

      case 'lb': {
        const handled = this.handlers.onLb?.();
        if (handled) return true;
        return this.cycleFocusGroup(-1);
      }

      case 'rb': {
        const handled = this.handlers.onRb?.();
        if (handled) return true;
        return this.cycleFocusGroup(1);
      }

      case 'pause':
        this.handlers.onPause?.();
        return true;

      case 'stats':
        this.handlers.onStats?.();
        return true;

      default:
        return false;
    }
  }

  private cycleFocusGroup(delta: -1 | 1): boolean {
    const items = this.getFocusableElements();
    if (items.length === 0) return false;

    const groups: string[] = [];
    for (const el of items) {
      const g = el.dataset.focusGroup || 'default';
      if (!groups.includes(g)) groups.push(g);
    }
    if (groups.length <= 1) {
      const cur = this.getFocusedElement();
      const idx = cur ? items.indexOf(cur) : 0;
      const next = items[(idx + delta + items.length) % items.length];
      this.focusElement(next);
      return true;
    }

    const cur = this.getFocusedElement();
    const curGroup = cur?.dataset.focusGroup || groups[0];
    const gIdx = Math.max(0, groups.indexOf(curGroup));
    const nextGroup = groups[(gIdx + delta + groups.length) % groups.length];
    const target = items.find((el) => (el.dataset.focusGroup || 'default') === nextGroup);
    if (target) {
      this.focusElement(target);
      return true;
    }
    return false;
  }

  private moveDirection(dir: 'up' | 'down' | 'left' | 'right'): boolean {
    const items = this.getFocusableElements();
    if (items.length === 0) return false;

    const current = this.getFocusedElement();
    if (!current) {
      this.syncFocus();
      return true;
    }

    // Special case: adjusting range slider with left/right
    if (current instanceof HTMLInputElement && current.type === 'range' && (dir === 'left' || dir === 'right')) {
      const step = parseFloat(current.step) || 0.05;
      const min = parseFloat(current.min) || 0;
      const max = parseFloat(current.max) || 1;
      const curVal = parseFloat(current.value) || 0;
      const nextVal = Math.max(min, Math.min(max, curVal + (dir === 'right' ? step : -step)));
      current.value = String(Number(nextVal.toFixed(4)));
      current.dispatchEvent(new Event('input', { bubbles: true }));
      current.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    }

    const curRect = current.getBoundingClientRect();
    const hasLayout = curRect.width > 0 || curRect.height > 0;

    if (!hasLayout) {
      const idx = items.indexOf(current);
      const delta = dir === 'right' || dir === 'down' ? 1 : -1;
      this.focusElement(items[(idx + delta + items.length) % items.length]);
      return true;
    }

    const cx = curRect.left + curRect.width / 2;
    const cy = curRect.top + curRect.height / 2;

    let bestEl: HTMLElement | null = null;
    let bestScore = Infinity;

    for (const candidate of items) {
      if (candidate === current) continue;
      const rect = candidate.getBoundingClientRect();
      const tx = rect.left + rect.width / 2;
      const ty = rect.top + rect.height / 2;
      const dx = tx - cx;
      const dy = ty - cy;

      let primary = 0;
      let ortho = 0;
      if (dir === 'right') {
        if (dx <= 4) continue;
        primary = dx;
        ortho = Math.abs(dy);
      } else if (dir === 'left') {
        if (dx >= -4) continue;
        primary = -dx;
        ortho = Math.abs(dy);
      } else if (dir === 'down') {
        if (dy <= 4) continue;
        primary = dy;
        ortho = Math.abs(dx);
      } else {
        if (dy >= -4) continue;
        primary = -dy;
        ortho = Math.abs(dx);
      }

      // Strongly favor elements aligned along the travel axis
      const score = primary + ortho * 2.4;
      if (score < bestScore) {
        bestScore = score;
        bestEl = candidate;
      }
    }

    if (bestEl) {
      this.focusElement(bestEl);
      return true;
    }

    // Graceful linear wrap when reaching an edge
    const idx = items.indexOf(current);
    if (dir === 'right' || dir === 'down') {
      this.focusElement(items[(idx + 1) % items.length]);
    } else {
      this.focusElement(items[(idx - 1 + items.length) % items.length]);
    }
    return true;
  }
}
