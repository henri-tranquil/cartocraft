import { advect, AdvectionStep, climbAlongWind, coarseGridFor, downsampleMax, downsampleMean, excessOverLimit, upsampleInto } from './advection';
import { ClimateInput, ClimateResult, MONTHS, monthMidPhase, rowLatitudeDeg, TEMPERATURE_SCALE } from './climate-model';
import { saturationHumidityGPerKg } from './humidity';
import { blur, monsoonWinds } from './monsoon';
import { COLD_AIR_DEPTH_M, deflectWind, stabilityFromAnomaly, terrainSlope, WARM_AIR_DEPTH_M } from './terrain-flow';
import { computeMonthlyTemperatures, LAPSE_RATE_C_PER_M, rowSeaLevelTemperaturesC } from './temperature';
import { prevailingWind } from './wind';

/**
 * Relaxation times: how long air "remembers" where it came from.
 * Over the sea the air is forced by the water below; over land it travels
 * far before forgetting the ocean.
 */
const TAU_LAND_S = 86_400; // 1 day
const TAU_SEA_S = 86_400; // 1 day (a cold air mass is deep: the sea warms it slowly)
/** Below this the air is considered calm: no transport. */
const CALM_MS = 0.5;
/** Equilibrium relative humidity the surface pushes the air toward. */
const SEA_RH = 0.85;
const LAND_RH = 0.6;
/** Clouds form (and rain starts) when vapour exceeds this share of saturation. */
const CLOUD_RH = 0.9;
const SWEEPS = 8;

// --- Precipitation ---
const AIR_DENSITY_KG_M3 = 1.2;
/** Thickness of the moist layer carrying the vapour (water vapour scale height). */
const MOIST_LAYER_M = 2000;
/** Share of the condensed water that actually reaches the ground on the spot. */
const OROGRAPHIC_EFFICIENCY = 0.2;
/** Background (frontal / convective) rain empties humid air in about this long. */
const RAIN_OUT_TIME_S = 3 * 86_400;
const SECONDS_PER_MONTH = (365.25 / 12) * 86_400;
/** Mountain height seen by the air in a coarse cell: mean + this share of (max − mean). */
const RIDGE_WEIGHT = 0.5;
/**
 * Latent heat: condensing 1 g of vapour per kg of air releases
 * L·0.001/cp = 2.5e6 × 0.001 / 1005 ≈ 2.5 °C of warming. Only part of it stays
 * in the low-level air we model (the rest warms the air aloft).
 */
const LATENT_WARMING_C_PER_G_PER_KG = 2.5;
const LATENT_SHARE_AT_SURFACE = 0.3;

/**
 * Full climate:
 * 1. local temperatures (latitude, season, altitude);
 * 2. winds = prevailing belts + monsoon (land–sea contrast), deflected by mountains;
 * 3. advection of heat (cold air blocked by high ranges), then of water vapour, capped by what the air can hold
 *    at the height of the terrain it flows over;
 * 4. precipitation = what the air must drop when lifted (orographic) + a
 *    background rain-out of humid air (fronts, convection);
 * 5. soil wetness = rain vs. potential evaporation, for vegetation colours.
 */
export function computeClimate(input: ClimateInput): ClimateResult {
  const { widthCells: w, heightCells: h, altitudeM, seaLevelM, axialTiltDeg } = input;
  const size = w * h;
  const local = computeMonthlyTemperatures(input);

  // --- Coarse grid ---
  const grid = coarseGridFor(w, h, input.cellKm);
  const cw = grid.width;
  const ch = grid.height;
  const cells = cw * ch;
  const seaFine = new Uint8Array(size);
  const landHeight = new Float32Array(size);
  for (let i = 0; i < size; i++) {
    seaFine[i] = altitudeM[i] <= seaLevelM ? 1 : 0;
    landHeight[i] = Math.max(0, altitudeM[i] - seaLevelM);
  }
  const seaFraction = downsampleMean(seaFine, w, h, grid);
  const meanHeight = downsampleMean(landHeight, w, h, grid);
  const maxHeight = downsampleMax(landHeight, w, h, grid);
  const ridgeM = meanHeight.map((mean, c) => mean + RIDGE_WEIGHT * (maxHeight[c] - mean));
  // Terrain as the large-scale flow sees it: lightly smoothed, then its slope.
  const terrainM = blur(ridgeM, cw, ch, 1);
  const slope = terrainSlope(terrainM, cw, ch, grid.cellKm);
  const fineRowOf = (cy: number) => Math.min(h - 1, Math.floor((cy + 0.5) * grid.factor));
  const rowLat = Array.from({ length: ch }, (_, cy) => rowLatitudeDeg(input, fineRowOf(cy)));
  const rowTemps = rowLat.map((lat) => rowSeaLevelTemperaturesC(lat, input));

  const windUMs = new Float32Array(MONTHS * cells);
  const windVMs = new Float32Array(MONTHS * cells);
  const precipitationMm = new Float32Array(MONTHS * cells);
  const deltaT = new Float32Array(MONTHS * cells);

  const anomaly = new Float32Array(cells);
  const eqT = new Float32Array(cells);
  const temp = new Float32Array(cells);
  const eqQ = new Float32Array(cells);
  const cloudLimit = new Float32Array(cells);
  const moisture = new Float32Array(cells);
  const speeds = new Float32Array(cells);
  const step: AdvectionStep = { dx: new Float32Array(cells), dy: new Float32Array(cells), memory: new Float32Array(cells) };

  for (let m = 0; m < MONTHS; m++) {
    // Equilibrium (windless) temperature, and how far it departs from the sea at that latitude.
    for (let cy = 0; cy < ch; cy++) {
      const { land, sea } = rowTemps[cy];
      for (let cx = 0; cx < cw; cx++) {
        const c = cy * cw + cx;
        const sf = seaFraction[c];
        eqT[c] = sf * sea[m] + (1 - sf) * land[m];
        anomaly[c] = eqT[c] - sea[m];
      }
    }

    // Surface wind = prevailing belts (latitude) + monsoon (land–sea contrast).
    const monsoon = monsoonWinds(anomaly, cw, ch, grid.cellKm, (cy) => rowLat[cy]);
    // Air-mass scale (~100 km): is the air here a shallow cold dome?
    const blurredAnomaly = blur(anomaly, cw, ch, 100 / grid.cellKm / 2);
    const offset = m * cells;
    for (let cy = 0; cy < ch; cy++) {
      const belt = prevailingWind(rowLat[cy], monthMidPhase(m), axialTiltDeg);
      for (let cx = 0; cx < cw; cx++) {
        const c = cy * cw + cx;
        // Mountains deflect what would blow straight up their slopes.
        const stability = stabilityFromAnomaly(blurredAnomaly[c]);
        const { u, v } = deflectWind(belt.uMs + monsoon.u[c], belt.vMs + monsoon.v[c], slope.east[c], slope.north[c], stability);
        windUMs[offset + c] = u;
        windVMs[offset + c] = v;
        const speed = Math.hypot(u, v);
        speeds[c] = speed;
        if (speed < CALM_MS) {
          step.memory[c] = 0;
          continue;
        }
        const sf = seaFraction[c];
        const relaxKm = (speed * (sf * TAU_SEA_S + (1 - sf) * TAU_LAND_S)) / 1000;
        step.memory[c] = Math.exp(-grid.cellKm / relaxKm);
        step.dx[c] = u / speed; // one cell back along the wind (grid y points south)
        step.dy[c] = -v / speed;
      }
    }

    // Heat.
    // Heat, with blocking: shallow cold air cannot cross high ranges.
    const climbM = climbAlongWind(terrainM, step, cw, ch);
    temp.set(eqT);
    advect(temp, eqT, step, cw, ch, SWEEPS, undefined, { climbM, coldDepthM: COLD_AIR_DEPTH_M, warmDepthM: WARM_AIR_DEPTH_M });

    // Water vapour, capped by what the air can hold over the terrain's height.
    // The sea evaporates according to ITS OWN temperature: cold air over a
    // warmer sea receives more vapour than it can hold → clouds and snow
    // showers downwind ("lake-effect", the snows of Niigata and Hokkaido).
    for (let cy = 0; cy < ch; cy++) {
      const seaSurfaceQ = SEA_RH * saturationHumidityGPerKg(rowTemps[cy].sea[m]);
      for (let cx = 0; cx < cw; cx++) {
        const c = cy * cw + cx;
        const sf = seaFraction[c];
        eqQ[c] = sf * seaSurfaceQ + (1 - sf) * LAND_RH * saturationHumidityGPerKg(temp[c]);
      }
    }
    for (let c = 0; c < cells; c++) {
      deltaT[offset + c] = temp[c] - eqT[c];
      cloudLimit[c] = CLOUD_RH * saturationHumidityGPerKg(temp[c] - ridgeM[c] * LAPSE_RATE_C_PER_M);
    }
    moisture.set(eqQ);
    advect(moisture, eqQ, step, cw, ch, SWEEPS, cloudLimit);
    const condensed = excessOverLimit(moisture, eqQ, step, cloudLimit, cw, ch);

    // Föhn: the heat released by condensation on the windward slopes is
    // carried over the ridge, so the lee gets warmer, drier air.
    const latentC = condensed.map((g) => g * LATENT_WARMING_C_PER_G_PER_KG * LATENT_SHARE_AT_SURFACE);
    temp.set(eqT);
    advect(temp, eqT, step, cw, ch, SWEEPS, undefined, { climbM, coldDepthM: COLD_AIR_DEPTH_M, warmDepthM: WARM_AIR_DEPTH_M }, latentC);
    for (let c = 0; c < cells; c++) deltaT[offset + c] = temp[c] - eqT[c];

    // Precipitation, kg/m²/s → mm/month (1 kg of water per m² = 1 mm).
    const cellM = grid.cellKm * 1000;
    for (let c = 0; c < cells; c++) {
      const column = AIR_DENSITY_KG_M3 * MOIST_LAYER_M;
      // Vapour flux crossing the cell × share lost in it.
      const orographic = (OROGRAPHIC_EFFICIENCY * column * speeds[c] * (condensed[c] / 1000)) / cellM;
      const rh = moisture[c] / (cloudLimit[c] / CLOUD_RH);
      const background = (column * (moisture[c] / 1000) * smoothstep(0.45, 0.9, rh)) / RAIN_OUT_TIME_S;
      precipitationMm[offset + c] = (orographic + background) * SECONDS_PER_MONTH;
    }
  }

  // --- Back to the fine grid ---
  const temperatureDeciC = local.temperatureDeciC;
  const wetnessPct = new Uint8Array(MONTHS * size);
  const rainField = new Float32Array(cells);
  const fineDelta = new Float32Array(size);
  const fineRain = new Float32Array(size);
  for (let m = 0; m < MONTHS; m++) {
    upsampleInto(deltaT.subarray(m * cells, (m + 1) * cells), grid, w, h, fineDelta);
    // Soil remembers: average this month's rain with the previous month's.
    const previous = ((m + MONTHS - 1) % MONTHS) * cells;
    for (let c = 0; c < cells; c++) rainField[c] = (precipitationMm[m * cells + c] + precipitationMm[previous + c]) / 2;
    upsampleInto(rainField, grid, w, h, fineRain);
    const offset = m * size;
    for (let i = 0; i < size; i++) {
      const t = temperatureDeciC[offset + i] + Math.round(fineDelta[i] * TEMPERATURE_SCALE);
      temperatureDeciC[offset + i] = t;
      const rain = fineRain[i];
      const pet = t > 0 ? 10 + (4.6 * t) / TEMPERATURE_SCALE : 10; // potentialEvaporationMm, inlined
      wetnessPct[offset + i] = Math.round((100 * rain) / (rain + pet));
    }
  }

  return {
    widthCells: w,
    heightCells: h,
    temperatureDeciC,
    windGrid: { width: cw, height: ch, factor: grid.factor },
    windUMs,
    windVMs,
    precipitationMm,
    wetnessPct,
  };
}

/**
 * Potential evapotranspiration, mm/month: how much water the warmth could
 * evaporate if the soil were always wet. A crude linear fit of the usual
 * formulas (≈ 10 mm at 0 °C, 55 at 10 °C, 125 at 25 °C). Wetness = rain /
 * (rain + PET): 50 % when rain just balances evaporation.
 */
export function potentialEvaporationMm(temperatureC: number): number {
  return 10 + 4.6 * Math.max(0, temperatureC);
}

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}
