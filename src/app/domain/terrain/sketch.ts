import { chamferDistance } from './distance-field';
import { fbm } from './noise';

/**
 * Turning a drawn map (photo, scan, painting) into a first draft of terrain.
 *
 * An image has no altitudes: we only RECOVER the land/sea shape, then
 * INVENT a plausible relief from it:
 *   - land rises slowly with the distance to the coast;
 *   - where the drawing is dense with ink inside the land (mountain glyphs,
 *     hatching), we raise mountains;
 *   - the sea floor deepens with the distance to land;
 *   - fractal noise breaks the regularity.
 * The user then retouches with the brushes.
 */

/** RGBA pixels of the drawing, row-major. */
export interface SketchImage {
  readonly rgba: Uint8ClampedArray;
  readonly width: number;
  readonly height: number;
}

export interface SketchPoint {
  readonly x: number;
  readonly y: number;
}

export type SketchMode = 'colour' | 'lineart';

/** Sea and land samples closer than this (RGB distance) = same paper: a line drawing. */
const LINEART_MAX_COLOUR_DISTANCE = 40;
/** Line art: a pixel darker than this fraction of the paper's luminance is ink. */
const INK_LUMINANCE_RATIO = 0.6;
/** Colour maps: a pixel farther from both samples than this fraction of their distance is neither (ink, text). */
const UNKNOWN_DISTANCE_RATIO = 0.6;

const luminance = (r: number, g: number, b: number) => 0.299 * r + 0.587 * g + 0.114 * b;

/** Mean colour of a 5 × 5 patch around `p` (a click is not pixel-precise). */
export function sampleColour(image: SketchImage, p: SketchPoint): [number, number, number] {
  let r = 0;
  let g = 0;
  let b = 0;
  let n = 0;
  for (let y = Math.max(0, Math.round(p.y) - 2); y <= Math.min(image.height - 1, Math.round(p.y) + 2); y++) {
    for (let x = Math.max(0, Math.round(p.x) - 2); x <= Math.min(image.width - 1, Math.round(p.x) + 2); x++) {
      const o = (y * image.width + x) * 4;
      r += image.rgba[o];
      g += image.rgba[o + 1];
      b += image.rgba[o + 2];
      n++;
    }
  }
  return [r / n, g / n, b / n];
}

export function detectSketchMode(image: SketchImage, sea: SketchPoint, land: SketchPoint): SketchMode {
  const s = sampleColour(image, sea);
  const l = sampleColour(image, land);
  return Math.hypot(s[0] - l[0], s[1] - l[1], s[2] - l[2]) < LINEART_MAX_COLOUR_DISTANCE ? 'lineart' : 'colour';
}

/**
 * Per image pixel: 1 = sea, 0 = land, 2 = unknown (ink or text on a colour map).
 *
 * - Colour map: each pixel goes to the nearest of the two sampled colours
 *   (sea blue vs land beige), unless it is far from both.
 * - Line drawing: sea and land are the same paper, only the coastline
 *   separates them. We flood-fill from the sea click through paper pixels;
 *   ink stops the fill. Ink is first thickened by 1 pixel (dilation) so that
 *   a coastline with tiny gaps still holds the water back.
 *   Only the sea connected to the click is found (an enclosed inland sea
 *   stays land, for now).
 */
export function sketchSeaMask(image: SketchImage, sea: SketchPoint, land: SketchPoint): Uint8Array {
  const { width: w, height: h, rgba } = image;
  const n = w * h;
  const mask = new Uint8Array(n);
  const seaRgb = sampleColour(image, sea);
  const landRgb = sampleColour(image, land);

  if (detectSketchMode(image, sea, land) === 'colour') {
    const between = Math.hypot(seaRgb[0] - landRgb[0], seaRgb[1] - landRgb[1], seaRgb[2] - landRgb[2]);
    for (let i = 0; i < n; i++) {
      const o = i * 4;
      const dSea = Math.hypot(rgba[o] - seaRgb[0], rgba[o + 1] - seaRgb[1], rgba[o + 2] - seaRgb[2]);
      const dLand = Math.hypot(rgba[o] - landRgb[0], rgba[o + 1] - landRgb[1], rgba[o + 2] - landRgb[2]);
      mask[i] = Math.min(dSea, dLand) > between * UNKNOWN_DISTANCE_RATIO ? 2 : dSea < dLand ? 1 : 0;
    }
    return mask;
  }

  const inkBelow = luminance(...seaRgb) * INK_LUMINANCE_RATIO;
  const ink = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    const o = i * 4;
    if (luminance(rgba[o], rgba[o + 1], rgba[o + 2]) < inkBelow) ink[i] = 1;
  }
  // Dilation: a pixel next to ink becomes a wall too.
  const wall = new Uint8Array(n);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      wall[i] = ink[i] | (x > 0 ? ink[i - 1] : 0) | (x < w - 1 ? ink[i + 1] : 0) | (y > 0 ? ink[i - w] : 0) | (y < h - 1 ? ink[i + w] : 0);
    }
  }
  // Flood fill (explicit stack, 4-connected): recursion would overflow on big images.
  const start = Math.round(sea.y) * w + Math.round(sea.x);
  if (wall[start]) return mask; // clicked on a line: nothing to fill
  const stack = new Int32Array(n);
  let top = 0;
  stack[top++] = start;
  mask[start] = 1;
  while (top > 0) {
    const i = stack[--top];
    const x = i % w;
    // Each pixel is pushed at most once (marked when pushed), so the stack never exceeds n.
    if (x > 0 && !mask[i - 1] && !wall[i - 1]) { mask[i - 1] = 1; stack[top++] = i - 1; }
    if (x < w - 1 && !mask[i + 1] && !wall[i + 1]) { mask[i + 1] = 1; stack[top++] = i + 1; }
    if (i >= w && !mask[i - w] && !wall[i - w]) { mask[i - w] = 1; stack[top++] = i - w; }
    if (i + w < n && !mask[i + w] && !wall[i + w]) { mask[i + w] = 1; stack[top++] = i + w; }
  }
  // The coastline ink itself: unknown (the cell's majority decides).
  for (let i = 0; i < n; i++) if (!mask[i] && ink[i]) mask[i] = 2;
  return mask;
}

export interface SketchTerrainOptions {
  readonly widthCells: number;
  readonly heightCells: number;
  readonly cellKm: number;
  readonly seaLevelM: number;
  readonly seed: number;
}

/** Relief recipe (metres, km). Plausible, not realistic: a draft to retouch. */
const LOWLAND_MAX_M = 350;
const LOWLAND_RISE_KM = 60;
const LAND_NOISE_M = 300;
const MOUNTAIN_BASE_M = 1200;
const MOUNTAIN_EXTRA_M = 1800;
const SEA_SHELF_M = 30;
const SEA_DEPTH_M = 2500;
const SEA_DEEPEN_KM = 80;
/** Sea patches smaller than this fraction of the map (and not the clicked sea) become land. */
const SMALL_LAKE_FRACTION = 0.0005;
/** Land specks smaller than this fraction of the map become sea. */
const SMALL_ISLAND_FRACTION = 0.00002;
/** Ink density (fraction of darkened land) from no mountain to full mountain. */
const INK_NONE = 0.04;
const INK_FULL = 0.2;

/**
 * Row-major altitudes (m) for the target grid.
 *
 * Each grid cell averages the image pixels that fall in it: the sea fraction
 * (sea if > ½ of the known pixels) and the ink density on land (how much
 * darker than the land colour, on average). Ink right at the coast is the
 * coastline itself, not mountains, so it is faded out over the first cells.
 */
export function sketchToAltitude(
  image: SketchImage,
  mask: Uint8Array,
  sea: SketchPoint,
  land: SketchPoint,
  options: SketchTerrainOptions,
): Int16Array {
  const { widthCells: w, heightCells: h, cellKm, seaLevelM, seed } = options;
  const n = w * h;
  const seaCount = new Float32Array(n);
  const knownCount = new Float32Array(n);
  const darkness = new Float32Array(n);
  const pixelCount = new Float32Array(n);
  const landLum = luminance(...sampleColour(image, land));
  const sx = w / image.width;
  const sy = h / image.height;

  for (let y = 0; y < image.height; y++) {
    const cy = Math.min(h - 1, Math.floor(y * sy));
    for (let x = 0; x < image.width; x++) {
      const c = cy * w + Math.min(w - 1, Math.floor(x * sx));
      const i = y * image.width + x;
      const o = i * 4;
      pixelCount[c]++;
      if (mask[i] !== 2) {
        knownCount[c]++;
        if (mask[i] === 1) seaCount[c]++;
      }
      darkness[c] += Math.max(0, Math.min(1, (landLum - luminance(image.rgba[o], image.rgba[o + 1], image.rgba[o + 2])) / (landLum * 0.7)));
    }
  }

  // Cells that received no pixel (grid finer than the image): nearest pixel.
  const isSea = new Uint8Array(n);
  const ink = new Float32Array(n);
  for (let cy = 0; cy < h; cy++) {
    for (let cx = 0; cx < w; cx++) {
      const c = cy * w + cx;
      if (pixelCount[c] > 0) {
        isSea[c] = knownCount[c] > 0 && seaCount[c] / knownCount[c] > 0.5 ? 1 : 0;
        ink[c] = darkness[c] / pixelCount[c];
      } else {
        const px = Math.min(image.width - 1, Math.floor((cx + 0.5) / sx));
        const py = Math.min(image.height - 1, Math.floor((cy + 0.5) / sy));
        isSea[c] = mask[py * image.width + px] === 1 ? 1 : 0;
      }
    }
  }

  // Clean-up: drawn trees, glyphs or text read as specks of the wrong class.
  const seaCell = Math.min(h - 1, Math.floor(sea.y * sy)) * w + Math.min(w - 1, Math.floor(sea.x * sx));
  fillSmallComponents(isSea, w, h, 1, Math.max(4, n * SMALL_LAKE_FRACTION), seaCell); // holes in the land → land
  fillSmallComponents(isSea, w, h, 0, Math.max(2, n * SMALL_ISLAND_FRACTION), -1); // specks in the sea → sea

  const landMask = new Uint8Array(n);
  for (let c = 0; c < n; c++) landMask[c] = isSea[c] ? 0 : 1;
  const toSea = chamferDistance(landMask, w, h);
  const toLand = chamferDistance(isSea, w, h);

  for (let c = 0; c < n; c++) ink[c] *= smoothstep(1.5, 4, toSea[c]);
  const blurRadius = Math.max(1, Math.round(Math.max(w, h) * 0.006));
  const mountains = boxBlur(boxBlur(ink, w, h, blurRadius), w, h, blurRadius);

  const side = Math.max(w, h);
  const out = new Int16Array(n);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const c = y * w + x;
      const broad = fbm(seed, (x / side) * 6, (y / side) * 6, 4) - 0.5;
      if (isSea[c]) {
        const km = toLand[c] * cellKm;
        const depth = SEA_SHELF_M + SEA_DEPTH_M * (1 - Math.exp(-km / SEA_DEEPEN_KM)) + broad * 400;
        out[c] = Math.min(seaLevelM - 1, Math.round(seaLevelM - depth));
      } else {
        const km = toSea[c] * cellKm;
        const m = smoothstep(INK_NONE, INK_FULL, mountains[c]);
        const ridges = fbm(seed ^ 0x51ed, (x / side) * 40, (y / side) * 40, 4);
        const altitude =
          5 +
          LOWLAND_MAX_M * (1 - Math.exp(-km / LOWLAND_RISE_KM)) +
          broad * LAND_NOISE_M * Math.min(1, km / 20) +
          m * (MOUNTAIN_BASE_M + MOUNTAIN_EXTRA_M * ridges);
        out[c] = Math.max(seaLevelM + 1, Math.min(32767, Math.round(seaLevelM + altitude)));
      }
    }
  }
  return out;
}

/**
 * Connected components: flood-fills each 4-connected region of `value`
 * cells; a region smaller than `minArea` cells (and not containing
 * `keepCell`) is flipped to the other value. In place.
 */
export function fillSmallComponents(cells: Uint8Array, w: number, h: number, value: 0 | 1, minArea: number, keepCell: number): void {
  const n = w * h;
  const seen = new Uint8Array(n);
  const region = new Int32Array(n);
  for (let start = 0; start < n; start++) {
    if (seen[start] || cells[start] !== value) continue;
    let size = 0;
    let head = 0;
    let keep = false;
    region[size++] = start;
    seen[start] = 1;
    while (head < size) {
      const i = region[head++];
      if (i === keepCell) keep = true;
      const x = i % w;
      if (x > 0 && !seen[i - 1] && cells[i - 1] === value) { seen[i - 1] = 1; region[size++] = i - 1; }
      if (x < w - 1 && !seen[i + 1] && cells[i + 1] === value) { seen[i + 1] = 1; region[size++] = i + 1; }
      if (i >= w && !seen[i - w] && cells[i - w] === value) { seen[i - w] = 1; region[size++] = i - w; }
      if (i + w < n && !seen[i + w] && cells[i + w] === value) { seen[i + w] = 1; region[size++] = i + w; }
    }
    if (!keep && size < minArea) for (let k = 0; k < size; k++) cells[region[k]] = value === 1 ? 0 : 1;
  }
}

/** Separable box blur (mean over a (2r+1)² square), edges clamped. Twice ≈ a Gaussian. */
export function boxBlur(src: Float32Array, w: number, h: number, r: number): Float32Array {
  const tmp = new Float32Array(src.length);
  const out = new Float32Array(src.length);
  const span = 2 * r + 1;
  for (let y = 0; y < h; y++) {
    let sum = 0;
    for (let k = -r; k <= r; k++) sum += src[y * w + Math.min(w - 1, Math.max(0, k))];
    for (let x = 0; x < w; x++) {
      tmp[y * w + x] = sum / span;
      sum += src[y * w + Math.min(w - 1, x + r + 1)] - src[y * w + Math.max(0, x - r)];
    }
  }
  for (let x = 0; x < w; x++) {
    let sum = 0;
    for (let k = -r; k <= r; k++) sum += tmp[Math.min(h - 1, Math.max(0, k)) * w + x];
    for (let y = 0; y < h; y++) {
      out[y * w + x] = sum / span;
      sum += tmp[Math.min(h - 1, y + r + 1) * w + x] - tmp[Math.max(0, y - r) * w + x];
    }
  }
  return out;
}

function smoothstep(from: number, to: number, v: number): number {
  const t = Math.max(0, Math.min(1, (v - from) / (to - from)));
  return t * t * (3 - 2 * t);
}
