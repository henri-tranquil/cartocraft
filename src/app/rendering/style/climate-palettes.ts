import { buildTemperaturePalette, TEMPERATURE_PALETTE_MAX_C, TEMPERATURE_PALETTE_MIN_C } from './temperature-palette';

/**
 * Lookup tables for the climate views, built once. No biomes: the landscape
 * colour is a CONTINUOUS function of (temperature, soil wetness).
 */
export interface ClimateLuts {
  /** RGB per whole °C, TEMPERATURE_PALETTE_MIN_C..MAX_C. */
  readonly temperature: Uint8Array;
  /** RGB per mm/month, 0..PRECIPITATION_PALETTE_MAX_MM. */
  readonly precipitation: Uint8Array;
  /** RGB per (°C, soil wetness %): index ((t − MIN_C) × 101 + wetness) × 3. */
  readonly landscape: Uint8Array;
}

type Rgb = readonly [number, number, number];

const DRY_ACTIVE: Rgb = [204, 178, 112]; // dry grass, ochre
const WET_ACTIVE: Rgb = [88, 126, 60]; // lush vegetation, olive green
const DRY_DORMANT: Rgb = [178, 158, 120]; // winter steppe, tan
const WET_DORMANT: Rgb = [118, 116, 86]; // leafless woods, olive-brown
const DESERT: Rgb = [224, 198, 142]; // hot and dry, sand
const SNOW: Rgb = [246, 244, 238];

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

function mix(a: Rgb, b: Rgb, f: number): Rgb {
  return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f];
}

/**
 * Land colour for a monthly mean temperature and soil wetness
 * (rain / (rain + potential evaporation), 0..1):
 * - wetness moves from ochre (dry) to green (wet);
 * - temperature wakes vegetation up (dormant browns below ~0 °C, full colour above ~12 °C);
 * - hot and dry turns to sand;
 * - a monthly mean below 0 °C means lasting snow cover: white.
 */
export function landscapeColour(temperatureC: number, wetness01: number): Rgb {
  const wet = smoothstep(0.25, 0.65, wetness01);
  const active = smoothstep(-2, 12, temperatureC);
  let colour = mix(mix(DRY_DORMANT, WET_DORMANT, wet), mix(DRY_ACTIVE, WET_ACTIVE, wet), active);
  colour = mix(colour, DESERT, smoothstep(18, 28, temperatureC) * (1 - wet));
  return mix(colour, SNOW, smoothstep(1, -5, temperatureC));
}

/** mm/month → colour: dry ochre, cream, greens, then blues for very wet. */
const PRECIPITATION_STOPS: readonly (readonly [number, number, number, number])[] = [
  [0, 196, 150, 82],
  [20, 226, 202, 140],
  [50, 236, 232, 206],
  [100, 160, 196, 140],
  [200, 92, 160, 160],
  [350, 48, 104, 150],
  [500, 34, 58, 120],
];
export const PRECIPITATION_PALETTE_MAX_MM = 500;

function precipitationColour(mm: number): Rgb {
  let k = 1;
  while (k < PRECIPITATION_STOPS.length - 1 && mm > PRECIPITATION_STOPS[k][0]) k++;
  const [p0, r0, g0, b0] = PRECIPITATION_STOPS[k - 1];
  const [p1, r1, g1, b1] = PRECIPITATION_STOPS[k];
  return mix([r0, g0, b0], [r1, g1, b1], Math.min(1, (mm - p0) / (p1 - p0)));
}

export function precipitationLegendGradient(): string {
  const max = PRECIPITATION_PALETTE_MAX_MM;
  return `linear-gradient(to right, ${PRECIPITATION_STOPS.map(([p, r, g, b]) => `rgb(${r} ${g} ${b}) ${((p / max) * 100).toFixed(0)}%`).join(', ')})`;
}

let cached: ClimateLuts | null = null;

export function climateLuts(): ClimateLuts {
  if (cached) return cached;
  const temps = TEMPERATURE_PALETTE_MAX_C - TEMPERATURE_PALETTE_MIN_C + 1;
  const precipitation = new Uint8Array((PRECIPITATION_PALETTE_MAX_MM + 1) * 3);
  for (let p = 0; p <= PRECIPITATION_PALETTE_MAX_MM; p++) precipitation.set(precipitationColour(p), p * 3);
  const landscape = new Uint8Array(temps * 101 * 3);
  for (let t = 0; t < temps; t++) {
    for (let p = 0; p <= 100; p++) landscape.set(landscapeColour(t + TEMPERATURE_PALETTE_MIN_C, p / 100), (t * 101 + p) * 3);
  }
  cached = { temperature: buildTemperaturePalette(), precipitation, landscape };
  return cached;
}
