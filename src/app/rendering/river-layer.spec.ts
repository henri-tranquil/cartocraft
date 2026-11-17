import { chaikin, EDIT_RIVER_STYLE, riverWidthPx, visibleDischargeM3s } from './river-layer';

describe('river layer', () => {
  it('shows smaller rivers at larger scales, never below the stored minimum', () => {
    expect(visibleDischargeM3s(EDIT_RIVER_STYLE, 0.5)).toBe(80);
    expect(visibleDischargeM3s(EDIT_RIVER_STYLE, 4)).toBe(10);
    expect(visibleDischargeM3s(EDIT_RIVER_STYLE, 1000)).toBe(1);
  });

  it('widens with discharge, within bounds', () => {
    const thin = riverWidthPx(EDIT_RIVER_STYLE, 10, 10);
    const thick = riverWidthPx(EDIT_RIVER_STYLE, 1000, 10);
    expect(thick).toBeGreaterThan(thin);
    expect(thick).toBeLessThanOrEqual(EDIT_RIVER_STYLE.maxWidthPx);
  });

  it('cuts corners but keeps the ends', () => {
    const { xs, ys } = chaikin([0, 10, 10], [0, 0, 10], [1, 2, 3], 1);
    expect([xs[0], ys[0]]).toEqual([0, 0]);
    expect([xs[xs.length - 1], ys[ys.length - 1]]).toEqual([10, 10]);
    expect(xs.some((x, i) => x === 10 && ys[i] === 0)).toBe(false); // the sharp corner (10, 0) is gone
    expect(xs.length).toBe(6);
  });
});
