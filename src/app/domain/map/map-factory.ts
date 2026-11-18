import { drawingFromAltitudes } from '../drawing/drawing-from-altitudes';
import { SEA_CELL } from '../drawing/drawing-cell';
import { createInt16TiledGrid, fromRowMajor } from '../terrain/tiled-grid';
import { gridSizeCells, MapSettings, validateMapSettings } from './map-settings';
import { CURRENT_FORMAT_VERSION, MapSource, WorldMap } from './world-map';

/** Altitude of a blank map: a shallow sea the user raises land from. */
export const BLANK_ALTITUDE_M = -200;

/** Non-deterministic inputs are injected so the factory stays pure and testable. */
export interface MapIdentity {
  readonly id: string;
  readonly name: string;
  readonly nowIso: string;
}

export class InvalidMapSettingsError extends Error {
  constructor(readonly errors: readonly string[]) {
    super(errors.join(' '));
    this.name = 'InvalidMapSettingsError';
  }
}

export const MapFactory = {
  /** An empty sea, drawn on by default; a 'world' map is raised with the altitude brushes. */
  blank(settings: MapSettings, identity: MapIdentity, source: MapSource = 'drawing'): WorldMap {
    const errors = validateMapSettings(settings);
    if (errors.length > 0) throw new InvalidMapSettingsError(errors);
    const { widthCells, heightCells } = gridSizeCells(settings);
    return {
      id: identity.id,
      name: identity.name,
      formatVersion: CURRENT_FORMAT_VERSION,
      source,
      settings,
      terrain: {
        baseAltitudeM: createInt16TiledGrid(widthCells, heightCells, BLANK_ALTITUDE_M),
        drawing: createInt16TiledGrid(widthCells, heightCells, SEA_CELL),
      },
      features: [],
      rivers: [],
      createdAt: identity.nowIso,
      updatedAt: identity.nowIso,
    };
  },
  /** A 'world' map whose base altitudes come from a row-major array (sketch import); its drawing is guessed from them. */
  fromAltitudes(settings: MapSettings, identity: MapIdentity, altitudeM: Int16Array): WorldMap {
    const map = MapFactory.blank(settings, identity, 'world');
    const { widthCells: w, heightCells: h } = map.terrain.baseAltitudeM;
    if (altitudeM.length !== w * h) throw new Error('Altitude array does not match the grid size');
    return {
      ...map,
      terrain: {
        baseAltitudeM: fromRowMajor(altitudeM, w, h),
        drawing: fromRowMajor(drawingFromAltitudes(altitudeM, w, h, settings.seaLevelM), w, h),
      },
    };
  },
  // fromNoise(settings, identity) arrives with procedural noise (step 2/3).
} as const;
