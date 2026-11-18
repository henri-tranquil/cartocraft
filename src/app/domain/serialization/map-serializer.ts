import { parseFeatures } from './feature-codec';
import { MapFeature } from '../features/map-feature';
import { BEYOND_EDGE_VALUES, BeyondEdge, MapSettings, validateMapSettings } from '../map/map-settings';
import { CURRENT_FORMAT_VERSION, WorldMap } from '../map/world-map';
import { DEFAULT_TILE_SIZE, Int16TiledGrid } from '../terrain/tiled-grid';
import { int16GridFromBytes, int16GridToBytes } from './grid-codec';
import { isRecord, MapFormatError, RawMapDocument } from './map-document';
import { Migration, MIGRATIONS, migrateToCurrent } from './migrations';

export const BASE_ALTITUDE_BLOCK = 'baseAltitudeM';
export const DRAWING_BLOCK = 'drawing';

export interface GridDescriptor {
  readonly block: string;
  readonly type: 'int16';
  readonly widthCells: number;
  readonly heightCells: number;
}

/** Header of the CURRENT format. Older headers are migrated to this shape. */
export interface MapHeader {
  readonly formatVersion: number;
  readonly id: string;
  readonly name: string;
  readonly settings: MapSettings;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly grids: readonly GridDescriptor[];
  readonly features: readonly MapFeature[];
}

export function mapToHeader(map: WorldMap): MapHeader {
  const grid = map.terrain.baseAltitudeM;
  const descriptor = (block: string): GridDescriptor => ({ block, type: 'int16', widthCells: grid.widthCells, heightCells: grid.heightCells });
  return {
    formatVersion: CURRENT_FORMAT_VERSION,
    id: map.id,
    name: map.name,
    settings: map.settings,
    createdAt: map.createdAt,
    updatedAt: map.updatedAt,
    grids: [descriptor(BASE_ALTITUDE_BLOCK), descriptor(DRAWING_BLOCK)],
    features: map.features,
  };
}

export function mapToDocument(map: WorldMap): RawMapDocument {
  return {
    header: { ...mapToHeader(map) },
    blocks: new Map([
      [BASE_ALTITUDE_BLOCK, int16GridToBytes(map.terrain.baseAltitudeM)],
      [DRAWING_BLOCK, int16GridToBytes(map.terrain.drawing)],
    ]),
  };
}

/** Migrate → validate → build. Throws MapFormatError with a UI-ready message. */
export function mapFromDocument(
  document: RawMapDocument,
  migrations: readonly Migration[] = MIGRATIONS,
  tileSize = DEFAULT_TILE_SIZE,
): WorldMap {
  const migrated = migrateToCurrent(document, migrations);
  const header = parseHeader(migrated.header);
  const baseGrid = readGrid(header, migrated, BASE_ALTITUDE_BLOCK, 'd’altitude', tileSize);
  const drawing = readGrid(header, migrated, DRAWING_BLOCK, 'du dessin', tileSize);
  if (drawing.widthCells !== baseGrid.widthCells || drawing.heightCells !== baseGrid.heightCells) {
    throw new MapFormatError('Le dessin et l’altitude n’ont pas la même taille.');
  }
  return {
    id: header.id,
    name: header.name,
    formatVersion: CURRENT_FORMAT_VERSION,
    settings: header.settings,
    terrain: { baseAltitudeM: baseGrid, drawing },
    features: [...header.features],
    createdAt: header.createdAt,
    updatedAt: header.updatedAt,
  };
}

function readGrid(header: MapHeader, document: RawMapDocument, block: string, what: string, tileSize: number): Int16TiledGrid {
  const descriptor = header.grids.find((g) => g.block === block);
  if (!descriptor) throw new MapFormatError(`Grille ${what} absente.`);
  const bytes = document.blocks.get(block);
  if (!bytes || bytes.byteLength !== descriptor.widthCells * descriptor.heightCells * 2) {
    throw new MapFormatError(`Grille ${what} tronquée ou de taille incohérente.`);
  }
  return int16GridFromBytes(bytes, descriptor.widthCells, descriptor.heightCells, tileSize);
}

// --- Validation (type guards: from `unknown` to trusted types) ---

const SETTINGS_KEYS: readonly Exclude<keyof MapSettings, 'beyondEdges'>[] = [
  'widthKm',
  'heightKm',
  'baseCellKm',
  'seed',
  'latitudeTopDeg',
  'latitudeBottomDeg',
  'axialTiltDeg',
  'seaLevelM',
  'globalTemperatureOffsetC',
];

function parseSettings(value: unknown): MapSettings {
  if (!isRecord(value)) throw new MapFormatError('Réglages de carte absents.');
  for (const key of SETTINGS_KEYS) {
    if (typeof value[key] !== 'number' || !Number.isFinite(value[key])) {
      throw new MapFormatError(`Réglage invalide : ${key}.`);
    }
  }
  const edges = value['beyondEdges'];
  if (!isRecord(edges)) throw new MapFormatError('Réglage « au-delà des bords » absent.');
  const side = (key: string): BeyondEdge => {
    const v = edges[key];
    if (typeof v !== 'string' || !(BEYOND_EDGE_VALUES as readonly string[]).includes(v)) {
      throw new MapFormatError(`Réglage « au-delà des bords » invalide : ${key}.`);
    }
    return v as BeyondEdge;
  };
  // Every key checked above is a finite number: the cast is now justified.
  const settings = {
    ...(Object.fromEntries(SETTINGS_KEYS.map((k) => [k, value[k]])) as unknown as Omit<MapSettings, 'beyondEdges'>),
    beyondEdges: { north: side('north'), south: side('south'), east: side('east'), west: side('west') },
  };
  const errors = validateMapSettings(settings);
  if (errors.length > 0) throw new MapFormatError(errors.join(' '));
  return settings;
}

function parseGrid(value: unknown): GridDescriptor {
  if (
    !isRecord(value) ||
    typeof value['block'] !== 'string' ||
    value['type'] !== 'int16' ||
    !Number.isInteger(value['widthCells']) ||
    !Number.isInteger(value['heightCells'])
  ) {
    throw new MapFormatError('Description de grille invalide.');
  }
  return {
    block: value['block'],
    type: 'int16',
    widthCells: value['widthCells'] as number,
    heightCells: value['heightCells'] as number,
  };
}

function requireString(header: Readonly<Record<string, unknown>>, key: string): string {
  const value = header[key];
  if (typeof value !== 'string') throw new MapFormatError(`Champ « ${key} » absent ou invalide.`);
  return value;
}

function parseHeader(header: Readonly<Record<string, unknown>>): MapHeader {
  const grids = header['grids'];
  if (!Array.isArray(grids)) throw new MapFormatError('Liste des grilles absente.');
  return {
    formatVersion: CURRENT_FORMAT_VERSION,
    id: requireString(header, 'id'),
    name: requireString(header, 'name'),
    settings: parseSettings(header['settings']),
    createdAt: requireString(header, 'createdAt'),
    updatedAt: requireString(header, 'updatedAt'),
    grids: grids.map(parseGrid),
    features: parseFeatures(header['features']),
  };
}
