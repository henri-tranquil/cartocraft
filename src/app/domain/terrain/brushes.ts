import { CellRect, clipRect, getCell, getCellClamped, Int16TiledGrid, setCell } from './tiled-grid';

/**
 * Brushes work in continuous cell coordinates: cell (x, y) covers
 * [x, x+1) × [y, y+1), so its centre is (x + 0.5, y + 0.5).
 */
export interface CellPoint {
  readonly x: number;
  readonly y: number;
}

export interface BrushDab {
  readonly center: CellPoint;
  readonly radiusCells: number;
}

/**
 * Falloff kernel: weight 1 at the centre, 0 at the rim, with zero slope at
 * both ends — (1 − t²)². A linear falloff (1 − t) would leave a visible
 * crease at the centre and a hard step at the rim.
 */
export function falloff(t: number): number {
  if (t >= 1) return 0;
  const u = 1 - t * t;
  return u * u;
}

export function brushRect(grid: Int16TiledGrid, dab: BrushDab): CellRect | null {
  const { center, radiusCells: r } = dab;
  return clipRect(grid, {
    x0: Math.floor(center.x - r),
    y0: Math.floor(center.y - r),
    x1: Math.floor(center.x + r),
    y1: Math.floor(center.y + r),
  });
}

function forEachWeightedCell(
  grid: Int16TiledGrid,
  dab: BrushDab,
  visit: (x: number, y: number, weight: number) => void,
): CellRect | null {
  const rect = brushRect(grid, dab);
  if (!rect || dab.radiusCells <= 0) return null;
  for (let y = rect.y0; y <= rect.y1; y++) {
    for (let x = rect.x0; x <= rect.x1; x++) {
      const t = Math.hypot(x + 0.5 - dab.center.x, y + 0.5 - dab.center.y) / dab.radiusCells;
      const weight = falloff(t);
      if (weight > 0) visit(x, y, weight);
    }
  }
  return rect;
}

/** Adds `deltaM` × falloff (negative to lower). Returns the rectangle that may have changed. */
export function raiseTerrain(grid: Int16TiledGrid, dab: BrushDab, deltaM: number): CellRect | null {
  return forEachWeightedCell(grid, dab, (x, y, w) => setCell(grid, x, y, getCell(grid, x, y) + deltaM * w));
}

/**
 * Moves each cell toward the mean of its 3×3 neighbourhood by `strength` (0..1) × falloff.
 * Reads come from a snapshot taken before writing; otherwise cells processed
 * later would see already-smoothed neighbours and the result would drift
 * in the scan direction.
 */
export function smoothTerrain(grid: Int16TiledGrid, dab: BrushDab, strength: number): CellRect | null {
  const rect = brushRect(grid, dab);
  if (!rect) return null;
  const w = rect.x1 - rect.x0 + 3;
  const h = rect.y1 - rect.y0 + 3;
  const snapshot = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) snapshot[y * w + x] = getCellClamped(grid, rect.x0 - 1 + x, rect.y0 - 1 + y);
  }
  return forEachWeightedCell(grid, dab, (x, y, weight) => {
    const sx = x - rect.x0 + 1;
    const sy = y - rect.y0 + 1;
    let sum = 0;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) sum += snapshot[(sy + dy) * w + sx + dx];
    const current = snapshot[sy * w + sx];
    setCell(grid, x, y, current + (sum / 9 - current) * strength * weight);
  });
}

/**
 * A stroke is a series of "dabs". Pointer events arrive at irregular
 * intervals: a fast mouse can jump 50 cells between two events. We place dabs
 * every `spacing` cells along the segment, so the result depends on the path,
 * not on the mouse speed or frame rate. `carried` is the distance already
 * travelled since the last dab, kept across segments.
 */
export function dabPositionsAlong(
  from: CellPoint,
  to: CellPoint,
  spacing: number,
  carried: number,
): { points: CellPoint[]; carried: number } {
  const length = Math.hypot(to.x - from.x, to.y - from.y);
  const points: CellPoint[] = [];
  if (spacing <= 0 || length === 0) return { points, carried };
  let distance = spacing - carried;
  while (distance <= length) {
    const t = distance / length;
    points.push({ x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t });
    distance += spacing;
  }
  return { points, carried: length - (distance - spacing) };
}
