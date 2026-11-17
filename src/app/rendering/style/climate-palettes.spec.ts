import { landscapeColour } from './climate-palettes';

describe('landscapeColour', () => {
  const green = (c: readonly number[]) => c[1] - (c[0] + c[2]) / 2;
  it('is greener when wetter, browner when dormant', () => {
    expect(green(landscapeColour(18, 0.9))).toBeGreaterThan(green(landscapeColour(18, 0.2)));
    expect(green(landscapeColour(-10, 0.9))).toBeLessThan(green(landscapeColour(18, 0.9)));
  });
});
