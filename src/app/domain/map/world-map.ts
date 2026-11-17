import { Int16TiledGrid } from '../terrain/tiled-grid';
import { MapSettings } from './map-settings';

export const CURRENT_FORMAT_VERSION = 1;

export interface TerrainData {
  /** Base altitude grid, in metres. High-res touch-up tiles come in step 8. */
  readonly baseAltitudeM: Int16TiledGrid;
}

/**
 * The editable world. Deliberately MUTABLE: grids are large TypedArrays
 * edited in place by commands. Change notification is handled by the
 * application store (revision counter), not by object identity.
 *
 * Fields still to come (each with its roadmap step and a format migration):
 * features (6), climateOverrides (4), hydrologyHints (5).
 */
export interface WorldMap {
  readonly id: string;
  name: string;
  readonly formatVersion: number;
  readonly settings: MapSettings;
  readonly terrain: TerrainData;
  readonly createdAt: string;
  updatedAt: string;
}
