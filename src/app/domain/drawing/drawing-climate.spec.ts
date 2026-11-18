import { describe, expect, it } from 'vitest';
import { reliefAltitudeM, reliefCoolingC, zonalRows, zonalWetnessPct } from './drawing-climate';

describe('drawing zonal climate', () => {
  it('is wet at the equator and in mid-latitudes, dry in the subtropics', () => {
    expect(zonalWetnessPct(0)).toBeGreaterThan(60);
    expect(zonalWetnessPct(27)).toBeLessThan(20);
    expect(zonalWetnessPct(-27)).toBe(zonalWetnessPct(27));
    expect(zonalWetnessPct(50)).toBeGreaterThan(55);
  });

  it('cools with the relief class', () => {
    expect(reliefAltitudeM(0)).toBe(100);
    expect(reliefAltitudeM(1)).toBe(2500);
    expect(reliefCoolingC(1)).toBeCloseTo(16.25, 2);
    expect(reliefAltitudeM(0.5)).toBeCloseTo(700, 5);
  });

  it('gives warm summers in the south and cold ones in the far north', () => {
    const rows = zonalRows({ latitudeTopDeg: 80, latitudeBottomDeg: 10, axialTiltDeg: 23.44, globalTemperatureOffsetC: 0 }, 70);
    expect(rows.warmestC[69]).toBeGreaterThan(25);
    expect(rows.warmestC[0]).toBeLessThan(10);
    expect(rows.warmestC[0]).toBeLessThan(rows.warmestC[35]);
  });
});
