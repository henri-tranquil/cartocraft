import { prevailingWind } from '../climate/wind';
import { rowSeaLevelTemperaturesC } from '../climate/temperature';
import { latitudeAtRow } from '../map/latitude';
import { MapSettings } from '../map/map-settings';
import { getCell, Int16TiledGrid } from '../terrain/tiled-grid';
import { forestIndexOf, isLandCode, reliefIndexOf } from './drawing-cell';

/**
 * WINDS OF THE DRAWING — computed by themselves from the latitudes and the drawing.
 *
 * 1. PREVAILING WIND by latitude, the "three-cell" model of the climate
 *    (climate/wind.ts): trade winds towards the west and the equator under
 *    30°, westerlies towards the east and the pole between 30° and 60°, polar
 *    easterlies beyond. No seasonal shift: the directions are fixed all year
 *    (only the strength will vary, step V3).
 *    The westerlies meander (Rossby waves, see `waveEnvelope`): cold air
 *    dives south in the trough, warm air rises north just east of it.
 * 2. STREAMLINES: the path a particle of air follows, integrated step by step
 *    from seeds spread over the map. The air keeps some inertia and turns
 *    back towards the local prevailing wind over a few hundred km.
 * 3. RELIEF: looking ~50 km ahead, the UPHILL part of the direction is
 *    removed, so the air slides along a range. How much depends on how cold
 *    the air is: cold air is dense and stable (hills bend it, mountains stop
 *    it: "cold-air damming"); warm air is light (it climbs hills and is only
 *    partly turned by high mountains).
 * 4. AIR MASS MEMORY: the air keeps the temperature of where it comes from,
 *    and only slowly takes that of the ground below (over ~1200 km). Warm air
 *    carried poleward by the westerlies stays warm; cold polar air carried
 *    equatorward stays cold. Where both meet (~60°) is the polar front.
 * 5. HUMIDITY: the air picks up water over the sea and lakes (fast) and over
 *    forests (slowly, the trees breathe out water); warm air can hold far
 *    more than cold air, so cold air stays dry. It slowly dries over bare
 *    land. Rain (what makes the air lose its water) is step V2.
 *
 * The relief is read on a coarse, blurred grid (≤ 256 cells across): the air
 * feels a range as a smooth bump, not cell by cell.
 */

/** Relief felt by the air, 0 (plain, water) … 1 (high mountain), per relief class. */
const RELIEF_BARRIER = [0, 0.3, 0.65, 1] as const;
const FIELD_MAX_CELLS = 256;
/** Blur of the relief: the air senses a range before reaching its crest. */
const FIELD_BLUR_KM = 25;

/** The drawing as the air feels it, on a coarse grid. */
export interface DrawingAirField {
  readonly widthCells: number;
  readonly heightCells: number;
  /** Size of one coarse cell, km. */
  readonly cellKm: number;
  /** Barrier height 0..1 (blurred), row-major. */
  readonly barrier: Float32Array;
  /** Share of water (sea, lakes) 0..1. */
  readonly water: Float32Array;
  /** Share of forest 0..1. */
  readonly forest: Float32Array;
  /** Per coarse row: annual mean sea-level temperature (°C) and prevailing wind (m/s, east and NORTH components). */
  readonly rowTempC: Float32Array;
  readonly rowEastMs: Float32Array;
  readonly rowNorthMs: Float32Array;
  /** Per coarse row: peak NORTH component of the westerlies' wave (m/s), see `waveNorthMs`. */
  readonly rowWaveMs: Float32Array;
  /** Wavelength of the wave and x of its trough (km). */
  readonly waveLengthKm: number;
  readonly troughXKm: number;
}

type AirSettings = Pick<MapSettings, 'latitudeTopDeg' | 'latitudeBottomDeg' | 'axialTiltDeg' | 'globalTemperatureOffsetC'>;

export function drawingAirField(drawing: Int16TiledGrid, cellKm: number, settings: AirSettings): DrawingAirField {
  const factor = Math.max(1, Math.ceil(Math.max(drawing.widthCells, drawing.heightCells) / FIELD_MAX_CELLS));
  const w = Math.ceil(drawing.widthCells / factor);
  const h = Math.ceil(drawing.heightCells / factor);
  const relief = new Float32Array(w * h);
  const water = new Float32Array(w * h);
  const forest = new Float32Array(w * h);
  const count = new Uint32Array(w * h);
  for (let y = 0; y < drawing.heightCells; y++) {
    const row = Math.floor(y / factor) * w;
    for (let x = 0; x < drawing.widthCells; x++) {
      const code = getCell(drawing, x, y);
      const i = row + Math.floor(x / factor);
      if (isLandCode(code)) {
        relief[i] += RELIEF_BARRIER[reliefIndexOf(code)];
        if (forestIndexOf(code) > 0) forest[i]++;
      } else {
        water[i]++;
      }
      count[i]++;
    }
  }
  for (let i = 0; i < count.length; i++) {
    relief[i] /= count[i];
    water[i] /= count[i];
    forest[i] /= count[i];
  }
  const coarseKm = cellKm * factor;
  const radius = Math.max(1, Math.round(FIELD_BLUR_KM / coarseKm));
  const rowTempC = new Float32Array(h);
  const rowEastMs = new Float32Array(h);
  const rowNorthMs = new Float32Array(h);
  const rowWaveMs = new Float32Array(h);
  const heightCells = h * factor;
  for (let r = 0; r < h; r++) {
    const lat = latitudeAtRow(settings, heightCells, (r + 0.5) * factor);
    const { land, sea } = rowSeaLevelTemperaturesC(lat, settings);
    let sum = 0;
    for (let m = 0; m < land.length; m++) sum += (land[m] + sea[m]) / 2;
    rowTempC[r] = sum / land.length;
    // Belts at their annual mean position (no seasonal shift).
    const wind = prevailingWind(lat, 0, 0);
    rowEastMs[r] = wind.uMs;
    rowNorthMs[r] = wind.vMs;
    rowWaveMs[r] = WAVE_PEAK_MS * waveEnvelope(lat) * Math.sign(lat);
  }
  const barrier = boxBlur(boxBlur(relief, w, h, radius), w, h, radius);
  const widthKm = w * coarseKm;
  const waveLengthKm = Math.min(WAVE_MAX_KM, Math.max(WAVE_MIN_KM, widthKm));
  const troughXKm = anchorXKm(barrier, water, rowWaveMs, w, h, coarseKm) + waveLengthKm / 4;
  return {
    widthCells: w,
    heightCells: h,
    cellKm: coarseKm,
    barrier,
    water,
    forest,
    rowTempC,
    rowEastMs,
    rowNorthMs,
    rowWaveMs,
    waveLengthKm,
    troughXKm,
  };
}

/**
 * WAVES OF THE WESTERLIES. On Earth the westerlies are not straight: the jet
 * stream meanders in large "Rossby waves". In a TROUGH of the wave, polar air
 * dives towards the equator (a tongue of cold air); just east of it, warm air
 * rises towards the pole (a tongue of warm air); where they meet is a front,
 * where the depressions are born. Big mountain ranges (and cold continents)
 * anchor a trough just downstream (east) of them: the trough east of the
 * Rockies, the one east of Asia.
 *
 * Here: a north–south wind added to the prevailing wind,
 *   v' = A(latitude) · sin(2π (x − x_trough) / λ)
 * (towards the equator west of the trough, towards the pole east of it),
 * strongest around 45°, nil in the trades and near the pole. λ follows the
 * map width (1500–3000 km: one trough and one ridge on the map; real waves
 * are longer, but the storms riding them have this size), and the trough sits
 * a quarter wavelength east of the main mountains (else of the land).
 */
const WAVE_PEAK_MS = 7;
const WAVE_MIN_KM = 1500;
const WAVE_MAX_KM = 3000;

function waveEnvelope(latitudeDeg: number): number {
  const a = Math.abs(latitudeDeg);
  return smoothstep(25, 35, a) * (1 - smoothstep(60, 72, a));
}

/** x (km) of the main mountain mass in the wavy belt (high relief counts more), else of the land, else the map centre. */
function anchorXKm(barrier: Float32Array, water: Float32Array, rowWaveMs: Float32Array, w: number, h: number, cellKm: number): number {
  let mountain = 0;
  let mountainX = 0;
  let land = 0;
  let landX = 0;
  for (let y = 0; y < h; y++) {
    const weight = Math.abs(rowWaveMs[y]);
    if (weight === 0) continue;
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const m = barrier[i] * barrier[i] * weight;
      mountain += m;
      mountainX += m * (x + 0.5);
      const l = (1 - water[i]) * weight;
      land += l;
      landX += l * (x + 0.5);
    }
  }
  const belt = rowWaveMs.reduce((sum, v) => sum + Math.abs(v), 0) * w;
  if (belt > 0 && mountain > 0.01 * belt) return (mountainX / mountain) * cellKm;
  if (land > 0) return (landX / land) * cellKm;
  return (w / 2) * cellKm;
}

/** North component of the wave at a point (m/s). */
function waveNorthMs(field: DrawingAirField, xKm: number, yKm: number): number {
  return sampleRow(field, field.rowWaveMs, yKm) * Math.sin((2 * Math.PI * (xKm - field.troughXKm)) / field.waveLengthKm);
}

function boxBlur(src: Float32Array, w: number, h: number, r: number): Float32Array {
  const tmp = new Float32Array(w * h);
  const out = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let s = 0;
      let n = 0;
      for (let k = Math.max(0, x - r); k <= Math.min(w - 1, x + r); k++, n++) s += src[y * w + k];
      tmp[y * w + x] = s / n;
    }
  }
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let s = 0;
      let n = 0;
      for (let k = Math.max(0, y - r); k <= Math.min(h - 1, y + r); k++, n++) s += tmp[k * w + x];
      out[y * w + x] = s / n;
    }
  }
  return out;
}

/** Bilinear sample of a coarse grid at a point in km (clamped at the edges). */
function sample(field: DrawingAirField, grid: Float32Array, xKm: number, yKm: number): number {
  const fx = Math.min(field.widthCells - 1, Math.max(0, xKm / field.cellKm - 0.5));
  const fy = Math.min(field.heightCells - 1, Math.max(0, yKm / field.cellKm - 0.5));
  const x0 = Math.floor(fx);
  const y0 = Math.floor(fy);
  const x1 = Math.min(field.widthCells - 1, x0 + 1);
  const y1 = Math.min(field.heightCells - 1, y0 + 1);
  const tx = fx - x0;
  const ty = fy - y0;
  const w = field.widthCells;
  const top = grid[y0 * w + x0] * (1 - tx) + grid[y0 * w + x1] * tx;
  const bottom = grid[y1 * w + x0] * (1 - tx) + grid[y1 * w + x1] * tx;
  return top * (1 - ty) + bottom * ty;
}

/** Linear sample of a per-row value at a y in km. */
function sampleRow(field: DrawingAirField, rows: Float32Array, yKm: number): number {
  const fy = Math.min(field.heightCells - 1, Math.max(0, yKm / field.cellKm - 0.5));
  const y0 = Math.floor(fy);
  const y1 = Math.min(field.heightCells - 1, y0 + 1);
  return rows[y0] + (rows[y1] - rows[y0]) * (fy - y0);
}

export function barrierAt(field: DrawingAirField, xKm: number, yKm: number): number {
  return sample(field, field.barrier, xKm, yKm);
}

/** Blocking by the relief ahead: ramps from `from` to `to` (barrier height), up to `max`; cold and warm air. */
const DEFLECTION = {
  cold: { from: 0.2, to: 0.55, max: 1 },
  warm: { from: 0.5, to: 1, max: 0.5 },
} as const;
/** Air temperatures (°C) taken as fully "cold" and fully "warm" for the blocking. */
const COLD_AIR_C = 0;
const WARM_AIR_C = 20;
const LOOK_AHEAD_KM = 50;
/** Distance over which the air turns towards the local prevailing wind. */
const RELAX_KM = 300;
/** Distance over which an air mass takes the temperature of the place. */
export const AIR_MEMORY_KM = 1200;
/** Moisture pick-up over water and forest, drying over bare land (e-folding distances, km). */
const WATER_MOISTENING_KM = 400;
const FOREST_MOISTENING_KM = 1200;
const LAND_DRYING_KM = 3000;
/** Below this prevailing speed (m/s) the air is in a calm belt or a convergence: the line ends. */
const CALM_MS = 0.6;
/** Length of one streamline, km. */
const LINE_KM = 700;
/** Seeds: about this many along the longest side of the map. */
const SEEDS_PER_SIDE = 20;

/** Water the air can hold, relative 0..1: warm air holds much more (roughly doubles every 10 °C, capped). */
export function moistureCapacity(tempC: number): number {
  return Math.min(1, Math.max(0.08, Math.pow(2, (tempC - 30) / 10)));
}

/** One streamline: points in km (x0, y0, x1, y1…), and at each point the air's temperature (°C) and humidity (0..1, share of what warm air can hold). */
export interface AirStreamline {
  readonly pointsKm: Float32Array;
  readonly tempC: Float32Array;
  readonly humidity: Float32Array;
  /** Bounding box (km), for culling. */
  readonly box: { readonly x0: number; readonly y0: number; readonly x1: number; readonly y1: number };
}

/** Streamlines from seeds spread over the whole map (jittered grid, deterministic). */
export function traceDrawingWinds(field: DrawingAirField): AirStreamline[] {
  const widthKm = field.widthCells * field.cellKm;
  const heightKm = field.heightCells * field.cellKm;
  const spacing = Math.max(widthKm, heightKm) / SEEDS_PER_SIDE;
  const lines: AirStreamline[] = [];
  for (let j = 0; j * spacing < heightKm; j++) {
    for (let i = 0; i * spacing < widthKm; i++) {
      const x = (i + 0.2 + 0.6 * hash01(i, j, 1)) * spacing;
      const y = (j + 0.2 + 0.6 * hash01(i, j, 2)) * spacing;
      if (x >= widthKm || y >= heightKm) continue;
      const line = traceStreamline(field, x, y);
      if (line) lines.push(line);
    }
  }
  return lines;
}

/** Prevailing direction at a point (belts + wave), map axes (x east, y SOUTH), and its speed in m/s. */
function prevailingAt(field: DrawingAirField, xKm: number, yKm: number): { dx: number; dy: number; speed: number } {
  const east = sampleRow(field, field.rowEastMs, yKm);
  const north = sampleRow(field, field.rowNorthMs, yKm) + waveNorthMs(field, xKm, yKm);
  const speed = Math.hypot(east, north);
  return speed > 0 ? { dx: east / speed, dy: -north / speed, speed } : { dx: 0, dy: 0, speed: 0 };
}

export function traceStreamline(field: DrawingAirField, startX: number, startY: number): AirStreamline | null {
  const widthKm = field.widthCells * field.cellKm;
  const heightKm = field.heightCells * field.cellKm;
  const stepKm = Math.max(1, field.cellKm / 2);
  const recordKm = Math.max(stepKm, 8);
  let base = prevailingAt(field, startX, startY);
  if (base.speed < CALM_MS) return null;
  let dx = base.dx;
  let dy = base.dy;
  let x = startX;
  let y = startY;
  let tempC = sampleRow(field, field.rowTempC, y);
  // Starts with the humidity it would have had there, roughly: a share of its capacity.
  let humidity = moistureCapacity(tempC) * (0.3 + 0.6 * sample(field, field.water, x, y));
  const points: number[] = [];
  const temps: number[] = [];
  const hums: number[] = [];
  let box = { x0: x, y0: y, x1: x, y1: y };
  let travelled = 0;
  let sinceRecord = recordKm;
  while (x >= 0 && y >= 0 && x <= widthKm && y <= heightKm && travelled <= LINE_KM) {
    if (sinceRecord >= recordKm) {
      points.push(x, y);
      temps.push(tempC);
      hums.push(humidity);
      box = { x0: Math.min(box.x0, x), y0: Math.min(box.y0, y), x1: Math.max(box.x1, x), y1: Math.max(box.y1, y) };
      sinceRecord = 0;
    }
    base = prevailingAt(field, x, y);
    // Calm belt, or the prevailing wind now points against the air (it met another belt: a convergence, like the polar front).
    if (base.speed < CALM_MS || base.dx * dx + base.dy * dy < -0.2) break;
    // dx, dy = heading of the air mass (inertia), not bent by the relief.
    // The heading the air "wants" turns towards the prevailing wind; the relief only bends
    // the actual move. (Bending the heading itself would add up step after step, and every
    // air mass would end up sliding along the range.)
    const pull = stepKm / RELAX_KM;
    [dx, dy] = normalise(dx + base.dx * pull, dy + base.dy * pull);
    const [mx, my] = deflect(field, x, y, dx, dy, tempC);
    x += mx * stepKm;
    y += my * stepKm;
    travelled += stepKm;
    sinceRecord += stepKm;
    // The air mass slowly takes the temperature of the place.
    const local = sampleRow(field, field.rowTempC, y);
    tempC += (local - tempC) * (1 - Math.exp(-stepKm / AIR_MEMORY_KM));
    // Moisture: towards the capacity over water and forest, slow drying over bare land; never above the capacity (the excess condenses: rain, step V2).
    const capacity = moistureCapacity(tempC);
    const water = sample(field, field.water, x, y);
    const forest = sample(field, field.forest, x, y) * (1 - water);
    const gain = water * (stepKm / WATER_MOISTENING_KM) + forest * (stepKm / FOREST_MOISTENING_KM);
    humidity += (capacity - humidity) * Math.min(1, gain);
    humidity -= humidity * (1 - water - forest) * (stepKm / LAND_DRYING_KM);
    humidity = Math.min(humidity, capacity);
  }
  points.push(x, y);
  temps.push(tempC);
  hums.push(humidity);
  if (temps.length < 3) return null;
  return { pointsKm: Float32Array.from(points), tempC: Float32Array.from(temps), humidity: Float32Array.from(hums), box };
}

/** Removes the uphill part of the direction where the relief ahead rises: more for cold air than for warm air. */
function deflect(field: DrawingAirField, x: number, y: number, dx: number, dy: number, tempC: number): [number, number] {
  const ax = x + dx * LOOK_AHEAD_KM;
  const ay = y + dy * LOOK_AHEAD_KM;
  const w = smoothstep(COLD_AIR_C, WARM_AIR_C, tempC);
  const from = lerp(DEFLECTION.cold.from, DEFLECTION.warm.from, w);
  const to = lerp(DEFLECTION.cold.to, DEFLECTION.warm.to, w);
  const max = lerp(DEFLECTION.cold.max, DEFLECTION.warm.max, w);
  const block = max * smoothstep(from, to, barrierAt(field, ax, ay));
  if (block <= 0) return [dx, dy];
  const e = field.cellKm;
  const gx = (barrierAt(field, ax + e, ay) - barrierAt(field, ax - e, ay)) / (2 * e);
  const gy = (barrierAt(field, ax, ay + e) - barrierAt(field, ax, ay - e)) / (2 * e);
  const g = Math.hypot(gx, gy);
  if (g <= 1e-6) return [dx, dy];
  const nx = gx / g;
  const ny = gy / g;
  const up = dx * nx + dy * ny;
  if (up <= 0) return [dx, dy];
  let ex = dx - block * up * nx;
  let ey = dy - block * up * ny;
  if (Math.hypot(ex, ey) < 0.15) {
    // Head-on and (almost) fully blocked: slide to the side where the relief is lower.
    // Partly blocked air keeps going: it climbs, slowly turning along the slope.
    const side = barrierAt(field, x - ny * LOOK_AHEAD_KM, y + nx * LOOK_AHEAD_KM) <= barrierAt(field, x + ny * LOOK_AHEAD_KM, y - nx * LOOK_AHEAD_KM) ? 1 : -1;
    ex += -ny * side * 0.5;
    ey += nx * side * 0.5;
  }
  return normalise(ex, ey);
}

function normalise(x: number, y: number): [number, number] {
  const n = Math.hypot(x, y) || 1;
  return [x / n, y / n];
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function smoothstep(edge0: number, edge1: number, v: number): number {
  const t = Math.min(1, Math.max(0, (v - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

/** Deterministic 0..1 from integer coordinates. */
function hash01(i: number, j: number, salt: number): number {
  let h = Math.imul(i, 374761393) ^ Math.imul(j, 668265263) ^ Math.imul(salt, 2246822519);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
