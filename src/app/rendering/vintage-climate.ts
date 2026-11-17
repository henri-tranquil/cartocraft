import { ClimateResult, MONTHS, TEMPERATURE_SCALE } from '../domain/climate/climate-model';

/** What the rendered view needs from the climate: yearly summaries, one value per cell. */
export interface VintageClimate {
  /** Mean of the 12 monthly wetness values (%). */
  readonly wetnessPct: Uint8Array<ArrayBuffer>;
  /** Annual mean temperature, tenths of °C. */
  readonly meanDeciC: Int16Array<ArrayBuffer>;
  /** Temperature of the warmest month, tenths of °C: trees need a warm enough summer. */
  readonly warmestDeciC: Int16Array<ArrayBuffer>;
}

/**
 * Collapses the 12 monthly fields into yearly summaries (the rendered view
 * shows the year, not a season). Fresh arrays: safe to transfer to a worker.
 */
export function summariseClimate(result: ClimateResult): VintageClimate {
  const n = result.widthCells * result.heightCells;
  const wetSum = new Uint16Array(n);
  const tSum = new Int32Array(n);
  const warmestDeciC = new Int16Array(n).fill(-32768);
  for (let m = 0; m < MONTHS; m++) {
    const off = m * n;
    for (let i = 0; i < n; i++) {
      const t = result.temperatureDeciC[off + i];
      wetSum[i] += result.wetnessPct[off + i];
      tSum[i] += t;
      if (t > warmestDeciC[i]) warmestDeciC[i] = t;
    }
  }
  const wetnessPct = new Uint8Array(n);
  const meanDeciC = new Int16Array(n);
  for (let i = 0; i < n; i++) {
    wetnessPct[i] = Math.round(wetSum[i] / MONTHS);
    meanDeciC[i] = Math.round(tSum[i] / MONTHS);
  }
  return { wetnessPct, meanDeciC, warmestDeciC };
}

/** °C from tenths of °C. */
export const deciToC = (v: number): number => v / TEMPERATURE_SCALE;
