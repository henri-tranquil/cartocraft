import { CellRect, getCellClamped, INT16_MIN, Int16TiledGrid } from '../domain/terrain/tiled-grid';
import { ClimateResult, monthBlend, TEMPERATURE_SCALE } from '../domain/climate/climate-model';
import { AltitudePalette } from './style/altitude-palette';
import { TEMPERATURE_PALETTE_MAX_C, TEMPERATURE_PALETTE_MIN_C } from './style/temperature-palette';

/** Colour by temperature at a given season instead of by altitude. */
export interface TemperatureLayer {
  readonly result: ClimateResult;
  readonly yearPhase: number;
  /** From buildTemperaturePalette(). */
  readonly rgb: Uint8Array;
}

/** In temperature view the sea keeps a hint of blue, so coasts stay readable. */
const SEA_TINT = [169, 180, 208] as const;
const SEA_TINT_WEIGHT = 0.35;

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
  temperature: TemperatureLayer | null = null,
): void {
  const size = grid.tileSize;
  const tileX0 = (tileIndex % grid.tilesX) * size;
  const tileY0 = Math.floor(tileIndex / grid.tilesX) * size;
  const tile = grid.tiles[tileIndex];
  const slopeScale = VERTICAL_EXAGGERATION / (2 * cellSizeM);
  const [lx, ly, lz] = LIGHT;

  // Temperature view: resolve the season blend once, not per pixel.
  const tData = temperature?.result.temperatureDeciC;
  const tWidth = temperature?.result.widthCells ?? 0;
  const fieldSize = tWidth * (temperature?.result.heightCells ?? 0);
  const blend = temperature ? monthBlend(temperature.yearPhase) : { m0: 0, m1: 0, f: 0 };
  const off0 = blend.m0 * fieldSize;
  const off1 = blend.m1 * fieldSize;
  const tLut = temperature?.rgb;
  const tMaxIndex = TEMPERATURE_PALETTE_MAX_C - TEMPERATURE_PALETTE_MIN_C;

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

      let r: number;
      let g: number;
      let b: number;
      if (tData && tLut) {
        const i = y * tWidth + x;
        const tC = (tData[off0 + i] + (tData[off1 + i] - tData[off0 + i]) * blend.f) / TEMPERATURE_SCALE;
        const li = Math.min(tMaxIndex, Math.max(0, Math.round(tC) - TEMPERATURE_PALETTE_MIN_C)) * 3;
        r = tLut[li];
        g = tLut[li + 1];
        b = tLut[li + 2];
        if (altitude <= palette.seaLevelM) {
          r += (SEA_TINT[0] - r) * SEA_TINT_WEIGHT;
          g += (SEA_TINT[1] - g) * SEA_TINT_WEIGHT;
          b += (SEA_TINT[2] - b) * SEA_TINT_WEIGHT;
        }
      } else {
        const c = (altitude - INT16_MIN) * 3;
        r = palette.rgb[c];
        g = palette.rgb[c + 1];
        b = palette.rgb[c + 2];
      }
      const o = local * 4;
      out[o] = r * shade; // Uint8ClampedArray clamps to 0..255 by itself
      out[o + 1] = g * shade;
      out[o + 2] = b * shade;
      out[o + 3] = 255;
    }
  }
}
