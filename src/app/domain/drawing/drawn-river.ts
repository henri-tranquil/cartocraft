import { simplifyPolyline } from '../features/polygon';
import { getCellClamped, Int16TiledGrid } from '../terrain/tiled-grid';
import { isLakeCode, isLandCode } from './drawing-cell';

/**
 * A river traced by hand on the drawing: a polyline in km (flat array
 * x0, y0, x1, y1, …) from its SOURCE to its MOUTH. Rivers rule: at the
 * conversion (D6) each one carves a valley that always descends towards the
 * mouth, whatever the relief painted around it.
 */
export interface DrawnRiver {
  readonly id: string;
  readonly pointsKm: readonly number[];
}

export interface RiverStrokeContext {
  readonly drawing: Int16TiledGrid;
  readonly cellKm: number;
  /** Rivers already drawn: a new one stops where it meets them (it becomes a tributary). */
  readonly rivers: readonly DrawnRiver[];
  /** Douglas–Peucker tolerance: about a screen pixel or two, in km. */
  readonly toleranceKm: number;
  /** A river ending inland this close to another one (km) is extended to join it: hitting a line exactly is hard. */
  readonly snapKm?: number;
  /**
   * All rivers of the map, to tell which ones lead somewhere (default:
   * `rivers`). Differs when a river being extended is left out of `rivers`:
   * its tributaries still lead somewhere (into it).
   */
  readonly allRivers?: readonly DrawnRiver[];
  /** `auto` (default): the mouth is found from the drawing; `asDrawn`: the stroke ends at the mouth; `reversed`: it starts at the mouth. */
  readonly direction?: 'auto' | 'asDrawn' | 'reversed';
}

/** Where a river ends. Only `inland` deserves a warning. */
export type RiverEnd = 'sea' | 'lake' | 'river' | 'inland';

/** Two points closer than this (km) are the same place: a tributary's mouth lies ON its main river. */
const JOIN_EPSILON_KM = 0.01;

/** What tracing one stroke does: the new river, and older rivers re-attached to it as tributaries. */
export interface RiverPlan {
  readonly pointsKm: number[];
  readonly reattached: readonly { readonly before: DrawnRiver; readonly after: DrawnRiver }[];
}

/**
 * Turns a freehand stroke (km) into a river, or null if too short.
 *
 * 1. Simplify the hand's jitter (Douglas–Peucker).
 * 2. Orientation: a stroke STARTING at the sea or on a river leading
 *    somewhere (and not ending at one) is reversed; otherwise it is read as
 *    drawn, from the source to the mouth.
 * 3. Leading sea points are dropped: the source is on land.
 * 4. The river ends at the first of: entering the sea (overshooting the
 *    coast is harmless), crossing a river that leads somewhere (it becomes
 *    its tributary).
 * 5. Ending inland but near a river (`snapKm`): extended to join it.
 * 6. Rivers drawn earlier that led nowhere and touch the new one (crossed,
 *    or ending near it) become its tributaries: tributaries may be drawn
 *    before their main river.
 */
export function planRiver(strokeKm: readonly number[], ctx: RiverStrokeContext): RiverPlan | null {
  let points = simplifyPolyline(strokeKm, ctx.toleranceKm);
  if (points.length < 4) return null;
  const snap = ctx.snapKm ?? 0;
  const all = ctx.allRivers ?? ctx.rivers;
  const outlets = ctx.rivers.filter((r) => riverEnd(r, all, ctx.drawing, ctx.cellKm) !== 'inland');
  const m = points.length;
  const direction = ctx.direction ?? 'auto';
  if (
    direction === 'reversed' ||
    (direction === 'auto' && touchesOutlet(ctx, outlets, snap, points[0], points[1]) && !touchesOutlet(ctx, outlets, snap, points[m - 2], points[m - 1]))
  ) {
    points = reversePolyline(points);
  }

  // Start where the stroke leaves the water (sea or lake), cutting the first segment at the shore:
  // a straight stroke from the middle of a lake has no vertex on land to keep.
  if (isSeaKm(ctx, points[0], points[1])) {
    let start: number[] | null = null;
    for (let i = 1; i < points.length / 2 && !start; i++) {
      const ax = points[2 * i - 2];
      const ay = points[2 * i - 1];
      const bx = points[2 * i];
      const by = points[2 * i + 1];
      const samples = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay) / (ctx.cellKm / 2)));
      for (let k = 1; k <= samples; k++) {
        const t = k / samples;
        const x = ax + (bx - ax) * t;
        const y = ay + (by - ay) * t;
        if (isSeaKm(ctx, x, y)) continue;
        start = t < 1 ? [x, y, ...points.slice(2 * i)] : points.slice(2 * i);
        break;
      }
    }
    if (!start || start.length < 4) return null;
    points = start;
  }

  const out = [points[0], points[1]];
  let joined = false;
  const step = ctx.cellKm / 2;
  for (let i = 1; i < points.length / 2; i++) {
    const ax = points[2 * i - 2];
    const ay = points[2 * i - 1];
    const bx = points[2 * i];
    const by = points[2 * i + 1];
    // First river leading somewhere crossed on this segment, as a fraction of it.
    let cut = Infinity;
    for (const river of outlets) {
      const p = river.pointsKm;
      for (let k = 0; k + 3 < p.length; k += 2) {
        const t = segmentIntersection(ax, ay, bx, by, p[k], p[k + 1], p[k + 2], p[k + 3]);
        if (t !== null && t > 1e-9 && t < cut) cut = t;
      }
    }
    // Entering the sea: walk the segment by half cells.
    const samples = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay) / step));
    for (let s = 1; s <= samples; s++) {
      const t = s / samples;
      if (t >= cut) break;
      if (isSeaKm(ctx, ax + (bx - ax) * t, ay + (by - ay) * t)) {
        cut = t;
        break;
      }
    }
    if (cut <= 1) {
      out.push(ax + (bx - ax) * cut, ay + (by - ay) * cut);
      joined = true;
      break;
    }
    out.push(bx, by);
  }
  if (!joined && snap > 0) {
    let best: { x: number; y: number } | null = null;
    let bestD = snap;
    for (const river of ctx.rivers) {
      const near = nearestOnPolyline(river.pointsKm, out[out.length - 2], out[out.length - 1]);
      if (near.distance <= bestD) {
        best = near;
        bestD = near.distance;
      }
    }
    if (best) attachEnd(out, best, snap);
  }
  if (polylineLength(out) < 2 * ctx.cellKm) return null;

  const reattached: { before: DrawnRiver; after: DrawnRiver }[] = [];
  for (const river of ctx.rivers) {
    if (outlets.includes(river)) continue;
    // The river the new one flows into keeps its course: it is not a tributary of its own tributary.
    if (distanceToPolyline(river.pointsKm, out[out.length - 2], out[out.length - 1]).distance < JOIN_EPSILON_KM) continue;
    const trimmed = trimAtFirstCrossing(river.pointsKm, out);
    if (trimmed) {
      reattached.push({ before: river, after: { ...river, pointsKm: trimmed } });
      continue;
    }
    const p = river.pointsKm;
    const near = snap > 0 ? nearestOnPolyline(out, p[p.length - 2], p[p.length - 1]) : null;
    if (near && near.distance <= snap) {
      const moved = [...p];
      attachEnd(moved, near, snap);
      if (moved.length >= 4) reattached.push({ before: river, after: { ...river, pointsKm: moved } });
    }
  }
  return { pointsKm: out, reattached };
}

/** Compatibility helper: the new river's points only. */
export function riverFromStroke(strokeKm: readonly number[], ctx: RiverStrokeContext): number[] | null {
  return planRiver(strokeKm, ctx)?.pointsKm ?? null;
}

/**
 * Does this end of a stroke reach the sea, or a river leading somewhere?
 * Only then is it surely a mouth; otherwise the gesture's own direction
 * (source → mouth) is kept: guessing from the distance to the sea surprised.
 */
function touchesOutlet(ctx: RiverStrokeContext, outlets: readonly DrawnRiver[], snapKm: number, x: number, y: number): boolean {
  for (const river of outlets) if (nearestOnPolyline(river.pointsKm, x, y).distance <= snapKm) return true;
  const reach = Math.max(1, Math.ceil(Math.max(1.5 * ctx.cellKm, snapKm) / ctx.cellKm));
  const cx = Math.floor(x / ctx.cellKm);
  const cy = Math.floor(y / ctx.cellKm);
  for (let dy = -reach; dy <= reach; dy++) {
    for (let dx = -reach; dx <= reach; dx++) {
      if (dx * dx + dy * dy <= reach * reach && isSeaCell(ctx.drawing, cx + dx, cy + dy)) return true;
    }
  }
  return false;
}

/** Replaces the end of `points` (in place) by `target`, dropping the last points around it: a straight arrival, no hook. */
function attachEnd(points: number[], target: { x: number; y: number }, snapKm: number): void {
  while (points.length > 4 && Math.hypot(points[points.length - 2] - target.x, points[points.length - 1] - target.y) < snapKm) points.length -= 2;
  points.push(target.x, target.y);
}

/** `river` cut where it first (along its own course) crosses `other`, or null if it does not cross it. */
function trimAtFirstCrossing(river: readonly number[], other: readonly number[]): number[] | null {
  for (let k = 0; k + 3 < river.length; k += 2) {
    let best = Infinity;
    for (let j = 0; j + 3 < other.length; j += 2) {
      const t = segmentIntersection(river[k], river[k + 1], river[k + 2], river[k + 3], other[j], other[j + 1], other[j + 2], other[j + 3]);
      if (t !== null && t < best) best = t;
    }
    if (best <= 1) {
      const out = river.slice(0, k + 2);
      out.push(river[k] + (river[k + 2] - river[k]) * best, river[k + 1] + (river[k + 3] - river[k + 1]) * best);
      return out.length >= 4 && polylineLength(out) > 0 ? out : null;
    }
  }
  return null;
}

/** How a river ends: in the sea, in a lake (painted as a lake, or a sea enclosed inland), on another river, or nowhere. */
export function riverEnd(river: DrawnRiver, rivers: readonly DrawnRiver[], drawing: Int16TiledGrid, cellKm: number): RiverEnd {
  const p = river.pointsKm;
  const x = p[p.length - 2];
  const y = p[p.length - 1];
  const cx = Math.floor(x / cellKm);
  const cy = Math.floor(y / cellKm);
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      if (!isSeaCell(drawing, cx + dx, cy + dy)) continue;
      // Water around the mouth: a lake if most of its water cells are lake cells.
      let lake = 0;
      let water = 0;
      for (let ey = -2; ey <= 2; ey++) {
        for (let ex = -2; ex <= 2; ex++) {
          const code = getCellClamped(drawing, cx + ex, cy + ey);
          if (isLandCode(code)) continue;
          water++;
          if (isLakeCode(code)) lake++;
        }
      }
      return 2 * lake > water ? 'lake' : 'sea';
    }
  }
  return joinOf(river, rivers) ? 'river' : 'inland';
}

/**
 * Upstream river length (km) at every vertex of every river: its own length
 * from the source, plus the whole upstream length of each tributary joining
 * above that vertex. A stand-in for discharge: the width of a drawn river
 * grows with it, and the conversion will use it for the valley's size.
 */
/**
 * Width (KM, fixed on the ground) of a drawn river = kmPerKm · L^exponent,
 * L = upstream length (km, tributaries included). Real rivers: width ∝
 * √discharge, and the basin grows a bit faster than the length (Hack's law)
 * ⇒ width ∝ ~L^0.8: zero at the source, a 1000 km river ≈ 10 km wide at its
 * mouth (fantasy-map scale, not the real one). Used by the rendering (water
 * in the tiles, with a minimum width on screen) and by the conversion (bed).
 */
export const RIVER_WIDTH = { kmPerKm: 0.04, exponent: 0.8, maxWidthKm: 16 } as const;

export function drawnRiverWidthKm(upstreamKm: number): number {
  return Math.min(RIVER_WIDTH.maxWidthKm, RIVER_WIDTH.kmPerKm * Math.max(0, upstreamKm) ** RIVER_WIDTH.exponent);
}

export function riverFlowsKm(rivers: readonly DrawnRiver[]): Map<string, Float64Array> {
  const flows = new Map<string, Float64Array>();
  // Tributaries of each river, with the arc length where they join it.
  const joins = new Map<string, { readonly tributary: DrawnRiver; readonly atKm: number }[]>();
  for (const river of rivers) {
    const join = joinOf(river, rivers);
    if (join) joins.set(join.river.id, [...(joins.get(join.river.id) ?? []), { tributary: river, atKm: join.atKm }]);
  }
  const visiting = new Set<string>();
  const flowOf = (river: DrawnRiver): Float64Array => {
    const known = flows.get(river.id);
    if (known) return known;
    const p = river.pointsKm;
    const n = p.length / 2;
    const flow = new Float64Array(n);
    if (visiting.has(river.id)) return flow; // a loop of rivers: impossible by construction, but never recurse forever
    visiting.add(river.id);
    let arc = 0;
    for (let i = 0; i < n; i++) {
      if (i > 0) arc += Math.hypot(p[2 * i] - p[2 * i - 2], p[2 * i + 1] - p[2 * i - 1]);
      flow[i] = arc;
    }
    for (const { tributary, atKm } of joins.get(river.id) ?? []) {
      const t = flowOf(tributary);
      const added = t[t.length - 1];
      arc = 0;
      for (let i = 0; i < n; i++) {
        if (i > 0) arc += Math.hypot(p[2 * i] - p[2 * i - 2], p[2 * i + 1] - p[2 * i - 1]);
        if (arc >= atKm - JOIN_EPSILON_KM) flow[i] += added;
      }
    }
    visiting.delete(river.id);
    flows.set(river.id, flow);
    return flow;
  };
  for (const river of rivers) flowOf(river);
  return flows;
}

/** The river nearest to (x, y) within `maxKm`, for picking with the pointer. */
export function riverNear(rivers: readonly DrawnRiver[], xKm: number, yKm: number, maxKm: number): DrawnRiver | null {
  let best: DrawnRiver | null = null;
  let bestD = maxKm;
  for (const river of rivers) {
    const d = distanceToPolyline(river.pointsKm, xKm, yKm).distance;
    if (d <= bestD) {
      best = river;
      bestD = d;
    }
  }
  return best;
}

/** The river whose course the mouth of `river` lies on (it is a tributary of it), and where along it (km). */
export function joinOf(river: DrawnRiver, rivers: readonly DrawnRiver[]): { river: DrawnRiver; atKm: number } | null {
  const p = river.pointsKm;
  const x = p[p.length - 2];
  const y = p[p.length - 1];
  for (const other of rivers) {
    if (other.id === river.id) continue;
    const { distance, atKm } = distanceToPolyline(other.pointsKm, x, y);
    if (distance < JOIN_EPSILON_KM) return { river: other, atKm };
  }
  return null;
}

/** The nearest point (km) on any drawn river within `maxKm`, and its river: where a river name anchors. */
export function nearestDrawnRiverPoint(
  rivers: readonly DrawnRiver[],
  xKm: number,
  yKm: number,
  maxKm: number,
): { readonly river: DrawnRiver; readonly xKm: number; readonly yKm: number } | null {
  let best: { river: DrawnRiver; xKm: number; yKm: number } | null = null;
  let bestD = maxKm;
  for (const river of rivers) {
    const near = nearestOnPolyline(river.pointsKm, xKm, yKm);
    if (near.distance <= bestD) {
      best = { river, xKm: near.x, yKm: near.y };
      bestD = near.distance;
    }
  }
  return best;
}

function nearestOnPolyline(p: readonly number[], x: number, y: number): { x: number; y: number; distance: number } {
  let best = { x: p[0], y: p[1], distance: Infinity };
  for (let k = 0; k + 3 < p.length; k += 2) {
    const dx = p[k + 2] - p[k];
    const dy = p[k + 3] - p[k + 1];
    const len2 = dx * dx + dy * dy;
    const t = len2 > 0 ? Math.max(0, Math.min(1, ((x - p[k]) * dx + (y - p[k + 1]) * dy) / len2)) : 0;
    const nx = p[k] + dx * t;
    const ny = p[k + 1] + dy * t;
    const d = Math.hypot(nx - x, ny - y);
    if (d < best.distance) best = { x: nx, y: ny, distance: d };
  }
  return best;
}

function distanceToPolyline(p: readonly number[], x: number, y: number): { distance: number; atKm: number } {
  let best = Infinity;
  let atKm = 0;
  let arc = 0;
  for (let k = 0; k + 3 < p.length; k += 2) {
    const ax = p[k];
    const ay = p[k + 1];
    const dx = p[k + 2] - ax;
    const dy = p[k + 3] - ay;
    const len2 = dx * dx + dy * dy;
    const t = len2 > 0 ? Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / len2)) : 0;
    const d = Math.hypot(ax + dx * t - x, ay + dy * t - y);
    const len = Math.sqrt(len2);
    if (d < best) {
      best = d;
      atKm = arc + t * len;
    }
    arc += len;
  }
  return { distance: best, atKm };
}

/** Fraction t ∈ [0, 1] along AB where it crosses CD, or null. */
function segmentIntersection(ax: number, ay: number, bx: number, by: number, cx: number, cy: number, dx: number, dy: number): number | null {
  const rx = bx - ax;
  const ry = by - ay;
  const sx = dx - cx;
  const sy = dy - cy;
  const denom = rx * sy - ry * sx;
  if (Math.abs(denom) < 1e-12) return null;
  const t = ((cx - ax) * sy - (cy - ay) * sx) / denom;
  const u = ((cx - ax) * ry - (cy - ay) * rx) / denom;
  return t >= 0 && t <= 1 && u >= 0 && u <= 1 ? t : null;
}

function isSeaKm(ctx: RiverStrokeContext, xKm: number, yKm: number): boolean {
  return isSeaCell(ctx.drawing, Math.floor(xKm / ctx.cellKm), Math.floor(yKm / ctx.cellKm));
}

/**
 * Sea as the reader SEES it: the coast is drawn where the 3×3 mean of land
 * crosses ½, so a lone sea cell inside the land (a gap left between brush
 * strokes) is invisible. It must not stop a river: sea = most of the 3×3 block.
 */
export function isSeaCell(drawing: Int16TiledGrid, cx: number, cy: number): boolean {
  let sea = 0;
  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (!isLandCode(getCellClamped(drawing, cx + dx, cy + dy))) sea++;
  return sea >= 5;
}

export function reversePolyline(points: readonly number[]): number[] {
  const out: number[] = [];
  for (let i = points.length - 2; i >= 0; i -= 2) out.push(points[i], points[i + 1]);
  return out;
}

export function polylineLength(p: readonly number[]): number {
  let length = 0;
  for (let k = 2; k < p.length; k += 2) length += Math.hypot(p[k] - p[k - 2], p[k + 1] - p[k - 1]);
  return length;
}

/**
 * How a river meets the sea. Small rivers just end; large ones (enough
 * upstream length) get, by a fixed draw tied to the river, either an
 * ESTUARY (the bed flares into a funnel over its last kilometres, like the
 * Gironde or the Thames) or a DELTA (it splits into branches fanning out to
 * the coast, like the Nile or the Rhône).
 */
export type MouthShape = 'simple' | 'estuary' | 'delta';

export const MOUTH_STYLE = {
  /** Below this upstream length (km) at the mouth, a river just ends. */
  minUpstreamKm: 150,
  /** Length of the estuary or delta: a fraction of the upstream length, clamped (km). */
  lengthFraction: 0.12,
  minLengthKm: 20,
  maxLengthKm: 100,
  /** Delta branches fan out up to ± this angle (rad) from the river's last direction. */
  deltaSpreadRad: 0.9,
} as const;

/** `end`: estuaries and deltas only open onto the sea, never into a river or the middle of the land. */
export function mouthShape(river: DrawnRiver, upstreamKm: number, end: RiverEnd): MouthShape {
  if (end !== 'sea' || upstreamKm < MOUTH_STYLE.minUpstreamKm) return 'simple';
  // Deltas are not chosen automatically any more: placed blindly, their branches read as stray lines.
  // They will come back as a choice of the user (`deltaBranches` is ready for it).
  void river;
  return 'estuary';
}

export function mouthLengthKm(upstreamKm: number): number {
  return Math.min(MOUTH_STYLE.maxLengthKm, Math.max(MOUTH_STYLE.minLengthKm, upstreamKm * MOUTH_STYLE.lengthFraction));
}

/**
 * The extra branches of a delta (km polylines, from the fork to the coast),
 * the river itself staying the main branch. The fork is `mouthLengthKm`
 * upstream of the mouth; each branch leaves it at its own angle and runs
 * until it reaches the sea in the DRAWING, so it always ends on the real
 * coast. A branch finding no sea nearby is dropped.
 */
export function deltaBranches(river: DrawnRiver, upstreamKm: number, drawing: Int16TiledGrid, cellKm: number): { readonly forkKm: number; readonly branches: number[][] } {
  const p = river.pointsKm;
  const total = polylineLength(p);
  const length = Math.min(mouthLengthKm(upstreamKm), total * 0.5);
  const forkKm = total - length;
  const fork = pointAtArc(p, forkKm);
  const mx = p[p.length - 2];
  const my = p[p.length - 1];
  const base = Math.atan2(my - fork.y, mx - fork.x);
  const hash = hashString(river.id);
  const count = 2 + (hash % 3); // 2 to 4 extra branches: 3 to 5 mouths
  const branches: number[][] = [];
  const step = cellKm / 2;
  for (let b = 0; b < count; b++) {
    // Alternate sides, spread evenly, a little jitter per branch.
    const side = b % 2 === 0 ? 1 : -1;
    const rank = Math.floor(b / 2) + 1;
    const jitter = ((((hash >>> (b * 4)) & 15) / 15) - 0.5) * 0.15;
    const angle = base + side * (MOUTH_STYLE.deltaSpreadRad * rank) / Math.ceil(count / 2) + jitter;
    const dx = Math.cos(angle);
    const dy = Math.sin(angle);
    let end: { x: number; y: number } | null = null;
    for (let d = step; d <= length * 1.5; d += step) {
      const x = fork.x + dx * d;
      const y = fork.y + dy * d;
      if (isSeaCell(drawing, Math.floor(x / cellKm), Math.floor(y / cellKm))) {
        end = { x, y };
        break;
      }
    }
    if (!end || Math.hypot(end.x - fork.x, end.y - fork.y) < length * 0.3) continue;
    // A gentle bend: the middle point is pulled towards the river's own direction.
    const midX = (fork.x + end.x) / 2 + Math.cos(base) * length * 0.12;
    const midY = (fork.y + end.y) / 2 + Math.sin(base) * length * 0.12;
    branches.push([fork.x, fork.y, midX, midY, end.x, end.y]);
  }
  return { forkKm, branches };
}

function pointAtArc(p: readonly number[], arcKm: number): { x: number; y: number } {
  let arc = 0;
  for (let k = 2; k < p.length; k += 2) {
    const len = Math.hypot(p[k] - p[k - 2], p[k + 1] - p[k - 1]);
    if (arc + len >= arcKm) {
      const t = len > 0 ? (arcKm - arc) / len : 0;
      return { x: p[k - 2] + (p[k] - p[k - 2]) * t, y: p[k - 1] + (p[k + 1] - p[k - 1]) * t };
    }
    arc += len;
  }
  return { x: p[p.length - 2], y: p[p.length - 1] };
}

/** FNV-1a: a stable number from a river's id (its random draws). */
function hashString(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 0x01000193);
  return h >>> 0;
}

/**
 * Where a new stroke of the River tool would start from, when it starts
 * close to an existing river (the "magnet"):
 * - `source`: at a river's source → the stroke extends it upstream;
 * - `mouth`: at the end of a river leading nowhere → extends it downstream;
 * - `branch`: anywhere along a river → the stroke is a new tributary from there.
 * Ends win over the course (they are picked within 1.5 × the radius).
 */
export interface RiverSnap {
  readonly kind: 'source' | 'mouth' | 'branch';
  readonly river: DrawnRiver;
  readonly x: number;
  readonly y: number;
}

export function riverSnapAt(rivers: readonly DrawnRiver[], drawing: Int16TiledGrid, cellKm: number, x: number, y: number, snapKm: number): RiverSnap | null {
  let best: RiverSnap | null = null;
  let bestD = snapKm * 1.5;
  for (const river of rivers) {
    const p = river.pointsKm;
    const ends: [RiverSnap['kind'], number, number][] = [['source', p[0], p[1]]];
    if (riverEnd(river, rivers, drawing, cellKm) === 'inland') ends.push(['mouth', p[p.length - 2], p[p.length - 1]]);
    for (const [kind, ex, ey] of ends) {
      const d = Math.hypot(ex - x, ey - y);
      if (d <= bestD) {
        best = { kind, river, x: ex, y: ey };
        bestD = d;
      }
    }
  }
  if (best) return best;
  bestD = snapKm;
  for (const river of rivers) {
    const near = nearestOnPolyline(river.pointsKm, x, y);
    if (near.distance <= bestD) {
      best = { kind: 'branch', river, x: near.x, y: near.y };
      bestD = near.distance;
    }
  }
  return best;
}

/** A river's course from its source down to the point of it nearest to (x, y), that point included. */
export function courseUpTo(points: readonly number[], x: number, y: number): number[] {
  let best = Infinity;
  let cut: number[] = [points[0], points[1]];
  for (let k = 0; k + 3 < points.length; k += 2) {
    const dx = points[k + 2] - points[k];
    const dy = points[k + 3] - points[k + 1];
    const len2 = dx * dx + dy * dy;
    const t = len2 > 0 ? Math.max(0, Math.min(1, ((x - points[k]) * dx + (y - points[k + 1]) * dy) / len2)) : 0;
    const nx = points[k] + dx * t;
    const ny = points[k + 1] + dy * t;
    const d = Math.hypot(nx - x, ny - y);
    if (d < best) {
      best = d;
      cut = [...points.slice(0, k + 2), nx, ny];
    }
  }
  // Drop a duplicated last vertex (cut exactly at a vertex).
  const n = cut.length;
  if (n >= 4 && cut[n - 2] === cut[n - 4] && cut[n - 1] === cut[n - 3]) cut.length -= 2;
  return cut;
}
