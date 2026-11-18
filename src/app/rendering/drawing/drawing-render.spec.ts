import { paintDrawing } from '../../domain/drawing/drawing-brush';
import { DrawingPaint } from '../../domain/drawing/drawing-cell';
import { createInt16TiledGrid } from '../../domain/terrain/tiled-grid';
import { CoveragePyramid, RELIEF_VALUE } from './coverage-pyramid';
import { placeReliefGlyphs } from './drawing-glyphs';

function drawn(paints: readonly [number, number, number, DrawingPaint][]) {
  const grid = createInt16TiledGrid(128, 128, 0, 64);
  for (const [x, y, r, paint] of paints) paintDrawing(grid, { center: { x, y }, radiusCells: r, roughness: 0, cellKm: 1, seed: 1 }, paint);
  return grid;
}

describe('CoveragePyramid', () => {
  it('averages land at every scale and follows later edits', () => {
    const grid = drawn([[32, 32, 20, { kind: 'land' }]]);
    const pyramid = new CoveragePyramid(grid);
    expect(pyramid.sample(0, 32, 32)).toBe(1);
    expect(pyramid.sample(0, 100, 100)).toBe(0);
    // Level 6 = one 64×64 block holding the 20-cell disc: about π·20² / 64².
    expect(pyramid.sample(6, 32, 32)).toBeCloseTo((Math.PI * 400) / 4096, 1);
    const rect = paintDrawing(grid, { center: { x: 100, y: 100 }, radiusCells: 10, roughness: 0, cellKm: 1, seed: 1 }, { kind: 'land' });
    pyramid.update(rect!);
    expect(pyramid.sample(0, 100, 100)).toBe(1);
  });

  it('can average the relief class instead of land', () => {
    const grid = drawn([
      [64, 64, 40, { kind: 'land' }],
      [64, 64, 10, { kind: 'relief', relief: 'highMountain' }],
    ]);
    const relief = new CoveragePyramid(grid, RELIEF_VALUE);
    expect(relief.sample(0, 64, 64)).toBe(1);
    expect(relief.sample(0, 64, 95)).toBe(0);
  });
});

describe('placeReliefGlyphs', () => {
  const grid = drawn([
    [64, 64, 60, { kind: 'land' }],
    [40, 64, 14, { kind: 'relief', relief: 'highMountain' }],
    [90, 64, 14, { kind: 'relief', relief: 'hills' }],
  ]);

  it('puts glyphs on relief zones only, mountains denser than hills', () => {
    // Level 2: 4 px per cell, the whole 128-cell map in a 512 px "tile".
    const glyphs = placeReliefGlyphs(grid, 7, 2, 0, 0, 512, 1);
    const mountains = glyphs.filter((g) => g.relief === 3);
    const hills = glyphs.filter((g) => g.relief === 1);
    expect(mountains.length).toBeGreaterThan(hills.length);
    expect(hills.length).toBeGreaterThan(0);
    for (const g of glyphs) expect(Math.hypot(g.x / 4 - (g.relief === 3 ? 40 : 90), g.y / 4 - 64)).toBeLessThan(15);
    // Back to front.
    for (let i = 1; i < glyphs.length; i++) expect(glyphs[i].y).toBeGreaterThanOrEqual(glyphs[i - 1].y);
  });

  it('is deterministic across tiles: a glyph near a border is the same seen from both sides', () => {
    const whole = placeReliefGlyphs(grid, 7, 2, 0, 0, 512, 1);
    const left = placeReliefGlyphs(grid, 7, 2, 0, 0, 160, 1).map((g) => ({ ...g }));
    const right = placeReliefGlyphs(grid, 7, 2, 160, 0, 160, 1).map((g) => ({ ...g, x: g.x + 160 }));
    const key = (g: { x: number; y: number }) => `${g.x.toFixed(3)},${g.y.toFixed(3)}`;
    const all = new Set(whole.map(key));
    for (const g of [...left, ...right]) expect(all.has(key(g))).toBe(true);
    // Some glyph straddles x = 160 and is listed by both tiles.
    const shared = left.filter((g) => right.some((h) => key(h) === key(g)));
    expect(shared.length).toBeGreaterThan(0);
  });
});
