import { TestBed } from '@angular/core/testing';
import { MapFileCodec, MapRepository, MapSummary } from '../domain/map/map-repository';
import { DEFAULT_MAP_SETTINGS } from '../domain/map/map-settings';
import { WorldMap } from '../domain/map/world-map';
import { MapFormatError } from '../domain/serialization/map-document';
import { EditorFacade } from './editor-facade';
import { MapStore } from './map-store';
import { MAP_FILE_CODEC, MAP_REPOSITORY } from './ports';

class InMemoryRepository implements MapRepository {
  readonly maps = new Map<string, WorldMap>();
  async save(map: WorldMap): Promise<void> {
    this.maps.set(map.id, map);
  }
  async load(id: string): Promise<WorldMap> {
    const map = this.maps.get(id);
    if (!map) throw new MapFormatError('Carte introuvable.');
    return { ...map };
  }
  async list(): Promise<MapSummary[]> {
    return [...this.maps.values()].map((m) => ({ ...m.settings, id: m.id, name: m.name, updatedAt: m.updatedAt }));
  }
  async delete(id: string): Promise<void> {
    this.maps.delete(id);
  }
}

const failingCodec: MapFileCodec = {
  fileExtension: '.cartocraft',
  exportMap: async () => new Blob(),
  importMap: async () => {
    throw new MapFormatError('Ce fichier n’est pas une carte Cartocraft.');
  },
  fileNameFor: () => 'x.cartocraft',
};

describe('EditorFacade', () => {
  let facade: EditorFacade;
  let store: MapStore;
  let repository: InMemoryRepository;

  beforeEach(() => {
    repository = new InMemoryRepository();
    TestBed.configureTestingModule({
      providers: [
        { provide: MAP_REPOSITORY, useValue: repository },
        { provide: MAP_FILE_CODEC, useValue: failingCodec },
      ],
    });
    facade = TestBed.inject(EditorFacade);
    store = TestBed.inject(MapStore);
  });

  it('creates a blank map, saves it immediately and marks all tiles dirty for rendering', async () => {
    await facade.createBlankMap({ ...DEFAULT_MAP_SETTINGS, widthKm: 600, heightKm: 300 }, 'Pangea');
    expect(facade.mapName()).toBe('Pangea');
    expect(store.takeDirtyRects()).toEqual([{ x0: 0, y0: 0, x1: 599, y1: 299 }]);
    expect(facade.savedMaps().map((m) => m.name)).toEqual(['Pangea']);
  });

  it('renames through undoable commands', async () => {
    await facade.createBlankMap(DEFAULT_MAP_SETTINGS, 'A');
    facade.renameMap('B');
    expect(facade.undoLabel()).toBe('Renommer la carte');
    facade.undo();
    expect(facade.mapName()).toBe('A');
    facade.redo();
    expect(facade.mapName()).toBe('B');
    facade.renameMap('  ');
    facade.renameMap('B');
    facade.undo();
    expect(facade.undoLabel()).toBeNull();
  });

  it('duplicates and deletes, closing the current map if deleted', async () => {
    await facade.createBlankMap(DEFAULT_MAP_SETTINGS, 'A');
    const id = facade.currentMapId()!;
    await facade.duplicateMap(id);
    expect(facade.savedMaps().map((m) => m.name).sort()).toEqual(['A', 'A (copie)']);
    await facade.deleteMap(id);
    expect(facade.hasMap()).toBe(false);
    expect(facade.savedMaps().map((m) => m.name)).toEqual(['A (copie)']);
  });

  it('paints a stroke live and undoes it as a single command', async () => {
    await facade.createBlankMap(DEFAULT_MAP_SETTINGS, 'A');
    store.takeDirtyRects();
    facade.setBrush({ radiusKm: 10, strength: 1 });
    facade.pointerDown({ x: 100, y: 100 });
    facade.pointerMove({ x: 140, y: 100 });
    expect(store.takeDirtyRects().length).toBeGreaterThan(1);
    facade.pointerUp();
    expect(facade.altitudeAt({ x: 120, y: 100 })).toBeGreaterThan(-200);
    expect(facade.undoLabel()).toBe('Élever le relief');
    facade.undo();
    expect(facade.altitudeAt({ x: 120, y: 100 })).toBe(-200);
  });

  it('keeps applying while the pointer is held still (airbrush)', async () => {
    vi.useFakeTimers();
    try {
      await facade.createBlankMap(DEFAULT_MAP_SETTINGS, 'A');
      facade.setBrush({ radiusKm: 10, strength: 1 });
      facade.pointerDown({ x: 100, y: 100 });
      const afterFirstDab = facade.altitudeAt({ x: 100, y: 100 })!;
      vi.advanceTimersByTime(1000);
      expect(facade.altitudeAt({ x: 100, y: 100 })!).toBeGreaterThan(afterFirstDab + 300);
      facade.pointerUp();
      const released = facade.altitudeAt({ x: 100, y: 100 });
      vi.advanceTimersByTime(1000);
      expect(facade.altitudeAt({ x: 100, y: 100 })).toBe(released);
    } finally {
      vi.useRealTimers();
    }
  });

  it('does nothing with the pan tool', async () => {
    await facade.createBlankMap(DEFAULT_MAP_SETTINGS, 'A');
    facade.selectTool('pan');
    facade.pointerDown({ x: 100, y: 100 });
    facade.pointerUp();
    expect(facade.undoLabel()).toBeNull();
  });

  it('reports import errors without touching the open map', async () => {
    await facade.createBlankMap(DEFAULT_MAP_SETTINGS, 'A');
    await facade.importMapFile(new Blob(['junk']));
    expect(facade.error()).toBe('Ce fichier n’est pas une carte Cartocraft.');
    expect(facade.mapName()).toBe('A');
  });
});
