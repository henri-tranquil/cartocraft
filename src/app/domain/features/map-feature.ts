/**
 * Named places of the map: vector data, independent of the grid resolution
 * (positions in km from the top-left corner, not in cells).
 *
 * Discriminated union on `kind`: `switch (feature.kind)` narrows the type,
 * and the compiler flags any switch that forgets a kind.
 *
 * Rivers are not stored: a river name keeps an anchor on the computed river
 * and follows whatever course the terrain gives it.
 */

/**
 * 1 = most important. Decides from which zoom a name appears (see rendering/label-layer.ts):
 * the larger the scale, the smaller the things that get named.
 */
export type ImportanceRank = 1 | 2 | 3 | 4 | 5;
export const IMPORTANCE_RANKS: readonly ImportanceRank[] = [1, 2, 3, 4, 5];

export type SettlementSize = 'capital' | 'city' | 'town' | 'village';
export const SETTLEMENT_SIZES: readonly SettlementSize[] = ['capital', 'city', 'town', 'village'];

/** Free text: land names (regions, plains, islands) or water names (seas, gulfs, lakes). */
export type LabelTone = 'land' | 'water';
export const LABEL_TONES: readonly LabelTone[] = ['land', 'water'];

interface FeatureBase {
  readonly id: string;
  readonly name: string;
  readonly rank: ImportanceRank;
  readonly xKm: number;
  readonly yKm: number;
}

export interface SettlementFeature extends FeatureBase {
  readonly kind: 'settlement';
  readonly size: SettlementSize;
}

export interface PeakFeature extends FeatureBase {
  readonly kind: 'peak';
}

export interface LabelFeature extends FeatureBase {
  readonly kind: 'label';
  readonly tone: LabelTone;
}

/**
 * A named zone drawn by hand: plain, plateau, region (land) or bay, gulf (water).
 * (xKm, yKm) is where its name sits: the pole of inaccessibility of the outline.
 */
export interface RegionFeature extends FeatureBase {
  readonly kind: 'region';
  readonly tone: LabelTone;
  /** Closed ring, flat [x0, y0, x1, y1, …] in km. */
  readonly outlineKm: readonly number[];
}

/**
 * Name of a COMPUTED river. (xKm, yKm) is an anchor on its course: the name
 * is drawn along the river line passing nearest to it (the course itself is
 * recomputed from the terrain, never stored).
 */
export interface RiverFeature extends FeatureBase {
  readonly kind: 'river';
}

/** A mountain range drawn as a line along its crest; the name follows it. (xKm, yKm) = middle of the line. */
export interface RangeFeature extends FeatureBase {
  readonly kind: 'range';
  /** Open polyline, flat [x0, y0, x1, y1, …] in km. */
  readonly pathKm: readonly number[];
}

/**
 * A lake: (xKm, yKm) is a point of its bed; its extent is COMPUTED (cells
 * below the water level connected to that point), never stored, so it
 * follows the terrain. The name sits on that point.
 */
export interface LakeFeature extends FeatureBase {
  readonly kind: 'lake';
  /**
   * Water level (m). null = brim-full: the level where the lake spills over
   * the lowest point of its rim (follows terrain edits). A number is capped
   * at that spill level: water cannot rise higher without flowing out.
   */
  readonly surfaceM: number | null;
}

/** Immutable values: an edit replaces the whole object (cheap, and undo just keeps the old one). */
export type MapFeature = SettlementFeature | PeakFeature | LabelFeature | RegionFeature | RiverFeature | RangeFeature | LakeFeature;
export type FeatureKind = MapFeature['kind'];

/** What the "new place" buttons create. */
export type FeatureTemplate =
  | { readonly kind: 'settlement'; readonly size: SettlementSize }
  | { readonly kind: 'peak' }
  | { readonly kind: 'label'; readonly tone: LabelTone }
  | { readonly kind: 'region'; readonly tone: LabelTone }
  | { readonly kind: 'river' }
  | { readonly kind: 'range' }
  | { readonly kind: 'lake' };

/** How a feature is placed: one click, a closed outline, a click on a river, or a drawn line. */
export type FeatureGeometry = 'point' | 'zone' | 'river' | 'line';

export function geometryOf(template: FeatureTemplate): FeatureGeometry {
  switch (template.kind) {
    case 'region':
      return 'zone';
    case 'river':
      return 'river';
    case 'range':
      return 'line';
    default:
      return 'point';
  }
}

/** Default importance: a capital shows on the whole-map view, a village only when zoomed in. */
export function defaultRank(template: FeatureTemplate): ImportanceRank {
  switch (template.kind) {
    case 'settlement':
      return ({ capital: 1, city: 2, town: 4, village: 5 } as const)[template.size];
    case 'peak':
      return 4;
    case 'lake':
      return 3;
    case 'label':
      return template.tone === 'water' ? 1 : 2;
    case 'region':
    case 'river':
    case 'range':
      // These names already hide themselves until they fit (in the zone, along the line).
      return 1;
  }
}

/** `shapeKm`: the outline of a zone (≥ 3 points) or the line of a range (≥ 2 points); ignored otherwise. */
export function createFeature(
  template: FeatureTemplate,
  id: string,
  name: string,
  xKm: number,
  yKm: number,
  shapeKm: readonly number[] = [],
): MapFeature {
  const base = { id, name, rank: defaultRank(template), xKm, yKm };
  switch (template.kind) {
    case 'settlement':
      return { ...base, kind: 'settlement', size: template.size };
    case 'peak':
      return { ...base, kind: 'peak' };
    case 'label':
      return { ...base, kind: 'label', tone: template.tone };
    case 'region':
      if (shapeKm.length < MIN_OUTLINE_POINTS * 2) throw new Error('A zone needs at least 3 points');
      return { ...base, kind: 'region', tone: template.tone, outlineKm: shapeKm };
    case 'river':
      return { ...base, kind: 'river' };
    case 'range':
      if (shapeKm.length < MIN_PATH_POINTS * 2) throw new Error('A range needs at least 2 points');
      return { ...base, kind: 'range', pathKm: shapeKm };
    case 'lake':
      return { ...base, kind: 'lake', surfaceM: null };
  }
}

/** The template a feature was made from (type buttons, conversions). */
export function templateOf(feature: MapFeature): FeatureTemplate {
  switch (feature.kind) {
    case 'settlement':
      return { kind: 'settlement', size: feature.size };
    case 'peak':
      return { kind: 'peak' };
    case 'label':
      return { kind: 'label', tone: feature.tone };
    case 'region':
      return { kind: 'region', tone: feature.tone };
    case 'river':
      return { kind: 'river' };
    case 'range':
      return { kind: 'range' };
    case 'lake':
      return { kind: 'lake' };
  }
}

/** The stored shape (zone outline or range line), empty for point-like features. */
export function shapeOf(feature: MapFeature): readonly number[] {
  return feature.kind === 'region' ? feature.outlineKm : feature.kind === 'range' ? feature.pathKm : [];
}

export function isZoneTemplate(template: FeatureTemplate): boolean {
  return template.kind === 'region';
}

export const MIN_OUTLINE_POINTS = 3;
export const MIN_PATH_POINTS = 2;
export const MAX_OUTLINE_POINTS = 2000;

export const MAX_FEATURE_NAME_LENGTH = 80;
