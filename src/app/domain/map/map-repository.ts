import { TerrainLayer, WorldMap } from './world-map';

export interface MapSummary {
  readonly id: string;
  readonly name: string;
  readonly widthKm: number;
  readonly heightKm: number;
  readonly updatedAt: string;
}

/** Tiles modified since the last save, per terrain grid. */
export type ChangedTiles = Readonly<Record<TerrainLayer, readonly number[]>>;

/**
 * Port (interface) owned by the domain; adapters live in infrastructure.
 * `changedTiles` lets an adapter rewrite only modified tiles ('all' = full save).
 */
export interface MapRepository {
  save(map: WorldMap, changedTiles: ChangedTiles | 'all'): Promise<void>;
  load(id: string): Promise<WorldMap>;
  list(): Promise<MapSummary[]>;
  delete(id: string): Promise<void>;
}

/** Port for the exchange file format (`.cartocraft`). Not a repository: no list/delete. */
export interface MapFileCodec {
  readonly fileExtension: string;
  exportMap(map: WorldMap): Promise<Blob>;
  importMap(file: Blob): Promise<WorldMap>;
  fileNameFor(map: WorldMap): string;
}
