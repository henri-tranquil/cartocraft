/**
 * HOW MOUNTAINS STEER AND BLOCK THE AIR.
 *
 * A cold air mass is dense and shallow (often 1–1.5 km thick). Faced with a
 * range higher than itself it cannot climb over: it piles up against the
 * slope (cold-air damming) and flows AROUND, along the range. The valley in
 * the lee stays sheltered. Warm air is lighter and crosses more easily.
 *
 * 1. Deflection: the part of the wind blowing straight up the slope is
 *    removed in proportion to how much height it would have to climb over a
 *    typical distance; what is left follows the contour lines.
 * 2. Blocking: during advection, every metre the air must climb from its
 *    upwind point erodes its memory: × e^(−climb / depth). Depth is small for
 *    air colder than the ground beneath (it is "stuck"), large for warmer air.
 */

/** Distance over which the climb ahead is judged for deflection. */
const DEFLECTION_REACH_KM = 50;
export const COLD_AIR_DEPTH_M = 1000;
export const WARM_AIR_DEPTH_M = 3000;
/** Deflected air slows down a little (friction against the range). */
const DEFLECTION_SLOWDOWN = 0.3;

export interface TerrainSlope {
  /** dH/dEast and dH/dNorth, metres per km. */
  readonly east: Float32Array;
  readonly north: Float32Array;
}

/** Central differences of a height field (metres) on a grid with y pointing south. */
export function terrainSlope(heightM: Float32Array, w: number, h: number, cellKm: number): TerrainSlope {
  const east = new Float32Array(w * h);
  const north = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const c = y * w + x;
      east[c] = (heightM[y * w + Math.min(w - 1, x + 1)] - heightM[y * w + Math.max(0, x - 1)]) / (2 * cellKm);
      north[c] = -(heightM[Math.min(h - 1, y + 1) * w + x] - heightM[Math.max(0, y - 1) * w + x]) / (2 * cellKm);
    }
  }
  return { east, north };
}

/**
 * How stable (hard to lift) the low-level air is, 0..1, from the thermal
 * anomaly (°C vs. the sea at the same latitude): a cold continent in winter
 * holds shallow, stable cold air (1); mild or warm ground (≥ 0) lets moist air
 * rise over the mountains (0) — that is what feeds orographic rain.
 */
export function stabilityFromAnomaly(anomalyC: number): number {
  return Math.min(1, Math.max(0, -anomalyC / 8));
}

/** Wind (u east, v north, m/s) after deflection by a slope (m/km), for air of a given stability (0..1). */
export function deflectWind(u: number, v: number, slopeEast: number, slopeNorth: number, stability = 1): { u: number; v: number } {
  const steepness = Math.hypot(slopeEast, slopeNorth);
  const speed = Math.hypot(u, v);
  if (steepness < 1e-3 || speed < 1e-6) return { u, v };
  const nx = slopeEast / steepness;
  const ny = slopeNorth / steepness;
  const uphill = u * nx + v * ny; // > 0: blowing up the slope
  if (uphill <= 0) return { u, v };
  const blocked = stability * (1 - Math.exp(-(steepness * DEFLECTION_REACH_KM) / COLD_AIR_DEPTH_M));
  let du = u - uphill * nx * blocked;
  let dv = v - uphill * ny * blocked;
  // Keep most of the speed: the air is redirected along the range, not stopped.
  const kept = Math.hypot(du, dv);
  const target = speed * (1 - DEFLECTION_SLOWDOWN * blocked);
  if (kept > 1e-6) {
    du *= target / kept;
    dv *= target / kept;
  }
  return { u: du, v: dv };
}
