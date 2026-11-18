import { DEFAULT_MAP_SETTINGS } from '../map/map-settings';
import { createInt16TiledGrid, setCell } from '../terrain/tiled-grid';
import { encodeDrawingCell, SEA_CELL } from './drawing-cell';
import { drawingAirField } from './drawing-winds';
import { checkDrawing } from './drawing-checks';
import { drawingWeather, DrawingWeather, sampleWeather, weatherGroundClimate, weatherMonthTempC } from './drawing-weather';

const PLAIN = encodeDrawingCell({ land: true, relief: 'plain', forest: 'none' });
const FOREST = encodeDrawingCell({ land: true, relief: 'plain', forest: 'broadleaf' });
const HIGH = encodeDrawingCell({ land: true, relief: 'highMountain', forest: 'none' });

/** A 1500 × 600 km band of latitudes, 1 km cells; `fill` by x only. */
function weather(topDeg: number, bottomDeg: number, fill: (x: number) => number): DrawingWeather {
  const g = createInt16TiledGrid(1500, 600, PLAIN, 256);
  for (let y = 0; y < 600; y++) for (let x = 0; x < 1500; x++) setCell(g, x, y, fill(x));
  return drawingWeather(drawingAirField(g, 1, { ...DEFAULT_MAP_SETTINGS, latitudeTopDeg: topDeg, latitudeBottomDeg: bottomDeg }));
}

const wet = (w: DrawingWeather, x: number) => sampleWeather(w, w.wetnessPct, x, 300);

describe('drawing weather', () => {
  it('is wet on a coast facing the westerlies and drier deep inland', () => {
    const w = weather(48, 42, (x) => (x < 300 ? SEA_CELL : PLAIN));
    expect(wet(w, 350)).toBeGreaterThan(50);
    expect(wet(w, 1400)).toBeLessThan(wet(w, 350) - 15);
  });

  it('rains on the windward side of a range and leaves a rain shadow behind it', () => {
    const w = weather(48, 42, (x) => (x < 300 ? SEA_CELL : x >= 600 && x < 700 ? HIGH : PLAIN));
    const flat = weather(48, 42, (x) => (x < 300 ? SEA_CELL : PLAIN));
    expect(sampleWeather(w, w.precipitationMm, 600, 300)).toBeGreaterThan(sampleWeather(flat, flat.precipitationMm, 600, 300));
    expect(wet(w, 850)).toBeLessThan(wet(flat, 850) - 15);
  });

  it('is a desert in the subtropics, wetter on the coast the trades blow from', () => {
    const w = weather(28, 22, (x) => (x > 1200 ? SEA_CELL : PLAIN));
    expect(wet(w, 100)).toBeLessThan(20);
    expect(wet(w, 1150)).toBeGreaterThan(wet(w, 100) + 10);
  });

  it('gets moisture back over forests', () => {
    const bare = weather(48, 42, (x) => (x < 300 ? SEA_CELL : PLAIN));
    const wooded = weather(48, 42, (x) => (x < 300 ? SEA_CELL : FOREST));
    expect(wet(wooded, 1400)).toBeGreaterThan(wet(bare, 1400) + 5);
  });

  it('gives the renderer a ground climate: wetness, warmest month and the month shown', () => {
    const w = weather(48, 42, (x) => (x < 300 ? SEA_CELL : PLAIN));
    const january = weatherGroundClimate(w, 1, 0.5 / 12);
    const july = weatherGroundClimate(w, 1, 6.5 / 12);
    expect(january.wetnessPct(350, 300)).toBeCloseTo(wet(w, 350), 5);
    expect(july.monthC(700, 300)).toBeGreaterThan(january.monthC(700, 300) + 10);
    expect(july.warmestC(700, 300)).toBeGreaterThanOrEqual(july.monthC(700, 300) - 0.5);
  });

  it('swings the seasons more deep inland than on the coast (continentality)', () => {
    const w = weather(48, 42, (x) => (x < 300 ? SEA_CELL : PLAIN));
    const swing = (x: number) => weatherMonthTempC(w, x, 300, 6.5 / 12) - weatherMonthTempC(w, x, 300, 0.5 / 12);
    expect(swing(1400)).toBeGreaterThan(swing(320) + 5);
    expect(weatherMonthTempC(w, 1400, 300, 0.5 / 12)).toBeLessThan(weatherMonthTempC(w, 320, 300, 0.5 / 12) - 3);
  });

  it('checks the forests against this climate: palms in the cold, woods in the desert', () => {
    const tropical = encodeDrawingCell({ land: true, relief: 'plain', forest: 'tropical' });
    const g = createInt16TiledGrid(1500, 600, PLAIN, 256);
    for (let y = 0; y < 600; y++) for (let x = 0; x < 1500; x++) setCell(g, x, y, x < 300 ? SEA_CELL : x < 500 ? tropical : x > 1300 ? FOREST : PLAIN);
    const settings = { ...DEFAULT_MAP_SETTINGS, latitudeTopDeg: 48, latitudeBottomDeg: 42, baseCellKm: 1 };
    const w = drawingWeather(drawingAirField(g, 1, settings));
    const warnings = checkDrawing(g, settings, [], w);
    expect(warnings).toContainEqual(expect.objectContaining({ kind: 'forestTooCold', forest: 'tropical' }));
    expect(warnings.some((x) => (x.kind === 'forestTooWarm' || x.kind === 'forestTooDry') && x.forest === 'tropical')).toBe(false);
    const desert = { ...settings, latitudeTopDeg: 28, latitudeBottomDeg: 22 };
    const dry = checkDrawing(g, desert, [], drawingWeather(drawingAirField(g, 1, desert)));
    expect(dry).toContainEqual(expect.objectContaining({ kind: 'forestTooDry', forest: 'broadleaf' }));
  });
});
