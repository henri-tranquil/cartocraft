import {
  createInt16TiledGrid,
  getCell,
  INT16_MAX,
  INT16_MIN,
  setCell,
  tileIndexAt,
  tileIndicesInRect,
} from './tiled-grid';

describe('Int16TiledGrid', () => {
  it('computes tile counts, rounding up partial edge tiles', () => {
    const grid = createInt16TiledGrid(10, 5, 0, 4);
    expect(grid.tilesX).toBe(3);
    expect(grid.tilesY).toBe(2);
    expect(grid.tiles.length).toBe(6);
  });

  it('fills and reads/writes cells across tile boundaries', () => {
    const grid = createInt16TiledGrid(10, 10, -200, 4);
    expect(getCell(grid, 9, 9)).toBe(-200);
    setCell(grid, 4, 3, 1500);
    expect(getCell(grid, 4, 3)).toBe(1500);
    expect(tileIndexAt(grid, 4, 3)).toBe(1);
    expect(getCell(grid, 3, 3)).toBe(-200);
  });

  it('clamps to the Int16 range instead of wrapping', () => {
    const grid = createInt16TiledGrid(2, 2);
    setCell(grid, 0, 0, 40000);
    setCell(grid, 1, 0, -40000);
    expect(getCell(grid, 0, 0)).toBe(INT16_MAX);
    expect(getCell(grid, 1, 0)).toBe(INT16_MIN);
  });

  it('rejects out-of-bounds access, including edge-tile padding', () => {
    const grid = createInt16TiledGrid(5, 5, 0, 4);
    expect(() => getCell(grid, 5, 0)).toThrow(RangeError);
    expect(() => setCell(grid, -1, 0, 1)).toThrow(RangeError);
  });

  it('lists tiles overlapping a rectangle, clipped to the grid', () => {
    const grid = createInt16TiledGrid(10, 10, 0, 4);
    expect(tileIndicesInRect(grid, 3, 3, 4, 4)).toEqual([0, 1, 3, 4]);
    expect(tileIndicesInRect(grid, -50, -50, 1, 1)).toEqual([0]);
  });
});
