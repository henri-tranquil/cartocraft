import { DBSchema, IDBPDatabase, openDB } from 'idb';
import { MapRepository, MapSummary } from '../../domain/map/map-repository';
import { WorldMap } from '../../domain/map/world-map';
import { int16GridToBytes } from '../../domain/serialization/grid-codec';
import { isRecord, MapFormatError } from '../../domain/serialization/map-document';
import { BASE_ALTITUDE_BLOCK, MapHeader, mapFromDocument, mapToHeader } from '../../domain/serialization/map-serializer';
import { createInt16TiledGrid, DEFAULT_TILE_SIZE } from '../../domain/terrain/tiled-grid';

/**
 * Prefixed name: every page of <user>.github.io shares ONE origin, hence
 * one IndexedDB namespace. Without the prefix, another project could collide.
 */
export const DATABASE_NAME = 'cartocraft';
const DATABASE_VERSION = 1;

/** Key [mapId, gridName, tileIndex]: all tiles of a map are contiguous, so a key range finds them. */
type TileKey = [string, string, number];

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

  async save(map: WorldMap, changedTiles: readonly number[] | 'all'): Promise<void> {
    const db = await this.open();
    const grid = map.terrain.baseAltitudeM;
    const tx = db.transaction(['maps', 'tiles'], 'readwrite');
    const indices = changedTiles === 'all' ? grid.tiles.map((_, i) => i) : changedTiles;
    // put() clones synchronously: later in-place edits don't affect what is written.
    const writes: Promise<unknown>[] = [
      tx.objectStore('maps').put({ header: mapToHeader(map), storageTileSize: grid.tileSize }, map.id),
      ...indices.map((i) => tx.objectStore('tiles').put(grid.tiles[i], [map.id, BASE_ALTITUDE_BLOCK, i])),
    ];
    await Promise.all([...writes, tx.done]);
  }

  async load(id: string): Promise<WorldMap> {
    const db = await this.open();
    const tx = db.transaction(['maps', 'tiles'], 'readonly');
    const record = await tx.objectStore('maps').get(id);
    if (!record) throw new MapFormatError('Carte introuvable.');
    const tiles = await tx.objectStore('tiles').getAll(tileRange(id, BASE_ALTITUDE_BLOCK));
    const keys = await tx.objectStore('tiles').getAllKeys(tileRange(id, BASE_ALTITUDE_BLOCK));
    await tx.done;

    // Reassemble the stored tiles into a row-major block, then reuse the file
    // pipeline (migrations + validation): one single code path to trust.
    const descriptor = record.header.grids.find((g) => g.block === BASE_ALTITUDE_BLOCK);
    if (!descriptor) throw new MapFormatError('Grille d’altitude absente.');
    const grid = createInt16TiledGrid(descriptor.widthCells, descriptor.heightCells, 0, record.storageTileSize);
    keys.forEach(([, , index], k) => {
      if (index < grid.tiles.length && tiles[k].length === grid.tiles[index].length) grid.tiles[index].set(tiles[k]);
      else throw new MapFormatError('Tuile stockée incohérente.');
    });
    if (keys.length !== grid.tiles.length) throw new MapFormatError('Tuiles manquantes dans la sauvegarde locale.');

    return mapFromDocument(
      { header: { ...record.header }, blocks: new Map([[BASE_ALTITUDE_BLOCK, int16GridToBytes(grid)]]) },
      undefined,
      DEFAULT_TILE_SIZE,
    );
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
