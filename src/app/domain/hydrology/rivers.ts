import { accumulateFlow, computeDrainage, NO_RECEIVER } from './drainage';

/**
 * From runoff to rivers.
 *
 * 1. Discharge: every land cell yields its annual runoff (mm/year over its
 *    area); accumulating it downstream gives the mean flow of each cell, m³/s
 *    (1 mm over 1 km² = 1000 m³). So the "river threshold modulated by rain"
 *    of the plan is simply a discharge threshold: a wet slope makes a river
 *    from a small basin, a dry one needs a huge basin.
 * 2. Lines: cells above MIN_RIVER_DISCHARGE_M3S form a tree. At each
 *    confluence the tributary with the larger flow is the "main" one: a line
 *    starts at a spring and goes down while it stays the main branch, so the
 *    big rivers are single unbroken lines from spring to mouth, and every
 *    tributary is its own line ending on its confluence.
 */

export const MIN_RIVER_DISCHARGE_M3S = 1;
const SECONDS_PER_YEAR = 365.25 * 86400;

/** Polylines in cell coordinates (cell centres), with the discharge at each point. */
export interface RiverNetwork {
  /** Flat [x0, y0, x1, y1, …] over all lines. */
  readonly pointsCells: Float32Array;
  /** One value per point. */
  readonly dischargeM3s: Float32Array;
  /** Line k uses points starts[k] .. starts[k+1] − 1 (length = lines + 1). */
  readonly starts: Uint32Array;
  /** Per line: its largest discharge (the last point) — for zoom culling. */
  readonly lineMaxDischargeM3s: Float32Array;
  /** Per line: x0, y0, x1, y1 (cells) — for view culling. */
  readonly lineBounds: Float32Array;
}

export interface HydrologyResult {
  readonly widthCells: number;
  readonly heightCells: number;
  /** Mean annual flow through each cell, m³/s (row-major). */
  readonly dischargeM3s: Float32Array;
  readonly rivers: RiverNetwork;
}

export function lineCount(network: RiverNetwork): number {
  return network.starts.length - 1;
}

export function computeHydrology(
  altitudeM: Int16Array,
  widthCells: number,
  heightCells: number,
  seaLevelM: number,
  cellKm: number,
  runoffMm: Float32Array,
): HydrologyResult {
  const n = widthCells * heightCells;
  const drainage = computeDrainage(altitudeM, widthCells, heightCells, seaLevelM);
  const m3sPerMm = (cellKm * cellKm * 1000) / SECONDS_PER_YEAR;
  const yieldM3s = new Float32Array(n);
  for (let i = 0; i < n; i++) if (altitudeM[i] > seaLevelM) yieldM3s[i] = runoffMm[i] * m3sPerMm;
  const discharge = accumulateFlow(drainage, yieldM3s);
  const rivers = extractRivers(drainage.receiver, discharge, altitudeM, seaLevelM, widthCells);
  return { widthCells, heightCells, dischargeM3s: discharge, rivers };
}

export function extractRivers(
  receiver: Int32Array,
  discharge: Float32Array,
  altitudeM: Int16Array,
  seaLevelM: number,
  widthCells: number,
  minDischargeM3s = MIN_RIVER_DISCHARGE_M3S,
): RiverNetwork {
  const n = receiver.length;
  const isRiver = (i: number) => discharge[i] >= minDischargeM3s && altitudeM[i] > seaLevelM;

  // For each river cell: its biggest river tributary (−1 = none: a spring).
  const mainUp = new Int32Array(n).fill(-1);
  for (let i = 0; i < n; i++) {
    if (!isRiver(i)) continue;
    const r = receiver[i];
    if (r === NO_RECEIVER || !isRiver(r)) continue;
    if (mainUp[r] < 0 || discharge[i] > discharge[mainUp[r]]) mainUp[r] = i;
  }

  const points: number[] = [];
  const flows: number[] = [];
  const starts: number[] = [0];
  const maxFlows: number[] = [];
  const bounds: number[] = [];
  const push = (cell: number, flow: number) => {
    points.push((cell % widthCells) + 0.5, Math.floor(cell / widthCells) + 0.5);
    flows.push(flow);
  };

  for (let head = 0; head < n; head++) {
    if (!isRiver(head) || mainUp[head] >= 0) continue; // not a spring
    const first = flows.length;
    let cell = head;
    for (;;) {
      push(cell, discharge[cell]);
      const r = receiver[cell];
      if (r === NO_RECEIVER) break; // leaves the map
      if (!isRiver(r)) {
        if (altitudeM[r] <= seaLevelM) push(r, discharge[cell]); // the mouth, on the shore
        break;
      }
      if (mainUp[r] !== cell) {
        push(r, discharge[r]); // a tributary: end on the confluence
        break;
      }
      cell = r;
    }
    let x0 = Infinity;
    let y0 = Infinity;
    let x1 = -Infinity;
    let y1 = -Infinity;
    let maxFlow = 0;
    for (let k = first; k < flows.length; k++) {
      maxFlow = Math.max(maxFlow, flows[k]);
      x0 = Math.min(x0, points[2 * k]);
      x1 = Math.max(x1, points[2 * k]);
      y0 = Math.min(y0, points[2 * k + 1]);
      y1 = Math.max(y1, points[2 * k + 1]);
    }
    starts.push(flows.length);
    maxFlows.push(maxFlow);
    bounds.push(x0, y0, x1, y1);
  }

  return {
    pointsCells: Float32Array.from(points),
    dischargeM3s: Float32Array.from(flows),
    starts: Uint32Array.from(starts),
    lineMaxDischargeM3s: Float32Array.from(maxFlows),
    lineBounds: Float32Array.from(bounds),
  };
}

/**
 * River point nearest to (xCell, yCell) within `radiusCells` (ties: the larger
 * flow), as { line, point } indices into the network; null if none.
 * A tributary's last point is its confluence, which belongs to the main
 * river, so it is skipped: clicking a tributary names the tributary.
 */
export function findRiverPoint(network: RiverNetwork, xCell: number, yCell: number, radiusCells: number): { line: number; point: number } | null {
  const { pointsCells: pts, dischargeM3s: q, starts, lineBounds: b } = network;
  let best: { line: number; point: number } | null = null;
  let bestD = radiusCells * radiusCells;
  let bestQ = -1;
  for (let k = 0; k < starts.length - 1; k++) {
    if (xCell < b[4 * k] - radiusCells || xCell > b[4 * k + 2] + radiusCells || yCell < b[4 * k + 1] - radiusCells || yCell > b[4 * k + 3] + radiusCells) continue;
    for (let p = starts[k]; p < starts[k + 1] - 1; p++) {
      const dx = pts[2 * p] - xCell;
      const dy = pts[2 * p + 1] - yCell;
      const d = dx * dx + dy * dy;
      if (d < bestD || (d === bestD && q[p] > bestQ)) {
        bestD = d;
        bestQ = q[p];
        best = { line: k, point: p };
      }
    }
  }
  return best;
}
