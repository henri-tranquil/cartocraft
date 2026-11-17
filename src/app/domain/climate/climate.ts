import { advect, AdvectionStep, coarseGridFor, downsampleMean, upsampleAt } from './advection';
import { ClimateInput, ClimateResult, MONTHS, rowLatitudeDeg, TEMPERATURE_SCALE } from './climate-model';
import { saturationHumidityGPerKg } from './humidity';
import { computeMonthlyTemperatures, rowSeaLevelTemperaturesC } from './temperature';
import { computeMonthlyWinds } from './wind';

/**
 * Relaxation times: how long air "remembers" where it came from.
 * Over the sea the air is quickly forced by the water below; over land it
 * travels far before forgetting the ocean.
 */
const TAU_LAND_S = 86_400; // 1 day
const TAU_SEA_S = 43_200; // ½ day
/** Below this the air is considered calm: no transport. */
const CALM_MS = 0.5;
/** Equilibrium relative humidity the surface pushes the air toward. */
const SEA_RH = 0.85;
const LAND_RH = 0.35;
const SWEEPS = 8;

/**
 * Full climate: local temperatures (latitude, season, altitude), prevailing
 * winds, then advection of heat and moisture by those winds.
 */
export function computeClimate(input: ClimateInput): ClimateResult {
  const { widthCells: w, heightCells: h, altitudeM, seaLevelM, axialTiltDeg } = input;
  const size = w * h;
  const local = computeMonthlyTemperatures(input);
  const winds = computeMonthlyWinds(h, (y) => rowLatitudeDeg(input, y), axialTiltDeg);

  // --- Coarse grid: sea fraction and per-row sea-level temperatures ---
  const grid = coarseGridFor(w, h, input.cellKm);
  const cw = grid.width;
  const ch = grid.height;
  const seaFine = new Uint8Array(size);
  for (let i = 0; i < size; i++) seaFine[i] = altitudeM[i] <= seaLevelM ? 1 : 0;
  const seaFraction = downsampleMean(seaFine, w, h, grid);
  const fineRowOf = (cy: number) => Math.min(h - 1, Math.floor((cy + 0.5) * grid.factor));
  const rowTemps = Array.from({ length: ch }, (_, cy) => rowSeaLevelTemperaturesC(rowLatitudeDeg(input, fineRowOf(cy)), input));

  const temperatureDeciC = local.temperatureDeciC;
  const humidityPct = new Uint8Array(MONTHS * size);
  const qsLut = buildSaturationLut();

  const eqT = new Float32Array(cw * ch);
  const temp = new Float32Array(cw * ch);
  const delta = new Float32Array(cw * ch);
  const eqQ = new Float32Array(cw * ch);
  const saturation = new Float32Array(cw * ch);
  const moisture = new Float32Array(cw * ch);
  const step: AdvectionStep = { dx: new Float32Array(cw * ch), dy: new Float32Array(cw * ch), memory: new Float32Array(cw * ch) };

  for (let m = 0; m < MONTHS; m++) {
    for (let cy = 0; cy < ch; cy++) {
      const u = winds.windUMs[m * h + fineRowOf(cy)];
      const v = winds.windVMs[m * h + fineRowOf(cy)];
      const speed = Math.hypot(u, v);
      const { land, sea } = rowTemps[cy];
      for (let cx = 0; cx < cw; cx++) {
        const c = cy * cw + cx;
        const sf = seaFraction[c];
        eqT[c] = sf * sea[m] + (1 - sf) * land[m];
        if (speed < CALM_MS) {
          step.memory[c] = 0;
          continue;
        }
        const relaxKm = (speed * (sf * TAU_SEA_S + (1 - sf) * TAU_LAND_S)) / 1000;
        step.memory[c] = Math.exp(-grid.cellKm / relaxKm);
        step.dx[c] = u / speed; // one cell back along the wind (grid y points south)
        step.dy[c] = -v / speed;
      }
    }

    temp.set(eqT);
    advect(temp, eqT, step, cw, ch, SWEEPS);
    for (let c = 0; c < delta.length; c++) {
      delta[c] = temp[c] - eqT[c];
      const qs = saturationHumidityGPerKg(temp[c]);
      saturation[c] = qs;
      const sf = seaFraction[c];
      eqQ[c] = (sf * SEA_RH + (1 - sf) * LAND_RH) * qs;
    }
    moisture.set(eqQ);
    // Capped at saturation: air pushed over colder ground loses its excess water.
    advect(moisture, eqQ, step, cw, ch, SWEEPS, saturation);

    // --- Back to the fine grid: add the advection correction, derive relative humidity ---
    const offset = m * size;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = y * w + x;
        const t = temperatureDeciC[offset + i] + Math.round(upsampleAt(delta, grid, x, y) * TEMPERATURE_SCALE);
        temperatureDeciC[offset + i] = t;
        const q = upsampleAt(moisture, grid, x, y);
        const rh = q / qsLut[Math.min(LUT_MAX, Math.max(0, t - LUT_MIN_DECI))];
        humidityPct[offset + i] = Math.round(Math.min(1, rh) * 100);
      }
    }
  }

  return { widthCells: w, heightCells: h, temperatureDeciC, ...winds, humidityPct };
}

const LUT_MIN_DECI = -700;
const LUT_MAX = 1400;

/** Saturation humidity per tenth of °C from −70 to +70 °C (avoids an exp per cell). */
function buildSaturationLut(): Float32Array {
  const lut = new Float32Array(LUT_MAX + 1);
  for (let i = 0; i <= LUT_MAX; i++) lut[i] = saturationHumidityGPerKg((i + LUT_MIN_DECI) / TEMPERATURE_SCALE);
  return lut;
}
