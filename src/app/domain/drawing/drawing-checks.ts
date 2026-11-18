import { MapSettings } from '../map/map-settings';
import { Int16TiledGrid } from '../terrain/tiled-grid';
import { DrawnRiver, riverEnd } from './drawn-river';
import { isLandCode } from './drawing-cell';

/**
 * Things worth checking in a drawing, shown as warnings ("À vérifier"),
 * never as blocking errors: the user may want a strange world.
 */
export type DrawingWarning =
  | { readonly kind: 'noLand' }
  /** Rivers ending neither in the sea (or an inland sea: a lake) nor on another river. */
  | { readonly kind: 'riverEndsInland'; readonly count: number };

type CheckedSettings = Pick<MapSettings, 'baseCellKm'>;

/** Forests are not checked: the climate picks the trees that grow (see `treeMix`). */
export function checkDrawing(drawing: Int16TiledGrid, settings: CheckedSettings, rivers: readonly DrawnRiver[] = []): DrawingWarning[] {
  if (!hasLand(drawing)) return [{ kind: 'noLand' }];
  const inland = rivers.filter((r) => riverEnd(r, rivers, drawing, settings.baseCellKm) === 'inland').length;
  return inland > 0 ? [{ kind: 'riverEndsInland', count: inland }] : [];
}

function hasLand(drawing: Int16TiledGrid): boolean {
  for (const tile of drawing.tiles) for (const code of tile) if (isLandCode(code)) return true;
  return false;
}
