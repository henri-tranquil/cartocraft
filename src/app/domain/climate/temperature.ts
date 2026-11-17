import { ClimateInput, ClimateResult, MONTHS, monthMidPhase, rowLatitudeDeg, TEMPERATURE_SCALE } from './climate-model';
import { annualMeanInsolationWm2, dailyInsolationWm2, solarDeclinationDeg } from './insolation';

/**
 * BASE TEMPERATURE MODEL (brick 1 — no wind or humidity yet).
 *
 * 1. Annual mean from annual mean insolation. The relation is NOT linear on
 *    Earth: flat in the tropics, steep toward the poles (the atmosphere and
 *    oceans carry heat poleward and the poles' ice reflects sunlight). We
 *    interpolate in a table built from Earth's zonal annual means, so a
 *    different axial tilt (hence insolation) still changes the result.
 *
 * 2. Seasonal swing = how far this month's insolation is from the annual mean,
 *    converted to °C, then DAMPED and DELAYED by thermal inertia:
 *    - land heats and cools fast: large swing, ~1 month late;
 *    - the sea stores heat in depth: small swing, ~2 months late.
 *    That is why the warmest month is July (not the June solstice).
 *    Without wind, every land cell is "continental"; maritime mildness on
 *    coasts comes with advection (brick 3).
 *
 * 3. Altitude: air cools ~6.5 °C per 1000 m as it rises (the "lapse rate").
 *    Sea cells use sea level, and sea surface never goes below the freezing
 *    point of seawater (ice forms and insulates the water below).
 */

/** [annual mean insolation W/m², annual mean temperature °C], from Earth's zonal means (90° → 0°). */
const MEAN_TEMPERATURE_BY_INSOLATION: readonly (readonly [number, number])[] = [
  [173, -22],
  [183, -18],
  [213, -10],
  [247, -1],
  [288, 6],
  [330, 14],
  [367, 20],
  [395, 25],
  [417, 26.5],
];
/** °C per W/m² used for the seasonal swing (mid-latitude slope of the table). */
const SEASONAL_SLOPE_C_PER_WM2 = 0.19;
const LAND_SEASONAL_RESPONSE = 0.45;
const SEA_SEASONAL_RESPONSE = 0.12;
const LAND_LAG_YEAR = 1 / 12;
const SEA_LAG_YEAR = 2 / 12;
export const LAPSE_RATE_C_PER_M = 6.5 / 1000;
export const SEAWATER_FREEZING_C = -1.8;

/** Piecewise-linear lookup, extrapolating linearly beyond the table ends. */
export function meanTemperatureFromInsolationC(meanInsolationWm2: number): number {
  const table = MEAN_TEMPERATURE_BY_INSOLATION;
  let i = 1;
  while (i < table.length - 1 && meanInsolationWm2 > table[i][0]) i++;
  const [q0, t0] = table[i - 1];
  const [q1, t1] = table[i];
  return t0 + ((t1 - t0) * (meanInsolationWm2 - q0)) / (q1 - q0);
}

export function computeMonthlyTemperatures(input: ClimateInput): ClimateResult {
  const { widthCells: w, heightCells: h, altitudeM, seaLevelM, axialTiltDeg } = input;
  const size = w * h;
  const out = new Int16Array(MONTHS * size);

  for (let y = 0; y < h; y++) {
    // Everything that depends only on latitude is computed once per row.
    const lat = rowLatitudeDeg(input, y);
    const meanQ = annualMeanInsolationWm2(lat, axialTiltDeg);
    const meanT = meanTemperatureFromInsolationC(meanQ) + input.globalTemperatureOffsetC;
    const landSwing = new Float64Array(MONTHS);
    const seaSwing = new Float64Array(MONTHS);
    for (let m = 0; m < MONTHS; m++) {
      const t = monthMidPhase(m);
      const qLand = dailyInsolationWm2(lat, solarDeclinationDeg(t - LAND_LAG_YEAR, axialTiltDeg));
      const qSea = dailyInsolationWm2(lat, solarDeclinationDeg(t - SEA_LAG_YEAR, axialTiltDeg));
      landSwing[m] = LAND_SEASONAL_RESPONSE * SEASONAL_SLOPE_C_PER_WM2 * (qLand - meanQ);
      seaSwing[m] = SEA_SEASONAL_RESPONSE * SEASONAL_SLOPE_C_PER_WM2 * (qSea - meanQ);
    }

    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const isLand = altitudeM[i] > seaLevelM;
      const coolingC = isLand ? (altitudeM[i] - seaLevelM) * LAPSE_RATE_C_PER_M : 0;
      const swing = isLand ? landSwing : seaSwing;
      for (let m = 0; m < MONTHS; m++) {
        const t = meanT + swing[m] - coolingC;
        out[m * size + i] = Math.round((isLand ? t : Math.max(SEAWATER_FREEZING_C, t)) * TEMPERATURE_SCALE);
      }
    }
  }
  return { widthCells: w, heightCells: h, temperatureDeciC: out };
}
