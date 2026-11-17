import { FeatureEditCommand } from '../commands/feature-edit-command';
import { MapFactory } from '../map/map-factory';
import { DEFAULT_MAP_SETTINGS } from '../map/map-settings';
import { decodeContainer, encodeContainer } from '../serialization/container';
import { MapFormatError } from '../serialization/map-document';
import { mapFromDocument, mapToDocument } from '../serialization/map-serializer';
import { createFeature, defaultRank, MapFeature } from './map-feature';

function blankMap() {
  return MapFactory.blank({ ...DEFAULT_MAP_SETTINGS, widthKm: 50, heightKm: 40 }, { id: 'm', name: 'Test', nowIso: '2026-01-01T00:00:00.000Z' });
}

const village = createFeature({ kind: 'settlement', size: 'village' }, 'v1', 'Bourg-Joli', 12, 30);
const sea = createFeature({ kind: 'label', tone: 'water' }, 's1', 'Mer Intérieure', 40, 5);

describe('defaultRank', () => {
  it('ranks a capital first and a village last', () => {
    expect(defaultRank({ kind: 'settlement', size: 'capital' })).toBe(1);
    expect(defaultRank({ kind: 'settlement', size: 'village' })).toBe(5);
    expect(village.rank).toBe(5);
  });
});

describe('FeatureEditCommand', () => {
  it('adds, modifies and deletes, each undoable', () => {
    const map = blankMap();
    map.features.push(sea);
    const add = new FeatureEditCommand('Ajouter', null, village);
    add.execute(map);
    expect(map.features.map((f) => f.id)).toEqual(['s1', 'v1']);

    const renamed: MapFeature = { ...village, name: 'Bourg-Neuf' };
    const rename = new FeatureEditCommand('Renommer', village, renamed);
    rename.execute(map);
    expect(map.features[1].name).toBe('Bourg-Neuf');
    rename.undo(map);
    expect(map.features[1].name).toBe('Bourg-Joli');

    const remove = new FeatureEditCommand('Supprimer', sea, null);
    remove.execute(map);
    expect(map.features.map((f) => f.id)).toEqual(['v1']);
    remove.undo(map);
    expect(map.features.map((f) => f.id)).toEqual(['s1', 'v1']); // back at its place

    add.undo(map);
    expect(map.features.map((f) => f.id)).toEqual(['s1']);
  });
});

describe('features in the file format', () => {
  it('round-trips through the container', () => {
    const map = blankMap();
    map.features.push(village, sea);
    const restored = mapFromDocument(decodeContainer(encodeContainer(mapToDocument(map))));
    expect(restored.features).toEqual([village, sea]);
  });

  it('gives v2 maps an empty list', () => {
    const document = mapToDocument(blankMap());
    const header: Record<string, unknown> = { ...document.header, formatVersion: 2 };
    delete header['features'];
    expect(mapFromDocument({ ...document, header }).features).toEqual([]);
  });

  it('rejects a malformed place with a clear message', () => {
    const document = mapToDocument(blankMap());
    const header = { ...document.header, features: [{ ...village, rank: 9 }] };
    expect(() => mapFromDocument({ ...document, header })).toThrow(MapFormatError);
    expect(() => mapFromDocument({ ...document, header })).toThrow(/importance/);
  });
});
