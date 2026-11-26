// ============================================================================
// src/app/DebugBridge.ts — window.__KRUNKED_DEBUG__ Test & Verification Bridge
// ============================================================================

import type {
  AssetMode,
  DebugBridge,
  InputFrame,
  InputMode,
  PerfStats,
  SimCommand,
  SimState,
  UiNavAction,
} from '../contracts/index';

export interface DebugBridgeHost {
  getState(): SimState;
  getHash(): string;
  getPerf(): PerfStats;
  getInputMode(): InputMode;
  setInputMode(mode: InputMode): void;
  getTouchOverlayStatus(): { visible: boolean; opacity: number; mode: InputMode };
  getAssetMode(): AssetMode;
  setAssetMode(mode: AssetMode): Promise<void>;
  dispatch(cmd: SimCommand): void;
  stepTicks(count: number, input?: Partial<InputFrame>): string;
  simulateNav(action: UiNavAction): void;
  startQuickRun(opts?: {
    characterId?: string;
    weaponId?: string;
    zoneId?: 0 | 1 | 2;
    dangerLevel?: number;
    seed?: number;
  }): void;
  resetSave(): void;
}

export function createDebugBridge(host: DebugBridgeHost): DebugBridge {
  return {
    version: '1.0.0',
    getState: () => host.getState(),
    getHash: () => host.getHash(),
    getPerf: () => host.getPerf(),
    getInputMode: () => host.getInputMode(),
    setInputMode: (mode) => host.setInputMode(mode),
    getTouchOverlayStatus: () => host.getTouchOverlayStatus(),
    getAssetMode: () => host.getAssetMode(),
    setAssetMode: (mode) => host.setAssetMode(mode),
    dispatch: (cmd) => host.dispatch(cmd),
    stepTicks: (count, input) => host.stepTicks(count, input),
    simulateNav: (action) => host.simulateNav(action),
    startQuickRun: (opts) => host.startQuickRun(opts),
    resetSave: () => host.resetSave(),
  };
}
