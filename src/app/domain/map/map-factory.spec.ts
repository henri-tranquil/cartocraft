import { getCell } from '../terrain/tiled-grid';
import { BLANK_ALTITUDE_M, InvalidMapSettingsError, MapFactory } from './map-factory';
import { DEFAULT_MAP_SETTINGS, validateMapSettings } from './map-settings';

const identity = { id: 'map-1', name: 'Pangea', nowIso: '2026-01-01T00:00:00.000Z' };

describe('MapFactory.blank', () => {
  it('builds a grid sized from km and cell resolution, filled with sea', () => {
    const map = MapFactory.blank({ ...DEFAULT_MAP_SETTINGS, widthKm: 1000, heightKm: 600, baseCellKm: 2 }, identity);
    const grid = map.terrain.baseAltitudeM;
    expect(grid.widthCells).toBe(500);
    expect(grid.heightCells).toBe(300);
    expect(getCell(grid, 499, 299)).toBe(BLANK_ALTITUDE_M);
    expect(map.createdAt).toBe(identity.nowIso);
  });

  it('refuses invalid settings with explicit errors', () => {
    expect(() => MapFactory.blank({ ...DEFAULT_MAP_SETTINGS, widthKm: 5000 }, identity)).toThrow(
      InvalidMapSettingsError,
    );
  });
});

describe('validateMapSettings', () => {
  it('accepts defaults', () => {
    expect(validateMapSettings(DEFAULT_MAP_SETTINGS)).toEqual([]);
  });

  it('rejects inverted latitudes and bad seeds', () => {
    const errors = validateMapSettings({ ...DEFAULT_MAP_SETTINGS, latitudeTopDeg: 10, latitudeBottomDeg: 20, seed: -1 });
    expect(errors.length).toBe(2);
  });
});
