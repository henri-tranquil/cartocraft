import { forestIndexOf, isLandCode, reliefIndexOf } from '../../domain/drawing/drawing-cell';
import { CellRect, getCellClamped, Int16TiledGrid } from '../../domain/terrain/tiled-grid';

/** One level of the pyramid: texel (i, j) covers cells [i·2^k, (i+1)·2^k) × [j·2^k, (j+1)·2^k). */
interface Level {
  readonly scale: number;
  readonly invScale: number;
  readonly width: number;
  readonly height: number;
  /** Mean value 0..255. */
  readonly data: Uint8Array;
}

/** What a pyramid averages, per drawing cell, in 0..1. */
export type CellValue = (code: number) => number;

/** 1 on land, 0 at sea: the coast is where the mean crosses ½. */
export const LAND_VALUE: CellValue = (code) => (isLandCode(code) ? 1 : 0);
/** Relief class as 0 (plain or sea), ⅓, ⅔, 1 (high mountain): tints relief zones seen from afar. */
export const RELIEF_VALUE: CellValue = (code) => reliefIndexOf(code) / 3;
/** 1 where trees are painted: a green wash under forests, readable from afar. */
export const FOREST_VALUE: CellValue = (code) => (forestIndexOf(code) !== 0 ? 1 : 0);

/**
 * Mean of a drawing value (land by default) at every power-of-two scale (a "mipmap").
 *
 * Level 0 = land (0/1) softened by a 3×3 average, so that a bilinear read
 * between cell centres gives a rounded coast instead of grid staircases.
 * Level k = mean of 2×2 texels of level k−1, i.e. the fraction of land in a
 * 2^k × 2^k block.
 *
 * Why? The renderer needs two things at any zoom, cheaply:
 * - the coast at the resolution of a screen pixel (zoomed out, one pixel
 *   covers many cells: read the level whose texel ≈ one pixel);
 * - "how much land is around": a blurry read at a coarse level gives the
 *   coastal glow, without a distance field to recompute after each dab.
 * Updating after a dab only touches the texels above the painted cells.
 */
export class CoveragePyramid {
  readonly levels: readonly Level[];

  constructor(
    private readonly grid: Int16TiledGrid,
    private readonly valueOf: CellValue = LAND_VALUE,
  ) {
    const levels: Level[] = [];
    let width = grid.widthCells;
    let height = grid.heightCells;
    for (let scale = 1; ; scale *= 2) {
      levels.push({ scale, invScale: 1 / scale, width, height, data: new Uint8Array(width * height) });
      if (width === 1 && height === 1) break;
      width = Math.ceil(width / 2);
      height = Math.ceil(height / 2);
    }
    this.levels = levels;
    this.update({ x0: 0, y0: 0, x1: grid.widthCells - 1, y1: grid.heightCells - 1 });
  }

  get maxLevel(): number {
    return this.levels.length - 1;
  }

  /** Recomputes everything a change of the cells in `rect` can affect. */
  update(rect: CellRect): void {
    const grid = this.grid;
    const base = this.levels[0];
    // The 3×3 average reads neighbours: a changed cell affects its ring too.
    let x0 = Math.max(0, rect.x0 - 1);
    let y0 = Math.max(0, rect.y0 - 1);
    let x1 = Math.min(base.width - 1, rect.x1 + 1);
    let y1 = Math.min(base.height - 1, rect.y1 + 1);
    // Read each cell once (with a 1-cell ring), then sum 3×3 windows separably: rows, then columns.
    const w = x1 - x0 + 3;
    const h = y1 - y0 + 3;
    const values = new Uint8Array(w * h);
    const valueOf = this.valueOf;
    for (let j = 0; j < h; j++) {
      for (let i = 0; i < w; i++) values[j * w + i] = Math.round(valueOf(getCellClamped(grid, x0 - 1 + i, y0 - 1 + j)) * 255);
    }
    const rows = new Uint16Array(w * h);
    for (let j = 0; j < h; j++) {
      for (let i = 1; i < w - 1; i++) rows[j * w + i] = values[j * w + i - 1] + values[j * w + i] + values[j * w + i + 1];
    }
    for (let y = y0; y <= y1; y++) {
      const j = y - y0 + 1;
      for (let x = x0; x <= x1; x++) {
        const i = x - x0 + 1;
        const sum = rows[(j - 1) * w + i] + rows[j * w + i] + rows[(j + 1) * w + i];
        base.data[y * base.width + x] = Math.round(sum / 9);
      }
    }
    for (let k = 1; k < this.levels.length; k++) {
      const child = this.levels[k - 1];
      const level = this.levels[k];
      x0 >>= 1;
      y0 >>= 1;
      x1 >>= 1;
      y1 >>= 1;
      for (let y = y0; y <= y1; y++) {
        for (let x = x0; x <= x1; x++) {
          // Edge texels may have 1 or 2 children only: average what exists.
          let sum = 0;
          let n = 0;
          for (let cy = 2 * y; cy <= Math.min(2 * y + 1, child.height - 1); cy++) {
            for (let cx = 2 * x; cx <= Math.min(2 * x + 1, child.width - 1); cx++) {
              sum += child.data[cy * child.width + cx];
              n++;
            }
          }
          level.data[y * level.width + x] = Math.round(sum / n);
        }
      }
    }
  }

  /**
   * Land fraction 0..1 at cell coordinates (x, y) (continuous: cell c spans
   * [c, c+1)), read bilinearly from level k. Outside the map: edge texels repeat.
   */
  sample(k: number, x: number, y: number): number {
    // Hot path (several times per rendered pixel): no allocation, few branches.
    const level = this.levels[k < 0 ? 0 : k > this.levels.length - 1 ? this.levels.length - 1 : k];
    const w = level.width;
    const h = level.height;
    let u = x * level.invScale - 0.5;
    let v = y * level.invScale - 0.5;
    if (u < 0) u = 0;
    else if (u > w - 1) u = w - 1;
    if (v < 0) v = 0;
    else if (v > h - 1) v = h - 1;
    const i = u | 0;
    const j = v | 0;
    const i1 = i < w - 1 ? i + 1 : i;
    const j1 = j < h - 1 ? j + 1 : j;
    const fx = u - i;
    const fy = v - j;
    const d = level.data;
    const a = d[j * w + i];
    const b = d[j * w + i1];
    const c = d[j1 * w + i];
    const e = d[j1 * w + i1];
    const top = a + (b - a) * fx;
    return (top + (c + (e - c) * fx - top) * fy) * (1 / 255);
  }
}
