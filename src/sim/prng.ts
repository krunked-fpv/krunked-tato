// ============================================================================
// src/sim/prng.ts — Deterministic Mulberry32 PRNG operating on SimState.rngState
// ============================================================================

import type { SimState } from '../contracts/index';

/**
 * Normalizes any numeric seed into an unsigned 32-bit integer.
 */
export function normalizeSeed(seed: number): number {
  const s = (Math.floor(seed) >>> 0);
  return s === 0 ? 0x9e3779b9 : s;
}

/**
 * Advances `state.rngState` using Mulberry32 and returns a deterministic
 * floating-point number in the half-open interval [0, 1).
 */
export function nextRand(state: SimState): number {
  let t = (state.rngState = (state.rngState + 0x6d2b79f5) >>> 0);
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

/**
 * Returns a deterministic float in [min, max).
 */
export function randRange(state: SimState, min: number, max: number): number {
  if (max <= min) return min;
  return min + nextRand(state) * (max - min);
}

/**
 * Returns a deterministic integer in the closed interval [min, max].
 */
export function randInt(state: SimState, min: number, max: number): number {
  const lo = Math.ceil(min);
  const hi = Math.floor(max);
  if (hi <= lo) return lo;
  return lo + Math.floor(nextRand(state) * (hi - lo + 1));
}

/**
 * Selects a deterministic element from a non-empty array, or undefined if empty.
 */
export function randChoice<T>(state: SimState, arr: readonly T[]): T | undefined {
  if (arr.length === 0) return undefined;
  return arr[Math.floor(nextRand(state) * arr.length)];
}

/**
 * Creates a bound `() => number` RNG closure that mutates `state.rngState`.
 */
export function createRngFn(state: SimState): () => number {
  return () => nextRand(state);
}

/**
 * Deterministically allocates the next unique entity UID on `SimState`.
 */
export function allocUid(state: SimState): number {
  const uid = state.nextUid;
  state.nextUid = uid + 1;
  return uid;
}
