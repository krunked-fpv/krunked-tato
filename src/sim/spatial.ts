// ============================================================================
// src/sim/spatial.ts — Zero-GC Deterministic SpatialHashGrid (64px cells)
// ============================================================================

import { ARENA_H, ARENA_W, TILE_SIZE } from '../contracts/index';

/**
 * Fixed-cell spatial hash grid designed for 60 Hz deterministic queries with
 * zero per-frame allocations. Cell buckets and deduplication stamp buffers are
 * pre-allocated and reused across ticks.
 */
export class SpatialHashGrid {
  public readonly cellSize: number;
  public readonly cols: number;
  public readonly rows: number;

  private readonly cells: number[][];
  private readonly touchedCells: number[];
  private readonly touchedMarks: Uint8Array;

  // Deduplication state across multi-cell inserts (zero per-query allocation)
  private seenStamp: Uint32Array;
  private stampCounter: number;
  private readonly overflowSeen: Set<number>;

  constructor(
    width: number = ARENA_W,
    height: number = ARENA_H,
    cellSize: number = TILE_SIZE,
  ) {
    this.cellSize = cellSize > 0 ? cellSize : TILE_SIZE;
    // Include 2 extra margin cells so boundary coordinates always map safely
    this.cols = Math.ceil(width / this.cellSize) + 2;
    this.rows = Math.ceil(height / this.cellSize) + 2;
    const total = this.cols * this.rows;

    this.cells = new Array<number[]>(total);
    for (let i = 0; i < total; i++) {
      this.cells[i] = [];
    }
    this.touchedCells = [];
    this.touchedMarks = new Uint8Array(total);

    this.seenStamp = new Uint32Array(2048);
    this.stampCounter = 1;
    this.overflowSeen = new Set<number>();
  }

  /**
   * Clears all occupied buckets in O(touchedCells) with zero allocations.
   */
  public clear(): void {
    const touched = this.touchedCells;
    const marks = this.touchedMarks;
    const cells = this.cells;
    for (let i = 0; i < touched.length; i++) {
      const idx = touched[i];
      cells[idx].length = 0;
      marks[idx] = 0;
    }
    touched.length = 0;
  }

  private clampCol(cx: number): number {
    if (cx < 0) return 0;
    if (cx >= this.cols) return this.cols - 1;
    return cx;
  }

  private clampRow(cy: number): number {
    if (cy < 0) return 0;
    if (cy >= this.rows) return this.rows - 1;
    return cy;
  }

  /**
   * Inserts an entity ID covering the AABB of circle (x, y, radius).
   */
  public insert(id: number, x: number, y: number, radius: number): void {
    const inv = 1 / this.cellSize;
    const r = radius > 0 ? radius : 0;
    const minCx = this.clampCol(Math.floor((x - r) * inv) + 1);
    const maxCx = this.clampCol(Math.floor((x + r) * inv) + 1);
    const minCy = this.clampRow(Math.floor((y - r) * inv) + 1);
    const maxCy = this.clampRow(Math.floor((y + r) * inv) + 1);

    const cols = this.cols;
    const cells = this.cells;
    const marks = this.touchedMarks;
    const touched = this.touchedCells;

    for (let cy = minCy; cy <= maxCy; cy++) {
      const rowOffset = cy * cols;
      for (let cx = minCx; cx <= maxCx; cx++) {
        const idx = rowOffset + cx;
        if (marks[idx] === 0) {
          marks[idx] = 1;
          touched.push(idx);
        }
        cells[idx].push(id);
      }
    }
  }

  /**
   * Populates `outIds` with all unique entity IDs whose cells overlap the
   * query circle `(x, y, radius)`. Iteration order is deterministic (row-major).
   */
  public queryCircle(x: number, y: number, radius: number, outIds: number[]): number[] {
    outIds.length = 0;
    const inv = 1 / this.cellSize;
    const r = radius > 0 ? radius : 0;
    const minCx = this.clampCol(Math.floor((x - r) * inv) + 1);
    const maxCx = this.clampCol(Math.floor((x + r) * inv) + 1);
    const minCy = this.clampRow(Math.floor((y - r) * inv) + 1);
    const maxCy = this.clampRow(Math.floor((y + r) * inv) + 1);

    // Advance stamp; handle 32-bit rollover cleanly
    this.stampCounter = (this.stampCounter + 1) >>> 0;
    if (this.stampCounter === 0) {
      this.seenStamp.fill(0);
      this.stampCounter = 1;
    }
    const stamp = this.stampCounter;
    let usedOverflow = false;

    const cols = this.cols;
    const cells = this.cells;
    const seen = this.seenStamp;
    const seenLen = seen.length;

    for (let cy = minCy; cy <= maxCy; cy++) {
      const rowOffset = cy * cols;
      for (let cx = minCx; cx <= maxCx; cx++) {
        const bucket = cells[rowOffset + cx];
        const len = bucket.length;
        for (let i = 0; i < len; i++) {
          const id = bucket[i];
          if (id >= 0 && id < seenLen) {
            if (seen[id] !== stamp) {
              seen[id] = stamp;
              outIds.push(id);
            }
          } else {
            if (!usedOverflow) {
              this.overflowSeen.clear();
              usedOverflow = true;
            }
            if (!this.overflowSeen.has(id)) {
              this.overflowSeen.add(id);
              outIds.push(id);
            }
          }
        }
      }
    }

    return outIds;
  }
}
