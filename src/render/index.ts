// ============================================================================
// src/render/index.ts
// Renderer factory & shared viewport transform helpers.
// Tries WebGL2Renderer first and falls back seamlessly to Canvas2DRenderer.
// ============================================================================

import type { RendererAPI } from '../contracts/index';
import { Canvas2DRenderer } from './Canvas2DRenderer';
import { computeViewportZoom, WebGL2Renderer } from './WebGL2Renderer';

export { WebGL2Renderer, Canvas2DRenderer, computeViewportZoom };

export function screenToWorld(
  cssX: number,
  cssY: number,
  cssWidth: number,
  cssHeight: number,
  camX: number,
  camY: number,
  cameraZoom: number
): { x: number; y: number } {
  const zoom = computeViewportZoom(cssWidth, cssHeight, cameraZoom);
  return {
    x: camX + (cssX - cssWidth / 2) / zoom,
    y: camY + (cssY - cssHeight / 2) / zoom,
  };
}

export function createRenderer(canvas: HTMLCanvasElement): RendererAPI {
  try {
    return new WebGL2Renderer(canvas);
  } catch {
    return new Canvas2DRenderer(canvas);
  }
}
