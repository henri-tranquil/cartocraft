import { isRecord, MapFormatError, RawMapDocument } from './map-document';

/**
 * Binary container (before gzip):
 *
 *   [4 bytes]  magic "CCFT"
 *   [4 bytes]  header length N (uint32 LE)
 *   [N bytes]  header JSON (UTF-8), with `blocks: [{ name, byteLength }]` appended
 *   [...]      blocks, concatenated in the order listed
 *
 * The magic number lets us reject a random file immediately with a clear message.
 */
const MAGIC = [0x43, 0x43, 0x46, 0x54]; // "CCFT"
const PREAMBLE_BYTES = 8;

export function encodeContainer(document: RawMapDocument): Uint8Array {
  const blockList = [...document.blocks].map(([name, bytes]) => ({ name, byteLength: bytes.byteLength }));
  const headerBytes = new TextEncoder().encode(JSON.stringify({ ...document.header, blocks: blockList }));
  const total = PREAMBLE_BYTES + headerBytes.byteLength + blockList.reduce((sum, b) => sum + b.byteLength, 0);
  const out = new Uint8Array(total);
  out.set(MAGIC, 0);
  new DataView(out.buffer).setUint32(4, headerBytes.byteLength, true);
  out.set(headerBytes, PREAMBLE_BYTES);
  let offset = PREAMBLE_BYTES + headerBytes.byteLength;
  for (const bytes of document.blocks.values()) {
    out.set(bytes, offset);
    offset += bytes.byteLength;
  }
  return out;
}

export function decodeContainer(data: Uint8Array): RawMapDocument {
  if (data.byteLength < PREAMBLE_BYTES || MAGIC.some((b, i) => data[i] !== b)) {
    throw new MapFormatError('Ce fichier n’est pas une carte Cartocraft.');
  }
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const headerLength = view.getUint32(4, true);
  const headerEnd = PREAMBLE_BYTES + headerLength;
  if (headerEnd > data.byteLength) throw new MapFormatError('Fichier tronqué (en-tête).');

  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder().decode(data.subarray(PREAMBLE_BYTES, headerEnd)));
  } catch {
    throw new MapFormatError('En-tête illisible.');
  }
  if (!isRecord(parsed) || !Array.isArray(parsed['blocks'])) throw new MapFormatError('En-tête invalide.');

  const { blocks: blockList, ...header } = parsed;
  const blocks = new Map<string, Uint8Array>();
  let offset = headerEnd;
  for (const entry of blockList as unknown[]) {
    if (!isRecord(entry) || typeof entry['name'] !== 'string' || !Number.isInteger(entry['byteLength'])) {
      throw new MapFormatError('Liste des blocs invalide.');
    }
    const end = offset + (entry['byteLength'] as number);
    if (end > data.byteLength) throw new MapFormatError('Fichier tronqué (données).');
    blocks.set(entry['name'], data.slice(offset, end));
    offset = end;
  }
  return { header, blocks };
}
