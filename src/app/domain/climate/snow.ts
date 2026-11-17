/**
 * SNOWPACK — a monthly mass balance per cell.
 *
 *   stock(month) = stock(previous month) + snowfall − melt
 *
 * - Snowfall: the share of precipitation falling as snow (all of it below
 *   −1 °C, none above +3 °C, mixed in between).
 * - Melt: the "degree-day" method used in mountain hydrology: each degree
 *   above 0 °C melts about 3 mm of water-equivalent per day.
 * Stocks are in mm of WATER EQUIVALENT (what you get by melting the snow);
 * fresh-to-settled snow is ~3× less dense than water, so depth ≈ 3 × that.
 * Where the stock never melts out, snow accumulates year after year: glaciers.
 */

export const DEGREE_DAY_MM_PER_C_PER_DAY = 3;
const DAYS_PER_MONTH = 365.25 / 12;
/** Snow depth (mm) per mm of water equivalent. */
export const SNOW_DEPTH_PER_SWE = 3;
/** Cap the water equivalent (glaciers would otherwise grow forever in a cyclic year). */
export const MAX_SWE_MM = 3000;
/** Precipitation falls as snow on days colder than this. */
const SNOW_THRESHOLD_C = 1;
/**
 * Day-to-day spread of temperatures around the monthly mean. A month
 * averaging +1 °C has days at −5 (it snows) and days at +6 (it melts):
 * working with the mean alone would turn all of it into rain.
 */
export const DAILY_SPREAD_C = 4;

/** Standard normal density φ and cumulative Φ (Abramowitz–Stegun 7.1.26 erf, error < 1.5e-7). */
function normalPdf(z: number): number {
  return Math.exp(-0.5 * z * z) / Math.sqrt(2 * Math.PI);
}
export function normalCdf(z: number): number {
  const x = Math.abs(z) / Math.SQRT2;
  const t = 1 / (1 + 0.3275911 * x);
  const erf = 1 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x);
  return z >= 0 ? 0.5 * (1 + erf) : 0.5 * (1 - erf);
}

/** Share of the month's precipitation falling as snow: share of days below the threshold. */
export function snowFraction(meanTemperatureC: number): number {
  return normalCdf((SNOW_THRESHOLD_C - meanTemperatureC) / DAILY_SPREAD_C);
}

/**
 * Mean positive degrees per day, E[max(0, T_day)] for T_day ~ N(mean, σ):
 * σ·φ(m/σ) + m·Φ(m/σ). Positive even when the monthly mean is below 0.
 */
export function positiveDegrees(meanTemperatureC: number): number {
  const z = meanTemperatureC / DAILY_SPREAD_C;
  return DAILY_SPREAD_C * normalPdf(z) + meanTemperatureC * normalCdf(z);
}

/** One month of the balance: returns the new water-equivalent stock (mm). */
export function snowStep(sweMm: number, temperatureC: number, precipitationMm: number): number {
  const snowfall = precipitationMm * snowFraction(temperatureC);
  const melt = DEGREE_DAY_MM_PER_C_PER_DAY * positiveDegrees(temperatureC) * DAYS_PER_MONTH;
  return Math.min(MAX_SWE_MM, Math.max(0, sweMm + snowfall - melt));
}

const LUT_MIN_DECI = -600;
const LUT_SIZE = 1201;
let lut: { snow: Float32Array; meltMm: Float32Array } | null = null;

/** Same as snowStep with the temperature in tenths of °C, through lookup tables (hot loop). */
export function snowStepDeci(sweMm: number, temperatureDeciC: number, precipitationMm: number): number {
  if (!lut) {
    const snow = new Float32Array(LUT_SIZE);
    const meltMm = new Float32Array(LUT_SIZE);
    for (let i = 0; i < LUT_SIZE; i++) {
      const t = (i + LUT_MIN_DECI) / 10;
      snow[i] = snowFraction(t);
      meltMm[i] = DEGREE_DAY_MM_PER_C_PER_DAY * positiveDegrees(t) * DAYS_PER_MONTH;
    }
    lut = { snow, meltMm };
  }
  const k = Math.min(LUT_SIZE - 1, Math.max(0, temperatureDeciC - LUT_MIN_DECI));
  return Math.min(MAX_SWE_MM, Math.max(0, sweMm + precipitationMm * lut.snow[k] - lut.meltMm[k]));
}

/** Share of the ground hidden by a given snow depth: ~15 cm whitens it completely. */
export function snowCover(depthCm: number): number {
  return 1 - Math.exp(-depthCm / 6);
}
