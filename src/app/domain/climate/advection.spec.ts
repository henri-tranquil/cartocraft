import { advect, coarseGridFor } from './advection';
import { computeClimate } from './climate';
import { ClimateInput, humidityAtPct, temperatureAtC } from './climate-model';

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

  it('sizes the coarse grid to at most 256 cells per side', () => {
    expect(coarseGridFor(1700, 1700, 1)).toEqual({ width: 243, height: 243, factor: 7, cellKm: 7 });
    expect(coarseGridFor(100, 50, 1).factor).toBe(1);
  });

  it('makes a west coast under westerlies mild in winter, the interior colder', () => {
    const input = westOceanEastLand();
    const result = computeClimate(input);
    const row = 20 * input.widthCells;
    const coast = temperatureAtC(result, row + 122, JANUARY);
    const inland = temperatureAtC(result, row + 230, JANUARY);
    expect(coast).toBeGreaterThan(inland + 3);
    expect(humidityAtPct(result, row + 122, JANUARY)).toBeGreaterThan(humidityAtPct(result, row + 230, JANUARY));
  });
});
