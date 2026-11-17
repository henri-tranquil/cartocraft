import { MapFileCodec } from '../../domain/map/map-repository';
import { WorldMap } from '../../domain/map/world-map';
import { decodeContainer, encodeContainer } from '../../domain/serialization/container';
import { MapFormatError } from '../../domain/serialization/map-document';
import { mapFromDocument, mapToDocument } from '../../domain/serialization/map-serializer';
import { gunzip, gzip } from './gzip';

export const MAP_FILE_EXTENSION = '.cartocraft';
const GZIP_MAGIC = [0x1f, 0x8b];

/** `.cartocraft` file = gzip(container). Pure conversion, no browser download/upload UI here. */
export async function exportMapToBlob(map: WorldMap): Promise<Blob> {
  const compressed = await gzip(encodeContainer(mapToDocument(map)) as Uint8Array<ArrayBuffer>);
  return new Blob([compressed], { type: 'application/octet-stream' });
}

export async function importMapFromBlob(file: Blob): Promise<WorldMap> {
  const data = new Uint8Array(await file.arrayBuffer());
  if (GZIP_MAGIC.some((b, i) => data[i] !== b)) throw new MapFormatError('Ce fichier n’est pas une carte Cartocraft.');
  let raw: Uint8Array;
  try {
    raw = await gunzip(data);
  } catch {
    throw new MapFormatError('Fichier compressé corrompu.');
  }
  return mapFromDocument(decodeContainer(raw));
}

export function mapFileName(map: WorldMap): string {
  const safe = map.name.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-zA-Z0-9_-]+/g, '-');
  return `${safe || 'carte'}${MAP_FILE_EXTENSION}`;
}

export const cartocraftFileCodec: MapFileCodec = {
  fileExtension: MAP_FILE_EXTENSION,
  exportMap: exportMapToBlob,
  importMap: importMapFromBlob,
  fileNameFor: mapFileName,
};
