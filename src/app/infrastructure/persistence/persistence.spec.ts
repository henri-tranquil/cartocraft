import 'fake-indexeddb/auto';
import { openDB } from 'idb';
import { isLandCode } from '../../domain/drawing/drawing-cell';
import { MapFactory } from '../../domain/map/map-factory';
import { DEFAULT_MAP_SETTINGS } from '../../domain/map/map-settings';
import { WorldMap } from '../../domain/map/world-map';
import { MapFormatError } from '../../domain/serialization/map-document';
import { getCell, setCell, tileIndexAt } from '../../domain/terrain/tiled-grid';
import { IndexedDbMapRepository } from './indexed-db-map-repository';
import { exportMapToBlob, importMapFromBlob, mapFileName } from './map-file';

let counter = 0;
function sampleMap(id = 'm1', updatedAt = '2026-01-01T00:00:00.000Z'): WorldMap {
  return MapFactory.blank(
    { ...DEFAULT_MAP_SETTINGS, widthKm: 300, heightKm: 300 },
    { id, name: 'Pangée', nowIso: updatedAt },
  );
}

describe('.cartocraft file', () => {
  it('round-trips through gzip and is much smaller than raw', async () => {
    const map = sampleMap();
    setCell(map.terrain.baseAltitudeM, 150, 150, 2500);
    const blob = await exportMapToBlob(map);
    expect(blob.size).toBeLessThan(300 * 300 * 2 / 10);
    const restored = await importMapFromBlob(blob);
    expect(getCell(restored.terrain.baseAltitudeM, 150, 150)).toBe(2500);
  });

  it('rejects a non-gzip file with a clear error', async () => {
    await expect(importMapFromBlob(new Blob(['not a map']))).rejects.toBeInstanceOf(MapFormatError);
  });

  it('builds an ASCII file name', () => {
    expect(mapFileName(sampleMap())).toBe('Pangee.cartocraft');
  });
});

describe('IndexedDbMapRepository', () => {
  let repo: IndexedDbMapRepository;
  beforeEach(() => {
    repo = new IndexedDbMapRepository(`test-${counter++}`);
  });

  it('saves fully, then only changed tiles, and loads back', async () => {
    const map = sampleMap();
    await repo.save(map, 'all');
    setCell(map.terrain.baseAltitudeM, 299, 299, 1000);
    setCell(map.terrain.drawing, 10, 10, 1);
    map.name = 'Renommée';
    await repo.save(map, {
      altitude: [tileIndexAt(map.terrain.baseAltitudeM, 299, 299)],
      drawing: [tileIndexAt(map.terrain.drawing, 10, 10)],
    });

    const loaded = await repo.load('m1');
    expect(loaded.name).toBe('Renommée');
    expect(getCell(loaded.terrain.baseAltitudeM, 299, 299)).toBe(1000);
    expect(getCell(loaded.terrain.drawing, 10, 10)).toBe(1);
  });

  it('lists most recent first and deletes a map with its tiles', async () => {
    await repo.save(sampleMap('old', '2026-01-01T00:00:00.000Z'), 'all');
    await repo.save(sampleMap('new', '2026-02-01T00:00:00.000Z'), 'all');
    expect((await repo.list()).map((s) => s.id)).toEqual(['new', 'old']);

    await repo.delete('new');
    expect((await repo.list()).map((s) => s.id)).toEqual(['old']);
    await expect(repo.load('new')).rejects.toBeInstanceOf(MapFormatError);
    expect(getCell((await repo.load('old')).terrain.baseAltitudeM, 0, 0)).toBe(-200);
  });

  describe('drawing saved incompletely (regression, 18/11/2026)', () => {
    /** Raw access to the same database, to fake an old or broken record. */
    async function raw(name: string) {
      return openDB(name, 1);
    }

    it('an old map (format 3) edited once still opens: the migrated drawing is written whole', async () => {
      const name = `test-${counter++}`;
      const map = sampleMap();
      setCell(map.terrain.baseAltitudeM, 10, 10, 500); // a 1-cell island
      await new IndexedDbMapRepository(name).save(map, 'all');
      // Turn the record into a format-3 one: no drawing grid, no drawing tiles.
      const db = await raw(name);
      const record = await db.get('maps', 'm1');
      record.header = { ...record.header, formatVersion: 3, grids: record.header.grids.filter((g: { block: string }) => g.block !== 'drawing') };
      await db.put('maps', record, 'm1');
      await db.delete('tiles', IDBKeyRange.bound(['m1', 'drawing'], ['m1', 'drawing', []]));
      db.close();

      const repo = new IndexedDbMapRepository(name);
      const loaded = await repo.load('m1');
      expect(isLandCode(getCell(loaded.terrain.drawing, 10, 10))).toBe(true);
      // One stroke on the drawing, in another tile than the island.
      setCell(loaded.terrain.drawing, 290, 290, 1);
      await repo.save(loaded, { altitude: [], drawing: [tileIndexAt(loaded.terrain.drawing, 290, 290)] });

      const reloaded = await new IndexedDbMapRepository(name).load('m1');
      expect(isLandCode(getCell(reloaded.terrain.drawing, 10, 10))).toBe(true);
      expect(getCell(reloaded.terrain.drawing, 290, 290)).toBe(1);
    });

    it('a map already saved with missing drawing tiles opens again and keeps what was painted', async () => {
      const name = `test-${counter++}`;
      const map = sampleMap();
      setCell(map.terrain.baseAltitudeM, 10, 10, 500);
      setCell(map.terrain.drawing, 290, 290, 1); // painted by hand, far from the island
      await new IndexedDbMapRepository(name).save(map, 'all');
      // The bug: only the painted drawing tile was ever written.
      const keep = tileIndexAt(map.terrain.drawing, 290, 290);
      const db = await raw(name);
      for (let i = 0; i < map.terrain.drawing.tiles.length; i++) if (i !== keep) await db.delete('tiles', ['m1', 'drawing', i]);
      db.close();

      const repo = new IndexedDbMapRepository(name);
      const loaded = await repo.load('m1');
      expect(getCell(loaded.terrain.drawing, 290, 290)).toBe(1);
      expect(isLandCode(getCell(loaded.terrain.drawing, 10, 10))).toBe(true); // rebuilt from the altitude
      // Next save (even without drawing changes) completes the record.
      await repo.save(loaded, { altitude: [], drawing: [] });
      const check = await raw(name);
      expect(await check.count('tiles', IDBKeyRange.bound(['m1', 'drawing'], ['m1', 'drawing', []]))).toBe(map.terrain.drawing.tiles.length);
      check.close();
    });
  });
});

