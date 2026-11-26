// ============================================================================
// src/sim/hash.ts — Deterministic FNV-1a 32-bit state hash for replay/parity
// ============================================================================

import type { SimState } from '../contracts/index';

const FNV_OFFSET_BASIS = 0x811c9dc5;
const FNV_PRIME = 0x01000193;

function hashByte(h: number, b: number): number {
  return Math.imul((h ^ (b & 0xff)) >>> 0, FNV_PRIME) >>> 0;
}

function hashInt(h: number, n: number): number {
  const v = (n | 0) >>> 0;
  h = hashByte(h, v & 0xff);
  h = hashByte(h, (v >>> 8) & 0xff);
  h = hashByte(h, (v >>> 16) & 0xff);
  h = hashByte(h, (v >>> 24) & 0xff);
  return h;
}

function hashFloat(h: number, f: number): number {
  if (!Number.isFinite(f)) return hashInt(h, 0x7fffffff);
  // Quantize to 0.001 precision (eliminates -0/+0 and minor sub-ULP drift)
  const q = Math.round(f * 1000);
  return hashInt(h, q === 0 ? 0 : q);
}

function hashStr(h: number, s: string): number {
  h = hashInt(h, s.length);
  for (let i = 0; i < s.length; i++) {
    h = hashByte(h, s.charCodeAt(i) & 0xff);
  }
  return h;
}

/**
 * Computes a deterministic FNV-1a 32-bit hex hash over all gameplay-relevant
 * fields of `SimState`.
 */
export function hashSimState(state: SimState): string {
  let h = FNV_OFFSET_BASIS;

  // Global wave/clock state
  h = hashInt(h, state.tick);
  h = hashInt(h, state.rngState);
  h = hashInt(h, state.wave);
  h = hashStr(h, state.screen);
  h = hashInt(h, state.zoneId);
  h = hashInt(h, state.dangerLevel);
  h = hashInt(h, state.waveElapsedTicks);
  h = hashInt(h, state.waveDurationTicks);
  h = hashInt(h, state.isEndless ? 1 : 0);

  // Player state
  const p = state.player;
  h = hashFloat(h, p.x);
  h = hashFloat(h, p.y);
  h = hashFloat(h, p.hp);
  h = hashFloat(h, p.maxHp);
  h = hashFloat(h, p.xp);
  h = hashInt(h, p.level);
  h = hashInt(h, p.pendingLevelUps);
  h = hashInt(h, p.materials);
  h = hashInt(h, p.bonusGold);
  h = hashStr(h, p.characterId);

  // Player weapons
  h = hashInt(h, p.weapons.length);
  for (let i = 0; i < p.weapons.length; i++) {
    const w = p.weapons[i];
    h = hashInt(h, w.uid);
    h = hashStr(h, w.weaponId);
    h = hashInt(h, w.tier);
    h = hashInt(h, w.cooldownTicks);
    h = hashInt(h, w.killsThisRun);
  }

  // Player items
  h = hashInt(h, p.items.length);
  for (let i = 0; i < p.items.length; i++) {
    h = hashStr(h, p.items[i]);
  }

  // Enemies
  h = hashInt(h, state.enemies.length);
  for (let i = 0; i < state.enemies.length; i++) {
    const e = state.enemies[i];
    h = hashInt(h, e.uid);
    h = hashStr(h, e.defId);
    h = hashFloat(h, e.x);
    h = hashFloat(h, e.y);
    h = hashFloat(h, e.hp);
    h = hashInt(h, e.phase);
    h = hashStr(h, e.state);
  }

  // Projectiles
  h = hashInt(h, state.projectiles.length);
  for (let i = 0; i < state.projectiles.length; i++) {
    const pr = state.projectiles[i];
    h = hashInt(h, pr.uid);
    h = hashStr(h, pr.owner);
    h = hashFloat(h, pr.x);
    h = hashFloat(h, pr.y);
    h = hashFloat(h, pr.damage);
  }

  // Pickups
  h = hashInt(h, state.pickups.length);
  for (let i = 0; i < state.pickups.length; i++) {
    const pk = state.pickups[i];
    h = hashInt(h, pk.uid);
    h = hashStr(h, pk.kind);
    h = hashFloat(h, pk.x);
    h = hashFloat(h, pk.y);
    h = hashInt(h, pk.value);
    h = hashInt(h, pk.isBagBoosted ? 1 : 0);
  }

  // Structures
  h = hashInt(h, state.structures.length);
  for (let i = 0; i < state.structures.length; i++) {
    const st = state.structures[i];
    h = hashInt(h, st.uid);
    h = hashStr(h, st.kind);
    h = hashFloat(h, st.x);
    h = hashFloat(h, st.y);
    h = hashInt(h, st.cooldownTicks);
  }

  // Trees, Telegraphs, Hazards (counts + key fields)
  h = hashInt(h, state.trees.length);
  for (let i = 0; i < state.trees.length; i++) {
    const tr = state.trees[i];
    h = hashInt(h, tr.uid);
    h = hashFloat(h, tr.hp);
  }
  h = hashInt(h, state.telegraphs.length);
  h = hashInt(h, state.hazards.length);

  // Camera
  const c = state.camera;
  h = hashFloat(h, c.x);
  h = hashFloat(h, c.y);
  h = hashFloat(h, c.shakeTrauma);
  h = hashFloat(h, c.zoom);

  // Run stats
  const rs = state.runStats;
  h = hashInt(h, rs.kills);
  h = hashInt(h, rs.elitesKilled);
  h = hashInt(h, rs.bossesKilled);
  h = hashFloat(h, rs.damageDealt);
  h = hashFloat(h, rs.damageTaken);
  h = hashInt(h, rs.materialsCollected);
  h = hashInt(h, rs.cratesOpened);
  h = hashInt(h, rs.treesChopped);
  h = hashInt(h, rs.critsLanded);
  h = hashInt(h, rs.dodges);
  h = hashInt(h, rs.waveReached);
  h = hashInt(h, rs.ticksPlayed);

  return (h >>> 0).toString(16).padStart(8, '0');
}
