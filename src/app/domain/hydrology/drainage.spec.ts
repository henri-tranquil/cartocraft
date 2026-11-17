import { accumulateFlow, computeDrainage, NO_RECEIVER } from './drainage';
import { computeSeaMask } from '../terrain/sea-mask';

/** Builds a row-major Int16 grid from rows of altitudes. */
function grid(rows: number[][]): { altitudeM: Int16Array; w: number; h: number } {
  const h = rows.length;
  const w = rows[0].length;
  return { altitudeM: Int16Array.from(rows.flat()), w, h };
}

describe('computeDrainage', () => {
  it('fills a pit up to the lowest point of its rim', () => {
    const { altitudeM, w, h } = grid([
      [9, 9, 9, 9, 9],
      [9, 5, 5, 5, 9],
      [9, 5, 1, 5, 9],
      [9, 5, 5, 5, 9],
      [9, 9, 3, 9, 9],
    ]);
    const d = computeDrainage(altitudeM, w, h, computeSeaMask(altitudeM, w, h, -100));
    // The basin spills over the rim cell at altitude 3: interior filled to 5 (its own floor), pit 1 → 5.
    expect(d.filledM[2 * w + 2]).toBe(5);
    expect(d.filledM[1 * w + 1]).toBe(5);
    expect(d.filledM[4 * w + 2]).toBe(3);
  });

  it('raises a closed depression to its spill level', () => {
    const { altitudeM, w, h } = grid([
      [0, 0, 0, 0, 0],
      [0, 8, 8, 8, 0],
      [0, 8, 2, 8, 0],
      [0, 8, 6, 8, 0],
      [0, 0, 0, 0, 0],
    ]);
    const d = computeDrainage(altitudeM, w, h, computeSeaMask(altitudeM, w, h, 0));
    // Lowest rim cell is 6: the lake surface sits at 6, 4 m deep.
    expect(d.filledM[2 * w + 2]).toBe(6);
    expect(d.receiver[2 * w + 2]).toBe(3 * w + 2);
  });

  it('marks sea and frame cells as outlets, and drains land downhill to the sea', () => {
    const { altitudeM, w, h } = grid([
      [-5, 1, 2, 3],
      [-5, 1, 2, 3],
      [-5, 1, 2, 3],
    ]);
    const d = computeDrainage(altitudeM, w, h, computeSeaMask(altitudeM, w, h, 0));
    expect(d.receiver[0]).toBe(NO_RECEIVER);
    expect(d.receiver[w + 3]).toBe(NO_RECEIVER); // frame
    expect(altitudeM[d.receiver[w + 1]]).toBeLessThanOrEqual(0); // (1,1) drains into the sea
  });

  it('routes every land cell to an outlet, each one after its receiver in `order`', () => {
    const w = 40;
    const h = 30;
    const altitudeM = new Int16Array(w * h);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        // Bumpy dome with pits, sea in the corners.
        altitudeM[y * w + x] = Math.round(300 - Math.hypot(x - 20, y - 15) * 12 + 40 * Math.sin(x * 1.3) * Math.cos(y * 0.9));
      }
    }
    const d = computeDrainage(altitudeM, w, h, computeSeaMask(altitudeM, w, h, 0));
    const position = new Int32Array(w * h).fill(-1);
    d.order.forEach((cell, k) => (position[cell] = k));
    for (let i = 0; i < w * h; i++) {
      expect(position[i]).toBeGreaterThanOrEqual(0);
      const r = d.receiver[i];
      if (r === NO_RECEIVER) continue;
      expect(position[r]).toBeLessThan(position[i]);
      // Water never flows uphill on the filled surface.
      expect(d.filledM[r]).toBeLessThanOrEqual(d.filledM[i]);
      expect(d.filledM[i]).toBeGreaterThanOrEqual(altitudeM[i]);
    }
  });
});

describe('accumulateFlow', () => {
  it('sums the weights of all upstream cells', () => {
    // A valley sloping down to the sea on the left: everything ends in the middle row.
    const { altitudeM, w, h } = grid([
      [9, 9, 9, 9, 9],
      [-1, 1, 2, 3, 9],
      [9, 9, 9, 9, 9],
    ]);
    const d = computeDrainage(altitudeM, w, h, computeSeaMask(altitudeM, w, h, 0));
    const acc = accumulateFlow(d, new Float32Array(w * h).fill(1));
    // (3,1) → (2,1) → (1,1) → sea; frame cells are outlets of their own.
    expect(d.receiver[w + 3]).toBe(w + 2);
    expect(d.receiver[w + 2]).toBe(w + 1);
    expect(acc[w + 1]).toBe(3);
  });

  it('conserves the total weight at the outlets', () => {
    const w = 25;
    const h = 25;
    const altitudeM = new Int16Array(w * h);
    for (let i = 0; i < w * h; i++) altitudeM[i] = (i * 7919) % 500;
    const d = computeDrainage(altitudeM, w, h, computeSeaMask(altitudeM, w, h, 0));
    const acc = accumulateFlow(d, new Float32Array(w * h).fill(1));
    let atOutlets = 0;
    for (let i = 0; i < w * h; i++) if (d.receiver[i] === NO_RECEIVER) atOutlets += acc[i];
    expect(atOutlets).toBe(w * h);
  });
});
