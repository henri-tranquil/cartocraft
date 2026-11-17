import { climateDomainFor, cropToMap, padField } from './climate-domain';

describe('climate domain', () => {
  it('adds a margin and keeps the domain within budget', () => {
    const d = climateDomainFor(1700, 1700, 1);
    expect(d.width).toBeLessThanOrEqual(320);
    expect(d.margin * d.cellKm).toBeGreaterThan(700);
  });

  it('fills the margin per edge and crops back to the map', () => {
    const d = { map: { width: 2, height: 1, factor: 1, cellKm: 100 }, margin: 1, width: 4, height: 3, cellKm: 100 };
    const sea = Float32Array.from([0, 1]); // land on the west, sea on the east
    const padded = padField(sea, d, 'seaFraction', { north: 'continue', south: 'ocean', east: 'land', west: 'continue' });
    // Corners follow the side they overshoot most (ties: east/west).
    expect(Array.from(padded)).toEqual([0, 0, 1, 0, 0, 0, 1, 0, 0, 1, 1, 0]);
    expect(Array.from(cropToMap(padded, d, new Float32Array(2)))).toEqual([0, 1]);
  });
});
