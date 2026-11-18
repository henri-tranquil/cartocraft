import { GroundClimate, reliefAltitudeM } from './drawing-climate';
import { LAPSE_RATE_C_PER_M } from '../climate/temperature';
import {
  AirStreamline,
  AIR_MEMORY_KM,
  CALM_MS,
  deflect,
  DrawingAirField,
  FOREST_MOISTENING_KM,
  moistureCapacity,
  prevailingAt,
  traceDrawingWinds,
  WATER_MOISTENING_KM,
} from './drawing-winds';

/**
 * WEATHER OF THE DRAWING (step V2): rain and air temperature brought by the
 * winds of drawing-winds.ts, as fields over the coarse grid.
 *
 * Each coarse cell receives the air of its UPSTREAM neighbour (where the wind
 * comes from, one cell back): this is "semi-Lagrangian" advection, as in the
 * climate model. Sweeping the grid in place, in the four diagonal orders,
 * carries the air across the whole map in a few passes.
 *
 * On its way the air:
 * - slowly takes the temperature of the place (memory ~1200 km);
 * - takes up water over the sea and lakes, and over forests (they breathe out
 *   part of the rain back), up to 80 % of what it can hold;
 * - RAINS in two ways:
 *   · background rain, a share of its water per km (only once the air is
 *     fairly moist), strong where the general
 *     circulation makes the air rise (equator, 45–60°: depressions), weak
 *     where it sinks (20–30°: the great deserts);
 *   · CONDENSATION: the air rising over a slope cools (6.5 °C per 1000 m) and
 *     can hold less water; the excess falls on the windward side. Coming down
 *     the other side, it warms and can hold more again, but it has lost its
 *     water: the RAIN SHADOW, dry, behind the range.
 *
 * Out: annual precipitation, and wetness = P / (P + PET) like the climate
 * model (PET = potential evapotranspiration, what the ground would give back
 * to the air if it had water: ≈ 10 + 4.6·T mm per month).
 */

/** Water held by saturated air at 30 °C (mm of rain in the air column). */
const SATURATED_30C_MM = 50;
/** The air takes up water to this share of its capacity over water and forests. */
const MOISTENED_SHARE = 0.8;
/** Distance over which the air rains out its water where it rises freely (efficiency 1). */
const RAIN_OUT_KM = 1300;
/** How far the air goes in a day (≈ 6 m/s): turns rain per km into rain per day. */
const AIR_KM_PER_DAY = 500;
/** [|latitude| °, rain efficiency]: rising air (equator, mid-latitude storms) or sinking air (subtropical deserts). */
const RAIN_EFFICIENCY: readonly (readonly [number, number])[] = [
  [0, 1],
  [10, 0.8],
  [20, 0.3],
  [27, 0.15],
  [35, 0.4],
  [45, 0.8],
  [60, 0.9],
  [75, 0.6],
  [90, 0.4],
];
/**
 * Passes over the grid. Bilinear upstream sampling keeps a little of a cell's
 * own previous value at each pass: the starting guess fades only gradually
 * (8 passes left whole continents half as moist as they should be).
 */
const TEMPERATURE_SWEEPS = 12;
const MOISTURE_SWEEPS = 24;
/** Land share within about this distance sets the continentality. */
const CONTINENTAL_RADIUS_KM = 250;
/** Bare land (grass, fields) gives back a little water too. */
const LAND_MOISTENING_KM = 3000;
/** The moist air is steered by the relief like warm air at this temperature (°C). */
const MOIST_AIR_C = 30;
/**
 * Share of the water condensed over a slope that falls there (the rest stays
 * as cloud and evaporates downwind). Same idea as the climate model's
 * orographic efficiency: without it, windward slopes got 20 m of rain a year.
 */
const OROGRAPHIC_EFFICIENCY = 0.25;

export interface DrawingWeather {
  readonly widthCells: number;
  readonly heightCells: number;
  readonly cellKm: number;
  /** Annual precipitation, mm. */
  readonly precipitationMm: Float32Array;
  /** P / (P + PET), %. */
  readonly wetnessPct: Float32Array;
  /** Air temperature minus the zonal one (°C): the warmth or cold brought by the wind. */
  readonly tempAnomalyC: Float32Array;
  /** Air temperature at sea level (°C): annual mean, and warmest month. */
  readonly meanTempC: Float32Array;
  readonly warmestTempC: Float32Array;
  /** Coldest month at sea level (°C). */
  readonly coldestTempC: Float32Array;
  /** 0 (open sea, coast) … 1 (deep inland): how far the seasons swing like a continent's. */
  readonly continentality: Float32Array;
  /** Per row × 12 months: departure from the annual mean deep inland and over the sea (°C), as in the air field. */
  readonly rowLandDevC: Float32Array;
  readonly rowSeaDevC: Float32Array;
}

/** Everything the Draw step shows of the winds: the weather (ground colour, snow) and the streamlines (overlay). */
export interface DrawingWeatherResult {
  readonly weather: DrawingWeather;
  readonly streamlines: readonly AirStreamline[];
}

/** Port: computes the winds' weather, off the main thread in the app (a Worker), inline in tests. */
export interface DrawingWeatherEngine {
  compute(field: DrawingAirField): Promise<DrawingWeatherResult>;
}

export function computeDrawingWeather(field: DrawingAirField): DrawingWeatherResult {
  return { weather: drawingWeather(field), streamlines: traceDrawingWinds(field) };
}

export function drawingWeather(field: DrawingAirField): DrawingWeather {
  const w = field.widthCells;
  const h = field.heightCells;
  const n = w * h;
  const km = field.cellKm;
  const localT = new Float32Array(n);
  const altitudeM = new Float32Array(n);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      localT[y * w + x] = field.rowTempC[y];
      altitudeM[y * w + x] = reliefAltitudeM(field.barrier[y * w + x]);
    }
  }

  // 1. Winds per cell (unit vectors, zero in calm belts), first bent by the relief as for air at the local temperature.
  const windX = new Float32Array(n);
  const windY = new Float32Array(n);
  const winds = (temp: Float32Array) => {
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = y * w + x;
        const cx = (x + 0.5) * km;
        const cy = (y + 0.5) * km;
        const base = prevailingAt(field, cx, cy);
        if (base.speed < CALM_MS) {
          windX[i] = windY[i] = 0;
          continue;
        }
        [windX[i], windY[i]] = deflect(field, cx, cy, base.dx, base.dy, temp[i]);
      }
    }
  };
  winds(localT);

  // 2. Air temperature, carried by the wind. Then the winds again: cold air carried south is bent like cold air.
  const temp = Float32Array.from(localT);
  const keep = Math.exp(-km / AIR_MEMORY_KM);
  const advectTemperature = () =>
    sweep(w, h, TEMPERATURE_SWEEPS, (x, y, i) => {
      const up = sampleGrid(temp, w, h, x + 0.5 - windX[i], y + 0.5 - windY[i]);
      temp[i] = localT[i] + (up - localT[i]) * keep;
    });
  advectTemperature();
  winds(temp);
  advectTemperature();

  // 3. Water and rain. The moist air is carried as WARM air, mostly over the relief: near the
  // ground cold air is dammed by a range, but the moist air above it is lifted over the
  // crest (this lift is what makes it rain on the windward side).
  const moistX = new Float32Array(n);
  const moistY = new Float32Array(n);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const cx = (x + 0.5) * km;
      const cy = (y + 0.5) * km;
      const base = prevailingAt(field, cx, cy);
      if (base.speed >= CALM_MS) [moistX[i], moistY[i]] = deflect(field, cx, cy, base.dx, base.dy, MOIST_AIR_C);
    }
  }
  const water = new Float32Array(n);
  const rain = new Float32Array(n);
  const efficiency = new Float32Array(h);
  for (let y = 0; y < h; y++) efficiency[y] = interpolate(RAIN_EFFICIENCY, Math.abs(field.rowLatitudeDeg[y]));
  for (let i = 0; i < n; i++) water[i] = 0.5 * MOISTENED_SHARE * capacityMm(temp[i]);
  // What does not change from one pass to the next: target water, uptake rate, capacity at the ground's height.
  const target = new Float32Array(n);
  const uptake = new Float32Array(n);
  const aloft = new Float32Array(n);
  const rainRate = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const sea = field.water[i];
    const forest = field.forest[i] * (1 - sea);
    const bare = Math.max(0, 1 - sea - forest);
    target[i] = MOISTENED_SHARE * capacityMm(temp[i]);
    uptake[i] = Math.min(1, sea * (km / WATER_MOISTENING_KM) + forest * (km / FOREST_MOISTENING_KM) + bare * (km / LAND_MOISTENING_KM));
    aloft[i] = capacityMm(temp[i] - altitudeM[i] * LAPSE_RATE_C_PER_M);
    rainRate[i] = efficiency[Math.floor(i / w)] * (km / RAIN_OUT_KM);
  }
  sweep(w, h, MOISTURE_SWEEPS, (x, y, i) => {
    // In a calm belt nothing blows: the air mixes with its neighbours.
    let q = moistX[i] === 0 && moistY[i] === 0 ? neighbourMean(water, w, h, x, y) : sampleGrid(water, w, h, x + 0.5 - moistX[i], y + 0.5 - moistY[i]);
    // Uptake over water, forests and (a little) bare land.
    if (q < target[i]) q += (target[i] - q) * uptake[i];
    // Background rain: only from fairly moist air (relative humidity 20 → 70 %).
    const background = q * rainRate[i] * smoothstep(0.2, 0.7, (q / target[i]) * MOISTENED_SHARE);
    q -= background;
    // Condensation at the height of the ground: the slopes.
    const condensed = Math.max(0, q - aloft[i]);
    q -= condensed;
    water[i] = q;
    rain[i] = background + OROGRAPHIC_EFFICIENCY * condensed;
  });

  // 4. Continentality: the sea damps the seasons (it stores the summer's heat and gives it back in
  // winter). The share of land within a few hundred km sets how continental each place is.
  const radius = Math.max(1, Math.round(CONTINENTAL_RADIUS_KM / km));
  const landShare = new Float32Array(n);
  for (let i = 0; i < n; i++) landShare[i] = 1 - field.water[i];
  const blurred = boxBlurGrid(boxBlurGrid(landShare, w, h, radius), w, h, radius);
  const continentality = new Float32Array(n);
  for (let i = 0; i < n; i++) continentality[i] = smoothstep(0.3, 0.95, blurred[i]);

  // 5. Annual totals, softened over a few cells (the rain of one step falls over a band, not a line).
  const smoothRain = blur3(rain, w, h);
  const precipitationMm = new Float32Array(n);
  const wetnessPct = new Float32Array(n);
  const tempAnomalyC = new Float32Array(n);
  const meanTempC = new Float32Array(n);
  const warmestTempC = new Float32Array(n);
  const coldestTempC = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const p = (smoothRain[i] / km) * AIR_KM_PER_DAY * 365;
    const t = temp[i] - altitudeM[i] * LAPSE_RATE_C_PER_M;
    // Month by month: with the annual mean alone, a cold place would have no evaporation at all, even in summer.
    const row = Math.floor(i / w);
    let pet = 0;
    let warmestDev = -Infinity;
    let coldestDev = Infinity;
    for (let m = 0; m < 12; m++) {
      const dev = field.rowSeaDevC[row * 12 + m] + continentality[i] * (field.rowLandDevC[row * 12 + m] - field.rowSeaDevC[row * 12 + m]);
      warmestDev = Math.max(warmestDev, dev);
      coldestDev = Math.min(coldestDev, dev);
      pet += Math.max(0, 10 + 4.6 * (t + dev));
    }
    precipitationMm[i] = p;
    wetnessPct[i] = (100 * p) / (p + pet + 1e-6);
    tempAnomalyC[i] = temp[i] - localT[i];
    meanTempC[i] = temp[i];
    warmestTempC[i] = temp[i] + warmestDev;
    coldestTempC[i] = temp[i] + coldestDev;
  }
  return {
    widthCells: w,
    heightCells: h,
    cellKm: km,
    precipitationMm,
    wetnessPct,
    tempAnomalyC,
    meanTempC,
    warmestTempC,
    coldestTempC,
    continentality,
    rowLandDevC: field.rowLandDevC,
    rowSeaDevC: field.rowSeaDevC,
  };
}

/**
 * Air temperature at sea level at a point (km) and a moment of the year
 * (`yearPhase` 0 = 1st January): the annual mean brought by the winds, plus
 * the month's departure, between the sea's (damped) and a continent's (wide)
 * according to the continentality. Months are centred mid-month; in between,
 * linear interpolation.
 */
export function weatherMonthTempC(weather: DrawingWeather, xKm: number, yKm: number, yearPhase: number): number {
  const mean = sampleWeather(weather, weather.meanTempC, xKm, yKm);
  const c = sampleWeather(weather, weather.continentality, xKm, yKm);
  const row = Math.min(weather.heightCells - 1, Math.max(0, Math.floor(yKm / weather.cellKm)));
  const t = (((yearPhase * 12 - 0.5) % 12) + 12) % 12;
  const m0 = Math.floor(t);
  const m1 = (m0 + 1) % 12;
  const f = t - m0;
  const dev = (m: number) => weather.rowSeaDevC[row * 12 + m] + c * (weather.rowLandDevC[row * 12 + m] - weather.rowSeaDevC[row * 12 + m]);
  return mean + dev(m0) + (dev(m1) - dev(m0)) * f;
}

/** Ground climate from the weather: its wetness, its warmest month, and the month shown, with the winds and the continentality. */
export function weatherGroundClimate(weather: DrawingWeather, cellKm: number, yearPhase: number): GroundClimate {
  return {
    wetnessPct: (x, y) => sampleWeather(weather, weather.wetnessPct, x * cellKm, y * cellKm),
    warmestC: (x, y) => sampleWeather(weather, weather.warmestTempC, x * cellKm, y * cellKm),
    monthC: (x, y) => weatherMonthTempC(weather, x * cellKm, y * cellKm, yearPhase),
  };
}

export function capacityMm(tempC: number): number {
  return SATURATED_30C_MM * moistureCapacity(tempC);
}

/** Bilinear sample of a weather grid at a point in km (clamped at the edges). */
export function sampleWeather(weather: DrawingWeather, grid: Float32Array, xKm: number, yKm: number): number {
  return sampleGrid(grid, weather.widthCells, weather.heightCells, xKm / weather.cellKm, yKm / weather.cellKm);
}

/** Gauss–Seidel sweeps in the four diagonal orders: whatever the wind's direction, some pass follows it. */
function sweep(w: number, h: number, sweeps: number, visit: (x: number, y: number, i: number) => void): void {
  for (let s = 0; s < sweeps; s++) {
    const forwardX = s % 2 === 0;
    const forwardY = s % 4 < 2;
    for (let yy = 0; yy < h; yy++) {
      const y = forwardY ? yy : h - 1 - yy;
      for (let xx = 0; xx < w; xx++) {
        const x = forwardX ? xx : w - 1 - xx;
        visit(x, y, y * w + x);
      }
    }
  }
}

/** Bilinear sample at a point in cell units (cell centres at +0.5), clamped. */
function sampleGrid(grid: Float32Array, w: number, h: number, fx: number, fy: number): number {
  const x = Math.min(w - 1, Math.max(0, fx - 0.5));
  const y = Math.min(h - 1, Math.max(0, fy - 0.5));
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const x1 = Math.min(w - 1, x0 + 1);
  const y1 = Math.min(h - 1, y0 + 1);
  const tx = x - x0;
  const ty = y - y0;
  const top = grid[y0 * w + x0] * (1 - tx) + grid[y0 * w + x1] * tx;
  const bottom = grid[y1 * w + x0] * (1 - tx) + grid[y1 * w + x1] * tx;
  return top * (1 - ty) + bottom * ty;
}

function boxBlurGrid(src: Float32Array, w: number, h: number, r: number): Float32Array {
  const tmp = new Float32Array(w * h);
  const out = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    let s = 0;
    for (let k = 0; k <= Math.min(w - 1, r); k++) s += src[y * w + k];
    for (let x = 0; x < w; x++) {
      const lo = x - r - 1;
      const hi = x + r;
      if (x > 0 && hi < w) s += src[y * w + hi];
      if (x > 0 && lo >= 0) s -= src[y * w + lo];
      tmp[y * w + x] = s / (Math.min(w - 1, x + r) - Math.max(0, x - r) + 1);
    }
  }
  for (let x = 0; x < w; x++) {
    let s = 0;
    for (let k = 0; k <= Math.min(h - 1, r); k++) s += tmp[k * w + x];
    for (let y = 0; y < h; y++) {
      const lo = y - r - 1;
      const hi = y + r;
      if (y > 0 && hi < h) s += tmp[hi * w + x];
      if (y > 0 && lo >= 0) s -= tmp[lo * w + x];
      out[y * w + x] = s / (Math.min(h - 1, y + r) - Math.max(0, y - r) + 1);
    }
  }
  return out;
}

function neighbourMean(grid: Float32Array, w: number, h: number, x: number, y: number): number {
  let s = 0;
  let c = 0;
  if (x > 0) {
    s += grid[y * w + x - 1];
    c++;
  }
  if (x < w - 1) {
    s += grid[y * w + x + 1];
    c++;
  }
  if (y > 0) {
    s += grid[(y - 1) * w + x];
    c++;
  }
  if (y < h - 1) {
    s += grid[(y + 1) * w + x];
    c++;
  }
  return c > 0 ? s / c : grid[y * w + x];
}

function smoothstep(edge0: number, edge1: number, v: number): number {
  const t = Math.min(1, Math.max(0, (v - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

function blur3(src: Float32Array, w: number, h: number): Float32Array {
  const out = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let s = 0;
      let c = 0;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx;
          const yy = y + dy;
          if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
          s += src[yy * w + xx];
          c++;
        }
      }
      out[y * w + x] = s / c;
    }
  }
  return out;
}

function interpolate(table: readonly (readonly [number, number])[], x: number): number {
  if (x <= table[0][0]) return table[0][1];
  for (let i = 1; i < table.length; i++) {
    const [x1, y1] = table[i];
    if (x <= x1) {
      const [x0, y0] = table[i - 1];
      return y0 + ((y1 - y0) * (x - x0)) / (x1 - x0);
    }
  }
  return table[table.length - 1][1];
}
