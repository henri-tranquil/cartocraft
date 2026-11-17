import { describe, expect, it } from 'vitest';
import { chamferDistance } from './distance-field';
import { contourSegments } from './contour';
import { fbm, hash2, valueNoise } from './noise';

describe('noise', () => {
  it('is deterministic and in [0, 1)', () => {
    expect(hash2(7, 3, -4)).toBe(hash2(7, 3, -4));
    expect(hash2(7, 3, -4)).not.toBe(hash2(8, 3, -4));
    for (let i = 0; i < 200; i++) {
      const v = fbm(42, i * 0.37, i * 0.11, 4);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it('value noise hits the lattice values at integer points', () => {
    expect(valueNoise(5, 2, 3)).toBeCloseTo(hash2(5, 2, 3), 10);
  });
});

describe('chamferDistance', () => {
  it('measures straight and diagonal distances to the nearest outside cell', () => {
    // 5 × 5 inside, single outside cell at the centre.
    const inside = new Uint8Array(25).fill(1);
    inside[12] = 0;
    const d = chamferDistance(inside, 5, 5);
    expect(d[12]).toBe(0);
    expect(d[13]).toBe(1);
    expect(d[14]).toBe(2);
    expect(d[18]).toBeCloseTo(Math.SQRT2);
    expect(d[0]).toBeCloseTo(2 * Math.SQRT2);
  });

  it('stays infinite without any outside cell', () => {
    expect(chamferDistance(new Uint8Array(4).fill(1), 2, 2)[0]).toBe(Infinity);
  });
});

describe('contourSegments', () => {
  it('draws a closed diamond around a single high cell', () => {
    const values = new Float32Array(9);
    values[4] = 10; // centre of a 3 × 3 grid
    const segs = contourSegments(values, 3, 3, 5);
    expect(segs.length).toBe(4 * 4); // four blocks, one segment each
    // Crossings halfway between the centre (1.5, 1.5) and its neighbours.
    const xs = new Set<number>();
    for (let i = 0; i < segs.length; i += 2) xs.add(segs[i]);
    expect([...xs].sort()).toEqual([1, 1.5, 2]);
  });

  it('interpolates the crossing point linearly', () => {
    // Two cells: 0 then 10, level 2.5 → crossing a quarter of the way.
    const values = new Float32Array([0, 10, 0, 10]);
    const segs = contourSegments(values, 2, 2, 2.5);
    expect(Array.from(segs)).toEqual([0.75, 0.5, 0.75, 1.5]);
  });
});
