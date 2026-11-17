/**
 * Marching squares: the iso-line `value = level` of a row-major grid, as
 * independent segments [x0, y0, x1, y1, …] in cell coordinates (cell (x, y)
 * covers [x, x+1] × [y, y+1], its value sits at its centre).
 *
 * We look at each 2 × 2 block of cell centres. Each corner is above or below
 * the level: 4 bits → 16 cases, each one a fixed set of segments joining the
 * block's edges. Where the line crosses an edge is found by linear
 * interpolation, so the line is smooth (sub-cell) rather than staircase.
 *
 * Two cases are ambiguous (diagonal corners above, the others below): is it
 * one ridge or two bumps? We decide with the block's mean value.
 */
export function contourSegments(
  values: ArrayLike<number>,
  widthCells: number,
  heightCells: number,
  level: number,
): Float32Array {
  const w = widthCells;
  const out: number[] = [];

  for (let y = 0; y < heightCells - 1; y++) {
    for (let x = 0; x < w - 1; x++) {
      const i = y * w + x;
      const a = values[i]; // top-left
      const b = values[i + 1]; // top-right
      const c = values[i + w + 1]; // bottom-right
      const d = values[i + w]; // bottom-left
      const code = (a > level ? 8 : 0) | (b > level ? 4 : 0) | (c > level ? 2 : 0) | (d > level ? 1 : 0);
      if (code === 0 || code === 15) continue;

      emitBlock(out, code, a, b, c, d, x + 0.5, y + 0.5, level);
    }
  }
  return Float32Array.from(out);
}

/**
 * Segments of one 2 × 2 block. Kept out of the loop on purpose: closures in
 * the loop body would make V8 allocate their captured variables for every
 * block, even the 99 % that have no segment.
 */
function emitBlock(out: number[], code: number, a: number, b: number, c: number, d: number, cx: number, cy: number, level: number): void {
  const top = (): [number, number] => [cx + (level - a) / (b - a), cy];
  const right = (): [number, number] => [cx + 1, cy + (level - b) / (c - b)];
  const bottom = (): [number, number] => [cx + (level - d) / (c - d), cy + 1];
  const left = (): [number, number] => [cx, cy + (level - a) / (d - a)];
  const seg = (p: [number, number], q: [number, number]) => out.push(p[0], p[1], q[0], q[1]);
  const centreAbove = (a + b + c + d) / 4 > level;

  switch (code) {
    case 1: case 14: seg(left(), bottom()); break;
    case 2: case 13: seg(bottom(), right()); break;
    case 3: case 12: seg(left(), right()); break;
    case 4: case 11: seg(top(), right()); break;
    case 6: case 9: seg(top(), bottom()); break;
    case 7: case 8: seg(left(), top()); break;
    case 5: // b and d above
      if (centreAbove) { seg(left(), top()); seg(bottom(), right()); }
      else { seg(top(), right()); seg(left(), bottom()); }
      break;
    case 10: // a and c above
      if (centreAbove) { seg(top(), right()); seg(left(), bottom()); }
      else { seg(left(), top()); seg(bottom(), right()); }
      break;
  }
}
