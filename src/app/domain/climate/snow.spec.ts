import { positiveDegrees, snowCover, snowFraction, snowStep, snowStepDeci } from './snow';

describe('snowpack', () => {
  it('turns precipitation into snow on the cold days of the month', () => {
    expect(snowFraction(-10)).toBeGreaterThan(0.99);
    expect(snowFraction(1)).toBeCloseTo(0.5, 5);
    expect(snowFraction(12)).toBeLessThan(0.01);
  });

  it('melts a little even in a month averaging below 0 °C (mild days)', () => {
    expect(positiveDegrees(-2)).toBeGreaterThan(0.3);
    expect(positiveDegrees(15)).toBeCloseTo(15, 1);
  });

  it('gives the same result through its lookup tables', () => {
    expect(snowStepDeci(100, -35, 50, 2)).toBeCloseTo(snowStep(100, -3.5, 50, 2), 3);
  });

  it('accumulates in winter and melts by degree-days in spring', () => {
    let swe = 0;
    for (let i = 0; i < 3; i++) swe = snowStep(swe, -12, 60, 1.5); // three winter months
    expect(swe).toBeGreaterThan(175);
    swe = snowStep(swe, 3, 0, 4); // a spring month at +3 °C melts it
    expect(swe).toBeLessThan(5);
  });

  it('covers the ground once a few centimetres have fallen', () => {
    expect(snowCover(0)).toBe(0);
    expect(snowCover(15)).toBeGreaterThan(0.9);
  });
});
