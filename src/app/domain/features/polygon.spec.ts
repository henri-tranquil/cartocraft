import { poleOfInaccessibility, ringArea, signedDistanceToRing, simplifyPolyline } from './polygon';

const square = [0, 0, 10, 0, 10, 10, 0, 10];
/** A "C" open to the east: its centroid region (5, 5) is outside. */
const crescent = [0, 0, 10, 0, 10, 3, 3, 3, 3, 7, 10, 7, 10, 10, 0, 10];

describe('polygon', () => {
  it('computes the area of a ring', () => {
    expect(ringArea(square)).toBe(100);
    expect(ringArea([...square].reverse())).toBe(100);
  });

  it('signs the distance: positive inside, negative outside', () => {
    expect(signedDistanceToRing(square, 5, 5)).toBeCloseTo(5);
    expect(signedDistanceToRing(square, 12, 5)).toBeCloseTo(-2);
  });

  it('finds the pole of inaccessibility inside a crescent', () => {
    expect(signedDistanceToRing(crescent, 5, 5)).toBeLessThan(0);
    const pole = poleOfInaccessibility(crescent, 0.01);
    expect(signedDistanceToRing(crescent, pole.x, pole.y)).toBeGreaterThan(1.4);
    expect(pole.x).toBeLessThan(3);
  });

  it('simplifies a near-straight line to its ends', () => {
    const line = [0, 0, 1, 0.01, 2, -0.01, 3, 0, 4, 2, 5, 0];
    expect(simplifyPolyline(line, 0.1)).toEqual([0, 0, 3, 0, 4, 2, 5, 0]);
  });
});
