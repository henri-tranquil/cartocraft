import { MapSettings } from '../map/map-settings';
import { latitudeAtRow } from '../map/latitude';
import { LAPSE_RATE_C_PER_M, rowSeaLevelTemperaturesC } from '../climate/temperature';

/**
 * ZONAL CLIMATE OF THE DRAWING — a quick guess, before the real climate (D6).
 *
 * The drawing has no altitude and no wind yet, so its ground colour cannot
 * come from the climate simulation. Instead, two things depend only on the
 * latitude (a "zonal" mean = averaged along a circle of latitude):
 *
 * - Temperature: the same insolation → °C table as the climate model, with
 *   the axial tilt (warmest month at sea level, halfway between land and sea:
 *   neither a coast nor a continent interior), minus the lapse
 *   rate (6.5 °C / 1000 m) at an altitude guessed from the relief class.
 * - Wetness: Earth's zonal pattern, from the general circulation. Air rises at
 *   the equator (it rains), sinks around 20–30° (the great deserts: Sahara,
 *   Australia), rises again with the mid-latitude storms (40–60°, wet), and
 *   sinks at the poles (cold deserts).
 *
 * Limits: real deserts also depend on the continents (dry west coasts, wet
 * east coasts, rain shadows). The real climate replaces this after D6.
 */

/** [|latitude| °, wetness %] — rough zonal means of P / (P + PET), same scale as the climate's `wetnessPct`. */
const ZONAL_WETNESS: readonly (readonly [number, number])[] = [
  [0, 75],
  [10, 62],
  [20, 30],
  [27, 15],
  [35, 35],
  [45, 60],
  [60, 65],
  [75, 50],
  [90, 40],
];

/** [mean relief class value (0 = plain … 1 = high mountain, see RELIEF_VALUE), altitude m]. */
const RELIEF_ALTITUDE_M: readonly (readonly [number, number])[] = [
  [0, 100],
  [1 / 3, 400],
  [2 / 3, 1000],
  [1, 2500],
];

export function zonalWetnessPct(latitudeDeg: number): number {
  return interpolate(ZONAL_WETNESS, Math.abs(latitudeDeg));
}

/** Guessed altitude of a (possibly averaged) relief class value. */
export function reliefAltitudeM(reliefValue: number): number {
  return interpolate(RELIEF_ALTITUDE_M, reliefValue);
}

/** Cooling (°C) of a relief value relative to sea level. */
export function reliefCoolingC(reliefValue: number): number {
  return reliefAltitudeM(reliefValue) * LAPSE_RATE_C_PER_M;
}

/**
 * SNOW ON THE GLYPHS. Chances (0..1), so the edge of a snowy area is a
 * gradual mix of white and green glyphs rather than a sharp line.
 *
 * - Snow zone: summers so cool (warmest month at the ground) that winters are
 *   long and snowy: trees, hills and mountains all wear snow. Ramp chosen to
 *   overlap the pale ground wash (4 → 11 °C), slightly wider.
 * - Snow cap of a mid mountain outside the snow zone: its summit (~2000 m)
 *   stays cold enough in summer to keep snow (~50° and beyond on Earth).
 */
export const SNOW_ZONE_WARMEST_C = { full: 9, none: 13 } as const;
export const SNOW_CAP_WARMEST_C = { full: 3, none: 7 } as const;
/** Altitude of a glyph's summit, by relief class index (1 hills, 2 mid, 3 high mountain). */
export const RELIEF_SUMMIT_M = [0, 500, 2000, 3500] as const;
/** Ground altitude of a relief class index (0 plain … 3 high mountain): the class value of RELIEF_ALTITUDE_M. */
export function reliefClassAltitudeM(reliefIndex: number): number {
  return reliefAltitudeM(reliefIndex / 3);
}

/** Chance that a glyph on ground of this relief class lies in the snow zone. */
export function snowZoneChance(warmestSeaLevelC: number, reliefIndex: number): number {
  const t = warmestSeaLevelC - reliefClassAltitudeM(reliefIndex) * LAPSE_RATE_C_PER_M;
  return 1 - ramp(SNOW_ZONE_WARMEST_C.full, SNOW_ZONE_WARMEST_C.none, t);
}

/** Chance that a mountain glyph (relief index 2 or 3) has a snow cap. High mountains always do. */
export function snowCapChance(warmestSeaLevelC: number, reliefIndex: number): number {
  if (reliefIndex >= 3) return 1;
  if (reliefIndex < 2) return 0;
  const summit = warmestSeaLevelC - RELIEF_SUMMIT_M[reliefIndex] * LAPSE_RATE_C_PER_M;
  return Math.max(snowZoneChance(warmestSeaLevelC, reliefIndex), 1 - ramp(SNOW_CAP_WARMEST_C.full, SNOW_CAP_WARMEST_C.none, summit));
}

function ramp(a: number, b: number, x: number): number {
  return x <= a ? 0 : x >= b ? 1 : (x - a) / (b - a);
}

/**
 * The climate the drawing's renderer reads (ground colour, snow on the glyphs),
 * at a point in cell coordinates: zonal (by latitude only) until the winds'
 * weather is computed, then the weather of drawing-weather.ts.
 */
export interface GroundClimate {
  /** P / (P + PET), %. */
  wetnessPct(xCell: number, yCell: number): number;
  /** Warmest month at sea level, °C. */
  warmestC(xCell: number, yCell: number): number;
  /** The month shown (season slider), at sea level, °C. */
  monthC(xCell: number, yCell: number): number;
}

/** Before the winds' weather is computed: by latitude only, and no seasonal snow (the month reads as summer). */
export function zonalGroundClimate(rows: ZonalRows): GroundClimate {
  const row = (y: number) => Math.max(0, Math.min(rows.warmestC.length - 1, Math.floor(y)));
  return {
    wetnessPct: (_x, y) => rows.wetnessPct[row(y)],
    warmestC: (_x, y) => rows.warmestC[row(y)],
    monthC: (_x, y) => rows.warmestC[row(y)],
  };
}

/**
 * SEASONAL SNOW: the ground (and the trees, the hills) is white when the
 * month shown is cold enough at its height: full cover below −3 °C, none above
 * +1 °C (a monthly mean around 0 °C means days of thaw and days of snow).
 */
export const SNOW_COVER_C = { full: -3, none: 1 } as const;

/** Chance of snow cover for a ground temperature of the month (°C). */
export function snowCoverChance(groundMonthC: number): number {
  return 1 - ramp(SNOW_COVER_C.full, SNOW_COVER_C.none, groundMonthC);
}

/**
 * Snow on a glyph at a point, for the month shown. `cap`: mountain glyphs,
 * whose summit keeps snow longer (it is higher than the ground) and all year
 * where summers are cold (perennial caps, see snowCapChance). Others: the
 * snow cover of the ground at the class's altitude.
 */
export function glyphSnowChance(climate: GroundClimate, xCell: number, yCell: number, reliefIndex: number, cap: boolean): number {
  const month = climate.monthC(xCell, yCell);
  const cover = snowCoverChance(month - reliefClassAltitudeM(reliefIndex) * LAPSE_RATE_C_PER_M);
  if (!cap) return cover;
  const summit = snowCoverChance(month - RELIEF_SUMMIT_M[Math.min(3, reliefIndex)] * LAPSE_RATE_C_PER_M);
  return Math.max(cover, summit, snowCapChance(climate.warmestC(xCell, yCell), reliefIndex));
}

export interface ZonalRows {
  /** Per cell row: zonal wetness (%). */
  readonly wetnessPct: Float32Array;
  /** Per cell row: warmest month at sea level, halfway land / sea (°C). */
  readonly warmestC: Float32Array;
}

/** One value per cell row: the latitude varies only along y. */
export function zonalRows(
  settings: Pick<MapSettings, 'latitudeTopDeg' | 'latitudeBottomDeg' | 'axialTiltDeg' | 'globalTemperatureOffsetC'>,
  heightCells: number,
): ZonalRows {
  const wetnessPct = new Float32Array(heightCells);
  const warmestC = new Float32Array(heightCells);
  for (let y = 0; y < heightCells; y++) {
    const lat = latitudeAtRow(settings, heightCells, y + 0.5);
    wetnessPct[y] = zonalWetnessPct(lat);
    // Halfway between deep inland and open sea: a drawn map has no wind yet to say which.
    const { land, sea } = rowSeaLevelTemperaturesC(lat, settings);
    let warmest = -Infinity;
    for (let m = 0; m < land.length; m++) warmest = Math.max(warmest, (land[m] + sea[m]) / 2);
    warmestC[y] = warmest;
  }
  return { wetnessPct, warmestC };
}

function interpolate(table: readonly (readonly [number, number])[], x: number): number {
  if (x <= table[0][0]) return table[0][1];
  for (let i = 1; i < table.length; i++) {
    const [x1, y1] = table[i];
    if (x <= x1) {
      const [x0, y0] = table[i - 1];
      return y0 + ((y1 - y0) * (x - x0)) / (x1 - x0);
    }
  }
  return table[table.length - 1][1];
}
