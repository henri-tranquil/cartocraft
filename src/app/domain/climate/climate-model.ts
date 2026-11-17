/**
 * Inputs and outputs of the climate computation. Plain data with TypedArrays
 * only, so it can cross the worker boundary (structured clone / transfer).
 */
export interface ClimateInput {
  readonly widthCells: number;
  readonly heightCells: number;
  /** Row-major altitudes (index = y * width + x), metres. */
  readonly altitudeM: Int16Array;
  readonly latitudeTopDeg: number;
  readonly latitudeBottomDeg: number;
  readonly axialTiltDeg: number;
  readonly seaLevelM: number;
  readonly globalTemperatureOffsetC: number;
}

/** We precompute 12 monthly snapshots; the season slider interpolates between them. */
export const MONTHS = 12;

/**
 * Temperatures are stored as Int16 tenths of °C (−3276.8..3276.7 °C, 0.1 °C
 * precision): half the memory of Float32. 12 months × 1000² cells = 24 MB.
 */
export const TEMPERATURE_SCALE = 10;

export interface ClimateResult {
  readonly widthCells: number;
  readonly heightCells: number;
  /** MONTHS consecutive row-major fields, month m at offset m * width * height. Tenths of °C. */
  readonly temperatureDeciC: Int16Array;
}

/** Year phase at the middle of month `m` (0 = January). */
export function monthMidPhase(month: number): number {
  return (month + 0.5) / MONTHS;
}

/** Latitude at the centre of row `y`: linear between the top and bottom edges. */
export function rowLatitudeDeg(input: Pick<ClimateInput, 'heightCells' | 'latitudeTopDeg' | 'latitudeBottomDeg'>, y: number): number {
  return input.latitudeTopDeg + ((input.latitudeBottomDeg - input.latitudeTopDeg) * (y + 0.5)) / input.heightCells;
}

/** Which two mid-month snapshots surround `yearPhase`, and the blend factor between them. */
export function monthBlend(yearPhase: number): { m0: number; m1: number; f: number } {
  const m = (((yearPhase * MONTHS - 0.5) % MONTHS) + MONTHS) % MONTHS;
  const m0 = Math.floor(m);
  return { m0, m1: (m0 + 1) % MONTHS, f: m - m0 };
}

/**
 * Temperature at a cell for a continuous year phase, by linear interpolation
 * between the two surrounding mid-month snapshots (wrapping December → January).
 */
export function temperatureAtC(result: ClimateResult, cellIndex: number, yearPhase: number): number {
  const size = result.widthCells * result.heightCells;
  const { m0, m1, f } = monthBlend(yearPhase);
  const t0 = result.temperatureDeciC[m0 * size + cellIndex];
  const t1 = result.temperatureDeciC[m1 * size + cellIndex];
  return (t0 + (t1 - t0) * f) / TEMPERATURE_SCALE;
}
