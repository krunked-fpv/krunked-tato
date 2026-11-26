// ============================================================================
// src/app/GameApp.ts — Main Fixed-Step 60Hz Loop, Audio/Render/Input/UI Shell
// ============================================================================

import {
  FIXED_DT,
  type AssetMode,
  type AudioSettings,
  type DebugBridge,
  type GameScreen,
  type InputFrame,
  type InputMode,
  type KeyBindings,
  type PerfStats,
  type RenderSettings,
  type RendererAPI,
  type SimCommand,
  type SimState,
  type TouchSettings,
  type UiNavAction,
} from '../contracts/index';
import { AssetRegistry } from '../assets/AssetRegistry';
import { createAudioEngine, type AudioEngine } from '../audio/index';
import { GAME_CATALOG } from '../data/index';
import { InputManager } from '../input/InputManager';
import { createRenderer } from '../render/index';
import {
  applySimCommand,
  createInitialSimState,
  hashSimState,
  recomputePlayerStats,
  startWave,
  stepSim,
  DEFAULT_ECONOMY_HOOKS,
} from '../sim/index';
import { UIManager } from '../ui/UIManager';
import { createDebugBridge } from './DebugBridge';
import { DevDrawer } from './DevDrawer';
import { SaveManager } from './SaveManager';

export interface GameAppMounts {
  canvas: HTMLCanvasElement;
  touchRoot: HTMLElement;
  uiRoot: HTMLElement;
  devRoot: HTMLElement;
}

export class GameApp {
  private readonly canvas: HTMLCanvasElement;
  private readonly saveManager: SaveManager;
  private readonly assetRegistry: AssetRegistry;
  private readonly renderer: RendererAPI;
  private readonly audio: AudioEngine;
  private readonly input: InputManager;
  private readonly ui: UIManager;
  private readonly devDrawer: DevDrawer;
  private readonly debugBridge: DebugBridge;

  private state: SimState;
  private pendingCommands: SimCommand[] = [];
  private rafId: number | null = null;
  private disposed = false;

  // Timing & pacing
  private lastNowMs = 0;
  private accumulatorSec = 0;
  private lastRenderMs = 0;
  private cssWidth = 1280;
  private cssHeight = 720;
  private dpr = 1;

  // Telemetry rolling metrics
  private perf: PerfStats;
  private fpsFrameCount = 0;
  private fpsTickCount = 0;
  private fpsWindowStartMs = 0;
  private lastFrameMs = 16.67;
  private lastRecordedScreen: GameScreen = 'title';
  private runOutcomeRecorded = false;

  private readonly boundResize: () => void;
  private readonly boundFrame: (nowMs: number) => void;

  constructor(mounts: GameAppMounts) {
    this.canvas = mounts.canvas;
    this.saveManager = new SaveManager();
    const save = this.saveManager.get();

    this.state = createInitialSimState(1337, GAME_CATALOG);
    this.assetRegistry = new AssetRegistry();
    this.assetRegistry.prepareCatalog(GAME_CATALOG);

    this.renderer = createRenderer(this.canvas);
    this.syncRendererAtlas();
    this.assetRegistry.subscribe(() => {
      this.syncRendererAtlas();
      void this.syncCustomAudio();
    });

    this.audio = createAudioEngine();
    this.audio.applySettings(save.audioSettings);

    this.input = new InputManager({
      canvas: this.canvas,
      touchRoot: mounts.touchRoot,
      onNavAction: (action) => {
        this.audio.unlock();
        this.ui.handleNavAction(action, this.state);
      },
      onInputModeChange: () => {
        this.ui.invalidate();
      },
      onUserInteraction: () => {
        this.audio.unlock();
      },
    });
    this.input.applyKeyBindings(save.keyBindings);
    this.input.applyTouchSettings(save.touchSettings);
    this.input.setScreen(this.state.screen);
    this.input.setAutoAimEnabled(this.state.autoAim);

    this.ui = new UIManager(mounts.uiRoot, GAME_CATALOG, this.assetRegistry, {
      onCommand: (cmd) => this.dispatchCommand(cmd),
      onUpdateRenderSettings: (patch) => this.updateRenderSettings(patch),
      onUpdateAudioSettings: (patch) => this.updateAudioSettings(patch),
      onUpdateTouchSettings: (patch) => this.updateTouchSettings(patch),
      onUpdateKeyBindings: (patch) => this.updateKeyBindings(patch),
      onSelectAssetMode: (mode) => this.setAssetMode(mode),
      onUploadPckFile: (file) => this.uploadPckFile(file),
      onUploadPackDirectory: (files) => this.uploadPackDirectory(files),
      onClearCustomPack: () => this.clearCustomPack(),
      onContinueSavedRun: () => this.continueSavedRun(),
      onResetSave: () => this.resetSave(),
      onPlayUiClick: (kind) => {
        this.audio.unlock();
        this.audio.playUiClick(kind);
      },
    });

    this.perf = {
      fps: 60,
      simHz: 60,
      frameMs: 16.67,
      backend: this.renderer.backend,
      drawCalls: 0,
      quadCount: 0,
      enemyCount: 0,
      projectileCount: 0,
      pickupCount: 0,
    };

    this.debugBridge = createDebugBridge({
      getState: () => this.state,
      getHash: () => hashSimState(this.state),
      getPerf: () => ({ ...this.perf }),
      getInputMode: () => this.input.getInputMode(),
      setInputMode: (mode: InputMode) => {
        this.input.setInputMode(mode);
        this.ui.invalidate();
      },
      getTouchOverlayStatus: () => this.input.getTouchOverlayStatus(),
      getAssetMode: () => this.assetRegistry.getMode(),
      setAssetMode: (mode: AssetMode) => this.setAssetMode(mode),
      dispatch: (cmd: SimCommand) => this.dispatchCommand(cmd),
      stepTicks: (count: number, partialInput?: Partial<InputFrame>) => this.stepTicksSync(count, partialInput),
      simulateNav: (action: UiNavAction) => {
        this.ui.handleNavAction(action, this.state);
        this.renderUiImmediate();
      },
      startQuickRun: (opts) => {
        this.dispatchCommand({
          type: 'start_run',
          characterId: opts?.characterId ?? 'well_rounded',
          weaponId: opts?.weaponId ?? 'pistol',
          zoneId: opts?.zoneId ?? 0,
          dangerLevel: opts?.dangerLevel ?? 0,
          seed: opts?.seed ?? 1337,
        });
      },
      resetSave: () => this.resetSave(),
    });

    if (typeof window !== 'undefined') {
      window.__KRUNKED_DEBUG__ = this.debugBridge;
    }

    this.devDrawer = new DevDrawer(mounts.devRoot, this.debugBridge, GAME_CATALOG);

    this.boundResize = () => this.handleResize();
    this.boundFrame = (nowMs: number) => this.onAnimationFrame(nowMs);

    if (typeof window !== 'undefined') {
      window.addEventListener('resize', this.boundResize);
    }
    this.handleResize();

    // Probe custom pack asynchronously (dev middleware or IndexedDB)
    void this.initCustomPack();
  }

  private async initCustomPack(): Promise<void> {
    try {
      const status = await this.assetRegistry.probeCustomPack();
      if (status.available && this.saveManager.get().assetMode === 'CUSTOM_PACK') {
        await this.assetRegistry.setMode('CUSTOM_PACK');
        await this.syncCustomAudio();
      }
      this.ui.invalidate();
      this.renderUiImmediate();
    } catch {
      // Built-in mode stays active seamlessly
    }
  }

  private syncRendererAtlas(): void {
    const snap = this.assetRegistry.getActiveAtlas();
    this.renderer.setAtlasSource(snap.canvas, snap.regions, snap.customImages);
  }

  private async syncCustomAudio(): Promise<void> {
    if (this.assetRegistry.getMode() !== 'CUSTOM_PACK') {
      this.audio.setCustomAudioBuffers(new Map());
      return;
    }
    const ctx = this.audio.getAudioContext();
    if (!ctx) return;
    try {
      const buffers = await this.assetRegistry.loadCustomAudio(ctx);
      this.audio.setCustomAudioBuffers(buffers);
    } catch {
      this.audio.setCustomAudioBuffers(new Map());
    }
  }

  private async setAssetMode(mode: AssetMode): Promise<void> {
    const actual = await this.assetRegistry.setMode(mode);
    this.saveManager.update({ assetMode: actual });
    this.syncRendererAtlas();
    await this.syncCustomAudio();
    this.ui.setCustomPackMessage(
      actual === 'CUSTOM_PACK' ? 'Custom Pack active!' : 'Built-In Krunked Art active.',
      false,
    );
    this.renderUiImmediate();
  }

  private async uploadPckFile(file: File): Promise<void> {
    this.ui.setCustomPackMessage('Reading pack archive...', false);
    try {
      const status = await this.assetRegistry.loadFromPckFile(file);
      this.saveManager.update({ assetMode: status.active ? 'CUSTOM_PACK' : 'BUILTIN' });
      this.syncRendererAtlas();
      await this.syncCustomAudio();
      this.ui.setCustomPackMessage(
        status.active
          ? `Loaded ${status.textureCount} textures & ${status.audioCount} audio tracks!`
          : 'No compatible pack assets found; keeping Built-In Art.',
        !status.active,
      );
    } catch {
      this.ui.setCustomPackMessage('Failed to decode pack file; keeping Built-In Art.', true);
    }
  }

  private async uploadPackDirectory(files: FileList): Promise<void> {
    this.ui.setCustomPackMessage('Loading pack folder...', false);
    try {
      const status = await this.assetRegistry.loadFromDirectoryFiles(files);
      this.saveManager.update({ assetMode: status.active ? 'CUSTOM_PACK' : 'BUILTIN' });
      this.syncRendererAtlas();
      await this.syncCustomAudio();
      this.ui.setCustomPackMessage(
        status.active
          ? `Loaded ${status.textureCount} textures & ${status.audioCount} audio tracks!`
          : 'No manifest/textures found in folder.',
        !status.active,
      );
    } catch {
      this.ui.setCustomPackMessage('Failed to load pack folder.', true);
    }
  }

  private async clearCustomPack(): Promise<void> {
    await this.assetRegistry.clearCustomPack();
    this.saveManager.update({ assetMode: 'BUILTIN' });
    this.syncRendererAtlas();
    this.audio.setCustomAudioBuffers(new Map());
    this.ui.setCustomPackMessage('Cleared Custom Pack cache. Built-In Art active.', false);
  }

  private updateRenderSettings(patch: Partial<RenderSettings>): void {
    const cur = this.saveManager.get().renderSettings;
    this.saveManager.update({ renderSettings: { ...cur, ...patch } });
    this.ui.invalidate();
  }

  private updateAudioSettings(patch: Partial<AudioSettings>): void {
    const cur = this.saveManager.get().audioSettings;
    const next = { ...cur, ...patch };
    this.saveManager.update({ audioSettings: next });
    this.audio.applySettings(next);
    this.ui.invalidate();
  }

  private updateTouchSettings(patch: Partial<TouchSettings>): void {
    const cur = this.saveManager.get().touchSettings;
    const next = { ...cur, ...patch };
    this.saveManager.update({ touchSettings: next });
    this.input.applyTouchSettings(next);
    this.ui.invalidate();
  }

  private updateKeyBindings(patch: Partial<KeyBindings>): void {
    const cur = this.saveManager.get().keyBindings;
    const next = { ...cur, ...patch };
    this.saveManager.update({ keyBindings: next });
    this.input.applyKeyBindings(next);
    this.ui.invalidate();
  }

  private continueSavedRun(): void {
    const run = this.saveManager.get().activeRun;
    if (!run) return;
    this.state = createInitialSimState(run.seed, GAME_CATALOG);
    this.state.seed = run.seed;
    this.state.rngState = run.rngState;
    this.state.wave = run.wave;
    this.state.zoneId = run.zoneId;
    this.state.dangerLevel = run.dangerLevel;
    this.state.isEndless = run.isEndless;
    this.state.autoAim = run.autoAim;
    this.state.player = structuredClone(run.player);
    this.state.shop = structuredClone(run.shop);
    this.state.levelUp = structuredClone(run.levelUp);
    this.state.crateModal = structuredClone(run.crateModal);
    this.state.runStats = structuredClone(run.runStats);
    this.state.selectedCharId = run.player.characterId;
    this.state.selectedZoneId = run.zoneId;
    this.state.selectedDanger = run.dangerLevel;
    recomputePlayerStats(this.state, GAME_CATALOG);

    if (run.screen === 'combat') {
      startWave(this.state, GAME_CATALOG, DEFAULT_ECONOMY_HOOKS);
    } else {
      this.state.screen = run.screen;
    }
    this.runOutcomeRecorded = false;
    this.renderer.clearDecals();
    this.input.setScreen(this.state.screen);
    this.input.setAutoAimEnabled(this.state.autoAim);
    this.ui.invalidate();
    this.renderUiImmediate();
  }

  private resetSave(): void {
    const fresh = this.saveManager.reset();
    this.audio.applySettings(fresh.audioSettings);
    this.input.applyKeyBindings(fresh.keyBindings);
    this.input.applyTouchSettings(fresh.touchSettings);
    this.ui.invalidate();
    this.renderUiImmediate();
  }

  private dispatchCommand(cmd: SimCommand): void {
    this.audio.unlock();
    if (cmd.type === 'start_run') {
      this.runOutcomeRecorded = false;
      this.renderer.clearDecals();
    }
    applySimCommand(this.state, cmd, GAME_CATALOG, DEFAULT_ECONOMY_HOOKS);
    this.handlePostStepSideEffects();
    this.ui.invalidate();
    this.renderUiImmediate();
  }

  private stepTicksSync(count: number, partialInput?: Partial<InputFrame>): string {
    const safeCount = Math.max(0, Math.min(6000, Math.floor(count)));
    const frame: InputFrame = {
      moveX: partialInput?.moveX ?? 0,
      moveY: partialInput?.moveY ?? 0,
      aimX: partialInput?.aimX ?? 0,
      aimY: partialInput?.aimY ?? 0,
      aimActive: partialInput?.aimActive ?? false,
      aimWorldX: partialInput?.aimWorldX ?? this.state.player.x,
      aimWorldY: partialInput?.aimWorldY ?? this.state.player.y,
      hasWorldAim: partialInput?.hasWorldAim ?? false,
      toggleAutoAimPressed: partialInput?.toggleAutoAimPressed ?? false,
      pausePressed: partialInput?.pausePressed ?? false,
      statsHeld: partialInput?.statsHeld ?? false,
      activeInputMode: partialInput?.activeInputMode ?? this.input.getInputMode(),
    };

    for (let i = 0; i < safeCount; i++) {
      stepSim(this.state, frame, [], GAME_CATALOG, DEFAULT_ECONOMY_HOOKS);
      this.handlePostStepSideEffects();
      // Only fire edge-triggered flags on first tick
      frame.toggleAutoAimPressed = false;
      frame.pausePressed = false;
    }
    this.renderUiImmediate();
    return hashSimState(this.state);
  }

  private handlePostStepSideEffects(): void {
    const events = this.state.events;
    if (events.length > 0) {
      this.renderer.onSimEvents(events, this.state);
      this.audio.processEvents(events, this.state.camera.x);
      for (const ev of events) {
        if (ev.type === 'wave_start') {
          this.renderer.clearDecals();
        }
      }
      events.length = 0;
    }

    this.input.setScreen(this.state.screen);
    this.input.setAutoAimEnabled(this.state.autoAim);
    this.audio.updateMusic(
      this.state.screen,
      this.state.isBossWave,
      this.state.isEliteWave,
      this.state.zoneId,
    );

    if (this.state.screen !== this.lastRecordedScreen) {
      const s = this.state.screen;
      this.lastRecordedScreen = s;
      if (s === 'shop' || s === 'level_up' || s === 'crate_modal') {
        this.saveManager.saveActiveRun(this.state);
      } else if (s === 'victory' && !this.runOutcomeRecorded) {
        this.runOutcomeRecorded = true;
        this.saveManager.recordRunEnd(this.state, true);
      } else if (s === 'game_over' && !this.runOutcomeRecorded) {
        this.runOutcomeRecorded = true;
        this.saveManager.recordRunEnd(this.state, false);
      }
    }
  }

  private handleResize(): void {
    if (typeof window === 'undefined') return;
    this.cssWidth = Math.max(320, window.innerWidth);
    this.cssHeight = Math.max(240, window.innerHeight);
    this.dpr = Math.min(2, window.devicePixelRatio || 1);
    this.renderer.resize(this.cssWidth, this.cssHeight, this.dpr);
  }

  private renderUiImmediate(statsHeld = false): void {
    this.ui.update(
      this.state,
      this.saveManager.get(),
      this.input.getInputMode(),
      this.assetRegistry.getCustomPackStatus(),
      statsHeld,
    );
  }

  public start(): void {
    if (this.rafId !== null || this.disposed) return;
    const now = performance.now();
    this.lastNowMs = now;
    this.lastRenderMs = now;
    this.fpsWindowStartMs = now;
    this.renderUiImmediate();
    this.rafId = requestAnimationFrame(this.boundFrame);
  }

  private onAnimationFrame(nowMs: number): void {
    if (this.disposed) return;
    this.rafId = requestAnimationFrame(this.boundFrame);

    const rawDtSec = Math.min(0.1, Math.max(0, (nowMs - this.lastNowMs) / 1000));
    this.lastNowMs = nowMs;
    this.lastFrameMs = rawDtSec * 1000;

    const inputFrame = this.input.pollInputFrame(
      this.state.camera.x,
      this.state.camera.y,
      this.state.camera.zoom,
      this.cssWidth,
      this.cssHeight,
    );

    // Fixed 60 Hz simulation step accumulator
    this.accumulatorSec += rawDtSec;
    let steps = 0;
    while (this.accumulatorSec >= FIXED_DT && steps < 4) {
      const cmds = this.pendingCommands.length > 0 ? this.pendingCommands.splice(0) : [];
      stepSim(this.state, inputFrame, cmds, GAME_CATALOG, DEFAULT_ECONOMY_HOOKS);
      this.handlePostStepSideEffects();
      // Edge-triggered inputs only apply on the first sim step of a frame
      inputFrame.toggleAutoAimPressed = false;
      inputFrame.pausePressed = false;
      this.accumulatorSec -= FIXED_DT;
      steps += 1;
      this.fpsTickCount += 1;
    }
    if (steps === 4 && this.accumulatorSec > FIXED_DT) {
      this.accumulatorSec = 0;
    }

    // Frame-paced rendering (30 / 60 / 120 FPS)
    const renderSettings = this.saveManager.get().renderSettings;
    const minIntervalMs = renderSettings.targetFps >= 120 ? 0 : 1000 / renderSettings.targetFps - 1.2;
    if (nowMs - this.lastRenderMs >= minIntervalMs) {
      this.lastRenderMs = nowMs;
      const interpAlpha = renderSettings.classicSnap60
        ? 1
        : Math.max(0, Math.min(1, this.accumulatorSec / FIXED_DT));
      this.renderer.render(this.state, interpAlpha, renderSettings);
      this.renderUiImmediate(inputFrame.statsHeld);
      this.fpsFrameCount += 1;

      const rPerf = this.renderer.getPerfSnapshot();
      this.perf.drawCalls = rPerf.drawCalls;
      this.perf.quadCount = rPerf.quadCount;
      this.perf.enemyCount = this.state.enemies.length;
      this.perf.projectileCount = this.state.projectiles.length;
      this.perf.pickupCount = this.state.pickups.length;
      this.perf.frameMs = this.lastFrameMs;
    }

    // Update FPS / SimHz every 500ms
    const elapsedMs = nowMs - this.fpsWindowStartMs;
    if (elapsedMs >= 500) {
      this.perf.fps = (this.fpsFrameCount * 1000) / elapsedMs;
      this.perf.simHz = (this.fpsTickCount * 1000) / elapsedMs;
      this.fpsFrameCount = 0;
      this.fpsTickCount = 0;
      this.fpsWindowStartMs = nowMs;
      this.devDrawer.refresh();
    }
  }

  public dispose(): void {
    this.disposed = true;
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
    if (typeof window !== 'undefined') {
      window.removeEventListener('resize', this.boundResize);
      if (window.__KRUNKED_DEBUG__ === this.debugBridge) {
        delete window.__KRUNKED_DEBUG__;
      }
    }
    this.devDrawer.dispose();
    this.ui.dispose();
    this.input.dispose();
    this.audio.dispose();
    this.renderer.dispose();
  }
}
