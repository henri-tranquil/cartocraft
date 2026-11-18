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
