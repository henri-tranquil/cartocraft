import { layoutTextOnPath, pointAtLength, cumulativeLength } from './path-text';

const measure = (_ch: string, fontPx: number) => fontPx / 2;

describe('path text', () => {
  it('walks a path by arc length', () => {
    const xs = [0, 10, 10];
    const ys = [0, 0, 10];
    const cum = cumulativeLength(xs, ys);
    expect(cum).toEqual([0, 10, 20]);
    expect(pointAtLength(xs, ys, cum, 15)).toEqual({ x: 10, y: 5 });
  });

  it('lays letters along a straight path, centred', () => {
    const glyphs = layoutTextOnPath('abcd', [0, 100], [50, 50], 50, 10, 0, measure);
    [42.5, 47.5, 52.5, 57.5].forEach((x, k) => expect(glyphs![k].x).toBeCloseTo(x));
    expect(glyphs?.every((g) => g.angle === 0 && g.y === 50)).toBe(true);
  });

  it('reads left to right even on a path drawn westward', () => {
    const glyphs = layoutTextOnPath('ab', [100, 0], [0, 0], 50, 10, 0, measure);
    expect(glyphs![0].x).toBeLessThan(glyphs![1].x);
    expect(glyphs![0].angle).toBe(0);
  });

  it('follows a bend', () => {
    const glyphs = layoutTextOnPath('abcdefgh', [0, 40, 40], [0, 0, 40], 40, 10, 0, measure);
    expect(glyphs![0].angle).toBeCloseTo(0);
    expect(glyphs![7].angle).toBeCloseTo(Math.PI / 2);
  });

  it('refuses a text longer than the path', () => {
    expect(layoutTextOnPath('a very long name', [0, 20], [0, 0], 10, 10, 0, measure)).toBeNull();
  });
});
