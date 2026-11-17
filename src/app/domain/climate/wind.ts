import { solarDeclinationDeg } from './insolation';
import { ClimateResult, sampleCoarseMonthly } from './climate-model';

/**
 * PREVAILING SURFACE WINDS — the "three-cell" model of atmospheric circulation.
 *
 * Hot air rises at the equator, flows poleward aloft, sinks around 30°, and
 * returns to the equator along the ground (Hadley cell). A mirror loop works
 * near the poles (polar cell, sinking at the pole, rising around 60°), and the
 * Ferrel cell in between is dragged along by both. At ground level this gives
 * winds flowing equatorward between 0–30° and 60–90°, poleward between 30–60°.
 *
 * The Earth's rotation then deflects every moving air mass (Coriolis effect:
 * to the right in the northern hemisphere, to the left in the southern one):
 *   0–30°   equatorward flow → deflected westward → TRADE WINDS (from the NE in the north)
 *   30–60°  poleward flow    → deflected eastward → WESTERLIES (from the SW in the north)
 *   60–90°  equatorward flow → deflected westward → POLAR EASTERLIES
 * with calm belts at the boundaries: doldrums (0°), horse latitudes (30°), and
 * the polar front (60°), where westerlies meet cold polar air (rainy!).
 *
 * The whole pattern follows the sun: the belts shift north in July and south
 * in January, by a fraction of the solar declination (the thermal equator
 * lags and moves less than the sun itself).
 *
 * Here: a smooth function of latitude, u = −U·sin(6|φ|) (east component) and
 * v = −V·sin(6|φ|)·sign(φ) (north component): sin(6φ) changes sign exactly at
 * 0°, 30°, 60°, 90°. Monsoon winds (monsoon.ts) are added on top;
 * terrain deflection comes with the orographic brick.
 */

/** Share of the solar declination by which the belts shift with the seasons. */
export const BELT_SHIFT_FACTOR = 0.4;
/** Peak east–west speed of each belt, m/s (typical surface values). */
const TRADES_MS = 6;
const WESTERLIES_MS = 8;
const POLAR_MS = 4;
/** North–south flow is weaker than east–west flow after deflection. */
const MERIDIONAL_RATIO = 0.35;

export interface WindVector {
  /** Eastward component, m/s (positive = blowing toward the east). */
  readonly uMs: number;
  /** Northward component, m/s (positive = blowing toward the north). */
  readonly vMs: number;
}

/** Latitude of the "thermal equator" (centre of the belts) at a year phase. */
export function beltShiftDeg(yearPhase: number, axialTiltDeg: number): number {
  return BELT_SHIFT_FACTOR * solarDeclinationDeg(yearPhase, axialTiltDeg);
}

export function prevailingWind(latitudeDeg: number, yearPhase: number, axialTiltDeg: number): WindVector {
  const phi = Math.max(-90, Math.min(90, latitudeDeg - beltShiftDeg(yearPhase, axialTiltDeg)));
  const a = Math.abs(phi);
  const s = Math.sin((6 * a * Math.PI) / 180);
  const peak = a < 30 ? TRADES_MS : a < 60 ? WESTERLIES_MS : POLAR_MS;
  const uMs = -peak * s;
  const vMs = -peak * MERIDIONAL_RATIO * s * Math.sign(phi);
  return { uMs: uMs + 0, vMs: vMs + 0 }; // + 0 turns −0 into 0
}

/** Wind under a fine cell at a continuous year phase (bilinear on the coarse wind grid, interpolated between months). */
export function windAt(
  result: Pick<ClimateResult, 'windGrid' | 'windUMs' | 'windVMs'>,
  xCell: number,
  yCell: number,
  yearPhase: number,
): WindVector {
  return {
    uMs: sampleCoarseMonthly(result, result.windUMs, xCell, yCell, yearPhase),
    vMs: sampleCoarseMonthly(result, result.windVMs, xCell, yCell, yearPhase),
  };
}

const FROM_DIRECTIONS = ['N', 'NE', 'E', 'SE', 'S', 'SO', 'O', 'NO'];

/**
 * Meteorological convention: a wind is named after where it COMES FROM
 * (a "west wind" blows toward the east). French abbreviations (O = ouest).
 */
export function windFromDirection(wind: WindVector): string {
  const fromAngle = Math.atan2(-wind.uMs, -wind.vMs); // 0 = from the north, clockwise
  const sector = Math.round(((fromAngle * 180) / Math.PI + 360) / 45) % 8;
  return FROM_DIRECTIONS[sector];
}
