import { describe, expect, it } from 'vitest';
import { GLYPH_STRIDE, placeMountains } from './vintage-mountains';

/** 200 × 200 map: sea on the left half, a rugged range (sharp 2500 m ridges) on the right. */
function testMap(): Int16Array {
  const w = 200;
  const alt = new Int16Array(w * w);
  for (let y = 0; y < w; y++) {
    for (let x = 0; x < w; x++) {
      alt[y * w + x] = x < 100 ? -500 : x < 130 ? 50 : 1200 + Math.round(1300 * Math.abs(Math.sin(x * 0.4) * Math.cos(y * 0.3)));
    }
  }
  return alt;
}

describe('placeMountains', () => {
  const input = { altitudeM: testMap(), widthCells: 200, heightCells: 200, seaLevelM: 0, seed: 7 };

  it('puts glyphs on the range only, sorted back to front', () => {
    const glyphs = placeMountains(input);
    expect(glyphs.length / GLYPH_STRIDE).toBeGreaterThan(5);
    for (let i = 0; i < glyphs.length; i += GLYPH_STRIDE) {
      expect(glyphs[i]).toBeGreaterThan(125); // not at sea, not on the flat lowland
      if (i > 0) expect(glyphs[i + 1]).toBeGreaterThanOrEqual(glyphs[i + 1 - GLYPH_STRIDE]);
    }
  });

  it('is deterministic and denser at finer levels', () => {
    expect(Array.from(placeMountains(input))).toEqual(Array.from(placeMountains(input)));
    expect(placeMountains(input, 2).length).toBeGreaterThan(placeMountains(input, 0).length);
  });
});
