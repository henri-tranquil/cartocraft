/**
 * Named places of the map: vector data, independent of the grid resolution
 * (positions in km from the top-left corner, not in cells).
 *
 * Discriminated union on `kind`: `switch (feature.kind)` narrows the type,
 * and the compiler flags any switch that forgets a kind.
 *
 * Still to come: ranges (polylines), named rivers (step 5), curved labels.
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

/** Immutable values: an edit replaces the whole object (cheap, and undo just keeps the old one). */
export type MapFeature = SettlementFeature | PeakFeature | LabelFeature | RegionFeature;
export type FeatureKind = MapFeature['kind'];

/** What the "new place" buttons create. */
export type FeatureTemplate =
  | { readonly kind: 'settlement'; readonly size: SettlementSize }
  | { readonly kind: 'peak' }
  | { readonly kind: 'label'; readonly tone: LabelTone }
  | { readonly kind: 'region'; readonly tone: LabelTone };

/** Default importance: a capital shows on the whole-map view, a village only when zoomed in. */
export function defaultRank(template: FeatureTemplate): ImportanceRank {
  switch (template.kind) {
    case 'settlement':
      return ({ capital: 1, city: 2, town: 4, village: 5 } as const)[template.size];
    case 'peak':
      return 4;
    case 'label':
      return template.tone === 'water' ? 1 : 2;
    case 'region':
      // A zone's name already hides itself until it fits in the zone on screen.
      return 1;
  }
}

/** `outlineKm` is used by zones only (a zone needs at least 3 points). */
export function createFeature(
  template: FeatureTemplate,
  id: string,
  name: string,
  xKm: number,
  yKm: number,
  outlineKm: readonly number[] = [],
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
      if (outlineKm.length < MIN_OUTLINE_POINTS * 2) throw new Error('A zone needs at least 3 points');
      return { ...base, kind: 'region', tone: template.tone, outlineKm };
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
    case 'region':
      return { kind: feature.kind, tone: feature.tone };
  }
}

export function isZoneTemplate(template: FeatureTemplate): boolean {
  return template.kind === 'region';
}

export const MIN_OUTLINE_POINTS = 3;
export const MAX_OUTLINE_POINTS = 2000;

export const MAX_FEATURE_NAME_LENGTH = 80;
