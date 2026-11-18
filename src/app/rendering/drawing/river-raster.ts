import { DrawnRiver, mouthLengthKm, mouthShape, riverEnd, riverFlowsKm } from '../../domain/drawing/drawn-river';
import { fbm } from '../../domain/terrain/noise';
import { Int16TiledGrid } from '../../domain/terrain/tiled-grid';
import { chaikin } from '../river-layer';
import { drawnRiverWidthKm, DRAWN_RIVER_STYLE } from './drawn-river-layer';

/**
 * Drawn rivers as WATER in the drawing tiles, not as lines over them.
 *
 * The coast looks organic because it is a threshold on a SOFT land
 * coverage, bitten by noise. Rivers get the same treatment: for every pixel
 * near a river, a soft "water coverage" is computed from its distance to the
 * river's centre line minus the local half-width, then the tile renderer
 * thresholds it with the very noise of the coast. The softness (ramp) grows
 * with the width: wide reaches get the jagged banks of a coast, thin ones
 * stay continuous.
 */
export const RIVER_BANKS = {
  /** Thinnest water drawn (device px), whatever the zoom: thinner would vanish between its two ink banks. Widths are otherwise in km. */
  minWidthPx: 1.3,
  /** Slow swelling of the width along the course (±, fraction), period in km. */
  swell: 0.25,
  swellPeriodKm: 20,
  /** Softness of the banks = this × half-width, at most `maxRampCells` cells: the coast noise bites into it. */
  rampPerHalfWidth: 1.1,
  maxRampCells: 3,
} as const;

/** Centre segments with their half-widths at both ends, bucketed on a coarse grid. */
export interface RiverShapes {
  readonly cellPx: number;
  readonly buckets: Map<string, number[]>;
  /** Flat ax, ay, bx, by, halfA, halfB, ramp per segment (level px). */
  readonly segments: Float32Array;
  readonly empty: boolean;
}

const STRIDE = 7;
const BUCKET_PX = 32;

export function buildRiverShapes(rivers: readonly DrawnRiver[], drawing: Int16TiledGrid, cellKm: number, level: number, seed: number): RiverShapes {
  const pxPerKm = 2 ** level / cellKm;
  const cellPx = 2 ** level;
  const flows = riverFlowsKm(rivers);
  const segments: number[] = [];

  for (const river of rivers) {
    const p = river.pointsKm;
    const n = p.length / 2;
    const flow = flows.get(river.id) ?? new Float64Array(n);
    const upstreamKm = flow[n - 1];
    const shape = mouthShape(river, upstreamKm, riverEnd(river, rivers, drawing, cellKm));
    const arc: number[] = [0];
    for (let i = 1; i < n; i++) arc.push(arc[i - 1] + Math.hypot(p[2 * i] - p[2 * i - 2], p[2 * i + 1] - p[2 * i - 1]));
    const total = arc[n - 1];
    const ws = Array.from(flow, (f) => drawnRiverWidthKm(f) * pxPerKm);
    if (shape === 'estuary') {
      const from = total - Math.min(mouthLengthKm(upstreamKm), total * 0.5);
      for (let i = 0; i < n; i++) ws[i] *= 1 + DRAWN_RIVER_STYLE.estuaryFlare * smoothstep(from, total, arc[i]);
    }
    const xs: number[] = [];
    const ys: number[] = [];
    for (let i = 0; i < n; i++) {
      xs.push(p[2 * i] * pxPerKm);
      ys.push(p[2 * i + 1] * pxPerKm);
    }
    const a = chaikin(xs, ys, arc, 3);
    const w = chaikin(xs, ys, ws, 3).vs;
    const salt = hashId(river.id) % 997;
    const half = (i: number) => {
      const swell = 1 + RIVER_BANKS.swell * (fbm(seed ^ 0x51, a.vs[i] / RIVER_BANKS.swellPeriodKm, salt, 2) - 0.5) * 2;
      return Math.max(RIVER_BANKS.minWidthPx, w[i] * swell) / 2;
    };
    let previous = half(0);
    for (let i = 1; i < a.xs.length; i++) {
      const h = half(i);
      const ramp = Math.max(0.75, Math.min(RIVER_BANKS.maxRampCells * cellPx, RIVER_BANKS.rampPerHalfWidth * Math.min(previous, h)));
      segments.push(a.xs[i - 1], a.ys[i - 1], a.xs[i], a.ys[i], previous, h, ramp);
      previous = h;
    }
  }

  const buckets = new Map<string, number[]>();
  for (let s = 0; s < segments.length; s += STRIDE) {
    const r = Math.max(segments[s + 4], segments[s + 5]) + segments[s + 6] + 1;
    const bx0 = Math.floor((Math.min(segments[s], segments[s + 2]) - r) / BUCKET_PX);
    const bx1 = Math.floor((Math.max(segments[s], segments[s + 2]) + r) / BUCKET_PX);
    const by0 = Math.floor((Math.min(segments[s + 1], segments[s + 3]) - r) / BUCKET_PX);
    const by1 = Math.floor((Math.max(segments[s + 1], segments[s + 3]) + r) / BUCKET_PX);
    for (let by = by0; by <= by1; by++) {
      for (let bx = bx0; bx <= bx1; bx++) {
        const key = `${bx},${by}`;
        const list = buckets.get(key);
        if (list) list.push(s);
        else buckets.set(key, [s]);
      }
    }
  }
  return { cellPx: BUCKET_PX, buckets, segments: Float32Array.from(segments), empty: segments.length === 0 };
}

/**
 * Soft water coverage (0..1, `size`² px, row-major) of the area whose
 * top-left pixel is (originX, originY): 1 well inside a river bed, 0 away
 * from it, a ramp across the banks. Null when no river is near.
 */
export function waterCoverage(shapes: RiverShapes, originX: number, originY: number, size: number): Float32Array | null {
  if (shapes.empty) return null;
  const { buckets, segments } = shapes;
  let out: Float32Array | null = null;
  const bx0 = Math.floor(originX / BUCKET_PX);
  const by0 = Math.floor(originY / BUCKET_PX);
  const bx1 = Math.floor((originX + size - 1) / BUCKET_PX);
  const by1 = Math.floor((originY + size - 1) / BUCKET_PX);
  for (let by = by0; by <= by1; by++) {
    for (let bx = bx0; bx <= bx1; bx++) {
      const list = buckets.get(`${bx},${by}`);
      if (!list) continue;
      out ??= new Float32Array(size * size);
      const px0 = Math.max(originX, bx * BUCKET_PX);
      const py0 = Math.max(originY, by * BUCKET_PX);
      const px1 = Math.min(originX + size, (bx + 1) * BUCKET_PX);
      const py1 = Math.min(originY + size, (by + 1) * BUCKET_PX);
      for (let py = py0; py < py1; py++) {
        const y = py + 0.5;
        for (let px = px0; px < px1; px++) {
          const x = px + 0.5;
          let best = 0;
          for (const s of list) {
            const ax = segments[s];
            const ay = segments[s + 1];
            const dx = segments[s + 2] - ax;
            const dy = segments[s + 3] - ay;
            const len2 = dx * dx + dy * dy;
            let t = len2 > 0 ? ((x - ax) * dx + (y - ay) * dy) / len2 : 0;
            t = t < 0 ? 0 : t > 1 ? 1 : t;
            const ex = ax + dx * t - x;
            const ey = ay + dy * t - y;
            const h = segments[s + 4] + (segments[s + 5] - segments[s + 4]) * t;
            // Signed distance to the bank (negative inside), over the ramp, centred on ½.
            const c = 0.5 - (Math.sqrt(ex * ex + ey * ey) - h) / segments[s + 6];
            if (c > best) best = c >= 1 ? 1 : c;
          }
          out[(py - originY) * size + (px - originX)] = best;
        }
      }
    }
  }
  return out;
}

/** Is the point (level px) in a river bed, give or take `marginPx`? Glyphs are not planted in water. */
export function inRiver(shapes: RiverShapes, x: number, y: number, marginPx: number): boolean {
  const list = shapes.buckets.get(`${Math.floor(x / BUCKET_PX)},${Math.floor(y / BUCKET_PX)}`);
  if (!list) return false;
  const segments = shapes.segments;
  for (const s of list) {
    const ax = segments[s];
    const ay = segments[s + 1];
    const dx = segments[s + 2] - ax;
    const dy = segments[s + 3] - ay;
    const len2 = dx * dx + dy * dy;
    const t = len2 > 0 ? Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / len2)) : 0;
    const h = segments[s + 4] + (segments[s + 5] - segments[s + 4]) * t;
    if (Math.hypot(ax + dx * t - x, ay + dy * t - y) < h + marginPx) return true;
  }
  return false;
}

function smoothstep(a: number, b: number, x: number): number {
  const t = x <= a ? 0 : x >= b ? 1 : (x - a) / (b - a);
  return t * t * (3 - 2 * t);
}

function hashId(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 0x01000193);
  return h >>> 0;
}
