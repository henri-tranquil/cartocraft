import {
  IMPORTANCE_RANKS,
  ImportanceRank,
  LABEL_TONES,
  LabelTone,
  MapFeature,
  MAX_FEATURE_NAME_LENGTH,
  MAX_OUTLINE_POINTS,
  MIN_OUTLINE_POINTS,
  MIN_PATH_POINTS,
  SETTLEMENT_SIZES,
  SettlementSize,
} from '../features/map-feature';
import { isRecord, MapFormatError } from './map-document';

/** Type guard chain: untrusted JSON → MapFeature[]. Rejects the whole map on the first bad item. */
export function parseFeatures(value: unknown): MapFeature[] {
  if (!Array.isArray(value)) throw new MapFormatError('Liste des lieux absente.');
  const ids = new Set<string>();
  return value.map((item: unknown, index) => {
    const feature = parseFeature(item, index);
    if (ids.has(feature.id)) throw new MapFormatError(`Lieu en double (n° ${index + 1}).`);
    ids.add(feature.id);
    return feature;
  });
}

function parseFeature(item: unknown, index: number): MapFeature {
  const invalid = (what: string) => new MapFormatError(`Lieu n° ${index + 1} invalide : ${what}.`);
  if (!isRecord(item)) throw invalid('format');
  const { id, name, rank, xKm, yKm, kind } = item;
  if (typeof id !== 'string' || id === '') throw invalid('identifiant');
  if (typeof name !== 'string' || name.length > MAX_FEATURE_NAME_LENGTH) throw invalid('nom');
  if (!isOneOf<ImportanceRank>(rank, IMPORTANCE_RANKS)) throw invalid('importance');
  if (typeof xKm !== 'number' || typeof yKm !== 'number' || !Number.isFinite(xKm) || !Number.isFinite(yKm)) {
    throw invalid('position');
  }
  const base = { id, name, rank, xKm, yKm };
  switch (kind) {
    case 'settlement':
      if (!isOneOf<SettlementSize>(item['size'], SETTLEMENT_SIZES)) throw invalid('taille');
      return { ...base, kind, size: item['size'] };
    case 'peak':
      return { ...base, kind };
    case 'label':
      if (!isOneOf<LabelTone>(item['tone'], LABEL_TONES)) throw invalid('ton');
      return { ...base, kind, tone: item['tone'] };
    case 'region': {
      if (!isOneOf<LabelTone>(item['tone'], LABEL_TONES)) throw invalid('ton');
      const outline = item['outlineKm'];
      if (!isPointList(outline, MIN_OUTLINE_POINTS)) throw invalid('contour');
      return { ...base, kind, tone: item['tone'], outlineKm: outline };
    }
    case 'river':
      return { ...base, kind };
    case 'range': {
      const path = item['pathKm'];
      if (!isPointList(path, MIN_PATH_POINTS)) throw invalid('tracé');
      return { ...base, kind, pathKm: path };
    }
    case 'lake': {
      const surfaceM = item['surfaceM'];
      if (surfaceM !== null && !(typeof surfaceM === 'number' && Number.isInteger(surfaceM) && surfaceM >= -32768 && surfaceM <= 32767)) {
        throw invalid('niveau du lac');
      }
      return { ...base, kind, surfaceM };
    }
    default:
      throw invalid('type');
  }
}

/** Flat [x0, y0, …] list of finite numbers with a sane number of points. */
function isPointList(value: unknown, minPoints: number): value is number[] {
  return (
    Array.isArray(value) &&
    value.length % 2 === 0 &&
    value.length >= minPoints * 2 &&
    value.length <= MAX_OUTLINE_POINTS * 2 &&
    value.every((v: unknown) => typeof v === 'number' && Number.isFinite(v))
  );
}

function isOneOf<T>(value: unknown, allowed: readonly T[]): value is T {
  return (allowed as readonly unknown[]).includes(value);
}
