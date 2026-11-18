import { describe, expect, it } from 'vitest';
import { encodeDrawingCell, ReliefClass, reliefIndexOf, SEA_CELL } from './drawing-cell';
import { drawingFromAltitudes } from './drawing-from-altitudes';
import { computeSeaMask } from '../terrain/sea-mask';
import { computeDrainage } from '../hydrology/drainage';
import { convertDrawingToWorld, DrawingToWorldInput } from './drawing-to-world';

const altitudeFromDrawing = (i: DrawingToWorldInput) => convertDrawingToWorld({ ...i, rivers: [] });

const W = 120;
const H = 80;

/** An island (x 20..100, y 15..65): plain in the west, then hills, mid and high mountain bands to the east. */
function islandDrawing(): Int16Array {
  const out = new Int16Array(W * H).fill(SEA_CELL);
  const bands: ReliefClass[] = ['plain', 'hills', 'midMountain', 'highMountain'];
  for (let y = 15; y < 65; y++) {
    for (let x = 20; x < 100; x++) {
      const relief = bands[Math.min(3, Math.floor((x - 20) / 20))];
      out[y * W + x] = encodeDrawingCell({ land: true, relief, forest: 'none' });
    }
  }
  return out;
}

const input = { drawing: islandDrawing(), widthCells: W, heightCells: H, cellKm: 2, seaLevelM: 0, seed: 42 };

function meanOver(alt: Int16Array, x0: number, x1: number): number {
  let sum = 0;
  let n = 0;
  for (let y = 30; y < 50; y++) {
    for (let x = x0; x < x1; x++) {
      sum += alt[y * W + x];
      n++;
    }
  }
  return sum / n;
}

describe('convertDrawingToWorld', () => {
  it('keeps the drawn coast exactly: land above sea level, sea below', () => {
    const alt = altitudeFromDrawing(input);
    for (let i = 0; i < alt.length; i++) {
      if (input.drawing[i] === SEA_CELL) expect(alt[i]).toBeLessThan(0);
      else expect(alt[i]).toBeGreaterThan(0);
    }
  });

  it('rises with the relief class, and the sea deepens offshore', () => {
    const alt = altitudeFromDrawing(input);
    const plain = meanOver(alt, 26, 36);
    const hills = meanOver(alt, 46, 54);
    const mid = meanOver(alt, 66, 74);
    const high = meanOver(alt, 86, 94);
    expect(plain).toBeLessThan(200);
    expect(hills).toBeGreaterThan(200);
    expect(hills).toBeLessThan(600);
    expect(mid).toBeGreaterThan(600);
    expect(mid).toBeLessThan(1500);
    expect(high).toBeGreaterThan(1500);
    expect(alt[40 * W + 18]).toBeGreaterThan(alt[40 * W + 2]); // near the coast vs far out
  });

  it('is deterministic and round-trips the relief classes', () => {
    const alt = altitudeFromDrawing(input);
    expect(altitudeFromDrawing(input)).toEqual(alt);
    const back = drawingFromAltitudes(alt, W, H, 0);
    let same = 0;
    let landCells = 0;
    for (let i = 0; i < alt.length; i++) {
      if (input.drawing[i] === SEA_CELL) continue;
      landCells++;
      if (reliefIndexOf(back[i]) === reliefIndexOf(input.drawing[i])) same++;
    }
    // Borders between classes become foothills: most cells, not all, keep their class.
    expect(same / landCells).toBeGreaterThan(0.5);
  });
});

describe('drawn rivers in the conversion', () => {
  it('keeps a long lowland river whole: water from its source reaches its own mouth, not the nearby coast', () => {
    // A long thin plain (y 20..60) between two seas; the river winds 300 km along it, 15–25 km from the coasts.
    const w = 340;
    const h = 80;
    const drawing = new Int16Array(w * h).fill(SEA_CELL);
    for (let y = 20; y < 60; y++) for (let x = 0; x < 330; x++) drawing[y * w + x] = encodeDrawingCell({ land: true, relief: 'plain', forest: 'none' });
    const points: number[] = [];
    for (let x = 5; x <= 331; x += 4) points.push(x + 0.5, 40 + 5 * Math.sin(x / 15) + 0.5);
    const alt = convertDrawingToWorld({ drawing, widthCells: w, heightCells: h, cellKm: 1, seaLevelM: 0, seed: 3, rivers: [{ id: 'amazon', pointsKm: points }] });
    const sea = computeSeaMask(alt, w, h, 0);
    const { receiver } = computeDrainage(alt, w, h, sea);
    let c = Math.floor(points[1]) * w + Math.floor(points[0]);
    let last = c;
    for (let steps = 0; c >= 0 && !sea[c] && steps < 10000; steps++) {
      last = c;
      c = receiver[c];
    }
    // Last land cell before the sea: at the drawn mouth (east end), not on the north or south coast.
    expect(last % w).toBeGreaterThan(320);
  });
});
