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

/** Ordered list. */
export const MIGRATIONS: readonly Migration[] = [V1_TO_V2, V2_TO_V3];

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
