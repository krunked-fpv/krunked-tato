// ============================================================================
// src/sim/enemies.ts — Basic Enemy (28) & Elite (8) AI State Machines + Bounds
// ============================================================================

import {
  FIXED_DT,
  MAX_ENEMIES,
  PLAYER_HURT_OFFSET_Y,
  PLAYER_HURT_RADIUS,
  PLAYABLE_MAX_X,
  PLAYABLE_MAX_Y,
  PLAYABLE_MIN_X,
  PLAYABLE_MIN_Y,
  type EnemyDef,
  type EnemyState,
  type GameDataCatalog,
  type SimState,
} from '../contracts/index';
import { damagePlayer, spawnEnemyProjectile } from './combat';
import { allocUid, nextRand, randRange } from './prng';
import { clamp, computeEndlessFactor } from './stats';

/**
 * Instantiates a scaled `EnemyState` from `EnemyDef`, clamped strictly within
 * playable arena boundaries.
 */
export function createEnemyInstance(
  state: SimState,
  catalog: GameDataCatalog,
  defId: string,
  x: number,
  y: number,
  spawnedFromBoss = false,
): EnemyState | null {
  const def: EnemyDef | undefined =
    catalog.enemiesById[defId] ?? catalog.enemies[0];
  if (!def) return null;

  const diff =
    catalog.difficulties[
      clamp(state.dangerLevel, 0, Math.max(0, catalog.difficulties.length - 1))
    ];
  const dangerHpMult = diff ? diff.enemyHpMult : 1;
  const dangerDmgMult = diff ? diff.enemyDamageMult : 1;
  const dangerSpdMult = diff ? diff.enemySpeedMult : 1;

  const endlessFactor = computeEndlessFactor(state.wave, 1);
  const endlessHpMult = 1 + endlessFactor * 1.6;
  const endlessDmgMult = 1 + endlessFactor * 1.1;

  const stats = state.player.computedStats;
  const statHpMult = Math.max(0.25, 1 + stats.enemy_health / 100);
  const statDmgMult = Math.max(0.25, 1 + stats.enemy_damage / 100);
  const statSpdMult = Math.max(0.25, 1 + stats.enemy_speed / 100);

  const waveIdx = Math.max(0, state.wave - 1);
  const maxHp = Math.max(
    1,
    Math.round(
      (def.baseHp + def.hpPerWave * waveIdx) *
        dangerHpMult *
        endlessHpMult *
        statHpMult,
    ),
  );
  const damage = Math.max(
    1,
    Math.round(
      (def.baseDamage + def.damagePerWave * waveIdx) *
        dangerDmgMult *
        endlessDmgMult *
        statDmgMult,
    ),
  );
  const speed = Math.max(
    def.behavior === 'egg' ? 0 : 35,
    def.speed * dangerSpdMult * statSpdMult,
  );

  const radius = Math.max(10, def.radius);
  const cx = clamp(x, PLAYABLE_MIN_X + radius, PLAYABLE_MAX_X - radius);
  const cy = clamp(y, PLAYABLE_MIN_Y + radius, PLAYABLE_MAX_Y - radius);
  const baseCd = def.attackCooldownTicks ?? (def.kind === 'elite' ? 115 : 110);

  return {
    uid: allocUid(state),
    defId: def.id,
    kind: def.kind,
    behavior: def.behavior,
    x: cx,
    y: cy,
    prevX: cx,
    prevY: cy,
    vx: 0,
    vy: 0,
    kbVx: 0,
    kbVy: 0,
    radius,
    hp: maxHp,
    maxHp,
    damage,
    speed,
    knockbackResistance: def.kind === 'boss' || def.kind === 'elite' ? 1.0 : clamp(def.knockbackResistance, 0, 1),
    facingX: 1,
    state: 'move',
    stateTimer: 0,
    attackCooldown: Math.max(24, Math.round(baseCd * randRange(state, 0.45, 0.95))),
    phase: 1,
    patternIndex: 0,
    targetX: cx,
    targetY: cy,
    hitFlashTicks: 0,
    burnDamage: 0,
    burnTicksLeft: 0,
    burnTickInterval: 30,
    burnTickTimer: 0,
    buffedTicks: 0,
    buffSpeedMult: 1,
    buffDmgMult: 1,
    slowTicks: 0,
    ageTicks: 0,
    spawnedFromBoss,
  };
}

/**
 * Helper to fire a radial ring of enemy projectiles around (x, y).
 */
export function fireEnemyRadialRing(
  state: SimState,
  x: number,
  y: number,
  count: number,
  speed: number,
  damage: number,
  angleOffset: number,
  radius = 8,
  lifeTicks = 210,
  color = '#ff3864',
): void {
  const n = Math.max(1, count);
  for (let i = 0; i < n; i++) {
    const a = angleOffset + (i / n) * Math.PI * 2;
    spawnEnemyProjectile(
      state,
      x,
      y,
      Math.cos(a) * speed,
      Math.sin(a) * speed,
      radius,
      damage,
      lifeTicks,
      color,
      'proj_enemy',
    );
  }
}

/**
 * Helper to fire a directional fan of enemy projectiles toward baseAngle.
 */
export function fireEnemyFan(
  state: SimState,
  x: number,
  y: number,
  baseAngle: number,
  count: number,
  spreadRad: number,
  speed: number,
  damage: number,
  radius = 8,
  lifeTicks = 210,
  color = '#ff4268',
): void {
  const n = Math.max(1, count);
  for (let i = 0; i < n; i++) {
    const t = n > 1 ? i / (n - 1) - 0.5 : 0;
    const a = baseAngle + t * spreadRad;
    spawnEnemyProjectile(
      state,
      x,
      y,
      Math.cos(a) * speed,
      Math.sin(a) * speed,
      radius,
      damage,
      lifeTicks,
      color,
      'proj_enemy',
    );
  }
}

/**
 * Fires an enemy projectile that ricochets off playable arena boundaries `bounces` times.
 */
function fireEnemyBouncingOrb(
  state: SimState,
  x: number,
  y: number,
  angle: number,
  speed: number,
  damage: number,
  bounces: number,
  radius = 9,
  lifeTicks = 300,
  color = '#ff66e0',
): void {
  spawnEnemyProjectile(
    state,
    x,
    y,
    Math.cos(angle) * speed,
    Math.sin(angle) * speed,
    radius,
    damage,
    lifeTicks,
    color,
    'proj_enemy',
  );
  const pr = state.projectiles[state.projectiles.length - 1];
  if (pr) {
    pr.bounceLeft = Math.max(0, bounces);
  }
}

/**
 * Emits a pure visual pulse ring (zero damage) for support aura feedback (Healer / Buffer).
 */
function emitVisualPulseRing(
  state: SimState,
  x: number,
  y: number,
  radius: number,
  color: string,
  durationTicks = 16,
): void {
  state.hazards.push({
    uid: allocUid(state),
    kind: 'boss_ring',
    owner: 'enemy',
    x,
    y,
    endX: x,
    endY: y,
    angle: 0,
    arcSpan: Math.PI * 2,
    radius,
    damage: 0,
    ticksLeft: durationTicks,
    maxTicks: durationTicks,
    activeDelayTicks: 0,
    color,
    hitPlayer: true,
  });
}

/**
 * Emits a non-damaging directional dash lane telegraph (`boss_beam`, damage 0).
 */
function emitDashTelegraph(
  state: SimState,
  x: number,
  y: number,
  dirX: number,
  dirY: number,
  length: number,
  radius: number,
  windupTicks: number,
  color = '#ff4252',
): void {
  state.hazards.push({
    uid: allocUid(state),
    kind: 'boss_beam',
    owner: 'enemy',
    x,
    y,
    endX: clamp(x + dirX * length, PLAYABLE_MIN_X + 16, PLAYABLE_MAX_X - 16),
    endY: clamp(y + dirY * length, PLAYABLE_MIN_Y + 16, PLAYABLE_MAX_Y - 16),
    angle: Math.atan2(dirY, dirX),
    arcSpan: 0,
    radius,
    damage: 0,
    ticksLeft: 2,
    maxTicks: windupTicks,
    activeDelayTicks: windupTicks,
    color,
    hitPlayer: true,
  });
}

function stepBasicBehavior(
  state: SimState,
  catalog: GameDataCatalog,
  e: EnemyState,
  effSpeed: number,
  toPlayerX: number,
  toPlayerY: number,
  distToPlayer: number,
  newSpawns: EnemyState[],
): void {
  const def = catalog.enemiesById[e.defId];
  const dirX = distToPlayer > 0.001 ? toPlayerX / distToPlayer : 1;
  const dirY = distToPlayer > 0.001 ? toPlayerY / distToPlayer : 0;
  const angleToPlayer = Math.atan2(dirY, dirX);
  const baseCd = def?.attackCooldownTicks ?? 115;
  const projSpd = def?.projectileSpeed ?? 340;
  const effDmg = Math.max(1, Math.round(e.damage * e.buffDmgMult));

  switch (e.behavior) {
    case 'chaser': {
      // `chaser` weaves sharper and bursts slightly faster when closing in; `baby_alien` weaves gently
      const isSwiftChaser = e.defId === 'chaser';
      const sway = Math.sin(e.ageTicks * (isSwiftChaser ? 0.11 : 0.07) + e.uid) * (isSwiftChaser ? 0.28 : 0.2);
      const closeBoost = isSwiftChaser && distToPlayer < 200 ? 1.14 : 1.0;
      const moveAngle = angleToPlayer + sway;
      e.vx = Math.cos(moveAngle) * effSpeed * closeBoost;
      e.vy = Math.sin(moveAngle) * effSpeed * closeBoost;
      break;
    }

    case 'pursuer': {
      // Steadily accelerates the longer it remains alive (1.0x -> 2.25x over 10s)
      const ramp = 1 + Math.min(1.25, e.ageTicks / 480);
      e.vx = dirX * effSpeed * ramp;
      e.vy = dirY * effSpeed * ramp;
      break;
    }

    case 'junkie': {
      if (e.defId === 'evil_mob') {
        // Aggressive loot-hoarding swarm rusher: ramps rush momentum + 3-dart scatter at close-mid range
        const rushRamp = 1 + Math.min(0.55, (e.ageTicks % 240) / 240);
        const weave = Math.sin(e.ageTicks * 0.16 + e.uid) * 0.24;
        e.vx = Math.cos(angleToPlayer + weave) * effSpeed * rushRamp;
        e.vy = Math.sin(angleToPlayer + weave) * effSpeed * rushRamp;
        if (e.attackCooldown <= 0 && distToPlayer < 260) {
          fireEnemyFan(state, e.x, e.y, angleToPlayer, 3, 0.45, projSpd, effDmg, 7, 150, '#ff3b5c');
          e.attackCooldown = Math.max(75, baseCd);
        }
      } else if (e.defId === 'dire_junkie') {
        // Hyper-frenzied swarm rusher: rapid sprint bursts with sudden lateral jukes
        const cycle = (e.ageTicks + e.uid * 11) % 90;
        const mult = cycle < 42 ? 1.92 : 0.72;
        const juke = Math.sin(e.ageTicks * 0.28 + e.uid) * 0.42;
        e.vx = Math.cos(angleToPlayer + juke) * effSpeed * mult;
        e.vy = Math.sin(angleToPlayer + juke) * effSpeed * mult;
      } else {
        // Standard `junkie`: alternates slow stalk and erratic sprint bursts
        const cycle = (e.ageTicks + e.uid * 13) % 120;
        const mult = cycle < 45 ? 1.65 : 0.65;
        const wobble = Math.sin(e.ageTicks * 0.19 + e.uid) * 0.3;
        e.vx = Math.cos(angleToPlayer + wobble) * effSpeed * mult;
        e.vy = Math.sin(angleToPlayer + wobble) * effSpeed * mult;
      }
      break;
    }

    case 'fin_alien': {
      // Sleek curved flanking swoop that cuts sharply inward at close range
      const curve = distToPlayer > 175 ? 0.58 * (e.uid % 2 === 0 ? 1 : -1) : 0;
      const a = angleToPlayer + curve;
      const boost = distToPlayer <= 175 ? 1.18 : 1.06;
      e.vx = Math.cos(a) * effSpeed * boost;
      e.vy = Math.sin(a) * effSpeed * boost;
      break;
    }

    case 'fly': {
      const isHorned = e.defId === 'horned_fly';
      const flutter = Math.sin(e.ageTicks * (isHorned ? 0.28 : 0.24) + e.uid * 1.7) * (isHorned ? 0.68 : 0.62);
      const a = angleToPlayer + flutter;
      e.vx = Math.cos(a) * effSpeed;
      e.vy = Math.sin(a) * effSpeed;
      const range = isHorned ? 460 : 420;
      if (def?.projectileSpeed && e.attackCooldown <= 0 && distToPlayer < range) {
        if (isHorned) {
          // Horned Fly: twin forked violet stinger burst
          fireEnemyFan(state, e.x, e.y, angleToPlayer, 2, 0.28, projSpd, effDmg, 7, 185, '#df6bff');
        } else {
          spawnEnemyProjectile(
            state,
            e.x,
            e.y,
            dirX * projSpd,
            dirY * projSpd,
            7,
            effDmg,
            170,
            '#ff4f7b',
          );
        }
        e.attackCooldown = Math.max(60, baseCd);
      }
      break;
    }

    case 'spitter': {
      const isHorned = e.defId === 'horned_spitter';
      if (e.state === 'windup') {
        e.vx *= 0.7;
        e.vy *= 0.7;
        e.stateTimer -= 1;
        if (e.stateTimer <= 0) {
          if (isHorned) {
            // Horned Spitter: 3-shot spread fan of swift crimson-violet orbs
            fireEnemyFan(state, e.x, e.y, angleToPlayer, 3, 0.44, projSpd, effDmg, 8, 220, '#ff3399');
          } else {
            spawnEnemyProjectile(
              state,
              e.x,
              e.y,
              Math.cos(angleToPlayer) * projSpd,
              Math.sin(angleToPlayer) * projSpd,
              8,
              effDmg,
              210,
              '#ff3366',
            );
          }
          e.state = 'recover';
          e.stateTimer = 18;
          e.attackCooldown = Math.max(58, baseCd);
        }
      } else if (e.state === 'recover') {
        e.vx *= 0.8;
        e.vy *= 0.8;
        e.stateTimer -= 1;
        if (e.stateTimer <= 0) e.state = 'move';
      } else {
        if (distToPlayer > 360) {
          e.vx = dirX * effSpeed;
          e.vy = dirY * effSpeed;
        } else if (distToPlayer < 170) {
          e.vx = -dirX * effSpeed * 0.65;
          e.vy = -dirY * effSpeed * 0.65;
        } else {
          const strafe = e.uid % 2 === 0 ? 1 : -1;
          e.vx = -dirY * effSpeed * 0.45 * strafe;
          e.vy = dirX * effSpeed * 0.45 * strafe;
        }
        if (e.attackCooldown <= 0 && distToPlayer <= (isHorned ? 560 : 520)) {
          e.state = 'windup';
          e.stateTimer = isHorned ? 28 : 26;
        }
      }
      break;
    }

    case 'charger':
    case 'slasher': {
      const isSlasher = e.behavior === 'slasher';
      const isMadSlasher = e.defId === 'mad_slasher';
      const isHornedCharger = e.defId === 'horned_charger';

      const triggerRange = isSlasher ? (isMadSlasher ? 265 : 235) : (isHornedCharger ? 430 : 390);
      const windupTicks = isMadSlasher ? 20 : isSlasher ? 24 : isHornedCharger ? 34 : 36;
      const dashTicks = isMadSlasher ? 19 : isSlasher ? 18 : isHornedCharger ? 32 : 28;
      const dashMult = isMadSlasher ? 3.25 : isSlasher ? 2.9 : isHornedCharger ? 3.45 : 3.1;

      if (e.state === 'windup') {
        e.vx *= 0.6;
        e.vy *= 0.6;
        e.stateTimer -= 1;
        if (e.stateTimer <= 0) {
          const dx = e.targetX - e.x;
          const dy = e.targetY - e.y;
          const len = Math.hypot(dx, dy) || 1;
          e.vx = (dx / len) * effSpeed * dashMult;
          e.vy = (dy / len) * effSpeed * dashMult;
          e.state = 'dash';
          e.stateTimer = dashTicks;
        }
      } else if (e.state === 'dash') {
        e.stateTimer -= 1;
        if (e.stateTimer <= 0) {
          if (isHornedCharger) {
            // Horned Charger: 4-shot radial impact burst on charge completion
            fireEnemyRadialRing(state, e.x, e.y, 4, projSpd, effDmg, angleToPlayer + Math.PI / 4, 8, 145, '#ff8833');
          } else if (isMadSlasher) {
            // Mad Slasher: chains a rapid second lunge before releasing a 3-shot crimson blade fan
            if (e.patternIndex % 2 === 0) {
              e.patternIndex += 1;
              e.state = 'windup';
              e.stateTimer = 18;
              e.targetX = state.player.x;
              e.targetY = state.player.y;
              const dx = e.targetX - e.x;
              const dy = e.targetY - e.y;
              const len = Math.hypot(dx, dy) || 1;
              emitDashTelegraph(state, e.x, e.y, dx / len, dy / len, 260, Math.max(10, e.radius * 0.48), 18, '#ff264a');
              break;
            }
            fireEnemyFan(state, e.x, e.y, angleToPlayer, 3, 0.55, projSpd, effDmg, 8, 145, '#ff2652');
            e.patternIndex += 1;
          } else if (isSlasher) {
            // Slasher: narrow 3-arc crimson claw wave on lunge finish
            fireEnemyFan(state, e.x, e.y, angleToPlayer, 3, 0.42, projSpd, effDmg, 7, 120, '#ff4d70');
          }
          e.state = 'recover';
          e.stateTimer = isSlasher ? 20 : 32;
          e.attackCooldown = Math.max(62, baseCd);
        }
      } else if (e.state === 'recover') {
        e.vx *= 0.82;
        e.vy *= 0.82;
        e.stateTimer -= 1;
        if (e.stateTimer <= 0) e.state = 'move';
      } else {
        e.vx = dirX * effSpeed;
        e.vy = dirY * effSpeed;
        if (e.attackCooldown <= 0 && distToPlayer <= triggerRange) {
          e.state = 'windup';
          e.stateTimer = windupTicks;
          e.targetX = state.player.x;
          e.targetY = state.player.y;
          const dx = e.targetX - e.x;
          const dy = e.targetY - e.y;
          const len = Math.hypot(dx, dy) || 1;
          const dashLen = Math.min(390, effSpeed * dashMult * (dashTicks * FIXED_DT));
          emitDashTelegraph(
            state,
            e.x,
            e.y,
            dx / len,
            dy / len,
            dashLen,
            Math.max(10, e.radius * 0.45),
            windupTicks,
            isHornedCharger ? '#ff852b' : '#ff4252',
          );
        }
      }
      break;
    }

    case 'bruiser': {
      const isHorned = e.defId === 'horned_bruiser';
      if (e.state === 'windup') {
        e.vx *= 0.65;
        e.vy *= 0.65;
        e.stateTimer -= 1;
        if (e.stateTimer <= 0) {
          fireEnemyRadialRing(
            state,
            e.x,
            e.y,
            isHorned ? 10 : 6,
            isHorned ? projSpd : 260,
            effDmg,
            angleToPlayer,
            isHorned ? 9 : 8,
            isHorned ? 155 : 130,
            isHorned ? '#ff4233' : '#ff5940',
          );
          e.state = 'recover';
          e.stateTimer = 26;
          e.attackCooldown = Math.max(110, baseCd);
        }
      } else if (e.state === 'recover') {
        e.vx *= 0.8;
        e.vy *= 0.8;
        e.stateTimer -= 1;
        if (e.stateTimer <= 0) e.state = 'move';
      } else {
        e.vx = dirX * effSpeed;
        e.vy = dirY * effSpeed;
        if (e.attackCooldown <= 0 && distToPlayer < (isHorned ? 250 : 215)) {
          e.state = 'windup';
          e.stateTimer = isHorned ? 32 : 30;
          if (isHorned) {
            // Horned Bruiser telegraphs a close stomp shockwave ring alongside its 10-shot nova
            state.hazards.push({
              uid: allocUid(state),
              kind: 'boss_ring',
              owner: 'enemy',
              x: e.x,
              y: e.y,
              endX: e.x,
              endY: e.y,
              angle: 0,
              arcSpan: Math.PI * 2,
              radius: 118,
              damage: effDmg,
              ticksLeft: 12,
              maxTicks: 12,
              activeDelayTicks: 32,
              color: '#ff5238',
              hitPlayer: false,
            });
          }
        }
      }
      break;
    }

    case 'helmet_alien': {
      // Steady armored marcher with periodic shielded rush bursts
      const burst = (e.ageTicks + e.uid * 17) % 150 < 36 ? 1.48 : 0.92;
      e.vx = dirX * effSpeed * burst;
      e.vy = dirY * effSpeed * burst;
      break;
    }

    case 'lamprey': {
      // Fast zig-zag stalker with snapping high-speed lunges
      if (e.attackCooldown <= 0 && distToPlayer < 305) {
        const zigBias = (e.patternIndex % 2 === 0 ? 1 : -1) * 0.14;
        const lungeAng = angleToPlayer + zigBias;
        e.vx = Math.cos(lungeAng) * effSpeed * 2.35;
        e.vy = Math.sin(lungeAng) * effSpeed * 2.35;
        e.attackCooldown = Math.max(58, baseCd);
        e.patternIndex += 1;
        e.state = 'dash';
        e.stateTimer = 17;
      } else if (e.state === 'dash') {
        e.stateTimer -= 1;
        if (e.stateTimer <= 0) e.state = 'move';
      } else {
        const zig = Math.sin(e.ageTicks * 0.19 + e.uid) * 0.65;
        const moveAng = angleToPlayer + zig;
        e.vx = Math.cos(moveAng) * effSpeed * 1.05;
        e.vy = Math.sin(moveAng) * effSpeed * 1.05;
      }
      break;
    }

    case 'egg': {
      // Stationary pulsing cocoon that hatches into slasher / chasers if left alive
      const isInfected = e.defId === 'infected_slasher_egg';
      const hatchTicks = isInfected ? 210 : 240;
      e.vx = 0;
      e.vy = 0;

      // Visual hatching warning pulse during the final second before hatching
      const ticksUntilHatch = hatchTicks - e.ageTicks;
      if (ticksUntilHatch > 0 && ticksUntilHatch <= 75 && ticksUntilHatch % 15 === 0) {
        e.hitFlashTicks = 5;
        emitVisualPulseRing(state, e.x, e.y, e.radius + 26, isInfected ? '#b8ff4d' : '#ff7a98', 12);
      }

      if (e.ageTicks >= hatchTicks) {
        const childId = def?.spawnChildId ?? (isInfected ? 'chaser' : 'slasher');
        const hatchCount = isInfected ? 2 : 1;
        for (let k = 0; k < hatchCount; k++) {
          if (state.enemies.length + newSpawns.length >= MAX_ENEMIES) break;
          const ox = hatchCount > 1 ? (k === 0 ? -18 : 18) : 0;
          const oy = hatchCount > 1 ? (k === 0 ? -12 : 12) : 0;
          const child = createEnemyInstance(state, catalog, childId, e.x + ox, e.y + oy, e.spawnedFromBoss);
          if (child) newSpawns.push(child);
        }
        if (isInfected) {
          fireEnemyRadialRing(state, e.x, e.y, 4, 240, effDmg, e.uid * 0.7, 7, 130, '#b5ff4d');
        }
        e.hp = 0; // Dissolve hatched cocoon cleanly
      }
      break;
    }

    case 'spawner': {
      const isBloated = e.defId === 'bloated_spawner';
      // Maintains safe mid-range distance and periodically spawns minions
      if (distToPlayer < 250) {
        e.vx = -dirX * effSpeed * 0.85;
        e.vy = -dirY * effSpeed * 0.85;
      } else if (distToPlayer > 460) {
        e.vx = dirX * effSpeed * 0.75;
        e.vy = dirY * effSpeed * 0.75;
      } else {
        const strafe = e.uid % 2 === 0 ? 1 : -1;
        e.vx = -dirY * effSpeed * 0.5 * strafe;
        e.vy = dirX * effSpeed * 0.5 * strafe;
      }
      if (e.attackCooldown <= 0) {
        e.attackCooldown = Math.max(140, baseCd);
        const childId = def?.spawnChildId ?? (isBloated ? 'chaser' : 'baby_alien');
        const burstCount = isBloated ? 2 : 1;
        for (let k = 0; k < burstCount; k++) {
          if (state.enemies.length + newSpawns.length >= MAX_ENEMIES) break;
          const ox = randRange(state, -38, 38);
          const oy = randRange(state, -38, 38);
          const child = createEnemyInstance(
            state,
            catalog,
            childId,
            e.x + ox,
            e.y + oy,
            e.spawnedFromBoss,
          );
          if (child) newSpawns.push(child);
        }
        if (isBloated) {
          emitVisualPulseRing(state, e.x, e.y, 70, '#a3ff6b', 14);
        }
      }
      break;
    }

    case 'buffer': {
      const isCorrupted = e.defId === 'corrupted_buffer';
      // Orbits at safe mid-range and buffs nearby allies' speed & damage
      if (distToPlayer < 245) {
        e.vx = -dirX * effSpeed;
        e.vy = -dirY * effSpeed;
      } else if (distToPlayer > 445) {
        e.vx = dirX * effSpeed * 0.8;
        e.vy = dirY * effSpeed * 0.8;
      } else {
        const strafe = e.uid % 2 === 0 ? 1 : -1;
        e.vx = -dirY * effSpeed * 0.65 * strafe;
        e.vy = dirX * effSpeed * 0.65 * strafe;
      }
      if (e.attackCooldown <= 0) {
        e.attackCooldown = Math.max(90, baseCd);
        const auraR = isCorrupted ? 340 : 270;
        const auraRSq = auraR * auraR;
        const buffDur = isCorrupted ? 240 : 180;
        const spdBoost = isCorrupted ? 1.48 : 1.28;
        const dmgBoost = isCorrupted ? 1.45 : 1.25;
        let buffedAny = false;
        for (let j = 0; j < state.enemies.length; j++) {
          const ally = state.enemies[j];
          if (ally.hp <= 0 || ally.uid === e.uid) continue;
          const dx = ally.x - e.x;
          const dy = ally.y - e.y;
          if (dx * dx + dy * dy <= auraRSq) {
            ally.buffedTicks = Math.max(ally.buffedTicks, buffDur);
            ally.buffSpeedMult = Math.max(ally.buffSpeedMult, spdBoost);
            ally.buffDmgMult = Math.max(ally.buffDmgMult, dmgBoost);
            buffedAny = true;
          }
        }
        if (buffedAny || isCorrupted) {
          emitVisualPulseRing(
            state,
            e.x,
            e.y,
            isCorrupted ? 145 : 115,
            isCorrupted ? '#d94dff' : '#ff6b8b',
            16,
          );
        }
      }
      break;
    }

    case 'healer': {
      // Keeps distance from player and periodically pulses a green healing wave
      if (distToPlayer < 285) {
        e.vx = -dirX * effSpeed;
        e.vy = -dirY * effSpeed;
      } else {
        const strafe = e.uid % 2 === 0 ? 1 : -1;
        e.vx = (-dirY * 0.6 * strafe + dirX * 0.25) * effSpeed;
        e.vy = (dirX * 0.6 * strafe + dirY * 0.25) * effSpeed;
      }
      if (e.attackCooldown <= 0) {
        e.attackCooldown = Math.max(105, baseCd);
        const healR = 270;
        const healRSq = healR * healR;
        let healedAny = false;
        for (let j = 0; j < state.enemies.length; j++) {
          const ally = state.enemies[j];
          if (ally.hp <= 0 || ally.hp >= ally.maxHp) continue;
          const dx = ally.x - e.x;
          const dy = ally.y - e.y;
          if (dx * dx + dy * dy <= healRSq) {
            const healAmt = Math.max(1, Math.round(ally.maxHp * 0.15));
            ally.hp = Math.min(ally.maxHp, ally.hp + healAmt);
            healedAny = true;
          }
        }
        if (healedAny) {
          emitVisualPulseRing(state, e.x, e.y, 130, '#4dff94', 18);
        }
      }
      break;
    }

    case 'tentacle': {
      // Lurks slowly until player approaches, then unleashes a telegraphed lash beam + ambush burst
      if (e.state === 'windup') {
        e.vx *= 0.6;
        e.vy *= 0.6;
        e.stateTimer -= 1;
        if (e.stateTimer <= 0) {
          const aim = Math.atan2(e.targetY - e.y, e.targetX - e.x);
          fireEnemyFan(state, e.x, e.y, aim, 3, 0.26, projSpd, effDmg, 7, 145, '#c96bff');
          e.state = 'recover';
          e.stateTimer = 22;
          e.attackCooldown = Math.max(100, baseCd);
        }
      } else if (e.state === 'recover') {
        e.vx *= 0.8;
        e.vy *= 0.8;
        e.stateTimer -= 1;
        if (e.stateTimer <= 0) e.state = 'move';
      } else {
        e.vx = dirX * effSpeed * 0.5;
        e.vy = dirY * effSpeed * 0.5;
        if (e.attackCooldown <= 0 && distToPlayer <= 285) {
          e.state = 'windup';
          e.stateTimer = 34;
          e.targetX = state.player.x;
          e.targetY = state.player.y;
          const lashLen = 250;
          state.hazards.push({
            uid: allocUid(state),
            kind: 'boss_beam',
            owner: 'enemy',
            x: e.x,
            y: e.y,
            endX: clamp(e.x + dirX * lashLen, PLAYABLE_MIN_X + 16, PLAYABLE_MAX_X - 16),
            endY: clamp(e.y + dirY * lashLen, PLAYABLE_MIN_Y + 16, PLAYABLE_MAX_Y - 16),
            angle: angleToPlayer,
            arcSpan: 0,
            radius: 18,
            damage: effDmg,
            ticksLeft: 14,
            maxTicks: 14,
            activeDelayTicks: 34,
            color: '#b83bff',
            hitPlayer: false,
          });
        }
      }
      break;
    }

    case 'looter': {
      // Flees away from the player while steering smoothly along walls (never corner-trapped)
      let fx = -dirX;
      let fy = -dirY;
      const wallPad = 175;
      if (e.x < PLAYABLE_MIN_X + wallPad) fx += 1.35;
      if (e.x > PLAYABLE_MAX_X - wallPad) fx -= 1.35;
      if (e.y < PLAYABLE_MIN_Y + wallPad) fy += 1.35;
      if (e.y > PLAYABLE_MAX_Y - wallPad) fy -= 1.35;
      // Add slight perpendicular drift so it glides cleanly past corners
      const drift = e.uid % 2 === 0 ? 0.22 : -0.22;
      fx += -dirY * drift;
      fy += dirX * drift;
      const fLen = Math.hypot(fx, fy) || 1;
      const panicBoost = distToPlayer < 220 ? 1.15 : 1.0;
      e.vx = (fx / fLen) * effSpeed * panicBoost;
      e.vy = (fy / fLen) * effSpeed * panicBoost;
      break;
    }

    default: {
      e.vx = dirX * effSpeed;
      e.vy = dirY * effSpeed;
      break;
    }
  }
}

function stepEliteBehavior(
  state: SimState,
  catalog: GameDataCatalog,
  e: EnemyState,
  effSpeed: number,
  toPlayerX: number,
  toPlayerY: number,
  distToPlayer: number,
  newSpawns: EnemyState[],
): void {
  // Phase 2 trigger at 50% HP
  if (e.phase === 1 && e.hp <= e.maxHp * 0.5) {
    e.phase = 2;
    e.state = 'move';
    e.attackCooldown = Math.min(e.attackCooldown, 24);
    state.camera.shakeTrauma = Math.min(1, state.camera.shakeTrauma + 0.35);
    emitVisualPulseRing(state, e.x, e.y, 130, '#ff4d6d', 18);
  }

  const p2 = e.phase >= 2;
  const dirX = distToPlayer > 0.001 ? toPlayerX / distToPlayer : 1;
  const dirY = distToPlayer > 0.001 ? toPlayerY / distToPlayer : 0;
  const angleToPlayer = Math.atan2(dirY, dirX);
  const effDmg = Math.max(1, Math.round(e.damage * e.buffDmgMult));

  switch (e.behavior) {
    // 1. BUTCHER: Cleave dash + crimson cross waves
    case 'elite_butcher': {
      const pattern = (e.patternIndex % 100) % 2;
      if (e.state === 'windup') {
        e.vx *= 0.68;
        e.vy *= 0.68;
        e.stateTimer -= 1;
        if (e.stateTimer <= 0) {
          if (pattern === 0) {
            const dx = e.targetX - e.x;
            const dy = e.targetY - e.y;
            const len = Math.hypot(dx, dy) || 1;
            const dashSpd = effSpeed * (p2 ? 3.2 : 2.8);
            e.vx = (dx / len) * dashSpd;
            e.vy = (dy / len) * dashSpd;
            e.state = 'dash';
            e.stateTimer = 25;
          } else {
            // Crimson Cross Waves: X/+ telegraphed beam cross + cleaver fan
            const lanes = p2 ? 8 : 4;
            const rot = (e.patternIndex % 4) * (Math.PI / 4);
            for (let k = 0; k < lanes; k++) {
              const a = rot + (k / lanes) * Math.PI * 2;
              state.hazards.push({
                uid: allocUid(state),
                kind: 'boss_beam',
                owner: 'enemy',
                x: e.x,
                y: e.y,
                endX: clamp(e.x + Math.cos(a) * 620, PLAYABLE_MIN_X + 16, PLAYABLE_MAX_X - 16),
                endY: clamp(e.y + Math.sin(a) * 620, PLAYABLE_MIN_Y + 16, PLAYABLE_MAX_Y - 16),
                angle: a,
                arcSpan: 0,
                radius: 20,
                damage: effDmg,
                ticksLeft: 16,
                maxTicks: 16,
                activeDelayTicks: p2 ? 34 : 40,
                color: '#ff244c',
                hitPlayer: false,
              });
            }
            fireEnemyFan(state, e.x, e.y, angleToPlayer, p2 ? 5 : 3, 0.75, 360, effDmg, 9, 195, '#ff3355');
            e.patternIndex = (e.patternIndex % 100) + 1;
            e.state = 'recover';
            e.stateTimer = 28;
            e.attackCooldown = p2 ? 78 : 108;
          }
        }
      } else if (e.state === 'dash') {
        e.stateTimer -= 1;
        if (e.stateTimer <= 0) {
          // 4-way crimson cross projectile waves on cleave impact
          fireEnemyRadialRing(state, e.x, e.y, 4, 340, effDmg, angleToPlayer, 10, 190, '#ff264a');
          fireEnemyRadialRing(state, e.x, e.y, 4, 260, effDmg, angleToPlayer + Math.PI / 4, 8, 180, '#ff667a');
          const chainDone = Math.floor(e.patternIndex / 100) + 1;
          if (p2 && chainDone < 2) {
            e.patternIndex = (e.patternIndex % 100) + chainDone * 100;
            e.state = 'windup';
            e.stateTimer = 24;
            e.targetX = state.player.x;
            e.targetY = state.player.y;
            emitDashTelegraph(state, e.x, e.y, dirX, dirY, 400, 18, 24, '#ff2b4a');
          } else {
            e.patternIndex = (e.patternIndex % 100) + 1;
            e.state = 'recover';
            e.stateTimer = 30;
            e.attackCooldown = p2 ? 82 : 112;
          }
        }
      } else if (e.state === 'recover') {
        e.vx *= 0.82;
        e.vy *= 0.82;
        e.stateTimer -= 1;
        if (e.stateTimer <= 0) e.state = 'move';
      } else {
        e.vx = dirX * effSpeed;
        e.vy = dirY * effSpeed;
        if (e.attackCooldown <= 0) {
          e.state = 'windup';
          e.stateTimer = pattern === 0 ? (p2 ? 30 : 38) : 24;
          e.targetX = state.player.x;
          e.targetY = state.player.y;
          if (pattern === 0) {
            emitDashTelegraph(state, e.x, e.y, dirX, dirY, 400, 18, e.stateTimer, '#ff2b4a');
          }
        }
      }
      break;
    }

    // 2. COLOSSUS: Heavy shockwave rings + boulder bursts
    case 'elite_colossus': {
      const pattern = e.patternIndex % 2;
      e.vx = dirX * effSpeed * (e.state === 'windup' ? 0.2 : 0.95);
      e.vy = dirY * effSpeed * (e.state === 'windup' ? 0.2 : 0.95);
      if (e.state === 'windup') {
        e.stateTimer -= 1;
        if (e.stateTimer <= 0) {
          if (pattern === 0) {
            // Seismic slam boulder ring
            fireEnemyRadialRing(state, e.x, e.y, p2 ? 14 : 10, 295, effDmg, e.patternIndex * 0.35, 11, 220, '#ff8038');
            state.camera.shakeTrauma = Math.min(1, state.camera.shakeTrauma + 0.3);
            if (p2) {
              // Secondary outer shockwave ring in Phase 2
              state.hazards.push({
                uid: allocUid(state),
                kind: 'boss_ring',
                owner: 'enemy',
                x: e.x,
                y: e.y,
                endX: e.x,
                endY: e.y,
                angle: 0,
                arcSpan: Math.PI * 2,
                radius: 310,
                damage: effDmg,
                ticksLeft: 14,
                maxTicks: 14,
                activeDelayTicks: 28,
                color: '#ff9638',
                hitPlayer: false,
              });
            }
          } else {
            // Heavy boulder spread barrage toward player
            fireEnemyFan(state, e.x, e.y, angleToPlayer, p2 ? 7 : 5, 1.05, 345, effDmg, 11, 215, '#d96e30');
            fireEnemyFan(state, e.x, e.y, angleToPlayer, p2 ? 4 : 3, 0.55, 255, effDmg, 12, 225, '#ffaa4d');
          }
          e.patternIndex += 1;
          e.state = 'move';
          e.attackCooldown = p2 ? 78 : 112;
        }
      } else if (e.attackCooldown <= 0) {
        e.state = 'windup';
        e.stateTimer = pattern === 0 ? 38 : 28;
        if (pattern === 0) {
          state.hazards.push({
            uid: allocUid(state),
            kind: 'boss_ring',
            owner: 'enemy',
            x: e.x,
            y: e.y,
            endX: e.x,
            endY: e.y,
            angle: 0,
            arcSpan: Math.PI * 2,
            radius: p2 ? 235 : 195,
            damage: effDmg,
            ticksLeft: 14,
            maxTicks: 14,
            activeDelayTicks: 38,
            color: '#ff5c33',
            hitPlayer: false,
          });
        }
      }
      break;
    }

    // 3. CROC: Triple lunge + acid pool trail
    case 'elite_croc': {
      const pattern = (e.patternIndex % 100) % 2;
      if (e.state === 'windup') {
        e.vx *= 0.62;
        e.vy *= 0.62;
        e.stateTimer -= 1;
        if (e.stateTimer <= 0) {
          if (pattern === 0) {
            const dx = e.targetX - e.x;
            const dy = e.targetY - e.y;
            const len = Math.hypot(dx, dy) || 1;
            const lungeSpd = effSpeed * (p2 ? 2.95 : 2.65);
            e.vx = (dx / len) * lungeSpd;
            e.vy = (dy / len) * lungeSpd;
            e.state = 'dash';
            e.stateTimer = 22;
          } else {
            // Acid Spit Fan + targeted acid pool puddles
            fireEnemyFan(state, e.x, e.y, angleToPlayer, p2 ? 7 : 5, 1.0, 365, effDmg, 8, 195, '#8eff42');
            const poolCount = p2 ? 3 : 2;
            for (let k = 0; k < poolCount; k++) {
              const px = clamp(state.player.x + randRange(state, -135, 135), PLAYABLE_MIN_X + 64, PLAYABLE_MAX_X - 64);
              const py = clamp(state.player.y + randRange(state, -135, 135), PLAYABLE_MIN_Y + 64, PLAYABLE_MAX_Y - 64);
              state.hazards.push({
                uid: allocUid(state),
                kind: 'acid_pool',
                owner: 'enemy',
                x: px,
                y: py,
                endX: px,
                endY: py,
                angle: 0,
                arcSpan: Math.PI * 2,
                radius: 56,
                damage: effDmg,
                ticksLeft: 180,
                maxTicks: 180,
                activeDelayTicks: 34,
                color: '#7cff3b',
                hitPlayer: false,
              });
            }
            e.patternIndex = (e.patternIndex % 100) + 1;
            e.state = 'recover';
            e.stateTimer = 24;
            e.attackCooldown = p2 ? 75 : 102;
          }
        }
      } else if (e.state === 'dash') {
        e.stateTimer -= 1;
        // Leave bubbling acid pool trail hazards along the lunge path
        if (e.stateTimer % 7 === 0) {
          state.hazards.push({
            uid: allocUid(state),
            kind: 'acid_pool',
            owner: 'enemy',
            x: e.x,
            y: e.y,
            endX: e.x,
            endY: e.y,
            angle: 0,
            arcSpan: Math.PI * 2,
            radius: 44,
            damage: effDmg,
            ticksLeft: 150,
            maxTicks: 150,
            activeDelayTicks: 24,
            color: '#6eff42',
            hitPlayer: false,
          });
        }
        if (e.stateTimer <= 0) {
          const lungesDone = Math.floor(e.patternIndex / 100) + 1;
          const maxLunges = p2 ? 3 : 2;
          if (lungesDone < maxLunges) {
            e.patternIndex = (e.patternIndex % 100) + lungesDone * 100;
            e.state = 'windup';
            e.stateTimer = 20;
            e.targetX = state.player.x;
            e.targetY = state.player.y;
            emitDashTelegraph(state, e.x, e.y, dirX, dirY, 340, 16, 20, '#85ff42');
          } else {
            e.patternIndex = (e.patternIndex % 100) + 1;
            e.state = 'recover';
            e.stateTimer = 28;
            e.attackCooldown = p2 ? 72 : 100;
          }
        }
      } else if (e.state === 'recover') {
        e.vx *= 0.82;
        e.vy *= 0.82;
        e.stateTimer -= 1;
        if (e.stateTimer <= 0) e.state = 'move';
      } else {
        e.vx = dirX * effSpeed;
        e.vy = dirY * effSpeed;
        if (e.attackCooldown <= 0) {
          e.state = 'windup';
          e.stateTimer = pattern === 0 ? 26 : 24;
          e.targetX = state.player.x;
          e.targetY = state.player.y;
          if (pattern === 0) {
            emitDashTelegraph(state, e.x, e.y, dirX, dirY, 340, 16, 26, '#85ff42');
          }
        }
      }
      break;
    }

    // 4. GARGOYLE: Alternating spiral + rapid dive
    case 'elite_gargoyle': {
      const pattern = e.patternIndex % 2;
      if (e.state === 'attack') {
        // Channeling alternating aerial bullet spiral
        e.vx *= 0.84;
        e.vy *= 0.84;
        e.stateTimer -= 1;
        const every = p2 ? 7 : 9;
        if (e.stateTimer % every === 0) {
          const arms = p2 ? 4 : 3;
          const spinDir = p2 && e.stateTimer < 38 ? -1 : 1;
          const baseAng = e.ageTicks * 0.1 * spinDir + e.patternIndex;
          for (let a = 0; a < arms; a++) {
            const ang = baseAng + (a / arms) * Math.PI * 2;
            spawnEnemyProjectile(
              state,
              e.x + Math.cos(ang) * 20,
              e.y + Math.sin(ang) * 20,
              Math.cos(ang) * 310,
              Math.sin(ang) * 310,
              8,
              effDmg,
              215,
              '#ff52a8',
            );
          }
        }
        if (e.stateTimer <= 0) {
          e.patternIndex += 1;
          e.state = 'recover';
          e.stateTimer = 24;
          e.attackCooldown = p2 ? 68 : 96;
        }
      } else if (e.state === 'windup') {
        e.vx *= 0.65;
        e.vy *= 0.65;
        e.stateTimer -= 1;
        if (e.stateTimer <= 0) {
          const dx = e.targetX - e.x;
          const dy = e.targetY - e.y;
          const len = Math.hypot(dx, dy) || 1;
          const diveSpd = effSpeed * (p2 ? 3.45 : 3.1);
          e.vx = (dx / len) * diveSpd;
          e.vy = (dy / len) * diveSpd;
          e.state = 'dash';
          e.stateTimer = 22;
        }
      } else if (e.state === 'dash') {
        e.stateTimer -= 1;
        if (e.stateTimer <= 0) {
          // Dive-bomb slam burst
          fireEnemyRadialRing(state, e.x, e.y, p2 ? 10 : 8, 290, effDmg, angleToPlayer, 8, 185, '#ff4d94');
          state.hazards.push({
            uid: allocUid(state),
            kind: 'boss_ring',
            owner: 'enemy',
            x: e.x,
            y: e.y,
            endX: e.x,
            endY: e.y,
            angle: 0,
            arcSpan: Math.PI * 2,
            radius: 135,
            damage: effDmg,
            ticksLeft: 12,
            maxTicks: 12,
            activeDelayTicks: 18,
            color: '#ff52a8',
            hitPlayer: false,
          });
          e.patternIndex += 1;
          e.state = 'recover';
          e.stateTimer = 26;
          e.attackCooldown = p2 ? 70 : 98;
        }
      } else if (e.state === 'recover') {
        e.vx *= 0.84;
        e.vy *= 0.84;
        e.stateTimer -= 1;
        if (e.stateTimer <= 0) e.state = 'move';
      } else {
        // Swooping aerial orbit
        const strafe = e.patternIndex % 2 === 0 ? 1 : -1;
        e.vx = (-dirY * 0.72 * strafe + dirX * 0.52) * effSpeed;
        e.vy = (dirX * 0.72 * strafe + dirY * 0.52) * effSpeed;
        if (e.attackCooldown <= 0) {
          if (pattern === 0) {
            e.state = 'attack';
            e.stateTimer = p2 ? 78 : 66;
          } else {
            e.state = 'windup';
            e.stateTimer = p2 ? 26 : 32;
            e.targetX = state.player.x;
            e.targetY = state.player.y;
            emitDashTelegraph(state, e.x, e.y, dirX, dirY, 460, 17, e.stateTimer, '#ff4da6');
          }
        }
      }
      break;
    }

    // 5. MANTIS: Rapid twin-slash blink charges + fan darts
    case 'elite_mantis': {
      const pattern = (e.patternIndex % 100) % 2;
      if (e.state === 'windup') {
        e.vx *= 0.55;
        e.vy *= 0.55;
        e.stateTimer -= 1;
        if (e.stateTimer <= 0) {
          if (pattern === 0) {
            const dx = e.targetX - e.x;
            const dy = e.targetY - e.y;
            const len = Math.hypot(dx, dy) || 1;
            const blinkSpd = effSpeed * (p2 ? 3.85 : 3.5);
            e.vx = (dx / len) * blinkSpd;
            e.vy = (dy / len) * blinkSpd;
            e.state = 'dash';
            e.stateTimer = 16;
          } else {
            // Twin staggered razor dart fans
            fireEnemyFan(state, e.x, e.y, angleToPlayer, p2 ? 7 : 5, 1.08, 430, effDmg, 7, 190, '#6eff7a');
            e.state = 'attack';
            e.stateTimer = 16;
          }
        }
      } else if (e.state === 'attack') {
        e.vx *= 0.8;
        e.vy *= 0.8;
        e.stateTimer -= 1;
        if (e.stateTimer <= 0) {
          fireEnemyFan(state, e.x, e.y, angleToPlayer + 0.1, p2 ? 6 : 4, 0.95, 455, effDmg, 7, 190, '#ff427b');
          e.patternIndex = (e.patternIndex % 100) + 1;
          e.state = 'recover';
          e.stateTimer = 20;
          e.attackCooldown = p2 ? 64 : 90;
        }
      } else if (e.state === 'dash') {
        e.stateTimer -= 1;
        if (e.stateTimer <= 0) {
          // Crisscrossing twin-slash wake beams
          const slashAngles = [angleToPlayer + Math.PI / 4, angleToPlayer - Math.PI / 4];
          for (let s = 0; s < slashAngles.length; s++) {
            const sa = slashAngles[s];
            state.hazards.push({
              uid: allocUid(state),
              kind: 'boss_beam',
              owner: 'enemy',
              x: clamp(e.x - Math.cos(sa) * 190, PLAYABLE_MIN_X + 16, PLAYABLE_MAX_X - 16),
              y: clamp(e.y - Math.sin(sa) * 190, PLAYABLE_MIN_Y + 16, PLAYABLE_MAX_Y - 16),
              endX: clamp(e.x + Math.cos(sa) * 190, PLAYABLE_MIN_X + 16, PLAYABLE_MAX_X - 16),
              endY: clamp(e.y + Math.sin(sa) * 190, PLAYABLE_MIN_Y + 16, PLAYABLE_MAX_Y - 16),
              angle: sa,
              arcSpan: 0,
              radius: 17,
              damage: effDmg,
              ticksLeft: 14,
              maxTicks: 14,
              activeDelayTicks: 28,
              color: '#ff3b78',
              hitPlayer: false,
            });
          }
          const blinksDone = Math.floor(e.patternIndex / 100) + 1;
          if (blinksDone < 2) {
            e.patternIndex = (e.patternIndex % 100) + blinksDone * 100;
            e.state = 'windup';
            e.stateTimer = p2 ? 16 : 20;
            e.targetX = state.player.x;
            e.targetY = state.player.y;
            emitDashTelegraph(state, e.x, e.y, dirX, dirY, 340, 14, e.stateTimer, '#ff427b');
          } else {
            e.patternIndex = (e.patternIndex % 100) + 1;
            e.state = 'recover';
            e.stateTimer = 22;
            e.attackCooldown = p2 ? 62 : 88;
          }
        }
      } else if (e.state === 'recover') {
        e.vx *= 0.82;
        e.vy *= 0.82;
        e.stateTimer -= 1;
        if (e.stateTimer <= 0) e.state = 'move';
      } else {
        e.vx = dirX * effSpeed * 1.06;
        e.vy = dirY * effSpeed * 1.06;
        if (e.attackCooldown <= 0) {
          e.state = 'windup';
          e.stateTimer = pattern === 0 ? (p2 ? 20 : 24) : 18;
          e.targetX = state.player.x;
          e.targetY = state.player.y;
          if (pattern === 0) {
            emitDashTelegraph(state, e.x, e.y, dirX, dirY, 340, 14, e.stateTimer, '#ff427b');
          }
        }
      }
      break;
    }

    // 6. MOM: Brood summons + bouncing orb barrages
    case 'elite_mom': {
      e.vx = dirX * effSpeed * 0.85;
      e.vy = dirY * effSpeed * 0.85;
      if (e.attackCooldown <= 0) {
        const pattern = e.patternIndex % 2;
        if (pattern === 0) {
          // Brood Summons + defensive ring
          fireEnemyRadialRing(state, e.x, e.y, p2 ? 12 : 8, 250, effDmg, e.patternIndex * 0.4, 8, 200, '#ff66d9');
          const summonCount = p2 ? 4 : 2;
          for (let s = 0; s < summonCount; s++) {
            if (state.enemies.length + newSpawns.length >= MAX_ENEMIES) break;
            const a = nextRand(state) * Math.PI * 2;
            const childId = p2 && s % 2 === 1 ? 'chaser' : 'baby_alien';
            const child = createEnemyInstance(
              state,
              catalog,
              childId,
              e.x + Math.cos(a) * 58,
              e.y + Math.sin(a) * 58,
              true,
            );
            if (child) newSpawns.push(child);
          }
        } else {
          // Bouncing Orb Barrage: wall-ricocheting magenta brood orbs + bounce pod zones
          const orbCount = p2 ? 10 : 6;
          for (let k = 0; k < orbCount; k++) {
            const ang = angleToPlayer + ((k / orbCount) - 0.5) * Math.PI * 1.45;
            fireEnemyBouncingOrb(
              state,
              e.x,
              e.y,
              ang,
              p2 ? 320 : 280,
              effDmg,
              2,
              9,
              320,
              '#ff5ce6',
            );
          }
          const podCount = p2 ? 3 : 2;
          for (let z = 0; z < podCount; z++) {
            const ox = clamp(state.player.x + randRange(state, -190, 190), PLAYABLE_MIN_X + 70, PLAYABLE_MAX_X - 70);
            const oy = clamp(state.player.y + randRange(state, -190, 190), PLAYABLE_MIN_Y + 70, PLAYABLE_MAX_Y - 70);
            state.hazards.push({
              uid: allocUid(state),
              kind: 'boss_orb_zone',
              owner: 'enemy',
              x: ox,
              y: oy,
              endX: ox,
              endY: oy,
              angle: 0,
              arcSpan: Math.PI * 2,
              radius: 76,
              damage: effDmg,
              ticksLeft: 16,
              maxTicks: 16,
              activeDelayTicks: 46,
              color: '#ff66e0',
              hitPlayer: false,
            });
          }
        }
        e.patternIndex += 1;
        e.attackCooldown = p2 ? 105 : 142;
      }
      break;
    }

    // 7. MONK: Orbital shield ring bursts + sweeping lane shots
    case 'elite_monk': {
      const strafe = e.patternIndex % 2 === 0 ? 1 : -1;
      if (e.state === 'attack') {
        e.vx *= 0.82;
        e.vy *= 0.82;
        e.stateTimer -= 1;
        if (e.stateTimer <= 0) {
          // Second counter-offset orbital shield ring
          fireEnemyRadialRing(
            state,
            e.x,
            e.y,
            p2 ? 12 : 8,
            325,
            effDmg,
            angleToPlayer + Math.PI / (p2 ? 12 : 8),
            8,
            215,
            '#59f2ff',
          );
          e.patternIndex += 1;
          e.state = 'move';
          e.attackCooldown = p2 ? 78 : 112;
        }
      } else {
        if (distToPlayer < 230) {
          e.vx = -dirX * effSpeed;
          e.vy = -dirY * effSpeed;
        } else {
          e.vx = (-dirY * 0.78 * strafe + dirX * 0.4) * effSpeed;
          e.vy = (dirX * 0.78 * strafe + dirY * 0.4) * effSpeed;
        }

        if (e.attackCooldown <= 0) {
          if (e.patternIndex % 2 === 0) {
            // Orbital Shield Ring Burst + protective energy ring
            state.hazards.push({
              uid: allocUid(state),
              kind: 'boss_ring',
              owner: 'enemy',
              x: e.x,
              y: e.y,
              endX: e.x,
              endY: e.y,
              angle: 0,
              arcSpan: Math.PI * 2,
              radius: p2 ? 185 : 150,
              damage: effDmg,
              ticksLeft: 16,
              maxTicks: 16,
              activeDelayTicks: 34,
              color: '#5ce6ff',
              hitPlayer: false,
            });
            fireEnemyRadialRing(state, e.x, e.y, p2 ? 12 : 8, 275, effDmg, angleToPlayer, 8, 215, '#73d9ff');
            e.state = 'attack';
            e.stateTimer = 18;
          } else {
            // Sweeping Lane Shots: geometric beam lanes + parallel lane projectile volleys
            const lanes = p2 ? 6 : 4;
            const rot = e.patternIndex * 0.45;
            for (let k = 0; k < lanes; k++) {
              const a = rot + (k / lanes) * Math.PI * 2;
              state.hazards.push({
                uid: allocUid(state),
                kind: 'boss_beam',
                owner: 'enemy',
                x: e.x,
                y: e.y,
                endX: clamp(e.x + Math.cos(a) * 680, PLAYABLE_MIN_X + 16, PLAYABLE_MAX_X - 16),
                endY: clamp(e.y + Math.sin(a) * 680, PLAYABLE_MIN_Y + 16, PLAYABLE_MAX_Y - 16),
                angle: a,
                arcSpan: 0,
                radius: 17,
                damage: effDmg,
                ticksLeft: 18,
                maxTicks: 18,
                activeDelayTicks: 42,
                color: '#66d9ff',
                hitPlayer: false,
              });
            }
            // Parallel sweeping volley perpendicular to player vector
            const perpX = -dirY;
            const perpY = dirX;
            const shotCount = p2 ? 5 : 3;
            for (let s = 0; s < shotCount; s++) {
              const offset = (s - (shotCount - 1) / 2) * 34;
              spawnEnemyProjectile(
                state,
                clamp(e.x + perpX * offset, PLAYABLE_MIN_X + 16, PLAYABLE_MAX_X - 16),
                clamp(e.y + perpY * offset, PLAYABLE_MIN_Y + 16, PLAYABLE_MAX_Y - 16),
                dirX * 385,
                dirY * 385,
                8,
                effDmg,
                210,
                '#ffe066',
              );
            }
            e.patternIndex += 1;
            e.attackCooldown = p2 ? 82 : 115;
          }
        }
      }
      break;
    }

    // 8. RHINO: High-speed armored wall-to-wall stampede + radial debris
    case 'elite_rhino': {
      if (e.state === 'windup') {
        e.vx *= 0.65;
        e.vy *= 0.65;
        e.stateTimer -= 1;
        if (e.stateTimer <= 0) {
          const dx = e.targetX - e.x;
          const dy = e.targetY - e.y;
          const len = Math.hypot(dx, dy) || 1;
          const stampedeSpd = effSpeed * (p2 ? 3.9 : 3.55);
          e.vx = (dx / len) * stampedeSpd;
          e.vy = (dy / len) * stampedeSpd;
          e.state = 'dash';
          e.stateTimer = 58;
        }
      } else if (e.state === 'dash') {
        e.stateTimer -= 1;
        // Kick up perpendicular debris shards while stampeding
        if (e.stateTimer % 7 === 0) {
          const perp = Math.atan2(e.vy, e.vx) + Math.PI / 2;
          spawnEnemyProjectile(state, e.x, e.y, Math.cos(perp) * 255, Math.sin(perp) * 255, 8, effDmg, 160, '#ff944d');
          spawnEnemyProjectile(state, e.x, e.y, -Math.cos(perp) * 255, -Math.sin(perp) * 255, 8, effDmg, 160, '#ff944d');
        }
        // Detect wall collision for full wall-to-wall stampede impact!
        const nextX = e.x + e.vx * FIXED_DT;
        const nextY = e.y + e.vy * FIXED_DT;
        const hitWall =
          nextX <= PLAYABLE_MIN_X + e.radius + 4 ||
          nextX >= PLAYABLE_MAX_X - e.radius - 4 ||
          nextY <= PLAYABLE_MIN_Y + e.radius + 4 ||
          nextY >= PLAYABLE_MAX_Y - e.radius - 4;

        if (hitWall || e.stateTimer <= 0) {
          // Massive radial debris explosion on wall impact / stop
          fireEnemyRadialRing(
            state,
            e.x,
            e.y,
            p2 ? 16 : 12,
            p2 ? 350 : 300,
            effDmg,
            angleToPlayer,
            9,
            195,
            '#ff7e38',
          );
          if (hitWall) {
            state.camera.shakeTrauma = Math.min(1, state.camera.shakeTrauma + 0.35);
          }
          e.patternIndex += 1;
          if (p2 && e.patternIndex % 2 === 1) {
            // Phase 2 chain stampede across the arena
            e.state = 'windup';
            e.stateTimer = 26;
            e.targetX = state.player.x;
            e.targetY = state.player.y;
            emitDashTelegraph(state, e.x, e.y, dirX, dirY, 720, 20, 26, '#ff8533');
          } else {
            e.state = 'recover';
            e.stateTimer = 34;
            e.attackCooldown = p2 ? 80 : 112;
          }
        }
      } else if (e.state === 'recover') {
        e.vx *= 0.82;
        e.vy *= 0.82;
        e.stateTimer -= 1;
        if (e.stateTimer <= 0) e.state = 'move';
      } else {
        e.vx = dirX * effSpeed;
        e.vy = dirY * effSpeed;
        if (e.attackCooldown <= 0) {
          e.state = 'windup';
          e.stateTimer = p2 ? 32 : 40;
          e.targetX = state.player.x;
          e.targetY = state.player.y;
          emitDashTelegraph(state, e.x, e.y, dirX, dirY, 720, 20, e.stateTimer, '#ff8533');
        }
      }
      break;
    }

    default: {
      e.vx = dirX * effSpeed;
      e.vy = dirY * effSpeed;
      break;
    }
  }
}

/**
 * Updates all basic and elite enemies (bosses are handled in `bosses.ts`),
 * bounces wall-ricocheting enemy orbs, handles Bloated Spawner death pops,
 * applies knockback decay, soft swarm separation, strict arena clamping,
 * player contact damage, and prunes dead enemies.
 */
export function updateEnemies(
  state: SimState,
  catalog: GameDataCatalog,
  bossUpdater?: (e: EnemyState, newSpawns: EnemyState[]) => void,
): void {
  const player = state.player;
  const pHurtX = player.x;
  const pHurtY = player.y + PLAYER_HURT_OFFSET_Y;
  const newSpawns: EnemyState[] = [];

  // Wall-bounce reflection for ricocheting enemy projectiles (e.g., Elite Mom orbs)
  for (let i = 0; i < state.projectiles.length; i++) {
    const pr = state.projectiles[i];
    if (pr.owner !== 'enemy' || pr.bounceLeft <= 0) continue;
    const minX = PLAYABLE_MIN_X + pr.radius + 4;
    const maxX = PLAYABLE_MAX_X - pr.radius - 4;
    const minY = PLAYABLE_MIN_Y + pr.radius + 4;
    const maxY = PLAYABLE_MAX_Y - pr.radius - 4;
    let bounced = false;
    if (pr.x < minX) {
      pr.x = minX;
      pr.vx = Math.abs(pr.vx);
      bounced = true;
    } else if (pr.x > maxX) {
      pr.x = maxX;
      pr.vx = -Math.abs(pr.vx);
      bounced = true;
    }
    if (pr.y < minY) {
      pr.y = minY;
      pr.vy = Math.abs(pr.vy);
      bounced = true;
    } else if (pr.y > maxY) {
      pr.y = maxY;
      pr.vy = -Math.abs(pr.vy);
      bounced = true;
    }
    if (bounced) {
      pr.bounceLeft -= 1;
    }
  }

  for (let i = 0; i < state.enemies.length; i++) {
    const e = state.enemies[i];
    if (e.hp <= 0) {
      // Bloated Spawner death pop: bursts into 3 Baby Aliens + spore ring + acid splash
      if (state.screen === 'combat' && e.defId === 'bloated_spawner' && e.ageTicks > 0) {
        const effDmg = Math.max(1, Math.round(e.damage * e.buffDmgMult));
        for (let k = 0; k < 3; k++) {
          if (state.enemies.length + newSpawns.length >= MAX_ENEMIES) break;
          const a = (k / 3) * Math.PI * 2 + e.uid * 0.4;
          const child = createEnemyInstance(
            state,
            catalog,
            'baby_alien',
            e.x + Math.cos(a) * 28,
            e.y + Math.sin(a) * 28,
            e.spawnedFromBoss,
          );
          if (child) newSpawns.push(child);
        }
        fireEnemyRadialRing(state, e.x, e.y, 6, 225, effDmg, e.uid * 0.5, 7, 135, '#a3ff59');
        state.hazards.push({
          uid: allocUid(state),
          kind: 'acid_pool',
          owner: 'enemy',
          x: e.x,
          y: e.y,
          endX: e.x,
          endY: e.y,
          angle: 0,
          arcSpan: Math.PI * 2,
          radius: 50,
          damage: effDmg,
          ticksLeft: 95,
          maxTicks: 95,
          activeDelayTicks: 20,
          color: '#99ff4d',
          hitPlayer: false,
        });
      }
      continue;
    }

    e.prevX = e.x;
    e.prevY = e.y;
    e.ageTicks += 1;

    if (e.hitFlashTicks > 0) e.hitFlashTicks -= 1;
    if (e.attackCooldown > 0) e.attackCooldown -= 1;
    if (e.slowTicks > 0) e.slowTicks -= 1;
    if (e.buffedTicks > 0) {
      e.buffedTicks -= 1;
      if (e.buffedTicks === 0) {
        e.buffSpeedMult = 1;
        e.buffDmgMult = 1;
      }
    }

    const slowMult = e.slowTicks > 0 ? 0.6 : 1;
    const effSpeed = e.speed * e.buffSpeedMult * slowMult;

    const toPlayerX = player.x - e.x;
    const toPlayerY = player.y - e.y;
    const distToPlayer = Math.hypot(toPlayerX, toPlayerY);
    if (Math.abs(toPlayerX) > 4) {
      e.facingX = toPlayerX >= 0 ? 1 : -1;
    }

    if (e.kind === 'boss') {
      if (bossUpdater) {
        bossUpdater(e, newSpawns);
      } else {
        const inv = distToPlayer > 0.001 ? 1 / distToPlayer : 0;
        e.vx = toPlayerX * inv * effSpeed;
        e.vy = toPlayerY * inv * effSpeed;
      }
    } else if (e.kind === 'elite') {
      stepEliteBehavior(state, catalog, e, effSpeed, toPlayerX, toPlayerY, distToPlayer, newSpawns);
    } else {
      stepBasicBehavior(state, catalog, e, effSpeed, toPlayerX, toPlayerY, distToPlayer, newSpawns);
    }

    // Integrate velocity + knockback velocity
    e.x += (e.vx + e.kbVx) * FIXED_DT;
    e.y += (e.vy + e.kbVy) * FIXED_DT;
    e.kbVx *= 0.8;
    e.kbVy *= 0.8;
    if (Math.abs(e.kbVx) < 1) e.kbVx = 0;
    if (Math.abs(e.kbVy) < 1) e.kbVy = 0;

    // Strict arena playable clamp so ZERO enemies ever escape walls
    e.x = clamp(e.x, PLAYABLE_MIN_X + e.radius, PLAYABLE_MAX_X - e.radius);
    e.y = clamp(e.y, PLAYABLE_MIN_Y + e.radius, PLAYABLE_MAX_Y - e.radius);
  }

  // Lightweight deterministic swarm separation (O(N^2) capped at MAX_ENEMIES=100 -> <= 5000 pairs)
  const len = state.enemies.length;
  for (let i = 0; i < len; i++) {
    const a = state.enemies[i];
    if (a.hp <= 0 || a.behavior === 'egg') continue;
    for (let j = i + 1; j < len; j++) {
      const b = state.enemies[j];
      if (b.hp <= 0 || b.behavior === 'egg') continue;
      const minDist = (a.radius + b.radius) * 0.78;
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const dSq = dx * dx + dy * dy;
      if (dSq > 0.01 && dSq < minDist * minDist) {
        const d = Math.sqrt(dSq);
        const push = (minDist - d) * 0.28;
        const nx = dx / d;
        const ny = dy / d;
        if (a.kind !== 'boss') {
          a.x = clamp(a.x - nx * push, PLAYABLE_MIN_X + a.radius, PLAYABLE_MAX_X - a.radius);
          a.y = clamp(a.y - ny * push, PLAYABLE_MIN_Y + a.radius, PLAYABLE_MAX_Y - a.radius);
        }
        if (b.kind !== 'boss') {
          b.x = clamp(b.x + nx * push, PLAYABLE_MIN_X + b.radius, PLAYABLE_MAX_X - b.radius);
          b.y = clamp(b.y + ny * push, PLAYABLE_MIN_Y + b.radius, PLAYABLE_MAX_Y - b.radius);
        }
      }
    }
  }

  // Append newly spawned minions cleanly
  for (let i = 0; i < newSpawns.length; i++) {
    if (state.enemies.length < MAX_ENEMIES) {
      state.enemies.push(newSpawns[i]);
    }
  }

  // Contact collision against player hurtbox & prune dead enemies
  let writeIdx = 0;
  for (let i = 0; i < state.enemies.length; i++) {
    const e = state.enemies[i];
    if (e.hp <= 0) continue;

    if (state.screen === 'combat' && e.behavior !== 'looter' && e.behavior !== 'egg') {
      const hitR = e.radius + PLAYER_HURT_RADIUS - 2;
      const dx = e.x - pHurtX;
      const dy = e.y - pHurtY;
      if (dx * dx + dy * dy <= hitR * hitR) {
        const contactDmg = Math.max(1, Math.round(e.damage * e.buffDmgMult));
        damagePlayer(state, catalog, contactDmg, e.x, e.y, false);
      }
    }

    state.enemies[writeIdx] = e;
    writeIdx += 1;
  }
  state.enemies.length = writeIdx;
}
