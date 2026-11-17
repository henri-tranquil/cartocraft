import { fbm, hash2 } from '../domain/terrain/noise';
import { VINTAGE } from './style/vintage-style';
import { VintageClimate } from './vintage-climate';
import { MountainInput, mountainSite, mountainWidthCells, smoothstep } from './vintage-mountains';

/** Floats per tree: baseX, baseY, size, variant, kind (0 = broadleaf, 1 = conifer). */
export const TREE_STRIDE = 5;

/**
 * Where to draw trees. Same jittered-grid idea as the mountains, with a
 * density driven by the climate (continuous fields, no biome):
 *
 *   density = wet enough × warm enough summer × "patch" noise
 *
 * - wet enough: yearly wetness from FOREST_DRY to FOREST_WET %;
 * - warm enough: the warmest month must pass ~10 °C (the real tree line
 *   follows summer warmth, not the yearly mean);
 * - patches: a low-frequency noise thresholded into blobs, so trees come in
 *   clumps (woods) rather than as a uniform sprinkle. Its scale is tied to
 *   the map, not to the level of detail: zooming in densifies the same woods.
 *
 * No tree where a mountain glyph could stand. The yearly mean temperature
 * (and altitude) picks conifers over broadleaf trees.
 * Sorted by base y (back to front).
 */
export function placeForests(input: MountainInput, climate: VintageClimate | null, level = 0): Float32Array<ArrayBuffer> {
  if (!climate) return new Float32Array(0);
  const { widthCells: w, heightCells: h, sea, seed } = input;
  const mountainW = mountainWidthCells(w, h, level);
  const radius = Math.max(1, Math.round(mountainW / 2));
  const treeW = Math.max(1, mountainW * VINTAGE.treeWidthRatio);
  const spacing = treeW * VINTAGE.treeSpacing;
  const patchScale = 1 / Math.max(1, Math.max(w, h) * VINTAGE.forestPatchFraction);
  const salt = level * 0x7f4a;
  const trees: number[][] = [];

  for (let gy = 0; gy * spacing < h; gy++) {
    for (let gx = 0; gx * spacing < w; gx++) {
      const x = (gx + hash2(seed ^ 0x6a11 ^ salt, gx, gy)) * spacing;
      const y = (gy + hash2(seed ^ 0x6b22 ^ salt, gx, gy)) * spacing;
      const cx = Math.floor(x);
      const cy = Math.floor(y);
      if (cx >= w || cy >= h) continue;
      const i = cy * w + cx;
      if (sea[i]) continue;

      const patch = smoothstep(VINTAGE.forestPatchFrom, VINTAGE.forestPatchTo, fbm(seed ^ 0x7c33, x * patchScale, y * patchScale, 3));
      const wet = smoothstep(VINTAGE.forestDryPct, VINTAGE.forestWetPct, climate.wetnessPct[i]);
      const warm = smoothstep(VINTAGE.treeLineC, VINTAGE.treeFullC, climate.warmestDeciC[i] / 10);
      const density = patch * wet * warm;
      if (hash2(seed ^ 0x6c44 ^ salt, gx, gy) >= density) continue;
      if (mountainSite(input, cx, cy, radius).score >= VINTAGE.mountainScoreFrom) continue;

      const meanC = climate.meanDeciC[i] / 10;
      const conifer = 1 - smoothstep(VINTAGE.coniferBelowC, VINTAGE.broadleafAboveC, meanC);
      const kind = hash2(seed ^ 0x6d55 ^ salt, gx, gy) < conifer ? 1 : 0;
      const size = treeW * (0.8 + 0.4 * hash2(seed ^ 0x6e66 ^ salt, gx, gy));
      trees.push([x, y, size, hash2(seed ^ 0x6f77 ^ salt, gx, gy), kind]);
    }
  }

  trees.sort((a, b) => a[1] - b[1]);
  const out = new Float32Array(trees.length * TREE_STRIDE);
  trees.forEach((t, i) => out.set(t, i * TREE_STRIDE));
  return out;
}

/**
 * One tree, base at (x, y) on screen, `s` px tall. Light from the north-west:
 * the lower-right part of the crown is in shade. Broadleaf = round crown on a
 * short trunk; conifer = narrow triangle.
 */
export function drawTreeGlyph(ctx: CanvasRenderingContext2D, x: number, y: number, s: number, v: number, kind: number): void {
  const line = Math.max(0.5, Math.min(1, s / 14));
  ctx.lineWidth = line;
  ctx.strokeStyle = VINTAGE.ink;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';

  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.lineTo(x, y - s * 0.3);
  ctx.strokeStyle = VINTAGE.trunk;
  ctx.stroke();
  ctx.strokeStyle = VINTAGE.ink;

  if (kind === 1) {
    const half = s * (0.24 + 0.08 * v);
    const top = y - s * 1.05;
    const base = y - s * 0.18;
    ctx.beginPath();
    ctx.moveTo(x, top);
    ctx.lineTo(x + half, base);
    ctx.lineTo(x - half, base);
    ctx.closePath();
    ctx.fillStyle = VINTAGE.needleShade;
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(x, top);
    ctx.lineTo(x + half * 0.15, base);
    ctx.lineTo(x - half, base);
    ctx.closePath();
    ctx.fillStyle = VINTAGE.needle;
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(x, top);
    ctx.lineTo(x + half, base);
    ctx.lineTo(x - half, base);
    ctx.closePath();
    ctx.stroke();
    return;
  }

  const r = s * (0.33 + 0.07 * v);
  const cx = x;
  const cy = y - s * 0.62;
  ctx.beginPath();
  ctx.ellipse(cx, cy, r, r * 0.9, 0, 0, Math.PI * 2);
  ctx.fillStyle = VINTAGE.leafShade;
  ctx.fill();
  ctx.beginPath();
  ctx.ellipse(cx - r * 0.18, cy - r * 0.16, r * 0.78, r * 0.7, 0, 0, Math.PI * 2);
  ctx.fillStyle = VINTAGE.leaf;
  ctx.fill();
  ctx.beginPath();
  ctx.ellipse(cx, cy, r, r * 0.9, 0, 0, Math.PI * 2);
  ctx.stroke();
}
