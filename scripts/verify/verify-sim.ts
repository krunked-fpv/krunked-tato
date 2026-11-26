// ============================================================================
// scripts/verify/verify-sim.ts — Gate B Headless Campaign & Replay Soak
// Autonomous deterministic AI plays full campaigns (20W + Endless W25, D5
// Double Boss, D6 Nightmare, iconic builds) and verifies bit-exact replay
// determinism plus strict per-tick spatial, cap, NaN, and softlock invariants.
// ============================================================================

import {
  ARENA_H,
  ARENA_W,
  CORE_STAT_KEYS,
  MAX_ENEMIES,
  MAX_GOLDS,
  PLAYABLE_MAX_X,
  PLAYABLE_MAX_Y,
  PLAYABLE_MIN_X,
  PLAYABLE_MIN_Y,
  type CoreStatKey,
  type GameScreen,
  type InputFrame,
  type SimCommand,
  type SimState,
} from '../../src/contracts/index.ts';
import { GAME_CATALOG } from '../../src/data/index.ts';
import {
  applySimCommand,
  createInitialSimState,
  hashSimState,
  startNewRun,
  stepSim,
} from '../../src/sim/index.ts';

function assert(cond: boolean, msg: string): void {
  if (!cond) {
    throw new Error(`[verify:sim] ASSERTION FAILED: ${msg}`);
  }
}

function isFiniteNum(v: number): boolean {
  return typeof v === 'number' && Number.isFinite(v);
}

// ----------------------------------------------------------------------------
// Strict Per-Tick Invariant Verifier (runs on EVERY tick of EVERY soak run)
// ----------------------------------------------------------------------------
function assertTickInvariants(state: SimState, label: string): void {
  const p = state.player;
  assert(
    isFiniteNum(p.x) &&
      isFiniteNum(p.y) &&
      isFiniteNum(p.vx) &&
      isFiniteNum(p.vy) &&
      isFiniteNum(p.hp) &&
      isFiniteNum(p.maxHp) &&
      isFiniteNum(p.xp) &&
      isFiniteNum(p.materials),
    `${label} tick=${state.tick} W${state.wave}: NaN/Infinity in player state`,
  );
  assert(
    p.x >= PLAYABLE_MIN_X && p.x <= PLAYABLE_MAX_X && p.y >= PLAYABLE_MIN_Y && p.y <= PLAYABLE_MAX_Y,
    `${label} tick=${state.tick} W${state.wave}: player out of bounds (${p.x.toFixed(1)}, ${p.y.toFixed(1)})`,
  );
  for (let s = 0; s < CORE_STAT_KEYS.length; s++) {
    const k = CORE_STAT_KEYS[s];
    assert(
      isFiniteNum(p.computedStats[k]),
      `${label} tick=${state.tick} W${state.wave}: NaN/Infinity in player.computedStats.${k}`,
    );
  }

  // Camera finiteness
  const cam = state.camera;
  assert(
    isFiniteNum(cam.x) &&
      isFiniteNum(cam.y) &&
      isFiniteNum(cam.shakeTrauma) &&
      isFiniteNum(cam.shakeOffsetX) &&
      isFiniteNum(cam.shakeOffsetY) &&
      isFiniteNum(cam.zoom),
    `${label} tick=${state.tick} W${state.wave}: NaN/Infinity in camera state`,
  );

  // Enemy cap + finiteness + playable bounds
  assert(
    state.enemies.length <= MAX_ENEMIES,
    `${label} tick=${state.tick} W${state.wave}: state.enemies.length=${state.enemies.length} > MAX_ENEMIES=${MAX_ENEMIES}`,
  );
  for (let i = 0; i < state.enemies.length; i++) {
    const e = state.enemies[i];
    assert(
      isFiniteNum(e.x) &&
        isFiniteNum(e.y) &&
        isFiniteNum(e.vx) &&
        isFiniteNum(e.vy) &&
        isFiniteNum(e.hp) &&
        isFiniteNum(e.maxHp) &&
        isFiniteNum(e.damage) &&
        isFiniteNum(e.speed),
      `${label} tick=${state.tick} W${state.wave}: NaN/Infinity in enemy ${e.defId}#${e.uid}`,
    );
    assert(
      e.x >= PLAYABLE_MIN_X && e.x <= PLAYABLE_MAX_X && e.y >= PLAYABLE_MIN_Y && e.y <= PLAYABLE_MAX_Y,
      `${label} tick=${state.tick} W${state.wave}: enemy ${e.defId}#${e.uid} out of bounds (${e.x.toFixed(1)}, ${e.y.toFixed(1)})`,
    );
  }

  // Projectiles finiteness
  for (let i = 0; i < state.projectiles.length; i++) {
    const pr = state.projectiles[i];
    assert(
      isFiniteNum(pr.x) && isFiniteNum(pr.y) && isFiniteNum(pr.vx) && isFiniteNum(pr.vy) && isFiniteNum(pr.damage),
      `${label} tick=${state.tick} W${state.wave}: NaN/Infinity in projectile#${pr.uid}`,
    );
  }

  // Pickups finiteness + playable bounds + MAX_GOLDS cap
  let matCount = 0;
  for (let i = 0; i < state.pickups.length; i++) {
    const pk = state.pickups[i];
    if (pk.kind === 'material') matCount += 1;
    assert(
      isFiniteNum(pk.x) &&
        isFiniteNum(pk.y) &&
        isFiniteNum(pk.vx) &&
        isFiniteNum(pk.vy) &&
        isFiniteNum(pk.value) &&
        isFiniteNum(pk.scale),
      `${label} tick=${state.tick} W${state.wave}: NaN/Infinity in pickup#${pk.uid}`,
    );
    assert(
      pk.x >= PLAYABLE_MIN_X && pk.x <= PLAYABLE_MAX_X && pk.y >= PLAYABLE_MIN_Y && pk.y <= PLAYABLE_MAX_Y,
      `${label} tick=${state.tick} W${state.wave}: pickup#${pk.uid} out of bounds (${pk.x.toFixed(1)}, ${pk.y.toFixed(1)})`,
    );
  }
  assert(
    matCount <= MAX_GOLDS,
    `${label} tick=${state.tick} W${state.wave}: material pickups=${matCount} > MAX_GOLDS=${MAX_GOLDS}`,
  );
}

// ----------------------------------------------------------------------------
// Autonomous AI Combat Steering & Economy Decision Driver
// ----------------------------------------------------------------------------
function computeAiCombatInput(state: SimState): InputFrame {
  const p = state.player;
  const px = p.x;
  const py = p.y;
  const cx = ARENA_W * 0.5;
  const cy = ARENA_H * 0.5;

  let fx = 0;
  let fy = 0;

  // 1. Repel from nearby enemies (stronger for close threats & bosses)
  const isBull = p.characterId === 'bull';
  for (let i = 0; i < state.enemies.length; i++) {
    const e = state.enemies[i];
    if (e.hp <= 0) continue;
    const dx = px - e.x;
    const dy = py - e.y;
    const distSq = dx * dx + dy * dy;
    const dangerRadius = e.kind === 'boss' ? 360 : e.kind === 'elite' ? 300 : 240;
    if (distSq < dangerRadius * dangerRadius && distSq > 1) {
      const dist = Math.sqrt(distSq);
      const weight = ((dangerRadius - dist) / dangerRadius) * (e.kind === 'boss' ? 4.2 : 2.6);
      // Bull occasionally bumps a basic mob if healthy to trigger AoE explosion
      const bullSign = isBull && e.kind === 'basic' && p.hp > p.maxHp * 0.72 && dist > 30 ? -0.35 : 1.0;
      fx += (dx / dist) * weight * bullSign;
      fy += (dy / dist) * weight * bullSign;
    }
  }

  // 2. Dodge enemy projectiles aggressively (perpendicular + away)
  for (let i = 0; i < state.projectiles.length; i++) {
    const pr = state.projectiles[i];
    if (pr.owner !== 'enemy') continue;
    const dx = px - pr.x;
    const dy = py - pr.y;
    const distSq = dx * dx + dy * dy;
    if (distSq < 210 * 210 && distSq > 1) {
      const dist = Math.sqrt(distSq);
      const w = ((210 - dist) / 210) * 5.0;
      fx += (dx / dist) * w;
      fy += (dy / dist) * w;
    }
  }

  // 3. Dodge active/telegraphed enemy hazards (beams, rings, orb zones, fog pulses)
  for (let i = 0; i < state.hazards.length; i++) {
    const hz = state.hazards[i];
    if (hz.owner !== 'enemy' || hz.damage <= 0) continue;
    const dx = px - hz.x;
    const dy = py - hz.y;
    const dist = Math.hypot(dx, dy) || 1;
    const avoidR = hz.radius + 90;
    if (dist < avoidR) {
      const w = ((avoidR - dist) / avoidR) * 4.5;
      fx += (dx / dist) * w;
      fy += (dy / dist) * w;
    }
  }

  // 4. Seek safe crates, healing fruits (when hurt), and nearby materials
  let bestPickupScore = 0;
  let bestPkX = 0;
  let bestPkY = 0;
  for (let i = 0; i < state.pickups.length; i++) {
    const pk = state.pickups[i];
    const dx = pk.x - px;
    const dy = pk.y - py;
    const dist = Math.hypot(dx, dy) || 1;
    let priority = 0;
    if (pk.kind === 'legendary_crate' || pk.kind === 'crate') {
      priority = 3.2;
    } else if (pk.kind === 'consumable' && p.hp < p.maxHp * 0.85) {
      priority = 3.5;
    } else if (pk.kind === 'material' && dist < 420) {
      priority = 1.1;
    }
    if (priority > 0) {
      const score = priority / (1 + dist / 220);
      if (score > bestPickupScore) {
        bestPickupScore = score;
        bestPkX = dx / dist;
        bestPkY = dy / dist;
      }
    }
  }
  if (bestPickupScore > 0) {
    fx += bestPkX * Math.min(2.0, bestPickupScore * 1.4);
    fy += bestPkY * Math.min(2.0, bestPickupScore * 1.4);
  }

  // 5. Wall avoidance + gentle orbit around arena center to avoid getting cornered
  const margin = 220;
  if (px < PLAYABLE_MIN_X + margin) fx += ((PLAYABLE_MIN_X + margin - px) / margin) * 3.8;
  if (px > PLAYABLE_MAX_X - margin) fx -= ((px - (PLAYABLE_MAX_X - margin)) / margin) * 3.8;
  if (py < PLAYABLE_MIN_Y + margin) fy += ((PLAYABLE_MIN_Y + margin - py) / margin) * 3.8;
  if (py > PLAYABLE_MAX_Y - margin) fy -= ((py - (PLAYABLE_MAX_Y - margin)) / margin) * 3.8;

  // Tangential kite drift around center so player never stalls in corners
  const rdx = px - cx;
  const rdy = py - cy;
  const rLen = Math.hypot(rdx, rdy) || 1;
  fx += (-rdy / rLen) * 0.9 - (rdx / rLen) * (rLen > 520 ? 0.8 : 0.1);
  fy += (rdx / rLen) * 0.9 - (rdy / rLen) * (rLen > 520 ? 0.8 : 0.1);

  const fLen = Math.hypot(fx, fy);
  const moveX = fLen > 0.01 ? fx / fLen : 0;
  const moveY = fLen > 0.01 ? fy / fLen : 0;

  return {
    moveX,
    moveY,
    aimX: 0,
    aimY: 0,
    aimActive: false,
    aimWorldX: 0,
    aimWorldY: 0,
    hasWorldAim: false,
    toggleAutoAimPressed: false,
    pausePressed: false,
    statsHeld: false,
    activeInputMode: 'keyboard',
  };
}

function pickBestLevelUpIndex(state: SimState): number {
  const charId = state.player.characterId;
  const weights: Partial<Record<CoreStatKey, number>> = {
    stat_max_hp: 16,
    stat_armor: 15,
    stat_hp_regen: 13,
    stat_dodge: 12,
    stat_speed: 10,
    stat_lifesteal: 11,
    stat_percent_damage: 13,
    stat_attack_speed: 12,
    stat_melee_damage: charId === 'knight' || charId === 'multitasker' || charId === 'one_arm' ? 17 : 8,
    stat_ranged_damage: charId === 'well_rounded' ? 14 : 6,
    stat_engineering: charId === 'engineer' ? 20 : 4,
    stat_harvesting: state.wave <= 10 ? 12 : 3,
    stat_luck: 8,
    stat_crit_chance: 9,
    stat_range: 6,
    stat_elemental_damage: 5,
  };
  if (charId === 'bull' || charId === 'pacifist') {
    weights.stat_max_hp = 22;
    weights.stat_armor = 22;
    weights.stat_hp_regen = 22;
    weights.stat_dodge = 20;
    weights.stat_speed = 18;
  }

  let bestIdx = 0;
  let bestScore = -Infinity;
  for (let i = 0; i < state.levelUp.offers.length; i++) {
    const u = state.levelUp.offers[i];
    const score = (weights[u.statKey] ?? 5) * (1 + u.tier * 0.45);
    if (score > bestScore) {
      bestScore = score;
      bestIdx = i;
    }
  }
  return bestIdx;
}

function runShopTurn(state: SimState, commandLog?: Array<{ tick: number; cmd: SimCommand }>): void {
  const dispatch = (cmd: SimCommand): void => {
    applySimCommand(state, cmd);
    if (commandLog) commandLog.push({ tick: state.tick, cmd });
  };

  // 1. Combine any identical weapons to scale DPS cleanly
  for (let guard = 0; guard < 16; guard++) {
    let combined = false;
    for (let i = 0; i < state.player.weapons.length; i++) {
      const a = state.player.weapons[i];
      if (a.tier >= 4) continue;
      const pair = state.player.weapons.find(
        (b, j) => j !== i && b.weaponId === a.weaponId && b.tier === a.tier,
      );
      if (pair) {
        dispatch({ type: 'shop_combine', weaponUid: a.uid });
        combined = true;
        break;
      }
    }
    if (!combined) break;
  }

  // 2. Buy affordable weapons first, then items (with HP safety reserve for Demon)
  const isDemon = state.player.computedStats.hp_shop > 0;
  const tryBuyAll = (): void => {
    const sortedSlots = state.shop.offers
      .map((o, idx) => ({ o, idx }))
      .sort((a, b) => (a.o.kind === 'weapon' ? 0 : 1) - (b.o.kind === 'weapon' ? 0 : 1));

    for (const { o, idx } of sortedSlots) {
      if (o.purchased) continue;
      if (isDemon) {
        if (state.player.maxHp - o.price < 16) continue;
      } else {
        if (state.player.materials < o.price) continue;
      }
      dispatch({ type: 'shop_buy', slotIndex: idx });
    }
  };

  tryBuyAll();

  // 3. One reroll if still flush with materials, then buy again
  if (!isDemon && (state.shop.freeRerollsLeft > 0 || state.player.materials >= state.shop.rerollCost + 35)) {
    dispatch({ type: 'shop_reroll' });
    tryBuyAll();
  }

  // 4. Advance to next wave
  dispatch({ type: 'shop_next_wave' });
}

interface CampaignSpec {
  label: string;
  characterId: string;
  weaponId: string;
  zoneId: 0 | 1 | 2;
  dangerLevel: number;
  seed: number;
  targetWave: number;
  verifyDoubleBoss?: boolean;
  verifyNightmareEvents?: boolean;
}

interface CampaignReport {
  label: string;
  wavesCleared: number;
  ticks: number;
  kills: number;
  bossesSeen: string[];
  nightmareEventsSeen: string[];
  finalHash: string;
}

function runAutonomousCampaign(spec: CampaignSpec): CampaignReport {
  const state = createInitialSimState(spec.seed);
  startNewRun(state, {
    type: 'start_run',
    characterId: spec.characterId,
    weaponId: spec.weaponId,
    zoneId: spec.zoneId,
    dangerLevel: spec.dangerLevel,
    seed: spec.seed,
  });

  const bossesSeen = new Set<string>();
  const nightmareEventsSeen = new Set<string>();
  let totalTicks = 0;
  let postWaveTransitions = 0;

  // Hard cap on ticks to guarantee zero infinite loops
  const maxTotalTicks = spec.targetWave * 6000 + 20000;

  const getScreen = (): GameScreen => state.screen;

  while (totalTicks < maxTotalTicks) {
    const screen = getScreen();
    if (screen === 'combat' || screen === 'wave_end') {
      const input = computeAiCombatInput(state);
      stepSim(state, input);
      totalTicks += 1;
      assertTickInvariants(state, spec.label);

      if (state.nightmareEvent !== 'none') {
        nightmareEventsSeen.add(state.nightmareEvent);
      }

      // Inspect Wave 20 bosses if present
      for (let i = 0; i < state.enemies.length; i++) {
        const e = state.enemies[i];
        if (e.kind === 'boss') {
          bossesSeen.add(e.defId);
          assert(
            e.knockbackResistance === 1.0,
            `${spec.label}: boss ${e.defId} knockbackResistance === 1.0 (got ${e.knockbackResistance})`,
          );
          if (spec.verifyNightmareEvents) {
            const def = GAME_CATALOG.enemiesById[e.defId];
            if (def) {
              const d0BaseHp = def.baseHp + def.hpPerWave * Math.max(0, state.wave - 1);
              assert(
                e.maxHp >= Math.round(d0BaseHp * 1.4),
                `${spec.label}: D6 boss ${e.defId} maxHp=${e.maxHp} did not scale with Nightmare multiplier (base=${d0BaseHp})`,
              );
            }
          }
        }
      }

      // Guard against wave_end softlock
      const postStepScreen = getScreen();
      if (postStepScreen === 'wave_end') {
        postWaveTransitions += 1;
        assert(postWaveTransitions < 500, `${spec.label}: wave_end screen softlocked!`);
      } else {
        postWaveTransitions = 0;
      }

      // If AI dies on brutal high-danger / gimmick soak, fail loudly with diagnostics
      if (postStepScreen === 'game_over') {
        throw new Error(
          `[verify:sim] ${spec.label} died on Wave ${state.wave} (tick ${state.tick}, HP=${state.player.hp}/${state.player.maxHp}, kills=${state.runStats.kills})`,
        );
      }
    } else if (screen === 'crate_modal') {
      let guard = 0;
      const initialPending = state.crateModal.pendingCrates.length;
      while (getScreen() === 'crate_modal') {
        const beforeLen = state.crateModal.pendingCrates.length;
        applySimCommand(state, { type: 'crate_keep' });
        guard += 1;
        assert(
          state.crateModal.pendingCrates.length < beforeLen || getScreen() !== 'crate_modal',
          `${spec.label} W${state.wave}: crate_keep did not advance crate_modal (before=${beforeLen}, after=${state.crateModal.pendingCrates.length})`,
        );
        assert(
          guard <= initialPending + 2,
          `${spec.label} W${state.wave}: crate_modal softlocked (initialPending=${initialPending}, left=${state.crateModal.pendingCrates.length})`,
        );
      }
    } else if (screen === 'level_up') {
      let guard = 0;
      const initialPending = state.player.pendingLevelUps;
      while (getScreen() === 'level_up') {
        const beforePending = state.player.pendingLevelUps;
        const idx = pickBestLevelUpIndex(state);
        applySimCommand(state, { type: 'level_up_pick', index: idx });
        guard += 1;
        assert(
          state.player.pendingLevelUps < beforePending || getScreen() !== 'level_up',
          `${spec.label} W${state.wave}: level_up_pick did not decrement pendingLevelUps (before=${beforePending}, after=${state.player.pendingLevelUps})`,
        );
        assert(
          guard <= initialPending + 2,
          `${spec.label} W${state.wave}: level_up softlocked (initialPending=${initialPending}, left=${state.player.pendingLevelUps})`,
        );
      }
    } else if (screen === 'victory') {
      if (spec.targetWave <= 20) {
        break;
      }
      applySimCommand(state, { type: 'continue_endless' });
      assert(getScreen() !== 'victory', `${spec.label}: continue_endless failed to leave victory screen`);
    } else if (screen === 'shop') {
      if (state.wave >= spec.targetWave) {
        break;
      }
      runShopTurn(state);
      const afterShop = getScreen();
      assert(afterShop === 'combat', `${spec.label}: shop_next_wave failed to enter combat (got ${afterShop})`);
    } else {
      throw new Error(`[verify:sim] ${spec.label} entered unexpected screen '${screen}'`);
    }
  }

  assert(
    state.wave >= spec.targetWave,
    `${spec.label}: reached wave ${state.wave} < targetWave ${spec.targetWave}`,
  );

  if (spec.verifyDoubleBoss) {
    assert(
      bossesSeen.has('predator') && bossesSeen.has('invoker'),
      `${spec.label}: expected BOTH predator and invoker on Wave 20 (saw: ${[...bossesSeen].join(', ')})`,
    );
  }

  if (spec.verifyNightmareEvents) {
    assert(
      nightmareEventsSeen.has('bullet_hell') && nightmareEventsSeen.has('fog_of_war'),
      `${spec.label}: expected D6 nightmare events bullet_hell & fog_of_war (saw: ${[...nightmareEventsSeen].join(', ')})`,
    );
  }

  return {
    label: spec.label,
    wavesCleared: state.wave,
    ticks: totalTicks,
    kills: state.runStats.kills,
    bossesSeen: [...bossesSeen],
    nightmareEventsSeen: [...nightmareEventsSeen],
    finalHash: hashSimState(state),
  };
}

// ----------------------------------------------------------------------------
// Duplicate Seeded Replay Tape Verification (Bit-for-Bit Identical Hash)
// ----------------------------------------------------------------------------
function runReplayDeterminismTest(): { hashA: string; hashB: string; ticks: number; commands: number } {
  const seed = 20261126;
  const recordedInputs: InputFrame[] = [];
  const recordedCommands: Array<{ step: number; cmd: SimCommand }> = [];

  // Run A: record every tick's input + shop/level-up/crate commands across 3 full waves
  const stateA = createInitialSimState(seed);
  const startCmd: SimCommand = {
    type: 'start_run',
    characterId: 'well_rounded',
    weaponId: 'smg',
    zoneId: 0,
    dangerLevel: 0,
    seed,
  };
  startNewRun(stateA, startCmd);

  let stepIdx = 0;
  while (true) {
    if (stateA.screen === 'combat' || stateA.screen === 'wave_end') {
      const inp = computeAiCombatInput(stateA);
      recordedInputs.push(inp);
      stepSim(stateA, inp);
      assertTickInvariants(stateA, 'Replay-A');
      stepIdx += 1;
    } else if (stateA.screen === 'crate_modal') {
      const cmd: SimCommand = { type: 'crate_keep' };
      recordedCommands.push({ step: stepIdx, cmd });
      applySimCommand(stateA, cmd);
    } else if (stateA.screen === 'level_up') {
      const cmd: SimCommand = { type: 'level_up_pick', index: pickBestLevelUpIndex(stateA) };
      recordedCommands.push({ step: stepIdx, cmd });
      applySimCommand(stateA, cmd);
    } else if (stateA.screen === 'shop') {
      if (stateA.wave >= 3) {
        // Perform shop purchases on Wave 3 shop before hashing
        for (let slot = 0; slot < stateA.shop.offers.length; slot++) {
          const o = stateA.shop.offers[slot];
          if (!o.purchased && stateA.player.materials >= o.price) {
            const buyCmd: SimCommand = { type: 'shop_buy', slotIndex: slot };
            recordedCommands.push({ step: stepIdx, cmd: buyCmd });
            applySimCommand(stateA, buyCmd);
          }
        }
        break;
      }
      const shopCmdLog: Array<{ tick: number; cmd: SimCommand }> = [];
      runShopTurn(stateA, shopCmdLog);
      for (const entry of shopCmdLog) {
        recordedCommands.push({ step: stepIdx, cmd: entry.cmd });
      }
    } else {
      throw new Error(`[verify:sim] Replay-A unexpected screen ${stateA.screen}`);
    }
  }
  const hashA = hashSimState(stateA);

  // Run B: replay exact recorded input tape and command tape from identical seed
  const stateB = createInitialSimState(seed);
  startNewRun(stateB, startCmd);
  let cmdCursor = 0;
  for (let i = 0; i < recordedInputs.length; i++) {
    while (cmdCursor < recordedCommands.length && recordedCommands[cmdCursor].step === i) {
      applySimCommand(stateB, recordedCommands[cmdCursor].cmd);
      cmdCursor += 1;
    }
    stepSim(stateB, recordedInputs[i]);
    assertTickInvariants(stateB, 'Replay-B');
  }
  while (cmdCursor < recordedCommands.length) {
    applySimCommand(stateB, recordedCommands[cmdCursor].cmd);
    cmdCursor += 1;
  }
  const hashB = hashSimState(stateB);

  assert(
    hashA === hashB,
    `Duplicate seeded replay diverged! hashA=${hashA} !== hashB=${hashB}`,
  );

  return { hashA, hashB, ticks: recordedInputs.length, commands: recordedCommands.length };
}

// ----------------------------------------------------------------------------
// Main Entrypoint
// ----------------------------------------------------------------------------
function main(): void {
  const t0 = Date.now();

  const campaigns: CampaignSpec[] = [
    {
      label: 'D0-Endless-W25 (well_rounded, Zone 0)',
      characterId: 'well_rounded',
      weaponId: 'smg',
      zoneId: 0,
      dangerLevel: 0,
      seed: 1001,
      targetWave: 25,
    },
    {
      label: 'D5-DoubleBoss-W20 (knight, Zone 1)',
      characterId: 'knight',
      weaponId: 'sword',
      zoneId: 1,
      dangerLevel: 5,
      seed: 2002,
      targetWave: 20,
      verifyDoubleBoss: true,
    },
    {
      label: 'D6-Nightmare-W20 (multitasker, Zone 2)',
      characterId: 'multitasker',
      weaponId: 'stick',
      zoneId: 2,
      dangerLevel: 6,
      seed: 3003,
      targetWave: 20,
      verifyDoubleBoss: true,
      verifyNightmareEvents: true,
    },
    {
      label: 'Iconic-Bull-W6',
      characterId: 'bull',
      weaponId: 'pistol',
      zoneId: 0,
      dangerLevel: 0,
      seed: 4001,
      targetWave: 6,
    },
    {
      label: 'Iconic-Demon-W6',
      characterId: 'demon',
      weaponId: 'wrench',
      zoneId: 0,
      dangerLevel: 0,
      seed: 4002,
      targetWave: 6,
    },
    {
      label: 'Iconic-Engineer-W6',
      characterId: 'engineer',
      weaponId: 'wrench',
      zoneId: 1,
      dangerLevel: 2,
      seed: 4003,
      targetWave: 6,
    },
    {
      label: 'Iconic-OneArm-W6',
      characterId: 'one_arm',
      weaponId: 'scissors',
      zoneId: 2,
      dangerLevel: 1,
      seed: 4004,
      targetWave: 6,
    },
    {
      label: 'Iconic-Pacifist-W6',
      characterId: 'pacifist',
      weaponId: 'hand',
      zoneId: 0,
      dangerLevel: 0,
      seed: 4005,
      targetWave: 6,
    },
  ];

  const reports: CampaignReport[] = [];
  for (const spec of campaigns) {
    reports.push(runAutonomousCampaign(spec));
  }

  const replay = runReplayDeterminismTest();
  const elapsedMs = Date.now() - t0;
  const totalTicks = reports.reduce((acc, r) => acc + r.ticks, 0) + replay.ticks * 2;

  console.log(`[verify:sim] PASS (${reports.length} campaigns + replay tape, ${totalTicks.toLocaleString()} ticks in ${elapsedMs}ms)`);
  for (const r of reports) {
    const extras: string[] = [];
    if (r.bossesSeen.length > 0) extras.push(`bosses=[${r.bossesSeen.join(',')}]`);
    if (r.nightmareEventsSeen.length > 0) extras.push(`nightmare=[${r.nightmareEventsSeen.join(',')}]`);
    console.log(
      `  ✓ ${r.label}: W${r.wavesCleared}, ${r.ticks} ticks, ${r.kills} kills, hash=${r.finalHash}${
        extras.length > 0 ? ` (${extras.join(' ')})` : ''
      }`,
    );
  }
  console.log(
    `  ✓ Replay Determinism (3 waves + shop): ${replay.ticks} ticks, ${replay.commands} cmds, hashA=${replay.hashA} === hashB=${replay.hashB}`,
  );
}

main();
