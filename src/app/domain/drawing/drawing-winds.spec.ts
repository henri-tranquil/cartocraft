import { DEFAULT_MAP_SETTINGS } from '../map/map-settings';
import { createInt16TiledGrid, Int16TiledGrid, setCell } from '../terrain/tiled-grid';
import { encodeDrawingCell, SEA_CELL } from './drawing-cell';
import { AirStreamline, drawingAirField, moistureCapacity, traceDrawingWinds, traceStreamline } from './drawing-winds';

const PLAIN = encodeDrawingCell({ land: true, relief: 'plain', forest: 'none' });
const FOREST = encodeDrawingCell({ land: true, relief: 'plain', forest: 'broadleaf' });
const HIGH = encodeDrawingCell({ land: true, relief: 'highMountain', forest: 'none' });

/** 1000 × 1000 km, 1 km cells. */
function grid(fill: (x: number, y: number) => number): Int16TiledGrid {
  const g = createInt16TiledGrid(1000, 1000, PLAIN, 128);
  for (let y = 0; y < 1000; y++) for (let x = 0; x < 1000; x++) setCell(g, x, y, fill(x, y));
  return g;
}

function settings(topDeg: number, bottomDeg: number) {
  return { ...DEFAULT_MAP_SETTINGS, widthKm: 1000, heightKm: 1000, baseCellKm: 1, latitudeTopDeg: topDeg, latitudeBottomDeg: bottomDeg };
}

function last(line: AirStreamline, k: number): number {
  return line.pointsKm[line.pointsKm.length - 2 + k];
}

describe('drawing winds', () => {
  const flat = grid(() => PLAIN);

  it('blow towards the east and the pole in the westerlies, towards the west and the equator in the trades', () => {
    const westerlies = traceStreamline(drawingAirField(flat, 1, settings(52, 38)), 100, 500);
    const trades = traceStreamline(drawingAirField(flat, 1, settings(27, 13)), 900, 500);
    expect(westerlies && last(westerlies, 0)).toBeGreaterThan(500);
    expect(westerlies && last(westerlies, 1)).toBeLessThan(500); // north = up
    expect(trades && last(trades, 0)).toBeLessThan(400);
    expect(trades && last(trades, 1)).toBeGreaterThan(500); // towards the equator = down here
  });

  it('meander: cold air dives towards the equator west of the trough, warm air rises east of it', () => {
    // 1000 km wide → λ 1500 km; land everywhere → trough at 500 + 375 = 875 km.
    const field = drawingAirField(flat, 1, settings(55, 35));
    expect(field.troughXKm).toBeCloseTo(875, -1);
    const west = traceStreamline(field, 350, 400);
    const east = traceStreamline(field, 880, 600);
    expect(west && last(west, 1)).toBeGreaterThan(450); // south
    expect(east && last(east, 1)).toBeLessThan(560); // north
    // The air diving south arrives colder than the place it reaches.
    if (!west) return;
    const local = field.rowTempC[Math.floor(last(west, 1) / field.cellKm)];
    expect(west.tempC[west.tempC.length - 1]).toBeLessThan(local - 0.3);
  });

  it('anchor the trough east of the main mountain range', () => {
    const range = grid((x) => (x >= 150 && x < 250 ? HIGH : PLAIN));
    expect(drawingAirField(range, 1, settings(55, 35)).troughXKm).toBeCloseTo(200 + 375, -1);
  });

  it('end where two belts meet (the polar front): westerlies and polar air converge', () => {
    // 70°N → 50°N: the front at 60° is the middle row.
    const field = drawingAirField(flat, 1, settings(70, 50));
    const fromSouth = traceStreamline(field, 100, 900);
    const fromNorth = traceStreamline(field, 900, 100);
    expect(fromSouth && last(fromSouth, 1)).toBeGreaterThan(470);
    expect(fromNorth && last(fromNorth, 1)).toBeLessThan(530);
  });

  it('keep the temperature of where they come from for a while: warm air rising east of the trough', () => {
    // A range along the west edge puts the trough at 50 + 375 = 425 km: air rises north east of it.
    const field = drawingAirField(grid((x) => (x < 100 ? HIGH : PLAIN)), 1, settings(52, 38));
    const line = traceStreamline(field, 450, 900);
    expect(line).not.toBeNull();
    if (!line) return;
    const yEnd = last(line, 1);
    expect(yEnd).toBeLessThan(700);
    const local = field.rowTempC[Math.floor(yEnd / field.cellKm)];
    expect(line.tempC[line.tempC.length - 1]).toBeGreaterThan(local + 0.3);
  });

  it('turn cold air along a mountain range, while warm air gets over it', () => {
    // A high range across the westerlies' path, north–south at x 450–520.
    const wall = grid((x) => (x >= 450 && x < 520 ? HIGH : PLAIN));
    const crosses = (top: number, bottom: number) => {
      const line = traceStreamline(drawingAirField(wall, 1, settings(top, bottom)), 200, 500);
      return line !== null && last(line, 0) > 560;
    };
    expect(crosses(61, 47)).toBe(false); // ~54°N: cold air
    expect(crosses(38, 32)).toBe(true); // ~35°N: warm air
  });

  it('pick up moisture over the sea and forests, not over bare land, and warm air holds more', () => {
    const half = (land: number) => grid((x) => (x < 500 ? SEA_CELL : land));
    const s = settings(40, 30);
    const overLand = traceStreamline(drawingAirField(half(PLAIN), 1, s), 520, 500);
    const overSea = traceStreamline(drawingAirField(half(PLAIN), 1, s), 20, 500);
    const overForest = traceStreamline(drawingAirField(half(FOREST), 1, s), 520, 500);
    expect(overSea && overLand && overForest).toBeTruthy();
    if (!overSea || !overLand || !overForest) return;
    const end = (l: AirStreamline) => l.humidity[l.humidity.length - 1];
    expect(end(overForest)).toBeGreaterThan(end(overLand));
    expect(overSea.humidity[20]).toBeGreaterThan(overSea.humidity[0]);
    expect(moistureCapacity(25)).toBeGreaterThan(4 * moistureCapacity(0));
  });

  it('cover the whole map with streamlines', () => {
    const lines = traceDrawingWinds(drawingAirField(flat, 1, settings(52, 38)));
    expect(lines.length).toBeGreaterThan(300);
  });
});
