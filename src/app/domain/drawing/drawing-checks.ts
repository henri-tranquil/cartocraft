import { Int16TiledGrid } from '../terrain/tiled-grid';
import { isLandCode } from './drawing-cell';

/**
 * Things worth checking in a drawing, shown as warnings ("À vérifier"),
 * never as blocking errors. More kinds come with relief, forests and rivers
 * (a tropical forest too far north, a river ending inland…).
 */
export interface DrawingWarning {
  readonly kind: 'noLand';
}

export function checkDrawing(drawing: Int16TiledGrid): DrawingWarning[] {
  return hasLand(drawing) ? [] : [{ kind: 'noLand' }];
}

function hasLand(grid: Int16TiledGrid): boolean {
  // Padding cells of edge tiles are never painted (always sea): scanning whole tiles is safe.
  for (const tile of grid.tiles) for (const code of tile) if (isLandCode(code)) return true;
  return false;
}
