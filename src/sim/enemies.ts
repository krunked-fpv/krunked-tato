// ============================================================================
// src/sim/enemies.ts — Basic Enemy & Elite AI State Machines + Arena Clamping
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
  const baseCd = def.attackCooldownTicks ?? (def.kind === 'elite' ? 120 : 110);

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
    knockbackResistance: def.kind === 'boss' ? 1.0 : clamp(def.knockbackResistance, 0, 1),
    facingX: 1,
    state: 'move',
    stateTimer: 0,
    attackCooldown: Math.max(20, Math.round(baseCd * randRange(state, 0.45, 0.95))),
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
      // Gentle sinusoidal weave keyed deterministically by uid
      const sway = Math.sin(e.ageTicks * 0.07 + e.uid) * 0.22;
      const moveAngle = angleToPlayer + sway;
      e.vx = Math.cos(moveAngle) * effSpeed;
      e.vy = Math.sin(moveAngle) * effSpeed;
      break;
    }

    case 'pursuer': {
      // Accelerates steadily the longer it hunts
      const ramp = 1 + Math.min(0.65, e.ageTicks / 600);
      e.vx = dirX * effSpeed * ramp;
      e.vy = dirY * effSpeed * ramp;
      break;
    }

    case 'junkie': {
      // Alternates slow stalk and erratic sprint bursts
      const cycle = (e.ageTicks + e.uid * 13) % 120;
      const mult = cycle < 45 ? 1.65 : 0.65;
      const wobble = Math.sin(e.ageTicks * 0.19 + e.uid) * 0.3;
      e.vx = Math.cos(angleToPlayer + wobble) * effSpeed * mult;
      e.vy = Math.sin(angleToPlayer + wobble) * effSpeed * mult;
      break;
    }

    case 'fin_alien': {
      // Flanking curved approach that tightens inward when close
      const curve = distToPlayer > 180 ? 0.55 * (e.uid % 2 === 0 ? 1 : -1) : 0;
      const a = angleToPlayer + curve;
      e.vx = Math.cos(a) * effSpeed * 1.08;
      e.vy = Math.sin(a) * effSpeed * 1.08;
      break;
    }

    case 'fly': {
      const flutter = Math.sin(e.ageTicks * 0.24 + e.uid * 1.7) * 0.62;
      const a = angleToPlayer + flutter;
      e.vx = Math.cos(a) * effSpeed;
      e.vy = Math.sin(a) * effSpeed;
      if (def?.projectileSpeed && e.attackCooldown <= 0 && distToPlayer < 420) {
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
        e.attackCooldown = Math.max(65, baseCd);
      }
      break;
    }

    case 'spitter': {
      if (e.state === 'windup') {
        e.vx *= 0.7;
        e.vy *= 0.7;
        e.stateTimer -= 1;
        if (e.stateTimer <= 0) {
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
          e.state = 'recover';
          e.stateTimer = 18;
          e.attackCooldown = Math.max(60, baseCd);
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
          // Strafe gently while waiting for shot
          const strafe = e.uid % 2 === 0 ? 1 : -1;
          e.vx = -dirY * effSpeed * 0.45 * strafe;
          e.vy = dirX * effSpeed * 0.45 * strafe;
        }
        if (e.attackCooldown <= 0 && distToPlayer <= 520) {
          e.state = 'windup';
          e.stateTimer = 26;
        }
      }
      break;
    }

    case 'charger':
    case 'slasher': {
      const isSlasher = e.behavior === 'slasher';
      const triggerRange = isSlasher ? 220 : 390;
      const windupTicks = isSlasher ? 24 : 36;
      const dashTicks = isSlasher ? 18 : 28;
      const dashMult = isSlasher ? 2.8 : 3.1;

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
          e.state = 'recover';
          e.stateTimer = isSlasher ? 20 : 34;
          e.attackCooldown = Math.max(70, baseCd);
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
          // Emit clear directional dash telegraph line
          const dx = e.targetX - e.x;
          const dy = e.targetY - e.y;
          const len = Math.hypot(dx, dy) || 1;
          const dashLen = Math.min(340, effSpeed * dashMult * (dashTicks * FIXED_DT));
          state.hazards.push({
            uid: allocUid(state),
            kind: 'boss_beam',
            owner: 'enemy',
            x: e.x,
            y: e.y,
            endX: e.x + (dx / len) * dashLen,
            endY: e.y + (dy / len) * dashLen,
            angle: Math.atan2(dy, dx),
            arcSpan: 0,
            radius: Math.max(10, e.radius * 0.45),
            damage: 0, // Pure visual telegraph; body contact deals damage
            ticksLeft: 2,
            maxTicks: windupTicks,
            activeDelayTicks: windupTicks,
            color: '#ff4252',
            hitPlayer: true,
          });
        }
      }
      break;
    }

    case 'bruiser': {
      if (e.state === 'windup') {
        e.vx *= 0.65;
        e.vy *= 0.65;
        e.stateTimer -= 1;
        if (e.stateTimer <= 0) {
          fireEnemyRadialRing(state, e.x, e.y, 6, 260, effDmg, angleToPlayer, 8, 130, '#ff5940');
          e.state = 'recover';
          e.stateTimer = 26;
          e.attackCooldown = Math.max(120, baseCd);
        }
      } else if (e.state === 'recover') {
        e.vx *= 0.8;
        e.vy *= 0.8;
        e.stateTimer -= 1;
        if (e.stateTimer <= 0) e.state = 'move';
      } else {
        e.vx = dirX * effSpeed;
        e.vy = dirY * effSpeed;
        if (e.attackCooldown <= 0 && distToPlayer < 210) {
          e.state = 'windup';
          e.stateTimer = 30;
        }
      }
      break;
    }

    case 'helmet_alien': {
      // Steady armored marcher with periodic brief sprint burst
      const burst = (e.ageTicks + e.uid * 17) % 150 < 35 ? 1.45 : 0.92;
      e.vx = dirX * effSpeed * burst;
      e.vy = dirY * effSpeed * burst;
      break;
    }

    case 'lamprey': {
      // Spiraling rush with periodic lunge
      if (e.attackCooldown <= 0 && distToPlayer < 280) {
        e.vx = dirX * effSpeed * 2.2;
        e.vy = dirY * effSpeed * 2.2;
        e.attackCooldown = Math.max(60, baseCd);
        e.state = 'dash';
        e.stateTimer = 16;
      } else if (e.state === 'dash') {
        e.stateTimer -= 1;
        if (e.stateTimer <= 0) e.state = 'move';
      } else {
        const spiral = angleToPlayer + Math.sin(e.ageTicks * 0.14 + e.uid) * 0.48;
        e.vx = Math.cos(spiral) * effSpeed;
        e.vy = Math.sin(spiral) * effSpeed;
      }
      break;
    }

    case 'egg': {
      // Stationary cocoon that hatches into child enemy after ~4s
      e.vx = 0;
      e.vy = 0;
      if (e.ageTicks >= 240) {
        const childId = def?.spawnChildId ?? 'baby_alien';
        if (state.enemies.length + newSpawns.length < MAX_ENEMIES) {
          const child = createEnemyInstance(state, catalog, childId, e.x, e.y, e.spawnedFromBoss);
          if (child) newSpawns.push(child);
        }
        e.hp = 0; // Dissolve hatched egg without double kill drops
      }
      break;
    }

    case 'spawner': {
      // Maintains mid-range distance and periodically spawns children
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
        e.attackCooldown = Math.max(150, baseCd);
        if (state.enemies.length + newSpawns.length < MAX_ENEMIES) {
          const childId = def?.spawnChildId ?? 'baby_alien';
          const ox = randRange(state, -36, 36);
          const oy = randRange(state, -36, 36);
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
      }
      break;
    }

    case 'buffer': {
      // Orbits at safe mid-range and buffs nearby allies' speed & damage
      if (distToPlayer < 240) {
        e.vx = -dirX * effSpeed;
        e.vy = -dirY * effSpeed;
      } else if (distToPlayer > 440) {
        e.vx = dirX * effSpeed * 0.8;
        e.vy = dirY * effSpeed * 0.8;
      } else {
        const strafe = e.uid % 2 === 0 ? 1 : -1;
        e.vx = -dirY * effSpeed * 0.65 * strafe;
        e.vy = dirX * effSpeed * 0.65 * strafe;
      }
      if (e.attackCooldown <= 0) {
        e.attackCooldown = Math.max(90, baseCd);
        const auraRSq = 270 * 270;
        for (let j = 0; j < state.enemies.length; j++) {
          const ally = state.enemies[j];
          if (ally.hp <= 0 || ally.uid === e.uid) continue;
          const dx = ally.x - e.x;
          const dy = ally.y - e.y;
          if (dx * dx + dy * dy <= auraRSq) {
            ally.buffedTicks = Math.max(ally.buffedTicks, 180);
            ally.buffSpeedMult = Math.max(ally.buffSpeedMult, 1.28);
            ally.buffDmgMult = Math.max(ally.buffDmgMult, 1.25);
          }
        }
      }
      break;
    }

    case 'healer': {
      // Keeps distance from player and periodically heals wounded allies
      if (distToPlayer < 280) {
        e.vx = -dirX * effSpeed;
        e.vy = -dirY * effSpeed;
      } else {
        const strafe = e.uid % 2 === 0 ? 1 : -1;
        e.vx = (-dirY * 0.6 * strafe + dirX * 0.25) * effSpeed;
        e.vy = (dirX * 0.6 * strafe + dirY * 0.25) * effSpeed;
      }
      if (e.attackCooldown <= 0) {
        e.attackCooldown = Math.max(110, baseCd);
        const healRSq = 250 * 250;
        for (let j = 0; j < state.enemies.length; j++) {
          const ally = state.enemies[j];
          if (ally.hp <= 0 || ally.hp >= ally.maxHp) continue;
          const dx = ally.x - e.x;
          const dy = ally.y - e.y;
          if (dx * dx + dy * dy <= healRSq) {
            const healAmt = Math.max(1, Math.round(ally.maxHp * 0.12));
            ally.hp = Math.min(ally.maxHp, ally.hp + healAmt);
          }
        }
      }
      break;
    }

    case 'tentacle': {
      // Moves slowly and unleashes a telegraphed lash beam when player approaches
      e.vx = dirX * effSpeed * 0.45;
      e.vy = dirY * effSpeed * 0.45;
      if (e.attackCooldown <= 0 && distToPlayer <= 260) {
        e.attackCooldown = Math.max(110, baseCd);
        const lashLen = 230;
        state.hazards.push({
          uid: allocUid(state),
          kind: 'boss_beam',
          owner: 'enemy',
          x: e.x,
          y: e.y,
          endX: e.x + dirX * lashLen,
          endY: e.y + dirY * lashLen,
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
      break;
    }

    case 'looter': {
      // Flees away from the player while steering smoothly along walls (never corner-trapped)
      let fx = -dirX;
      let fy = -dirY;
      const wallPad = 160;
      if (e.x < PLAYABLE_MIN_X + wallPad) fx += 1.3;
      if (e.x > PLAYABLE_MAX_X - wallPad) fx -= 1.3;
      if (e.y < PLAYABLE_MIN_Y + wallPad) fy += 1.3;
      if (e.y > PLAYABLE_MAX_Y - wallPad) fy -= 1.3;
      const fLen = Math.hypot(fx, fy) || 1;
      e.vx = (fx / fLen) * effSpeed;
      e.vy = (fy / fLen) * effSpeed;
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
  }

  const p2 = e.phase >= 2;
  const dirX = distToPlayer > 0.001 ? toPlayerX / distToPlayer : 1;
  const dirY = distToPlayer > 0.001 ? toPlayerY / distToPlayer : 0;
  const angleToPlayer = Math.atan2(dirY, dirX);
  const effDmg = Math.max(1, Math.round(e.damage * e.buffDmgMult));

  switch (e.behavior) {
    case 'elite_butcher':
    case 'elite_rhino': {
      const isRhino = e.behavior === 'elite_rhino';
      if (e.state === 'windup') {
        e.vx *= 0.7;
        e.vy *= 0.7;
        e.stateTimer -= 1;
        if (e.stateTimer <= 0) {
          const dx = e.targetX - e.x;
          const dy = e.targetY - e.y;
          const len = Math.hypot(dx, dy) || 1;
          const dashSpd = effSpeed * (isRhino ? (p2 ? 3.5 : 3.1) : p2 ? 3.0 : 2.6);
          e.vx = (dx / len) * dashSpd;
          e.vy = (dy / len) * dashSpd;
          e.state = 'dash';
          e.stateTimer = isRhino ? 38 : 26;
        }
      } else if (e.state === 'dash') {
        e.stateTimer -= 1;
        if (isRhino && e.stateTimer % 8 === 0) {
          const perp = Math.atan2(e.vy, e.vx) + Math.PI / 2;
          spawnEnemyProjectile(state, e.x, e.y, Math.cos(perp) * 240, Math.sin(perp) * 240, 8, effDmg, 150);
          spawnEnemyProjectile(state, e.x, e.y, -Math.cos(perp) * 240, -Math.sin(perp) * 240, 8, effDmg, 150);
        }
        if (e.stateTimer <= 0) {
          fireEnemyRadialRing(
            state,
            e.x,
            e.y,
            p2 ? 12 : 8,
            p2 ? 330 : 280,
            effDmg,
            angleToPlayer,
            9,
            180,
            '#ff3358',
          );
          e.patternIndex += 1;
          if (p2 && e.patternIndex % 2 === 1) {
            // Phase 2 immediate chain charge
            e.state = 'windup';
            e.stateTimer = 26;
            e.targetX = state.player.x;
            e.targetY = state.player.y;
          } else {
            e.state = 'recover';
            e.stateTimer = 34;
            e.attackCooldown = p2 ? 85 : 115;
          }
        }
      } else if (e.state === 'recover') {
        e.vx *= 0.84;
        e.vy *= 0.84;
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
          const dashLen = isRhino ? 520 : 380;
          state.hazards.push({
            uid: allocUid(state),
            kind: 'boss_beam',
            owner: 'enemy',
            x: e.x,
            y: e.y,
            endX: e.x + dirX * dashLen,
            endY: e.y + dirY * dashLen,
            angle: angleToPlayer,
            arcSpan: 0,
            radius: Math.max(16, e.radius * 0.5),
            damage: 0,
            ticksLeft: 2,
            maxTicks: e.stateTimer,
            activeDelayTicks: e.stateTimer,
            color: '#ff3b52',
            hitPlayer: true,
          });
        }
      }
      break;
    }

    case 'elite_colossus': {
      e.vx = dirX * effSpeed * (e.state === 'windup' ? 0.25 : 1);
      e.vy = dirY * effSpeed * (e.state === 'windup' ? 0.25 : 1);
      if (e.state === 'windup') {
        e.stateTimer -= 1;
        if (e.stateTimer <= 0) {
          fireEnemyRadialRing(state, e.x, e.y, p2 ? 14 : 10, 290, effDmg, e.patternIndex * 0.35, 9, 210);
          e.patternIndex += 1;
          e.state = 'move';
          e.attackCooldown = p2 ? 80 : 115;
        }
      } else if (e.attackCooldown <= 0) {
        e.state = 'windup';
        e.stateTimer = 38;
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
          radius: p2 ? 230 : 185,
          damage: effDmg,
          ticksLeft: 14,
          maxTicks: 14,
          activeDelayTicks: 38,
          color: '#ff4d3b',
          hitPlayer: false,
        });
      }
      break;
    }

    case 'elite_croc':
    case 'elite_mantis': {
      const isMantis = e.behavior === 'elite_mantis';
      if (e.state === 'windup') {
        e.vx *= 0.65;
        e.vy *= 0.65;
        e.stateTimer -= 1;
        if (e.stateTimer <= 0) {
          if (e.patternIndex % 2 === 0) {
            const dx = e.targetX - e.x;
            const dy = e.targetY - e.y;
            const len = Math.hypot(dx, dy) || 1;
            e.vx = (dx / len) * effSpeed * (isMantis ? 3.4 : 2.9);
            e.vy = (dy / len) * effSpeed * (isMantis ? 3.4 : 2.9);
            e.state = 'dash';
            e.stateTimer = 24;
          } else {
            fireEnemyFan(state, e.x, e.y, angleToPlayer, p2 ? 7 : 5, 1.15, 360, effDmg, 8, 190);
            e.state = 'move';
            e.attackCooldown = p2 ? 72 : 100;
          }
          e.patternIndex += 1;
        }
      } else if (e.state === 'dash') {
        e.stateTimer -= 1;
        if (e.stateTimer <= 0) {
          if (isMantis) {
            // Crisscrossing telegraphed slash beam behind dash
            state.hazards.push({
              uid: allocUid(state),
              kind: 'boss_beam',
              owner: 'enemy',
              x: e.x - dirX * 220,
              y: e.y - dirY * 220,
              endX: e.x + dirX * 220,
              endY: e.y + dirY * 220,
              angle: angleToPlayer,
              arcSpan: 0,
              radius: 20,
              damage: effDmg,
              ticksLeft: 16,
              maxTicks: 16,
              activeDelayTicks: 32,
              color: '#ff3b78',
              hitPlayer: false,
            });
          }
          e.state = 'recover';
          e.stateTimer = 24;
          e.attackCooldown = p2 ? 68 : 96;
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
          e.stateTimer = 30;
          e.targetX = state.player.x;
          e.targetY = state.player.y;
        }
      }
      break;
    }

    case 'elite_gargoyle':
    case 'elite_monk': {
      // Arcane/gliding elites: orbit player, fire rotating beams & orb zones
      const strafe = e.patternIndex % 2 === 0 ? 1 : -1;
      if (distToPlayer < 220) {
        e.vx = -dirX * effSpeed;
        e.vy = -dirY * effSpeed;
      } else {
        e.vx = (-dirY * 0.75 * strafe + dirX * 0.45) * effSpeed;
        e.vy = (dirX * 0.75 * strafe + dirY * 0.45) * effSpeed;
      }
      if (e.attackCooldown <= 0) {
        if (e.patternIndex % 2 === 0) {
          // Cross beams
          const lanes = p2 ? 6 : 4;
          const rot = e.patternIndex * 0.4;
          for (let k = 0; k < lanes; k++) {
            const a = rot + (k / lanes) * Math.PI * 2;
            state.hazards.push({
              uid: allocUid(state),
              kind: 'boss_beam',
              owner: 'enemy',
              x: e.x,
              y: e.y,
              endX: e.x + Math.cos(a) * 650,
              endY: e.y + Math.sin(a) * 650,
              angle: a,
              arcSpan: 0,
              radius: 18,
              damage: effDmg,
              ticksLeft: 18,
              maxTicks: 18,
              activeDelayTicks: 44,
              color: '#ff3666',
              hitPlayer: false,
            });
          }
        } else {
          // Orb zones + ring burst
          fireEnemyRadialRing(state, e.x, e.y, p2 ? 12 : 8, 310, effDmg, angleToPlayer, 8, 210);
          const zones = p2 ? 3 : 2;
          for (let z = 0; z < zones; z++) {
            const ox = clamp(
              state.player.x + randRange(state, -220, 220),
              PLAYABLE_MIN_X + 70,
              PLAYABLE_MAX_X - 70,
            );
            const oy = clamp(
              state.player.y + randRange(state, -220, 220),
              PLAYABLE_MIN_Y + 70,
              PLAYABLE_MAX_Y - 70,
            );
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
              radius: 82,
              damage: effDmg,
              ticksLeft: 16,
              maxTicks: 16,
              activeDelayTicks: 46,
              color: '#d936ff',
              hitPlayer: false,
            });
          }
        }
        e.patternIndex += 1;
        e.attackCooldown = p2 ? 85 : 120;
      }
      break;
    }

    case 'elite_mom': {
      // Brood mother: stalks steadily, summons children + radial defensive rings
      e.vx = dirX * effSpeed * 0.85;
      e.vy = dirY * effSpeed * 0.85;
      if (e.attackCooldown <= 0) {
        fireEnemyRadialRing(state, e.x, e.y, p2 ? 12 : 8, 250, effDmg, e.patternIndex * 0.4, 8, 200);
        const summonCount = p2 ? 3 : 2;
        for (let s = 0; s < summonCount; s++) {
          if (state.enemies.length + newSpawns.length >= MAX_ENEMIES) break;
          const a = nextRand(state) * Math.PI * 2;
          const child = createEnemyInstance(
            state,
            catalog,
            'baby_alien',
            e.x + Math.cos(a) * 55,
            e.y + Math.sin(a) * 55,
            true,
          );
          if (child) newSpawns.push(child);
        }
        e.patternIndex += 1;
        e.attackCooldown = p2 ? 115 : 155;
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

  for (let i = 0; i < state.enemies.length; i++) {
    const e = state.enemies[i];
    if (e.hp <= 0) continue;

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
