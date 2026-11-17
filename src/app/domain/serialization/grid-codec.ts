import { createInt16TiledGrid, DEFAULT_TILE_SIZE, Int16TiledGrid } from '../terrain/tiled-grid';

/**
 * Serialized grids are ROW-MAJOR and LITTLE-ENDIAN, independent of the
 * in-memory tile size. A file stays readable if we change the tile size,
 * and an external tool (Godot export) can read it as a plain raster.
 *
 * Endianness: a TypedArray uses the CPU's byte order. Almost every machine is
 * little-endian, but a file format must not depend on that, so we go through
 * a DataView with an explicit `littleEndian = true`.
 */
export function int16GridToBytes(grid: Int16TiledGrid): Uint8Array {
  const { widthCells, heightCells, tileSize, tilesX } = grid;
  const bytes = new Uint8Array(widthCells * heightCells * 2);
  const view = new DataView(bytes.buffer);
  for (let y = 0; y < heightCells; y++) {
    const tileRow = Math.floor(y / tileSize) * tilesX;
    const rowInTile = (y % tileSize) * tileSize;
    for (let x = 0; x < widthCells; x++) {
      const value = grid.tiles[tileRow + Math.floor(x / tileSize)][rowInTile + (x % tileSize)];
      view.setInt16((y * widthCells + x) * 2, value, true);
    }
  }
  return bytes;
}

export function int16GridFromBytes(
  bytes: Uint8Array,
  widthCells: number,
  heightCells: number,
  tileSize = DEFAULT_TILE_SIZE,
): Int16TiledGrid {
  if (bytes.byteLength !== widthCells * heightCells * 2) {
    throw new RangeError(`Expected ${widthCells * heightCells * 2} bytes, got ${bytes.byteLength}`);
  }
  const grid = createInt16TiledGrid(widthCells, heightCells, 0, tileSize);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const { tilesX } = grid;
  for (let y = 0; y < heightCells; y++) {
    const tileRow = Math.floor(y / tileSize) * tilesX;
    const rowInTile = (y % tileSize) * tileSize;
    for (let x = 0; x < widthCells; x++) {
      grid.tiles[tileRow + Math.floor(x / tileSize)][rowInTile + (x % tileSize)] = view.getInt16(
        (y * widthCells + x) * 2,
        true,
      );
    }
  }
  return grid;
}
