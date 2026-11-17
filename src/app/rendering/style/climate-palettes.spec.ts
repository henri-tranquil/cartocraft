import { landscapeColour } from './climate-palettes';

describe('landscapeColour', () => {
  const green = (c: readonly number[]) => c[1] - (c[0] + c[2]) / 2;
  it('is greener when wetter, whiter when frozen', () => {
    expect(green(landscapeColour(18, 0.9))).toBeGreaterThan(green(landscapeColour(18, 0.2)));
    expect(landscapeColour(-10, 0.6).every((v) => v > 235)).toBe(true);
  });
});
