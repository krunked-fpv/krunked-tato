// ============================================================================
// src/audio/ProceduralSynth.ts — 100% Original Web Audio Procedural Synthesizer
// Zero external dependencies. Completely headless-safe (no top-level DOM/WebAudio).
// ============================================================================

import type { WeaponSoundKind } from '../contracts/index';

export type UiClickKind =
  | 'hover'
  | 'confirm'
  | 'cancel'
  | 'buy'
  | 'reroll'
  | 'combine'
  | 'error';

export type ProceduralMusicTrack =
  | 'title'
  | 'combat_crash'
  | 'combat_abyss'
  | 'combat_jungle'
  | 'elite'
  | 'boss'
  | 'shop'
  | 'victory'
  | 'game_over';

const MIN_GAIN = 0.0001;
const MIN_FREQ = 24;
const MAX_FREQ = 18000;

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

function clampFreq(f: number): number {
  return clamp(f, MIN_FREQ, MAX_FREQ);
}

function midiToFreq(midi: number): number {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

// Pentatonic-biased sparkling pickup ladder (15 steps)
const PICKUP_COMBO_SEMITONES: readonly number[] = [
  0, 2, 4, 7, 9, 12, 14, 16, 19, 21, 24, 26, 28, 31, 33,
];

// Cheerful chord voicings for 'musical' weapons (MIDI note triads)
const MUSICAL_WEAPON_CHORDS: ReadonlyArray<readonly [number, number, number]> = [
  [72, 76, 79], // C5 major
  [74, 77, 81], // D5 minor
  [76, 79, 83], // E5 minor
  [77, 81, 84], // F5 major
  [79, 83, 86], // G5 major
  [81, 84, 88], // A5 minor
];

interface TrackPattern {
  bpm: number;
  steps: number; // 16th-note loop length (32 or 64)
  swing: number; // 0..0.15 subtle groove offset on odd 16ths
  kick: readonly number[]; // velocity 0..1
  snare: readonly number[];
  hat: readonly number[];
  perc?: readonly number[]; // optional tribal tom/bongo hits (MIDI note)
  marimba?: readonly (number | null)[]; // woody pitched marimba/kalimba layer (Zone 2 Primal Jungle)
  sonar?: readonly (number | null)[]; // deep-sea resonant sonar ping layer (Zone 1 Abyssal Trench)
  brassStabs?: Readonly<Record<number, readonly number[]>>; // urgent alarm brass stabs (Elite & Boss)
  bass: readonly (number | null)[]; // MIDI note
  bassType: OscillatorType;
  bassFilterHz: number;
  doubleTimeSub?: boolean; // adds pounding sub-octave reinforcement + 16th-note drive
  lead: readonly (number | null)[]; // MIDI note
  leadType: OscillatorType;
  leadFilterHz: number;
  leadStyle?: 'default' | 'surf' | 'sonar' | 'marimba' | 'shred';
  chords: Readonly<Record<number, readonly number[]>>; // step -> MIDI notes
  chordStyle: 'pad' | 'rhodes' | 'stab' | 'arp';
  arp?: readonly (number | null)[]; // high arpeggio shimmer layer
}

// ----------------------------------------------------------------------------
// Original Multi-State Musical Patterns (32-step / 2-bar loops at 16th notes)
// ----------------------------------------------------------------------------

const TRACK_PATTERNS: Readonly<Record<ProceduralMusicTrack, TrackPattern>> = {
  // Upbeat crunchy retro-alien synthwave groove (D minor / Dorian, 118 BPM)
  title: {
    bpm: 118,
    steps: 32,
    swing: 0.04,
    kick: [
      1, 0, 0, 0, 0, 0, 0.5, 0, 1, 0, 0, 0, 0, 0, 0, 0,
      1, 0, 0, 0, 0, 0, 0.55, 0, 1, 0, 0.4, 0, 0, 0, 0.5, 0,
    ],
    snare: [
      0, 0, 0, 0, 0.85, 0, 0, 0, 0, 0, 0, 0, 0.9, 0, 0, 0.25,
      0, 0, 0, 0, 0.85, 0, 0, 0, 0, 0, 0, 0, 0.95, 0, 0.3, 0,
    ],
    hat: [
      0.35, 0.2, 0.6, 0.2, 0.35, 0.2, 0.65, 0.25, 0.35, 0.2, 0.6, 0.2, 0.35, 0.25, 0.7, 0.3,
      0.35, 0.2, 0.6, 0.2, 0.35, 0.2, 0.65, 0.25, 0.35, 0.2, 0.6, 0.2, 0.4, 0.3, 0.75, 0.35,
    ],
    bass: [
      38, null, 50, null, 38, null, 45, 48, 38, null, 50, null, 43, null, 45, null,
      34, null, 46, null, 34, null, 41, 45, 36, null, 48, null, 43, 45, 48, null,
    ],
    bassType: 'sawtooth',
    bassFilterHz: 780,
    lead: [
      62, null, 65, null, 69, null, 67, 65, 62, null, null, 60, 62, null, 65, null,
      69, null, 72, null, 70, null, 69, 65, 67, null, 65, null, 64, null, 60, null,
    ],
    leadType: 'square',
    leadFilterHz: 2200,
    chords: {
      0: [50, 57, 62, 65],
      8: [50, 55, 60, 65],
      16: [46, 53, 58, 62],
      24: [48, 55, 60, 64],
    },
    chordStyle: 'stab',
    arp: [
      74, null, 77, null, 81, null, 77, null, 74, null, 79, null, 81, null, 79, null,
      70, null, 74, null, 77, null, 74, null, 72, null, 76, null, 79, null, 76, null,
    ],
  },

  // Zone 0 Crash Zone: Driving alien surf-synth groove (E minor / surf Phrygian, 138 BPM, 64-step 4-bar)
  combat_crash: {
    bpm: 138,
    steps: 64,
    swing: 0.02,
    kick: [
      1, 0, 0, 0.45, 1, 0, 0.4, 0, 1, 0, 0.5, 0, 1, 0, 0, 0,
      1, 0, 0, 0.45, 1, 0, 0.4, 0, 1, 0, 0.55, 0, 1, 0, 0.65, 0,
      1, 0, 0, 0.45, 1, 0, 0.4, 0, 1, 0, 0.5, 0, 1, 0, 0.35, 0,
      1, 0, 0.4, 0, 1, 0, 0.45, 0, 1, 0, 0.55, 0.4, 1, 0.5, 0.75, 0,
    ],
    snare: [
      0, 0, 0, 0, 0.9, 0, 0, 0.25, 0, 0, 0, 0, 0.95, 0, 0.28, 0,
      0, 0, 0, 0, 0.9, 0, 0, 0.25, 0, 0, 0, 0.35, 0.95, 0, 0.45, 0.55,
      0, 0, 0, 0, 0.9, 0, 0, 0.25, 0, 0, 0, 0, 0.95, 0, 0.3, 0,
      0, 0, 0, 0, 0.9, 0, 0.3, 0, 0, 0, 0.4, 0, 0.95, 0.45, 0.65, 0.8,
    ],
    hat: [
      0.45, 0.25, 0.75, 0.25, 0.45, 0.25, 0.75, 0.3, 0.45, 0.25, 0.75, 0.25, 0.45, 0.3, 0.8, 0.3,
      0.45, 0.25, 0.75, 0.25, 0.45, 0.25, 0.75, 0.3, 0.45, 0.25, 0.75, 0.3, 0.5, 0.35, 0.85, 0.4,
      0.45, 0.25, 0.75, 0.25, 0.45, 0.25, 0.75, 0.3, 0.45, 0.25, 0.75, 0.25, 0.45, 0.3, 0.8, 0.35,
      0.45, 0.25, 0.75, 0.3, 0.45, 0.3, 0.8, 0.35, 0.5, 0.35, 0.8, 0.35, 0.55, 0.4, 0.9, 0.45,
    ],
    // Surf-rock tom fill on turnarounds
    perc: [
      0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
      0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 52, 50, 47,
      0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
      0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 55, 52, 50, 48, 47, 45,
    ],
    bass: [
      40, 40, 52, 40, 40, 40, 47, 43, 40, 40, 52, 40, 45, 43, 42, 40,
      36, 36, 48, 36, 38, 38, 50, 38, 40, 40, 52, 47, 45, 43, 42, 38,
      40, 40, 52, 40, 43, 43, 55, 43, 45, 45, 57, 45, 47, 45, 43, 42,
      36, 36, 48, 43, 38, 38, 50, 45, 40, 40, 52, 47, 45, 43, 42, 39,
    ],
    bassType: 'sawtooth',
    bassFilterHz: 1020,
    // Twangy chromatic alien surf-synth riff!
    lead: [
      64, 64, 67, null, 71, 72, 71, 67, 64, null, 62, 64, 67, null, 64, null,
      72, 72, 71, null, 69, 67, 64, null, 66, null, 67, 71, 76, null, 71, null,
      76, 76, 75, 76, 79, null, 76, 71, 72, 72, 71, 69, 67, null, 64, null,
      69, null, 71, 72, 74, null, 72, 71, 69, 67, 66, 67, 71, null, 64, null,
    ],
    leadType: 'sawtooth',
    leadFilterHz: 3100,
    leadStyle: 'surf',
    chords: {
      0: [52, 55, 59],
      16: [48, 52, 55],
      20: [50, 54, 57],
      24: [52, 55, 59],
      32: [52, 55, 59],
      40: [57, 60, 64],
      48: [48, 52, 55],
      52: [50, 54, 57],
      56: [52, 55, 59, 64],
    },
    chordStyle: 'stab',
    arp: [
      76, null, 79, null, 83, null, 79, null, 76, null, 79, null, 83, 81, 79, null,
      72, null, 76, null, 74, null, 78, null, 76, null, 79, null, 83, null, 79, null,
      76, null, 79, null, 83, null, 88, null, 81, null, 84, null, 88, null, 84, null,
      72, null, 76, null, 74, null, 78, null, 76, 79, 83, 86, 88, null, 83, null,
    ],
  },

  // Zone 1 Abyssal Trench: Deep moody pulsing sonar synth bass & bioluminescent arps (C Phrygian, 124 BPM, 64-step)
  combat_abyss: {
    bpm: 124,
    steps: 64,
    swing: 0.03,
    kick: [
      1.0, 0, 0, 0, 0, 0, 0.65, 0, 0.92, 0, 0, 0.45, 0, 0, 0, 0,
      1.0, 0, 0, 0, 0, 0, 0.7, 0, 0.92, 0, 0, 0, 0, 0.42, 0, 0.5,
      1.0, 0, 0, 0.35, 0, 0, 0.65, 0, 0.92, 0, 0, 0.45, 0, 0, 0.4, 0,
      1.0, 0, 0, 0, 0, 0, 0.72, 0, 0.95, 0, 0.4, 0, 0, 0.45, 0, 0.55,
    ],
    snare: [
      0, 0, 0, 0, 0.72, 0, 0, 0, 0, 0, 0, 0, 0.78, 0, 0.25, 0,
      0, 0, 0, 0, 0.72, 0, 0, 0, 0, 0, 0, 0, 0.82, 0, 0, 0.32,
      0, 0, 0, 0, 0.75, 0, 0, 0.2, 0, 0, 0, 0, 0.8, 0, 0.28, 0,
      0, 0, 0, 0, 0.75, 0, 0, 0, 0, 0, 0.3, 0, 0.85, 0, 0.35, 0.4,
    ],
    hat: [
      0.28, 0, 0.52, 0.18, 0.28, 0.18, 0.55, 0, 0.28, 0, 0.52, 0.22, 0.28, 0.18, 0.58, 0.2,
      0.28, 0, 0.52, 0.18, 0.28, 0.18, 0.55, 0, 0.28, 0.2, 0.55, 0.25, 0.32, 0.22, 0.62, 0.25,
      0.3, 0, 0.55, 0.2, 0.3, 0.2, 0.58, 0, 0.3, 0, 0.55, 0.24, 0.3, 0.2, 0.6, 0.22,
      0.3, 0, 0.55, 0.2, 0.3, 0.22, 0.6, 0.2, 0.32, 0.22, 0.58, 0.25, 0.38, 0.25, 0.66, 0.28,
    ],
    // Pulsing deep sub-synth sonar bassline
    bass: [
      36, 36, null, 36, 43, null, 36, 48, 36, null, 37, 37, 43, null, 39, 37,
      36, 36, null, 36, 43, null, 36, 46, 32, null, 34, 34, 39, null, 43, 37,
      36, 36, null, 36, 43, null, 48, 43, 37, 37, null, 37, 44, null, 43, 39,
      32, 32, null, 32, 39, null, 34, 41, 36, 36, null, 43, 39, 37, 36, null,
    ],
    bassType: 'triangle',
    bassFilterHz: 540,
    doubleTimeSub: true,
    // Haunting resonant submarine sonar pings!
    sonar: [
      84, null, null, null, null, null, null, null, 87, null, null, null, null, null, null, null,
      85, null, null, null, null, null, null, null, 79, null, null, null, null, null, null, null,
      84, null, null, null, null, null, 91, null, 85, null, null, null, null, null, null, null,
      80, null, null, null, 82, null, null, null, 84, null, null, null, null, null, null, null,
    ],
    lead: [
      72, null, null, 75, null, null, 73, null, 72, null, 67, null, null, null, 70, null,
      72, null, null, 79, null, 75, 73, null, 72, null, 70, null, 67, null, null, null,
      75, null, null, 79, null, 77, 75, null, 73, null, 72, null, 70, null, 67, null,
      68, null, 70, null, 72, null, 75, null, 73, null, 72, null, 67, null, null, null,
    ],
    leadType: 'triangle',
    leadFilterHz: 1650,
    leadStyle: 'sonar',
    chords: {
      0: [48, 55, 60, 63],
      16: [49, 55, 61, 63],
      24: [44, 51, 56, 63],
      32: [48, 55, 60, 63],
      40: [49, 56, 61, 67],
      48: [44, 51, 56, 60],
      56: [46, 53, 58, 63],
    },
    chordStyle: 'pad',
    arp: [
      60, 63, 67, 72, 67, 63, 60, 67, 61, 63, 67, 73, 67, 63, 61, 67,
      60, 63, 67, 72, 75, 72, 67, 63, 56, 60, 63, 68, 70, 67, 63, 58,
      60, 67, 72, 75, 72, 67, 63, 60, 61, 67, 73, 75, 73, 67, 61, 63,
      56, 63, 68, 72, 58, 63, 70, 75, 60, 67, 72, 79, 75, 72, 67, 63,
    ],
  },

  // Zone 2 Primal Jungle: Tribal percussive bass + rhythmic wooden marimba & jungle groove (A Dorian, 140 BPM, 64-step)
  combat_jungle: {
    bpm: 140,
    steps: 64,
    swing: 0.05,
    kick: [
      1, 0, 0, 0.58, 0, 0, 0.88, 0, 1, 0, 0, 0, 0.68, 0, 0, 0,
      1, 0, 0, 0.58, 0, 0, 0.88, 0, 1, 0, 0.55, 0, 0, 0, 0.65, 0,
      1, 0, 0, 0.6, 0, 0, 0.9, 0, 1, 0, 0.45, 0, 0.7, 0, 0, 0,
      1, 0, 0, 0.6, 0, 0, 0.9, 0, 1, 0, 0.58, 0, 0.65, 0, 0.75, 0,
    ],
    snare: [
      0, 0, 0, 0, 0.82, 0, 0, 0, 0, 0, 0.38, 0, 0.88, 0, 0, 0.32,
      0, 0, 0, 0, 0.82, 0, 0, 0.3, 0, 0, 0, 0, 0.92, 0, 0.38, 0,
      0, 0, 0, 0, 0.85, 0, 0, 0.25, 0, 0, 0.4, 0, 0.88, 0, 0, 0.35,
      0, 0, 0, 0, 0.85, 0, 0.3, 0, 0, 0, 0.4, 0, 0.95, 0.35, 0.5, 0.6,
    ],
    hat: [
      0.42, 0.25, 0.68, 0.22, 0.42, 0.3, 0.68, 0.25, 0.42, 0.25, 0.68, 0.25, 0.42, 0.3, 0.72, 0.3,
      0.42, 0.25, 0.68, 0.22, 0.42, 0.3, 0.68, 0.25, 0.42, 0.25, 0.68, 0.3, 0.48, 0.32, 0.78, 0.35,
      0.44, 0.25, 0.7, 0.25, 0.44, 0.32, 0.7, 0.28, 0.44, 0.25, 0.7, 0.28, 0.44, 0.32, 0.75, 0.32,
      0.44, 0.28, 0.72, 0.25, 0.45, 0.32, 0.72, 0.3, 0.48, 0.3, 0.75, 0.32, 0.52, 0.35, 0.82, 0.4,
    ],
    // Syncopated tribal conga / tom percussion
    perc: [
      0, 52, 57, 0, 0, 60, 0, 55, 0, 52, 57, 0, 0, 62, 60, 57,
      0, 52, 57, 0, 0, 64, 0, 60, 0, 57, 0, 55, 52, 60, 62, 57,
      0, 52, 57, 0, 55, 60, 0, 57, 0, 52, 62, 0, 0, 64, 60, 57,
      0, 55, 60, 0, 0, 64, 62, 60, 0, 57, 55, 52, 57, 60, 64, 62,
    ],
    // Rhythmic woody marimba ostinato!
    marimba: [
      69, null, 72, 74, null, 76, 72, null, 69, 72, null, 76, 79, null, 76, 74,
      67, null, 71, 74, null, 76, 71, null, 69, 72, 74, null, 76, 74, 72, null,
      69, 72, null, 76, 79, null, 81, 79, 76, null, 74, 72, 69, null, 72, 74,
      71, null, 74, 76, 79, null, 76, 74, 72, 74, 76, null, 81, 79, 76, null,
    ],
    bass: [
      45, null, 45, 52, null, 45, 48, 50, 45, null, 57, null, 52, 50, 48, null,
      43, null, 43, 50, null, 43, 47, 48, 45, null, 52, 50, 48, 45, 43, null,
      45, 45, null, 52, null, 45, 50, 52, 45, null, 57, 55, 52, 50, 48, 45,
      43, 43, null, 50, null, 43, 47, 50, 45, null, 52, 55, 52, 48, 45, null,
    ],
    bassType: 'sawtooth',
    bassFilterHz: 880,
    lead: [
      69, null, 72, 74, null, 76, 74, 72, 69, null, 67, null, 69, null, 72, null,
      74, null, 76, 79, null, 76, 74, 72, 71, null, 69, null, 67, null, 64, null,
      81, null, 79, 76, null, 74, 72, null, 76, null, 74, 72, 69, null, null, null,
      79, null, 76, 74, 72, null, 74, 76, 74, null, 72, 71, 69, null, 64, null,
    ],
    leadType: 'square',
    leadFilterHz: 2250,
    leadStyle: 'marimba',
    chords: {
      0: [57, 60, 64, 67],
      16: [55, 59, 62, 66],
      24: [57, 60, 64, 69],
      32: [57, 60, 64, 67],
      48: [55, 59, 62, 67],
      56: [57, 60, 64, 69],
    },
    chordStyle: 'stab',
  },

  // Elite Wave: High-octane adrenaline overdrive with double-time bass & alarm brass stabs (F# minor, 150 BPM, 64-step)
  elite: {
    bpm: 150,
    steps: 64,
    swing: 0,
    kick: [
      1, 0, 0.55, 0, 1, 0, 0.55, 0, 1, 0, 0.6, 0, 1, 0, 0.6, 0.45,
      1, 0, 0.55, 0, 1, 0, 0.55, 0, 1, 0, 0.65, 0, 1, 0.55, 1, 0,
      1, 0, 0.55, 0, 1, 0, 0.6, 0.45, 1, 0, 0.6, 0, 1, 0, 0.65, 0,
      1, 0, 0.6, 0, 1, 0.45, 0.65, 0, 1, 0.55, 1, 0, 1, 0.65, 1, 0.7,
    ],
    snare: [
      0, 0, 0, 0, 1, 0, 0, 0.35, 0, 0, 0, 0, 1, 0, 0.4, 0,
      0, 0, 0, 0, 1, 0, 0, 0.35, 0, 0, 0, 0.45, 1, 0, 0.55, 0.7,
      0, 0, 0, 0, 1, 0, 0, 0.35, 0, 0, 0, 0.35, 1, 0, 0.45, 0,
      0, 0, 0, 0, 1, 0, 0.35, 0, 0, 0, 0.45, 0, 1, 0.5, 0.65, 0.85,
    ],
    hat: [
      0.55, 0.4, 0.85, 0.4, 0.55, 0.4, 0.85, 0.45, 0.55, 0.4, 0.85, 0.4, 0.55, 0.45, 0.9, 0.45,
      0.55, 0.4, 0.85, 0.4, 0.55, 0.4, 0.85, 0.45, 0.55, 0.4, 0.85, 0.45, 0.6, 0.48, 0.92, 0.52,
      0.55, 0.4, 0.85, 0.4, 0.55, 0.42, 0.85, 0.45, 0.55, 0.4, 0.85, 0.42, 0.58, 0.45, 0.9, 0.48,
      0.58, 0.42, 0.88, 0.45, 0.58, 0.45, 0.88, 0.48, 0.6, 0.48, 0.9, 0.5, 0.65, 0.52, 0.95, 0.58,
    ],
    // Relentless 16th-note double-time driving bass!
    bass: [
      42, 54, 42, 54, 42, 54, 45, 47, 42, 54, 42, 54, 49, 47, 45, 44,
      38, 50, 38, 50, 40, 52, 40, 52, 42, 54, 45, 57, 49, 47, 45, 44,
      42, 54, 42, 43, 42, 54, 45, 47, 42, 54, 49, 54, 50, 49, 47, 45,
      38, 50, 38, 50, 40, 52, 44, 56, 42, 54, 45, 57, 49, 50, 54, 49,
    ],
    bassType: 'sawtooth',
    bassFilterHz: 1380,
    doubleTimeSub: true,
    // Urgent alarm brass stabs!
    brassStabs: {
      0: [54, 61, 66],
      6: [55, 62, 67],
      16: [50, 57, 62],
      20: [52, 59, 64],
      24: [54, 61, 66],
      32: [54, 61, 66, 69],
      38: [55, 62, 67],
      48: [50, 57, 62],
      52: [52, 59, 64],
      56: [54, 61, 66],
      60: [56, 62, 68],
    },
    lead: [
      66, 69, 73, null, 71, 69, 66, null, 64, 66, 69, null, 73, null, 71, null,
      74, 73, 71, null, 69, 71, 73, null, 78, null, 76, 73, 71, 69, 66, null,
      78, null, 76, 73, 74, null, 73, 71, 69, 71, 73, 76, 78, null, 73, null,
      81, null, 78, 76, 74, 73, 71, 69, 73, null, 76, null, 78, null, 73, null,
    ],
    leadType: 'sawtooth',
    leadFilterHz: 3500,
    leadStyle: 'shred',
    chords: {
      0: [54, 57, 61],
      16: [50, 54, 57],
      20: [52, 56, 59],
      24: [54, 57, 61],
      32: [54, 57, 61],
      48: [50, 54, 57],
      52: [52, 56, 59],
      56: [54, 57, 61],
    },
    chordStyle: 'stab',
    arp: [
      78, 73, 69, 73, 78, 73, 69, 73, 76, 71, 68, 71, 76, 71, 68, 71,
      74, 69, 66, 69, 76, 71, 68, 71, 78, 73, 69, 73, 81, 78, 73, 69,
      78, 81, 85, 81, 78, 73, 69, 73, 76, 80, 83, 80, 76, 71, 68, 71,
      74, 78, 81, 78, 76, 80, 83, 80, 78, 81, 85, 90, 85, 81, 78, 73,
    ],
  },

  // Boss Battle: Ferocious final-boss anthem with thunderous double-time bass & dramatic alarm brass stabs (D Phrygian, 158 BPM, 64-step)
  boss: {
    bpm: 158,
    steps: 64,
    swing: 0,
    kick: [
      1, 0, 0.65, 0, 1, 0, 0.65, 0.5, 1, 0, 0.7, 0, 1, 0, 0.75, 0,
      1, 0, 0.65, 0, 1, 0, 0.65, 0.55, 1, 0.6, 1, 0, 1, 0.65, 1, 0.75,
      1, 0, 0.65, 0.45, 1, 0, 0.65, 0.5, 1, 0, 0.7, 0, 1, 0.5, 0.75, 0,
      1, 0, 0.7, 0, 1, 0.55, 1, 0.55, 1, 0.65, 1, 0.65, 1, 0.75, 1, 0.85,
    ],
    snare: [
      0, 0, 0, 0, 1, 0, 0, 0.38, 0, 0, 0, 0.45, 1, 0, 0.45, 0,
      0, 0, 0, 0, 1, 0, 0, 0.38, 0, 0, 0, 0.52, 1, 0.5, 0.65, 0.88,
      0, 0, 0, 0, 1, 0, 0, 0.4, 0, 0, 0, 0.48, 1, 0, 0.48, 0.35,
      0, 0, 0, 0, 1, 0, 0.4, 0, 0, 0.4, 0, 0.55, 1, 0.6, 0.78, 0.95,
    ],
    hat: [
      0.58, 0.42, 0.88, 0.42, 0.58, 0.42, 0.88, 0.48, 0.58, 0.42, 0.88, 0.42, 0.58, 0.48, 0.92, 0.48,
      0.58, 0.42, 0.88, 0.42, 0.58, 0.42, 0.88, 0.48, 0.62, 0.48, 0.92, 0.52, 0.65, 0.52, 0.96, 0.62,
      0.58, 0.45, 0.88, 0.45, 0.58, 0.45, 0.88, 0.48, 0.58, 0.45, 0.88, 0.45, 0.6, 0.48, 0.92, 0.5,
      0.6, 0.48, 0.9, 0.48, 0.62, 0.5, 0.92, 0.52, 0.65, 0.52, 0.95, 0.55, 0.7, 0.58, 1.0, 0.68,
    ],
    // Thunderous 16th-note double-time Phrygian gallop bass!
    bass: [
      38, 50, 38, 39, 38, 50, 45, 38, 38, 50, 38, 39, 43, 45, 44, 41,
      38, 50, 38, 39, 34, 46, 36, 48, 38, 50, 41, 53, 44, 45, 50, 45,
      38, 50, 38, 39, 41, 53, 39, 51, 38, 50, 45, 57, 44, 45, 43, 41,
      34, 46, 34, 46, 36, 48, 39, 51, 38, 50, 44, 56, 45, 57, 50, 39,
    ],
    bassType: 'sawtooth',
    bassFilterHz: 1620,
    doubleTimeSub: true,
    // Dramatic boss alarm brass stabs!
    brassStabs: {
      0: [50, 57, 62, 69],
      3: [51, 58, 63],
      8: [51, 58, 63, 69],
      14: [50, 56, 62],
      16: [46, 53, 58, 65],
      20: [48, 55, 60, 67],
      24: [50, 56, 62, 68],
      28: [51, 57, 63, 69],
      32: [50, 57, 62, 74],
      38: [51, 58, 63, 75],
      44: [50, 56, 62, 69],
      48: [46, 53, 58, 70],
      52: [48, 55, 60, 72],
      56: [50, 57, 62, 74],
      60: [51, 58, 63, 75],
      62: [50, 56, 62, 74],
    },
    lead: [
      62, null, 63, 62, 69, null, 68, null, 65, 63, 62, null, 60, 62, 65, 69,
      74, null, 75, 74, 70, null, 69, null, 68, 65, 63, 62, 69, null, 65, 63,
      74, 75, 74, 70, 69, null, 74, 75, 77, null, 75, 74, 70, 69, 68, 65,
      70, null, 74, 75, 72, null, 75, 77, 74, 77, 81, 82, 81, 77, 75, 74,
    ],
    leadType: 'sawtooth',
    leadFilterHz: 3900,
    leadStyle: 'shred',
    chords: {
      0: [50, 57, 62],
      8: [51, 58, 63],
      16: [46, 53, 58],
      24: [50, 56, 62],
      32: [50, 57, 62],
      40: [51, 58, 63],
      48: [46, 53, 58],
      56: [50, 56, 62],
    },
    chordStyle: 'stab',
    arp: [
      74, 75, 81, 75, 74, 69, 65, 69, 74, 75, 81, 82, 81, 75, 74, 69,
      70, 74, 77, 74, 72, 76, 79, 76, 74, 77, 81, 86, 81, 77, 75, 74,
      74, 81, 86, 81, 75, 82, 87, 82, 74, 81, 86, 89, 86, 82, 81, 75,
      70, 77, 82, 77, 72, 79, 84, 79, 74, 81, 86, 87, 86, 81, 75, 74,
    ],
  },

  // Shop: Chill rhythmic lo-fi bass + warm Rhodes/pluck chords (Fmaj7 - Dm9 - Gm7 - C9, 94 BPM)
  shop: {
    bpm: 94,
    steps: 32,
    swing: 0.09,
    kick: [
      0.75, 0, 0, 0, 0, 0, 0.45, 0, 0, 0, 0.65, 0, 0, 0, 0, 0,
      0.75, 0, 0, 0, 0, 0, 0.45, 0, 0, 0, 0.6, 0, 0, 0, 0.35, 0,
    ],
    snare: [
      0, 0, 0, 0, 0.45, 0, 0, 0, 0, 0, 0, 0, 0.5, 0, 0, 0.18,
      0, 0, 0, 0, 0.45, 0, 0, 0, 0, 0, 0, 0, 0.5, 0, 0.18, 0,
    ],
    hat: [
      0.22, 0, 0.35, 0.15, 0.22, 0, 0.38, 0.15, 0.22, 0, 0.35, 0.15, 0.22, 0, 0.4, 0.18,
      0.22, 0, 0.35, 0.15, 0.22, 0, 0.38, 0.15, 0.22, 0, 0.35, 0.15, 0.25, 0.15, 0.42, 0.2,
    ],
    bass: [
      41, null, null, 41, null, null, 45, null, 38, null, null, 38, null, 41, 45, null,
      43, null, null, 43, null, null, 46, null, 36, null, null, 43, null, 40, 38, null,
    ],
    bassType: 'triangle',
    bassFilterHz: 480,
    lead: [
      null, null, 72, null, null, 69, null, 65, null, null, 69, null, 72, null, null, null,
      null, null, 74, null, null, 70, null, 67, null, null, 69, null, 67, null, 64, null,
    ],
    leadType: 'sine',
    leadFilterHz: 1500,
    chords: {
      0: [53, 57, 60, 64], // Fmaj7
      8: [50, 57, 60, 64], // Dm9
      16: [55, 58, 62, 65], // Gm7
      24: [52, 58, 62, 65], // C9
    },
    chordStyle: 'rhodes',
  },

  // Victory: Celebratory uplifting brass/bell groove (C major, 114 BPM)
  victory: {
    bpm: 114,
    steps: 32,
    swing: 0.03,
    kick: [
      0.85, 0, 0, 0, 0, 0, 0.4, 0, 0.85, 0, 0, 0, 0, 0, 0, 0,
      0.85, 0, 0, 0, 0, 0, 0.4, 0, 0.85, 0, 0.45, 0, 0, 0, 0, 0,
    ],
    snare: [
      0, 0, 0, 0, 0.65, 0, 0, 0, 0, 0, 0, 0, 0.7, 0, 0, 0,
      0, 0, 0, 0, 0.65, 0, 0, 0, 0, 0, 0, 0, 0.75, 0, 0.3, 0,
    ],
    hat: [
      0.3, 0, 0.5, 0.2, 0.3, 0, 0.5, 0.2, 0.3, 0, 0.5, 0.2, 0.3, 0, 0.55, 0.25,
      0.3, 0, 0.5, 0.2, 0.3, 0, 0.5, 0.2, 0.3, 0, 0.5, 0.2, 0.35, 0.2, 0.6, 0.25,
    ],
    bass: [
      48, null, 48, null, 55, null, 52, null, 45, null, 45, null, 52, null, 48, null,
      41, null, 41, null, 48, null, 45, null, 43, null, 47, null, 50, null, 55, null,
    ],
    bassType: 'triangle',
    bassFilterHz: 750,
    lead: [
      72, null, 76, null, 79, null, 84, null, 81, null, 79, null, 76, null, null, null,
      77, null, 81, null, 84, null, 81, null, 79, null, 76, null, 74, null, 79, null,
    ],
    leadType: 'triangle',
    leadFilterHz: 2800,
    chords: {
      0: [60, 64, 67, 72],
      8: [57, 60, 64, 69],
      16: [53, 57, 60, 65],
      24: [55, 59, 62, 67],
    },
    chordStyle: 'rhodes',
    arp: [
      84, null, 79, null, 76, null, 79, null, 81, null, 76, null, 72, null, 76, null,
      81, null, 77, null, 72, null, 77, null, 83, null, 79, null, 74, null, 79, null,
    ],
  },

  // Game Over: Moody sparse dramatic minor pulse (A minor, 78 BPM)
  game_over: {
    bpm: 78,
    steps: 32,
    swing: 0,
    kick: [
      0.65, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
      0.65, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
    ],
    snare: [
      0, 0, 0, 0, 0, 0, 0, 0, 0.35, 0, 0, 0, 0, 0, 0, 0,
      0, 0, 0, 0, 0, 0, 0, 0, 0.35, 0, 0, 0, 0, 0, 0, 0,
    ],
    hat: [
      0.15, 0, 0, 0, 0.18, 0, 0, 0, 0.15, 0, 0, 0, 0.18, 0, 0, 0,
      0.15, 0, 0, 0, 0.18, 0, 0, 0, 0.15, 0, 0, 0, 0.2, 0, 0, 0,
    ],
    bass: [
      33, null, null, null, null, null, null, null, 36, null, null, null, null, null, null, null,
      29, null, null, null, null, null, null, null, 28, null, null, null, null, null, null, null,
    ],
    bassType: 'triangle',
    bassFilterHz: 360,
    lead: [
      69, null, null, null, 67, null, null, null, 64, null, null, null, null, null, null, null,
      65, null, null, null, 64, null, null, null, 62, null, null, null, 60, null, null, null,
    ],
    leadType: 'sine',
    leadFilterHz: 1100,
    chords: {
      0: [45, 52, 57, 60],
      16: [41, 48, 53, 57],
      24: [40, 47, 52, 56],
    },
    chordStyle: 'pad',
  },
};

export class ProceduralSynth {
  private readonly ctx: AudioContext;
  private readonly whiteNoise: AudioBuffer;
  private readonly pinkNoise: AudioBuffer;
  private readonly softClipCurve: Float32Array<ArrayBuffer>;
  private readonly musicBus: GainNode;

  private musicalChordIndex = 0;

  // Sequencer state
  private activeTrack: ProceduralMusicTrack | null = null;
  private seqTimer: ReturnType<typeof setInterval> | null = null;
  private nextStepTime = 0;
  private stepIndex = 0;
  private disposed = false;

  private readonly scheduleAheadSec = 0.14;
  private readonly lookaheadMs = 35;

  constructor(ctx: AudioContext, musicDestination: AudioNode) {
    this.ctx = ctx;
    this.whiteNoise = this.buildWhiteNoise(ctx, 1.5);
    this.pinkNoise = this.buildPinkNoise(ctx, 1.5);
    this.softClipCurve = this.buildSoftClipCurve(256, 3.2);

    this.musicBus = ctx.createGain();
    this.musicBus.gain.setValueAtTime(1.0, ctx.currentTime);
    this.musicBus.connect(musicDestination);
  }

  // --------------------------------------------------------------------------
  // Pre-baked Noise & Waveshaper Buffers (zero per-SFX allocations)
  // --------------------------------------------------------------------------

  private buildWhiteNoise(ctx: AudioContext, durationSec: number): AudioBuffer {
    const length = Math.max(1, Math.floor(ctx.sampleRate * durationSec));
    const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    // Deterministic xorshift32 for crisp reproducible noise buffer
    let s = 0x9e3779b9;
    for (let i = 0; i < length; i++) {
      s ^= s << 13;
      s ^= s >>> 17;
      s ^= s << 5;
      data[i] = ((s >>> 0) / 4294967295) * 2 - 1;
    }
    return buffer;
  }

  private buildPinkNoise(ctx: AudioContext, durationSec: number): AudioBuffer {
    const length = Math.max(1, Math.floor(ctx.sampleRate * durationSec));
    const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    let b0 = 0;
    let b1 = 0;
    let b2 = 0;
    let b3 = 0;
    let b4 = 0;
    let b5 = 0;
    let b6 = 0;
    let s = 0x243f6a88;
    for (let i = 0; i < length; i++) {
      s ^= s << 13;
      s ^= s >>> 17;
      s ^= s << 5;
      const white = ((s >>> 0) / 4294967295) * 2 - 1;
      b0 = 0.99886 * b0 + white * 0.0555179;
      b1 = 0.99332 * b1 + white * 0.0750759;
      b2 = 0.96900 * b2 + white * 0.1538520;
      b3 = 0.86650 * b3 + white * 0.3104856;
      b4 = 0.55000 * b4 + white * 0.5329522;
      b5 = -0.7616 * b5 - white * 0.0168980;
      data[i] = clamp((b0 + b1 + b2 + b3 + b4 + b5 + b6 + white * 0.5362) * 0.12, -1, 1);
      b6 = white * 0.115926;
    }
    return buffer;
  }

  private buildSoftClipCurve(samples: number, drive: number): Float32Array<ArrayBuffer> {
    const ab = new ArrayBuffer(samples * 4);
    const curve = new Float32Array(ab);
    for (let i = 0; i < samples; i++) {
      const x = (i * 2) / (samples - 1) - 1;
      curve[i] = Math.tanh(x * drive);
    }
    return curve;
  }

  // --------------------------------------------------------------------------
  // Core Synthesis Primitives
  // --------------------------------------------------------------------------

  private tone(
    dest: AudioNode,
    type: OscillatorType,
    startFreq: number,
    endFreq: number,
    startTime: number,
    duration: number,
    peakGain: number,
    attack = 0.004,
    filterHz?: number,
    filterQ = 1.0
  ): void {
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = type;

    const f0 = clampFreq(startFreq);
    const f1 = clampFreq(endFreq);
    const dur = Math.max(0.012, duration);
    const atk = Math.min(attack, dur * 0.45);
    const peak = Math.max(MIN_GAIN * 2, peakGain);

    osc.frequency.setValueAtTime(f0, startTime);
    if (Math.abs(f1 - f0) > 0.5) {
      osc.frequency.exponentialRampToValueAtTime(f1, startTime + dur);
    }

    gain.gain.setValueAtTime(MIN_GAIN, startTime);
    gain.gain.linearRampToValueAtTime(peak, startTime + atk);
    gain.gain.exponentialRampToValueAtTime(MIN_GAIN, startTime + dur);

    if (filterHz !== undefined) {
      const flt = this.ctx.createBiquadFilter();
      flt.type = 'lowpass';
      flt.frequency.setValueAtTime(clampFreq(filterHz), startTime);
      flt.Q.setValueAtTime(filterQ, startTime);
      osc.connect(flt);
      flt.connect(gain);
    } else {
      osc.connect(gain);
    }

    gain.connect(dest);
    osc.start(startTime);
    osc.stop(startTime + dur + 0.02);
  }

  private noise(
    dest: AudioNode,
    usePink: boolean,
    filterType: BiquadFilterType,
    freqStart: number,
    freqEnd: number,
    q: number,
    startTime: number,
    duration: number,
    peakGain: number,
    attack = 0.003,
    saturate = false
  ): void {
    const src = this.ctx.createBufferSource();
    src.buffer = usePink ? this.pinkNoise : this.whiteNoise;
    src.loop = true;

    const flt = this.ctx.createBiquadFilter();
    flt.type = filterType;
    flt.Q.setValueAtTime(q, startTime);
    const f0 = clampFreq(freqStart);
    const f1 = clampFreq(freqEnd);
    const dur = Math.max(0.012, duration);
    const atk = Math.min(attack, dur * 0.45);
    const peak = Math.max(MIN_GAIN * 2, peakGain);

    flt.frequency.setValueAtTime(f0, startTime);
    if (Math.abs(f1 - f0) > 1) {
      flt.frequency.exponentialRampToValueAtTime(f1, startTime + dur);
    }

    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(MIN_GAIN, startTime);
    gain.gain.linearRampToValueAtTime(peak, startTime + atk);
    gain.gain.exponentialRampToValueAtTime(MIN_GAIN, startTime + dur);

    src.connect(flt);
    if (saturate) {
      const shaper = this.ctx.createWaveShaper();
      shaper.curve = this.softClipCurve;
      flt.connect(shaper);
      shaper.connect(gain);
    } else {
      flt.connect(gain);
    }
    gain.connect(dest);

    const offset = (startTime * 13.37) % Math.max(0.1, src.buffer.duration - 0.05);
    src.start(startTime, offset);
    src.stop(startTime + dur + 0.02);
  }

  // --------------------------------------------------------------------------
  // Weapon SFX (all 13 WeaponSoundKind variants)
  // --------------------------------------------------------------------------

  public playWeaponFire(kind: WeaponSoundKind, dest: AudioNode, pitchMult: number): number {
    const t = this.ctx.currentTime;
    const p = clamp(pitchMult, 0.7, 1.45);

    switch (kind) {
      case 'pistol': {
        // Snappy pistol crack + tight low-mid kick
        this.tone(dest, 'triangle', 420 * p, 92 * p, t, 0.065, 0.34, 0.002);
        this.noise(dest, false, 'bandpass', 2200 * p, 950 * p, 1.1, t, 0.072, 0.30, 0.001, true);
        this.tone(dest, 'square', 1480 * p, 520 * p, t, 0.022, 0.12, 0.001, 3200);
        return 0.085;
      }

      case 'smg': {
        // Tight rapid SMG pop — crisp, light, zero mud at rapid fire
        this.tone(dest, 'triangle', 580 * p, 145 * p, t, 0.036, 0.24, 0.0015);
        this.noise(dest, false, 'bandpass', 2600 * p, 1300 * p, 1.5, t, 0.042, 0.22, 0.001);
        return 0.055;
      }

      case 'shotgun': {
        // Booming shotgun blast: sub-thump + wide saturated noise boom + crisp crack
        this.tone(dest, 'sine', 165 * p, 38 * p, t, 0.165, 0.48, 0.002);
        this.noise(dest, true, 'lowpass', 3600 * p, 340 * p, 0.8, t, 0.21, 0.44, 0.002, true);
        this.noise(dest, false, 'highpass', 1800 * p, 900 * p, 0.7, t, 0.085, 0.26, 0.001);
        // Quick metallic action snap tail
        this.tone(dest, 'triangle', 920 * p, 540 * p, t + 0.09, 0.032, 0.08, 0.002);
        return 0.23;
      }

      case 'laser': {
        // Sci-fi laser zap: bright harmonic sweep + resonant chirp
        this.tone(dest, 'sawtooth', 1950 * p, 240 * p, t, 0.115, 0.24, 0.002, 4200);
        this.tone(dest, 'sine', 3100 * p, 580 * p, t, 0.095, 0.18, 0.002);
        this.noise(dest, false, 'bandpass', 3800 * p, 1100 * p, 3.2, t, 0.075, 0.12, 0.002);
        return 0.13;
      }

      case 'sniper': {
        // High-caliber crack + deep punch + supersonic metallic ring
        this.tone(dest, 'sine', 195 * p, 44 * p, t, 0.145, 0.44, 0.0015);
        this.noise(dest, false, 'bandpass', 3200 * p, 780 * p, 0.9, t, 0.14, 0.38, 0.001, true);
        this.tone(dest, 'triangle', 1420 * p, 460 * p, t + 0.01, 0.19, 0.15, 0.002);
        return 0.22;
      }

      case 'rocket': {
        // Deep rocket ignition thump + roaring thruster whoosh
        this.tone(dest, 'sine', 140 * p, 46 * p, t, 0.14, 0.36, 0.003);
        this.noise(dest, true, 'bandpass', 260 * p, 980 * p, 1.3, t, 0.11, 0.34, 0.01, true);
        this.noise(dest, true, 'lowpass', 1400 * p, 240 * p, 0.9, t + 0.05, 0.22, 0.30, 0.02);
        return 0.29;
      }

      case 'flame': {
        // Crackling flame burst: warm roaring pink noise + sizzling high crackle
        this.noise(dest, true, 'bandpass', 420 * p, 1280 * p, 1.1, t, 0.14, 0.30, 0.012);
        this.noise(dest, false, 'highpass', 2900 * p, 1800 * p, 1.2, t + 0.01, 0.11, 0.16, 0.006);
        this.tone(dest, 'triangle', 150 * p, 85 * p, t, 0.09, 0.14, 0.008);
        return 0.16;
      }

      case 'magic': {
        // Shimmering arcane chime + airy sparkle
        this.tone(dest, 'sine', 784 * p, 1046 * p, t, 0.15, 0.22, 0.004);
        this.tone(dest, 'triangle', 1175 * p, 1568 * p, t + 0.015, 0.16, 0.16, 0.004);
        this.tone(dest, 'sine', 2093 * p, 2637 * p, t + 0.03, 0.12, 0.09, 0.005);
        this.noise(dest, false, 'highpass', 4500 * p, 6200 * p, 1.4, t, 0.09, 0.08, 0.01);
        return 0.19;
      }

      case 'musical': {
        // Bouncy musical triad stab rotating through bright voicings
        const chord = MUSICAL_WEAPON_CHORDS[this.musicalChordIndex % MUSICAL_WEAPON_CHORDS.length];
        this.musicalChordIndex = (this.musicalChordIndex + 1) % MUSICAL_WEAPON_CHORDS.length;
        for (let i = 0; i < chord.length; i++) {
          const f = midiToFreq(chord[i]) * p;
          this.tone(
            dest,
            i === 0 ? 'triangle' : 'sine',
            f * 1.015,
            f,
            t + i * 0.014,
            0.16,
            0.16 - i * 0.025,
            0.003,
            2800
          );
        }
        return 0.2;
      }

      case 'melee_light': {
        // Crisp light melee whoosh + snappy air whip
        this.noise(dest, false, 'bandpass', 620 * p, 2350 * p, 1.8, t, 0.08, 0.24, 0.01);
        this.tone(dest, 'sine', 340 * p, 150 * p, t, 0.065, 0.16, 0.004);
        return 0.095;
      }

      case 'melee_heavy': {
        // Deep heavy swing whoosh + hefty low air displacement
        this.noise(dest, true, 'bandpass', 220 * p, 840 * p, 1.4, t, 0.155, 0.36, 0.018);
        this.tone(dest, 'triangle', 175 * p, 64 * p, t, 0.14, 0.28, 0.008);
        return 0.175;
      }

      case 'melee_blade': {
        // Razor-sharp steel slash + bright metallic edge shimmer
        this.noise(dest, false, 'bandpass', 1450 * p, 4600 * p, 2.2, t, 0.095, 0.26, 0.005);
        this.tone(dest, 'triangle', 2480 * p, 1720 * p, t + 0.008, 0.085, 0.11, 0.002);
        this.tone(dest, 'sine', 3760 * p, 2850 * p, t + 0.012, 0.075, 0.07, 0.002);
        return 0.115;
      }

      case 'throw': {
        // Zippy flick-throw spin sound
        this.tone(dest, 'sine', 330 * p, 780 * p, t, 0.045, 0.18, 0.003);
        this.tone(dest, 'sine', 780 * p, 280 * p, t + 0.04, 0.045, 0.14, 0.002);
        this.noise(dest, false, 'bandpass', 1350 * p, 2600 * p, 2.0, t, 0.065, 0.16, 0.004);
        return 0.1;
      }
    }
  }

  // --------------------------------------------------------------------------
  // Combat, Impact, Death, Pickup & Progression SFX
  // --------------------------------------------------------------------------

  public playEnemyHit(dest: AudioNode, pitchMult: number, isCrit: boolean, isBoss: boolean): number {
    const t = this.ctx.currentTime;
    const p = clamp(pitchMult, 0.75, 1.35);

    // Meaty impact thud
    const bodyBase = isBoss ? 135 : 185;
    this.tone(dest, 'triangle', bodyBase * p, 56 * p, t, 0.068, isBoss ? 0.34 : 0.26, 0.0015);
    this.noise(dest, true, 'bandpass', 960 * p, 420 * p, 1.3, t, 0.045, 0.22, 0.001);

    if (isCrit) {
      // Crisp metallic crit chime!
      this.playCritChime(dest, p);
      return 0.19;
    }
    return 0.08;
  }

  public playCritChime(dest: AudioNode, pitchMult = 1.0): number {
    const t = this.ctx.currentTime;
    const p = clamp(pitchMult, 0.85, 1.25);
    this.tone(dest, 'sine', 1760 * p, 1820 * p, t, 0.145, 0.20, 0.002);
    this.tone(dest, 'triangle', 2637 * p, 2710 * p, t + 0.008, 0.16, 0.15, 0.002);
    this.tone(dest, 'sine', 3520 * p, 3520 * p, t + 0.012, 0.095, 0.08, 0.002);
    return 0.18;
  }

  public playEnemyDie(dest: AudioNode, pitchMult: number, isElite: boolean, isBoss: boolean): number {
    const t = this.ctx.currentTime;
    const p = clamp(pitchMult, 0.75, 1.35);

    if (isBoss) {
      // Massive seismic boss defeat blast + triumphant chord
      this.tone(dest, 'sine', 130, 26, t, 0.65, 0.55, 0.004);
      this.noise(dest, true, 'lowpass', 2600, 140, 0.9, t, 0.62, 0.48, 0.005, true);
      const fanfare = [523.25, 659.25, 783.99, 1046.5];
      for (let i = 0; i < fanfare.length; i++) {
        this.tone(dest, 'sawtooth', fanfare[i], fanfare[i], t + 0.14 + i * 0.06, 0.42, 0.14, 0.015, 2400);
      }
      return 0.85;
    }

    if (isElite) {
      // Chunky elite pop + resonant burst + short triumph ping
      this.tone(dest, 'sine', 190 * p, 48 * p, t, 0.24, 0.42, 0.003);
      this.noise(dest, true, 'bandpass', 1400 * p, 260 * p, 1.0, t, 0.22, 0.34, 0.002, true);
      this.tone(dest, 'triangle', 587 * p, 880 * p, t + 0.06, 0.22, 0.18, 0.006);
      return 0.3;
    }

    // Juicy alien pop!
    this.tone(dest, 'sine', 240 * p, 540 * p, t, 0.038, 0.24, 0.002);
    this.tone(dest, 'triangle', 490 * p, 96 * p, t + 0.032, 0.068, 0.26, 0.002);
    this.noise(dest, false, 'bandpass', 1350 * p, 620 * p, 2.0, t + 0.01, 0.062, 0.18, 0.002);
    return 0.115;
  }

  public playPlayerHit(dest: AudioNode, pitchMult: number): number {
    const t = this.ctx.currentTime;
    const p = clamp(pitchMult, 0.85, 1.2);
    // Visceral damage crunch + downward urgency drop
    this.tone(dest, 'sawtooth', 195 * p, 52 * p, t, 0.18, 0.42, 0.002, 1100);
    this.tone(dest, 'square', 360 * p, 125 * p, t, 0.13, 0.24, 0.002, 1400);
    this.noise(dest, true, 'bandpass', 1650 * p, 340 * p, 0.9, t, 0.145, 0.38, 0.002, true);
    return 0.2;
  }

  public playPlayerDodge(dest: AudioNode, pitchMult: number): number {
    const t = this.ctx.currentTime;
    const p = clamp(pitchMult, 0.85, 1.25);
    // Crisp wind-slip whoosh + agile grace chime
    this.noise(dest, false, 'bandpass', 520 * p, 2700 * p, 2.0, t, 0.11, 0.24, 0.008);
    this.tone(dest, 'sine', 820 * p, 1340 * p, t + 0.012, 0.095, 0.16, 0.004);
    return 0.125;
  }

  public playPlayerHeal(dest: AudioNode, pitchMult: number): number {
    const t = this.ctx.currentTime;
    const p = clamp(pitchMult, 0.9, 1.15);
    // Warm soft ascending heal bloom
    this.tone(dest, 'sine', 523.25 * p, 523.25 * p, t, 0.13, 0.18, 0.008);
    this.tone(dest, 'sine', 659.25 * p, 659.25 * p, t + 0.045, 0.16, 0.18, 0.008);
    this.tone(dest, 'triangle', 783.99 * p, 783.99 * p, t + 0.09, 0.18, 0.14, 0.008);
    return 0.28;
  }

  public playPickupMaterial(
    dest: AudioNode,
    pitchMult: number,
    comboIndex: number,
    isBoosted: boolean
  ): number {
    const t = this.ctx.currentTime;
    const idx = clamp(Math.floor(comboIndex), 0, PICKUP_COMBO_SEMITONES.length - 1);
    const semi = PICKUP_COMBO_SEMITONES[idx];
    const baseFreq = 660 * Math.pow(2, semi / 12) * clamp(pitchMult, 0.9, 1.15);

    // Sparkling ascending crystal chime
    this.tone(dest, 'sine', baseFreq, baseFreq * 1.03, t, 0.095, 0.22, 0.002);
    this.tone(dest, 'triangle', baseFreq * 2, baseFreq * 2.02, t + 0.008, 0.075, 0.11, 0.002);

    if (isBoosted) {
      // 2x Loot Bag golden fifth sparkle!
      this.tone(dest, 'sine', baseFreq * 1.498, baseFreq * 1.52, t + 0.02, 0.13, 0.16, 0.003);
      return 0.16;
    }
    return 0.11;
  }

  public playPickupFruit(dest: AudioNode, pitchMult: number): number {
    const t = this.ctx.currentTime;
    const p = clamp(pitchMult, 0.9, 1.15);
    // Juicy pop + warm fruit heal chime
    this.tone(dest, 'triangle', 260 * p, 440 * p, t, 0.045, 0.22, 0.002);
    this.tone(dest, 'sine', 587.33 * p, 587.33 * p, t + 0.025, 0.15, 0.20, 0.006);
    this.tone(dest, 'sine', 739.99 * p, 739.99 * p, t + 0.07, 0.17, 0.18, 0.006);
    this.tone(dest, 'triangle', 880 * p, 880 * p, t + 0.115, 0.20, 0.14, 0.006);
    return 0.33;
  }

  public playPickupCrate(dest: AudioNode, pitchMult: number, isLegendary: boolean): number {
    const t = this.ctx.currentTime;
    const p = clamp(pitchMult, 0.94, 1.08);
    const notes = isLegendary
      ? [523.25, 659.25, 783.99, 1046.5, 1318.51, 1567.98]
      : [523.25, 659.25, 783.99, 1046.5];

    for (let i = 0; i < notes.length; i++) {
      const f = notes[i] * p;
      const start = t + i * (isLegendary ? 0.06 : 0.055);
      const isLast = i === notes.length - 1;
      this.tone(
        dest,
        isLegendary ? 'sawtooth' : 'triangle',
        f,
        f,
        start,
        isLast ? 0.36 : 0.14,
        isLast ? 0.22 : 0.18,
        0.004,
        3200
      );
      this.tone(dest, 'sine', f * 2, f * 2, start + 0.006, isLast ? 0.3 : 0.1, 0.08, 0.004);
    }

    return isLegendary ? 0.75 : 0.54;
  }

  public playExplosion(dest: AudioNode, pitchMult: number, radius = 120): number {
    const t = this.ctx.currentTime;
    const p = clamp(pitchMult, 0.8, 1.25);
    const sizeScale = clamp(radius / 120, 0.65, 1.8);
    const dur = 0.24 * sizeScale;

    // Punchy sub drop + saturated lowpass explosion roar
    this.tone(dest, 'sine', 135 * p, 28, t, dur * 1.05, 0.48, 0.002);
    this.noise(dest, true, 'lowpass', 2600 * p, 170, 0.9, t, dur * 1.15, 0.44, 0.002, true);
    this.noise(dest, false, 'bandpass', 1800 * p, 520, 0.8, t, 0.075, 0.26, 0.001);
    return dur * 1.2;
  }

  public playLevelUp(dest: AudioNode, pitchMult = 1.0): number {
    const t = this.ctx.currentTime;
    const p = clamp(pitchMult, 0.95, 1.06);
    // Triumphant 5-note arpeggio fanfare
    const arp = [523.25, 659.25, 783.99, 987.77, 1046.5];
    for (let i = 0; i < arp.length; i++) {
      const f = arp[i] * p;
      const start = t + i * 0.062;
      const isFinal = i === arp.length - 1;
      this.tone(dest, 'triangle', f, f, start, isFinal ? 0.38 : 0.15, isFinal ? 0.26 : 0.20, 0.004);
      this.tone(dest, 'sawtooth', f * 0.5, f * 0.5, start, isFinal ? 0.36 : 0.13, 0.10, 0.006, 1800);
      if (isFinal) {
        this.tone(dest, 'sine', f * 1.5, f * 1.5, start + 0.015, 0.34, 0.14, 0.008);
        this.tone(dest, 'sine', f * 2.0, f * 2.0, start + 0.025, 0.32, 0.10, 0.01);
      }
    }
    return 0.72;
  }

  public playWaveStart(dest: AudioNode, isBoss: boolean, isElite: boolean, isHorde: boolean): number {
    if (isBoss) {
      return this.playBossSpawn(dest);
    }
    const t = this.ctx.currentTime;
    if (isElite || isHorde) {
      // Urgent twin-pulse combat klaxon
      this.tone(dest, 'sawtooth', 220, 293.66, t, 0.16, 0.24, 0.008, 1600);
      this.tone(dest, 'sawtooth', 293.66, 349.23, t + 0.18, 0.24, 0.28, 0.008, 1800);
      return 0.45;
    }
    // Crisp energetic start chime
    this.tone(dest, 'triangle', 440, 440, t, 0.11, 0.18, 0.004);
    this.tone(dest, 'triangle', 587.33, 587.33, t + 0.085, 0.19, 0.22, 0.004);
    return 0.3;
  }

  public playBossSpawn(dest: AudioNode): number {
    const t = this.ctx.currentTime;
    // Ominous twin war-horn blasts + deep sub tremor
    const blasts = [0, 0.42];
    for (let i = 0; i < blasts.length; i++) {
      const s = t + blasts[i];
      const dur = i === 0 ? 0.36 : 0.56;
      const base = i === 0 ? 73.42 : 69.3; // D2 -> C#2 dread drop
      this.tone(dest, 'sawtooth', base, base * 0.96, s, dur, 0.32, 0.025, 620, 2.2);
      this.tone(dest, 'sawtooth', base * 1.498, base * 1.44, s, dur, 0.22, 0.03, 980, 1.8);
      this.tone(dest, 'sine', base * 0.5, base * 0.48, s, dur, 0.34, 0.02);
      this.noise(dest, true, 'lowpass', 480, 160, 1.0, s, dur * 0.8, 0.18, 0.02, true);
    }
    return 1.05;
  }

  public playWaveEnd(dest: AudioNode): number {
    const t = this.ctx.currentTime;
    // Satisfying wave-cleared warm bell resolution
    const notes = [659.25, 783.99, 1046.5];
    for (let i = 0; i < notes.length; i++) {
      const s = t + i * 0.075;
      this.tone(dest, 'triangle', notes[i], notes[i], s, 0.34, 0.20, 0.006);
      this.tone(dest, 'sine', notes[i] * 2, notes[i] * 2, s + 0.01, 0.24, 0.08, 0.006);
    }
    return 0.55;
  }

  public playHarvest(dest: AudioNode, pitchMult = 1.0): number {
    const t = this.ctx.currentTime;
    const p = clamp(pitchMult, 0.9, 1.12);
    // Bouncy coin cascade payout
    const notes = [587.33, 739.99, 880, 1174.66];
    for (let i = 0; i < notes.length; i++) {
      const f = notes[i] * p;
      this.tone(dest, 'sine', f, f * 1.04, t + i * 0.048, 0.12, 0.18, 0.003);
    }
    return 0.32;
  }

  public playShopRecycle(dest: AudioNode, pitchMult = 1.0): number {
    const t = this.ctx.currentTime;
    const p = clamp(pitchMult, 0.92, 1.1);
    // Mechanical salvage clink + crisp gold coin return
    this.noise(dest, false, 'bandpass', 2200 * p, 1200 * p, 2.2, t, 0.045, 0.16, 0.002);
    this.tone(dest, 'triangle', 680 * p, 920 * p, t + 0.02, 0.11, 0.20, 0.003);
    this.tone(dest, 'sine', 1360 * p, 1360 * p, t + 0.055, 0.13, 0.15, 0.003);
    return 0.2;
  }

  public playUiClick(kind: UiClickKind, dest: AudioNode, pitchMult = 1.0): number {
    const t = this.ctx.currentTime;
    const p = clamp(pitchMult, 0.92, 1.08);

    switch (kind) {
      case 'hover': {
        this.tone(dest, 'sine', 1320 * p, 920 * p, t, 0.026, 0.10, 0.0015);
        return 0.035;
      }
      case 'confirm': {
        this.noise(dest, false, 'bandpass', 3000 * p, 1800 * p, 2.0, t, 0.018, 0.12, 0.001);
        this.tone(dest, 'triangle', 540 * p, 820 * p, t, 0.062, 0.22, 0.002);
        return 0.075;
      }
      case 'cancel': {
        this.tone(dest, 'triangle', 460 * p, 280 * p, t, 0.068, 0.19, 0.002);
        return 0.08;
      }
      case 'buy': {
        // Mechanical cash latch + crisp twin coin ring
        this.noise(dest, false, 'highpass', 2400 * p, 1600 * p, 1.5, t, 0.024, 0.14, 0.001);
        this.tone(dest, 'triangle', 1046.5 * p, 1046.5 * p, t + 0.015, 0.085, 0.22, 0.002);
        this.tone(dest, 'sine', 1567.98 * p, 1567.98 * p, t + 0.058, 0.15, 0.22, 0.002);
        return 0.22;
      }
      case 'reroll': {
        // Tactile dice/slot-wheel triple mechanical click
        const freqs = [720, 920, 1180];
        for (let i = 0; i < freqs.length; i++) {
          const s = t + i * 0.038;
          this.noise(dest, false, 'bandpass', freqs[i] * 2.2 * p, freqs[i] * p, 2.6, s, 0.024, 0.18, 0.001);
          this.tone(dest, 'triangle', freqs[i] * p, freqs[i] * 0.72 * p, s, 0.032, 0.16, 0.0015);
        }
        return 0.16;
      }
      case 'combine': {
        // Satisfying forge-lock clunk + bright ascending upgrade triad!
        this.tone(dest, 'sine', 190 * p, 82 * p, t, 0.075, 0.28, 0.002);
        this.noise(dest, false, 'bandpass', 2400 * p, 1200 * p, 2.0, t, 0.032, 0.18, 0.001);
        const notes = [659.25, 830.61, 987.77, 1318.51];
        for (let i = 0; i < notes.length; i++) {
          const s = t + 0.035 + i * 0.042;
          this.tone(dest, 'triangle', notes[i] * p, notes[i] * p, s, i === 3 ? 0.24 : 0.1, 0.20, 0.003);
        }
        return 0.42;
      }
      case 'error': {
        // Punchy low double-buzz reject
        this.tone(dest, 'sawtooth', 165 * p, 145 * p, t, 0.075, 0.22, 0.002, 720);
        this.tone(dest, 'sawtooth', 135 * p, 112 * p, t + 0.08, 0.095, 0.24, 0.002, 680);
        return 0.19;
      }
    }
  }

  public playVictorySting(dest: AudioNode): number {
    const t = this.ctx.currentTime;
    const melody = [
      { f: 523.25, s: 0, d: 0.13 },
      { f: 659.25, s: 0.11, d: 0.13 },
      { f: 783.99, s: 0.22, d: 0.13 },
      { f: 1046.5, s: 0.34, d: 0.22 },
      { f: 987.77, s: 0.54, d: 0.14 },
      { f: 1046.5, s: 0.67, d: 0.55 },
    ];
    for (const n of melody) {
      this.tone(dest, 'triangle', n.f, n.f, t + n.s, n.d, 0.22, 0.006);
      this.tone(dest, 'sawtooth', n.f * 0.5, n.f * 0.5, t + n.s, n.d, 0.10, 0.01, 2000);
    }
    // Final sparkle chord
    this.tone(dest, 'sine', 1318.51, 1318.51, t + 0.68, 0.52, 0.14, 0.015);
    this.tone(dest, 'sine', 1567.98, 1567.98, t + 0.70, 0.50, 0.12, 0.015);
    return 1.25;
  }

  public playGameOverSting(dest: AudioNode): number {
    const t = this.ctx.currentTime;
    const descent = [
      { f: 440, s: 0, d: 0.24 },
      { f: 415.3, s: 0.22, d: 0.24 },
      { f: 392, s: 0.44, d: 0.24 },
      { f: 329.63, s: 0.66, d: 0.62 },
    ];
    for (const n of descent) {
      this.tone(dest, 'sawtooth', n.f, n.f * 0.985, t + n.s, n.d, 0.18, 0.012, 1200);
      this.tone(dest, 'triangle', n.f * 0.5, n.f * 0.495, t + n.s, n.d, 0.20, 0.012);
    }
    return 1.32;
  }

  public playBurn(dest: AudioNode, pitchMult = 1.0): number {
    const t = this.ctx.currentTime;
    const p = clamp(pitchMult, 0.85, 1.25);
    this.noise(dest, false, 'highpass', 3200 * p, 1900 * p, 1.4, t, 0.095, 0.16, 0.004);
    this.noise(dest, true, 'bandpass', 620 * p, 980 * p, 1.2, t, 0.11, 0.14, 0.008);
    return 0.12;
  }

  public playTick(dest: AudioNode, pitchMult = 1.0): number {
    const t = this.ctx.currentTime;
    const p = clamp(pitchMult, 0.9, 1.15);
    this.tone(dest, 'triangle', 1120 * p, 840 * p, t, 0.032, 0.18, 0.001);
    return 0.04;
  }

  public playStep(dest: AudioNode, pitchMult = 1.0): number {
    const t = this.ctx.currentTime;
    const p = clamp(pitchMult, 0.85, 1.2);
    this.noise(dest, true, 'lowpass', 480 * p, 180 * p, 0.9, t, 0.042, 0.12, 0.002);
    this.tone(dest, 'sine', 110 * p, 58 * p, t, 0.038, 0.10, 0.002);
    return 0.05;
  }

  public playShield(dest: AudioNode, pitchMult = 1.0): number {
    const t = this.ctx.currentTime;
    const p = clamp(pitchMult, 0.9, 1.15);
    this.tone(dest, 'sine', 640 * p, 980 * p, t, 0.12, 0.22, 0.003);
    this.tone(dest, 'triangle', 1280 * p, 1960 * p, t + 0.01, 0.11, 0.12, 0.003);
    return 0.14;
  }

  public playSpawnBegin(dest: AudioNode, pitchMult = 1.0): number {
    const t = this.ctx.currentTime;
    const p = clamp(pitchMult, 0.85, 1.2);
    this.tone(dest, 'sine', 280 * p, 520 * p, t, 0.12, 0.14, 0.01);
    return 0.14;
  }

  public playSpawnEnd(dest: AudioNode, pitchMult = 1.0): number {
    const t = this.ctx.currentTime;
    const p = clamp(pitchMult, 0.85, 1.2);
    this.tone(dest, 'triangle', 520 * p, 240 * p, t, 0.09, 0.16, 0.003);
    return 0.11;
  }

  // --------------------------------------------------------------------------
  // Dynamic Multi-State Procedural Synth Music Sequencer
  // --------------------------------------------------------------------------

  public startMusic(track: ProceduralMusicTrack): void {
    if (this.disposed) return;
    if (this.activeTrack === track && this.seqTimer !== null) return;

    this.activeTrack = track;
    this.stepIndex = 0;

    const now = this.ctx.currentTime;
    const leadIn = track === 'victory' || track === 'game_over' ? 0.55 : 0.04;
    this.nextStepTime = now + leadIn;

    // Gentle fade-in to eliminate clicks on track switch
    this.musicBus.gain.cancelScheduledValues(now);
    this.musicBus.gain.setValueAtTime(Math.max(MIN_GAIN, this.musicBus.gain.value), now);
    this.musicBus.gain.linearRampToValueAtTime(1.0, now + 0.18);

    if (this.seqTimer === null) {
      this.seqTimer = setInterval(() => this.schedulerTick(), this.lookaheadMs);
    }
    this.schedulerTick();
  }

  public stopMusic(): void {
    this.activeTrack = null;
    if (this.seqTimer !== null) {
      clearInterval(this.seqTimer);
      this.seqTimer = null;
    }
    if (!this.disposed) {
      const now = this.ctx.currentTime;
      this.musicBus.gain.cancelScheduledValues(now);
      this.musicBus.gain.setTargetAtTime(MIN_GAIN, now, 0.06);
    }
  }

  public getActiveTrack(): ProceduralMusicTrack | null {
    return this.activeTrack;
  }

  private schedulerTick(): void {
    if (this.disposed || this.activeTrack === null || this.ctx.state !== 'running') {
      return;
    }

    const pattern = TRACK_PATTERNS[this.activeTrack];
    const stepDur = 60 / pattern.bpm / 4; // 16th-note duration
    const now = this.ctx.currentTime;

    // Resync cleanly if browser backgrounded the tab so we never burst-schedule
    if (this.nextStepTime < now - 0.25) {
      this.nextStepTime = now + 0.04;
    }

    while (this.nextStepTime < now + this.scheduleAheadSec) {
      const swingOffset = this.stepIndex % 2 === 1 ? stepDur * pattern.swing : 0;
      this.scheduleStep(pattern, this.stepIndex, this.nextStepTime + swingOffset, stepDur);
      this.nextStepTime += stepDur;
      this.stepIndex = (this.stepIndex + 1) % pattern.steps;
    }
  }

  private scheduleStep(pattern: TrackPattern, step: number, time: number, stepDur: number): void {
    const dest = this.musicBus;

    // 1. Kick drum
    const kickVel = pattern.kick[step] ?? 0;
    if (kickVel > 0) {
      this.tone(dest, 'sine', 132, 36, time, 0.13, 0.34 * kickVel, 0.002);
      this.tone(dest, 'triangle', 220, 62, time, 0.032, 0.14 * kickVel, 0.001);
    }

    // 2. Snare / Rimshot
    const snareVel = pattern.snare[step] ?? 0;
    if (snareVel > 0) {
      const isSoftShop = pattern.chordStyle === 'rhodes';
      this.noise(
        dest,
        false,
        'bandpass',
        isSoftShop ? 2400 : 1900,
        isSoftShop ? 1200 : 720,
        isSoftShop ? 1.8 : 0.9,
        time,
        isSoftShop ? 0.075 : 0.115,
        (isSoftShop ? 0.15 : 0.22) * snareVel,
        0.001
      );
      this.tone(dest, 'triangle', isSoftShop ? 260 : 195, 110, time, 0.06, 0.14 * snareVel, 0.001);
    }

    // 3. Hi-hat
    const hatVel = pattern.hat[step] ?? 0;
    if (hatVel > 0) {
      this.noise(dest, false, 'highpass', 7200, 6200, 1.2, time, 0.036, 0.075 * hatVel, 0.001);
    }

    // 4. Optional tribal/pitched percussion (Zone 2 Primal Jungle & surf-tom fills)
    if (pattern.perc) {
      const percMidi = pattern.perc[step] ?? 0;
      if (percMidi > 0) {
        const pf = midiToFreq(percMidi);
        this.tone(dest, 'triangle', pf * 1.24, pf * 0.82, time, 0.095, 0.17, 0.002);
        this.noise(dest, true, 'bandpass', pf * 3.5, pf * 1.6, 1.8, time, 0.025, 0.06, 0.001);
      }
    }

    // 4b. Rhythmic woody marimba ostinato (Zone 2 Primal Jungle)
    if (pattern.marimba) {
      const mMidi = pattern.marimba[step];
      if (mMidi !== null && mMidi !== undefined) {
        const mf = midiToFreq(mMidi);
        this.tone(dest, 'sine', mf, mf, time, stepDur * 1.35, 0.135, 0.002);
        this.tone(dest, 'triangle', mf * 4, mf * 3.96, time, 0.026, 0.055, 0.001, 4200);
      }
    }

    // 4c. Deep-sea pulsing resonant sonar ping with liquid echo tail (Zone 1 Abyssal Trench)
    if (pattern.sonar) {
      const sMidi = pattern.sonar[step];
      if (sMidi !== null && sMidi !== undefined) {
        const sf = midiToFreq(sMidi);
        this.tone(dest, 'sine', sf, sf * 0.996, time, stepDur * 3.8, 0.11, 0.006, 2600, 2.5);
        this.tone(dest, 'sine', sf * 2, sf * 1.99, time + 0.004, stepDur * 2.1, 0.038, 0.004, 3400);
        // Submerged sonar echo pings
        this.tone(dest, 'sine', sf, sf * 0.995, time + stepDur * 3, stepDur * 2.8, 0.052, 0.01, 1800, 2.0);
        this.tone(dest, 'sine', sf, sf * 0.994, time + stepDur * 6, stepDur * 2.2, 0.024, 0.012, 1300, 1.8);
      }
    }

    // 5. Bassline (with optional double-time sub-octave reinforcement for Abyss / Elite / Boss)
    const bassMidi = pattern.bass[step];
    if (bassMidi !== null && bassMidi !== undefined) {
      const bf = midiToFreq(bassMidi);
      const isSustained = pattern.bass[(step + 1) % pattern.steps] === null;
      const dur = isSustained ? stepDur * 1.85 : stepDur * 0.88;
      this.tone(
        dest,
        pattern.bassType,
        bf,
        bf,
        time,
        dur,
        pattern.bassType === 'sawtooth' ? 0.175 : 0.24,
        0.004,
        pattern.bassFilterHz,
        pattern.doubleTimeSub ? 2.1 : 1.6
      );
      if (pattern.doubleTimeSub) {
        // Deep punchy sub-bass lock + crisp double-time drive
        const subFreq = bf >= 64 ? bf * 0.5 : bf;
        this.tone(dest, 'sine', subFreq, subFreq * 0.985, time, stepDur * 0.92, 0.16, 0.003, 260);
      }
    }

    // 6. Lead melody (biome-styled articulation: surf twang, sonar glass, jungle wood, boss shred)
    const leadMidi = pattern.lead[step];
    if (leadMidi !== null && leadMidi !== undefined) {
      const lf = midiToFreq(leadMidi);
      const style = pattern.leadStyle ?? 'default';
      if (style === 'surf') {
        // Twangy alien surf-synth pluck + slapback echo!
        this.tone(dest, 'sawtooth', lf * 1.012, lf, time, stepDur * 1.35, 0.11, 0.003, pattern.leadFilterHz, 1.8);
        this.tone(dest, 'square', lf * 0.994, lf, time, stepDur * 1.1, 0.055, 0.003, pattern.leadFilterHz * 0.85, 1.2);
        this.tone(dest, 'triangle', lf, lf, time + stepDur * 1.5, stepDur * 0.9, 0.042, 0.004, 1900, 1.0);
      } else if (style === 'sonar') {
        // Liquid resonant underwater synth lead
        this.tone(dest, 'triangle', lf, lf, time, stepDur * 2.1, 0.125, 0.015, pattern.leadFilterHz, 2.0);
        this.tone(dest, 'sine', lf * 2, lf * 2, time + 0.01, stepDur * 1.5, 0.04, 0.02, 2400, 1.0);
      } else if (style === 'marimba') {
        // Punchy tribal wood-synth lead
        this.tone(dest, 'square', lf * 1.008, lf, time, stepDur * 1.25, 0.09, 0.003, pattern.leadFilterHz, 1.4);
        this.tone(dest, 'sine', lf, lf, time, stepDur * 1.45, 0.085, 0.002);
      } else if (style === 'shred') {
        // Cutting dual-detuned elite/boss shred lead
        this.tone(dest, 'sawtooth', lf * 1.005, lf, time, stepDur * 1.3, 0.105, 0.003, pattern.leadFilterHz, 1.6);
        this.tone(dest, 'sawtooth', lf * 0.995, lf, time, stepDur * 1.3, 0.085, 0.003, pattern.leadFilterHz * 0.9, 1.4);
      } else {
        const dur = stepDur * 1.65;
        this.tone(
          dest,
          pattern.leadType,
          lf,
          lf,
          time,
          dur,
          pattern.leadType === 'sine' ? 0.14 : 0.115,
          0.006,
          pattern.leadFilterHz,
          1.1
        );
      }
    }

    // 6b. Dramatic alarm brass stabs (Elite & Boss waves)
    const brass = pattern.brassStabs?.[step];
    if (brass && brass.length > 0) {
      const stabDur = stepDur * 2.2;
      for (let i = 0; i < brass.length; i++) {
        const bf = midiToFreq(brass[i]);
        // Twin detuned sawtooth brass voices with aggressive filter bite
        this.tone(dest, 'sawtooth', bf * 1.007, bf, time, stabDur, 0.068, 0.012, 2400, 2.4);
        this.tone(dest, 'sawtooth', bf * 0.993, bf, time, stabDur, 0.062, 0.014, 1950, 2.0);
      }
    }

    // 7. Chords (pad / warm Rhodes / synthwave stabs)
    const chord = pattern.chords[step];
    if (chord && chord.length > 0) {
      const dur =
        pattern.chordStyle === 'pad'
          ? stepDur * 7.8
          : pattern.chordStyle === 'rhodes'
            ? stepDur * 6.5
            : stepDur * 2.4;
      const gainPerNote =
        pattern.chordStyle === 'pad'
          ? 0.055
          : pattern.chordStyle === 'rhodes'
            ? 0.078
            : 0.065;
      const oscType: OscillatorType =
        pattern.chordStyle === 'rhodes'
          ? 'triangle'
          : pattern.chordStyle === 'pad'
            ? 'sine'
            : 'sawtooth';
      const atk = pattern.chordStyle === 'pad' ? 0.12 : 0.012;
      const fltHz = pattern.chordStyle === 'rhodes' ? 1600 : pattern.chordStyle === 'pad' ? 1300 : 1850;

      for (let i = 0; i < chord.length; i++) {
        const cf = midiToFreq(chord[i]);
        const noteStart = pattern.chordStyle === 'rhodes' ? time + i * 0.014 : time;
        this.tone(dest, oscType, cf, cf, noteStart, dur, gainPerNote, atk, fltHz, 0.8);
      }
    }

    // 8. Shimmering arpeggio layer
    if (pattern.arp) {
      const arpMidi = pattern.arp[step];
      if (arpMidi !== null && arpMidi !== undefined) {
        const af = midiToFreq(arpMidi);
        this.tone(dest, 'triangle', af, af, time, stepDur * 0.78, 0.055, 0.003, 2900);
      }
    }
  }

  public dispose(): void {
    this.disposed = true;
    this.stopMusic();
    try {
      this.musicBus.disconnect();
    } catch {
      // Ignore already disconnected node
    }
  }
}
