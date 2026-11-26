// ============================================================================
// src/sim/index.ts — Unified Simulation Barrel Binding GAME_CATALOG & Economy
// ============================================================================

import {
  type GameDataCatalog,
  type InputFrame,
  type SimCommand,
  type SimEconomyHooks,
  type SimState,
} from '../contracts/index';
import { GAME_CATALOG } from '../data/index';
import { createEconomyHooks } from './progression';
import {
  applySimCommand as rawApplySimCommand,
  createInitialSimState as rawCreateInitialSimState,
  startNewRun as rawStartNewRun,
  stepSim as rawStepSim,
} from './step';

export * from './prng';
export * from './hash';
export * from './spatial';
export * from './stats';
export * from './effects';
export * from './combat';
export * from './enemies';
export * from './bosses';
export * from './spawner';
export {
  getShopPrice,
  getRerollCost,
  getRecycleRefund,
  getRarityTierRoll,
  rollShop,
  buyShopOffer,
  lockShopOffer,
  rerollShop,
  combineWeapon,
  recycleWeapon,
} from './shop';
export * from './progression';
export { createEquippedWeapon } from './step';

export const DEFAULT_ECONOMY_HOOKS: SimEconomyHooks = createEconomyHooks();

export function createInitialSimState(
  seed = 1337,
  catalog: GameDataCatalog = GAME_CATALOG,
): SimState {
  return rawCreateInitialSimState(catalog, seed);
}

export function startNewRun(
  state: SimState,
  cmd: Extract<SimCommand, { type: 'start_run' }>,
  catalog: GameDataCatalog = GAME_CATALOG,
  hooks: SimEconomyHooks = DEFAULT_ECONOMY_HOOKS,
): SimState {
  rawStartNewRun(state, cmd, catalog, hooks);
  return state;
}

export function applySimCommand(
  state: SimState,
  cmd: SimCommand,
  catalog: GameDataCatalog = GAME_CATALOG,
  hooks: SimEconomyHooks = DEFAULT_ECONOMY_HOOKS,
): SimState {
  rawApplySimCommand(state, cmd, catalog, hooks);
  return state;
}

export function stepSim(
  state: SimState,
  input: InputFrame,
  commands: readonly SimCommand[] = [],
  catalog: GameDataCatalog = GAME_CATALOG,
  hooks: SimEconomyHooks = DEFAULT_ECONOMY_HOOKS,
): SimState {
  return rawStepSim(state, input, commands, catalog, hooks);
}
