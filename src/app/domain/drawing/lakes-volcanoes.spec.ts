import { DrawnVolcanoEditCommand } from '../commands/drawn-volcano-edit-command';
import { MapFactory } from '../map/map-factory';
import { DEFAULT_MAP_SETTINGS } from '../map/map-settings';
import { mapFromDocument, mapToDocument } from '../serialization/map-serializer';
import { createInt16TiledGrid, setCell } from '../terrain/tiled-grid';
import { applyPaint, encodeDrawingCell, isLakeCode, isLandCode, LAKE_CELL, SEA_CELL } from './drawing-cell';
import { nearestDrawnRiverPoint, planRiver, riverEnd } from './drawn-river';
import { volcanoAt, volcanoNear } from './drawn-volcano';

const LAND = encodeDrawingCell({ land: true, relief: 'hills', forest: 'conifer' });

describe('drawn lakes', () => {
  it('are painted over land only, erase relief and forest, and give way to land again', () => {
    expect(applyPaint(LAND, { kind: 'lake' })).toBe(LAKE_CELL);
    expect(applyPaint(SEA_CELL, { kind: 'lake' })).toBe(SEA_CELL);
    expect(isLandCode(LAKE_CELL)).toBe(false);
    expect(applyPaint(LAKE_CELL, { kind: 'relief', relief: 'highMountain' })).toBe(LAKE_CELL);
    const back = applyPaint(LAKE_CELL, { kind: 'land' });
    expect(isLandCode(back) && !isLakeCode(back)).toBe(true);
  });

  it('stop a river like the sea, and its end reads as a lake', () => {
    // 100 × 60 land, a lake at x 60..80, the sea beyond x 90.
    const drawing = createInt16TiledGrid(100, 60, SEA_CELL, 64);
    for (let y = 0; y < 60; y++) for (let x = 0; x < 90; x++) setCell(drawing, x, y, x >= 60 && x < 80 && y >= 20 && y < 40 ? LAKE_CELL : LAND);
    const plan = planRiver([10, 30, 40, 31, 70, 30], { drawing, cellKm: 1, rivers: [], toleranceKm: 0.5 });
    expect(plan).not.toBeNull();
    const river = { id: 'r', pointsKm: plan?.pointsKm ?? [] };
    expect(river.pointsKm[river.pointsKm.length - 2]).toBeLessThan(62);
    expect(riverEnd(river, [river], drawing, 1)).toBe('lake');
    // The outlet: traced from the lake to the sea, it keeps its direction and starts on the shore.
    const outlet = planRiver([70, 30, 85, 30, 95, 30], { drawing, cellKm: 1, rivers: [], toleranceKm: 0.5 });
    expect(outlet?.pointsKm[0]).toBeGreaterThanOrEqual(78);
    expect(riverEnd({ id: 'o', pointsKm: outlet?.pointsKm ?? [] }, [], drawing, 1)).toBe('sea');
  });
});

describe('drawn volcanoes', () => {
  it('are added, moved and removed by undoable commands, and saved with the map', () => {
    const map = MapFactory.blank({ ...DEFAULT_MAP_SETTINGS, widthKm: 50, heightKm: 50 }, { id: 'm', name: 'M', nowIso: '2026-01-01T00:00:00.000Z' });
    const v = { id: 'v1', xKm: 10, yKm: 12, kind: 'shield' as const };
    const add = new DrawnVolcanoEditCommand('Poser', null, v);
    expect(add.execute(map).volcanoes).toBe(true);
    const move = new DrawnVolcanoEditCommand('Déplacer', v, { ...v, xKm: 20 });
    move.execute(map);
    expect(map.volcanoes).toEqual([{ id: 'v1', xKm: 20, yKm: 12, kind: 'shield' }]);
    expect(mapFromDocument(mapToDocument(map)).volcanoes).toEqual(map.volcanoes);
    move.undo(map);
    expect(map.volcanoes[0].xKm).toBe(10);
    const remove = new DrawnVolcanoEditCommand('Effacer', v, null);
    remove.execute(map);
    expect(map.volcanoes).toEqual([]);
    remove.undo(map);
    expect(volcanoNear(map.volcanoes, 11, 12, 2)?.id).toBe('v1');
    expect(volcanoNear(map.volcanoes, 30, 30, 2)).toBeNull();
    // A click on the cone, well above its base (1 km per px): picked; beside it or below: not.
    expect(volcanoAt(map.volcanoes, 12, 12 - 25, 1)?.id).toBe('v1');
    expect(volcanoAt(map.volcanoes, 10 + 25, 12 - 10, 1)).toBeNull();
    expect(volcanoAt(map.volcanoes, 10, 12 + 10, 1)).toBeNull();
  });
});

describe('river names on drawn rivers', () => {
  it('anchor on the nearest point of the nearest river', () => {
    const rivers = [{ id: 'a', pointsKm: [0, 0, 10, 0] }, { id: 'b', pointsKm: [0, 5, 10, 5] }];
    expect(nearestDrawnRiverPoint(rivers, 4, 1, 2)).toEqual({ river: rivers[0], xKm: 4, yKm: 0 });
    expect(nearestDrawnRiverPoint(rivers, 4, 2.5, 1)).toBeNull();
  });
});
