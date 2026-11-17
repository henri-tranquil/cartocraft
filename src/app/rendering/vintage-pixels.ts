import { chamferDistance } from '../domain/terrain/distance-field';
import { fbm, hash2 } from '../domain/terrain/noise';
import { VINTAGE } from './style/vintage-style';
import { VintageClimate } from './vintage-climate';

export interface VintageInput {
  /** Row-major altitudes (m). */
  readonly altitudeM: Int16Array;
  readonly widthCells: number;
  readonly heightCells: number;
  readonly seaLevelM: number;
  /** 1 = sea (computeSeaMask): inland cells below sea level are land. */
  readonly sea: Uint8Array;
  readonly cellSizeM: number;
  readonly seed: number;
  /** Yearly climate summaries; null until the first climate run (plain parchment). */
  readonly climate: VintageClimate | null;
}

/**
 * Base layer of the rendered view, 1 pixel per cell (RGBA into `out`).
 * Pure: unit-testable and ready to move into a Worker.
 *
 * Two distance fields drive the look: for sea cells the distance to land
 * (coastal glow), for land cells the distance to the sea (darker rim).
 * Fractal noise stains both, and a per-cell hash adds paper grain.
 * No hillshade: relief is shown by the mountain glyphs only. Land gets a
 * light climate wash (ochre where dry, green where wet, pale where summers
 * are too cold for trees), the parchment still showing through.
 */
export function renderVintagePixels(input: VintageInput, out: Uint8ClampedArray): void {
  const { widthCells: w, heightCells: h, sea, seed } = input;
  const n = w * h;
  const land = new Uint8Array(n);
  for (let i = 0; i < n; i++) land[i] = 1 - sea[i];
  const toSea = chamferDistance(land, w, h); // on land: cells to the nearest sea
  const toLand = chamferDistance(sea, w, h); // at sea: cells to the nearest land

  const side = Math.max(w, h);
  const glow = Math.max(1, side * VINTAGE.seaGlowFraction);
  const rim = Math.max(1, side * VINTAGE.landEdgeFraction);
  const stainScale = 1 / Math.max(1, side * VINTAGE.stainFraction);
  const stains = stainField(seed, w, h, stainScale);
  const [dr, dg, db] = VINTAGE.seaDeep;
  const [or, og, ob] = VINTAGE.seaOpen;
  const [sr, sg, sb] = VINTAGE.seaShallow;
  const [pr, pg, pb] = VINTAGE.parchment;
  const [er, eg, eb] = VINTAGE.parchmentEdge;
  const [ar, ag, ab] = VINTAGE.landDry;
  const [wr, wg, wb] = VINTAGE.landWet;
  const [fr, fg, fb] = VINTAGE.landCold;
  const climate = input.climate;

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const stain = stains(x, y); // ±0.5
      const grain = (hash2(seed ^ 0x5bd1e995, x, y) - 0.5) * VINTAGE.grainStrength;
      let r: number;
      let g: number;
      let b: number;

      if (sea[i]) {
        const near = Math.exp(-toLand[i] / glow); // 1 on the shore → 0 offshore
        // Offshore: deep and open water mixed by the stains; near shore: turquoise.
        const blot = clamp01(0.5 + stain * 2);
        r = dr + (or - dr) * blot;
        g = dg + (og - dg) * blot;
        b = db + (ob - db) * blot;
        const t = near * near * (3 - 2 * near);
        r += (sr - r) * t;
        g += (sg - g) * t;
        b += (sb - b) * t;
        const k = 1 + stain * VINTAGE.seaStainStrength * (1 - 0.6 * t) + grain;
        r *= k;
        g *= k;
        b *= k;
      } else {
        const edge = Math.exp(-(toSea[i] - 1) / rim) * 0.85;
        r = pr;
        g = pg;
        b = pb;
        if (climate) {
          // Wash colour: dry → wet, then towards pale where the summer is cold.
          const wet = smoothstep(VINTAGE.washDryPct, VINTAGE.washWetPct, climate.wetnessPct[i]);
          const cold = 1 - smoothstep(VINTAGE.washColdC, VINTAGE.washMildC, climate.warmestDeciC[i] / 10);
          let tr = ar + (wr - ar) * wet;
          let tg = ag + (wg - ag) * wet;
          let tb = ab + (wb - ab) * wet;
          tr += (fr - tr) * cold;
          tg += (fg - tg) * cold;
          tb += (fb - tb) * cold;
          // The stains also modulate the wash: uneven, like watercolour.
          const k = VINTAGE.washStrength * (0.75 + stain);
          r += (tr - r) * k;
          g += (tg - g) * k;
          b += (tb - b) * k;
        }
        r += (er - r) * edge;
        g += (eg - g) * edge;
        b += (eb - b) * edge;
        const k = 1 + stain * VINTAGE.landStainStrength + grain;
        r *= k;
        g *= k;
        b *= k;
      }
      const o = i * 4;
      out[o] = r; // Uint8ClampedArray rounds and clamps
      out[o + 1] = g;
      out[o + 2] = b;
      out[o + 3] = 255;
    }
  }
}

/**
 * The stains are smooth (finest octave ≈ 12 cells wide on a 1700-cell map),
 * so we evaluate the fractal noise every STAIN_STEP cells and interpolate
 * bilinearly in between: 16× fewer noise evaluations, same look.
 */
const STAIN_STEP = 4;

function stainField(seed: number, w: number, h: number, scale: number): (x: number, y: number) => number {
  const cw = Math.ceil(w / STAIN_STEP) + 2;
  const ch = Math.ceil(h / STAIN_STEP) + 2;
  const coarse = new Float32Array(cw * ch);
  for (let j = 0; j < ch; j++) {
    for (let i = 0; i < cw; i++) {
      coarse[j * cw + i] = fbm(seed, i * STAIN_STEP * scale, j * STAIN_STEP * scale, VINTAGE.stainOctaves) - 0.5;
    }
  }
  return (x, y) => {
    const gx = x / STAIN_STEP;
    const gy = y / STAIN_STEP;
    const i = Math.floor(gx);
    const j = Math.floor(gy);
    const fx = gx - i;
    const fy = gy - j;
    const k = j * cw + i;
    const top = coarse[k] + (coarse[k + 1] - coarse[k]) * fx;
    const bottom = coarse[k + cw] + (coarse[k + cw + 1] - coarse[k + cw]) * fx;
    return top + (bottom - top) * fy;
  };
}

function smoothstep(from: number, to: number, v: number): number {
  const t = clamp01((v - from) / (to - from));
  return t * t * (3 - 2 * t);
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}
