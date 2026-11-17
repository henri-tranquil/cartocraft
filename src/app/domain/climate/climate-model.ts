import { BeyondEdges } from '../map/map-settings';
import type { LakeSeed } from '../hydrology/lakes';
/**
 * Inputs and outputs of the climate computation. Plain data with TypedArrays
 * only, so it can cross the worker boundary (structured clone / transfer).
 */
export interface ClimateInput {
  readonly widthCells: number;
  readonly heightCells: number;
  /** Size of one cell (distances matter for wind transport). */
  readonly cellKm: number;
  /** Row-major altitudes (index = y * width + x), metres. */
  readonly altitudeM: Int16Array;
  readonly latitudeTopDeg: number;
  readonly latitudeBottomDeg: number;
  readonly axialTiltDeg: number;
  readonly seaLevelM: number;
  readonly globalTemperatureOffsetC: number;
  /** What lies beyond each edge (default: the edge's terrain continues). */
  readonly beyondEdges?: BeyondEdges;
  /** Lakes placed on the map (seed cell + level): used by the hydrology run only. */
  readonly lakes?: readonly LakeSeed[];
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
  /** The coarse grid the winds live on (fine cells per coarse cell side = factor). */
  readonly windGrid: { readonly width: number; readonly height: number; readonly factor: number };
  /**
   * Surface wind (prevailing + monsoon) per COARSE cell, MONTHS row-major
   * fields of windGrid size. Eastward / northward components, m/s.
   */
  readonly windUMs: Float32Array;
  readonly windVMs: Float32Array;
  /** Precipitation, mm/month, per COARSE cell (windGrid), MONTHS fields. */
  readonly precipitationMm: Float32Array;
  /**
   * Soil wetness, % = rain / (rain + potential evaporation), averaged over this
   * month and the previous one. Per fine cell, MONTHS fields. Drives vegetation colour.
   */
  readonly wetnessPct: Uint8Array;
  /**
   * Annual runoff, mm/year, per fine cell (0 on the sea): the sum over the
   * months of max(0, precipitation − potential evaporation). Crude water
   * balance (no soil storage, snow melts the month it falls in the total), but
   * it puts the rivers where the rain is: what feeds the hydrology.
   */
  readonly runoffMm: Float32Array;
  /** Snow depth on the ground, cm (255 = 2.55 m or more), per fine cell, MONTHS fields. */
  readonly snowDepthCm: Uint8Array;
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
export function temperatureAtC(
  result: Pick<ClimateResult, 'widthCells' | 'heightCells' | 'temperatureDeciC'>,
  cellIndex: number, yearPhase: number): number {
  const size = result.widthCells * result.heightCells;
  const { m0, m1, f } = monthBlend(yearPhase);
  const t0 = result.temperatureDeciC[m0 * size + cellIndex];
  const t1 = result.temperatureDeciC[m1 * size + cellIndex];
  return (t0 + (t1 - t0) * f) / TEMPERATURE_SCALE;
}

/** Bilinear sample of a coarse (windGrid) monthly field under fine cell (xCell, yCell), interpolated between months. */
export function sampleCoarseMonthly(
  result: Pick<ClimateResult, 'windGrid'>,
  field: Float32Array,
  xCell: number,
  yCell: number,
  yearPhase: number,
): number {
  const { width: w, height: h, factor } = result.windGrid;
  const gx = Math.min(w - 1, Math.max(0, xCell / factor - 0.5));
  const gy = Math.min(h - 1, Math.max(0, yCell / factor - 0.5));
  const x0 = Math.floor(gx);
  const y0 = Math.floor(gy);
  const x1 = Math.min(w - 1, x0 + 1);
  const y1 = Math.min(h - 1, y0 + 1);
  const fx = gx - x0;
  const fy = gy - y0;
  const { m0, m1, f } = monthBlend(yearPhase);
  const at = (m: number) => {
    const o = m * w * h;
    const top = field[o + y0 * w + x0] * (1 - fx) + field[o + y0 * w + x1] * fx;
    const bottom = field[o + y1 * w + x0] * (1 - fx) + field[o + y1 * w + x1] * fx;
    return top * (1 - fy) + bottom * fy;
  };
  const v0 = at(m0);
  return v0 + (at(m1) - v0) * f;
}

/** Precipitation under a fine cell at a continuous year phase, mm/month. */
export function precipitationAtMm(result: ClimateResult, xCell: number, yCell: number, yearPhase: number): number {
  return sampleCoarseMonthly(result, result.precipitationMm, xCell, yCell, yearPhase);
}

/** Snow depth under a cell at a continuous year phase, cm. */
export function snowDepthAtCm(result: ClimateResult, cellIndex: number, yearPhase: number): number {
  const size = result.widthCells * result.heightCells;
  const { m0, m1, f } = monthBlend(yearPhase);
  const d0 = result.snowDepthCm[m0 * size + cellIndex];
  return d0 + (result.snowDepthCm[m1 * size + cellIndex] - d0) * f;
}
