import { CellRect, getCellClamped, INT16_MIN, Int16TiledGrid } from '../domain/terrain/tiled-grid';
import { AltitudePalette } from './style/altitude-palette';

/**
 * Hillshading: we light the terrain from the north-west, like a classic
 * relief map. For each cell we estimate the slope from its neighbours
 * (central differences), build the surface normal, and take its dot product
 * with the light direction (Lambert's law: brightness ∝ cos of the angle
 * between normal and light).
 *
 * Slopes at 1 km/cell are tiny (a 300 m hill → 0.3 rad), so we exaggerate
 * the vertical scale, as hand-drawn relief maps also do.
 */
const LIGHT = normalize(-1, -1, 1.5); // towards the light: north-west (screen y points down), above
const VERTICAL_EXAGGERATION = 6;
const LAND_SHADE_GAIN = 2.2;
const SEA_SHADE_GAIN = 0.4;

function normalize(x: number, y: number, z: number): readonly [number, number, number] {
  const len = Math.hypot(x, y, z);
  return [x / len, y / len, z / len];
}

/**
 * Writes RGBA pixels (1 pixel per cell) for `rect`, which must lie within
 * tile `tileIndex`, into that tile's pixel buffer (tileSize² × 4 bytes).
 * Pure function: no canvas involved, so it is unit-testable and worker-ready.
 */
export function renderTerrainPixels(
  grid: Int16TiledGrid,
  tileIndex: number,
  rect: CellRect,
  out: Uint8ClampedArray,
  palette: AltitudePalette,
  cellSizeM: number,
): void {
  const size = grid.tileSize;
  const tileX0 = (tileIndex % grid.tilesX) * size;
  const tileY0 = Math.floor(tileIndex / grid.tilesX) * size;
  const tile = grid.tiles[tileIndex];
  const slopeScale = VERTICAL_EXAGGERATION / (2 * cellSizeM);
  const [lx, ly, lz] = LIGHT;

  for (let y = rect.y0; y <= rect.y1; y++) {
    const rowOffset = (y - tileY0) * size;
    for (let x = rect.x0; x <= rect.x1; x++) {
      const local = rowOffset + (x - tileX0);
      const altitude = tile[local];
      const dzdx = (getCellClamped(grid, x + 1, y) - getCellClamped(grid, x - 1, y)) * slopeScale;
      const dzdy = (getCellClamped(grid, x, y + 1) - getCellClamped(grid, x, y - 1)) * slopeScale;
      // Normal of z = f(x, y) is (-dz/dx, -dz/dy, 1).
      const brightness = (-dzdx * lx - dzdy * ly + lz) / Math.sqrt(dzdx * dzdx + dzdy * dzdy + 1);
      const gain = altitude > palette.seaLevelM ? LAND_SHADE_GAIN : SEA_SHADE_GAIN;
      // Flat ground (brightness = lz) keeps its palette colour.
      const shade = Math.min(1.6, Math.max(0.35, 1 + (brightness - lz) * gain));

      const c = (altitude - INT16_MIN) * 3;
      const o = local * 4;
      out[o] = palette.rgb[c] * shade; // Uint8ClampedArray clamps to 0..255 by itself
      out[o + 1] = palette.rgb[c + 1] * shade;
      out[o + 2] = palette.rgb[c + 2] * shade;
      out[o + 3] = 255;
    }
  }
}
