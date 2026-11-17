import { beltShiftDeg, prevailingWind, windFromDirection } from './wind';

const EQUINOX = 0.22; // ~21 March: belts centred on the equator

describe('prevailing winds', () => {
  it('blows trade winds from the north-east in the northern tropics', () => {
    const w = prevailingWind(15, EQUINOX, 23.4);
    expect(w.uMs).toBeLessThan(0); // toward the west
    expect(w.vMs).toBeLessThan(0); // toward the equator
  });

  it('blows westerlies from the south-west at mid-latitudes, mirrored in the south', () => {
    const north = prevailingWind(45, EQUINOX, 23.4);
    expect(north.uMs).toBeGreaterThan(5);
    expect(north.vMs).toBeGreaterThan(0);
    const south = prevailingWind(-45, EQUINOX, 23.4);
    expect(south.uMs).toBeGreaterThan(5);
    expect(south.vMs).toBeLessThan(0); // poleward = southward
  });

  it('is calm at the belt boundaries and has polar easterlies', () => {
    expect(Math.abs(prevailingWind(30, EQUINOX, 23.4).uMs)).toBeLessThan(0.5);
    expect(prevailingWind(75, EQUINOX, 23.4).uMs).toBeLessThan(0);
  });

  it('shifts the belts north in July, and not at all without axial tilt', () => {
    expect(beltShiftDeg(0.54, 23.4)).toBeGreaterThan(8);
    expect(beltShiftDeg(0.04, 23.4)).toBeLessThan(-8);
    expect(beltShiftDeg(0.54, 0)).toBe(0);
  });
});

describe('windFromDirection', () => {
  it('names a wind after where it comes from', () => {
    expect(windFromDirection({ uMs: 5, vMs: 0 })).toBe('O');
    expect(windFromDirection({ uMs: -4, vMs: -4 })).toBe('NE');
    expect(windFromDirection({ uMs: 0, vMs: 3 })).toBe('S');
  });
});
