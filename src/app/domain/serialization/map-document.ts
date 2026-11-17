/**
 * Version-agnostic, uncompressed representation of a saved map:
 * a JSON header + named binary blocks. Migrations operate on this shape,
 * BEFORE we trust it as a typed WorldMap.
 */
export interface RawMapDocument {
  /** Parsed JSON; untrusted until validated. Must carry a numeric `formatVersion`. */
  readonly header: Readonly<Record<string, unknown>>;
  readonly blocks: ReadonlyMap<string, Uint8Array>;
}

/** Thrown for any unreadable / invalid / unsupported map. Message is French, UI-facing. */
export class MapFormatError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MapFormatError';
  }
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function readFormatVersion(header: Readonly<Record<string, unknown>>): number {
  const version = header['formatVersion'];
  if (typeof version !== 'number' || !Number.isInteger(version) || version < 1) {
    throw new MapFormatError('Version de format absente ou invalide.');
  }
  return version;
}
