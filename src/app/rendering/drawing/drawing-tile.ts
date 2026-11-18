import { fbm, hash2 } from '../../domain/terrain/noise';
import { Rgb, VINTAGE } from '../style/vintage-style';
import { CoveragePyramid } from './coverage-pyramid';

/** Side of a rendered tile, in pixels (device pixels). */
export const DRAWING_TILE_PX = 256;

/**
 * Zoom level of a tile: one cell spans 2^level pixels. Negative = zoomed out
 * (one pixel covers 2^−level cells). A tile covers DRAWING_TILE_PX / 2^level cells.
 */
export interface DrawingTileKey {
  readonly level: number;
  readonly tx: number;
  readonly ty: number;
}

export function tileCells(level: number): number {
  return DRAWING_TILE_PX / 2 ** level;
}

/** Drawing view look. Colours come from the rendered view's palette: drawing and rendering must match. */
export const DRAWING_STYLE = {
  /** Width of the coastal glow on screen (px), whatever the zoom. */
  glowPx: 24,
  /** Relief wash: how far a high-mountain zone shifts the parchment towards `reliefWash`. */
  reliefWashStrength: 0.45,
  reliefWash: [196, 170, 120] as Rgb,
  /** Forest wash: a pale green under the trees. */
  forestWashStrength: 0.4,
  forestWash: [160, 168, 112] as Rgb,
  /** Coast wiggle: noise amplitude (in land fraction) and period (in cells). Adds detail below the cell size. */
  coastNoise: 0.22,
  coastNoisePeriodCells: 3,
  /** Sea and paper stains: size as a fraction of the map's larger side. */
  stainFraction: 0.12,
  ink: [52, 38, 24] as Rgb,
} as const;

/** Smooth fields are sampled every this many pixels, then interpolated. */
const LATTICE_STEP = 4;

export interface DrawingTileContext {
  readonly pyramid: CoveragePyramid;
  /** Mean relief class (see RELIEF_VALUE): a light ochre wash on relief zones, readable from afar. */
  readonly reliefPyramid: CoveragePyramid;
  readonly forestPyramid: CoveragePyramid;
  readonly widthCells: number;
  readonly heightCells: number;
  readonly seed: number;
}

/** Pyramid level giving the glow at `level`: texels about half the glow width. */
export function glowLevel(level: number, maxLevel: number): number {
  const glowCells = DRAWING_STYLE.glowPx / 2 ** level;
  return Math.max(0, Math.min(maxLevel, Math.round(Math.log2(glowCells / 2))));
}

/**
 * How far (cells) a change of one cell can alter the pixels of a tile at
 * `level`: blur, glow, and glyphs (`glyphReachPx` device px).
 */
export function influenceCells(level: number, maxLevel: number, glyphReachPx = 0): number {
  return 2 + 2 * 2 ** glowLevel(level, maxLevel) + 2 ** Math.max(0, -level) + glyphReachPx / 2 ** level;
}

/**
 * Renders one tile of the drawing in the illustrated look into `out`
 * (RGBA, DRAWING_TILE_PX², premultiplied-free). Pixels outside the map stay transparent.
 *
 * Per pixel: land fraction from the pyramid (+ deterministic noise near the
 * coast when zoomed in, so the coast gains detail instead of turning into
 * cell steps) → land if > ½; a land pixel touching a sea pixel is inked
 * (1-pixel coastline at every zoom); sea = mottled teal lightened by the
 * coarse land fraction (glow); land = parchment, darker close to the shore.
 */
export function renderDrawingTile(ctx: DrawingTileContext, key: DrawingTileKey, out: Uint8ClampedArray): void {
  const N = DRAWING_TILE_PX;
  const M = N + 2; // 1-pixel margin so the coastline test sees across tile borders
  const pxPerCell = 2 ** key.level;
  const cellsPerPx = 1 / pxPerCell;
  const { pyramid, widthCells, heightCells, seed } = ctx;
  const landLevel = Math.max(0, Math.min(pyramid.maxLevel, -key.level));
  const glow = glowLevel(key.level, pyramid.maxLevel);
  const edgeLevel = Math.max(0, glow - 2);
  const noisy = key.level >= 0;
  const noiseOctaves = 2 + Math.max(0, key.level);
  const amp = DRAWING_STYLE.coastNoise;
  const period = DRAWING_STYLE.coastNoisePeriodCells;
  const stainCells = Math.max(widthCells, heightCells) * DRAWING_STYLE.stainFraction;
  const stainOctaves = 4 + Math.max(0, Math.min(3, key.level));
  const originX = key.tx * N - 1;
  const originY = key.ty * N - 1;

  // Pass 1: land / sea for every pixel of the tile plus its margin.
  const land = new Uint8Array(M * M);
  for (let j = 0; j < M; j++) {
    const y = (originY + j + 0.5) * cellsPerPx;
    for (let i = 0; i < M; i++) {
      const x = (originX + i + 0.5) * cellsPerPx;
      let v = pyramid.sample(landLevel, x, y);
      if (noisy && v > 0.5 - amp && v < 0.5 + amp) v += (fbm(seed, x / period, y / period, noiseOctaves) - 0.5) * 2 * amp;
      land[j * M + i] = v > 0.5 ? 1 : 0;
    }
  }

  // Smooth fields (stains, glow, shore darkening) are evaluated every LATTICE_STEP pixels and
  // interpolated: their detail is coarser than that, and evaluating them per pixel was most of the cost.
  const L = N / LATTICE_STEP + 1;
  const stains = new Float32Array(L * L);
  const glows = new Float32Array(L * L);
  const edges = new Float32Array(L * L);
  const reliefs = new Float32Array(L * L);
  const forests = new Float32Array(L * L);
  const reliefLevel = Math.max(0, Math.min(ctx.reliefPyramid.maxLevel, -key.level + 1));
  for (let b = 0; b < L; b++) {
    const y = (originY + 1 + b * LATTICE_STEP + 0.5) * cellsPerPx;
    for (let a = 0; a < L; a++) {
      const x = (originX + 1 + a * LATTICE_STEP + 0.5) * cellsPerPx;
      stains[b * L + a] = fbm(seed + 77, x / stainCells, y / stainCells, stainOctaves);
      glows[b * L + a] = pyramid.sample(glow, x, y);
      edges[b * L + a] = pyramid.sample(edgeLevel, x, y);
      reliefs[b * L + a] = ctx.reliefPyramid.sample(reliefLevel, x, y);
      forests[b * L + a] = ctx.forestPyramid.sample(reliefLevel, x, y);
    }
  }

  // Pass 2: colours.
  const [deepR, deepG, deepB] = VINTAGE.seaDeep;
  const [openR, openG, openB] = VINTAGE.seaOpen;
  const [shalR, shalG, shalB] = VINTAGE.seaShallow;
  const [parR, parG, parB] = VINTAGE.parchment;
  const [edgR, edgG, edgB] = VINTAGE.parchmentEdge;
  const [relR, relG, relB] = DRAWING_STYLE.reliefWash;
  const [forR, forG, forB] = DRAWING_STYLE.forestWash;
  const [inkR, inkG, inkB] = DRAWING_STYLE.ink;
  for (let j = 0; j < N; j++) {
    const py = originY + j + 1;
    const y = (py + 0.5) * cellsPerPx;
    for (let i = 0; i < N; i++) {
      const px = originX + i + 1;
      const x = (px + 0.5) * cellsPerPx;
      const o = (j * N + i) * 4;
      if (x < 0 || y < 0 || x >= widthCells || y >= heightCells) {
        out[o + 3] = 0;
        continue;
      }
      const m = (j + 1) * M + (i + 1);
      const sa = i / LATTICE_STEP;
      const sb = j / LATTICE_STEP;
      const a0 = sa | 0;
      const b0 = sb | 0;
      const k = b0 * L + a0;
      const fx = sa - a0;
      const fy = sb - b0;
      const stain = bilerp(stains, k, L, fx, fy);
      const grain = (hash2(seed, px, py) - 0.5) * VINTAGE.grainStrength * 255;
      let r: number;
      let g: number;
      let b: number;
      if (land[m]) {
        if (!land[m - 1] || !land[m + 1] || !land[m - M] || !land[m + M]) {
          out[o] = inkR;
          out[o + 1] = inkG;
          out[o + 2] = inkB;
          out[o + 3] = 255;
          continue;
        }
        const t = (1 - smoothstep(0.55, 1, bilerp(edges, k, L, fx, fy))) * 0.55;
        const shade = 1 + (stain - 0.5) * 2 * VINTAGE.landStainStrength;
        const u = bilerp(reliefs, k, L, fx, fy) * DRAWING_STYLE.reliefWashStrength;
        const f = bilerp(forests, k, L, fx, fy) * DRAWING_STYLE.forestWashStrength;
        r = (parR + (relR - parR) * u + (forR - parR) * f + (edgR - parR) * t) * shade;
        g = (parG + (relG - parG) * u + (forG - parG) * f + (edgG - parG) * t) * shade;
        b = (parB + (relB - parB) * u + (forB - parB) * f + (edgB - parB) * t) * shade;
      } else {
        const s = smoothstep(0.25, 0.75, stain);
        r = deepR + (openR - deepR) * s;
        g = deepG + (openG - deepG) * s;
        b = deepB + (openB - deepB) * s;
        const t = smoothstep(0.03, 0.5, bilerp(glows, k, L, fx, fy)) * 0.85;
        r += (shalR - r) * t;
        g += (shalG - g) * t;
        b += (shalB - b) * t;
      }
      out[o] = r + grain;
      out[o + 1] = g + grain;
      out[o + 2] = b + grain;
      out[o + 3] = 255;
    }
  }
}

function bilerp(values: Float32Array, k: number, rowLength: number, fx: number, fy: number): number {
  const top = values[k] + (values[k + 1] - values[k]) * fx;
  return top + (values[k + rowLength] + (values[k + rowLength + 1] - values[k + rowLength]) * fx - top) * fy;
}

function smoothstep(a: number, b: number, x: number): number {
  const t = x <= a ? 0 : x >= b ? 1 : (x - a) / (b - a);
  return t * t * (3 - 2 * t);
}
