import { DrawnRiverEditCommand } from '../commands/drawn-river-edit-command';
import { MapFactory } from '../map/map-factory';
import { DEFAULT_MAP_SETTINGS } from '../map/map-settings';
import { mapFromDocument, mapToDocument } from '../serialization/map-serializer';
import { createInt16TiledGrid, setCell } from '../terrain/tiled-grid';
import { checkDrawing } from './drawing-checks';
import { applyPaint, SEA_CELL } from './drawing-cell';
import { deltaBranches, DrawnRiver, mouthShape, planRiver, polylineLength, riverEnd, riverFlowsKm, riverFromStroke, riverNear } from './drawn-river';

/** 100 × 100 cells of 1 km: land on the left (x < 60), sea on the right. */
function coast() {
  const grid = createInt16TiledGrid(100, 100, SEA_CELL, 64);
  for (let y = 0; y < 100; y++) for (let x = 0; x < 60; x++) setCell(grid, x, y, applyPaint(SEA_CELL, { kind: 'land' }));
  return grid;
}

describe('riverFromStroke', () => {
  const drawing = coast();
  const ctx = (rivers: DrawnRiver[] = []) => ({ drawing, cellKm: 1, rivers, toleranceKm: 0.5 });

  it('cuts the river where it enters the sea (overshooting is harmless)', () => {
    const river = riverFromStroke([10, 50, 30, 50, 50, 50, 80, 50], ctx())!;
    expect(river.slice(0, 2)).toEqual([10, 50]);
    const mouthX = river[river.length - 2];
    expect(mouthX).toBeGreaterThanOrEqual(60);
    expect(mouthX).toBeLessThan(61);
  });

  it('reverses a river drawn from the sea inland', () => {
    const river = riverFromStroke([90, 20, 40, 20, 10, 20], ctx())!;
    expect(river.slice(0, 2)).toEqual([10, 20]);
    expect(river[river.length - 2]).toBeCloseTo(60, 0);
  });

  it('stops a tributary on the river it meets, and the main river widens below the confluence', () => {
    const main: DrawnRiver = { id: 'main', pointsKm: riverFromStroke([10, 50, 80, 50], ctx())! };
    const tributary: DrawnRiver = { id: 'trib', pointsKm: riverFromStroke([30, 10, 30, 70], ctx([main]))! };
    expect(tributary.pointsKm.slice(-2)).toEqual([30, 50]);
    expect(riverEnd(tributary, [main, tributary], drawing, 1)).toBe('river');
    expect(riverEnd(main, [main, tributary], drawing, 1)).toBe('sea');

    const flows = riverFlowsKm([main, tributary]);
    const mainFlow = flows.get('main')!;
    // Mouth of the main river: its own 50 km plus the tributary's 40 km.
    expect(mainFlow[mainFlow.length - 1]).toBeCloseTo(50 + 40, 0);
    expect(mainFlow[0]).toBe(0);
  });

  it('extends a river ending just short of another one, so that it joins it', () => {
    const main: DrawnRiver = { id: 'main', pointsKm: riverFromStroke([10, 50, 80, 50], ctx())! };
    const short = riverFromStroke([30, 70, 30, 53], { ...ctx([main]), snapKm: 5 })!;
    expect(short.slice(-2)).toEqual([30, 50]);
    expect(riverFromStroke([30, 70, 30, 58], { ...ctx([main]), snapKm: 5 })!.slice(-2)).toEqual([30, 58]);
  });

  it('finds the mouth even when the stroke starts on land at the coast and goes inland', () => {
    const river = riverFromStroke([59, 30, 40, 30, 10, 30], ctx())!;
    expect(river.slice(0, 2)).toEqual([10, 30]);
    expect(river[river.length - 2]).toBeGreaterThanOrEqual(59);
  });

  it('accepts tributaries drawn BEFORE their main river: they are re-attached to it', () => {
    // Two tributaries leading nowhere: one crossing where the main river will be, one ending just short of it.
    const crossing: DrawnRiver = { id: 'a', pointsKm: [20, 20, 20, 60] };
    const short: DrawnRiver = { id: 'b', pointsKm: [40, 80, 40, 53] };
    const plan = planRiver([5, 50, 80, 50], { ...ctx([crossing, short]), snapKm: 5 })!;
    // The main river is not cut by the tributaries: it reaches the sea.
    expect(plan.pointsKm[plan.pointsKm.length - 2]).toBeGreaterThanOrEqual(60);
    const after = new Map(plan.reattached.map((e) => [e.after.id, e.after]));
    expect(after.get('a')!.pointsKm.slice(-2)).toEqual([20, 50]);
    expect(after.get('b')!.pointsKm.slice(-2)).toEqual([40, 50]);
    const all = [{ id: 'main', pointsKm: plan.pointsKm }, ...after.values()];
    const flow = riverFlowsKm(all).get('main')!;
    expect(flow[flow.length - 1]).toBeCloseTo(polylineLength(plan.pointsKm) + 30 + 30, 6);
  });

  it('gives large rivers an estuary or a delta, whose branches all end on the coast', () => {
    const river: DrawnRiver = { id: 'nile', pointsKm: [5, 50, 60, 50] };
    expect(mouthShape(river, 100, 'sea')).toBe('simple');
    expect(mouthShape(river, 300, 'river')).toBe('simple');
    expect(mouthShape(river, 300, 'inland')).toBe('simple');
    expect(['estuary', 'delta']).toContain(mouthShape(river, 300, 'sea'));
    const { forkKm, branches } = deltaBranches(river, 300, drawing, 1);
    expect(forkKm).toBeCloseTo(55 / 2, 6); // 12 % of 300 km = 36 km, capped at half the river
    expect(branches.length).toBeGreaterThan(0);
    for (const b of branches) {
      expect(b.slice(0, 2)).toEqual([32.5, 50]);
      expect(b[b.length - 2]).toBeGreaterThanOrEqual(60); // the sea starts at x = 60
    }
  });

  it('is not stopped by a lone sea cell left inside the land between brush strokes', () => {
    const holed = coast();
    setCell(holed, 30, 50, SEA_CELL);
    const river = riverFromStroke([10, 50, 80, 50], { drawing: holed, cellKm: 1, rivers: [], toleranceKm: 0.5 })!;
    expect(river[river.length - 2]).toBeGreaterThanOrEqual(60);
  });

  it('ignores strokes that are too short or entirely at sea', () => {
    expect(riverFromStroke([10, 10, 10.5, 10], ctx())).toBeNull();
    expect(riverFromStroke([70, 10, 90, 30], ctx())).toBeNull();
  });

  it('warns about a river ending inland, and picks rivers near the pointer', () => {
    const lost: DrawnRiver = { id: 'lost', pointsKm: [10, 80, 30, 80] };
    expect(riverEnd(lost, [lost], drawing, 1)).toBe('inland');
    const warnings = checkDrawing(drawing, { latitudeTopDeg: 50, latitudeBottomDeg: 40, baseCellKm: 1 }, [lost]);
    expect(warnings).toEqual([{ kind: 'riverEndsInland', count: 1 }]);
    expect(riverNear([lost], 20, 82, 3)?.id).toBe('lost');
    expect(riverNear([lost], 20, 90, 3)).toBeNull();
  });
});

describe('drawn rivers in the map', () => {
  it('are added and removed by an undoable command, and saved with the map', () => {
    const map = MapFactory.blank({ ...DEFAULT_MAP_SETTINGS, widthKm: 50, heightKm: 50 }, { id: 'm', name: 'M', nowIso: '2026-11-18T00:00:00.000Z' });
    const river = { id: 'r1', pointsKm: [1, 2, 3, 4, 5, 6] };
    const add = new DrawnRiverEditCommand('Tracer un fleuve', { before: null, after: river });
    add.execute(map);
    expect(map.rivers).toEqual([river]);
    const restored = mapFromDocument(mapToDocument(map));
    expect(restored.rivers).toEqual([river]);
    add.undo(map);
    expect(map.rivers).toEqual([]);
  });

  it('reads a header without rivers (saved before D5) as none', () => {
    const map = MapFactory.blank({ ...DEFAULT_MAP_SETTINGS, widthKm: 50, heightKm: 50 }, { id: 'm', name: 'M', nowIso: '2026-11-18T00:00:00.000Z' });
    const document = mapToDocument(map);
    const header: Record<string, unknown> = { ...document.header };
    delete header['rivers'];
    expect(mapFromDocument({ ...document, header }).rivers).toEqual([]);
  });
});
