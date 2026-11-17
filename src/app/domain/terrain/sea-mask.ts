/**
 * Which cells are SEA? Not simply "altitude ≤ sea level": a basin below sea
 * level that does not touch the ocean (the Dead Sea, the Caspian, a lagoon
 * cut off at this resolution) is dry land, a lake or a polder, never sea.
 *
 * Rule: sea = cells at or below sea level connected to the map frame through
 * other such cells. The ocean is assumed to lie beyond any low edge cell.
 * Flood fill from those frame cells (breadth-first, 8 neighbours: a 1-cell
 * strait drawn diagonally still lets the sea through). O(n).
 *
 * Inland low cells stay land here; hydrology fills them (future lakes).
 * Limit: a map whose low cells never reach the frame has no sea at all.
 */
export function computeSeaMask(altitudeM: Int16Array, widthCells: number, heightCells: number, seaLevelM: number): Uint8Array {
  const w = widthCells;
  const h = heightCells;
  const n = w * h;
  if (altitudeM.length !== n) throw new RangeError(`Expected ${n} altitudes, got ${altitudeM.length}`);
  const sea = new Uint8Array(n);
  const queue = new Int32Array(n);
  let tail = 0;
  const frame = (i: number): void => {
    if (!sea[i] && altitudeM[i] <= seaLevelM) {
      sea[i] = 1;
      queue[tail++] = i;
    }
  };
  for (let x = 0; x < w; x++) {
    frame(x);
    frame((h - 1) * w + x);
  }
  for (let y = 0; y < h; y++) {
    frame(y * w);
    frame(y * w + w - 1);
  }
  // Hot loop (millions of cells): neighbours inlined, no closure call.
  for (let k = 0; k < tail; k++) {
    const i = queue[k];
    const x = i % w;
    const y = (i - x) / w;
    const x0 = x > 0 ? x - 1 : x;
    const x1 = x < w - 1 ? x + 1 : x;
    const y0 = y > 0 ? y - 1 : y;
    const y1 = y < h - 1 ? y + 1 : y;
    for (let ny = y0; ny <= y1; ny++) {
      const row = ny * w;
      for (let nx = x0; nx <= x1; nx++) {
        const j = row + nx;
        if (sea[j] === 0 && altitudeM[j] <= seaLevelM) {
          sea[j] = 1;
          queue[tail++] = j;
        }
      }
    }
  }
  return sea;
}
