/**
 * Deterministic noise: the same (seed, x, y) always gives the same value, so
 * textures and glyph placement never "jump" between renders.
 */

/** Integer hash of (seed, x, y) → [0, 1). A few multiply/xor-shift rounds (murmur3 finaliser). */
export function hash2(seed: number, x: number, y: number): number {
  let h = seed ^ Math.imul(x, 0x27d4eb2d) ^ Math.imul(y, 0x165667b1);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

/**
 * Value noise: random values on the integer lattice, smoothly interpolated
 * in between (smoothstep weights, so no visible grid creases). Range [0, 1).
 */
export function valueNoise(seed: number, x: number, y: number): number {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const fx = x - xi;
  const fy = y - yi;
  const u = fx * fx * (3 - 2 * fx);
  const v = fy * fy * (3 - 2 * fy);
  const a = hash2(seed, xi, yi);
  const b = hash2(seed, xi + 1, yi);
  const c = hash2(seed, xi, yi + 1);
  const d = hash2(seed, xi + 1, yi + 1);
  const top = a + (b - a) * u;
  const bottom = c + (d - c) * u;
  return top + (bottom - top) * v;
}

/**
 * Fractal noise (fBm): octaves of value noise, each twice as fine and half as
 * strong. Large blotches plus smaller ones on top, like stains on paper.
 * Range [0, 1).
 */
export function fbm(seed: number, x: number, y: number, octaves: number): number {
  let sum = 0;
  let amplitude = 1;
  let total = 0;
  let frequency = 1;
  for (let o = 0; o < octaves; o++) {
    sum += valueNoise(seed + o * 1013, x * frequency, y * frequency) * amplitude;
    total += amplitude;
    amplitude *= 0.5;
    frequency *= 2;
  }
  return sum / total;
}
