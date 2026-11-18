import { applyPaint, SEA_CELL } from '../../domain/drawing/drawing-cell';
import { riverEnd, riverFlowsKm, riverSnapAt } from '../../domain/drawing/drawn-river';
import { MapFactory } from '../../domain/map/map-factory';
import { DEFAULT_MAP_SETTINGS } from '../../domain/map/map-settings';
import { setCell } from '../../domain/terrain/tiled-grid';
import { ToolContext } from './editor-tool';
import { RiverDrawTool } from './river-tools';

/** 100 × 100 km map at 1 km: land for x < 60, sea beyond. */
function setup() {
  const map = MapFactory.blank({ ...DEFAULT_MAP_SETTINGS, widthKm: 100, heightKm: 100, baseCellKm: 1 }, { id: 'm', name: 'M', nowIso: '2026-11-18T00:00:00.000Z' });
  for (let y = 0; y < 100; y++) for (let x = 0; x < 60; x++) setCell(map.terrain.drawing, x, y, applyPaint(SEA_CELL, { kind: 'land' }));
  const ctx: ToolContext = { map, markTerrainDirty: () => undefined, markDrawingDirty: () => undefined };
  // 1 km per pixel: the magnet reaches 12 km (18 km for river ends).
  const tool = new RiverDrawTool(() => 1, () => undefined);
  const trace = (...points: [number, number][]) => {
    tool.begin(ctx, { x: points[0][0], y: points[0][1] });
    for (const [x, y] of points.slice(1)) tool.move(ctx, { x, y });
    return tool.end(ctx);
  };
  return { map, trace };
}

describe('River tool magnet', () => {
  it('extends a river upstream when the stroke starts at its source', () => {
    const { map, trace } = setup();
    trace([30, 50], [80, 50]);
    expect(map.rivers).toHaveLength(1);
    const id = map.rivers[0].id;
    expect(riverSnapAt(map.rivers, map.terrain.drawing, 1, 32, 51, 12)?.kind).toBe('source');
    trace([31, 50], [5, 50]);
    expect(map.rivers).toHaveLength(1);
    expect(map.rivers[0].id).toBe(id);
    expect(map.rivers[0].pointsKm.slice(0, 2)).toEqual([5, 50]);
    expect(riverEnd(map.rivers[0], map.rivers, map.terrain.drawing, 1)).toBe('sea');
  });

  it('extends a river leading nowhere from its end, down to the sea', () => {
    const { map, trace } = setup();
    trace([5, 20], [30, 20]);
    expect(riverEnd(map.rivers[0], map.rivers, map.terrain.drawing, 1)).toBe('inland');
    trace([31, 21], [90, 20]);
    expect(map.rivers).toHaveLength(1);
    expect(map.rivers[0].pointsKm.slice(0, 2)).toEqual([5, 20]);
    expect(riverEnd(map.rivers[0], map.rivers, map.terrain.drawing, 1)).toBe('sea');
  });

  it('starts a tributary from a point on a river: its mouth is where the stroke started', () => {
    const { map, trace } = setup();
    trace([5, 50], [80, 50]);
    trace([30, 52], [30, 90]);
    expect(map.rivers).toHaveLength(2);
    const tributary = map.rivers[1];
    expect(tributary.pointsKm.slice(0, 2)).toEqual([30, 90]);
    expect(tributary.pointsKm.slice(-2)).toEqual([30, 50]);
    expect(riverEnd(tributary, map.rivers, map.terrain.drawing, 1)).toBe('river');
    const main = riverFlowsKm(map.rivers).get(map.rivers[0].id)!;
    expect(main[main.length - 1]).toBeGreaterThan(55 + 39);
  });

  it('connects a river leading nowhere to the sea from the middle of its course (its dead end is dropped)', () => {
    const { map, trace } = setup();
    trace([5, 30], [55, 30]); // stops inland
    const id = map.rivers[0].id;
    trace([30, 31], [30, 45], [80, 45]); // from its course (magnet, far from both ends), down to the sea
    expect(map.rivers).toHaveLength(1);
    const river = map.rivers[0];
    expect(river.id).toBe(id);
    expect(river.pointsKm.slice(0, 2)).toEqual([5, 30]);
    expect(riverEnd(river, map.rivers, map.terrain.drawing, 1)).toBe('sea');
    expect(Math.max(...river.pointsKm.filter((_, i) => i % 2 === 0 && river.pointsKm[i + 1] === 30))).toBeLessThanOrEqual(30);
  });

  it('connects it too when the stroke comes from the sea and stops on its course', () => {
    const { map, trace } = setup();
    trace([5, 30], [40, 30]);
    trace([90, 70], [30, 70], [25, 31]);
    expect(map.rivers).toHaveLength(1);
    expect(riverEnd(map.rivers[0], map.rivers, map.terrain.drawing, 1)).toBe('sea');
    expect(map.rivers[0].pointsKm.slice(0, 2)).toEqual([5, 30]);
  });
});
