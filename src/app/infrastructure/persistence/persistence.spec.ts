import 'fake-indexeddb/auto';
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
    map.name = 'Renommée';
    await repo.save(map, [tileIndexAt(map.terrain.baseAltitudeM, 299, 299)]);

    const loaded = await repo.load('m1');
    expect(loaded.name).toBe('Renommée');
    expect(getCell(loaded.terrain.baseAltitudeM, 299, 299)).toBe(1000);
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
});
