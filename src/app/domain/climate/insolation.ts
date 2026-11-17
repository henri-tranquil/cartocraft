/**
 * INSOLATION — how much sunlight reaches the top of the atmosphere, averaged
 * over a whole day, in W/m².
 *
 * Two angles decide it:
 * - the latitude φ of the place;
 * - the solar declination δ: the latitude where the sun is overhead at noon.
 *   Because the planet's axis is tilted, δ swings between +tilt (northern
 *   summer solstice) and −tilt (northern winter solstice) over the year.
 *
 * Over one day the sun rises at hour angle −h₀ and sets at +h₀, where
 * cos h₀ = −tan φ · tan δ. Integrating the sun's height over that interval
 * gives the classic formula:
 *
 *   Q = (S₀ / π) · (h₀ · sin φ · sin δ + cos φ · cos δ · sin h₀)
 *
 * Near the poles, |tan φ · tan δ| > 1: the sun never sets (polar day, h₀ = π)
 * or never rises (polar night, h₀ = 0).
 */

/** Solar constant: sunlight power at Earth's distance from the Sun. */
export const SOLAR_CONSTANT_W_M2 = 1361;

/**
 * Year phase `t ∈ [0, 1[`: 0 = 1st January, 0.5 ≈ 1st July.
 * The northern winter solstice (21 Dec) is ~10 days before t = 0.
 */
const WINTER_SOLSTICE_OFFSET = 10 / 365;

const DEG = Math.PI / 180;

export function solarDeclinationDeg(yearPhase: number, axialTiltDeg: number): number {
  return -axialTiltDeg * Math.cos(2 * Math.PI * (yearPhase + WINTER_SOLSTICE_OFFSET));
}

export function dailyInsolationWm2(latitudeDeg: number, declinationDeg: number): number {
  const phi = latitudeDeg * DEG;
  const delta = declinationDeg * DEG;
  const x = -Math.tan(phi) * Math.tan(delta);
  const h0 = x >= 1 ? 0 : x <= -1 ? Math.PI : Math.acos(x);
  const q =
    (SOLAR_CONSTANT_W_M2 / Math.PI) *
    (h0 * Math.sin(phi) * Math.sin(delta) + Math.cos(phi) * Math.cos(delta) * Math.sin(h0));
  return Math.max(0, q);
}

/** Yearly mean of the daily insolation, by numerical integration over `samples` days. */
export function annualMeanInsolationWm2(latitudeDeg: number, axialTiltDeg: number, samples = 48): number {
  let sum = 0;
  for (let i = 0; i < samples; i++) {
    sum += dailyInsolationWm2(latitudeDeg, solarDeclinationDeg((i + 0.5) / samples, axialTiltDeg));
  }
  return sum / samples;
}
