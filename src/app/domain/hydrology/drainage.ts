/**
 * Drainage network of a heightmap: where does the rain falling on each cell go?
 *
 * Classic pipeline (fill sinks → D8 directions → accumulation), done here in a
 * single "priority-flood" pass that gives all three building blocks at once.
 *
 * Priority-flood (Barnes et al. 2014), the intuition: the sea rises.
 *  - Start from the outlets (sea cells, and land cells on the map frame where
 *    water leaves the map), put them in a priority queue keyed by altitude.
 *  - Repeatedly pop the LOWEST cell of the queue and push its unvisited
 *    neighbours. A neighbour lower than the cell that reached it is a pit: its
 *    water level is raised to that cell's altitude ("filled"), like a lake that
 *    fills until it spills over the lowest point of its rim.
 *  - The cell that pushed a neighbour is that neighbour's RECEIVER: water flows
 *    from the neighbour into it. Since cells pop in non-decreasing filled
 *    altitude, the first neighbour to pop is the lowest one: this is the D8 rule
 *    ("flow to the lowest of the 8 neighbours"), but it also works across flats
 *    and lakes, where plain D8 has no lower neighbour and gets stuck.
 *  - The pop order is an upstream → … order reversed: every cell pops after its
 *    receiver. Walking it backwards visits each cell before its receiver, which
 *    is exactly what accumulation needs (no recursion, no sort).
 *
 * Altitudes are integers (Int16 metres), so the priority queue is a bucket
 * queue: one FIFO list per metre. Pop and push are O(1), the whole pass O(n).
 * FIFO matters on flats and lakes: water spreads breadth-first from the spill
 * point, so the flow converges to it instead of snaking around.
 */

/** Receiver of an outlet cell (sea, or the map frame): the water leaves the drainage. */
export const NO_RECEIVER = -1;

export interface Drainage {
  readonly widthCells: number;
  readonly heightCells: number;
  /** Altitude after filling the pits (m). filledM − altitude = lake depth. */
  readonly filledM: Int16Array;
  /** Index of the cell each cell drains into, or NO_RECEIVER for outlets. */
  readonly receiver: Int32Array;
  /** All cells, each one after its receiver (downstream first). */
  readonly order: Int32Array;
}

const BUCKETS = 65536;
const BUCKET_OFFSET = 32768;
const NONE = -1;

/** Neighbour offsets (dx, dy), straight first. */
const DX = [1, -1, 0, 0, 1, 1, -1, -1];
const DY = [0, 0, 1, -1, 1, -1, 1, -1];

/**
 * @param altitudeM row-major altitudes, `widthCells × heightCells`.
 * @param sea 1 = sea cell (see computeSeaMask). Inland cells below sea level
 *   are land: filled like any pit, they become lakes, not outlets.
 */
export function computeDrainage(
  altitudeM: Int16Array,
  widthCells: number,
  heightCells: number,
  sea: Uint8Array,
): Drainage {
  const w = widthCells;
  const h = heightCells;
  const n = w * h;
  if (altitudeM.length !== n || sea.length !== n) throw new RangeError(`Expected ${n} cells, got ${altitudeM.length} altitudes, ${sea.length} sea flags`);

  const filledM = new Int16Array(altitudeM);
  const receiver = new Int32Array(n).fill(NO_RECEIVER);
  const order = new Int32Array(n);
  const visited = new Uint8Array(n);

  // Bucket queue: per altitude, a FIFO linked list (head, tail) through `next`.
  const head = new Int32Array(BUCKETS).fill(NONE);
  const tail = new Int32Array(BUCKETS).fill(NONE);
  const next = new Int32Array(n).fill(NONE);
  let lowest = BUCKETS;
  const push = (i: number, levelM: number): void => {
    const b = levelM + BUCKET_OFFSET;
    if (tail[b] === NONE) head[b] = i;
    else next[tail[b]] = i;
    tail[b] = i;
    if (b < lowest) lowest = b;
  };

  // Seeds: sea cells and the land frame.
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const onFrame = x === 0 || y === 0 || x === w - 1 || y === h - 1;
      if (onFrame || sea[i]) {
        visited[i] = 1;
        push(i, altitudeM[i]);
      }
    }
  }

  let popped = 0;
  while (popped < n) {
    while (lowest < BUCKETS && head[lowest] === NONE) lowest++;
    if (lowest === BUCKETS) break;
    const i = head[lowest];
    head[lowest] = next[i];
    if (head[lowest] === NONE) tail[lowest] = NONE;
    order[popped++] = i;

    const levelM = filledM[i];
    const x = i % w;
    const y = (i - x) / w;
    for (let k = 0; k < 8; k++) {
      const nx = x + DX[k];
      const ny = y + DY[k];
      if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
      const j = ny * w + nx;
      if (visited[j]) continue;
      visited[j] = 1;
      receiver[j] = i;
      if (filledM[j] < levelM) filledM[j] = levelM;
      push(j, filledM[j]);
    }
  }
  return { widthCells: w, heightCells: h, filledM, receiver, order };
}

/**
 * Flow accumulation: for each cell, the sum of `weight` over the cell and
 * everything upstream of it. With weight 1 it is the drainage area in cells;
 * with weight = runoff it is the discharge.
 */
export function accumulateFlow(drainage: Drainage, weight: Float32Array): Float32Array {
  const { order, receiver } = drainage;
  if (weight.length !== order.length) throw new RangeError(`Expected ${order.length} weights, got ${weight.length}`);
  const acc = new Float32Array(weight);
  for (let k = order.length - 1; k >= 0; k--) {
    const i = order[k];
    const r = receiver[i];
    if (r !== NO_RECEIVER) acc[r] += acc[i];
  }
  return acc;
}
