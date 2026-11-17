import { CURRENT_FORMAT_VERSION } from '../map/world-map';
import { MapFormatError, RawMapDocument, readFormatVersion } from './map-document';

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

/** Ordered list. Empty while we are at format v1. */
export const MIGRATIONS: readonly Migration[] = [];

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
