import { createInt16TiledGrid } from '../terrain/tiled-grid';
import { gridSizeCells, MapSettings, validateMapSettings } from './map-settings';
import { CURRENT_FORMAT_VERSION, WorldMap } from './world-map';

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
  blank(settings: MapSettings, identity: MapIdentity): WorldMap {
    const errors = validateMapSettings(settings);
    if (errors.length > 0) throw new InvalidMapSettingsError(errors);
    const { widthCells, heightCells } = gridSizeCells(settings);
    return {
      id: identity.id,
      name: identity.name,
      formatVersion: CURRENT_FORMAT_VERSION,
      settings,
      terrain: { baseAltitudeM: createInt16TiledGrid(widthCells, heightCells, BLANK_ALTITUDE_M) },
      createdAt: identity.nowIso,
      updatedAt: identity.nowIso,
    };
  },
  // fromNoise(settings, identity) arrives with procedural noise (step 2/3).
} as const;
