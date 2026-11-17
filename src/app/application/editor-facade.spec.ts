import { TestBed } from '@angular/core/testing';
import { MapFileCodec, MapRepository, MapSummary } from '../domain/map/map-repository';
import { DEFAULT_MAP_SETTINGS } from '../domain/map/map-settings';
import { WorldMap } from '../domain/map/world-map';
import { MapFormatError } from '../domain/serialization/map-document';
import { EditorFacade } from './editor-facade';
import { MapStore } from './map-store';
import { CLIMATE_ENGINE, MAP_FILE_CODEC, MAP_REPOSITORY } from './ports';
import { computeClimate } from '../domain/climate/climate';
import { ClimateEngine } from '../domain/climate/climate-engine';

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

/** Same algorithm as the worker, run synchronously. */
const inlineClimateEngine: ClimateEngine = { compute: async (input) => computeClimate(input) };

/** These tests wait for a full climate run (map + margin), synchronous here. */
const CLIMATE_TEST_TIMEOUT_MS = 20_000;

/** Smallest map that waits for a full climate run (map + margin), kept cheap. */
const CLIMATE_MAP = { ...DEFAULT_MAP_SETTINGS, widthKm: 60, heightKm: 60 };

/** Small map: each map creation triggers a (synchronous, in tests) climate run. */
const SMALL_MAP = { ...DEFAULT_MAP_SETTINGS, widthKm: 200, heightKm: 200 };

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
        { provide: CLIMATE_ENGINE, useValue: inlineClimateEngine },
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
    await facade.createBlankMap(SMALL_MAP, 'A');
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

  it('places, names and moves a place, each step undoable', async () => {
    await facade.createBlankMap(SMALL_MAP, 'A');
    facade.addFeatureAt({ x: 10, y: 20 }); // ignored outside the Names section
    expect(facade.features()).toHaveLength(0);

    facade.setNamesEditing(true);
    facade.setNewPlaceTemplate({ kind: 'settlement', size: 'city' });
    facade.addFeatureAt({ x: 10, y: 20 });
    const id = facade.selectedFeatureId();
    expect(facade.selectedFeature()).toMatchObject({ kind: 'settlement', size: 'city', rank: 2, xKm: 10, yKm: 20, name: '' });

    facade.renameFeature(id!, '  Port-Royal ');
    facade.moveFeature(id!, 15, 25);
    expect(facade.selectedFeature()).toMatchObject({ name: 'Port-Royal', xKm: 15, yKm: 25 });

    facade.undo();
    expect(facade.selectedFeature()?.xKm).toBe(10);
    facade.undo();
    facade.undo();
    expect(facade.features()).toHaveLength(0);
    expect(facade.selectedFeature()).toBeNull();
  });

  it('draws a zone, names it at its widest point and moves it with its outline', async () => {
    await facade.createBlankMap(SMALL_MAP, 'A');
    facade.setNamesEditing(true);
    facade.setNewPlaceTemplate({ kind: 'region', tone: 'land' });
    facade.addZone([10, 10, 11, 10, 11, 11]); // too small: a slip of the mouse
    expect(facade.features()).toHaveLength(0);

    facade.addZone([10, 10, 50, 10, 50, 30, 10, 30]);
    const zone = facade.selectedFeature();
    expect(zone?.kind).toBe('region');
    expect(zone?.xKm).toBeCloseTo(30, 0);
    expect(zone?.yKm).toBeCloseTo(20, 0);

    facade.moveFeature(zone!.id, zone!.xKm + 5, zone!.yKm);
    const moved = facade.selectedFeature();
    expect(moved?.kind === 'region' && moved.outlineKm.slice(0, 2)).toEqual([15, 10]);
  });

  it('duplicates and deletes, closing the current map if deleted', async () => {
    await facade.createBlankMap(SMALL_MAP, 'A');
    const id = facade.currentMapId()!;
    await facade.duplicateMap(id);
    expect(facade.savedMaps().map((m) => m.name).sort()).toEqual(['A', 'A (copie)']);
    await facade.deleteMap(id);
    expect(facade.hasMap()).toBe(false);
    expect(facade.savedMaps().map((m) => m.name)).toEqual(['A (copie)']);
  });

  it('paints a stroke live and undoes it as a single command', async () => {
    await facade.createBlankMap(SMALL_MAP, 'A');
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
      await facade.createBlankMap(SMALL_MAP, 'A');
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
    await facade.createBlankMap(SMALL_MAP, 'A');
    facade.selectTool('pan');
    facade.pointerDown({ x: 100, y: 100 });
    facade.pointerUp();
    expect(facade.undoLabel()).toBeNull();
  });

  it('computes the climate when a map opens and exposes temperatures by season', async () => {
    await facade.createBlankMap(CLIMATE_MAP, 'A');
    await vi.waitFor(() => expect(facade.climateStatus()).toBe('ready'));
    facade.setViewMode('temperature');
    expect(facade.climateOverlay()).not.toBeNull();
    facade.setYearPhase(0.04);
    const january = facade.temperatureAt({ x: 30, y: 30 })!;
    facade.setYearPhase(0.54);
    expect(facade.temperatureAt({ x: 30, y: 30 })!).toBeGreaterThan(january);
  }, CLIMATE_TEST_TIMEOUT_MS);

  it('marks the climate stale after a terrain edit', async () => {
    await facade.createBlankMap(CLIMATE_MAP, 'A');
    await vi.waitFor(() => expect(facade.climateStatus()).toBe('ready'));
    facade.pointerDown({ x: 30, y: 30 });
    facade.pointerUp();
    expect(facade.climateStatus()).toBe('stale');
  }, CLIMATE_TEST_TIMEOUT_MS);

  it('only pans while editing is disabled, then restores the relief tool', async () => {
    await facade.createBlankMap(SMALL_MAP, 'A');
    facade.setEditingEnabled(false);
    expect(facade.effectiveTool()).toBe('pan');
    facade.pointerDown({ x: 100, y: 100 });
    facade.pointerUp();
    expect(facade.undoLabel()).toBeNull();
    facade.setEditingEnabled(true);
    expect(facade.effectiveTool()).toBe('raise');
  });

  it('sets latitudes from two pins as one undoable command and recomputes the climate', async () => {
    await facade.createBlankMap(CLIMATE_MAP, 'A');
    await vi.waitFor(() => expect(facade.climateStatus()).toBe('ready'));
    facade.startLatitudeEditing();
    facade.moveLatitudePin(0, 0);
    facade.setLatitudePinValue(0, 30);
    facade.moveLatitudePin(1, 60);
    facade.setLatitudePinValue(1, 10);
    expect(facade.settings()?.latitudeTopDeg).toBe(30);
    expect(facade.settings()?.latitudeBottomDeg).toBe(10);
    expect(facade.climateStatus()).not.toBe('ready');
    facade.undo();
    expect(facade.settings()?.latitudeBottomDeg).toBe(DEFAULT_MAP_SETTINGS.latitudeBottomDeg);
  }, CLIMATE_TEST_TIMEOUT_MS);

  it('changes the axial tilt as an undoable command', async () => {
    await facade.createBlankMap(SMALL_MAP, 'A');
    facade.updateClimateSettings({ axialTiltDeg: 40 });
    expect(facade.settings()?.axialTiltDeg).toBe(40);
    expect(facade.undoLabel()).toBe('Régler l’inclinaison de l’axe');
    facade.undo();
    expect(facade.settings()?.axialTiltDeg).toBe(DEFAULT_MAP_SETTINGS.axialTiltDeg);
    facade.updateClimateSettings({ axialTiltDeg: 120 });
    expect(facade.error()).toContain('inclinaison');
  });

  it('previews the tilt while a tropic is dragged, then commits one command', async () => {
    await facade.createBlankMap(SMALL_MAP, 'A');
    facade.previewTilt(30.04);
    expect(facade.displayedTilt()).toBe(30);
    expect(facade.settings()?.axialTiltDeg).toBe(DEFAULT_MAP_SETTINGS.axialTiltDeg);
    facade.commitTiltPreview();
    expect(facade.settings()?.axialTiltDeg).toBe(30);
    expect(facade.undoLabel()).toBe('Régler l’inclinaison de l’axe');
  });

  it('refuses pins that would put the south at the top', async () => {
    await facade.createBlankMap(SMALL_MAP, 'A');
    facade.startLatitudeEditing();
    facade.setLatitudePinValue(0, -10);
    expect(facade.error()).toContain('latitude du haut');
    expect(facade.settings()?.latitudeTopDeg).toBe(DEFAULT_MAP_SETTINGS.latitudeTopDeg);
  });

  it('reports import errors without touching the open map', async () => {
    await facade.createBlankMap(SMALL_MAP, 'A');
    await facade.importMapFile(new Blob(['junk']));
    expect(facade.error()).toBe('Ce fichier n’est pas une carte Cartocraft.');
    expect(facade.mapName()).toBe('A');
  });
});
