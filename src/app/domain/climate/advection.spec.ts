import { advect, upsampleAt, upsampleInto } from './advection';
import { computeClimate } from './climate';
import { ClimateInput, precipitationAtMm, temperatureAtC } from './climate-model';
import { windAt } from './wind';

const JANUARY = 0.04;

/** 2400 × 400 km band at 40–48° N: ocean on the west half, land on the east half. */
function westOceanEastLand(): ClimateInput {
  const w = 240;
  const h = 40;
  const altitudeM = new Int16Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) altitudeM[y * w + x] = x < w / 2 ? -2000 : 100;
  return { widthCells: w, heightCells: h, cellKm: 10, altitudeM, latitudeTopDeg: 48, latitudeBottomDeg: 40, axialTiltDeg: 23.4, seaLevelM: 0, globalTemperatureOffsetC: 0 };
}

describe('advection', () => {
  it('relaxes toward equilibrium along the wind', () => {
    const w = 10;
    const eq = new Float32Array(w).fill(0);
    eq[0] = 10; // a warm source at the upwind edge
    const field = eq.slice();
    const step = { dx: new Float32Array(w).fill(1), dy: new Float32Array(w), memory: new Float32Array(w).fill(0.5) };
    step.memory[0] = 0;
    advect(field, eq, step, w, 1);
    expect(field[1]).toBeCloseTo(5, 5);
    expect(field[3]).toBeCloseTo(1.25, 5);
  });

  it('upsamples a whole field exactly like the per-cell version', () => {
    const g7 = { width: 8, height: 5, factor: 7, cellKm: 7 };
    const coarse = Float32Array.from({ length: 40 }, (_, i) => (i * 7) % 11);
    const out = new Float32Array(50 * 30);
    upsampleInto(coarse, g7, 50, 30, out);
    for (const [x, y] of [[0, 0], [13, 4], [49, 29], [25, 17]]) expect(out[y * 50 + x]).toBeCloseTo(upsampleAt(coarse, g7, x, y), 4);
  });

  it('makes a west coast under westerlies mild in winter, the interior colder', () => {
    const input = westOceanEastLand();
    const result = computeClimate(input);
    const row = 20 * input.widthCells;
    const coast = temperatureAtC(result, row + 122, JANUARY);
    const inland = temperatureAtC(result, row + 230, JANUARY);
    expect(coast).toBeGreaterThan(inland + 3);
    expect(precipitationAtMm(result, 122, 20, JANUARY)).toBeGreaterThan(precipitationAtMm(result, 230, 20, JANUARY));
  });
});

describe('monsoon', () => {
  /** 2000 × 2000 km at 50–32° N: a continent in the north-west quadrant, sea elsewhere. */
  function continentNorthWest(): ClimateInput {
    const n = 200;
    const altitudeM = new Int16Array(n * n);
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) altitudeM[y * n + x] = x < n / 2 && y < n / 2 ? 300 : -2000;
    return { widthCells: n, heightCells: n, cellKm: 10, altitudeM, latitudeTopDeg: 50, latitudeBottomDeg: 32, axialTiltDeg: 23.4, seaLevelM: 0, globalTemperatureOffsetC: 0 };
  }

  it('blows out of the cold continent in winter and into the warm continent in summer', () => {
    const result = computeClimate(continentNorthWest());
    // Just south-east of the continent's corner: the outflow points south-east in winter.
    const winterMinusSummer = (yearPhase: number) => windAt(result, 110, 110, yearPhase);
    const jan = winterMinusSummer(0.04);
    const jul = winterMinusSummer(0.54);
    expect(jan.vMs).toBeLessThan(jul.vMs); // more southward in winter
    expect(jul.vMs).toBeGreaterThan(0); // drawn north toward the warm land in summer
  });
});

describe('continentality and beyond the edges', () => {
  /** 1000 × 1000 km at 55–45° N. */
  function square(altitude: (x: number, y: number) => number): ClimateInput {
    const n = 100;
    const altitudeM = new Int16Array(n * n);
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) altitudeM[y * n + x] = altitude(x, y);
    return { widthCells: n, heightCells: n, cellKm: 10, altitudeM, latitudeTopDeg: 55, latitudeBottomDeg: 45, axialTiltDeg: 23.4, seaLevelM: 0, globalTemperatureOffsetC: 0 };
  }

  it('makes a continent interior colder in winter than a small island at the same latitude', () => {
    const centre = 50 * 100 + 50;
    const continent = temperatureAtC(computeClimate(square(() => 100)), centre, JANUARY);
    const island = temperatureAtC(computeClimate(square((x, y) => (Math.abs(x - 50) < 5 && Math.abs(y - 50) < 5 ? 100 : -2000))), centre, JANUARY);
    expect(continent).toBeLessThan(island - 5);
  });

  it('cools a sea map in winter when a continent lies beyond its northern edge', () => {
    const sea = square(() => -2000);
    const coast = 5 * 100 + 50; // near the northern edge
    const withOcean = temperatureAtC(computeClimate({ ...sea, beyondEdges: { north: 'ocean', south: 'ocean', east: 'ocean', west: 'ocean' } }), coast, JANUARY);
    const withLand = temperatureAtC(computeClimate({ ...sea, beyondEdges: { north: 'land', south: 'ocean', east: 'ocean', west: 'ocean' } }), coast, JANUARY);
    expect(withLand).toBeLessThan(withOcean - 1);
  });
});

describe('orographic precipitation', () => {
  it('rains on the windward side of a range in summer and leaves a dry rain shadow behind it', () => {
    const JULY = 0.54;
    const input = westOceanEastLand();
    const w = input.widthCells;
    const altitudeM = input.altitudeM.slice();
    for (let y = 0; y < input.heightCells; y++) for (let x = 140; x < 146; x++) altitudeM[y * w + x] = 2500;
    const result = computeClimate({ ...input, altitudeM });
    const flat = computeClimate(input);
    // Summer: mild, unstable air is lifted over the range and drops its water.
    expect(precipitationAtMm(result, 141, 20, JULY)).toBeGreaterThan(precipitationAtMm(flat, 141, 20, JULY) * 3);
    // Behind it, in both seasons, the air comes down dry.
    expect(precipitationAtMm(result, 160, 20, JULY)).toBeLessThan(precipitationAtMm(flat, 160, 20, JULY) / 2);
    expect(precipitationAtMm(result, 160, 20, JANUARY)).toBeLessThan(precipitationAtMm(flat, 160, 20, JANUARY) / 2);
  });

  it('warms the lee of a rainy range (föhn)', () => {
    const JULY = 0.54;
    const input = westOceanEastLand();
    const w = input.widthCells;
    const altitudeM = input.altitudeM.slice();
    for (let y = 0; y < input.heightCells; y++) for (let x = 140; x < 146; x++) altitudeM[y * w + x] = 2500;
    const lee = 20 * w + 155;
    const withRange = temperatureAtC(computeClimate({ ...input, altitudeM }), lee, JULY);
    expect(withRange).toBeGreaterThan(temperatureAtC(computeClimate(input), lee, JULY) + 0.5);
  });
});
