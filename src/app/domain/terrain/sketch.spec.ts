import { describe, expect, it } from 'vitest';
import { boxBlur, detectSketchMode, fillSmallComponents, SketchImage, sketchSeaMask, sketchToAltitude } from './sketch';

function image(w: number, h: number, paint: (x: number, y: number) => [number, number, number]): SketchImage {
  const rgba = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const [r, g, b] = paint(x, y);
      rgba.set([r, g, b, 255], (y * w + x) * 4);
    }
  }
  return { rgba, width: w, height: h };
}

const BLUE: [number, number, number] = [40, 90, 150];
const BEIGE: [number, number, number] = [225, 210, 170];
const INK: [number, number, number] = [30, 25, 20];
const PAPER: [number, number, number] = [245, 240, 230];

describe('sketch import', () => {
  // Colour map: sea on the left, land on the right with a block of hatching (mountains).
  const colour = image(200, 100, (x, y) => (x < 100 ? BLUE : x > 150 && x < 180 && y > 30 && y < 70 && (x + y) % 3 === 0 ? INK : BEIGE));

  it('detects colour vs line drawings', () => {
    expect(detectSketchMode(colour, { x: 20, y: 50 }, { x: 130, y: 50 })).toBe('colour');
    const lines = image(50, 50, () => PAPER);
    expect(detectSketchMode(lines, { x: 5, y: 5 }, { x: 25, y: 25 })).toBe('lineart');
  });

  it('builds land, sea and mountains from a colour map', () => {
    const mask = sketchSeaMask(colour, { x: 20, y: 50 }, { x: 130, y: 50 });
    const alt = sketchToAltitude(colour, mask, { x: 20, y: 50 }, { x: 130, y: 50 }, { widthCells: 100, heightCells: 50, cellKm: 2, seaLevelM: 0, seed: 1 });
    expect(alt[25 * 100 + 10]).toBeLessThan(0); // sea
    expect(alt[25 * 100 + 60]).toBeGreaterThan(0); // land
    expect(alt[25 * 100 + 82]).toBeGreaterThan(alt[25 * 100 + 60] + 500); // hatched block → mountains
  });

  it('fills the sea of a line drawing up to the coastline', () => {
    // Island = ink circle of radius 15 in the middle; the sea surrounds it.
    const lines = image(60, 60, (x, y) => (Math.abs(Math.hypot(x - 30, y - 30) - 15) < 1 ? INK : PAPER));
    const mask = sketchSeaMask(lines, { x: 3, y: 3 }, { x: 30, y: 30 });
    expect(mask[3 * 60 + 3]).toBe(1);
    expect(mask[30 * 60 + 30]).toBe(0); // inside the island
    const alt = sketchToAltitude(lines, mask, { x: 3, y: 3 }, { x: 30, y: 30 }, { widthCells: 60, heightCells: 60, cellKm: 1, seaLevelM: 0, seed: 1 });
    expect(alt[30 * 60 + 30]).toBeGreaterThan(0);
    expect(alt[2 * 60 + 2]).toBeLessThan(0);
  });

  it('turns small specks into their surroundings, keeping the clicked sea', () => {
    const cells = new Uint8Array(100); // 10 × 10 land
    cells[55] = 1; // one-cell "sea" hole
    for (let x = 0; x < 10; x++) cells[x] = 1; // a sea strip along the top
    fillSmallComponents(cells, 10, 10, 1, 5, 0);
    expect(cells[55]).toBe(0);
    expect(cells[3]).toBe(1);
    fillSmallComponents(cells, 10, 10, 1, 50, 0); // too small but clicked: kept
    expect(cells[3]).toBe(1);
  });

  it('box blur keeps the mean', () => {
    const src = new Float32Array(100);
    src[55] = 9;
    const out = boxBlur(src, 10, 10, 1);
    expect(out[55]).toBeCloseTo(1);
    expect(out[44]).toBeCloseTo(1);
  });
});
