// ============================================================================
// src/main.ts — krunkedtato Entry Point
// ============================================================================

import { GameApp } from './app/GameApp';

function boot(): void {
  const canvas = document.getElementById('game-canvas') as HTMLCanvasElement | null;
  const touchRoot = document.getElementById('touch-root');
  const uiRoot = document.getElementById('ui-root');
  const devRoot = document.getElementById('dev-root');

  if (!canvas || !touchRoot || !uiRoot || !devRoot) {
    throw new Error('krunkedtato mount nodes missing from index.html');
  }

  const app = new GameApp({
    canvas,
    touchRoot,
    uiRoot,
    devRoot,
  });
  app.start();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot, { once: true });
} else {
  boot();
}
