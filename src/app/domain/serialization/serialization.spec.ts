import { MapFactory } from '../map/map-factory';
import { DEFAULT_MAP_SETTINGS } from '../map/map-settings';
import { getCell, setCell } from '../terrain/tiled-grid';
import { decodeContainer, encodeContainer } from './container';
import { int16GridFromBytes, int16GridToBytes } from './grid-codec';
import { MapFormatError, RawMapDocument } from './map-document';
import { Migration, MIGRATIONS, migrateToCurrent } from './migrations';
import { mapFromDocument, mapToDocument } from './map-serializer';

function sampleMap() {
  const map = MapFactory.blank(
    { ...DEFAULT_MAP_SETTINGS, widthKm: 300, heightKm: 270 },
    { id: 'm1', name: 'Pangée', nowIso: '2026-01-01T00:00:00.000Z' },
  );
  setCell(map.terrain.baseAltitudeM, 0, 0, 1234);
  setCell(map.terrain.baseAltitudeM, 299, 269, -4321);
  setCell(map.terrain.baseAltitudeM, 257, 3, 8848);
  return map;
}

describe('grid codec', () => {
  it('round-trips through row-major bytes, even with a different tile size', () => {
    const grid = sampleMap().terrain.baseAltitudeM;
    const restored = int16GridFromBytes(int16GridToBytes(grid), grid.widthCells, grid.heightCells, 64);
    expect(getCell(restored, 257, 3)).toBe(8848);
    expect(getCell(restored, 299, 269)).toBe(-4321);
  });

  it('writes little-endian', () => {
    const grid = sampleMap().terrain.baseAltitudeM;
    const bytes = int16GridToBytes(grid);
    expect(bytes[0] | (bytes[1] << 8)).toBe(1234);
  });
});

describe('container + serializer', () => {
  it('round-trips a full map', () => {
    const original = sampleMap();
    const restored = mapFromDocument(decodeContainer(encodeContainer(mapToDocument(original))));
    expect(restored.name).toBe('Pangée');
    expect(restored.settings).toEqual(original.settings);
    expect(getCell(restored.terrain.baseAltitudeM, 257, 3)).toBe(8848);
  });

  it('rejects foreign or truncated files with a MapFormatError', () => {
    expect(() => decodeContainer(new TextEncoder().encode('hello world'))).toThrow(MapFormatError);
    const bytes = encodeContainer(mapToDocument(sampleMap()));
    expect(() => decodeContainer(bytes.subarray(0, bytes.byteLength - 10))).toThrow(MapFormatError);
  });

  it('rejects invalid settings in the header', () => {
    const doc = mapToDocument(sampleMap());
    const broken: RawMapDocument = { ...doc, header: { ...doc.header, settings: { widthKm: 'big' } } };
    expect(() => mapFromDocument(broken)).toThrow(MapFormatError);
  });
});

describe('migrations', () => {
  const v1ToV2: Migration = {
    fromVersion: 1,
    migrate: (d) => ({ ...d, header: { ...d.header, formatVersion: 2, added: true } }),
  };
  const v2ToV3: Migration = {
    fromVersion: 2,
    migrate: (d) => ({ ...d, header: { ...d.header, formatVersion: 3 } }),
  };
  const doc: RawMapDocument = { header: { formatVersion: 1 }, blocks: new Map() };

  it('applies the chain in order up to the current version', () => {
    const migrated = migrateToCurrent(doc, [v2ToV3, v1ToV2], 3);
    expect(migrated.header).toEqual({ formatVersion: 3, added: true });
  });

  it('v1 → v2 adds "continue" on every edge', () => {
    const migrated = migrateToCurrent({ header: { formatVersion: 1, settings: { seed: 1 } }, blocks: new Map() }, MIGRATIONS, 2);
    expect(migrated.header['settings']).toEqual({ seed: 1, beyondEdges: { north: 'continue', south: 'continue', east: 'continue', west: 'continue' } });
  });

  it('refuses files newer than supported, or with a gap in the chain', () => {
    expect(() => migrateToCurrent({ ...doc, header: { formatVersion: 9 } }, [], 3)).toThrow(/plus récente/);
    expect(() => migrateToCurrent(doc, [v2ToV3], 3)).toThrow(MapFormatError);
  });
});
