/**
 * MONSOONS — winds driven by land–sea temperature contrast.
 *
 * Land has little thermal inertia: in winter it gets much colder than the sea
 * at the same latitude, in summer much warmer. Cold air is dense: surface
 * pressure rises over a cold continent (thermal HIGH, e.g. the Siberian
 * High); warm air rises and pressure drops over a hot continent (thermal LOW).
 * Air flows from high to low pressure, so the wind reverses with the seasons:
 * cold dry air pours OUT of the continent in winter, moist ocean air is drawn
 * IN in summer. That is the East Asian / Indian monsoon.
 *
 * Model (on the coarse climate grid):
 * 1. anomaly = equilibrium temperature − sea temperature of the same latitude
 *    (positive over warm land, negative over cold land, 0 over open sea);
 * 2. smoothed at continental scale (pressure systems are ~1000 km wide);
 * 3. pressure ∝ −anomaly, so air flows UP the anomaly gradient (cold → warm),
 *    with a speed proportional to the gradient;
 * 4. Coriolis turns that flow to the right in the north (left in the south).
 *    Aloft it would turn a full 90° (geostrophic wind, along the isobars);
 *    near the ground friction slows the air, and it still crosses the
 *    isobars toward low pressure at ~35°. Near the equator the Coriolis
 *    force vanishes, so the flow goes straight down the pressure gradient.
 */

/** m/s of wind per °C/km of smoothed anomaly gradient (≈ 6–7 m/s for 20 °C over 1500 km). */
export const MONSOON_GAIN_MS_PER_C_PER_KM = 500;
export const MONSOON_MAX_MS = 10;
/** Width of a pressure system. */
export const PRESSURE_SMOOTHING_KM = 600;
/** Angle at which surface wind crosses the isobars toward low pressure. */
const CROSSING_ANGLE_DEG = 35;
/** Below this latitude the deflection fades out (Coriolis ∝ sin φ). */
const DEFLECTION_FULL_LATITUDE_DEG = 15;

/**
 * Box blur repeated 3 times ≈ Gaussian blur, in O(n) per pass whatever the
 * radius (running sums). Edges are clamped: beyond the map, the terrain is
 * assumed to continue like its edge.
 */
export function blur(field: Float32Array, w: number, h: number, radius: number): Float32Array {
  const src = field.slice();
  const dst = new Float32Array(field.length);
  const r = Math.max(0, Math.round(radius));
  if (r === 0) return src;
  for (let pass = 0; pass < 3; pass++) {
    boxPass(src, dst, w, h, r, true);
    boxPass(dst, src, w, h, r, false);
  }
  return src;
}

function boxPass(src: Float32Array, dst: Float32Array, w: number, h: number, r: number, horizontal: boolean): void {
  const lines = horizontal ? h : w;
  const len = horizontal ? w : h;
  const at = (line: number, k: number) => {
    const kk = Math.min(len - 1, Math.max(0, k));
    return horizontal ? src[line * w + kk] : src[kk * w + line];
  };
  const norm = 1 / (2 * r + 1);
  for (let line = 0; line < lines; line++) {
    let sum = 0;
    for (let k = -r; k <= r; k++) sum += at(line, k);
    for (let k = 0; k < len; k++) {
      dst[horizontal ? line * w + k : k * w + line] = sum * norm;
      sum += at(line, k + r + 1) - at(line, k - r);
    }
  }
}

/**
 * Monsoon wind per cell from the thermal anomaly field (°C).
 * `latitudeOfRow(y)` gives each row's latitude, for the Coriolis deflection.
 */
export function monsoonWinds(
  anomalyC: Float32Array,
  w: number,
  h: number,
  cellKm: number,
  latitudeOfRow: (y: number) => number,
): { u: Float32Array; v: Float32Array } {
  const smooth = blur(anomalyC, w, h, PRESSURE_SMOOTHING_KM / cellKm / 2);
  const u = new Float32Array(w * h);
  const v = new Float32Array(w * h);
  const toward = (90 - CROSSING_ANGLE_DEG) * (Math.PI / 180);
  for (let y = 0; y < h; y++) {
    const lat = latitudeOfRow(y);
    // Rotate to the right (clockwise) in the north, to the left in the south.
    const angle = toward * Math.min(1, Math.abs(lat) / DEFLECTION_FULL_LATITUDE_DEG) * Math.sign(lat);
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    for (let x = 0; x < w; x++) {
      const east = (smooth[y * w + Math.min(w - 1, x + 1)] - smooth[y * w + Math.max(0, x - 1)]) / (2 * cellKm);
      // Grid y points south: northward gradient is minus the y difference.
      const north = -(smooth[Math.min(h - 1, y + 1) * w + x] - smooth[Math.max(0, y - 1) * w + x]) / (2 * cellKm);
      let gu = east * MONSOON_GAIN_MS_PER_C_PER_KM;
      let gv = north * MONSOON_GAIN_MS_PER_C_PER_KM;
      const speed = Math.sqrt(gu * gu + gv * gv);
      if (speed > MONSOON_MAX_MS) {
        gu *= MONSOON_MAX_MS / speed;
        gv *= MONSOON_MAX_MS / speed;
      }
      u[y * w + x] = gu * cos + gv * sin;
      v[y * w + x] = -gu * sin + gv * cos;
    }
  }
  return { u, v };
}
