/**
 * A 2D grid of Int16 values split into square tiles.
 *
 * Why tiles? Storage, undo diffs and render invalidation all work per tile:
 * a brush stroke touching 3 tiles only needs to copy / save / redraw 3 tiles,
 * not the whole map.
 *
 * Edge tiles are allocated full-size; the cells beyond the grid bounds are
 * padding and never read. This keeps every tile the same shape.
 */
export const DEFAULT_TILE_SIZE = 256;

export const INT16_MIN = -32768;
export const INT16_MAX = 32767;

export interface Int16TiledGrid {
  readonly widthCells: number;
  readonly heightCells: number;
  readonly tileSize: number;
  readonly tilesX: number;
  readonly tilesY: number;
  /** Row-major: tile (tx, ty) is at index ty * tilesX + tx. Each holds tileSize² cells. */
  readonly tiles: Int16Array[];
}

export function createInt16TiledGrid(
  widthCells: number,
  heightCells: number,
  fill = 0,
  tileSize = DEFAULT_TILE_SIZE,
): Int16TiledGrid {
  if (!Number.isInteger(widthCells) || !Number.isInteger(heightCells) || widthCells <= 0 || heightCells <= 0) {
    throw new RangeError(`Invalid grid size ${widthCells}×${heightCells}`);
  }
  const tilesX = Math.ceil(widthCells / tileSize);
  const tilesY = Math.ceil(heightCells / tileSize);
  const value = clampInt16(fill);
  const tiles = Array.from({ length: tilesX * tilesY }, () => new Int16Array(tileSize * tileSize).fill(value));
  return { widthCells, heightCells, tileSize, tilesX, tilesY, tiles };
}

/**
 * Int16Array silently wraps out-of-range values (32768 becomes -32768):
 * a mountain raised too high would turn into an abyss. Always clamp first.
 */
export function clampInt16(value: number): number {
  return Math.min(INT16_MAX, Math.max(INT16_MIN, Math.round(value)));
}

export function isInside(grid: Int16TiledGrid, x: number, y: number): boolean {
  return x >= 0 && y >= 0 && x < grid.widthCells && y < grid.heightCells;
}

export function tileIndexAt(grid: Int16TiledGrid, x: number, y: number): number {
  return Math.floor(y / grid.tileSize) * grid.tilesX + Math.floor(x / grid.tileSize);
}

function offsetInTile(grid: Int16TiledGrid, x: number, y: number): number {
  return (y % grid.tileSize) * grid.tileSize + (x % grid.tileSize);
}

function assertInside(grid: Int16TiledGrid, x: number, y: number): void {
  if (!isInside(grid, x, y)) {
    throw new RangeError(`Cell (${x}, ${y}) outside grid ${grid.widthCells}×${grid.heightCells}`);
  }
}

export function getCell(grid: Int16TiledGrid, x: number, y: number): number {
  assertInside(grid, x, y);
  return grid.tiles[tileIndexAt(grid, x, y)][offsetInTile(grid, x, y)];
}

export function setCell(grid: Int16TiledGrid, x: number, y: number, value: number): void {
  assertInside(grid, x, y);
  grid.tiles[tileIndexAt(grid, x, y)][offsetInTile(grid, x, y)] = clampInt16(value);
}

/** Indices of all tiles overlapping the inclusive cell rectangle, clipped to the grid. */
export function tileIndicesInRect(grid: Int16TiledGrid, x0: number, y0: number, x1: number, y1: number): number[] {
  const minTx = Math.max(0, Math.floor(Math.min(x0, x1) / grid.tileSize));
  const maxTx = Math.min(grid.tilesX - 1, Math.floor(Math.max(x0, x1) / grid.tileSize));
  const minTy = Math.max(0, Math.floor(Math.min(y0, y1) / grid.tileSize));
  const maxTy = Math.min(grid.tilesY - 1, Math.floor(Math.max(y0, y1) / grid.tileSize));
  const result: number[] = [];
  for (let ty = minTy; ty <= maxTy; ty++) {
    for (let tx = minTx; tx <= maxTx; tx++) {
      result.push(ty * grid.tilesX + tx);
    }
  }
  return result;
}

export function allTileIndices(grid: Int16TiledGrid): number[] {
  return grid.tiles.map((_, i) => i);
}

/** Inclusive rectangle of cells. */
export interface CellRect {
  readonly x0: number;
  readonly y0: number;
  readonly x1: number;
  readonly y1: number;
}

export function clipRect(grid: Int16TiledGrid, rect: CellRect): CellRect | null {
  const x0 = Math.max(0, rect.x0);
  const y0 = Math.max(0, rect.y0);
  const x1 = Math.min(grid.widthCells - 1, rect.x1);
  const y1 = Math.min(grid.heightCells - 1, rect.y1);
  return x0 > x1 || y0 > y1 ? null : { x0, y0, x1, y1 };
}

export function expandRect(rect: CellRect, by: number): CellRect {
  return { x0: rect.x0 - by, y0: rect.y0 - by, x1: rect.x1 + by, y1: rect.y1 + by };
}

/** Cells of a tile that lie inside the grid (edge tiles are partial). */
export function tileRect(grid: Int16TiledGrid, tileIndex: number): CellRect {
  const x0 = (tileIndex % grid.tilesX) * grid.tileSize;
  const y0 = Math.floor(tileIndex / grid.tilesX) * grid.tileSize;
  return {
    x0,
    y0,
    x1: Math.min(grid.widthCells, x0 + grid.tileSize) - 1,
    y1: Math.min(grid.heightCells, y0 + grid.tileSize) - 1,
  };
}

/** Fast unchecked read with coordinates clamped to the grid (edges repeat). For filters and rendering. */
export function getCellClamped(grid: Int16TiledGrid, x: number, y: number): number {
  const cx = x < 0 ? 0 : x >= grid.widthCells ? grid.widthCells - 1 : x;
  const cy = y < 0 ? 0 : y >= grid.heightCells ? grid.heightCells - 1 : y;
  const size = grid.tileSize;
  return grid.tiles[((cy / size) | 0) * grid.tilesX + ((cx / size) | 0)][(cy % size) * size + (cx % size)];
}

/** Copies the grid into a plain row-major array (index = y * width + x). For whole-grid algorithms and workers. */
export function toRowMajor(grid: Int16TiledGrid): Int16Array {
  const out = new Int16Array(grid.widthCells * grid.heightCells);
  const size = grid.tileSize;
  for (let y = 0; y < grid.heightCells; y++) {
    const tileRow = ((y / size) | 0) * grid.tilesX;
    const rowInTile = (y % size) * size;
    for (let x = 0; x < grid.widthCells; x++) {
      out[y * grid.widthCells + x] = grid.tiles[tileRow + ((x / size) | 0)][rowInTile + (x % size)];
    }
  }
  return out;
}

/** Builds a tiled grid from a row-major array (inverse of `toRowMajor`). Values are clamped to Int16. */
export function fromRowMajor(values: ArrayLike<number>, widthCells: number, heightCells: number, tileSize = DEFAULT_TILE_SIZE): Int16TiledGrid {
  if (values.length !== widthCells * heightCells) {
    throw new RangeError(`Expected ${widthCells * heightCells} values, got ${values.length}`);
  }
  const grid = createInt16TiledGrid(widthCells, heightCells, 0, tileSize);
  for (let y = 0; y < heightCells; y++) {
    const tileRow = ((y / tileSize) | 0) * grid.tilesX;
    const rowInTile = (y % tileSize) * tileSize;
    for (let x = 0; x < widthCells; x++) {
      grid.tiles[tileRow + ((x / tileSize) | 0)][rowInTile + (x % tileSize)] = clampInt16(values[y * widthCells + x]);
    }
  }
  return grid;
}
