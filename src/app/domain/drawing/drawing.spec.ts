import { createInt16TiledGrid, getCell } from '../terrain/tiled-grid';
import { checkDrawing } from './drawing-checks';
import { paintDrawing } from './drawing-brush';
import { applyPaint, decodeDrawingCell, DrawingPaint, encodeDrawingCell, isLandCode, SEA_CELL } from './drawing-cell';
import { drawingFromAltitudes, reliefClassForAltitude } from './drawing-from-altitudes';

describe('drawing cell codes', () => {
  it('round-trips every combination on land, and sea is always 0', () => {
    for (const relief of ['plain', 'hills', 'midMountain', 'highMountain'] as const) {
      for (const forest of ['none', 'broadleaf', 'conifer', 'tropical'] as const) {
        const cell = { land: true, relief, forest };
        expect(decodeDrawingCell(encodeDrawingCell(cell))).toEqual(cell);
      }
    }
    expect(encodeDrawingCell({ land: false, relief: 'hills', forest: 'conifer' })).toBe(SEA_CELL);
  });

  it('paints relief and forest on land only; the sea erases both', () => {
    const land = applyPaint(SEA_CELL, { kind: 'land' });
    const mountain = applyPaint(applyPaint(land, { kind: 'relief', relief: 'midMountain' }), { kind: 'forest', forest: 'conifer' });
    expect(decodeDrawingCell(mountain)).toEqual({ land: true, relief: 'midMountain', forest: 'conifer' });
    expect(applyPaint(SEA_CELL, { kind: 'relief', relief: 'hills' })).toBe(SEA_CELL);
    expect(applyPaint(mountain, { kind: 'sea' })).toBe(SEA_CELL);
    // Repainting land keeps what is already drawn there.
    expect(applyPaint(mountain, { kind: 'land' })).toBe(mountain);
  });
});

describe('paintDrawing', () => {
  const dab = (x: number, y: number, roughness: number) => ({ center: { x, y }, radiusCells: 10, roughness, cellKm: 1, seed: 42 });

  it('fills a clean disc and reports the changed box', () => {
    const grid = createInt16TiledGrid(64, 64, SEA_CELL, 32);
    const rect = paintDrawing(grid, dab(32, 32, 0), { kind: 'land' });
    expect(rect).toEqual({ x0: 22, y0: 22, x1: 41, y1: 41 });
    expect(isLandCode(getCell(grid, 32, 32))).toBe(true);
    expect(isLandCode(getCell(grid, 32, 21))).toBe(false);
    // Nothing left to change: null, so the renderer and the history ignore it.
    expect(paintDrawing(grid, dab(32, 32, 0), { kind: 'land' })).toBeNull();
  });

  it('a rough rim is irregular but tied to the place: two passes give the same edge', () => {
    const a = createInt16TiledGrid(64, 64, SEA_CELL, 32);
    const b = createInt16TiledGrid(64, 64, SEA_CELL, 32);
    paintDrawing(a, dab(32, 32, 1), { kind: 'land' });
    paintDrawing(b, dab(31.6, 32.3, 1), { kind: 'land' });
    paintDrawing(b, dab(32, 32, 1), { kind: 'land' });
    let landA = 0;
    for (let y = 0; y < 64; y++) for (let x = 0; x < 64; x++) landA += getCell(a, x, y);
    // Rough: fewer cells than the clean disc (≈ 314), but the centre is always painted.
    expect(landA).toBeLessThan(300);
    expect(landA).toBeGreaterThan(80);
    expect(getCell(a, 32, 32)).toBe(1);
    // Same place, same noise: the second pass at (32, 32) reproduces a's rim exactly where b's first pass didn't reach.
    for (let y = 0; y < 64; y++) for (let x = 0; x < 64; x++) if (getCell(a, x, y)) expect(getCell(b, x, y)).toBe(1);
  });
});

describe('drawingFromAltitudes', () => {
  it('maps altitude bands to relief classes and keeps inland depressions as land', () => {
    expect([0, 199, 200, 599, 600, 1499, 1500].map(reliefClassForAltitude)).toEqual([
      'plain', 'plain', 'hills', 'hills', 'midMountain', 'midMountain', 'highMountain',
    ]);
    // 5×3: sea on the frame column x=0, a basin below sea level at x=3 enclosed by land.
    const alt = Int16Array.from([
      -50, 100, 700, 700, 700,
      -50, 100, 700, -10, 700,
      -50, 100, 700, 700, 2000,
    ]);
    const codes = drawingFromAltitudes(alt, 5, 3, 0);
    expect(isLandCode(codes[5])).toBe(false);
    expect(decodeDrawingCell(codes[8])).toEqual({ land: true, relief: 'plain', forest: 'none' });
    expect(decodeDrawingCell(codes[7]).relief).toBe('midMountain');
    expect(decodeDrawingCell(codes[14]).relief).toBe('highMountain');
  });
});

describe('checkDrawing', () => {
  const latitudes = { latitudeTopDeg: 60, latitudeBottomDeg: 0 }; // 40 rows: 1.5° per row
  const dab = (grid: ReturnType<typeof createInt16TiledGrid>, x: number, y: number, r: number, paint: DrawingPaint) =>
    paintDrawing(grid, { center: { x, y }, radiusCells: r, roughness: 0, cellKm: 1, seed: 1 }, paint);

  it('warns when nothing has been drawn yet', () => {
    const grid = createInt16TiledGrid(40, 40, SEA_CELL, 32);
    expect(checkDrawing(grid, latitudes)).toEqual([{ kind: 'noLand' }]);
    dab(grid, 35, 35, 2, { kind: 'land' });
    expect(checkDrawing(grid, latitudes)).toEqual([]);
  });

  it('flags forests painted at an implausible latitude, with where and how much', () => {
    const grid = createInt16TiledGrid(40, 40, SEA_CELL, 32);
    dab(grid, 20, 20, 40, { kind: 'land' });
    dab(grid, 10, 4, 2, { kind: 'forest', forest: 'tropical' }); // ~54° N
    dab(grid, 30, 20, 2, { kind: 'forest', forest: 'tropical' }); // ~30° N: just outside the tropics
    dab(grid, 20, 37, 1, { kind: 'forest', forest: 'conifer' }); // ~4° N, lowland
    const warnings = checkDrawing(grid, latitudes);
    expect(warnings.map((w) => [w.kind, 'forest' in w ? w.forest : ''])).toEqual([
      ['forestTooWarm', 'conifer'],
      ['forestTooCold', 'tropical'],
    ]);
    const cold = warnings[1];
    if (cold.kind !== 'forestTooCold') throw new Error('unexpected');
    expect(cold.latitudeDeg).toBeGreaterThan(28);
    expect(cold.cells).toBeGreaterThan(13);

    // Conifers on mountains near the equator are fine: altitude makes it cold enough.
    dab(grid, 20, 37, 1, { kind: 'relief', relief: 'midMountain' });
    expect(checkDrawing(grid, latitudes).some((w) => w.kind === 'forestTooWarm')).toBe(false);
  });
});
