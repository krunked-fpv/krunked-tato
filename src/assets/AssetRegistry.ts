// ============================================================================
// src/assets/AssetRegistry.ts
// Manages BUILTIN (ProceduralKrunkedAtlas) vs CUSTOM_PACK (CustomPackLoader)
// seamlessly: composites custom textures into an overlay 2048x2048 atlas with
// automatic Built-In fallback for any missing logical ID, and caches crisp
// UI icon data URLs for both modes.
// ============================================================================

import type {
  AssetMode,
  AtlasRegion,
  CustomPackStatus,
  GameDataCatalog,
} from '../contracts/index';
import { CustomPackLoader } from './CustomPackLoader';
import {
  ATLAS_SIZE,
  createProceduralKrunkedAtlas,
  type ProceduralAtlasBundle,
} from './ProceduralKrunkedAtlas';

const CUSTOM_PACK_ALIASES: Readonly<Record<string, readonly string[]>> = {
  fruit: ['consumable_fruit'],
  consumable_fruit: ['fruit'],
  crate: ['crate_normal'],
  crate_normal: ['crate'],
  spawn_telegraph: ['vfx_spawn_x'],
  vfx_spawn_x: ['spawn_telegraph'],
};

export interface AtlasSnapshot {
  canvas: HTMLCanvasElement;
  regions: Map<string, AtlasRegion>;
  customImages?: Map<string, HTMLImageElement | ImageBitmap>;
}

export class AssetRegistry {
  private readonly builtIn: ProceduralAtlasBundle;
  private readonly customLoader: CustomPackLoader;
  private mode: AssetMode = 'BUILTIN';
  private customTextures = new Map<string, HTMLImageElement | ImageBitmap>();
  private customAtlasCanvas: HTMLCanvasElement | null = null;
  private iconDataUrlCache = new Map<string, string>();
  private iconScratchCanvas: HTMLCanvasElement | null = null;
  private iconScratchCtx: CanvasRenderingContext2D | null = null;
  private listeners = new Set<() => void>();

  constructor(customLoader?: CustomPackLoader) {
    this.builtIn = createProceduralKrunkedAtlas();
    this.customLoader = customLoader ?? new CustomPackLoader();
  }

  public getLoader(): CustomPackLoader {
    return this.customLoader;
  }

  public getMode(): AssetMode {
    return this.mode;
  }

  public getCustomPackStatus(): CustomPackStatus {
    const status = this.customLoader.getStatus();
    return {
      ...status,
      active: this.mode === 'CUSTOM_PACK' && status.available,
    };
  }

  public subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emitChange(): void {
    for (const fn of this.listeners) fn();
  }

  public prepareCatalog(catalog: GameDataCatalog): void {
    const changed = this.builtIn.ensureCatalogSprites(catalog);
    if (changed) {
      if (this.mode === 'CUSTOM_PACK' && this.customTextures.size > 0) {
        this.rebuildCustomCompositeAtlas();
      }
      this.iconDataUrlCache.clear();
      this.emitChange();
    }
  }

  public async probeCustomPack(): Promise<CustomPackStatus> {
    const status = await this.customLoader.probe();
    this.emitChange();
    return {
      ...status,
      active: this.mode === 'CUSTOM_PACK' && status.available,
    };
  }

  public async setMode(nextMode: AssetMode): Promise<AssetMode> {
    if (nextMode === 'BUILTIN') {
      if (this.mode !== 'BUILTIN') {
        this.mode = 'BUILTIN';
        this.iconDataUrlCache.clear();
        this.emitChange();
      }
      return this.mode;
    }

    // Attempt to activate CUSTOM_PACK
    let status = this.customLoader.getStatus();
    if (!status.available) {
      status = await this.customLoader.probe();
    }
    if (!status.available) {
      this.mode = 'BUILTIN';
      this.emitChange();
      return this.mode;
    }

    if (this.customTextures.size === 0) {
      this.customTextures = await this.customLoader.loadTextures();
    }

    if (this.customTextures.size === 0) {
      this.mode = 'BUILTIN';
      this.emitChange();
      return this.mode;
    }

    this.mode = 'CUSTOM_PACK';
    this.rebuildCustomCompositeAtlas();
    this.iconDataUrlCache.clear();
    this.emitChange();
    return this.mode;
  }

  public async loadFromPckFile(file: File): Promise<CustomPackStatus> {
    await this.customLoader.loadFromPckFile(file);
    this.customTextures = await this.customLoader.loadTextures();
    this.mode = this.customTextures.size > 0 ? 'CUSTOM_PACK' : 'BUILTIN';
    if (this.mode === 'CUSTOM_PACK') {
      this.rebuildCustomCompositeAtlas();
    }
    this.iconDataUrlCache.clear();
    this.emitChange();
    return this.getCustomPackStatus();
  }

  public async loadFromDirectoryFiles(files: FileList): Promise<CustomPackStatus> {
    await this.customLoader.loadFromDirectoryFiles(files);
    this.customTextures = await this.customLoader.loadTextures();
    this.mode = this.customTextures.size > 0 ? 'CUSTOM_PACK' : 'BUILTIN';
    if (this.mode === 'CUSTOM_PACK') {
      this.rebuildCustomCompositeAtlas();
    }
    this.iconDataUrlCache.clear();
    this.emitChange();
    return this.getCustomPackStatus();
  }

  public async clearCustomPack(): Promise<void> {
    await this.customLoader.clearCache();
    this.customTextures = new Map();
    this.customAtlasCanvas = null;
    this.mode = 'BUILTIN';
    this.iconDataUrlCache.clear();
    this.emitChange();
  }

  public async loadCustomAudio(ctx: AudioContext): Promise<Map<string, AudioBuffer>> {
    if (this.mode !== 'CUSTOM_PACK') return new Map();
    return this.customLoader.loadAudio(ctx);
  }

  public getActiveAtlas(): AtlasSnapshot {
    if (this.mode === 'CUSTOM_PACK' && this.customAtlasCanvas && this.customTextures.size > 0) {
      return {
        canvas: this.customAtlasCanvas,
        regions: this.builtIn.regions,
        customImages: this.customTextures,
      };
    }
    return {
      canvas: this.builtIn.canvas,
      regions: this.builtIn.regions,
    };
  }

  public getRegion(spriteId: string): AtlasRegion {
    return this.builtIn.ensureSprite(spriteId);
  }

  private drawImageAspectFit(
    ctx: CanvasRenderingContext2D,
    img: HTMLImageElement | ImageBitmap,
    x: number,
    y: number,
    w: number,
    h: number
  ): void {
    const iw = img.width || w;
    const ih = img.height || h;
    if (iw <= 0 || ih <= 0) return;
    const scale = Math.min((w - 2) / iw, (h - 2) / ih);
    const dw = iw * scale;
    const dh = ih * scale;
    const dx = x + (w - dw) / 2;
    const dy = y + (h - dh) / 2;
    ctx.drawImage(img, dx, dy, dw, dh);
  }

  private rebuildCustomCompositeAtlas(): void {
    if (typeof document === 'undefined') return;
    if (!this.customAtlasCanvas) {
      this.customAtlasCanvas = document.createElement('canvas');
      this.customAtlasCanvas.width = ATLAS_SIZE;
      this.customAtlasCanvas.height = ATLAS_SIZE;
    }
    const ctx = this.customAtlasCanvas.getContext('2d');
    if (!ctx) return;

    // 1. Copy the complete Built-In procedural atlas as baseline fallback
    ctx.clearRect(0, 0, ATLAS_SIZE, ATLAS_SIZE);
    ctx.drawImage(this.builtIn.canvas, 0, 0);

    // 2. Composite every custom pack texture into its matching AtlasRegion
    const paintedRegions = new Set<string>();
    const paintId = (targetId: string, img: HTMLImageElement | ImageBitmap): void => {
      const region = this.builtIn.regions.get(targetId);
      if (!region) return;
      const cellKey = `${region.x}:${region.y}`;
      if (paintedRegions.has(cellKey)) return;
      paintedRegions.add(cellKey);
      ctx.clearRect(region.x, region.y, region.w, region.h);
      // Tiles fill edge-to-edge; sprites aspect-fit inside their padded cell
      if (targetId.startsWith('tile_')) {
        ctx.drawImage(img, region.x, region.y, region.w, region.h);
      } else {
        this.drawImageAspectFit(ctx, img, region.x, region.y, region.w, region.h);
      }
    };

    for (const [logicalId, img] of this.customTextures) {
      // Ensure cell exists even for Wave 2 dynamic IDs
      if (
        !this.builtIn.regions.has(logicalId) &&
        !logicalId.startsWith('weapon_icon_') &&
        !logicalId.startsWith('enemy_icon_')
      ) {
        this.builtIn.ensureSprite(logicalId);
      }
      paintId(logicalId, img);
      const aliases = CUSTOM_PACK_ALIASES[logicalId];
      if (aliases) {
        for (const a of aliases) paintId(a, img);
      }
    }
  }

  public getIconDataUrl(spriteId: string): string {
    const cached = this.iconDataUrlCache.get(spriteId);
    if (cached !== undefined) return cached;

    if (typeof document === 'undefined') return '';

    if (!this.iconScratchCanvas) {
      this.iconScratchCanvas = document.createElement('canvas');
      this.iconScratchCanvas.width = 64;
      this.iconScratchCanvas.height = 64;
      this.iconScratchCtx = this.iconScratchCanvas.getContext('2d');
    }
    const ctx = this.iconScratchCtx;
    if (!ctx || !this.iconScratchCanvas) return '';

    ctx.clearRect(0, 0, 64, 64);

    // Prefer dedicated custom UI icon in CUSTOM_PACK mode
    if (this.mode === 'CUSTOM_PACK' && this.customTextures.size > 0) {
      let customImg: HTMLImageElement | ImageBitmap | undefined;
      if (spriteId.startsWith('weapon_')) {
        const base = spriteId.slice('weapon_'.length);
        customImg =
          this.customTextures.get(`weapon_icon_${base}`) ?? this.customTextures.get(spriteId);
      } else if (spriteId.startsWith('enemy_')) {
        const base = spriteId.slice('enemy_'.length);
        customImg =
          this.customTextures.get(`enemy_icon_${base}`) ?? this.customTextures.get(spriteId);
      } else {
        customImg = this.customTextures.get(spriteId);
        if (!customImg && CUSTOM_PACK_ALIASES[spriteId]) {
          for (const a of CUSTOM_PACK_ALIASES[spriteId]) {
            customImg = this.customTextures.get(a);
            if (customImg) break;
          }
        }
      }

      if (customImg) {
        this.drawImageAspectFit(ctx, customImg, 2, 2, 60, 60);
        const url = this.iconScratchCanvas.toDataURL('image/png');
        this.iconDataUrlCache.set(spriteId, url);
        return url;
      }
    }

    // Fallback cleanly to Built-In procedural atlas
    const region = this.builtIn.ensureSprite(spriteId);
    ctx.drawImage(
      this.builtIn.canvas,
      region.x,
      region.y,
      region.w,
      region.h,
      0,
      0,
      64,
      64
    );
    const url = this.iconScratchCanvas.toDataURL('image/png');
    this.iconDataUrlCache.set(spriteId, url);
    return url;
  }
}
