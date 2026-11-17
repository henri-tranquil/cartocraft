import { ImportanceRank } from '../../domain/features/map-feature';

/**
 * Look of place names (both views). Indexed by importance rank (1 = most important).
 *
 * MIN_PX_PER_KM is the semantic zoom of names: a name shows only once the map
 * is drawn at least this many screen pixels per km. It is a SCALE, like on
 * paper maps (a 1:1 000 000 sheet names cities, a 1:25 000 sheet names
 * hamlets), so a bigger window shows more of the map with the same names,
 * and a small D&D island shows its villages sooner than a France-sized world.
 * For reference: Japan (1700 km) fits a 900 px screen at ~0.5 px/km; the
 * deepest zoom (10 km across) is ~80 px/km.
 */
export const LABEL_STYLE = {
  /** rank → min px/km (index 0 unused). */
  minPxPerKm: [0, 0, 0.8, 2, 6, 15] as const,
  /** rank → font size (px). */
  fontPx: [0, 19, 16, 14, 12.5, 11] as const,
  font: '"IM Fell English SC", Georgia, serif',
  ink: 'rgb(40 30 20)',
  waterInk: 'rgb(28 72 88)',
  halo: 'rgb(240 230 205 / 0.85)',
  haloWidthPx: 3,
  /** Letter spacing of water names (seas, gulfs): wide spacing is the cartographic convention. */
  waterSpacingEm: 0.25,
  /** Gap between a symbol and its name. */
  gapPx: 4,
  /** Extra free space kept around each placed name. */
  collisionMarginPx: 2,
  selection: 'rgb(224 164 58)',
  zoneFill: 'rgb(224 164 58 / 0.12)',
  /** Zone names: font size from the zone's width on screen (÷ 14), clamped. */
  zoneFontMinPx: 12,
  zoneFontMaxPx: 24,
  /** A zone is named only when its name (unspread) takes at most this share of its width. */
  zoneFitFraction: 0.85,
  /** Letters spread to cover this share of the zone width, at most `zoneMaxSpacingEm` apart. */
  zoneSpreadFraction: 0.6,
  zoneMaxSpacingEm: 0.9,
} as const;

export function minPxPerKm(rank: ImportanceRank): number {
  return LABEL_STYLE.minPxPerKm[rank];
}

export function labelFontPx(rank: ImportanceRank): number {
  return LABEL_STYLE.fontPx[rank];
}
