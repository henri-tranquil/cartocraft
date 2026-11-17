import { describe, expect, it } from 'vitest';
import { placeForests, TREE_STRIDE } from './vintage-forests';
import { VintageClimate } from './vintage-climate';

const W = 300;
const input = { altitudeM: new Int16Array(W * W).fill(100), widthCells: W, heightCells: W, seaLevelM: 0, seed: 3 };

function climate(wetnessPct: number, meanC: number, warmestC: number): VintageClimate {
  return {
    wetnessPct: new Uint8Array(W * W).fill(wetnessPct),
    meanDeciC: new Int16Array(W * W).fill(meanC * 10),
    warmestDeciC: new Int16Array(W * W).fill(warmestC * 10),
  };
}

describe('placeForests', () => {
  it('needs a climate, rain and a warm enough summer', () => {
    expect(placeForests(input, null).length).toBe(0);
    expect(placeForests(input, climate(10, 15, 25)).length).toBe(0); // too dry
    expect(placeForests(input, climate(90, -5, 6)).length).toBe(0); // above the tree line
    expect(placeForests(input, climate(90, 15, 25)).length).toBeGreaterThan(0);
  });

  it('picks conifers in cold climates and broadleaf trees in mild ones', () => {
    const kinds = (c: VintageClimate) => {
      const t = placeForests(input, c);
      const out = new Set<number>();
      for (let i = 0; i < t.length; i += TREE_STRIDE) out.add(t[i + 4]);
      return [...out];
    };
    expect(kinds(climate(90, 0, 16))).toEqual([1]);
    expect(kinds(climate(90, 16, 26))).toEqual([0]);
  });
});
