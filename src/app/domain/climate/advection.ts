/**
 * ADVECTION — the wind carries the properties of the air with it.
 *
 * Air over a surface slowly takes that surface's temperature (and the sea
 * loads it with water vapour), but it keeps a MEMORY of where it came from.
 * Along the wind, a property P relaxes toward the local "equilibrium" value
 * P_eq over a distance L = wind speed × relaxation time:
 *
 *     dP/ds = (P_eq − P) / L        (s = distance travelled downwind)
 *
 * Discretised: P(cell) = P_eq + (P(upwind point) − P_eq) · e^(−Δs / L).
 * With westerlies at 8 m/s and τ = 1 day, L ≈ 700 km: mild ocean air reaches
 * deep inland (Western Europe), and the east coast of a continent gets
 * continental air instead (Japan's harsh winters vs. Brittany's mild ones).
 * Calm air (L → 0) simply takes the local value.
 *
 * Solved "semi-Lagrangian" style: for each cell we step back along the wind
 * to find where the air came from, and sample the field there (bilinear).
 * Updating IN PLACE while sweeping in alternating directions (Gauss–Seidel
 * "fast sweeping") propagates information across the whole map in a few
 * passes instead of one cell per pass.
 *
 * It runs on a COARSE grid (≤ ~256 cells per side): advection is a
 * large-scale process, and the coarse result is then added as a correction
 * to the fine, altitude-aware local temperatures.
 */

export interface CoarseGrid {
  readonly width: number;
  readonly height: number;
  /** Fine cells per coarse cell side. */
  readonly factor: number;
  readonly cellKm: number;
}

/** Mean of a fine field over each coarse cell. */
export function downsampleMean(fine: ArrayLike<number>, fineW: number, fineH: number, grid: CoarseGrid): Float32Array {
  const sum = new Float32Array(grid.width * grid.height);
  const count = new Uint32Array(grid.width * grid.height);
  for (let y = 0; y < fineH; y++) {
    const cy = Math.floor(y / grid.factor);
    for (let x = 0; x < fineW; x++) {
      const c = cy * grid.width + Math.floor(x / grid.factor);
      sum[c] += fine[y * fineW + x];
      count[c]++;
    }
  }
  for (let c = 0; c < sum.length; c++) sum[c] /= count[c] || 1;
  return sum;
}

/** Bilinear value of a coarse field at the centre of fine cell (x, y). */
export function upsampleAt(coarse: Float32Array, grid: CoarseGrid, x: number, y: number): number {
  const gx = Math.min(grid.width - 1, Math.max(0, (x + 0.5) / grid.factor - 0.5));
  const gy = Math.min(grid.height - 1, Math.max(0, (y + 0.5) / grid.factor - 0.5));
  return bilinear(coarse, grid.width, grid.height, gx, gy);
}

function bilinear(field: Float32Array, w: number, h: number, gx: number, gy: number): number {
  const x = Math.min(w - 1, Math.max(0, gx));
  const y = Math.min(h - 1, Math.max(0, gy));
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const x1 = Math.min(w - 1, x0 + 1);
  const y1 = Math.min(h - 1, y0 + 1);
  const fx = x - x0;
  const fy = y - y0;
  const top = field[y0 * w + x0] * (1 - fx) + field[y0 * w + x1] * fx;
  const bottom = field[y1 * w + x0] * (1 - fx) + field[y1 * w + x1] * fx;
  return top * (1 - fy) + bottom * fy;
}

/** Optional terrain blocking for `advect` (see terrain-flow.ts). */
export interface Blocking {
  /** Metres the air climbs from its upwind point into each cell (≥ 0). */
  readonly climbM: Float32Array;
  /** Thickness of air colder / warmer than the local equilibrium. */
  readonly coldDepthM: number;
  readonly warmDepthM: number;
}

/** Extra quantity injected into the air in each cell, then carried downwind (e.g. latent heat). */
export type AdvectionSource = Float32Array;

export interface AdvectionStep {
  /** Grid-space step back to the upwind point, in cells (y down). Zero when calm. */
  readonly dx: Float32Array;
  readonly dy: Float32Array;
  /** e^(−Δs/L) per cell: 0 = forget upwind air, 1 = keep it unchanged. */
  readonly memory: Float32Array;
}

/**
 * Relaxation in place: field = eq + (field(upwind) − eq) · memory.
 * `field` starts as anything (usually eq) and converges in a few sweeps.
 * `limit` optionally caps the value (e.g. humidity at saturation) — what is
 * removed there is what falls as rain.
 */
export function advect(
  field: Float32Array,
  eq: Float32Array,
  step: AdvectionStep,
  w: number,
  h: number,
  sweeps = 8,
  limit?: Float32Array,
  blocking?: Blocking,
  source?: AdvectionSource,
): void {
  // The wind does not change between sweeps: where each cell samples its
  // upwind air (4 neighbours + weights) and how much memory it keeps for cold
  // or warm air are computed once, then reused by every sweep.
  const up = upwindSampler(step, w, h);
  const size = w * h;
  const keptCold = new Float32Array(size);
  const keptWarm = new Float32Array(size);
  for (let c = 0; c < size; c++) {
    const mem = step.memory[c];
    const climb = blocking ? blocking.climbM[c] : 0;
    keptCold[c] = climb > 0 && blocking ? mem * Math.exp(-climb / blocking.coldDepthM) : mem;
    keptWarm[c] = climb > 0 && blocking ? mem * Math.exp(-climb / blocking.warmDepthM) : mem;
  }
  const { i00, i01, i10, i11, fx, fy } = up;
  for (let sweep = 0; sweep < sweeps; sweep++) {
    const reverseX = sweep % 2 === 1;
    const reverseY = sweep % 4 >= 2;
    for (let j = 0; j < h; j++) {
      const y = reverseY ? h - 1 - j : j;
      for (let k = 0; k < w; k++) {
        const c = y * w + (reverseX ? w - 1 - k : k);
        let value = eq[c];
        if (step.memory[c] > 0) {
          const top = field[i00[c]] + (field[i01[c]] - field[i00[c]]) * fx[c];
          const bottom = field[i10[c]] + (field[i11[c]] - field[i10[c]]) * fx[c];
          const upwind = top + (bottom - top) * fy[c];
          value += (upwind - value) * (upwind < value ? keptCold[c] : keptWarm[c]);
        }
        if (source) value += source[c];
        field[c] = limit && value > limit[c] ? limit[c] : value;
      }
    }
  }
}

/** Precomputed bilinear sampling of each cell's upwind point (one step back along the wind). */
interface UpwindSampler {
  readonly i00: Int32Array;
  readonly i01: Int32Array;
  readonly i10: Int32Array;
  readonly i11: Int32Array;
  readonly fx: Float32Array;
  readonly fy: Float32Array;
}

function upwindSampler(step: AdvectionStep, w: number, h: number): UpwindSampler {
  const size = w * h;
  const s = {
    i00: new Int32Array(size),
    i01: new Int32Array(size),
    i10: new Int32Array(size),
    i11: new Int32Array(size),
    fx: new Float32Array(size),
    fy: new Float32Array(size),
  };
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const c = y * w + x;
      const gx = Math.min(w - 1, Math.max(0, x - step.dx[c]));
      const gy = Math.min(h - 1, Math.max(0, y - step.dy[c]));
      const x0 = Math.floor(gx);
      const y0 = Math.floor(gy);
      const x1 = Math.min(w - 1, x0 + 1);
      const y1 = Math.min(h - 1, y0 + 1);
      s.i00[c] = y0 * w + x0;
      s.i01[c] = y0 * w + x1;
      s.i10[c] = y1 * w + x0;
      s.i11[c] = y1 * w + x1;
      s.fx[c] = gx - x0;
      s.fy[c] = gy - y0;
    }
  }
  return s;
}

/**
 * After `advect` with a `limit` has converged: how much each cell had to
 * remove to stay under the limit (the excess that condenses and falls).
 */
export function excessOverLimit(field: Float32Array, eq: Float32Array, step: AdvectionStep, limit: Float32Array, w: number, h: number): Float32Array {
  const excess = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const c = y * w + x;
      const mem = step.memory[c];
      const arriving = mem > 0 ? eq[c] + (bilinear(field, w, h, x - step.dx[c], y - step.dy[c]) - eq[c]) * mem : eq[c];
      excess[c] = Math.max(0, arriving - limit[c]);
    }
  }
  return excess;
}

/** Maximum of a fine field over each coarse cell. */
export function downsampleMax(fine: ArrayLike<number>, fineW: number, fineH: number, grid: CoarseGrid): Float32Array {
  const max = new Float32Array(grid.width * grid.height).fill(-Infinity);
  for (let y = 0; y < fineH; y++) {
    const cy = Math.floor(y / grid.factor);
    for (let x = 0; x < fineW; x++) {
      const c = cy * grid.width + Math.floor(x / grid.factor);
      if (fine[y * fineW + x] > max[c]) max[c] = fine[y * fineW + x];
    }
  }
  return max;
}

/**
 * Bilinear upsampling of a whole coarse field to the fine grid (same result
 * as upsampleAt per cell). Interpolation weights are computed once per column
 * and per row instead of per cell: this loop runs 12 × millions of times.
 */
export function upsampleInto(coarse: Float32Array, grid: CoarseGrid, fineW: number, fineH: number, out: Float32Array): void {
  const cw = grid.width;
  const axis = (n: number, coarseN: number) => {
    const i0 = new Int32Array(n);
    const i1 = new Int32Array(n);
    const f = new Float32Array(n);
    for (let k = 0; k < n; k++) {
      const g = Math.min(coarseN - 1, Math.max(0, (k + 0.5) / grid.factor - 0.5));
      i0[k] = Math.floor(g);
      i1[k] = Math.min(coarseN - 1, i0[k] + 1);
      f[k] = g - i0[k];
    }
    return { i0, i1, f };
  };
  const cols = axis(fineW, cw);
  const rows = axis(fineH, grid.height);
  for (let y = 0; y < fineH; y++) {
    const r0 = rows.i0[y] * cw;
    const r1 = rows.i1[y] * cw;
    const fy = rows.f[y];
    const o = y * fineW;
    for (let x = 0; x < fineW; x++) {
      const a = cols.i0[x];
      const b = cols.i1[x];
      const fx = cols.f[x];
      const top = coarse[r0 + a] + (coarse[r0 + b] - coarse[r0 + a]) * fx;
      const bottom = coarse[r1 + a] + (coarse[r1 + b] - coarse[r1 + a]) * fx;
      out[o + x] = top + (bottom - top) * fy;
    }
  }
}

/** How much the air climbs from its upwind point into each cell, metres (0 when descending or calm). */
export function climbAlongWind(heightM: Float32Array, step: AdvectionStep, w: number, h: number): Float32Array {
  const climb = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const c = y * w + x;
      if (step.memory[c] > 0) climb[c] = Math.max(0, heightM[c] - bilinear(heightM, w, h, x - step.dx[c], y - step.dy[c]));
    }
  }
  return climb;
}
