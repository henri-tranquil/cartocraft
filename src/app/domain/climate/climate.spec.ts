import { ClimateInput, temperatureAtC } from './climate-model';
import { annualMeanInsolationWm2, dailyInsolationWm2, solarDeclinationDeg } from './insolation';
import { computeMonthlyTemperatures } from './temperature';

describe('insolation', () => {
  it('declination swings between ±tilt, max near the June solstice', () => {
    expect(solarDeclinationDeg(0.47, 23.4)).toBeCloseTo(23.4, 0);
    expect(solarDeclinationDeg(-10 / 365, 23.4)).toBeCloseTo(-23.4, 5);
  });

  it('matches known Earth values', () => {
    expect(dailyInsolationWm2(0, 0)).toBeCloseTo(1361 / Math.PI, 0); // equator, equinox ≈ 433
    expect(dailyInsolationWm2(80, -23.4)).toBe(0); // polar night
    expect(dailyInsolationWm2(90, 23.4)).toBeGreaterThan(500); // polar day at the solstice
    expect(annualMeanInsolationWm2(0, 23.4)).toBeCloseTo(417, -1);
    expect(annualMeanInsolationWm2(90, 23.4)).toBeCloseTo(173, -1);
  });
});

describe('computeMonthlyTemperatures', () => {
  function input(altitudes: number[], width: number, top: number, bottom: number): ClimateInput {
    return {
      widthCells: width,
      heightCells: altitudes.length / width,
      cellKm: 1,
      altitudeM: Int16Array.from(altitudes),
      latitudeTopDeg: top,
      latitudeBottomDeg: bottom,
      axialTiltDeg: 23.4,
      seaLevelM: 0,
      globalTemperatureOffsetC: 0,
    };
  }
  const JANUARY = 0.04;
  const JULY = 0.54;

  it('is colder toward the pole and with altitude', () => {
    // 2 columns (low land, 3000 m), 3 rows from 60°N to 0°.
    const result = computeMonthlyTemperatures(input([100, 3000, 100, 3000, 100, 3000], 2, 70, 10));
    const annual = (i: number) => (temperatureAtC(result, i, JANUARY) + temperatureAtC(result, i, JULY)) / 2;
    expect(annual(0)).toBeLessThan(annual(4)); // north colder than south
    expect(annual(0) - annual(1)).toBeCloseTo(2900 * 0.0065, 0); // lapse rate
  });

  it('gives northern land a strong season and the sea a mild one', () => {
    const result = computeMonthlyTemperatures(input([200, -500], 2, 50, 49));
    const landRange = temperatureAtC(result, 0, JULY) - temperatureAtC(result, 0, JANUARY);
    const seaRange = temperatureAtC(result, 1, JULY) - temperatureAtC(result, 1, JANUARY);
    expect(landRange).toBeGreaterThan(20);
    expect(seaRange).toBeGreaterThan(2);
    expect(seaRange).toBeLessThan(landRange / 2);
  });

  it('never lets the sea surface go below the freezing point of seawater', () => {
    const result = computeMonthlyTemperatures(input([-500], 1, 80, 79));
    expect(temperatureAtC(result, 0, JANUARY)).toBeCloseTo(-1.8, 5);
  });

  it('inverts the seasons in the southern hemisphere', () => {
    const result = computeMonthlyTemperatures(input([200], 1, -45, -46));
    expect(temperatureAtC(result, 0, JANUARY)).toBeGreaterThan(temperatureAtC(result, 0, JULY));
  });
});
