// ============================================================================
// src/audio/index.ts — Audio Module Barrel
// ============================================================================

import { AudioEngine } from './AudioEngine';
import {
  ProceduralSynth,
  type ProceduralMusicTrack,
  type UiClickKind,
} from './ProceduralSynth';

export { AudioEngine, ProceduralSynth };
export type { ProceduralMusicTrack, UiClickKind };

export function createAudioEngine(): AudioEngine {
  return new AudioEngine();
}
