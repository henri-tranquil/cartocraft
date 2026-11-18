import { boxBlur } from '../terrain/sketch';
import { fbm } from '../terrain/noise';
import { chamferDistance } from '../terrain/distance-field';
import { isLandCode, reliefIndexOf } from './drawing-cell';
import { DrawnRiver, joinOf, riverFlowsKm } from './drawn-river';

/**
 * CONVERSION DRAWING → WORLD (step D6).
 *
 * Not "4 relief classes → 4 altitudes": the relief is BUILT BY THE WATER
 * that drains it, like real landscapes shaped by erosion.
 *
 * 1. ALTITUDE = COST OF THE WAY DOWN TO THE SEA. Starting from the sea
 *    (altitude 0), every km walked inland adds a SLOPE (m per km). The
 *    altitude of a cell is the cheapest path to the sea: a shortest path
 *    (Dijkstra) where the cost is the slope. Consequences:
 *    - the further from the sea, the higher, even on a plain;
 *    - NO PITS: each cell has a lower neighbour leading to the sea — its
 *      parent in the shortest-path tree;
 *    - that tree IS the drainage network: a source is always higher than the
 *      mouth it drains to.
 * 2. THE SLOPE COMES FROM THE DRAWING: the (softened) relief class gives a
 *    base slope, modulated by noise ⇒ nuances inside a class and between
 *    plain and hills.
 * 3. EROSION, the "stream power" law: at equilibrium, a river's slope
 *    decreases as its drained area A grows, slope ∝ A^−θ (θ ≈ 0.45). We build
 *    a first relief, measure the area drained by each cell (summing up the
 *    tree), and build again with gentler slopes where much water flows:
 *    thalwegs dig themselves, and a branching network of valleys appears
 *    everywhere, even where nothing was drawn.
 * 4. DRAWN RIVERS RULE: they get a large drained area, from their length by
 *    Hack's law (L ≈ 1.4·A^0.6). They are the trunks of the network: the
 *    gentlest slopes, so valleys and ridges organise around them.
 * 5. SOFT CEILING: the slope fades as the ground rises (× e^(−h/Hmax)), so
 *    that large mountain areas become massifs, not endless peaks.
 *
 * Since every cost is positive, all of this keeps "no pits": the hydrology
 * then finds rivers that follow the drawn ones. Lengths in km (the result
 * does not depend on the grid resolution). Row-major in and out.
 */

/** [soft relief class, base slope (m per km of path)]. */
const SLOPE_M_PER_KM: readonly (readonly [number, number])[] = [
  [0, 3],
  [1, 30],
  [2, 70],
  [3, 175],
];
/** [soft relief class, height (m) where the slope has faded to 1/e]. */
const CEILING_M: readonly (readonly [number, number])[] = [
  [0, 350],
  [1, 900],
  [2, 2200],
  [3, 4200],
];
/** Blur radius of the relief classes (km): how far a range's foothills reach. */
export const CLASS_BLUR_KM = 10;
/** Slope noise: large patches (nuances), then fine roughness (irregular valleys). */
const NUANCE_PERIOD_KM = 60;
const ROUGH_PERIOD_KM = 9;
const NOISE_STEP_KM = 2;
/** Stream power: slope × (A / A_REF)^−THETA, never below MIN_FACTOR (big rivers). */
const THETA = 0.45;
const A_REF_KM2 = 60;
const MIN_FACTOR = 0.015;
/** Hack's law: L = HACK_C · A^HACK_H (L in km, A in km²). */
const HACK_C = 1.4;
const HACK_H = 0.6;
/** Rebuilds with the drained areas of the previous relief (2 gives about the same network as 4). */
const EROSION_PASSES = 2;
/** Above this many cells, the erosion passes run on a grid twice as coarse. */
const COARSE_ABOVE_CELLS = 1_000_000;
/** Drawn river beds: at least this far below the ground around them (m), within this many cells, and this slope. */
const BANK_MARGIN_M = 2;
const BANK_REACH_CELLS = 2;
const RIVER_MIN_SLOPE_M_PER_KM = 0.02;
const SEA_SHELF_M = 20;
const SEA_DEPTH_M = 3500;
const SEA_DEEPEN_KM = 120;
const SEA_NOISE_M = 300;
const BROAD_PERIOD_KM = 250;

export interface DrawingToWorldInput {
  /** Drawing codes, row-major. */
  readonly drawing: Int16Array;
  readonly widthCells: number;
  readonly heightCells: number;
  readonly cellKm: number;
  readonly seaLevelM: number;
  readonly seed: number;
}

export interface WorldConversionInput extends DrawingToWorldInput {
  readonly rivers: readonly DrawnRiver[];
}

/** The whole conversion: altitudes (m, row-major) of the world described by the drawing and its rivers. */
export function convertDrawingToWorld(input: WorldConversionInput): Int16Array {
  return convertDrawingToWorldDetailed(input, false).altitudeM;
}

/** Same, plus the drained area (km²) of the generated network: for tests and tuning. */
export function convertDrawingToWorldDetailed(input: WorldConversionInput, withArea = true): { altitudeM: Int16Array; drainedAreaKm2: Float32Array | null } {
  const { drawing, widthCells: w, heightCells: h, cellKm, seaLevelM, seed } = input;
  const n = w * h;
  const sea = new Uint8Array(n);
  const reliefClass = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    if (isLandCode(drawing[i])) reliefClass[i] = reliefIndexOf(drawing[i]);
    else sea[i] = 1;
  }
  const r = Math.max(1, Math.round(CLASS_BLUR_KM / cellKm / 2));
  const soft = boxBlur(boxBlur(reliefClass, w, h, r), w, h, r);

  // Base slope and ceiling of each land cell. The noise is sampled every ~2 km and interpolated:
  // its finest detail is coarser than that, and per-cell sampling was a large part of the cost.
  const noise = noiseLattice(w, h, cellKm, (xKm, yKm) => {
    const nuance = 0.5 + fbm(seed ^ 0x2c1b, xKm / NUANCE_PERIOD_KM, yKm / NUANCE_PERIOD_KM, 4); // ~0.5..1.5
    const rough = 0.7 + 0.6 * fbm(seed ^ 0x7a3f, xKm / ROUGH_PERIOD_KM, yKm / ROUGH_PERIOD_KM, 3); // ~0.7..1.3
    return nuance * rough;
  });
  const slope = new Float32Array(n);
  const ceiling = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    if (sea[i]) continue;
    slope[i] = interpolate(SLOPE_M_PER_KM, soft[i]) * noise[i];
    ceiling[i] = interpolate(CEILING_M, soft[i]);
  }

  // Drawn rivers: a drained area from their length (Hack), the trunks of the network.
  const cellAreaKm2 = cellKm * cellKm;
  const drawnArea = riverAreas(input.rivers, w, h, cellKm);

  // Erosion passes only MEASURE drained areas (a large-scale quantity): on big maps they run on a
  // grid twice as coarse (4× fewer cells); the final pass at full resolution gives the fine shape.
  const factor = n > COARSE_ABOVE_CELLS ? 2 : 1;
  const coarse = factor === 1 ? { sea, slope, ceiling, drawnArea, w, h } : downsample(sea, slope, ceiling, drawnArea, w, h, factor);
  const coarseCellKm = cellKm * factor;
  const coarseCellArea = coarseCellKm * coarseCellKm;
  let area: Float32Array = new Float32Array(coarse.w * coarse.h);
  for (let i = 0; i < area.length; i++) area[i] = Math.max(coarseCellArea, coarse.drawnArea[i]);
  let coarseHeight: Float32Array = new Float32Array(0);
  for (let pass = 0; pass < EROSION_PASSES; pass++) {
    const step = marchFromSea(coarse.sea, coarse.slope, coarse.ceiling, area, coarse.w, coarse.h, coarseCellKm);
    coarseHeight = step.heightM;
    area = drainedArea(step, coarseCellArea);
    for (let i = 0; i < area.length; i++) area[i] = Math.max(area[i], coarse.drawnArea[i]);
  }
  const fullArea = factor === 1 ? area : new Float32Array(n);
  if (factor > 1) {
    for (let y = 0; y < h; y++) {
      const cy = Math.min(coarse.h - 1, Math.floor(y / factor));
      for (let x = 0; x < w; x++) fullArea[y * w + x] = Math.max(drawnArea[y * w + x], area[cy * coarse.w + Math.min(coarse.w - 1, Math.floor(x / factor))]);
    }
  }
  // Drawn rivers become fixed boundaries, like the sea: their beds first, then the land climbs from both.
  const groundAt = (x: number, y: number): number =>
    coarseHeight[Math.min(coarse.h - 1, Math.floor(y / factor)) * coarse.w + Math.min(coarse.w - 1, Math.floor(x / factor))];
  const bedM = riverBeds(input.rivers, sea, w, h, cellKm, groundAt);
  const tree = marchFromSea(sea, slope, ceiling, fullArea, w, h, cellKm, withArea, bedM);

  // Sea floor: a shelf, then deeper away from the land.
  const land = new Uint8Array(n);
  for (let i = 0; i < n; i++) land[i] = sea[i] ? 0 : 1;
  const toLand = chamferDistance(sea, w, h);
  const out = new Int16Array(n);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (land[i]) {
        let value = Math.round(seaLevelM + 1 + tree.heightM[i]);
        if (Number.isNaN(bedM[i])) {
          // A bank stands at least 1 m above the bed next to it (altitudes are whole metres: a lowland
          // bed dropping 40 m over 2000 km would otherwise merge with its banks and leak sideways).
          for (let dy = -1; dy <= 1; dy++) {
            for (let dx = -1; dx <= 1; dx++) {
              const nx = x + dx;
              const ny = y + dy;
              if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
              const b = bedM[ny * w + nx];
              if (!Number.isNaN(b)) value = Math.max(value, Math.round(seaLevelM + 1 + b) + 1);
            }
          }
        }
        out[i] = Math.max(seaLevelM + 1, Math.min(32767, value));
        continue;
      }
      const broad = fbm(seed, (x * cellKm) / BROAD_PERIOD_KM, (y * cellKm) / BROAD_PERIOD_KM, 3) - 0.5;
      const deep = 1 - Math.exp(-(toLand[i] * cellKm) / SEA_DEEPEN_KM);
      const depth = SEA_SHELF_M + SEA_DEPTH_M * deep + broad * 2 * SEA_NOISE_M * deep;
      out[i] = Math.min(seaLevelM - 1, Math.round(seaLevelM - depth));
    }
  }
  return { altitudeM: out, drainedAreaKm2: withArea ? drainedArea(tree, cellAreaKm2) : null };
}

/**
 * Port: "something that converts a drawing into altitudes". The real adapter
 * runs it in a Web Worker; tests use a synchronous one.
 */
export interface WorldConverter {
  convert(input: WorldConversionInput): Promise<Int16Array>;
}

// --- Fast marching from the sea ---

export interface DrainageTree {
  /** Height above sea level (m) of each land cell; 0 on the sea. */
  readonly heightM: Float32Array;
  /** Cell each land cell drains into (its parent towards the sea), −1 on the sea. */
  readonly parent: Int32Array;
  /** Land cells in the order they were settled: each after its parent (downstream first). */
  readonly order: Int32Array;
  readonly count: number;
}

/**
 * FAST MARCHING (Sethian): solves the eikonal equation |∇h| = slope from the
 * sea, i.e. the height a front reaches when it advances inland like a wave
 * whose speed is 1 / slope. Same priority queue as Dijkstra, but a cell's
 * value comes from its two settled neighbours (one along x, one along y) by
 * the upwind quadratic
 *     (h − a)² + (h − b)² = f²   (f = slope × cell size)
 * instead of "best neighbour + step": no favourite directions, so no facets.
 *
 * Slope of a cell = base slope × stream-power factor of its drained area ×
 * ceiling fade at its neighbours' height. Then the drainage: each land cell
 * flows to its lowest of 8 neighbours, which is lower (the front reached it
 * first), so the settle order is also a downstream-first order.
 */
export function marchFromSea(
  sea: Uint8Array,
  slope: Float32Array,
  ceiling: Float32Array,
  areaKm2: Float32Array,
  w: number,
  h: number,
  cellKm: number,
  /** Compute each cell's receiver (needed for drained areas). */
  withDrainage = true,
  /** Fixed heights (m) that the front also starts from (drawn river beds); NaN = free. */
  fixedM: Float32Array | null = null,
): DrainageTree {
  const n = w * h;
  const heightM = new Float32Array(n).fill(Infinity);
  const done = new Uint8Array(n);
  const order = new Int32Array(n);
  let count = 0;
  const eff = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    if (sea[i]) continue;
    eff[i] = slope[i] * cellKm * Math.max(MIN_FACTOR, Math.min(1, (areaKm2[i] / A_REF_KM2) ** -THETA));
  }
  const queue = new BucketQueue(n);
  for (let i = 0; i < n; i++) {
    if (sea[i]) heightM[i] = 0;
    else if (fixedM && !Number.isNaN(fixedM[i])) heightM[i] = fixedM[i];
    else continue;
    done[i] = 1;
  }
  const update = (j: number): void => {
    const x = j % w;
    const a = Math.min(x > 0 && done[j - 1] ? heightM[j - 1] : Infinity, x < w - 1 && done[j + 1] ? heightM[j + 1] : Infinity);
    const b = Math.min(j >= w && done[j - w] ? heightM[j - w] : Infinity, j < n - w && done[j + w] ? heightM[j + w] : Infinity);
    const low = Math.min(a, b);
    const f = eff[j] * Math.exp(-low / ceiling[j]);
    let t: number;
    if (Math.abs(a - b) < f) t = (a + b + Math.sqrt(2 * f * f - (a - b) * (a - b))) / 2;
    else t = low + f;
    if (t < heightM[j]) {
      heightM[j] = t;
      queue.push(j, t);
    }
  };
  for (let i = 0; i < n; i++) {
    if (!done[i]) continue;
    const x = i % w;
    if (x > 0 && !done[i - 1]) update(i - 1);
    if (x < w - 1 && !done[i + 1]) update(i + 1);
    if (i >= w && !done[i - w]) update(i - w);
    if (i < n - w && !done[i + w]) update(i + w);
  }
  while (queue.size > 0) {
    const i = queue.pop();
    if (done[i]) continue;
    done[i] = 1;
    order[count++] = i;
    const x = i % w;
    if (x > 0 && !done[i - 1]) update(i - 1);
    if (x < w - 1 && !done[i + 1]) update(i + 1);
    if (i >= w && !done[i - w]) update(i - w);
    if (i < n - w && !done[i + w]) update(i + w);
  }
  for (let i = 0; i < n; i++) if (!Number.isFinite(heightM[i])) heightM[i] = 0; // land with no sea at all

  // Drainage: lowest of the 8 neighbours.
  const parent = new Int32Array(n).fill(-1);
  for (let k = 0; withDrainage && k < count; k++) {
    const i = order[k];
    const x = i % w;
    const y = (i - x) / w;
    let best = heightM[i];
    for (let dy = -1; dy <= 1; dy++) {
      const ny = y + dy;
      if (ny < 0 || ny >= h) continue;
      for (let dx = -1; dx <= 1; dx++) {
        const nx = x + dx;
        if ((dx === 0 && dy === 0) || nx < 0 || nx >= w) continue;
        const j = ny * w + nx;
        // Per unit of distance: diagonals are √2 further.
        const drop = (heightM[i] - heightM[j]) / (dx !== 0 && dy !== 0 ? Math.SQRT2 : 1);
        if (heightM[j] < heightM[i] && heightM[i] - drop < best) {
          best = heightM[i] - drop;
          parent[i] = j;
        }
      }
    }
  }
  return { heightM, parent, order, count };
}

/** Area (km²) drained through each cell: its own plus everything upstream, summed down the tree. */
export function drainedArea(tree: DrainageTree, cellAreaKm2: number): Float32Array {
  const area = new Float32Array(tree.parent.length).fill(cellAreaKm2);
  for (let k = tree.count - 1; k >= 0; k--) {
    const i = tree.order[k];
    const p = tree.parent[i];
    if (p >= 0) area[p] += area[i];
  }
  return area;
}

/** `field(xKm, yKm)` at every cell, evaluated on a lattice of ~NOISE_STEP_KM and bilinearly interpolated. */
function noiseLattice(w: number, h: number, cellKm: number, field: (xKm: number, yKm: number) => number): Float32Array {
  const step = Math.max(1, Math.round(NOISE_STEP_KM / cellKm));
  const lw = Math.ceil(w / step) + 1;
  const lh = Math.ceil(h / step) + 1;
  const lattice = new Float32Array(lw * lh);
  for (let b = 0; b < lh; b++) for (let a = 0; a < lw; a++) lattice[b * lw + a] = field(a * step * cellKm, b * step * cellKm);
  const out = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    const b = Math.floor(y / step);
    const fy = y / step - b;
    for (let x = 0; x < w; x++) {
      const a = Math.floor(x / step);
      const fx = x / step - a;
      const k = b * lw + a;
      const top = lattice[k] + (lattice[k + 1] - lattice[k]) * fx;
      const bottom = lattice[k + lw] + (lattice[k + lw + 1] - lattice[k + lw]) * fx;
      out[y * w + x] = top + (bottom - top) * fy;
    }
  }
  return out;
}

/** A grid `factor` times coarser: land if most of the block is land, mean slope and ceiling, max drawn area. */
function downsample(sea: Uint8Array, slope: Float32Array, ceiling: Float32Array, drawnArea: Float32Array, w: number, h: number, factor: number) {
  const cw = Math.ceil(w / factor);
  const ch = Math.ceil(h / factor);
  const out = { sea: new Uint8Array(cw * ch), slope: new Float32Array(cw * ch), ceiling: new Float32Array(cw * ch), drawnArea: new Float32Array(cw * ch), w: cw, h: ch };
  for (let cy = 0; cy < ch; cy++) {
    for (let cx = 0; cx < cw; cx++) {
      let landCount = 0;
      let total = 0;
      let slopeSum = 0;
      let ceilingSum = 0;
      let maxArea = 0;
      for (let y = cy * factor; y < Math.min(h, (cy + 1) * factor); y++) {
        for (let x = cx * factor; x < Math.min(w, (cx + 1) * factor); x++) {
          const i = y * w + x;
          total++;
          maxArea = Math.max(maxArea, drawnArea[i]);
          if (sea[i]) continue;
          landCount++;
          slopeSum += slope[i];
          ceilingSum += ceiling[i];
        }
      }
      const c = cy * cw + cx;
      out.drawnArea[c] = maxArea;
      if (landCount * 2 < total) out.sea[c] = 1;
      else {
        out.slope[c] = slopeSum / landCount;
        out.ceiling[c] = ceilingSum / landCount;
      }
    }
  }
  return out;
}

/**
 * Bed height (m above sea level) of the cells under the drawn rivers; NaN elsewhere.
 * Long profile of each river, source → mouth: under both banks (the ground the
 * land would have around it, minus BANK_MARGIN_M) and only going down:
 *     b_i = min(bankLimit_i, b_{i−1} − RIVER_MIN_SLOPE · Δs)
 * A tributary is then raised from its mouth upwards so that it meets its main
 * river at the main river's level (main rivers are done first).
 */
function riverBeds(rivers: readonly DrawnRiver[], sea: Uint8Array, w: number, h: number, cellKm: number, groundAt: (x: number, y: number) => number): Float32Array {
  const bed = new Float32Array(w * h).fill(NaN);
  for (const river of riverOrder(rivers)) {
    const cells: number[] = [];
    const along: number[] = [];
    const p = river.pointsKm;
    let arc = 0;
    for (let k = 0; k + 3 < p.length; k += 2) {
      const len = Math.hypot(p[k + 2] - p[k], p[k + 3] - p[k + 1]);
      const steps = Math.max(1, Math.ceil(len / (cellKm / 2)));
      for (let s = 0; s <= steps; s++) {
        const t = s / steps;
        const cx = Math.floor((p[k] + (p[k + 2] - p[k]) * t) / cellKm);
        const cy = Math.floor((p[k + 1] + (p[k + 3] - p[k + 1]) * t) / cellKm);
        if (cx < 0 || cy < 0 || cx >= w || cy >= h) continue;
        const c = cy * w + cx;
        if (sea[c] || cells[cells.length - 1] === c) continue;
        cells.push(c);
        along.push(arc + len * t);
      }
      arc += len;
    }
    const m = cells.length;
    if (m === 0) continue;
    const b = new Float64Array(m);
    for (let i = 0; i < m; i++) {
      const c = cells[i];
      const x = c % w;
      const y = (c - x) / w;
      let limit = Infinity;
      for (let dy = -BANK_REACH_CELLS; dy <= BANK_REACH_CELLS; dy++) {
        for (let dx = -BANK_REACH_CELLS; dx <= BANK_REACH_CELLS; dx++) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= w || ny >= h || sea[ny * w + nx]) continue;
          limit = Math.min(limit, groundAt(nx, ny));
        }
      }
      limit = Math.max(0, limit - BANK_MARGIN_M);
      if (!Number.isNaN(bed[c])) limit = Math.min(limit, bed[c]); // a river already there (the main one)
      b[i] = i === 0 ? limit : Math.max(0, Math.min(limit, b[i - 1] - RIVER_MIN_SLOPE_M_PER_KM * (along[i] - along[i - 1])));
    }
    // Tributary: it ends on its main river, whose bed is already there; climb from that level.
    const mouthBed = bed[cells[m - 1]];
    if (!Number.isNaN(mouthBed) && joinOf(river, rivers)) {
      b[m - 1] = mouthBed;
      for (let i = m - 2; i >= 0; i--) b[i] = Math.max(b[i], b[i + 1] + RIVER_MIN_SLOPE_M_PER_KM * (along[i + 1] - along[i]));
    }
    for (let i = 0; i < m; i++) {
      const c = cells[i];
      bed[c] = Number.isNaN(bed[c]) ? b[i] : Math.min(bed[c], b[i]);
    }
  }
  return bed;
}

/** Main rivers before their tributaries (depth in the river tree), loops cut. */
function riverOrder(rivers: readonly DrawnRiver[]): DrawnRiver[] {
  const depth = new Map<string, number>();
  const depthOf = (river: DrawnRiver, seen: Set<string>): number => {
    const known = depth.get(river.id);
    if (known !== undefined) return known;
    const join = seen.has(river.id) ? null : joinOf(river, rivers);
    seen.add(river.id);
    const d = join ? depthOf(join.river, seen) + 1 : 0;
    depth.set(river.id, d);
    return d;
  };
  return [...rivers].sort((a, b) => depthOf(a, new Set()) - depthOf(b, new Set()));
}

/** Drained area (km²) forced on the cells under the drawn rivers, from their upstream length (Hack's law). */
function riverAreas(rivers: readonly DrawnRiver[], w: number, h: number, cellKm: number): Float32Array {
  const area = new Float32Array(w * h);
  const flows = riverFlowsKm(rivers);
  const step = cellKm / 2;
  for (const river of rivers) {
    const p = river.pointsKm;
    const flow = flows.get(river.id);
    for (let k = 0; k + 3 < p.length; k += 2) {
      const len = Math.hypot(p[k + 2] - p[k], p[k + 3] - p[k + 1]);
      const fa = flow?.[k / 2] ?? 0;
      const fb = flow?.[k / 2 + 1] ?? fa + len;
      const steps = Math.max(1, Math.ceil(len / step));
      for (let s = 0; s <= steps; s++) {
        const t = s / steps;
        const cx = Math.floor((p[k] + (p[k + 2] - p[k]) * t) / cellKm);
        const cy = Math.floor((p[k + 1] + (p[k + 3] - p[k + 1]) * t) / cellKm);
        if (cx < 0 || cy < 0 || cx >= w || cy >= h) continue;
        const upstreamKm = Math.max(cellKm, fa + (fb - fa) * t);
        const a = (upstreamKm / HACK_C) ** (1 / HACK_H);
        const c = cy * w + cx;
        if (a > area[c]) area[c] = a;
      }
    }
  }
  return area;
}

/**
 * Bucket queue (Dial's algorithm): keys are rounded down to BUCKET_M slices,
 * each slice a FIFO list. Push and pop are O(1) instead of O(log n) for a
 * binary heap. Within a slice the order is approximate (≤ BUCKET_M, below
 * the metre resolution of the altitudes); a cell still ends higher than the
 * cell it drains into, since every step cost is added to its parent's height.
 * Stale entries (a cell pushed again with a better key) are skipped by the caller.
 */
const BUCKET_M = 0.25;

class BucketQueue {
  private heads = new Int32Array(1024).fill(-1);
  private tails = new Int32Array(1024).fill(-1);
  private items: Int32Array;
  private next: Int32Array;
  private free = -1;
  private used = 0;
  private cursor = 0;
  size = 0;

  constructor(capacity: number) {
    this.items = new Int32Array(Math.max(16, capacity));
    this.next = new Int32Array(Math.max(16, capacity));
  }

  push(item: number, key: number): void {
    const b = Math.max(this.cursor, Math.floor(key / BUCKET_M));
    if (b >= this.heads.length) this.growBuckets(b + 1);
    let e = this.free;
    if (e >= 0) this.free = this.next[e];
    else {
      if (this.used === this.items.length) this.growEntries();
      e = this.used++;
    }
    this.items[e] = item;
    this.next[e] = -1;
    if (this.tails[b] >= 0) this.next[this.tails[b]] = e;
    else this.heads[b] = e;
    this.tails[b] = e;
    this.size++;
  }

  pop(): number {
    while (this.heads[this.cursor] < 0) this.cursor++;
    const e = this.heads[this.cursor];
    this.heads[this.cursor] = this.next[e];
    if (this.heads[this.cursor] < 0) this.tails[this.cursor] = -1;
    this.next[e] = this.free;
    this.free = e;
    this.size--;
    return this.items[e];
  }

  private growBuckets(min: number): void {
    const length = Math.max(min, this.heads.length * 2);
    const heads = new Int32Array(length).fill(-1);
    heads.set(this.heads);
    const tails = new Int32Array(length).fill(-1);
    tails.set(this.tails);
    this.heads = heads;
    this.tails = tails;
  }

  private growEntries(): void {
    const items = new Int32Array(this.items.length * 2);
    items.set(this.items);
    const next = new Int32Array(this.next.length * 2);
    next.set(this.next);
    this.items = items;
    this.next = next;
  }
}

function interpolate(table: readonly (readonly [number, number])[], x: number): number {
  if (x <= table[0][0]) return table[0][1];
  for (let i = 1; i < table.length; i++) {
    const [x1, y1] = table[i];
    if (x <= x1) {
      const [x0, y0] = table[i - 1];
      return y0 + ((y1 - y0) * (x - x0)) / (x1 - x0);
    }
  }
  return table[table.length - 1][1];
}
