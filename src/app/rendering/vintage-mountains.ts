import { hash2 } from '../domain/terrain/noise';
import { VINTAGE } from './style/vintage-style';

/** Floats per glyph in the packed array: baseX, baseY, width, height, variant. */
export const GLYPH_STRIDE = 5;

/** Levels of detail precomputed by the worker (0 = whole-map view). */
export const MOUNTAIN_LEVELS = 4;

export interface MountainInput {
  readonly altitudeM: Int16Array;
  readonly widthCells: number;
  readonly heightCells: number;
  readonly seaLevelM: number;
  /** 1 = sea (computeSeaMask): inland cells below sea level are land. */
  readonly sea: Uint8Array;
  readonly seed: number;
}

/**
 * Where to draw mountain glyphs, and how big. Deterministic (seed + position),
 * so glyphs never jump between renders.
 *
 * 1. Candidates on a jittered grid (one per grid square, at a hashed offset):
 *    regular enough to cover a range evenly, irregular enough not to look
 *    like a pattern.
 * 2. Each candidate looks at the terrain under its glyph footprint: the
 *    highest point (`peak`) and the local relief (`peak − lowest`). A score
 *    mixes both: high AND rugged → mountain; a high flat plateau or a low
 *    rugged coast scores less.
 * 3. The glyph is kept with a probability rising with the score, and pulled
 *    halfway towards the local summit, so glyphs line up along the ridges.
 *
 * Returns glyphs sorted by base y: drawn in that order, nearer (lower)
 * mountains overlap farther ones, as in a 3/4 view.
 * Coordinates are in cells (base centre of the glyph).
 *
 * `level` = level of detail: each level halves the glyph size (and spacing),
 * so zooming in shows more, smaller mountains instead of giant ones.
 */
export function placeMountains(input: MountainInput, level = 0): Float32Array<ArrayBuffer> {
  const { widthCells: w, heightCells: h, sea, seed } = input;
  const glyphW = mountainWidthCells(w, h, level);
  const salt = level * 0x9e37;
  const spacing = glyphW * VINTAGE.mountainSpacing;
  const radius = Math.max(1, Math.round(glyphW / 2));
  const glyphs: number[][] = [];

  for (let gy = 0; gy * spacing < h; gy++) {
    for (let gx = 0; gx * spacing < w; gx++) {
      let cx = Math.floor((gx + hash2(seed ^ 0x1f3a ^ salt, gx, gy)) * spacing);
      let cy = Math.floor((gy + hash2(seed ^ 0x2b7c ^ salt, gx, gy)) * spacing);
      if (cx >= w || cy >= h || sea[cy * w + cx]) continue;

      const site = mountainSite(input, cx, cy, radius);
      const score = site.score;
      const keep = smoothstep(VINTAGE.mountainScoreFrom, VINTAGE.mountainScoreTo, score);
      if (hash2(seed ^ 0x3c5d ^ salt, gx, gy) >= keep) continue;

      // Halfway to the summit; the glyph's base sits below its peak.
      cx = (cx + site.peakX) / 2 + 0.5;
      cy = (cy + site.peakY) / 2 + 0.5;
      const size = glyphW * (0.55 + 0.6 * score) * (0.85 + 0.3 * hash2(seed ^ 0x4e6f ^ salt, gx, gy));
      const height = size * (0.38 + 0.3 * score);
      const baseY = cy + height * 0.45;
      // The glyph must not stand in the sea.
      const bx = Math.min(w - 1, Math.round(cx));
      const by = Math.min(h - 1, Math.round(baseY));
      if (sea[by * w + bx]) continue;
      glyphs.push([cx, baseY, size, height, hash2(seed ^ 0x5a1b ^ salt, gx, gy)]);
    }
  }

  glyphs.sort((a, b) => a[1] - b[1]);
  const out = new Float32Array(glyphs.length * GLYPH_STRIDE);
  glyphs.forEach((g, i) => out.set(g, i * GLYPH_STRIDE));
  return out;
}

/** Mountain glyph base width at a level of detail, in cells. */
export function mountainWidthCells(widthCells: number, heightCells: number, level: number): number {
  return Math.max(2, (Math.max(widthCells, heightCells) * VINTAGE.mountainWidthFraction) / 2 ** level);
}

/**
 * How "mountain" the square of half-side `radius` around (cx, cy) is:
 * ½ peak height + ½ local relief, each ramped to [0, 1]. Also returns where
 * the summit is. Shared with forest placement (no trees under mountains).
 */
export function mountainSite(input: MountainInput, cx: number, cy: number, radius: number): { score: number; peakX: number; peakY: number } {
  const { altitudeM, widthCells: w, heightCells: h, seaLevelM } = input;
  let peak = -Infinity;
  let low = Infinity;
  let peakX = cx;
  let peakY = cy;
  for (let y = Math.max(0, cy - radius); y <= Math.min(h - 1, cy + radius); y++) {
    for (let x = Math.max(0, cx - radius); x <= Math.min(w - 1, cx + radius); x++) {
      const a = altitudeM[y * w + x];
      if (a > peak) {
        peak = a;
        peakX = x;
        peakY = y;
      }
      if (a < low) low = a;
    }
  }
  low = Math.max(low, seaLevelM);
  const score =
    0.5 * clamp01((peak - seaLevelM - VINTAGE.mountainMinPeakM) / VINTAGE.mountainFullPeakM) +
    0.5 * clamp01((peak - low - VINTAGE.mountainMinReliefM) / VINTAGE.mountainFullReliefM);
  return { score, peakX, peakY };
}

/**
 * Pen-drawn mountain in 3/4 view, light from the north-west (as the editor's
 * hillshade): the left flank stays light, the right flank is shaded and
 * hatched. The fill fades out towards the base, so the foot of the mountain
 * melts into the land and a nearer glyph only hides the top of the one behind.
 *
 * Each flank is a jittered polyline (a hand never draws a straight slope);
 * the jitter comes from the glyph's variant, so it is the same every frame.
 * `x, y` = base centre on screen, `w, h` = size in px, `v` ∈ [0, 1) = variant.
 */
export function drawMountainGlyph(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, v: number): void {
  let state = Math.floor(v * 0x7fffffff) || 1;
  const rand = (): number => {
    state = (Math.imul(state, 48271) % 0x7fffffff) >>> 0; // Park–Miller: tiny deterministic PRNG
    return state / 0x7fffffff;
  };
  const half = w / 2;
  const peakX = x + (rand() - 0.5) * w * 0.25;
  const peakY = y - h;
  const flank = (toX: number, steps: number): [number, number][] => {
    const pts: [number, number][] = [];
    for (let k = 1; k < steps; k++) {
      const t = k / steps;
      // Concave-ish slope (steep near the top), jittered across the slope.
      const tt = t * (0.85 + 0.3 * rand());
      pts.push([peakX + (toX - peakX) * tt + (rand() - 0.5) * w * 0.06, peakY + h * Math.pow(t, 0.8) - rand() * h * 0.08]);
    }
    pts.push([toX, y]);
    return pts;
  };
  const left = flank(x - half, 4).reverse(); // base → peak order once reversed below
  const right = flank(x + half, 4);
  const ridgeFootX = x + (peakX - x) * 0.3 + w * (0.06 + 0.08 * rand());

  const fade = (color: string) => {
    const g = ctx.createLinearGradient(0, peakY, 0, y);
    g.addColorStop(0, color);
    g.addColorStop(0.55, color);
    g.addColorStop(1, 'rgb(0 0 0 / 0)');
    return g;
  };
  const outline = () => {
    ctx.moveTo(left[0][0], left[0][1]);
    for (const [px, py] of left) ctx.lineTo(px, py);
    ctx.lineTo(peakX, peakY);
    for (const [px, py] of right) ctx.lineTo(px, py);
  };

  ctx.beginPath();
  outline();
  ctx.closePath();
  ctx.fillStyle = fade(VINTAGE.mountainLit);
  ctx.fill();

  // Shaded flank: between the ridge line and the right outline.
  ctx.beginPath();
  ctx.moveTo(peakX, peakY);
  for (const [px, py] of right) ctx.lineTo(px, py);
  ctx.lineTo(ridgeFootX, y);
  ctx.closePath();
  ctx.fillStyle = fade(VINTAGE.mountainShade);
  ctx.fill();

  ctx.strokeStyle = VINTAGE.ink;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  // Hatching on the shaded flank: strokes from the ridge, down along the slope.
  const hatches = Math.max(2, Math.min(8, Math.round(w / 4)));
  ctx.lineWidth = Math.max(0.5, Math.min(0.9, w / 36));
  ctx.beginPath();
  for (let k = 1; k <= hatches; k++) {
    const t = (k - 0.3 + 0.6 * rand()) / (hatches + 1);
    const sx = peakX + (ridgeFootX - peakX) * t;
    const sy = peakY + (y - peakY) * t;
    const room = x + half - sx;
    const len = Math.min(room * (0.3 + 0.4 * rand()), (y - sy) * 1.2);
    ctx.moveTo(sx + 0.5, sy + 0.5);
    ctx.lineTo(sx + len * 0.55, sy + len * 0.8);
  }
  ctx.stroke();

  // Outline (open at the base, like a pen sketch) and ridge, fading at the foot.
  ctx.lineWidth = Math.max(0.7, Math.min(1.4, w / 18));
  ctx.beginPath();
  outline();
  ctx.moveTo(peakX, peakY);
  ctx.quadraticCurveTo(peakX + (ridgeFootX - peakX) * 0.2, peakY + h * 0.5, ridgeFootX, y - h * 0.15);
  ctx.strokeStyle = fade(VINTAGE.ink);
  ctx.stroke();
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

export function smoothstep(from: number, to: number, v: number): number {
  const t = clamp01((v - from) / (to - from));
  return t * t * (3 - 2 * t);
}
