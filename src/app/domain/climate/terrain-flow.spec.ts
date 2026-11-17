import { advect } from './advection';
import { deflectWind } from './terrain-flow';

describe('terrain flow', () => {
  it('turns a wind blowing into a steep range along the range', () => {
    // Range rising toward the east (slope 40 m/km), wind from the west-south-west.
    const w = deflectWind(8, 2, 40, 0);
    expect(w.u).toBeLessThan(3); // far less of it climbs
    expect(w.v).toBeGreaterThan(2); // it now runs along the range
    expect(Math.hypot(w.u, w.v)).toBeGreaterThan(5); // redirected, not stopped
  });

  it('lets unstable (mild) air climb instead of turning it', () => {
    expect(deflectWind(8, 2, 40, 0, 0)).toEqual({ u: 8, v: 2 });
  });

  it('leaves downhill and flat-ground winds alone', () => {
    expect(deflectWind(8, 0, -40, 0)).toEqual({ u: 8, v: 0 });
    expect(deflectWind(8, 0, 0, 0)).toEqual({ u: 8, v: 0 });
  });

  it('stops shallow cold air at a ridge but lets warm air through', () => {
    const n = 8;
    const run = (sourceC: number) => {
      const eq = new Float32Array(n);
      eq[0] = sourceC;
      const field = eq.slice();
      const step = { dx: new Float32Array(n).fill(1), dy: new Float32Array(n), memory: new Float32Array(n).fill(0.95) };
      step.memory[0] = 0;
      const climbM = new Float32Array(n);
      climbM[3] = 1500; // a ridge between cells 2 and 3
      advect(field, eq, step, n, 1, 8, undefined, { climbM, coldDepthM: 1000, warmDepthM: 3000 });
      return field[5] / sourceC; // share of the source anomaly that got past the ridge
    };
    expect(run(-10)).toBeLessThan(0.25);
    expect(run(10)).toBeGreaterThan(0.4);
  });
});
