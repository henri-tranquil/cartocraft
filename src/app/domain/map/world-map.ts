import { DrawnRiver } from '../drawing/drawn-river';
import { MapFeature } from '../features/map-feature';
import { Int16TiledGrid } from '../terrain/tiled-grid';
import { MapSettings } from './map-settings';

export const CURRENT_FORMAT_VERSION = 4;

export interface TerrainData {
  /** Base altitude grid, in metres. High-res touch-up tiles come in step 8. */
  readonly baseAltitudeM: Int16TiledGrid;
  /**
   * What the user DREW (land/sea, relief class, forest), one code per cell,
   * same tiling as the altitude (see domain/drawing/drawing-cell.ts).
   * The master data of the "Dessiner d'abord" workflow: the altitude will be
   * regenerated from it by the conversion (step D6).
   */
  readonly drawing: Int16TiledGrid;
}

/** Which tiled grid of the terrain a tile index refers to. */
export type TerrainLayer = 'altitude' | 'drawing';

export function terrainGrid(map: WorldMap, layer: TerrainLayer): Int16TiledGrid {
  return layer === 'altitude' ? map.terrain.baseAltitudeM : map.terrain.drawing;
}

/**
 * The editable world. Deliberately MUTABLE: grids are large TypedArrays
 * edited in place by commands. Change notification is handled by the
 * application store (revision counter), not by object identity.
 *
 * Fields still to come (each with its roadmap step and a format migration):
 * climateOverrides (4), hydrologyHints (5).
 */
export interface WorldMap {
  readonly id: string;
  name: string;
  readonly formatVersion: number;
  /** Mutable: replaced as a whole by UpdateSettingsCommand. */
  settings: MapSettings;
  readonly terrain: TerrainData;
  /** Named places, edited in place by FeatureEditCommand (the array is mutable, its items are not). */
  readonly features: MapFeature[];
  /** Rivers traced on the drawing (source → mouth), edited by DrawnRiverEditCommand. */
  readonly rivers: DrawnRiver[];
  readonly createdAt: string;
  updatedAt: string;
}
