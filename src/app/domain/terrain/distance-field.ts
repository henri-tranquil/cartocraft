/**
 * Chamfer distance transform: for every cell of `inside` (non-zero), the
 * distance in cells to the nearest cell outside it. Outside cells get 0.
 *
 * Exact Euclidean distance would need, for each cell, a search over all
 * sources. The chamfer trick propagates distances instead, in two raster
 * sweeps: top-left → bottom-right (each cell looks at its already-visited
 * neighbours: left, up-left, up, up-right), then bottom-right → top-left.
 * A step costs 1 straight and √2 diagonally, so the result is the length of
 * the shortest 8-connected path: within ~8 % of the true distance, in O(n).
 *
 * Map edges are not sources: a continent cut by the frame is not "coast" there.
 * Cells with no outside cell anywhere stay at +Infinity.
 */
export function chamferDistance(inside: Uint8Array, widthCells: number, heightCells: number): Float32Array {
  const w = widthCells;
  const h = heightCells;
  const d = new Float32Array(w * h);
  for (let i = 0; i < d.length; i++) d[i] = inside[i] ? Infinity : 0;
  const diag = Math.SQRT2;

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      let best = d[i];
      if (best === 0) continue;
      if (x > 0) best = Math.min(best, d[i - 1] + 1);
      if (y > 0) {
        best = Math.min(best, d[i - w] + 1);
        if (x > 0) best = Math.min(best, d[i - w - 1] + diag);
        if (x < w - 1) best = Math.min(best, d[i - w + 1] + diag);
      }
      d[i] = best;
    }
  }
  for (let y = h - 1; y >= 0; y--) {
    for (let x = w - 1; x >= 0; x--) {
      const i = y * w + x;
      let best = d[i];
      if (best === 0) continue;
      if (x < w - 1) best = Math.min(best, d[i + 1] + 1);
      if (y < h - 1) {
        best = Math.min(best, d[i + w] + 1);
        if (x < w - 1) best = Math.min(best, d[i + w + 1] + diag);
        if (x > 0) best = Math.min(best, d[i + w - 1] + diag);
      }
      d[i] = best;
    }
  }
  return d;
}
