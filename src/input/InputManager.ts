// ============================================================================
// src/input/InputManager.ts
// Unified Multi-Device Input Manager:
// - Desktop Keyboard + Mouse (WASD/Arrows, Space/Click/M auto-aim, Esc, Tab)
// - Xbox / Standard Gamepad API (0.15 radial deadzone with smooth rescaling,
//   Right Stick twin-stick manual aim override, A/B/X/Y/LB/RB/Start/View)
// - Mobile & Tesla Translucent Touch Controls (TouchOverlay strictly hidden
//   until touch event or setInputMode('touch'), immediately hidden again on
//   keyboard/mouse/gamepad input!)
// ============================================================================

import type {
  GameScreen,
  InputFrame,
  InputMode,
  KeyBindings,
  TouchSettings,
  UiNavAction,
} from '../contracts/index';
import { screenToWorld } from '../render/index';
import { TouchOverlay } from './TouchOverlay';

export const DEFAULT_KEY_BINDINGS: KeyBindings = {
  moveUp: 'KeyW',
  moveDown: 'KeyS',
  moveLeft: 'KeyA',
  moveRight: 'KeyD',
  toggleAutoAim: 'Space',
  pause: 'Escape',
  stats: 'Tab',
};

const STICK_DEADZONE = 0.15;
const RIGHT_STICK_DEADZONE = 0.18;
const NAV_INITIAL_DELAY_MS = 260;
const NAV_REPEAT_MS = 115;

export interface InputManagerOptions {
  canvas: HTMLCanvasElement | null;
  touchRoot: HTMLElement | null;
  onNavAction?: (action: UiNavAction) => void;
  onInputModeChange?: (mode: InputMode) => void;
  onUserInteraction?: () => void;
}

function applyRadialDeadzone(rawX: number, rawY: number, deadzone: number): { x: number; y: number; mag: number } {
  const mag = Math.hypot(rawX, rawY);
  if (mag <= deadzone) return { x: 0, y: 0, mag: 0 };
  const clamped = Math.min(1, mag);
  const rescaled = (clamped - deadzone) / (1 - deadzone);
  return {
    x: (rawX / mag) * rescaled,
    y: (rawY / mag) * rescaled,
    mag: rescaled,
  };
}

export class InputManager {
  private readonly canvas: HTMLCanvasElement | null;
  private readonly touchOverlay: TouchOverlay;
  private readonly onNavAction?: (action: UiNavAction) => void;
  private readonly onInputModeChange?: (mode: InputMode) => void;
  private readonly onUserInteraction?: () => void;

  private activeInputMode: InputMode = 'keyboard';
  private screen: GameScreen = 'title';
  private bindings: KeyBindings = { ...DEFAULT_KEY_BINDINGS };

  private keysDown = new Set<string>();
  private mouseCssX = 640;
  private mouseCssY = 360;
  private hasMousePosition = false;
  private lastTouchTimestamp = 0;

  private pendingToggleAutoAim = false;
  private pendingPause = false;
  private statsToggledTouch = false;

  // Gamepad previous button states & repeat timers
  private prevGpButtons: boolean[] = new Array(18).fill(false);
  private navHoldDir: 'up' | 'down' | 'left' | 'right' | null = null;
  private navHoldSince = 0;
  private navLastRepeat = 0;

  private readonly boundKeyDown: (e: KeyboardEvent) => void;
  private readonly boundKeyUp: (e: KeyboardEvent) => void;
  private readonly boundBlur: () => void;
  private readonly boundPointerDown: (e: PointerEvent) => void;
  private readonly boundPointerMove: (e: PointerEvent) => void;
  private readonly boundMouseMove: (e: MouseEvent) => void;
  private readonly boundTouchStart: (e: TouchEvent) => void;
  private readonly boundCanvasClick: (e: MouseEvent) => void;

  constructor(opts: InputManagerOptions) {
    this.canvas = opts.canvas;
    this.onNavAction = opts.onNavAction;
    this.onInputModeChange = opts.onInputModeChange;
    this.onUserInteraction = opts.onUserInteraction;

    this.touchOverlay = new TouchOverlay(opts.touchRoot, {
      onToggleAutoAim: () => {
        this.pendingToggleAutoAim = true;
      },
      onToggleStats: () => {
        this.statsToggledTouch = !this.statsToggledTouch;
        this.onNavAction?.('stats');
      },
      onPause: () => {
        this.pendingPause = true;
        this.onNavAction?.('pause');
      },
      onTouchDetected: () => {
        this.lastTouchTimestamp = Date.now();
        this.setInputMode('touch');
      },
    });

    this.boundKeyDown = (e) => this.handleKeyDown(e);
    this.boundKeyUp = (e) => this.handleKeyUp(e);
    this.boundBlur = () => this.keysDown.clear();
    this.boundPointerDown = (e) => this.handlePointerDown(e);
    this.boundPointerMove = (e) => this.handlePointerMove(e);
    this.boundMouseMove = (e) => this.handleMouseMove(e);
    this.boundTouchStart = () => this.handleTouchStart();
    this.boundCanvasClick = (e) => this.handleCanvasClick(e);

    if (typeof window !== 'undefined') {
      window.addEventListener('keydown', this.boundKeyDown);
      window.addEventListener('keyup', this.boundKeyUp);
      window.addEventListener('blur', this.boundBlur);
      window.addEventListener('pointerdown', this.boundPointerDown, { passive: true });
      window.addEventListener('pointermove', this.boundPointerMove, { passive: true });
      window.addEventListener('mousemove', this.boundMouseMove, { passive: true });
      window.addEventListener('touchstart', this.boundTouchStart, { passive: true });
    }
    if (this.canvas) {
      this.canvas.addEventListener('mousedown', this.boundCanvasClick);
    }
  }

  public getInputMode(): InputMode {
    return this.activeInputMode;
  }

  public setInputMode(mode: InputMode): void {
    const changed = this.activeInputMode !== mode;
    this.activeInputMode = mode;
    if (mode === 'touch') {
      this.lastTouchTimestamp = Date.now();
    }
    this.touchOverlay.setInputMode(mode);
    if (changed) {
      this.onInputModeChange?.(mode);
    }
  }

  public getTouchOverlayStatus(): { visible: boolean; opacity: number; mode: InputMode } {
    return this.touchOverlay.getStatus();
  }

  public setScreen(screen: GameScreen): void {
    this.screen = screen;
    this.touchOverlay.setScreen(screen);
  }

  public setAutoAimEnabled(enabled: boolean): void {
    this.touchOverlay.setAutoAimEnabled(enabled);
  }

  public applyKeyBindings(bindings: KeyBindings): void {
    this.bindings = { ...bindings };
  }

  public applyTouchSettings(settings: TouchSettings): void {
    this.touchOverlay.applySettings(settings);
  }

  public emitNavAction(action: UiNavAction): void {
    this.onNavAction?.(action);
  }

  private isCombatScreen(): boolean {
    return this.screen === 'combat' || this.screen === 'wave_end';
  }

  private isRecentTouch(): boolean {
    return Date.now() - this.lastTouchTimestamp < 600;
  }

  private handleTouchStart(): void {
    this.lastTouchTimestamp = Date.now();
    this.onUserInteraction?.();
    this.setInputMode('touch');
  }

  private handlePointerDown(e: PointerEvent): void {
    this.onUserInteraction?.();
    if (e.pointerType === 'touch') {
      this.lastTouchTimestamp = Date.now();
      this.setInputMode('touch');
    } else if (e.pointerType === 'mouse' && !this.isRecentTouch()) {
      this.setInputMode('keyboard');
    }
  }

  private handlePointerMove(e: PointerEvent): void {
    if (e.pointerType === 'mouse' && !this.isRecentTouch()) {
      this.updateMouseCoords(e.clientX, e.clientY);
      if (this.activeInputMode === 'touch') {
        this.setInputMode('keyboard');
      }
    }
  }

  private handleMouseMove(e: MouseEvent): void {
    if (this.isRecentTouch()) return;
    this.updateMouseCoords(e.clientX, e.clientY);
    if (this.activeInputMode === 'touch') {
      this.setInputMode('keyboard');
    }
  }

  private updateMouseCoords(clientX: number, clientY: number): void {
    if (this.canvas) {
      const rect = this.canvas.getBoundingClientRect();
      this.mouseCssX = clientX - rect.left;
      this.mouseCssY = clientY - rect.top;
    } else {
      this.mouseCssX = clientX;
      this.mouseCssY = clientY;
    }
    this.hasMousePosition = true;
  }

  private handleCanvasClick(e: MouseEvent): void {
    if (this.isRecentTouch()) return;
    if (e.button !== 0) return;
    this.setInputMode('keyboard');
    this.updateMouseCoords(e.clientX, e.clientY);
    if (this.isCombatScreen()) {
      this.pendingToggleAutoAim = true;
    }
  }

  private handleKeyDown(e: KeyboardEvent): void {
    this.onUserInteraction?.();
    this.setInputMode('keyboard');

    const code = e.code;
    const isRepeat = e.repeat;
    this.keysDown.add(code);

    if (code === 'Tab' || code === this.bindings.stats) {
      e.preventDefault();
      if (!isRepeat && !this.isCombatScreen()) {
        this.onNavAction?.('stats');
      }
    }

    if (code === 'Enter' || code === 'Space' || code === 'ArrowUp' || code === 'ArrowDown' || code === 'ArrowLeft' || code === 'ArrowRight') {
      const targetTag = (e.target as HTMLElement | null)?.tagName;
      if (targetTag !== 'INPUT' && targetTag !== 'TEXTAREA' && targetTag !== 'SELECT') {
        e.preventDefault();
      }
    }

    if (isRepeat) {
      if (!this.isCombatScreen()) {
        if (code === 'ArrowUp' || code === this.bindings.moveUp) this.onNavAction?.('up');
        else if (code === 'ArrowDown' || code === this.bindings.moveDown) this.onNavAction?.('down');
        else if (code === 'ArrowLeft' || code === this.bindings.moveLeft) this.onNavAction?.('left');
        else if (code === 'ArrowRight' || code === this.bindings.moveRight) this.onNavAction?.('right');
      }
      return;
    }

    if (code === this.bindings.pause || code === 'Escape') {
      if (this.isCombatScreen()) {
        this.pendingPause = true;
      } else {
        this.onNavAction?.('back');
      }
      return;
    }

    if (this.isCombatScreen()) {
      if (code === this.bindings.toggleAutoAim || code === 'Space' || code === 'KeyM') {
        this.pendingToggleAutoAim = true;
      }
      return;
    }

    // Menu keyboard navigation
    if (code === 'ArrowUp' || code === this.bindings.moveUp) this.onNavAction?.('up');
    else if (code === 'ArrowDown' || code === this.bindings.moveDown) this.onNavAction?.('down');
    else if (code === 'ArrowLeft' || code === this.bindings.moveLeft) this.onNavAction?.('left');
    else if (code === 'ArrowRight' || code === this.bindings.moveRight) this.onNavAction?.('right');
    else if (code === 'Enter' || code === 'Space') this.onNavAction?.('confirm');
    else if (code === 'Backspace') this.onNavAction?.('back');
    else if (code === 'KeyR' || code === 'KeyX') this.onNavAction?.('x_action');
    else if (code === 'KeyL' || code === 'KeyY') this.onNavAction?.('y_action');
    else if (code === 'KeyQ' || code === 'BracketLeft') this.onNavAction?.('lb');
    else if (code === 'KeyE' || code === 'BracketRight') this.onNavAction?.('rb');
  }

  private handleKeyUp(e: KeyboardEvent): void {
    this.keysDown.delete(e.code);
  }

  private pollGamepad(): {
    moveX: number;
    moveY: number;
    aimX: number;
    aimY: number;
    aimActive: boolean;
    statsHeld: boolean;
  } {
    let moveX = 0;
    let moveY = 0;
    let aimX = 0;
    let aimY = 0;
    let aimActive = false;
    let statsHeld = false;

    if (typeof navigator === 'undefined' || typeof navigator.getGamepads !== 'function') {
      return { moveX, moveY, aimX, aimY, aimActive, statsHeld };
    }

    let pads: (Gamepad | null)[];
    try {
      pads = Array.from(navigator.getGamepads() ?? []);
    } catch {
      return { moveX, moveY, aimX, aimY, aimActive, statsHeld };
    }

    const gp = pads.find((p) => p && p.connected) ?? null;
    if (!gp) {
      this.navHoldDir = null;
      return { moveX, moveY, aimX, aimY, aimActive, statsHeld };
    }

    const ls = applyRadialDeadzone(gp.axes[0] ?? 0, gp.axes[1] ?? 0, STICK_DEADZONE);
    const rs = applyRadialDeadzone(gp.axes[2] ?? 0, gp.axes[3] ?? 0, RIGHT_STICK_DEADZONE);

    const btnPressed = (idx: number): boolean => Boolean(gp.buttons[idx]?.pressed);
    let anyActivity = ls.mag > 0.2 || rs.mag > 0.2;

    const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
    const justPressed = (idx: number): boolean => {
      const cur = btnPressed(idx);
      const prev = this.prevGpButtons[idx] ?? false;
      this.prevGpButtons[idx] = cur;
      if (cur) anyActivity = true;
      return cur && !prev;
    };

    const aDown = justPressed(0);
    const bDown = justPressed(1);
    const xDown = justPressed(2);
    const yDown = justPressed(3);
    const lbDown = justPressed(4);
    const rbDown = justPressed(5);
    const viewDown = justPressed(8);
    const startDown = justPressed(9);
    const r3Down = justPressed(11);
    const dUp = btnPressed(12);
    const dDown = btnPressed(13);
    const dLeft = btnPressed(14);
    const dRight = btnPressed(15);
    if (dUp || dDown || dLeft || dRight || btnPressed(8)) anyActivity = true;

    if (anyActivity) {
      this.onUserInteraction?.();
      this.setInputMode('gamepad');
    }

    // D-Pad + Left Stick combined movement
    const dpadX = (dRight ? 1 : 0) - (dLeft ? 1 : 0);
    const dpadY = (dDown ? 1 : 0) - (dUp ? 1 : 0);
    if (dpadX !== 0 || dpadY !== 0) {
      const len = Math.hypot(dpadX, dpadY);
      moveX = dpadX / len;
      moveY = dpadY / len;
    } else {
      moveX = ls.x;
      moveY = ls.y;
    }

    if (rs.mag > 0) {
      aimX = rs.x / rs.mag;
      aimY = rs.y / rs.mag;
      aimActive = true;
    }

    statsHeld = btnPressed(8);

    if (startDown) {
      if (this.isCombatScreen()) this.pendingPause = true;
      else this.onNavAction?.('pause');
    }

    if (this.isCombatScreen()) {
      if (r3Down || xDown) {
        this.pendingToggleAutoAim = true;
      }
      if (viewDown) {
        this.onNavAction?.('stats');
      }
      this.navHoldDir = null;
    } else {
      // Menu Xbox navigation
      if (aDown) this.onNavAction?.('confirm');
      if (bDown) this.onNavAction?.('back');
      if (xDown) this.onNavAction?.('x_action');
      if (yDown) this.onNavAction?.('y_action');
      if (lbDown) this.onNavAction?.('lb');
      if (rbDown) this.onNavAction?.('rb');
      if (viewDown) this.onNavAction?.('stats');

      let dir: 'up' | 'down' | 'left' | 'right' | null = null;
      if (dUp || ls.y < -0.52) dir = 'up';
      else if (dDown || ls.y > 0.52) dir = 'down';
      else if (dLeft || ls.x < -0.52) dir = 'left';
      else if (dRight || ls.x > 0.52) dir = 'right';

      if (!dir) {
        this.navHoldDir = null;
      } else if (dir !== this.navHoldDir) {
        this.navHoldDir = dir;
        this.navHoldSince = now;
        this.navLastRepeat = now;
        this.onNavAction?.(dir);
      } else if (now - this.navHoldSince >= NAV_INITIAL_DELAY_MS && now - this.navLastRepeat >= NAV_REPEAT_MS) {
        this.navLastRepeat = now;
        this.onNavAction?.(dir);
      }
    }

    return { moveX, moveY, aimX, aimY, aimActive, statsHeld };
  }

  public pollInputFrame(
    camX: number,
    camY: number,
    camZoom: number,
    cssWidth: number,
    cssHeight: number
  ): InputFrame {
    const gp = this.pollGamepad();
    const touch = this.touchOverlay.getSnapshot();

    // Keyboard directional vector
    let kbX = 0;
    let kbY = 0;
    if (this.keysDown.has(this.bindings.moveLeft) || this.keysDown.has('ArrowLeft')) kbX -= 1;
    if (this.keysDown.has(this.bindings.moveRight) || this.keysDown.has('ArrowRight')) kbX += 1;
    if (this.keysDown.has(this.bindings.moveUp) || this.keysDown.has('ArrowUp')) kbY -= 1;
    if (this.keysDown.has(this.bindings.moveDown) || this.keysDown.has('ArrowDown')) kbY += 1;
    if (kbX !== 0 && kbY !== 0) {
      const inv = 1 / Math.SQRT2;
      kbX *= inv;
      kbY *= inv;
    }

    // Priority merge: active touch stick -> active gamepad -> keyboard
    let moveX = kbX;
    let moveY = kbY;
    if (Math.hypot(gp.moveX, gp.moveY) > 0.01) {
      moveX = gp.moveX;
      moveY = gp.moveY;
    }
    if (this.activeInputMode === 'touch' && Math.hypot(touch.moveX, touch.moveY) > 0.01) {
      moveX = touch.moveX;
      moveY = touch.moveY;
    }

    // Aim vector & world aim
    let aimX = 0;
    let aimY = 0;
    let aimActive = false;
    let hasWorldAim = false;
    let aimWorldX = camX;
    let aimWorldY = camY;

    if (gp.aimActive) {
      aimX = gp.aimX;
      aimY = gp.aimY;
      aimActive = true;
    } else if (this.activeInputMode === 'touch' && touch.aimActive) {
      aimX = touch.aimX;
      aimY = touch.aimY;
      aimActive = true;
    } else if (this.activeInputMode === 'keyboard' && this.hasMousePosition) {
      const world = screenToWorld(this.mouseCssX, this.mouseCssY, cssWidth, cssHeight, camX, camY, camZoom);
      aimWorldX = world.x;
      aimWorldY = world.y;
      hasWorldAim = true;
    }

    const toggleAutoAimPressed = this.pendingToggleAutoAim;
    const pausePressed = this.pendingPause;
    this.pendingToggleAutoAim = false;
    this.pendingPause = false;

    const statsHeld =
      this.keysDown.has(this.bindings.stats) ||
      this.keysDown.has('Tab') ||
      gp.statsHeld ||
      (this.activeInputMode === 'touch' && touch.statsActive);

    return {
      moveX,
      moveY,
      aimX,
      aimY,
      aimActive,
      aimWorldX,
      aimWorldY,
      hasWorldAim,
      toggleAutoAimPressed,
      pausePressed,
      statsHeld,
      activeInputMode: this.activeInputMode,
    };
  }

  public dispose(): void {
    if (typeof window !== 'undefined') {
      window.removeEventListener('keydown', this.boundKeyDown);
      window.removeEventListener('keyup', this.boundKeyUp);
      window.removeEventListener('blur', this.boundBlur);
      window.removeEventListener('pointerdown', this.boundPointerDown);
      window.removeEventListener('pointermove', this.boundPointerMove);
      window.removeEventListener('mousemove', this.boundMouseMove);
      window.removeEventListener('touchstart', this.boundTouchStart);
    }
    if (this.canvas) {
      this.canvas.removeEventListener('mousedown', this.boundCanvasClick);
    }
    this.touchOverlay.dispose();
  }
}
