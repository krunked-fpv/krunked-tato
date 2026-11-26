// ============================================================================
// src/sim/bosses.ts — Wave-20 Boss Choreography (Predator & Invoker + Double Boss)
// ============================================================================

import {
  ARENA_H,
  ARENA_W,
  FIXED_DT,
  MAX_ENEMIES,
  PLAYABLE_MAX_X,
  PLAYABLE_MAX_Y,
  PLAYABLE_MIN_X,
  PLAYABLE_MIN_Y,
  SPAWN_TELEGRAPH_TICKS,
  type EnemyState,
  type GameDataCatalog,
  type SimState,
} from '../contracts/index';
import { spawnEnemyProjectile } from './combat';
import { fireEnemyRadialRing } from './enemies';
import { allocUid, randRange } from './prng';
import { clamp } from './stats';

/**
 * Updates Boss phase transitions (Phase 2 at 65% HP, Phase 3 at 35% HP).
 */
function updateBossPhase(state: SimState, boss: EnemyState): void {
  const hpFrac = boss.hp / Math.max(1, boss.maxHp);
  const targetPhase = hpFrac <= 0.35 ? 3 : hpFrac <= 0.65 ? 2 : 1;
  if (targetPhase > boss.phase) {
    boss.phase = targetPhase;
    boss.state = 'enraged';
    boss.stateTimer = 20;
    boss.attackCooldown = Math.min(boss.attackCooldown, 28);
    state.camera.shakeTrauma = Math.min(1, state.camera.shakeTrauma + 0.45);
    state.events.push({
      type: 'explosion',
      x: boss.x,
      y: boss.y,
      radius: 145,
      color: targetPhase === 3 ? '#ff2442' : '#ff8c24',
    });
  }
}

/**
 * Detects whether a partner boss is currently alive for Danger 5/6 Double Boss coordination.
 */
function getPartnerBoss(state: SimState, selfUid: number): EnemyState | null {
  for (let i = 0; i < state.enemies.length; i++) {
    const e = state.enemies[i];
    if (e.kind === 'boss' && e.hp > 0 && e.uid !== selfUid) {
      return e;
    }
  }
  return null;
}

/**
 * Checks whether active lethal enemy beam lanes are currently telegraphing/firing
 * so Double Boss partners avoid stacking cheap inescapable overlaps.
 */
function hasActiveLethalBossBeams(state: SimState): boolean {
  for (let i = 0; i < state.hazards.length; i++) {
    const hz = state.hazards[i];
    if (hz.owner === 'enemy' && hz.kind === 'boss_beam' && hz.damage > 0) {
      return true;
    }
  }
  return false;
}

/**
 * `boss_predator`: Apex hunter with telegraphed high-speed multi-dash charges,
 * staggered radial projectile nova rings, slam shockwaves, and Phase 2/3 combos.
 */
function stepPredator(
  state: SimState,
  boss: EnemyState,
  partner: EnemyState | null,
): void {
  const player = state.player;
  const phase = boss.phase;
  const effDmg = Math.max(1, Math.round(boss.damage * boss.buffDmgMult));
  const effSpeed = boss.speed * (phase === 3 ? 1.24 : phase === 2 ? 1.12 : 1.0);
  const doubleScale = partner ? 0.78 : 1.0;

  const toX = player.x - boss.x;
  const toY = player.y - boss.y;
  const dist = Math.hypot(toX, toY) || 1;
  const dirX = toX / dist;
  const dirY = toY / dist;
  const aimAngle = Math.atan2(dirY, dirX);

  // Brief phase-shift roar pause followed by readable shockwave nova
  if (boss.state === 'enraged') {
    boss.vx *= 0.78;
    boss.vy *= 0.78;
    boss.stateTimer -= 1;
    if (boss.stateTimer <= 0) {
      fireEnemyRadialRing(
        state,
        boss.x,
        boss.y,
        Math.max(8, Math.round((phase === 3 ? 16 : 12) * doubleScale)),
        310,
        effDmg,
        aimAngle,
        9,
        220,
        phase === 3 ? '#ff2442' : '#ff6a33',
      );
      boss.state = 'move';
    }
    return;
  }

  if (boss.state === 'windup') {
    boss.vx *= 0.68;
    boss.vy *= 0.68;
    boss.stateTimer -= 1;

    if (boss.stateTimer <= 0) {
      const pattern = (boss.patternIndex % 100) % 3;
      if (pattern === 0) {
        // Multi-dash lunge
        const dx = boss.targetX - boss.x;
        const dy = boss.targetY - boss.y;
        const dLen = Math.hypot(dx, dy) || 1;
        const dashSpd = phase === 3 ? 980 : phase === 2 ? 880 : 780;
        boss.vx = (dx / dLen) * dashSpd;
        boss.vy = (dy / dLen) * dashSpd;
        boss.state = 'dash';
        boss.stateTimer = 24;
      } else if (pattern === 1) {
        // Staggered radial projectile nova rings
        const count = Math.max(8, Math.round((phase === 3 ? 18 : phase === 2 ? 14 : 12) * doubleScale));
        fireEnemyRadialRing(state, boss.x, boss.y, count, 325, effDmg, aimAngle, 9, 220, '#ff335c');
        boss.state = 'attack';
        boss.stateTimer = 18;
      } else {
        // Shockwave slam impact + Phase 3 secondary outer shockwave ring
        const count = Math.max(6, Math.round((phase === 3 ? 14 : 10) * doubleScale));
        fireEnemyRadialRing(state, boss.x, boss.y, count, 285, effDmg, aimAngle + 0.25, 10, 200, '#ff5533');
        state.camera.shakeTrauma = Math.min(1, state.camera.shakeTrauma + 0.35);
        if (phase === 3 && !partner) {
          state.hazards.push({
            uid: allocUid(state),
            kind: 'boss_ring',
            owner: 'enemy',
            x: boss.x,
            y: boss.y,
            endX: boss.x,
            endY: boss.y,
            angle: 0,
            arcSpan: Math.PI * 2,
            radius: 340,
            damage: effDmg,
            ticksLeft: 14,
            maxTicks: 14,
            activeDelayTicks: 30,
            color: '#ff2947',
            hitPlayer: false,
          });
        }
        boss.state = 'recover';
        boss.stateTimer = 28;
        boss.patternIndex = (boss.patternIndex % 100) + 1;
        boss.attackCooldown = partner ? (phase === 3 ? 72 : 96) : phase === 3 ? 48 : phase === 2 ? 64 : 84;
      }
    }
    return;
  }

  if (boss.state === 'dash') {
    boss.stateTimer -= 1;
    // Emit crisp perpendicular razor spikes while dashing in P2/P3
    if (phase >= 2 && boss.stateTimer % 7 === 0) {
      const perp = Math.atan2(boss.vy, boss.vx) + Math.PI / 2;
      spawnEnemyProjectile(state, boss.x, boss.y, Math.cos(perp) * 260, Math.sin(perp) * 260, 8, effDmg, 150, '#ff3b66');
      spawnEnemyProjectile(state, boss.x, boss.y, -Math.cos(perp) * 260, -Math.sin(perp) * 260, 8, effDmg, 150, '#ff3b66');
    }
    if (boss.stateTimer <= 0) {
      // Chain multiple dashes based on phase (capped at 2 during Double Boss for fair breathing room)
      const chainCap = partner ? (phase >= 2 ? 2 : 1) : phase === 3 ? 3 : phase === 2 ? 2 : 1;
      const chainDone = Math.floor(boss.patternIndex / 100) + 1;
      if (chainDone < chainCap) {
        boss.patternIndex = (boss.patternIndex % 100) + chainDone * 100;
        boss.state = 'windup';
        boss.stateTimer = (phase === 3 ? 22 : 28) + (partner ? 6 : 0);
        boss.targetX = player.x;
        boss.targetY = player.y;
        const dx = player.x - boss.x;
        const dy = player.y - boss.y;
        const len = Math.hypot(dx, dy) || 1;
        state.hazards.push({
          uid: allocUid(state),
          kind: 'boss_beam',
          owner: 'enemy',
          x: boss.x,
          y: boss.y,
          endX: clamp(boss.x + (dx / len) * 540, PLAYABLE_MIN_X + 16, PLAYABLE_MAX_X - 16),
          endY: clamp(boss.y + (dy / len) * 540, PLAYABLE_MIN_Y + 16, PLAYABLE_MAX_Y - 16),
          angle: Math.atan2(dy, dx),
          arcSpan: 0,
          radius: 22,
          damage: 0,
          ticksLeft: 2,
          maxTicks: boss.stateTimer,
          activeDelayTicks: boss.stateTimer,
          color: '#ff2b4a',
          hitPlayer: true,
        });
      } else {
        // End of dash chain -> radial burst & advance pattern
        fireEnemyRadialRing(
          state,
          boss.x,
          boss.y,
          Math.max(6, Math.round((phase === 3 ? 12 : 10) * doubleScale)),
          290,
          effDmg,
          aimAngle,
          8,
          190,
          '#ff335c',
        );
        boss.patternIndex = (boss.patternIndex % 100) + 1;
        boss.state = 'recover';
        boss.stateTimer = phase === 3 ? 22 : 30;
        boss.attackCooldown = partner ? (phase === 3 ? 70 : 94) : phase === 3 ? 46 : phase === 2 ? 62 : 82;
      }
    }
    return;
  }

  if (boss.state === 'attack') {
    boss.vx *= 0.8;
    boss.vy *= 0.8;
    boss.stateTimer -= 1;
    if (boss.stateTimer <= 0) {
      // Staggered half-phase offset nova ring (and third wave in solo P3)
      const count = Math.max(8, Math.round((phase === 3 ? 18 : phase === 2 ? 14 : 12) * doubleScale));
      const halfStep = Math.PI / count;
      const wavesDone = Math.floor(boss.patternIndex / 100) + 1;
      fireEnemyRadialRing(
        state,
        boss.x,
        boss.y,
        count,
        wavesDone === 1 ? 370 : 410,
        effDmg,
        aimAngle + (wavesDone === 1 ? halfStep : 0),
        9,
        220,
        wavesDone === 1 ? '#ff6640' : '#ff2442',
      );
      if (phase === 3 && !partner && wavesDone < 2) {
        boss.patternIndex = (boss.patternIndex % 100) + wavesDone * 100;
        boss.stateTimer = 16;
      } else {
        boss.patternIndex = (boss.patternIndex % 100) + 1;
        boss.state = 'recover';
        boss.stateTimer = 24;
        boss.attackCooldown = partner ? (phase === 3 ? 66 : 90) : phase === 3 ? 44 : phase === 2 ? 60 : 78;
      }
    }
    return;
  }

  if (boss.state === 'recover') {
    boss.vx *= 0.82;
    boss.vy *= 0.82;
    boss.stateTimer -= 1;
    if (boss.stateTimer <= 0) boss.state = 'move';
    return;
  }

  // Aggressive stalk movement
  boss.vx = dirX * effSpeed;
  boss.vy = dirY * effSpeed;

  // Double Boss fairness: pause briefly before dashing if Invoker's beam lanes are currently active
  if (boss.attackCooldown <= 0 && partner && hasActiveLethalBossBeams(state)) {
    boss.attackCooldown = 20;
    return;
  }

  if (boss.attackCooldown <= 0) {
    const pattern = (boss.patternIndex % 100) % 3;
    boss.state = 'windup';
    boss.targetX = player.x;
    boss.targetY = player.y;

    if (pattern === 0) {
      // Dash windup + lane telegraph
      boss.stateTimer = (phase === 3 ? 28 : phase === 2 ? 34 : 42) + (partner ? 6 : 0);
      state.hazards.push({
        uid: allocUid(state),
        kind: 'boss_beam',
        owner: 'enemy',
        x: boss.x,
        y: boss.y,
        endX: clamp(boss.x + dirX * 560, PLAYABLE_MIN_X + 16, PLAYABLE_MAX_X - 16),
        endY: clamp(boss.y + dirY * 560, PLAYABLE_MIN_Y + 16, PLAYABLE_MAX_Y - 16),
        angle: aimAngle,
        arcSpan: 0,
        radius: 24,
        damage: 0,
        ticksLeft: 2,
        maxTicks: boss.stateTimer,
        activeDelayTicks: boss.stateTimer,
        color: '#ff2b4a',
        hitPlayer: true,
      });
    } else if (pattern === 1) {
      // Ring burst windup
      boss.stateTimer = phase === 3 ? 24 : 32;
    } else {
      // Shockwave slam telegraph
      boss.stateTimer = phase === 3 ? 34 : 42;
      state.hazards.push({
        uid: allocUid(state),
        kind: 'boss_ring',
        owner: 'enemy',
        x: boss.x,
        y: boss.y,
        endX: boss.x,
        endY: boss.y,
        angle: 0,
        arcSpan: Math.PI * 2,
        radius: phase === 3 ? 275 : phase === 2 ? 245 : 210,
        damage: effDmg,
        ticksLeft: 16,
        maxTicks: 16,
        activeDelayTicks: boss.stateTimer,
        color: '#ff4f33',
        hitPlayer: false,
      });
    }
  }
}

/**
 * `boss_invoker`: Arcane obsidian bullet-hell construct with rotating spiral rings,
 * telegraphed cardinal/diagonal lane beams (`boss_beam` / `boss_ring`), orb zones,
 * and periodic minion summons with Phase 2/3 density escalation.
 */
function stepInvoker(
  state: SimState,
  boss: EnemyState,
  partner: EnemyState | null,
): void {
  const player = state.player;
  const phase = boss.phase;
  const effDmg = Math.max(1, Math.round(boss.damage * boss.buffDmgMult));
  const effSpeed = boss.speed * (phase === 3 ? 1.2 : phase === 2 ? 1.1 : 1.0);

  // Stagger initial pattern index cleanly on Double Boss spawn so Predator & Invoker open out-of-phase
  if (boss.ageTicks === 1 && partner) {
    boss.patternIndex = 1;
    boss.attackCooldown = Math.max(boss.attackCooldown, 95);
  }

  const centerX = ARENA_W * 0.5;
  const centerY = ARENA_H * 0.5;
  const toPlayerX = player.x - boss.x;
  const toPlayerY = player.y - boss.y;
  const distP = Math.hypot(toPlayerX, toPlayerY) || 1;
  const dirPX = toPlayerX / distP;
  const dirPY = toPlayerY / distP;

  if (boss.state === 'enraged') {
    boss.vx *= 0.8;
    boss.vy *= 0.8;
    boss.stateTimer -= 1;
    if (boss.stateTimer <= 0) {
      fireEnemyRadialRing(
        state,
        boss.x,
        boss.y,
        partner ? 12 : phase === 3 ? 18 : 14,
        280,
        effDmg,
        0,
        9,
        230,
        '#e042ff',
      );
      boss.state = 'move';
    }
    return;
  }

  // Channeling rotating bullet-hell spiral
  if (boss.state === 'attack') {
    boss.vx *= 0.85;
    boss.vy *= 0.85;
    boss.stateTimer -= 1;

    const fireEvery = partner ? (phase === 3 ? 8 : 10) : phase === 3 ? 6 : phase === 2 ? 7 : 8;
    if (boss.stateTimer % fireEvery === 0) {
      const arms = partner ? (phase >= 3 ? 4 : 3) : phase === 3 ? 5 : phase === 2 ? 4 : 3;
      const spinDir = phase === 3 && Math.floor(boss.stateTimer / 30) % 2 === 0 ? -1 : 1;
      const baseAngle = boss.ageTicks * 0.085 * spinDir;
      const spd = phase === 3 ? 315 : 285;
      for (let a = 0; a < arms; a++) {
        const ang = baseAngle + (a / arms) * Math.PI * 2;
        spawnEnemyProjectile(
          state,
          boss.x + Math.cos(ang) * 24,
          boss.y + Math.sin(ang) * 24,
          Math.cos(ang) * spd,
          Math.sin(ang) * spd,
          8,
          effDmg,
          240,
          '#e33bff',
          'proj_enemy',
        );
      }
    }

    if (boss.stateTimer <= 0) {
      boss.state = 'recover';
      boss.stateTimer = 28;
      boss.patternIndex += 1;
      boss.attackCooldown = partner ? (phase === 3 ? 78 : 102) : phase === 3 ? 52 : phase === 2 ? 68 : 88;
    }
    return;
  }

  if (boss.state === 'recover') {
    boss.vx *= 0.85;
    boss.vy *= 0.85;
    boss.stateTimer -= 1;
    if (boss.stateTimer <= 0) boss.state = 'move';
    return;
  }

  // Smooth gliding orbit around mid-range while drifting gently near arena interior
  let moveX = 0;
  let moveY = 0;
  if (distP < 245) {
    moveX = -dirPX;
    moveY = -dirPY;
  } else if (distP > 445) {
    moveX = dirPX;
    moveY = dirPY;
  } else {
    moveX = -dirPY * 0.85 + (centerX - boss.x) * 0.0012;
    moveY = dirPX * 0.85 + (centerY - boss.y) * 0.0012;
  }
  const mLen = Math.hypot(moveX, moveY) || 1;
  boss.vx = (moveX / mLen) * effSpeed;
  boss.vy = (moveY / mLen) * effSpeed;

  // Double Boss fairness coordination: wait if Predator is mid-windup or mid-dash
  if (boss.attackCooldown <= 0 && partner && (partner.state === 'dash' || partner.state === 'windup')) {
    boss.attackCooldown = 24;
    return;
  }

  if (boss.attackCooldown <= 0) {
    const pattern = boss.patternIndex % 4;
    if (pattern === 0) {
      // Pattern 0: Rotating bullet-hell spiral rings
      boss.state = 'attack';
      boss.stateTimer = partner ? (phase === 3 ? 84 : 70) : phase === 3 ? 114 : phase === 2 ? 100 : 88;
    } else if (pattern === 1) {
      // Pattern 1: Telegraphed cardinal/diagonal lane beams + arcane boundary ring
      const lanes = partner ? 4 : phase === 3 ? 8 : phase === 2 ? 6 : 4;
      const offset = boss.patternIndex % 8 < 4 ? 0 : Math.PI / 4;
      const delay = (phase === 3 ? 44 : 52) + (partner ? 6 : 0);
      for (let k = 0; k < lanes; k++) {
        const a = offset + (k / lanes) * Math.PI * 2;
        state.hazards.push({
          uid: allocUid(state),
          kind: 'boss_beam',
          owner: 'enemy',
          x: boss.x,
          y: boss.y,
          endX: clamp(boss.x + Math.cos(a) * 1200, PLAYABLE_MIN_X + 16, PLAYABLE_MAX_X - 16),
          endY: clamp(boss.y + Math.sin(a) * 1200, PLAYABLE_MIN_Y + 16, PLAYABLE_MAX_Y - 16),
          angle: a,
          arcSpan: 0,
          radius: 20,
          damage: effDmg,
          ticksLeft: 24,
          maxTicks: 24,
          activeDelayTicks: delay,
          color: '#ff2e7e',
          hitPlayer: false,
        });
      }
      // Companion arcane ring pulse at mid-radius
      state.hazards.push({
        uid: allocUid(state),
        kind: 'boss_ring',
        owner: 'enemy',
        x: boss.x,
        y: boss.y,
        endX: boss.x,
        endY: boss.y,
        angle: 0,
        arcSpan: Math.PI * 2,
        radius: phase === 3 ? 250 : 200,
        damage: effDmg,
        ticksLeft: 16,
        maxTicks: 16,
        activeDelayTicks: delay,
        color: '#d93bff',
        hitPlayer: false,
      });
      boss.patternIndex += 1;
      boss.attackCooldown = partner ? (phase === 3 ? 90 : 112) : phase === 3 ? 64 : 84;
    } else if (pattern === 2) {
      // Pattern 2: Pulsing arcane orb detonation zones with a guaranteed navigable gap
      const zoneCount = partner ? (phase >= 2 ? 4 : 3) : phase === 3 ? 6 : phase === 2 ? 5 : 3;
      const delay = (phase === 3 ? 46 : 54) + (partner ? 6 : 0);
      const escapeGapAngle = boss.ageTicks * 0.05;
      for (let z = 0; z < zoneCount; z++) {
        // Leave an open 70-degree wedge around escapeGapAngle so the player always has a clean lane
        const arcFrac = zoneCount > 1 ? z / (zoneCount - 1) : 0.5;
        const ang = escapeGapAngle + 0.62 + arcFrac * (Math.PI * 2 - 1.24);
        const rDist = z === 0 ? 0 : randRange(state, 145, 265);
        const zx = clamp(player.x + Math.cos(ang) * rDist, PLAYABLE_MIN_X + 90, PLAYABLE_MAX_X - 90);
        const zy = clamp(player.y + Math.sin(ang) * rDist, PLAYABLE_MIN_Y + 90, PLAYABLE_MAX_Y - 90);
        state.hazards.push({
          uid: allocUid(state),
          kind: 'boss_orb_zone',
          owner: 'enemy',
          x: zx,
          y: zy,
          endX: zx,
          endY: zy,
          angle: 0,
          arcSpan: Math.PI * 2,
          radius: 84,
          damage: effDmg,
          ticksLeft: 18,
          maxTicks: 18,
          activeDelayTicks: delay,
          color: '#c93bff',
          hitPlayer: false,
        });
      }
      boss.patternIndex += 1;
      boss.attackCooldown = partner ? (phase === 3 ? 86 : 108) : phase === 3 ? 60 : 80;
    } else {
      // Pattern 3: Telegraphed minion summons + defensive ring
      const summonCount = partner ? 2 : phase === 3 ? 4 : 3;
      for (let s = 0; s < summonCount; s++) {
        if (state.enemies.length + state.telegraphs.length >= MAX_ENEMIES) break;
        const ang = (s / summonCount) * Math.PI * 2 + boss.ageTicks * 0.05;
        const sx = clamp(boss.x + Math.cos(ang) * 165, PLAYABLE_MIN_X + 48, PLAYABLE_MAX_X - 48);
        const sy = clamp(boss.y + Math.sin(ang) * 165, PLAYABLE_MIN_Y + 48, PLAYABLE_MAX_Y - 48);
        const summonId =
          phase === 3 && s === summonCount - 1
            ? 'fin_alien'
            : s % 2 === 0
              ? 'baby_alien'
              : 'spitter';
        state.telegraphs.push({
          uid: allocUid(state),
          enemyId: summonId,
          x: sx,
          y: sy,
          ticksLeft: SPAWN_TELEGRAPH_TICKS,
          totalTicks: SPAWN_TELEGRAPH_TICKS,
          isElite: false,
          isBoss: false,
        });
      }
      fireEnemyRadialRing(state, boss.x, boss.y, partner ? 10 : 12, 265, effDmg, boss.ageTicks * 0.04, 8, 200, '#ff3d7f');
      boss.patternIndex += 1;
      boss.attackCooldown = partner ? (phase === 3 ? 92 : 116) : phase === 3 ? 68 : 92;
    }
  }
}

/**
 * Dispatcher invoked by `updateEnemies` for every living Boss entity.
 */
export function updateBossEntity(
  state: SimState,
  _catalog: GameDataCatalog,
  boss: EnemyState,
  _newSpawns: EnemyState[],
): void {
  // Enforce full knockback immunity
  boss.knockbackResistance = 1.0;
  boss.kbVx = 0;
  boss.kbVy = 0;

  updateBossPhase(state, boss);
  const partner = getPartnerBoss(state, boss.uid);

  if (boss.behavior === 'boss_invoker') {
    stepInvoker(state, boss, partner);
  } else {
    stepPredator(state, boss, partner);
  }

  // Smooth wall bounce clamp during high-speed dashes
  const minX = PLAYABLE_MIN_X + boss.radius;
  const maxX = PLAYABLE_MAX_X - boss.radius;
  const minY = PLAYABLE_MIN_Y + boss.radius;
  const maxY = PLAYABLE_MAX_Y - boss.radius;
  if (
    boss.state === 'dash' &&
    (boss.x + boss.vx * FIXED_DT < minX ||
      boss.x + boss.vx * FIXED_DT > maxX ||
      boss.y + boss.vy * FIXED_DT < minY ||
      boss.y + boss.vy * FIXED_DT > maxY)
  ) {
    boss.vx *= -0.45;
    boss.vy *= -0.45;
  }
}
