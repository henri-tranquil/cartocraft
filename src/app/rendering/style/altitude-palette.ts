import { INT16_MIN } from '../../domain/terrain/tiled-grid';

/**
 * Temporary hypsometric tints (colour by altitude) for step 3.
 * Step 4 replaces land colours with climate-driven gradients.
 *
 * Stops are relative to sea level, in metres; colours are linearly
 * interpolated between stops.
 */
type Stop = readonly [altitudeM: number, r: number, g: number, b: number];

const SEA_STOPS: readonly Stop[] = [
  [-6000, 38, 52, 96],
  [-2000, 70, 92, 140],
  [-200, 128, 150, 190],
  [0, 168, 186, 214],
];

const LAND_STOPS: readonly Stop[] = [
  [0, 196, 196, 140],
  [200, 150, 168, 104],
  [800, 176, 166, 112],
  [1600, 160, 128, 92],
  [2600, 132, 110, 98],
  [3500, 220, 214, 206],
  [4500, 248, 248, 248],
];

/**
 * Look-up table: one RGB triple for every possible Int16 altitude
 * (65 536 entries, 192 KB). Rendering then costs one array read per pixel
 * instead of searching the stops each time.
 */
export interface AltitudePalette {
  readonly seaLevelM: number;
  readonly rgb: Uint8Array;
}

export function buildAltitudePalette(seaLevelM: number): AltitudePalette {
  const rgb = new Uint8Array(65536 * 3);
  for (let i = 0; i < 65536; i++) {
    const relative = i + INT16_MIN - seaLevelM;
    const color = relative <= 0 ? interpolate(SEA_STOPS, relative) : interpolate(LAND_STOPS, relative);
    rgb.set(color, i * 3);
  }
  return { seaLevelM, rgb };
}

function interpolate(stops: readonly Stop[], altitudeM: number): [number, number, number] {
  if (altitudeM <= stops[0][0]) return [stops[0][1], stops[0][2], stops[0][3]];
  for (let i = 1; i < stops.length; i++) {
    const [a1, r1, g1, b1] = stops[i];
    if (altitudeM <= a1) {
      const [a0, r0, g0, b0] = stops[i - 1];
      const t = (altitudeM - a0) / (a1 - a0);
      return [r0 + (r1 - r0) * t, g0 + (g1 - g0) * t, b0 + (b1 - b0) * t];
    }
  }
  const last = stops[stops.length - 1];
  return [last[1], last[2], last[3]];
}
