import { computeLakes } from './lakes';
import { computeDrainage } from './drainage';
import { computeSeaMask } from '../terrain/sea-mask';

/**
 * 7 × 5: sea on the left column, a basin in the middle (bottom 10 m) whose
 * rim spills at 40 m on the left side, high ground (100 m) elsewhere.
 */
const W = 7;
const H = 5;
// prettier-ignore
const ALT = new Int16Array([
  -5, 100, 100, 100, 100, 100, 100,
  -5,  40,  30,  20,  30, 100, 100,
  -5, 100,  20,  10,  20, 100, 100,
  -5, 100,  30,  20,  30, 100, 100,
  -5, 100, 100, 100, 100, 100, 100,
]);

function lakes(surfaceM: number | null, x = 3, y = 2) {
  const sea = computeSeaMask(ALT, W, H, 0);
  const { filledM } = computeDrainage(ALT, W, H, sea);
  return computeLakes(ALT, filledM, sea, W, H, [{ xCell: x, yCell: y, surfaceM }]);
}

describe('computeLakes', () => {
  it('brim-full: fills the basin up to its spill level', () => {
    const { lakeId, lakes: info } = lakes(null);
    expect(info[0].surfaceM).toBe(40);
    expect(info[0].areaCells).toBe(9); // the 3 × 3 basin, all below 40 m
    expect(lakeId[2 * W + 3]).toBe(1);
    expect(lakeId[1 * W + 1]).toBe(0); // the spill cell itself stays dry
  });

  it('a lower level floods only the deep part', () => {
    const { lakes: info, lakeId } = lakes(25);
    expect(info[0].areaCells).toBe(5); // 10 m and the four 20 m cells
    expect(lakeId[1 * W + 2]).toBe(0);
  });

  it('caps a level above the spill point (water would flow out)', () => {
    expect(lakes(500).lakes[0]).toEqual({ surfaceM: 40, areaCells: 9 });
  });

  it('a seed on high ground or outside the map makes a dry lake', () => {
    expect(lakes(null, 6, 0).lakes[0].areaCells).toBe(0);
    expect(lakes(null, 99, 0).lakes[0].areaCells).toBe(0);
  });
});
