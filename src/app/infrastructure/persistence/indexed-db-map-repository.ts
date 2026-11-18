import { DBSchema, IDBPDatabase, openDB } from 'idb';
import { ChangedTiles, MapRepository, MapSummary } from '../../domain/map/map-repository';
import { TerrainLayer, terrainGrid, WorldMap } from '../../domain/map/world-map';
import { int16GridToBytes } from '../../domain/serialization/grid-codec';
import { isRecord, MapFormatError } from '../../domain/serialization/map-document';
import { BASE_ALTITUDE_BLOCK, DRAWING_BLOCK, MapHeader, mapFromDocument, mapToHeader } from '../../domain/serialization/map-serializer';
import { drawingFromAltitudes } from '../../domain/drawing/drawing-from-altitudes';
import { createInt16TiledGrid, DEFAULT_TILE_SIZE, fromRowMajor, Int16TiledGrid, toRowMajor } from '../../domain/terrain/tiled-grid';

/**
 * Prefixed name: every page of <user>.github.io shares ONE origin, hence
 * one IndexedDB namespace. Without the prefix, another project could collide.
 */
export const DATABASE_NAME = 'cartocraft';
const DATABASE_VERSION = 1;

/** Key [mapId, gridName, tileIndex]: all tiles of a map are contiguous, so a key range finds them. */
type TileKey = [string, string, number];

/** Storage name of each terrain grid: the same block names as the file format. */
const LAYER_BLOCKS: Readonly<Record<TerrainLayer, string>> = { altitude: BASE_ALTITUDE_BLOCK, drawing: DRAWING_BLOCK };
const LAYERS: readonly TerrainLayer[] = ['altitude', 'drawing'];

interface MapRecord {
  /** Same JSON header as the file format, so the same migration chain applies. */
  readonly header: MapHeader;
  readonly storageTileSize: number;
}

interface CartocraftDb extends DBSchema {
  maps: { key: string; value: MapRecord };
  tiles: { key: TileKey; value: Int16Array };
}

/**
 * Auto-save storage. Tiles are stored individually (IndexedDB stores
 * TypedArrays natively through structured clone), so an edit rewrites
 * only the tiles it touched, not the whole 2–8 MB grid.
 */
export class IndexedDbMapRepository implements MapRepository {
  private db: Promise<IDBPDatabase<CartocraftDb>> | null = null;
  /**
   * Grids of a loaded map that are NOT (completely) in the database: created
   * by a migration (the drawing of a format-3 map) or rebuilt by `load`. Only
   * changed tiles are written on save, so these must be written whole once,
   * or the next load would find tiles missing.
   */
  private readonly incompleteLayers = new Map<string, Set<TerrainLayer>>();

  constructor(private readonly databaseName = DATABASE_NAME) {}

  private open(): Promise<IDBPDatabase<CartocraftDb>> {
    this.db ??= openDB<CartocraftDb>(this.databaseName, DATABASE_VERSION, {
      upgrade(db) {
        db.createObjectStore('maps');
        db.createObjectStore('tiles');
      },
    });
    return this.db;
  }

  async save(map: WorldMap, changedTiles: ChangedTiles | 'all'): Promise<void> {
    const db = await this.open();
    const tx = db.transaction(['maps', 'tiles'], 'readwrite');
    // put() clones synchronously: later in-place edits don't affect what is written.
    const writes: Promise<unknown>[] = [
      tx.objectStore('maps').put({ header: mapToHeader(map), storageTileSize: map.terrain.baseAltitudeM.tileSize }, map.id),
    ];
    const incomplete = this.incompleteLayers.get(map.id);
    for (const layer of LAYERS) {
      const grid = terrainGrid(map, layer);
      const whole = changedTiles === 'all' || incomplete?.has(layer) === true;
      const indices = whole ? grid.tiles.map((_, i) => i) : changedTiles[layer];
      for (const i of indices) writes.push(tx.objectStore('tiles').put(grid.tiles[i], [map.id, LAYER_BLOCKS[layer], i]));
    }
    await Promise.all([...writes, tx.done]);
    this.incompleteLayers.delete(map.id);
  }

  async load(id: string): Promise<WorldMap> {
    const db = await this.open();
    const tx = db.transaction(['maps', 'tiles'], 'readonly');
    const record = await tx.objectStore('maps').get(id);
    if (!record) throw new MapFormatError('Carte introuvable.');
    // Only the grids the stored header declares: an older record (format 3) has no drawing yet; the migration adds it.
    const stored = await Promise.all(
      record.header.grids.map(async (descriptor) => ({
        descriptor,
        tiles: await tx.objectStore('tiles').getAll(tileRange(id, descriptor.block)),
        keys: await tx.objectStore('tiles').getAllKeys(tileRange(id, descriptor.block)),
      })),
    );
    await tx.done;

    // Reassemble the stored tiles into row-major blocks, then reuse the file
    // pipeline (migrations + validation): one single code path to trust.
    const blocks = new Map<string, Uint8Array>();
    const incomplete = new Set<TerrainLayer>();
    let altitude: Int16TiledGrid | null = null;
    for (const { descriptor, tiles, keys } of stored) {
      const grid = createInt16TiledGrid(descriptor.widthCells, descriptor.heightCells, 0, record.storageTileSize);
      const present = new Set<number>();
      keys.forEach(([, , index], k) => {
        if (index < grid.tiles.length && tiles[k].length === grid.tiles[index].length) grid.tiles[index].set(tiles[k]);
        else throw new MapFormatError('Tuile stockée incohérente.');
        present.add(index);
      });
      if (descriptor.block === BASE_ALTITUDE_BLOCK) altitude = grid;
      if (present.size !== grid.tiles.length) {
        // A drawing saved incompletely (bug of 18/11/2026, fixed): rebuild the missing tiles
        // from the altitude, like the v3 → v4 migration, and keep the tiles that were painted.
        if (descriptor.block !== DRAWING_BLOCK || !altitude) throw new MapFormatError('Tuiles manquantes dans la sauvegarde locale.');
        const guessed = fromRowMajor(
          drawingFromAltitudes(toRowMajor(altitude), altitude.widthCells, altitude.heightCells, record.header.settings.seaLevelM),
          grid.widthCells,
          grid.heightCells,
          grid.tileSize,
        );
        grid.tiles.forEach((tile, i) => {
          if (!present.has(i)) tile.set(guessed.tiles[i]);
        });
        incomplete.add('drawing');
      }
      blocks.set(descriptor.block, int16GridToBytes(grid));
    }
    for (const layer of LAYERS) if (!blocks.has(LAYER_BLOCKS[layer])) incomplete.add(layer); // added by a migration
    const map = mapFromDocument({ header: { ...record.header }, blocks }, undefined, DEFAULT_TILE_SIZE);
    if (incomplete.size > 0) this.incompleteLayers.set(id, incomplete);
    else this.incompleteLayers.delete(id);
    return map;
  }

  async list(): Promise<MapSummary[]> {
    const db = await this.open();
    const records = await db.getAll('maps');
    return records
      .map((r) => toSummary(r.header))
      .filter((s): s is MapSummary => s !== null)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  async delete(id: string): Promise<void> {
    const db = await this.open();
    const tx = db.transaction(['maps', 'tiles'], 'readwrite');
    await Promise.all([
      tx.objectStore('maps').delete(id),
      tx.objectStore('tiles').delete(IDBKeyRange.bound([id], [id, []])),
      tx.done,
    ]);
  }
}

function tileRange(mapId: string, grid: string): IDBKeyRange {
  // Arrays sort after strings and numbers in IndexedDB, so [id, grid, []] is above every [id, grid, n].
  return IDBKeyRange.bound([mapId, grid], [mapId, grid, []]);
}

/** Headers may come from an older format: read them defensively, skip what is unreadable. */
function toSummary(header: unknown): MapSummary | null {
  if (!isRecord(header) || !isRecord(header['settings'])) return null;
  const { id, name, updatedAt } = header;
  const { widthKm, heightKm } = header['settings'];
  if (typeof id !== 'string' || typeof name !== 'string' || typeof updatedAt !== 'string') return null;
  if (typeof widthKm !== 'number' || typeof heightKm !== 'number') return null;
  return { id, name, updatedAt, widthKm, heightKm };
}
