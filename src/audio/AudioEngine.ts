// ============================================================================
// src/audio/AudioEngine.ts — Master Web Audio Engine implementing AudioEngineAPI
// Features:
//  - Reliable autoplay unlock (touch/pointer/key/gamepad, zero uncaught rejections)
//  - Strict <= 24 voice polyphony cap + per-SFX micro-cooldowns + +/- 6% pitch jitter
//  - StereoPannerNode spatial panning clamped to [-0.75, 0.75]
//  - Master DynamicsCompressorNode limiter + Master/SFX/Music buses + mute toggle
//  - Seamless Custom Pack AudioBuffer override with instant ProceduralSynth fallback
//  - 100% headless-safe in Node / Vitest (no top-level window/AudioContext access)
// ============================================================================

import type {
  AudioEngineAPI,
  AudioSettings,
  GameScreen,
  SimEvent,
  WeaponSoundKind,
} from '../contracts/index';
import {
  ProceduralSynth,
  type ProceduralMusicTrack,
  type UiClickKind,
} from './ProceduralSynth';

const MAX_SFX_VOICES = 24;
const DEFAULT_PITCH_JITTER = 0.06; // +/- 6%
const MATERIAL_COMBO_RESET_SEC = 0.6;
const MATERIAL_COMBO_MAX = 14;
const PAN_HALF_WIDTH = 960;
const PAN_CLAMP = 0.75;

const SFX_BUS_SCALE = 0.88;
const MUSIC_BUS_SCALE = 0.44;
const PAUSE_MUSIC_DUCK = 0.32;
const MUSIC_CROSSFADE_SEC = 0.35;

const WEAPON_SOUND_KEY: Readonly<Record<WeaponSoundKind, string>> = {
  pistol: 'sfx_weapon_pistol',
  smg: 'sfx_weapon_smg',
  shotgun: 'sfx_weapon_shotgun',
  laser: 'sfx_weapon_laser',
  sniper: 'sfx_weapon_sniper',
  rocket: 'sfx_weapon_rocket',
  flame: 'sfx_weapon_flame',
  magic: 'sfx_weapon_magic',
  melee_light: 'sfx_weapon_melee_light',
  melee_heavy: 'sfx_weapon_melee_heavy',
  melee_blade: 'sfx_weapon_melee_blade',
  musical: 'sfx_weapon_musical',
  throw: 'sfx_weapon_throw',
};

const UI_SOUND_KEY: Readonly<Record<UiClickKind, string>> = {
  hover: 'sfx_ui_hover',
  confirm: 'sfx_ui_confirm',
  cancel: 'sfx_ui_cancel',
  buy: 'sfx_ui_buy',
  reroll: 'sfx_ui_reroll',
  combine: 'sfx_ui_combine',
  error: 'sfx_ui_error',
};

// Micro-cooldowns in milliseconds to keep 100-enemy combat crisp & distortion-free
const SFX_COOLDOWNS_MS: Readonly<Record<string, number>> = {
  sfx_weapon_smg: 38,
  sfx_weapon_pistol: 35,
  sfx_weapon_shotgun: 48,
  sfx_weapon_laser: 36,
  sfx_weapon_sniper: 50,
  sfx_weapon_rocket: 55,
  sfx_weapon_flame: 55,
  sfx_weapon_magic: 38,
  sfx_weapon_musical: 42,
  sfx_weapon_melee_light: 35,
  sfx_weapon_melee_heavy: 45,
  sfx_weapon_melee_blade: 35,
  sfx_weapon_throw: 35,
  sfx_enemy_hit: 35,
  sfx_enemy_hit_crit: 40,
  sfx_enemy_die: 35,
  sfx_pickup_material: 32,
  sfx_pickup_fruit: 45,
  sfx_player_heal: 50,
  sfx_player_dodge: 65,
  sfx_player_hit: 90,
  sfx_explosion: 50,
  sfx_burn: 55,
  sfx_step: 110,
  sfx_ui_hover: 35,
  sfx_ui_confirm: 30,
  sfx_ui_cancel: 30,
  sfx_ui_buy: 45,
  sfx_ui_reroll: 45,
  sfx_ui_combine: 50,
  sfx_ui_recycle: 45,
  sfx_ui_error: 60,
};

interface ActiveVoice {
  endTime: number;
  stop?: () => void;
}

interface MusicRequest {
  screen: GameScreen;
  isBoss: boolean;
  isElite: boolean;
  zoneId: 0 | 1 | 2;
}

interface CustomMusicPlaying {
  key: string;
  source: AudioBufferSourceNode;
  gain: GainNode;
}

type AudioContextCtor = new () => AudioContext;

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

function getAudioContextCtor(): AudioContextCtor | null {
  if (typeof globalThis === 'undefined') return null;
  const g = globalThis as unknown as {
    AudioContext?: AudioContextCtor;
    webkitAudioContext?: AudioContextCtor;
  };
  return g.AudioContext ?? g.webkitAudioContext ?? null;
}

export class AudioEngine implements AudioEngineAPI {
  private ctx: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private sfxGain: GainNode | null = null;
  private musicGain: GainNode | null = null;
  private musicDuckGain: GainNode | null = null;
  private compressor: DynamicsCompressorNode | null = null;
  private synth: ProceduralSynth | null = null;

  private settings: AudioSettings = {
    masterVolume: 0.8,
    sfxVolume: 0.85,
    musicVolume: 0.65,
    muted: false,
  };

  private customBuffers = new Map<string, AudioBuffer>();
  private activeVoices: ActiveVoice[] = [];
  private cleanupTimers = new Set<ReturnType<typeof setTimeout>>();
  private lastPlayedMs = new Map<string, number>();

  // Material pickup ascending combo state
  private materialComboCount = 0;
  private lastMaterialPickupSec = -10;

  // Music routing & crossfade state
  private desiredMusic: MusicRequest | null = null;
  private lastNonPauseScreen: GameScreen = 'title';
  private combatVariantIndex = 0;
  private customMusic: CustomMusicPlaying | null = null;
  private pendingUiClick: UiClickKind | null = null;

  // Autoplay unlock listener management
  private unlockListenersBound = false;
  private silentUnlockSent = false;
  private disposed = false;

  private readonly boundUnlockHandler = (): void => {
    this.unlock();
  };

  constructor() {
    this.bindUnlockListeners();
  }

  // --------------------------------------------------------------------------
  // Context & Unlock Lifecycle (100% Headless-Safe)
  // --------------------------------------------------------------------------

  private bindUnlockListeners(): void {
    if (this.unlockListenersBound || this.disposed) return;
    if (typeof window === 'undefined' || typeof window.addEventListener !== 'function') {
      return;
    }
    const opts: AddEventListenerOptions = { passive: true, capture: true };
    window.addEventListener('touchstart', this.boundUnlockHandler, opts);
    window.addEventListener('pointerdown', this.boundUnlockHandler, opts);
    window.addEventListener('mousedown', this.boundUnlockHandler, opts);
    window.addEventListener('keydown', this.boundUnlockHandler, opts);
    window.addEventListener('gamepadconnected', this.boundUnlockHandler, opts);
    this.unlockListenersBound = true;
  }

  private unbindUnlockListeners(): void {
    if (!this.unlockListenersBound) return;
    if (typeof window !== 'undefined' && typeof window.removeEventListener === 'function') {
      const opts: EventListenerOptions = { capture: true };
      window.removeEventListener('touchstart', this.boundUnlockHandler, opts);
      window.removeEventListener('pointerdown', this.boundUnlockHandler, opts);
      window.removeEventListener('mousedown', this.boundUnlockHandler, opts);
      window.removeEventListener('keydown', this.boundUnlockHandler, opts);
      window.removeEventListener('gamepadconnected', this.boundUnlockHandler, opts);
    }
    this.unlockListenersBound = false;
  }

  private ensureContext(): AudioContext | null {
    if (this.disposed) return null;
    if (this.ctx) return this.ctx;

    const Ctor = getAudioContextCtor();
    if (!Ctor) return null;

    let ctx: AudioContext;
    try {
      ctx = new Ctor();
    } catch {
      return null;
    }

    const masterGain = ctx.createGain();
    const sfxGain = ctx.createGain();
    const musicGain = ctx.createGain();
    const musicDuckGain = ctx.createGain();
    const compressor = ctx.createDynamicsCompressor();

    // Clean transparent bus limiter to keep intense 100-enemy mixes punchy without clipping
    const now = ctx.currentTime;
    compressor.threshold.setValueAtTime(-10, now);
    compressor.knee.setValueAtTime(12, now);
    compressor.ratio.setValueAtTime(6, now);
    compressor.attack.setValueAtTime(0.003, now);
    compressor.release.setValueAtTime(0.12, now);

    musicDuckGain.gain.setValueAtTime(1.0, now);

    sfxGain.connect(compressor);
    musicGain.connect(musicDuckGain);
    musicDuckGain.connect(compressor);
    compressor.connect(masterGain);
    masterGain.connect(ctx.destination);

    this.ctx = ctx;
    this.masterGain = masterGain;
    this.sfxGain = sfxGain;
    this.musicGain = musicGain;
    this.musicDuckGain = musicDuckGain;
    this.compressor = compressor;
    this.synth = new ProceduralSynth(ctx, musicGain);

    this.applyGainValues(true);
    return ctx;
  }

  /**
   * Exposes the underlying Web Audio AudioContext (or null in headless mode)
   * so callers like CustomPackLoader.loadAudio(ctx) can decode custom pack buffers.
   */
  public getAudioContext(): AudioContext | null {
    return this.ensureContext();
  }

  public unlock(): void {
    if (this.disposed) return;
    const ctx = this.ensureContext();
    if (!ctx) return;

    const onRunning = (): void => {
      if (this.disposed) return;
      if (ctx.state === 'running') {
        this.unbindUnlockListeners();
        this.syncMusicPlayback();
        if (this.pendingUiClick !== null) {
          const kind = this.pendingUiClick;
          this.pendingUiClick = null;
          this.triggerUiClickNow(kind);
        }
      }
    };

    if (ctx.state === 'suspended') {
      try {
        const promise = ctx.resume();
        if (promise && typeof promise.then === 'function') {
          promise.then(onRunning).catch(() => {
            // Autoplay blocked until next user gesture — ignore cleanly
          });
        }
      } catch {
        // Ignore synchronous resume errors in restricted environments
      }
    }

    // Play a 1-sample silent tick once to reliably unlock iOS / WebKit audio engines
    if (!this.silentUnlockSent) {
      this.silentUnlockSent = true;
      try {
        const silentBuf = ctx.createBuffer(1, 1, 22050);
        const src = ctx.createBufferSource();
        src.buffer = silentBuf;
        src.connect(ctx.destination);
        src.start(0);
      } catch {
        // Ignore if context cannot start yet
      }
    }

    if (ctx.state === 'running') {
      onRunning();
    }
  }

  // --------------------------------------------------------------------------
  // Volume & Settings Control
  // --------------------------------------------------------------------------

  public applySettings(settings: AudioSettings): void {
    this.settings = {
      masterVolume: clamp(settings.masterVolume, 0, 1),
      sfxVolume: clamp(settings.sfxVolume, 0, 1),
      musicVolume: clamp(settings.musicVolume, 0, 1),
      muted: Boolean(settings.muted),
    };
    this.applyGainValues(false);
  }

  private applyGainValues(immediate: boolean): void {
    if (!this.ctx || !this.masterGain || !this.sfxGain || !this.musicGain) return;
    const now = this.ctx.currentTime;
    const masterTarget = this.settings.muted ? 0 : this.settings.masterVolume;
    const sfxTarget = this.settings.sfxVolume * SFX_BUS_SCALE;
    const musicTarget = this.settings.musicVolume * MUSIC_BUS_SCALE;

    if (immediate) {
      this.masterGain.gain.setValueAtTime(masterTarget, now);
      this.sfxGain.gain.setValueAtTime(sfxTarget, now);
      this.musicGain.gain.setValueAtTime(musicTarget, now);
    } else {
      this.masterGain.gain.setTargetAtTime(masterTarget, now, 0.015);
      this.sfxGain.gain.setTargetAtTime(sfxTarget, now, 0.015);
      this.musicGain.gain.setTargetAtTime(musicTarget, now, 0.02);
    }
  }

  // --------------------------------------------------------------------------
  // Custom Pack Buffer Override
  // --------------------------------------------------------------------------

  public setCustomAudioBuffers(buffers: Map<string, AudioBuffer>): void {
    this.customBuffers = new Map(buffers);
    if (!this.disposed && this.ctx && this.ctx.state === 'running') {
      this.syncMusicPlayback();
    }
  }

  // --------------------------------------------------------------------------
  // Dynamic Multi-State Music Routing (Custom Pack -> ProceduralSynth Fallback)
  // --------------------------------------------------------------------------

  public updateMusic(
    screen: GameScreen,
    isBoss: boolean,
    isElite: boolean,
    zoneId: 0 | 1 | 2
  ): void {
    if (this.disposed) return;

    const prev = this.desiredMusic;
    const enteringCombat =
      screen === 'combat' &&
      this.lastNonPauseScreen !== 'combat' &&
      this.lastNonPauseScreen !== 'wave_end';

    if (enteringCombat && !isBoss && !isElite && zoneId === 0) {
      this.combatVariantIndex = (this.combatVariantIndex + 1) % 3;
    }

    if (screen !== 'pause') {
      this.lastNonPauseScreen = screen;
    }

    const unchanged =
      prev !== null &&
      prev.screen === screen &&
      prev.isBoss === isBoss &&
      prev.isElite === isElite &&
      prev.zoneId === zoneId;

    this.desiredMusic = { screen, isBoss, isElite, zoneId };

    if (!unchanged && this.ctx && this.ctx.state === 'running') {
      this.syncMusicPlayback();
    }
  }

  private resolveMusicTargets(req: MusicRequest): {
    customKeys: readonly string[];
    proceduralTrack: ProceduralMusicTrack;
  } {
    const effectiveScreen = req.screen === 'pause' ? this.lastNonPauseScreen : req.screen;

    switch (effectiveScreen) {
      case 'title':
      case 'select_character':
      case 'select_weapon':
      case 'select_zone':
      case 'select_danger':
      case 'codex':
      case 'options':
        return {
          customKeys: ['music_menu'],
          proceduralTrack: 'title',
        };

      case 'combat':
      case 'wave_end': {
        if (req.isBoss) {
          return {
            customKeys: ['music_boss', 'music_elite', 'music_combat_0'],
            proceduralTrack: 'boss',
          };
        }
        if (req.isElite) {
          return {
            customKeys: ['music_elite', 'music_combat_1', 'music_combat_0'],
            proceduralTrack: 'elite',
          };
        }
        if (req.zoneId === 1) {
          return {
            customKeys: ['music_abyss', 'music_combat_1', 'music_combat_0'],
            proceduralTrack: 'combat_abyss',
          };
        }
        if (req.zoneId === 2) {
          return {
            customKeys: ['music_jungle', 'music_combat_2', 'music_combat_0'],
            proceduralTrack: 'combat_jungle',
          };
        }
        // Zone 0 Crash Zone rotates across music_combat_0 / 1 / 2 when present
        const combatOrder = [
          `music_combat_${this.combatVariantIndex}`,
          'music_combat_0',
          'music_combat_1',
          'music_combat_2',
        ];
        return {
          customKeys: combatOrder,
          proceduralTrack: 'combat_crash',
        };
      }

      case 'shop':
      case 'level_up':
      case 'crate_modal':
        return {
          customKeys: ['music_shop', 'music_menu'],
          proceduralTrack: 'shop',
        };

      case 'victory':
        return {
          customKeys: ['music_victory', 'music_menu'],
          proceduralTrack: 'victory',
        };

      case 'game_over':
        return {
          customKeys: ['music_game_over'],
          proceduralTrack: 'game_over',
        };

      case 'pause':
        return {
          customKeys: ['music_menu'],
          proceduralTrack: 'title',
        };
    }
  }

  private syncMusicPlayback(): void {
    if (!this.ctx || !this.musicGain || !this.musicDuckGain || !this.synth || !this.desiredMusic) {
      return;
    }
    if (this.ctx.state !== 'running') return;

    const now = this.ctx.currentTime;
    const isPaused = this.desiredMusic.screen === 'pause';
    const duckTarget = isPaused ? PAUSE_MUSIC_DUCK : 1.0;
    this.musicDuckGain.gain.setTargetAtTime(duckTarget, now, 0.05);

    const { customKeys, proceduralTrack } = this.resolveMusicTargets(this.desiredMusic);

    // Check if Custom Pack provides a matching music AudioBuffer
    let matchedKey: string | null = null;
    let matchedBuffer: AudioBuffer | null = null;
    for (const key of customKeys) {
      const buf = this.customBuffers.get(key);
      if (buf) {
        matchedKey = key;
        matchedBuffer = buf;
        break;
      }
    }

    if (matchedKey && matchedBuffer) {
      // Stop procedural sequencer cleanly when Custom Pack music takes over
      this.synth.stopMusic();
      if (this.customMusic && this.customMusic.key === matchedKey) {
        return; // Already looping this exact custom track
      }
      this.startCustomMusicLoop(matchedKey, matchedBuffer);
    } else {
      // Fall back immediately to ProceduralSynth music sequencer
      this.stopCustomMusicLoop();
      this.synth.startMusic(proceduralTrack);
    }
  }

  private startCustomMusicLoop(key: string, buffer: AudioBuffer): void {
    if (!this.ctx || !this.musicGain) return;
    this.stopCustomMusicLoop();

    const now = this.ctx.currentTime;
    const source = this.ctx.createBufferSource();
    source.buffer = buffer;
    source.loop = true;

    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.linearRampToValueAtTime(1.0, now + MUSIC_CROSSFADE_SEC);

    source.connect(gain);
    gain.connect(this.musicGain);
    source.start(now);

    this.customMusic = { key, source, gain };
  }

  private stopCustomMusicLoop(): void {
    if (!this.customMusic || !this.ctx) return;
    const prev = this.customMusic;
    this.customMusic = null;

    const now = this.ctx.currentTime;
    try {
      prev.gain.gain.cancelScheduledValues(now);
      prev.gain.gain.setValueAtTime(Math.max(0.0001, prev.gain.gain.value), now);
      prev.gain.gain.linearRampToValueAtTime(0.0001, now + MUSIC_CROSSFADE_SEC);
      prev.source.stop(now + MUSIC_CROSSFADE_SEC + 0.03);
      prev.source.onended = () => {
        try {
          prev.source.disconnect();
          prev.gain.disconnect();
        } catch {
          // Ignore disconnect cleanup error
        }
      };
    } catch {
      // Ignore if already stopped
    }
  }

  // --------------------------------------------------------------------------
  // Polyphony Cap (<= 24 Voices), Micro-Cooldowns, Panning & Pitch Jitter
  // --------------------------------------------------------------------------

  private computePan(worldX: number, cameraX: number): number {
    return clamp((worldX - cameraX) / PAN_HALF_WIDTH, -PAN_CLAMP, PAN_CLAMP);
  }

  private randomPitchJitter(amount = DEFAULT_PITCH_JITTER): number {
    return 1 + (Math.random() * 2 - 1) * amount;
  }

  private checkCooldown(cooldownKey: string): boolean {
    if (!this.ctx) return false;
    const cdMs = SFX_COOLDOWNS_MS[cooldownKey];
    if (!cdMs) return true;

    const nowMs = this.ctx.currentTime * 1000;
    const prevMs = this.lastPlayedMs.get(cooldownKey);
    if (prevMs !== undefined && nowMs - prevMs < cdMs) {
      return false;
    }
    this.lastPlayedMs.set(cooldownKey, nowMs);
    return true;
  }

  private pruneVoices(now: number): void {
    let write = 0;
    for (let i = 0; i < this.activeVoices.length; i++) {
      const v = this.activeVoices[i];
      if (v.endTime > now) {
        this.activeVoices[write++] = v;
      }
    }
    this.activeVoices.length = write;
  }

  private reserveVoiceSlot(durationSec: number, highPriority: boolean, stopFn?: () => void): boolean {
    if (!this.ctx) return false;
    const now = this.ctx.currentTime;
    this.pruneVoices(now);

    if (this.activeVoices.length >= MAX_SFX_VOICES) {
      if (!highPriority) {
        return false;
      }
      // Steal oldest voice to strictly enforce <= 24 simultaneous voices
      const evicted = this.activeVoices.shift();
      if (evicted?.stop) {
        try {
          evicted.stop();
        } catch {
          // Ignore stop errors
        }
      }
    }

    this.activeVoices.push({
      endTime: now + Math.max(0.02, durationSec),
      stop: stopFn,
    });
    return true;
  }

  private createSfxDestination(pan: number): { node: AudioNode; cleanup: () => void } {
    const sfxGain = this.sfxGain!;
    if (
      Math.abs(pan) > 0.01 &&
      this.ctx &&
      typeof this.ctx.createStereoPanner === 'function'
    ) {
      const panner = this.ctx.createStereoPanner();
      panner.pan.setValueAtTime(clamp(pan, -PAN_CLAMP, PAN_CLAMP), this.ctx.currentTime);
      panner.connect(sfxGain);
      return {
        node: panner,
        cleanup: () => {
          try {
            panner.disconnect();
          } catch {
            // Ignore cleanup errors
          }
        },
      };
    }
    return { node: sfxGain, cleanup: () => {} };
  }

  private playCustomBuffer(
    key: string,
    pan: number,
    playbackRate: number,
    volume: number,
    highPriority: boolean
  ): boolean {
    if (!this.ctx || !this.sfxGain) return false;
    const buffer = this.customBuffers.get(key);
    if (!buffer) return false;

    const rate = clamp(playbackRate, 0.35, 3.0);
    const estDur = Math.min(2.5, buffer.duration / rate);

    if (!this.reserveVoiceSlot(estDur, highPriority)) {
      return true; // Key existed, voice intentionally capped
    }
    const slot = this.activeVoices[this.activeVoices.length - 1];

    const src = this.ctx.createBufferSource();
    src.buffer = buffer;
    src.playbackRate.setValueAtTime(rate, this.ctx.currentTime);

    if (slot) {
      slot.stop = () => {
        try {
          src.stop();
        } catch {
          // Ignore if already ended
        }
      };
    }

    const voiceGain = this.ctx.createGain();
    voiceGain.gain.setValueAtTime(clamp(volume, 0.05, 1.5), this.ctx.currentTime);

    const { node: dest, cleanup } = this.createSfxDestination(pan);
    src.connect(voiceGain);
    voiceGain.connect(dest);

    src.onended = () => {
      try {
        src.disconnect();
        voiceGain.disconnect();
      } catch {
        // Ignore disconnect error
      }
      cleanup();
    };

    try {
      src.start(this.ctx.currentTime);
    } catch {
      cleanup();
      return false;
    }
    return true;
  }

  private runProceduralVoice(
    pan: number,
    highPriority: boolean,
    fn: (dest: AudioNode) => number
  ): void {
    if (!this.ctx || !this.sfxGain) return;
    if (!this.reserveVoiceSlot(0.15, highPriority)) return;

    const slot = this.activeVoices[this.activeVoices.length - 1];
    const { node: dest, cleanup } = this.createSfxDestination(pan);
    const dur = fn(dest);
    if (slot) {
      slot.endTime = this.ctx.currentTime + Math.max(0.02, dur);
    }

    if (dest !== this.sfxGain) {
      const cleanupDelayMs = Math.ceil((dur + 0.08) * 1000);
      const timer = setTimeout(() => {
        this.cleanupTimers.delete(timer);
        cleanup();
      }, cleanupDelayMs);
      this.cleanupTimers.add(timer);
    }
  }

  /**
   * Optional direct manifest-key playback helper for auxiliary ambient/UI cues
   * (e.g. countdown ticks, burn crackles, shield blocks, spawn telegraphs, footsteps).
   */
  public playNamedSfx(
    key: 'sfx_burn' | 'sfx_tick' | 'sfx_step' | 'sfx_shield' | 'sfx_spawn_begin' | 'sfx_spawn_end',
    worldX = 0,
    cameraX = 0
  ): void {
    if (this.disposed) return;
    if (!this.ctx || !this.synth || this.ctx.state !== 'running') return;
    if (this.settings.muted || this.settings.masterVolume <= 0 || this.settings.sfxVolume <= 0) {
      return;
    }
    if (!this.checkCooldown(key)) return;

    const pan = worldX === cameraX ? 0 : this.computePan(worldX, cameraX);
    const pitch = this.randomPitchJitter(0.05);
    if (this.playCustomBuffer(key, pan, pitch, 0.72, false)) return;

    this.runProceduralVoice(pan, false, (dest) => {
      switch (key) {
        case 'sfx_burn':
          return this.synth!.playBurn(dest, pitch);
        case 'sfx_tick':
          return this.synth!.playTick(dest, pitch);
        case 'sfx_step':
          return this.synth!.playStep(dest, pitch);
        case 'sfx_shield':
          return this.synth!.playShield(dest, pitch);
        case 'sfx_spawn_begin':
          return this.synth!.playSpawnBegin(dest, pitch);
        case 'sfx_spawn_end':
          return this.synth!.playSpawnEnd(dest, pitch);
      }
    });
  }

  // --------------------------------------------------------------------------
  // Simulation Event Processing
  // --------------------------------------------------------------------------

  public processEvents(events: readonly SimEvent[], cameraX: number): void {
    if (this.disposed || events.length === 0) return;
    if (!this.ctx || !this.synth || this.ctx.state !== 'running') return;
    if (this.settings.muted || this.settings.masterVolume <= 0 || this.settings.sfxVolume <= 0) {
      return;
    }

    for (let i = 0; i < events.length; i++) {
      this.handleSimEvent(events[i], cameraX);
    }
  }

  private handleSimEvent(event: SimEvent, cameraX: number): void {
    if (!this.ctx || !this.synth) return;

    switch (event.type) {
      case 'weapon_fire': {
        const key = WEAPON_SOUND_KEY[event.soundKind];
        if (!this.checkCooldown(key)) return;
        const pan = this.computePan(event.x, cameraX);
        const pitch = this.randomPitchJitter(DEFAULT_PITCH_JITTER);
        if (this.playCustomBuffer(key, pan, pitch, 0.72, false)) return;
        this.runProceduralVoice(pan, false, (dest) =>
          this.synth!.playWeaponFire(event.soundKind, dest, pitch)
        );
        return;
      }

      case 'enemy_hit': {
        const cdKey = event.isCrit ? 'sfx_enemy_hit_crit' : 'sfx_enemy_hit';
        if (!this.checkCooldown(cdKey)) return;
        const pan = this.computePan(event.x, cameraX);
        const pitch = this.randomPitchJitter(DEFAULT_PITCH_JITTER);

        if (this.playCustomBuffer('sfx_enemy_hit', pan, pitch, event.isCrit ? 0.8 : 0.58, false)) {
          // Layer crisp crit sparkle even over custom pack hit sound so crits pop!
          if (event.isCrit) {
            this.runProceduralVoice(pan, false, (dest) => this.synth!.playCritChime(dest, pitch));
          }
          return;
        }

        this.runProceduralVoice(pan, event.isBoss, (dest) =>
          this.synth!.playEnemyHit(dest, pitch, event.isCrit, event.isBoss)
        );
        return;
      }

      case 'enemy_die': {
        const isHigh = event.isElite || event.isBoss;
        if (!isHigh && !this.checkCooldown('sfx_enemy_die')) return;
        const pan = this.computePan(event.x, cameraX);
        const pitch = this.randomPitchJitter(DEFAULT_PITCH_JITTER);
        if (this.playCustomBuffer('sfx_enemy_die', pan, pitch, isHigh ? 0.95 : 0.7, isHigh)) {
          return;
        }
        this.runProceduralVoice(pan, isHigh, (dest) =>
          this.synth!.playEnemyDie(dest, pitch, event.isElite, event.isBoss)
        );
        return;
      }

      case 'player_hit': {
        if (!this.checkCooldown('sfx_player_hit')) return;
        const pan = this.computePan(event.x, cameraX);
        const pitch = this.randomPitchJitter(0.04);
        if (this.playCustomBuffer('sfx_player_hit', pan, pitch, 0.95, true)) return;
        this.runProceduralVoice(pan, true, (dest) => this.synth!.playPlayerHit(dest, pitch));
        return;
      }

      case 'player_dodge': {
        if (!this.checkCooldown('sfx_player_dodge')) return;
        const pan = this.computePan(event.x, cameraX);
        const pitch = this.randomPitchJitter(0.05);
        if (this.playCustomBuffer('sfx_shield', pan, pitch, 0.75, true)) return;
        this.runProceduralVoice(pan, true, (dest) => this.synth!.playPlayerDodge(dest, pitch));
        return;
      }

      case 'player_heal': {
        if (!this.checkCooldown('sfx_player_heal')) return;
        const pan = this.computePan(event.x, cameraX);
        const pitch = this.randomPitchJitter(0.03);
        if (this.playCustomBuffer('sfx_player_heal', pan, pitch, 0.75, false)) return;
        this.runProceduralVoice(pan, false, (dest) => this.synth!.playPlayerHeal(dest, pitch));
        return;
      }

      case 'pickup_material': {
        if (!this.checkCooldown('sfx_pickup_material')) return;
        const now = this.ctx.currentTime;
        if (now - this.lastMaterialPickupSec > MATERIAL_COMBO_RESET_SEC) {
          this.materialComboCount = 0;
        } else {
          this.materialComboCount = Math.min(this.materialComboCount + 1, MATERIAL_COMBO_MAX);
        }
        this.lastMaterialPickupSec = now;

        const pan = this.computePan(event.x, cameraX);
        const jitter = this.randomPitchJitter(0.03);
        const comboRate = Math.min(1.75, Math.pow(2, (this.materialComboCount * 1.15) / 12)) * jitter;
        const customKey =
          event.isBoosted && this.customBuffers.has('sfx_pickup_material_alt')
            ? 'sfx_pickup_material_alt'
            : 'sfx_pickup_material';

        if (this.playCustomBuffer(customKey, pan, comboRate, event.isBoosted ? 0.85 : 0.68, false)) {
          return;
        }
        const comboIdx = this.materialComboCount;
        this.runProceduralVoice(pan, false, (dest) =>
          this.synth!.playPickupMaterial(dest, jitter, comboIdx, event.isBoosted)
        );
        return;
      }

      case 'pickup_consumable': {
        if (!this.checkCooldown('sfx_pickup_fruit')) return;
        const pan = this.computePan(event.x, cameraX);
        const pitch = this.randomPitchJitter(0.04);
        if (this.playCustomBuffer('sfx_pickup_fruit', pan, pitch, 0.85, true)) return;
        this.runProceduralVoice(pan, true, (dest) => this.synth!.playPickupFruit(dest, pitch));
        return;
      }

      case 'pickup_crate': {
        const pan = this.computePan(event.x, cameraX);
        const pitch = event.isLegendary ? 1.08 : this.randomPitchJitter(0.02);
        if (this.playCustomBuffer('sfx_pickup_crate', pan, pitch, 0.95, true)) return;
        this.runProceduralVoice(pan, true, (dest) =>
          this.synth!.playPickupCrate(dest, pitch, event.isLegendary)
        );
        return;
      }

      case 'explosion': {
        if (!this.checkCooldown('sfx_explosion')) return;
        const pan = this.computePan(event.x, cameraX);
        const pitch = this.randomPitchJitter(DEFAULT_PITCH_JITTER);
        if (this.playCustomBuffer('sfx_explosion', pan, pitch, 0.88, true)) return;
        this.runProceduralVoice(pan, true, (dest) =>
          this.synth!.playExplosion(dest, pitch, event.radius)
        );
        return;
      }

      case 'level_up': {
        const pan = this.computePan(event.x, cameraX);
        if (this.playCustomBuffer('sfx_level_up', pan, 1.0, 0.95, true)) return;
        this.runProceduralVoice(pan, true, (dest) => this.synth!.playLevelUp(dest, 1.0));
        return;
      }

      case 'wave_start': {
        if (event.isBoss) {
          this.runProceduralVoice(0, true, (dest) => this.synth!.playBossSpawn(dest));
          return;
        }
        if (this.playCustomBuffer('sfx_spawn_end', 0, 1.0, 0.78, true)) return;
        this.runProceduralVoice(0, true, (dest) =>
          this.synth!.playWaveStart(dest, event.isBoss, event.isElite, event.isHorde)
        );
        return;
      }

      case 'wave_end': {
        if (this.playCustomBuffer('sfx_wave_end', 0, 1.0, 0.92, true)) return;
        this.runProceduralVoice(0, true, (dest) => this.synth!.playWaveEnd(dest));
        return;
      }

      case 'harvest_payout': {
        const pitch = this.randomPitchJitter(0.03);
        if (this.playCustomBuffer('sfx_harvest', 0, pitch, 0.85, true)) return;
        this.runProceduralVoice(0, true, (dest) => this.synth!.playHarvest(dest, pitch));
        return;
      }

      case 'shop_buy': {
        this.playUiClick('buy');
        return;
      }

      case 'shop_combine': {
        this.playUiClick('combine');
        return;
      }

      case 'shop_reroll': {
        this.playUiClick('reroll');
        return;
      }

      case 'shop_recycle': {
        if (!this.checkCooldown('sfx_ui_recycle')) return;
        const pitch = this.randomPitchJitter(0.03);
        if (this.playCustomBuffer('sfx_pickup_material_alt', 0, pitch, 0.82, true)) return;
        this.runProceduralVoice(0, true, (dest) => this.synth!.playShopRecycle(dest, pitch));
        return;
      }

      case 'boss_spawn': {
        if (this.playCustomBuffer('sfx_spawn_begin', 0, 0.82, 0.95, true)) {
          // Layer ominous boss horn so boss entrances always feel dramatic
          this.runProceduralVoice(0, true, (dest) => this.synth!.playBossSpawn(dest));
          return;
        }
        this.runProceduralVoice(0, true, (dest) => this.synth!.playBossSpawn(dest));
        return;
      }

      case 'victory': {
        this.runProceduralVoice(0, true, (dest) => this.synth!.playVictorySting(dest));
        return;
      }

      case 'game_over': {
        this.runProceduralVoice(0, true, (dest) => this.synth!.playGameOverSting(dest));
        return;
      }

      case 'decal': {
        // Pure visual event — no audio
        return;
      }
    }
  }

  // --------------------------------------------------------------------------
  // UI Click Feedback
  // --------------------------------------------------------------------------

  public playUiClick(kind: UiClickKind): void {
    if (this.disposed) return;
    if (this.settings.muted || this.settings.masterVolume <= 0 || this.settings.sfxVolume <= 0) {
      return;
    }

    const ctx = this.ensureContext();
    if (!ctx || !this.synth) return;

    if (ctx.state !== 'running') {
      // Unlock cleanly; queue non-hover click so very first button tap gives feedback
      if (kind !== 'hover') {
        this.pendingUiClick = kind;
      }
      this.unlock();
      return;
    }

    this.triggerUiClickNow(kind);
  }

  private triggerUiClickNow(kind: UiClickKind): void {
    if (!this.ctx || !this.synth || this.ctx.state !== 'running') return;
    const key = UI_SOUND_KEY[kind];
    if (!this.checkCooldown(key)) return;

    const jitter = kind === 'hover' ? 0.03 : 0.025;
    const pitch = this.randomPitchJitter(jitter);
    const vol = kind === 'hover' ? 0.52 : 0.85;

    if (this.playCustomBuffer(key, 0, pitch, vol, true)) return;
    this.runProceduralVoice(0, true, (dest) => this.synth!.playUiClick(kind, dest, pitch));
  }

  // --------------------------------------------------------------------------
  // Teardown
  // --------------------------------------------------------------------------

  public dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.unbindUnlockListeners();

    this.stopCustomMusicLoop();
    if (this.synth) {
      this.synth.dispose();
      this.synth = null;
    }

    for (const timer of this.cleanupTimers) {
      clearTimeout(timer);
    }
    this.cleanupTimers.clear();

    for (const v of this.activeVoices) {
      if (v.stop) {
        try {
          v.stop();
        } catch {
          // Ignore stop errors
        }
      }
    }
    this.activeVoices.length = 0;
    this.lastPlayedMs.clear();
    this.customBuffers.clear();
    this.desiredMusic = null;
    this.pendingUiClick = null;

    const ctx = this.ctx;
    this.ctx = null;
    this.masterGain = null;
    this.sfxGain = null;
    this.musicGain = null;
    this.musicDuckGain = null;
    this.compressor = null;

    if (ctx && typeof ctx.close === 'function') {
      try {
        const p = ctx.close();
        if (p && typeof p.catch === 'function') {
          p.catch(() => {});
        }
      } catch {
        // Ignore close error
      }
    }
  }
}
