import { CellPoint } from '../terrain/brushes';
import { fbm } from '../terrain/noise';
import { CellRect, clipRect, Int16TiledGrid } from '../terrain/tiled-grid';
import { applyPaint, DrawingPaint } from './drawing-cell';

/**
 * Zone brush ("à la Foundation"): a disc whose rim is bitten by noise.
 *
 * The noise is tied to the PLACE (map seed + position in km), not to the
 * stroke: going over the same coast twice gives the same jagged edge, and
 * land painted then sea painted at the same spot fit together. With a
 * per-stroke random edge, every pass would fray the coast a little more.
 */
export interface DrawingDab {
  readonly center: CellPoint;
  readonly radiusCells: number;
  /** 0 = clean disc, 1 = deeply indented rim. */
  readonly roughness: number;
  readonly cellKm: number;
  readonly seed: number;
}

/** Wavelength of the rim's bumps. In km so the look doesn't depend on the grid resolution. */
export const EDGE_NOISE_PERIOD_KM = 14;
/** At roughness 1, the rim can recede by up to this fraction of the radius. */
export const EDGE_MAX_DEPTH = 0.5;
const EDGE_OCTAVES = 3;
/** Salt so the rim noise differs from other noises derived from the map seed. */
const EDGE_SEED_SALT = 0x5eed;

/**
 * Applies `paint` to every cell whose centre falls inside the bitten disc.
 * Returns the bounding box of the cells that actually changed, or null.
 */
export function paintDrawing(grid: Int16TiledGrid, dab: DrawingDab, paint: DrawingPaint): CellRect | null {
  const { center, radiusCells: r } = dab;
  const area = clipRect(grid, {
    x0: Math.floor(center.x - r),
    y0: Math.floor(center.y - r),
    x1: Math.ceil(center.x + r),
    y1: Math.ceil(center.y + r),
  });
  if (!area || r <= 0) return null;

  const depth = Math.max(0, Math.min(1, dab.roughness)) * EDGE_MAX_DEPTH;
  // Cells closer than this are always inside: no need to evaluate the noise for them.
  const safeR = r * (1 - depth);
  const toNoise = dab.cellKm / EDGE_NOISE_PERIOD_KM;
  const seed = dab.seed ^ EDGE_SEED_SALT;
  const size = grid.tileSize;

  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (let y = area.y0; y <= area.y1; y++) {
    const dy = y + 0.5 - center.y;
    const tileRow = ((y / size) | 0) * grid.tilesX;
    const rowInTile = (y % size) * size;
    for (let x = area.x0; x <= area.x1; x++) {
      const dx = x + 0.5 - center.x;
      const d = Math.sqrt(dx * dx + dy * dy);
      if (d > r) continue;
      if (d > safeR && d > r * (1 - depth * fbm(seed, x * toNoise, y * toNoise, EDGE_OCTAVES))) continue;
      const tile = grid.tiles[tileRow + ((x / size) | 0)];
      const i = rowInTile + (x % size);
      const next = applyPaint(tile[i], paint);
      if (next === tile[i]) continue;
      tile[i] = next;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
    }
  }
  return x0 === Infinity ? null : { x0, y0, x1, y1 };
}
