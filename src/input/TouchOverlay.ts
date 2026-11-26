// ============================================================================
// src/input/TouchOverlay.ts
// Translucent Mobile & Tesla Browser Touch Controls Overlay.
// STRICT VISIBILITY CONTRACT:
// - Completely hidden (display: none, opacity: 0, pointer-events: none) in
//   keyboard/mouse AND gamepad modes!
// - Smoothly reveals translucent glass controls (idleOpacity ~0.24,
//   activeOpacity ~0.46, strictly < 0.6) ONLY when activeInputMode === 'touch'.
// - Dynamic floating left-half movement stick, optional right-half manual-aim
//   drag pad, and >=48x48px translucent corner glass pills (Auto-Aim, Stats, Pause)
//   respecting env(safe-area-inset-*).
// ============================================================================

import type { GameScreen, InputMode, TouchSettings } from '../contracts/index';

export interface TouchOverlayCallbacks {
  onToggleAutoAim(): void;
  onToggleStats(): void;
  onPause(): void;
  onTouchDetected(): void;
}

export interface TouchStickSnapshot {
  moveX: number;
  moveY: number;
  aimX: number;
  aimY: number;
  aimActive: boolean;
  statsActive: boolean;
}

const MAX_STICK_RADIUS = 56;
const STICK_DEADZONE = 0.08;

export class TouchOverlay {
  private readonly host: HTMLElement | null;
  private readonly callbacks: TouchOverlayCallbacks;
  private rootEl: HTMLDivElement | null = null;
  private moveZoneEl: HTMLDivElement | null = null;
  private aimZoneEl: HTMLDivElement | null = null;
  private moveBaseEl: HTMLDivElement | null = null;
  private moveNubEl: HTMLDivElement | null = null;
  private aimBaseEl: HTMLDivElement | null = null;
  private aimNubEl: HTMLDivElement | null = null;
  private pillsEl: HTMLDivElement | null = null;
  private autoAimBtn: HTMLButtonElement | null = null;
  private statsBtn: HTMLButtonElement | null = null;
  private pauseBtn: HTMLButtonElement | null = null;

  private mode: InputMode = 'keyboard';
  private screen: GameScreen = 'title';
  private settings: TouchSettings = {
    idleOpacity: 0.24,
    activeOpacity: 0.46,
    leftHanded: false,
  };

  private movePointerId: number | null = null;
  private moveOriginX = 0;
  private moveOriginY = 0;
  private moveX = 0;
  private moveY = 0;

  private aimPointerId: number | null = null;
  private aimOriginX = 0;
  private aimOriginY = 0;
  private aimX = 0;
  private aimY = 0;
  private aimActive = false;

  private autoAimEnabled = true;
  private statsToggled = false;

  private boundPointerDown: (e: PointerEvent) => void;
  private boundPointerMove: (e: PointerEvent) => void;
  private boundPointerUp: (e: PointerEvent) => void;

  constructor(host: HTMLElement | null, callbacks: TouchOverlayCallbacks) {
    this.host = host;
    this.callbacks = callbacks;

    this.boundPointerDown = (e) => this.handlePointerDown(e);
    this.boundPointerMove = (e) => this.handlePointerMove(e);
    this.boundPointerUp = (e) => this.handlePointerUp(e);

    if (this.host && typeof document !== 'undefined') {
      this.buildDom(this.host);
    }
    this.syncVisibility();
  }

  private clampOpacity(val: number): number {
    return Math.max(0.1, Math.min(0.58, val));
  }

  private buildDom(host: HTMLElement): void {
    const root = document.createElement('div');
    root.className = 'kt-touch-overlay';
    root.dataset.testid = 'touch-overlay';
    root.style.display = 'none';
    root.style.opacity = '0';
    root.style.pointerEvents = 'none';

    const moveZone = document.createElement('div');
    moveZone.className = 'kt-touch-zone kt-touch-zone-left';

    const aimZone = document.createElement('div');
    aimZone.className = 'kt-touch-zone kt-touch-zone-right';

    // Movement floating analog stick (with subtle resting hint in safe bottom-left)
    const moveBase = document.createElement('div');
    moveBase.className = 'kt-touch-stick-base kt-touch-move-base';
    const moveNub = document.createElement('div');
    moveNub.className = 'kt-touch-stick-nub';
    moveBase.appendChild(moveNub);

    // Optional manual-aim right drag stick
    const aimBase = document.createElement('div');
    aimBase.className = 'kt-touch-stick-base kt-touch-aim-base';
    const aimNub = document.createElement('div');
    aimNub.className = 'kt-touch-stick-nub kt-touch-aim-nub';
    aimBase.appendChild(aimNub);

    // Translucent corner glass pills (>= 48x48 CSS px, safe-area-inset margins)
    const pills = document.createElement('div');
    pills.className = 'kt-touch-pills';

    const autoAimBtn = document.createElement('button');
    autoAimBtn.type = 'button';
    autoAimBtn.className = 'kt-touch-pill';
    autoAimBtn.dataset.focusSkip = 'true';
    autoAimBtn.textContent = 'AUTO';
    autoAimBtn.setAttribute('aria-label', 'Toggle Auto-Aim');
    autoAimBtn.addEventListener('pointerdown', (e) => {
      e.stopPropagation();
      if (e.pointerType === 'touch') this.callbacks.onTouchDetected();
      this.callbacks.onToggleAutoAim();
    });

    const statsBtn = document.createElement('button');
    statsBtn.type = 'button';
    statsBtn.className = 'kt-touch-pill';
    statsBtn.dataset.focusSkip = 'true';
    statsBtn.textContent = 'STATS';
    statsBtn.setAttribute('aria-label', 'Toggle Stats');
    statsBtn.addEventListener('pointerdown', (e) => {
      e.stopPropagation();
      if (e.pointerType === 'touch') this.callbacks.onTouchDetected();
      this.statsToggled = !this.statsToggled;
      statsBtn.classList.toggle('kt-pill-active', this.statsToggled);
      this.callbacks.onToggleStats();
    });

    const pauseBtn = document.createElement('button');
    pauseBtn.type = 'button';
    pauseBtn.className = 'kt-touch-pill';
    pauseBtn.dataset.focusSkip = 'true';
    pauseBtn.textContent = 'II';
    pauseBtn.setAttribute('aria-label', 'Pause');
    pauseBtn.addEventListener('pointerdown', (e) => {
      e.stopPropagation();
      if (e.pointerType === 'touch') this.callbacks.onTouchDetected();
      this.callbacks.onPause();
    });

    pills.append(autoAimBtn, statsBtn, pauseBtn);
    root.append(moveZone, aimZone, moveBase, aimBase, pills);
    host.appendChild(root);

    moveZone.addEventListener('pointerdown', this.boundPointerDown);
    aimZone.addEventListener('pointerdown', this.boundPointerDown);
    window.addEventListener('pointermove', this.boundPointerMove, { passive: true });
    window.addEventListener('pointerup', this.boundPointerUp, { passive: true });
    window.addEventListener('pointercancel', this.boundPointerUp, { passive: true });

    this.rootEl = root;
    this.moveZoneEl = moveZone;
    this.aimZoneEl = aimZone;
    this.moveBaseEl = moveBase;
    this.moveNubEl = moveNub;
    this.aimBaseEl = aimBase;
    this.aimNubEl = aimNub;
    this.pillsEl = pills;
    this.autoAimBtn = autoAimBtn;
    this.statsBtn = statsBtn;
    this.pauseBtn = pauseBtn;
  }

  public setInputMode(mode: InputMode): void {
    this.mode = mode;
    if (mode !== 'touch') {
      this.resetSticks();
    }
    this.syncVisibility();
  }

  public setScreen(screen: GameScreen): void {
    this.screen = screen;
    if (screen !== 'combat' && screen !== 'wave_end') {
      this.resetSticks();
      this.statsToggled = false;
      this.statsBtn?.classList.remove('kt-pill-active');
    }
    this.syncVisibility();
  }

  public setAutoAimEnabled(enabled: boolean): void {
    this.autoAimEnabled = enabled;
    if (this.autoAimBtn) {
      this.autoAimBtn.textContent = enabled ? 'AUTO' : 'MANUAL';
      this.autoAimBtn.classList.toggle('kt-pill-active', !enabled);
    }
  }

  public applySettings(settings: TouchSettings): void {
    this.settings = {
      idleOpacity: this.clampOpacity(settings.idleOpacity),
      activeOpacity: this.clampOpacity(settings.activeOpacity),
      leftHanded: settings.leftHanded,
    };
    if (this.rootEl) {
      this.rootEl.classList.toggle('kt-touch-left-handed', this.settings.leftHanded);
    }
    this.syncVisibility();
  }

  private isCombatScreen(): boolean {
    return this.screen === 'combat' || this.screen === 'wave_end';
  }

  private isStickActive(): boolean {
    return this.movePointerId !== null || this.aimPointerId !== null;
  }

  public getStatus(): { visible: boolean; opacity: number; mode: InputMode } {
    if (this.mode !== 'touch') {
      return { visible: false, opacity: 0, mode: this.mode };
    }
    const op = this.isStickActive()
      ? this.clampOpacity(this.settings.activeOpacity)
      : this.clampOpacity(this.settings.idleOpacity);
    return {
      visible: true,
      opacity: Number(op.toFixed(3)),
      mode: this.mode,
    };
  }

  public getSnapshot(): TouchStickSnapshot {
    return {
      moveX: this.moveX,
      moveY: this.moveY,
      aimX: this.aimX,
      aimY: this.aimY,
      aimActive: this.aimActive,
      statsActive: this.statsToggled,
    };
  }

  private resetSticks(): void {
    this.movePointerId = null;
    this.aimPointerId = null;
    this.moveX = 0;
    this.moveY = 0;
    this.aimX = 0;
    this.aimY = 0;
    this.aimActive = false;

    if (this.moveBaseEl && this.moveNubEl) {
      this.moveBaseEl.classList.remove('kt-stick-active');
      this.moveBaseEl.style.left = '';
      this.moveBaseEl.style.top = '';
      this.moveNubEl.style.transform = 'translate(-50%, -50%)';
    }
    if (this.aimBaseEl && this.aimNubEl) {
      this.aimBaseEl.classList.remove('kt-stick-active');
      this.aimBaseEl.style.left = '';
      this.aimBaseEl.style.top = '';
      this.aimNubEl.style.transform = 'translate(-50%, -50%)';
    }
  }

  private syncVisibility(): void {
    if (!this.rootEl) return;

    if (this.mode !== 'touch') {
      this.rootEl.style.display = 'none';
      this.rootEl.style.opacity = '0';
      this.rootEl.style.pointerEvents = 'none';
      if (this.moveZoneEl) this.moveZoneEl.style.pointerEvents = 'none';
      if (this.aimZoneEl) this.aimZoneEl.style.pointerEvents = 'none';
      if (this.pillsEl) this.pillsEl.style.pointerEvents = 'none';
      return;
    }

    const op = this.isStickActive()
      ? this.clampOpacity(this.settings.activeOpacity)
      : this.clampOpacity(this.settings.idleOpacity);
    const interactive = this.isCombatScreen();

    this.rootEl.style.display = 'block';
    this.rootEl.style.opacity = String(op);
    this.rootEl.style.pointerEvents = 'none';

    if (this.moveZoneEl) this.moveZoneEl.style.pointerEvents = interactive ? 'auto' : 'none';
    if (this.aimZoneEl) this.aimZoneEl.style.pointerEvents = interactive ? 'auto' : 'none';
    if (this.pillsEl) {
      this.pillsEl.style.pointerEvents = interactive ? 'auto' : 'none';
      this.pillsEl.style.visibility = interactive ? 'visible' : 'hidden';
    }
    if (this.moveBaseEl) this.moveBaseEl.style.visibility = interactive ? 'visible' : 'hidden';
    if (this.aimBaseEl) this.aimBaseEl.style.visibility = interactive && this.aimPointerId !== null ? 'visible' : 'hidden';
  }

  private handlePointerDown(e: PointerEvent): void {
    if (e.pointerType !== 'touch' && this.mode !== 'touch') return;
    if (!this.isCombatScreen()) return;

    if (e.pointerType === 'touch') {
      this.callbacks.onTouchDetected();
    }

    const viewW = window.innerWidth || 1;
    const isLeftHalf = e.clientX < viewW * 0.5;
    const wantsMove = this.settings.leftHanded ? !isLeftHalf : isLeftHalf;

    if (wantsMove && this.movePointerId === null) {
      this.movePointerId = e.pointerId;
      this.moveOriginX = e.clientX;
      this.moveOriginY = e.clientY;
      this.moveX = 0;
      this.moveY = 0;
      if (this.moveBaseEl && this.moveNubEl) {
        this.moveBaseEl.classList.add('kt-stick-active');
        this.moveBaseEl.style.left = `${e.clientX}px`;
        this.moveBaseEl.style.top = `${e.clientY}px`;
        this.moveNubEl.style.transform = 'translate(-50%, -50%)';
      }
      this.syncVisibility();
    } else if (!wantsMove && this.aimPointerId === null) {
      this.aimPointerId = e.pointerId;
      this.aimOriginX = e.clientX;
      this.aimOriginY = e.clientY;
      this.aimX = 0;
      this.aimY = 0;
      this.aimActive = false;
      if (this.aimBaseEl && this.aimNubEl) {
        this.aimBaseEl.classList.add('kt-stick-active');
        this.aimBaseEl.style.left = `${e.clientX}px`;
        this.aimBaseEl.style.top = `${e.clientY}px`;
        this.aimNubEl.style.transform = 'translate(-50%, -50%)';
      }
      this.syncVisibility();
    }
  }

  private handlePointerMove(e: PointerEvent): void {
    if (e.pointerId === this.movePointerId) {
      const dx = e.clientX - this.moveOriginX;
      const dy = e.clientY - this.moveOriginY;
      const dist = Math.hypot(dx, dy);
      const clamped = Math.min(MAX_STICK_RADIUS, dist);
      const norm = clamped / MAX_STICK_RADIUS;
      const ang = dist > 0.001 ? Math.atan2(dy, dx) : 0;

      if (norm > STICK_DEADZONE) {
        const rescaled = (norm - STICK_DEADZONE) / (1 - STICK_DEADZONE);
        this.moveX = Math.cos(ang) * rescaled;
        this.moveY = Math.sin(ang) * rescaled;
      } else {
        this.moveX = 0;
        this.moveY = 0;
      }

      if (this.moveNubEl) {
        const ox = Math.cos(ang) * clamped;
        const oy = Math.sin(ang) * clamped;
        this.moveNubEl.style.transform = `translate(calc(-50% + ${ox.toFixed(1)}px), calc(-50% + ${oy.toFixed(1)}px))`;
      }
    } else if (e.pointerId === this.aimPointerId) {
      const dx = e.clientX - this.aimOriginX;
      const dy = e.clientY - this.aimOriginY;
      const dist = Math.hypot(dx, dy);
      const clamped = Math.min(MAX_STICK_RADIUS, dist);
      const norm = clamped / MAX_STICK_RADIUS;
      const ang = dist > 0.001 ? Math.atan2(dy, dx) : 0;

      if (norm > 0.14) {
        this.aimX = Math.cos(ang);
        this.aimY = Math.sin(ang);
        this.aimActive = true;
      } else {
        this.aimX = 0;
        this.aimY = 0;
        this.aimActive = false;
      }

      if (this.aimNubEl) {
        const ox = Math.cos(ang) * clamped;
        const oy = Math.sin(ang) * clamped;
        this.aimNubEl.style.transform = `translate(calc(-50% + ${ox.toFixed(1)}px), calc(-50% + ${oy.toFixed(1)}px))`;
      }
    }
  }

  private handlePointerUp(e: PointerEvent): void {
    if (e.pointerId === this.movePointerId) {
      this.movePointerId = null;
      this.moveX = 0;
      this.moveY = 0;
      if (this.moveBaseEl && this.moveNubEl) {
        this.moveBaseEl.classList.remove('kt-stick-active');
        this.moveBaseEl.style.left = '';
        this.moveBaseEl.style.top = '';
        this.moveNubEl.style.transform = 'translate(-50%, -50%)';
      }
      this.syncVisibility();
    } else if (e.pointerId === this.aimPointerId) {
      this.aimPointerId = null;
      this.aimX = 0;
      this.aimY = 0;
      this.aimActive = false;
      if (this.aimBaseEl && this.aimNubEl) {
        this.aimBaseEl.classList.remove('kt-stick-active');
        this.aimBaseEl.style.left = '';
        this.aimBaseEl.style.top = '';
        this.aimNubEl.style.transform = 'translate(-50%, -50%)';
      }
      this.syncVisibility();
    }
  }

  public dispose(): void {
    if (this.moveZoneEl) this.moveZoneEl.removeEventListener('pointerdown', this.boundPointerDown);
    if (this.aimZoneEl) this.aimZoneEl.removeEventListener('pointerdown', this.boundPointerDown);
    if (typeof window !== 'undefined') {
      window.removeEventListener('pointermove', this.boundPointerMove);
      window.removeEventListener('pointerup', this.boundPointerUp);
      window.removeEventListener('pointercancel', this.boundPointerUp);
    }
    this.rootEl?.remove();
  }
}
