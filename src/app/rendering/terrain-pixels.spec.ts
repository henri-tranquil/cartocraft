import { createInt16TiledGrid, setCell, tileRect } from '../domain/terrain/tiled-grid';
import { buildAltitudePalette } from './style/altitude-palette';
import { renderTerrainPixels } from './terrain-pixels';

describe('renderTerrainPixels', () => {
  const palette = buildAltitudePalette(0);

  it('colours sea blue-ish and land differently', () => {
    const grid = createInt16TiledGrid(4, 1, -1000, 4);
    setCell(grid, 2, 0, 300);
    setCell(grid, 3, 0, 300);
    const out = new Uint8ClampedArray(4 * 4 * 4);
    renderTerrainPixels(grid, 0, tileRect(grid, 0), out, palette, 1000);
    expect(out[0 + 2]).toBeGreaterThan(out[0]); // sea: blue > red
    expect(out[3 * 4 + 1]).toBeGreaterThan(out[3 * 4 + 2]); // flat land: green > blue
  });

  it('lights north-west-facing slopes more than south-east-facing ones', () => {
    // A ridge along x = 5: west slope faces NW-ish light, east slope faces away.
    const grid = createInt16TiledGrid(11, 3, 0, 16);
    for (let y = 0; y < 3; y++) for (let x = 0; x < 11; x++) setCell(grid, x, y, 1000 - Math.abs(x - 5) * 150);
    const out = new Uint8ClampedArray(16 * 16 * 4);
    renderTerrainPixels(grid, 0, tileRect(grid, 0), out, palette, 1000);
    const pixel = (x: number) => (1 * 16 + x) * 4;
    expect(out[pixel(3)]).toBeGreaterThan(out[pixel(7)]);
  });
});

describe('mergeIfWorthwhile', () => {
  it('merges overlapping dabs, keeps distant ones apart', async () => {
    const { mergeIfWorthwhile } = await import('./terrain-raster');
    const a = { x0: 0, y0: 0, x1: 9, y1: 9 };
    expect(mergeIfWorthwhile([a, { x0: 2, y0: 0, x1: 11, y1: 9 }])).toEqual([{ x0: 0, y0: 0, x1: 11, y1: 9 }]);
    expect(mergeIfWorthwhile([a, { x0: 500, y0: 500, x1: 509, y1: 509 }]).length).toBe(2);
  });
});
