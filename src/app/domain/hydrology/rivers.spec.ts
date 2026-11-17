import { computeHydrology, findRiverPoint, lineCount, RiverNetwork } from './rivers';

/**
 * A V-shaped valley draining south into the sea: the land slopes down to the
 * central column (x = 10) and southwards; the last two rows are sea.
 */
function valley(w = 21, h = 30): Int16Array {
  const a = new Int16Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) a[y * w + x] = y >= h - 2 ? -50 : 20 + Math.abs(x - 10) * 10 + (h - y) * 3;
  }
  return a;
}

function line(network: RiverNetwork, k: number): { x: number; y: number; q: number }[] {
  const out = [];
  for (let p = network.starts[k]; p < network.starts[k + 1]; p++) {
    out.push({ x: network.pointsCells[2 * p], y: network.pointsCells[2 * p + 1], q: network.dischargeM3s[p] });
  }
  return out;
}

describe('computeHydrology', () => {
  it('turns runoff into discharge (1000 mm/year over 1 km² ≈ 0.032 m³/s)', () => {
    const w = 21;
    const h = 30;
    const runoff = new Float32Array(w * h).fill(1000);
    const result = computeHydrology(valley(w, h), w, h, 0, 1, runoff);
    const perCell = (1000 * 1000) / (365.25 * 86400);
    // The valley floor just above the sea collects (almost) the whole land.
    const mouth = (h - 3) * w + 10;
    expect(result.dischargeM3s[mouth] / perCell).toBeGreaterThan(w * (h - 2) * 0.5);
  });

  it('draws the main river as one unbroken line from spring to sea', () => {
    const w = 21;
    const h = 30;
    // Enough runoff for rivers everywhere on the valley floor.
    const runoff = new Float32Array(w * h).fill(20000);
    const { rivers } = computeHydrology(valley(w, h), w, h, 0, 1, runoff);
    expect(lineCount(rivers)).toBeGreaterThan(0);
    // The line with the largest flow reaches the sea row on the central column.
    let main = 0;
    for (let k = 1; k < lineCount(rivers); k++) if (rivers.lineMaxDischargeM3s[k] > rivers.lineMaxDischargeM3s[main]) main = k;
    const points = line(rivers, main);
    const last = points[points.length - 1];
    // Any sea neighbour of the last land cell is a valid mouth (they are all at the same depth).
    expect(last.y).toBe(h - 2 + 0.5);
    expect(Math.abs(last.x - 10.5)).toBeLessThanOrEqual(1);
    // Flow never decreases downstream along a line.
    for (let k = 1; k < points.length; k++) expect(points[k].q).toBeGreaterThanOrEqual(points[k - 1].q);
  });

  it('makes no river where it never rains', () => {
    const w = 21;
    const h = 30;
    const { rivers } = computeHydrology(valley(w, h), w, h, 0, 1, new Float32Array(w * h));
    expect(lineCount(rivers)).toBe(0);
  });

  it('finds the river point nearest to a click', () => {
    const w = 21;
    const h = 30;
    const { rivers } = computeHydrology(valley(w, h), w, h, 0, 1, new Float32Array(w * h).fill(20000));
    const hit = findRiverPoint(rivers, 10.5, 15.2, 2);
    expect(hit).not.toBeNull();
    expect(rivers.pointsCells[2 * hit!.point]).toBe(10.5);
    expect(findRiverPoint(rivers, 0.5, 0.5, 1)).toBeNull();
  });
});
