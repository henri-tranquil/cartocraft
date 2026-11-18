/**
 * One cell of the DRAWING layer: what the user painted there, packed into a
 * small integer so the drawing can reuse the tiled Int16 grid (tiles, undo
 * diffs, storage, file format) instead of three separate grids.
 *
 *   bit 0      land (1) or sea (0)
 *   bits 1–2   relief class (plaine, collines, moyenne, haute montagne)
 *   bits 3–4   forest kind (aucune, feuillus, résineux, tropicale)
 *
 * Sea cells always carry relief 0 and forest 0: painting the sea erases both.
 */

export const RELIEF_CLASSES = ['plain', 'hills', 'midMountain', 'highMountain'] as const;
export type ReliefClass = (typeof RELIEF_CLASSES)[number];

export const FOREST_KINDS = ['none', 'broadleaf', 'conifer', 'tropical'] as const;
export type ForestKind = (typeof FOREST_KINDS)[number];

const LAND_BIT = 1;
const RELIEF_SHIFT = 1;
const FOREST_SHIFT = 3;
const TWO_BITS = 0b11;

export const SEA_CELL = 0;

export interface DrawingCell {
  readonly land: boolean;
  readonly relief: ReliefClass;
  readonly forest: ForestKind;
}

export function isLandCode(code: number): boolean {
  return (code & LAND_BIT) !== 0;
}

/** Relief class as its index 0..3 (0 = plain). Fast path for renderers. */
export function reliefIndexOf(code: number): number {
  return (code >> RELIEF_SHIFT) & TWO_BITS;
}

/** Forest kind as its index 0..3 (0 = none). Fast path for renderers. */
export function forestIndexOf(code: number): number {
  return (code >> FOREST_SHIFT) & TWO_BITS;
}

export function decodeDrawingCell(code: number): DrawingCell {
  return { land: isLandCode(code), relief: RELIEF_CLASSES[reliefIndexOf(code)], forest: FOREST_KINDS[forestIndexOf(code)] };
}

export function encodeDrawingCell(cell: DrawingCell): number {
  if (!cell.land) return SEA_CELL;
  return LAND_BIT | (RELIEF_CLASSES.indexOf(cell.relief) << RELIEF_SHIFT) | (FOREST_KINDS.indexOf(cell.forest) << FOREST_SHIFT);
}

/** What one brush applies. Relief and forest only apply on land: painting them over the sea does nothing. */
export type DrawingPaint =
  | { readonly kind: 'land' }
  | { readonly kind: 'sea' }
  | { readonly kind: 'relief'; readonly relief: ReliefClass }
  | { readonly kind: 'forest'; readonly forest: ForestKind };

export function applyPaint(code: number, paint: DrawingPaint): number {
  switch (paint.kind) {
    case 'land':
      return code | LAND_BIT;
    case 'sea':
      return SEA_CELL;
    case 'relief':
      if (!isLandCode(code)) return code;
      return (code & ~(TWO_BITS << RELIEF_SHIFT)) | (RELIEF_CLASSES.indexOf(paint.relief) << RELIEF_SHIFT);
    case 'forest':
      if (!isLandCode(code)) return code;
      return (code & ~(TWO_BITS << FOREST_SHIFT)) | (FOREST_KINDS.indexOf(paint.forest) << FOREST_SHIFT);
  }
}
