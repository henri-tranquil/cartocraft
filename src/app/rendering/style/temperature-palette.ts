/**
 * Diverging scale for temperature: cold blues ← cream at ~0 °C → warm reds.
 * Diverging because 0 °C (freezing) is a meaningful midpoint.
 * One RGB triple per whole degree from MIN to MAX.
 */
export const TEMPERATURE_PALETTE_MIN_C = -40;
export const TEMPERATURE_PALETTE_MAX_C = 40;

const STOPS: readonly (readonly [number, number, number, number])[] = [
  [-40, 44, 52, 110],
  [-20, 70, 110, 170],
  [-5, 160, 196, 220],
  [0, 238, 234, 214],
  [10, 236, 206, 128],
  [20, 226, 150, 72],
  [30, 196, 82, 48],
  [40, 120, 30, 34],
];

export function buildTemperaturePalette(): Uint8Array {
  const count = TEMPERATURE_PALETTE_MAX_C - TEMPERATURE_PALETTE_MIN_C + 1;
  const rgb = new Uint8Array(count * 3);
  for (let i = 0; i < count; i++) {
    const t = TEMPERATURE_PALETTE_MIN_C + i;
    let k = 1;
    while (k < STOPS.length - 1 && t > STOPS[k][0]) k++;
    const [t0, r0, g0, b0] = STOPS[k - 1];
    const [t1, r1, g1, b1] = STOPS[k];
    const f = Math.min(1, Math.max(0, (t - t0) / (t1 - t0)));
    rgb[i * 3] = r0 + (r1 - r0) * f;
    rgb[i * 3 + 1] = g0 + (g1 - g0) * f;
    rgb[i * 3 + 2] = b0 + (b1 - b0) * f;
  }
  return rgb;
}

/** CSS gradient of the same scale, for the UI legend. */
export function temperatureLegendGradient(): string {
  const span = TEMPERATURE_PALETTE_MAX_C - TEMPERATURE_PALETTE_MIN_C;
  const stops = STOPS.map(([t, r, g, b]) => `rgb(${r} ${g} ${b}) ${(((t - TEMPERATURE_PALETTE_MIN_C) / span) * 100).toFixed(1)}%`);
  return `linear-gradient(to right, ${stops.join(', ')})`;
}
