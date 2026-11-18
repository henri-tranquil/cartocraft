import { drawingFromAltitudes } from '../drawing/drawing-from-altitudes';
import { CURRENT_FORMAT_VERSION } from '../map/world-map';
import { isRecord, MapFormatError, RawMapDocument, readFormatVersion } from './map-document';

/**
 * Migration chain: each step upgrades a document from `fromVersion` to
 * `fromVersion + 1`. To read a v1 file in v4 we apply 1→2, 2→3, 3→4.
 * A migration is written once and NEVER modified afterwards: old files
 * depend on it.
 */
export interface Migration {
  readonly fromVersion: number;
  migrate(document: RawMapDocument): RawMapDocument;
}

/** v1 → v2: settings gain `beyondEdges`; old maps keep their behaviour ("continue" on every side). */
const V1_TO_V2: Migration = {
  fromVersion: 1,
  migrate(document) {
    const settings = document.header['settings'];
    if (!isRecord(settings)) throw new MapFormatError('Réglages de carte absents.');
    return {
      ...document,
      header: {
        ...document.header,
        formatVersion: 2,
        settings: { ...settings, beyondEdges: { north: 'continue', south: 'continue', east: 'continue', west: 'continue' } },
      },
    };
  },
};

/** v2 → v3: named places (`features`), none in older maps. */
const V2_TO_V3: Migration = {
  fromVersion: 2,
  migrate(document) {
    return { ...document, header: { ...document.header, formatVersion: 3, features: [] } };
  },
};

/**
 * v3 → v4: the DRAWING layer. Older maps only have altitudes, so a first
 * drawing is guessed from them (land = not sea, relief class from the
 * altitude band, no forest). Block names are written literally: a migration
 * must not change if the serializer's constants are renamed later.
 */
const V3_TO_V4: Migration = {
  fromVersion: 3,
  migrate(document) {
    const grids = document.header['grids'];
    const settings = document.header['settings'];
    if (!Array.isArray(grids) || !isRecord(settings)) throw new MapFormatError('En-tête de carte incomplet.');
    const base: unknown = grids.find((g) => isRecord(g) && g['block'] === 'baseAltitudeM');
    const bytes = document.blocks.get('baseAltitudeM');
    if (!isRecord(base) || !bytes) throw new MapFormatError('Grille d’altitude absente.');
    const w = base['widthCells'];
    const h = base['heightCells'];
    const seaLevelM = settings['seaLevelM'];
    if (typeof w !== 'number' || typeof h !== 'number' || typeof seaLevelM !== 'number' || bytes.byteLength !== w * h * 2) {
      throw new MapFormatError('Grille d’altitude tronquée ou de taille incohérente.');
    }
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const altitudeM = new Int16Array(w * h);
    for (let i = 0; i < altitudeM.length; i++) altitudeM[i] = view.getInt16(i * 2, true);
    const drawing = drawingFromAltitudes(altitudeM, w, h, seaLevelM);
    const out = new Uint8Array(drawing.length * 2);
    const outView = new DataView(out.buffer);
    for (let i = 0; i < drawing.length; i++) outView.setInt16(i * 2, drawing[i], true);
    return {
      header: {
        ...document.header,
        formatVersion: 4,
        grids: [...grids, { block: 'drawing', type: 'int16', widthCells: w, heightCells: h }],
      },
      blocks: new Map([...document.blocks, ['drawing', out]]),
    };
  },
};

/**
 * v4 → v5: the map's editable layer (`source`). Bundled samples (ids
 * 'sample-…', the Japan of real altitudes) are worlds; any other map is a
 * drawing (Henri's choice when the types were introduced: the user's own
 * maps were being drawn since D2).
 */
const V4_TO_V5: Migration = {
  fromVersion: 4,
  migrate(document) {
    const id = document.header['id'];
    const source = typeof id === 'string' && id.startsWith('sample-') ? 'world' : 'drawing';
    return { ...document, header: { ...document.header, formatVersion: 5, source } };
  },
};

/** Ordered list. */
export const MIGRATIONS: readonly Migration[] = [V1_TO_V2, V2_TO_V3, V3_TO_V4, V4_TO_V5];

export function migrateToCurrent(
  document: RawMapDocument,
  migrations: readonly Migration[] = MIGRATIONS,
  currentVersion = CURRENT_FORMAT_VERSION,
): RawMapDocument {
  let version = readFormatVersion(document.header);
  if (version > currentVersion) {
    throw new MapFormatError(
      `Cette carte a été créée par une version plus récente de Cartocraft (format ${version}, supporté : ${currentVersion}).`,
    );
  }
  let current = document;
  while (version < currentVersion) {
    const migration = migrations.find((m) => m.fromVersion === version);
    if (!migration) throw new MapFormatError(`Aucune migration depuis le format ${version}.`);
    current = migration.migrate(current);
    const next = readFormatVersion(current.header);
    if (next !== version + 1) throw new Error(`Migration from v${version} produced v${next}`);
    version = next;
  }
  return current;
}
