/**
 * Small polygon toolkit for named zones. A ring is a flat array
 * [x0, y0, x1, y1, …], implicitly closed (last point joins the first).
 */

export interface Point {
  readonly x: number;
  readonly y: number;
}

export function ringPointCount(ring: readonly number[]): number {
  return ring.length / 2;
}

/** Shoelace formula: sum of the signed areas of the triangles (origin, p_i, p_i+1). Absolute value. */
export function ringArea(ring: readonly number[]): number {
  let twice = 0;
  const n = ring.length / 2;
  for (let i = 0, j = n - 1; i < n; j = i++) twice += ring[2 * j] * ring[2 * i + 1] - ring[2 * i] * ring[2 * j + 1];
  return Math.abs(twice) / 2;
}

export function ringBounds(ring: readonly number[]): { x0: number; y0: number; x1: number; y1: number } {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (let i = 0; i < ring.length; i += 2) {
    x0 = Math.min(x0, ring[i]);
    x1 = Math.max(x1, ring[i]);
    y0 = Math.min(y0, ring[i + 1]);
    y1 = Math.max(y1, ring[i + 1]);
  }
  return { x0, y0, x1, y1 };
}

export function translateRing(ring: readonly number[], dx: number, dy: number): number[] {
  return ring.map((v, i) => v + (i % 2 === 0 ? dx : dy));
}

/**
 * Signed distance from (x, y) to the ring outline: positive inside, negative outside.
 * Inside test by ray casting: a horizontal ray from the point crosses the
 * outline an odd number of times iff the point is inside.
 */
export function signedDistanceToRing(ring: readonly number[], x: number, y: number): number {
  let inside = false;
  let best = Infinity;
  const n = ring.length / 2;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const ax = ring[2 * i];
    const ay = ring[2 * i + 1];
    const bx = ring[2 * j];
    const by = ring[2 * j + 1];
    if (ay > y !== by > y && x < ((bx - ax) * (y - ay)) / (by - ay) + ax) inside = !inside;
    best = Math.min(best, segmentDistanceSq(x, y, ax, ay, bx, by));
  }
  return (inside ? 1 : -1) * Math.sqrt(best);
}

function segmentDistanceSq(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax;
  const dy = by - ay;
  const lengthSq = dx * dx + dy * dy;
  let t = lengthSq > 0 ? ((px - ax) * dx + (py - ay) * dy) / lengthSq : 0;
  t = Math.max(0, Math.min(1, t));
  const ex = ax + t * dx - px;
  const ey = ay + t * dy - py;
  return ex * ex + ey * ey;
}

/**
 * Pole of inaccessibility: the inside point farthest from the outline, i.e.
 * the centre of the largest circle that fits in the zone — where a name has
 * the most room. (The centroid can fall outside a crescent-shaped bay.)
 *
 * Algorithm "polylabel" (Mapbox, 2016): cover the bounding box with square
 * cells; a cell can contain no point better than
 *   distance(centre) + half-diagonal
 * so we keep refining (split in 4) only the cells whose bound beats the best
 * point found so far, until no cell can improve it by more than `precision`.
 */
export function poleOfInaccessibility(ring: readonly number[], precision: number): Point {
  const { x0, y0, x1, y1 } = ringBounds(ring);
  const size = Math.min(x1 - x0, y1 - y0);
  if (!(size > 0)) return { x: (x0 + x1) / 2, y: (y0 + y1) / 2 };

  interface Cell {
    x: number;
    y: number;
    half: number;
    d: number;
    max: number;
  }
  const cell = (x: number, y: number, half: number): Cell => {
    const d = signedDistanceToRing(ring, x, y);
    return { x, y, half, d, max: d + half * Math.SQRT2 };
  };

  const queue: Cell[] = [];
  for (let x = x0; x < x1; x += size) {
    for (let y = y0; y < y1; y += size) queue.push(cell(x + size / 2, y + size / 2, size / 2));
  }
  let best = cell((x0 + x1) / 2, (y0 + y1) / 2, 0);
  while (queue.length > 0) {
    // Most promising cell first (a linear scan: the queue stays small for map zones).
    let k = 0;
    for (let i = 1; i < queue.length; i++) if (queue[i].max > queue[k].max) k = i;
    const c = queue[k];
    queue[k] = queue[queue.length - 1];
    queue.pop();
    if (c.d > best.d) best = c;
    if (c.max - best.d <= precision) continue;
    const h = c.half / 2;
    queue.push(cell(c.x - h, c.y - h, h), cell(c.x + h, c.y - h, h), cell(c.x - h, c.y + h, h), cell(c.x + h, c.y + h, h));
  }
  return { x: best.x, y: best.y };
}

/**
 * Douglas–Peucker simplification of an open polyline (flat array): keep the
 * point farthest from the chord first–last if it is farther than `tolerance`,
 * then recurse on both halves. A freehand lasso of 300 points becomes ~30
 * with no visible change.
 */
export function simplifyPolyline(points: readonly number[], tolerance: number): number[] {
  const n = points.length / 2;
  if (n <= 2) return [...points];
  const keep = new Uint8Array(n);
  keep[0] = 1;
  keep[n - 1] = 1;
  const stack: [number, number][] = [[0, n - 1]];
  const tolSq = tolerance * tolerance;
  while (stack.length > 0) {
    const [a, b] = stack.pop()!;
    let farthest = -1;
    let farthestSq = tolSq;
    for (let i = a + 1; i < b; i++) {
      const d = segmentDistanceSq(points[2 * i], points[2 * i + 1], points[2 * a], points[2 * a + 1], points[2 * b], points[2 * b + 1]);
      if (d > farthestSq) {
        farthest = i;
        farthestSq = d;
      }
    }
    if (farthest >= 0) {
      keep[farthest] = 1;
      stack.push([a, farthest], [farthest, b]);
    }
  }
  const out: number[] = [];
  for (let i = 0; i < n; i++) if (keep[i]) out.push(points[2 * i], points[2 * i + 1]);
  return out;
}
