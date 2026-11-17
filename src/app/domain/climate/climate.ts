import { EDGES_CONTINUE } from '../map/map-settings';
import { advect, AdvectionStep, climbAlongWind, downsampleMax, downsampleMean, excessOverLimit, upsampleInto } from './advection';
import { climateDomainFor, cropToMap, padField } from './climate-domain';
import { ClimateInput, ClimateResult, MONTHS, monthMidPhase, rowLatitudeDeg, TEMPERATURE_SCALE } from './climate-model';
import { saturationHumidityGPerKg } from './humidity';
import { blur, monsoonWinds } from './monsoon';
import { COLD_AIR_DEPTH_M, deflectWind, stabilityFromAnomaly, terrainSlope, WARM_AIR_DEPTH_M } from './terrain-flow';
import { LAPSE_RATE_C_PER_M, rowSeaLevelTemperaturesC } from './temperature';
import { prevailingWind } from './wind';
import { degreeDayFactor, SNOW_DEPTH_PER_SWE, snowStepDeci } from './snow';
import { dailyInsolationWm2, solarDeclinationDeg } from './insolation';

/**
 * Relaxation times: how long air "remembers" where it came from.
 * Over the sea the air is forced by the water below; over land it travels
 * far before forgetting the ocean.
 */
const TAU_LAND_S = 86_400; // 1 day
const TAU_SEA_S = 129_600; // 1.5 day: cold air masses are deep, the sea warms them slowly
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
 * 0. on a coarse domain = map + margin filled per edge ('beyond the edges');
 * 1. local temperatures (latitude, season, altitude);
 * 2. winds = prevailing belts + monsoon (land–sea contrast), deflected by mountains;
 * 3. advection of heat (cold air blocked by high ranges), then of water vapour, capped by what the air can hold
 *    at the height of the terrain it flows over;
 * 4. precipitation = what the air must drop when lifted (orographic) + a
 *    background rain-out of humid air (fronts, convection);
 * 5. soil wetness = rain vs. potential evaporation, for vegetation colours;
 * 6. snowpack = snowfall minus melt, month after month.
 */
export function computeClimate(input: ClimateInput): ClimateResult {
  const { widthCells: w, heightCells: h, altitudeM, seaLevelM, axialTiltDeg } = input;
  const size = w * h;

  // --- Coarse domain = map + margin (what lies beyond the edges) ---
  const domain = climateDomainFor(w, h, input.cellKm);
  const grid = domain.map;
  const dw = domain.width;
  const dh = domain.height;
  const cells = dw * dh;
  const mapCells = grid.width * grid.height;
  const seaFine = new Uint8Array(size);
  const landHeight = new Float32Array(size);
  for (let i = 0; i < size; i++) {
    seaFine[i] = altitudeM[i] <= seaLevelM ? 1 : 0;
    landHeight[i] = Math.max(0, altitudeM[i] - seaLevelM);
  }
  const edges = input.beyondEdges ?? EDGES_CONTINUE;
  const meanHeight = downsampleMean(landHeight, w, h, grid);
  const maxHeight = downsampleMax(landHeight, w, h, grid);
  const seaFraction = padField(downsampleMean(seaFine, w, h, grid), domain, 'seaFraction', edges);
  const ridgeM = padField(
    meanHeight.map((mean, c) => mean + RIDGE_WEIGHT * (maxHeight[c] - mean)),
    domain,
    'heightM',
    edges,
  );
  // Terrain as the large-scale flow sees it: lightly smoothed, then its slope.
  const terrainM = blur(ridgeM, dw, dh, 1);
  const slope = terrainSlope(terrainM, dw, dh, domain.cellKm);
  // Latitude of each domain row: keeps running past the map's top and bottom edges.
  const rowLat = Array.from({ length: dh }, (_, dy) => {
    const fineRow = (dy - domain.margin + 0.5) * grid.factor - 0.5;
    return Math.max(-90, Math.min(90, rowLatitudeDeg(input, fineRow)));
  });
  const rowTemps = rowLat.map((lat) => rowSeaLevelTemperaturesC(lat, input));
  const rowLandMean = rowTemps.map(({ land }) => land.reduce((a, b) => a + b, 0) / MONTHS);
  const landShare = blur(seaFraction.map((sf) => 1 - sf), dw, dh, CONTINENTAL_RADIUS_KM / domain.cellKm / 2);
  const continental = landShare.map((share) => CONTINENTAL_GAIN * smoothstep(0.3, 0.9, share));
  /** Extra (continental) part of the equilibrium temperature, removed before going back to the fine grid. */
  const continentalC = new Float32Array(cells);

  // Map-sized outputs of the coarse stage.
  const windUMs = new Float32Array(MONTHS * mapCells);
  const windVMs = new Float32Array(MONTHS * mapCells);
  const precipitationMm = new Float32Array(MONTHS * mapCells);
  const deltaT = new Float32Array(MONTHS * mapCells);

  const anomaly = new Float32Array(cells);
  const eqT = new Float32Array(cells);
  const temp = new Float32Array(cells);
  const eqQ = new Float32Array(cells);
  const cloudLimit = new Float32Array(cells);
  const moisture = new Float32Array(cells);
  const speeds = new Float32Array(cells);
  const work = new Float32Array(cells);
  const u = new Float32Array(cells);
  const v = new Float32Array(cells);
  const step: AdvectionStep = { dx: new Float32Array(cells), dy: new Float32Array(cells), memory: new Float32Array(cells) };
  const crop = (field: Float32Array, m: number, out: Float32Array) =>
    cropToMap(field, domain, out.subarray(m * mapCells, (m + 1) * mapCells));

  for (let m = 0; m < MONTHS; m++) {
    // Equilibrium (windless) temperature, and how far it departs from the sea at that latitude.
    for (let cy = 0; cy < dh; cy++) {
      const { land, sea } = rowTemps[cy];
      const landSwing = land[m] - rowLandMean[cy];
      for (let cx = 0; cx < dw; cx++) {
        const c = cy * dw + cx;
        const sf = seaFraction[c];
        continentalC[c] = (1 - sf) * continental[c] * landSwing;
        eqT[c] = sf * sea[m] + (1 - sf) * land[m] + continentalC[c];
        anomaly[c] = eqT[c] - sea[m];
      }
    }

    // Surface wind = prevailing belts (latitude) + monsoon (land–sea contrast).
    const monsoon = monsoonWinds(anomaly, dw, dh, domain.cellKm, (cy) => rowLat[cy]);
    // Air-mass scale (~100 km): is the air here a shallow cold dome?
    const blurredAnomaly = blur(anomaly, dw, dh, 100 / domain.cellKm / 2);
    for (let cy = 0; cy < dh; cy++) {
      const belt = prevailingWind(rowLat[cy], monthMidPhase(m), axialTiltDeg);
      for (let cx = 0; cx < dw; cx++) {
        const c = cy * dw + cx;
        // Mountains deflect what would blow straight up their slopes.
        const stability = stabilityFromAnomaly(blurredAnomaly[c]);
        const wind = deflectWind(belt.uMs + monsoon.u[c], belt.vMs + monsoon.v[c], slope.east[c], slope.north[c], stability);
        u[c] = wind.u;
        v[c] = wind.v;
        const speed = Math.sqrt(wind.u * wind.u + wind.v * wind.v);
        speeds[c] = speed;
        if (speed < CALM_MS) {
          step.memory[c] = 0;
          continue;
        }
        const sf = seaFraction[c];
        const relaxKm = (speed * (sf * TAU_SEA_S + (1 - sf) * TAU_LAND_S)) / 1000;
        step.memory[c] = Math.exp(-domain.cellKm / relaxKm);
        step.dx[c] = wind.u / speed; // one cell back along the wind (grid y points south)
        step.dy[c] = -wind.v / speed;
      }
    }
    crop(u, m, windUMs);
    crop(v, m, windVMs);

    // Heat, with blocking: shallow cold air cannot cross high ranges.
    const climbM = climbAlongWind(terrainM, step, dw, dh);
    const blocking = { climbM, coldDepthM: COLD_AIR_DEPTH_M, warmDepthM: WARM_AIR_DEPTH_M };
    temp.set(eqT);
    advect(temp, eqT, step, dw, dh, SWEEPS, undefined, blocking);

    // Water vapour, capped by what the air can hold over the terrain's height.
    // The sea evaporates according to ITS OWN temperature: cold air over a
    // warmer sea receives more vapour than it can hold → clouds and snow
    // showers downwind ("lake-effect", the snows of Niigata and Hokkaido).
    for (let cy = 0; cy < dh; cy++) {
      const seaSurfaceQ = SEA_RH * saturationHumidityGPerKg(rowTemps[cy].sea[m]);
      for (let cx = 0; cx < dw; cx++) {
        const c = cy * dw + cx;
        const sf = seaFraction[c];
        eqQ[c] = sf * seaSurfaceQ + (1 - sf) * LAND_RH * saturationHumidityGPerKg(temp[c]);
        cloudLimit[c] = CLOUD_RH * saturationHumidityGPerKg(temp[c] - ridgeM[c] * LAPSE_RATE_C_PER_M);
      }
    }
    moisture.set(eqQ);
    advect(moisture, eqQ, step, dw, dh, SWEEPS, cloudLimit);
    const condensed = excessOverLimit(moisture, eqQ, step, cloudLimit, dw, dh);

    // Föhn: the heat released by condensation on the windward slopes is
    // carried over the ridge, so the lee gets warmer, drier air. Only
    // condensation forced by terrain counts: over the sea, convective
    // showers release their heat aloft, not in the surface air we model.
    const latentC = condensed.map((g, c) => g * (1 - seaFraction[c]) * LATENT_WARMING_C_PER_G_PER_KG * LATENT_SHARE_AT_SURFACE);
    temp.set(eqT);
    advect(temp, eqT, step, dw, dh, SWEEPS, undefined, blocking, latentC);
    // Departure from the plain local temperature (the fine grid adds it to its own).
    for (let c = 0; c < cells; c++) work[c] = temp[c] - (eqT[c] - continentalC[c]);
    crop(work, m, deltaT);

    // Precipitation, kg/m²/s → mm/month (1 kg of water per m² = 1 mm).
    const cellM = domain.cellKm * 1000;
    const column = AIR_DENSITY_KG_M3 * MOIST_LAYER_M;
    for (let c = 0; c < cells; c++) {
      // Vapour flux crossing the cell × share lost in it.
      const orographic = (OROGRAPHIC_EFFICIENCY * column * speeds[c] * (condensed[c] / 1000)) / cellM;
      const rh = moisture[c] / (cloudLimit[c] / CLOUD_RH);
      const background = (column * (moisture[c] / 1000) * smoothstep(0.45, 0.9, rh)) / RAIN_OUT_TIME_S;
      work[c] = (orographic + background) * SECONDS_PER_MONTH;
    }
    crop(work, m, precipitationMm);
  }

  // --- Fine grid, ONE pass per month: temperature, soil wetness, snowpack ---
  // Months run from August (snow-free except glaciers) through July.
  const temperatureDeciC = new Int16Array(MONTHS * size);
  const wetnessPct = new Uint8Array(MONTHS * size);
  const snowDepthCm = new Uint8Array(MONTHS * size);
  const swe = new Float32Array(size);
  const fineDelta = new Float32Array(size);
  let fineRain = new Float32Array(size);
  let previousRain = new Float32Array(size);
  const fineRowTemps = Array.from({ length: h }, (_, y) => rowSeaLevelTemperaturesC(rowLatitudeDeg(input, y), input));
  const monthPrecip = (m: number) => precipitationMm.subarray(m * mapCells, (m + 1) * mapCells);
  upsampleInto(monthPrecip((AUGUST + MONTHS - 1) % MONTHS), grid, w, h, previousRain);
  for (let k = 0; k < MONTHS; k++) {
    const m = (AUGUST + k) % MONTHS;
    upsampleInto(deltaT.subarray(m * mapCells, (m + 1) * mapCells), grid, w, h, fineDelta);
    upsampleInto(monthPrecip(m), grid, w, h, fineRain);
    const offset = m * size;
    for (let y = 0; y < h; y++) {
      const landT = fineRowTemps[y].land[m];
      // Melt follows the sunshine of the month at this latitude.
      const degreeDayMm = degreeDayFactor(dailyInsolationWm2(rowLatitudeDeg(input, y), solarDeclinationDeg(monthMidPhase(m), axialTiltDeg)));
      const seaT = fineRowTemps[y].sea[m];
      for (let x = 0; x < w; x++) {
        const i = y * w + x;
        const height = altitudeM[i] - seaLevelM;
        const localC = height > 0 ? landT - height * LAPSE_RATE_C_PER_M : seaT;
        const t = Math.round((localC + fineDelta[i]) * TEMPERATURE_SCALE);
        temperatureDeciC[offset + i] = t;
        if (height <= 0) continue; // sea: no soil, no snowpack
        // Soil remembers: this month's rain averaged with the previous month's.
        const rain = (fineRain[i] + previousRain[i]) / 2;
        const pet = potentialEvaporationMm(t / TEMPERATURE_SCALE);
        wetnessPct[offset + i] = Math.round((100 * rain) / (rain + pet));
        // Snowpack: skip the (many) cells that are warm and snow-free.
        const before = swe[i];
        if (before === 0 && t > WARM_NO_SNOW_DECI) continue;
        const after = snowStepDeci(before, t, fineRain[i], degreeDayMm);
        swe[i] = after;
        snowDepthCm[offset + i] = Math.min(255, Math.round((((before + after) / 2) * SNOW_DEPTH_PER_SWE) / 10));
      }
    }
    [previousRain, fineRain] = [fineRain, previousRain];
  }
  // Glaciers: snow left at the end of July was already there in August. One
  // year was simulated from zero, so add that carry-over to every month.
  for (let i = 0; i < size; i++) {
    if (swe[i] <= 0) continue;
    const carryCm = Math.round((swe[i] * SNOW_DEPTH_PER_SWE) / 10);
    for (let m = 0; m < MONTHS; m++) snowDepthCm[m * size + i] = Math.min(255, snowDepthCm[m * size + i] + carryCm);
  }

  return {
    widthCells: w,
    heightCells: h,
    temperatureDeciC,
    snowDepthCm,
    windGrid: { width: grid.width, height: grid.height, factor: grid.factor },
    windUMs,
    windVMs,
    precipitationMm,
    wetnessPct,
  };
}

const AUGUST = 7;
/**
 * Continentality: far from the sea nothing buffers the seasons (the ground
 * radiates its heat away in winter, snow reflects the sun, cold dense air
 * pools: the Siberian high). The land's seasonal swing grows with the share
 * of land within ~CONTINENTAL_RADIUS_KM, up to ×(1 + CONTINENTAL_GAIN) for a
 * fully continental area (Harbin, 45° N: −17 °C in January).
 */
const CONTINENTAL_RADIUS_KM = 800;
const CONTINENTAL_GAIN = 0.3;
/** Above this monthly mean (tenths of °C) no meaningful snow falls (< 1 % of days below +1 °C). */
const WARM_NO_SNOW_DECI = 100;

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
