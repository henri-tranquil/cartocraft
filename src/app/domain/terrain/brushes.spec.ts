import { dabPositionsAlong, falloff, raiseTerrain, smoothTerrain } from './brushes';
import { createInt16TiledGrid, getCell, setCell } from './tiled-grid';

describe('falloff', () => {
  it('is 1 at the centre, 0 at and beyond the rim, and decreasing', () => {
    expect(falloff(0)).toBe(1);
    expect(falloff(1)).toBe(0);
    expect(falloff(2)).toBe(0);
    expect(falloff(0.3)).toBeGreaterThan(falloff(0.6));
  });
});

describe('raiseTerrain', () => {
  it('raises most at the centre, not beyond the radius, and reports the touched rect', () => {
    const grid = createInt16TiledGrid(20, 20, 0, 8);
    const rect = raiseTerrain(grid, { center: { x: 10, y: 10 }, radiusCells: 4 }, 100);
    expect(getCell(grid, 9, 9)).toBeGreaterThan(80);
    expect(getCell(grid, 7, 9)).toBeLessThan(getCell(grid, 9, 9));
    expect(getCell(grid, 2, 10)).toBe(0);
    expect(rect).toEqual({ x0: 6, y0: 6, x1: 14, y1: 14 });
  });

  it('clips at the grid border and returns null when fully outside', () => {
    const grid = createInt16TiledGrid(10, 10);
    expect(raiseTerrain(grid, { center: { x: 0, y: 0 }, radiusCells: 3 }, 50)?.x0).toBe(0);
    expect(raiseTerrain(grid, { center: { x: -20, y: -20 }, radiusCells: 3 }, 50)).toBeNull();
  });
});

describe('smoothTerrain', () => {
  it('flattens a spike symmetrically and leaves a flat area untouched', () => {
    const grid = createInt16TiledGrid(21, 21, 100);
    setCell(grid, 10, 10, 1000);
    smoothTerrain(grid, { center: { x: 10.5, y: 10.5 }, radiusCells: 5 }, 1);
    expect(getCell(grid, 10, 10)).toBe(200); // mean of 8×100 + 1000
    expect(getCell(grid, 9, 10)).toBe(getCell(grid, 11, 10));
    expect(getCell(grid, 3, 3)).toBe(100);
  });
});

describe('dabPositionsAlong', () => {
  it('places dabs at regular spacing and carries the remainder across segments', () => {
    const first = dabPositionsAlong({ x: 0, y: 0 }, { x: 5, y: 0 }, 2, 0);
    expect(first.points.map((p) => p.x)).toEqual([2, 4]);
    expect(first.carried).toBeCloseTo(1);
    const second = dabPositionsAlong({ x: 5, y: 0 }, { x: 8, y: 0 }, 2, first.carried);
    expect(second.points.map((p) => p.x)).toEqual([6, 8]);
  });
});
