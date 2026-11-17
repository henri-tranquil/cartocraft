import { createFeature } from '../domain/features/map-feature';
import { RiverNetwork } from '../domain/hydrology/rivers';
import { labelAt, layoutLabels, TextMeasure } from './label-layer';
import { Viewport } from './viewport';

/** Fake font: every letter is half the font size wide. */
const measure: TextMeasure = (text, fontPx, spacingPx) => text.length * (fontPx / 2 + spacingPx);

/** 1 cell = 1 km; `pxPerKm` sets the scale; the view is centred on (50, 50) km. */
function view(pxPerKm: number): Viewport {
  return { centerX: 50, centerY: 50, pixelsPerCell: pxPerKm, widthPx: 1000, heightPx: 800 };
}

const capital = createFeature({ kind: 'settlement', size: 'capital' }, 'cap', 'Cité', 50, 50);
const village = createFeature({ kind: 'settlement', size: 'village' }, 'vil', 'Hameau', 60, 60);

/** One straight river line along y = 50, from x = 0 to 100, flow growing 1 → 101 m³/s. */
function straightRiver(): RiverNetwork {
  const pts: number[] = [];
  const q: number[] = [];
  for (let x = 0; x <= 100; x++) {
    pts.push(x + 0.5, 50.5);
    q.push(1 + x);
  }
  return {
    pointsCells: Float32Array.from(pts),
    dischargeM3s: Float32Array.from(q),
    starts: Uint32Array.from([0, 101]),
    lineMaxDischargeM3s: Float32Array.from([101]),
    lineBounds: Float32Array.from([0.5, 50.5, 100.5, 50.5]),
  };
}

describe('curved names', () => {
  it('writes a range name along its line, letter by letter', () => {
    const range = createFeature({ kind: 'range' }, 'r', 'Monts', 50, 50, [10, 60, 50, 40, 90, 60]);
    const [label] = layoutLabels([range], view(10), 1, measure);
    expect(label.glyphs).toHaveLength(5);
    expect(label.parts).toHaveLength(5);
    // Rising then falling: the first letters tilt up (negative angle on screen), the last ones down.
    expect(label.glyphs![0].angle).toBeLessThan(0);
    expect(label.glyphs![4].angle).toBeGreaterThan(0);
  });

  it('names a river only where the river itself is shown', () => {
    const river = createFeature({ kind: 'river' }, 'f', 'Loire', 60.5, 50.5);
    const network = straightRiver();
    // At the anchor the flow is ~61 m³/s.
    expect(layoutLabels([river], view(10), 1, measure, { rivers: { network, minDischargeM3s: 30 } })).toHaveLength(1);
    expect(layoutLabels([river], view(10), 1, measure, { rivers: { network, minDischargeM3s: 80 } })).toHaveLength(0);
    // No river computed yet: no name.
    expect(layoutLabels([river], view(10), 1, measure)).toHaveLength(0);
  });
});

describe('layoutLabels', () => {
  it('names a zone only once its name fits inside it on screen', () => {
    // A 20 km wide plain centred on the view.
    const plain = createFeature({ kind: 'region', tone: 'land' }, 'pl', 'Plaine', 50, 50, [40, 45, 60, 45, 60, 55, 40, 55]);
    expect(layoutLabels([plain], view(1), 1, measure)).toEqual([]); // 20 px wide: no room
    const placed = layoutLabels([plain], view(20), 1, measure); // 400 px wide
    expect(placed).toHaveLength(1);
    expect(placed[0].spacingPx).toBeGreaterThan(0); // letters spread over the zone
  });

  it('shows small places only at large scales', () => {
    expect(layoutLabels([capital, village], view(1), 1, measure).map((l) => l.feature.id)).toEqual(['cap']);
    expect(layoutLabels([capital, village], view(20), 1, measure).map((l) => l.feature.id)).toEqual(['cap', 'vil']);
  });

  it('drops the less important of two overlapping names', () => {
    const neighbour = { ...village, rank: 1 as const, xKm: 50.5, yKm: 50 };
    const placed = layoutLabels([neighbour, capital], view(20), 1, measure);
    expect(placed).toHaveLength(1);
    // Same rank: the first in the list wins.
    expect(placed[0].feature.id).toBe('vil');
  });

  it('always shows and prioritises the selected place', () => {
    const farVillage = { ...village, xKm: 300 };
    const placed = layoutLabels([capital, farVillage], view(1), 1, measure, { selectedId: 'vil' });
    expect(placed.map((l) => l.feature.id)).toEqual(['vil', 'cap']);
    // And the selected name wins a collision even against a more important one.
    expect(layoutLabels([capital, village], view(1), 1, measure, { selectedId: 'vil' })[0].feature.id).toBe('vil');
  });

  it('skips places outside the screen', () => {
    const far = { ...capital, id: 'far', xKm: 5000 };
    expect(layoutLabels([far], view(1), 1, measure)).toEqual([]);
  });

  it('finds the label under the pointer', () => {
    const placed = layoutLabels([capital], view(1), 1, measure);
    // Capital sits at the screen centre (500, 400); its name extends to the right.
    expect(labelAt(placed, 520, 400)?.feature.id).toBe('cap');
    expect(labelAt(placed, 400, 400)).toBeNull();
  });
});
