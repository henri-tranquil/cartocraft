import { latitudeAtRow } from '../map/latitude';
import { MapSettings } from '../map/map-settings';
import { Int16TiledGrid } from '../terrain/tiled-grid';
import { DrawnRiver, riverEnd } from './drawn-river';
import { FOREST_KINDS, ForestKind, forestIndexOf, isLandCode, reliefIndexOf } from './drawing-cell';

/**
 * Things worth checking in a drawing, shown as warnings ("À vérifier"),
 * never as blocking errors: the user may want a strange world.
 */
export type DrawingWarning =
  | { readonly kind: 'noLand' }
  /** Rivers ending neither in the sea (or an inland sea: a lake) nor on another river. */
  | { readonly kind: 'riverEndsInland'; readonly count: number }
  | {
      /** Forest painted where its trees would not grow: too cold or too warm for that kind. */
      readonly kind: 'forestTooCold' | 'forestTooWarm';
      readonly forest: Exclude<ForestKind, 'none'>;
      readonly cells: number;
      /** Mean latitude of the cells concerned (°, north positive). */
      readonly latitudeDeg: number;
    };

/**
 * Where each forest kind is plausible, by |latitude| (°). The drawing has no
 * climate yet (it comes with the conversion, step D6): latitude stands in for
 * temperature. Mountains are cooler: a conifer forest on mountains is fine in
 * the tropics, so the "too warm" limit only applies to plains and hills.
 */
export const FOREST_LATITUDE_LIMITS: Readonly<Record<Exclude<ForestKind, 'none'>, { readonly maxDeg: number; readonly lowlandMinDeg: number }>> = {
  broadleaf: { maxDeg: 62, lowlandMinDeg: 12 },
  conifer: { maxDeg: 70, lowlandMinDeg: 20 },
  tropical: { maxDeg: 28, lowlandMinDeg: 0 },
};

type CheckedSettings = Pick<MapSettings, 'latitudeTopDeg' | 'latitudeBottomDeg' | 'baseCellKm'>;

export function checkDrawing(drawing: Int16TiledGrid, settings: CheckedSettings, rivers: readonly DrawnRiver[] = []): DrawingWarning[] {
  // Per forest kind (index 1..3): [cold count, cold Σlat, warm count, warm Σlat].
  const stats = Array.from({ length: FOREST_KINDS.length }, () => [0, 0, 0, 0]);
  let land = false;
  const { tileSize, tilesX, tilesY, widthCells, heightCells } = drawing;
  for (let ty = 0; ty < tilesY; ty++) {
    for (let r = 0; r < tileSize; r++) {
      const y = ty * tileSize + r;
      if (y >= heightCells) break;
      const lat = latitudeAtRow(settings, heightCells, y + 0.5);
      const absLat = Math.abs(lat);
      for (let tx = 0; tx < tilesX; tx++) {
        const tile = drawing.tiles[ty * tilesX + tx];
        const width = Math.min(tileSize, widthCells - tx * tileSize);
        for (let c = 0, o = r * tileSize; c < width; c++, o++) {
          const code = tile[o];
          if (!isLandCode(code)) continue;
          land = true;
          const forest = forestIndexOf(code);
          if (forest === 0) continue;
          const limits = FOREST_LATITUDE_LIMITS[FOREST_KINDS[forest] as Exclude<ForestKind, 'none'>];
          const s = stats[forest];
          if (absLat > limits.maxDeg) {
            s[0]++;
            s[1] += lat;
          } else if (absLat < limits.lowlandMinDeg && reliefIndexOf(code) < 2) {
            s[2]++;
            s[3] += lat;
          }
        }
      }
    }
  }
  if (!land) return [{ kind: 'noLand' }];
  const warnings: DrawingWarning[] = [];
  for (let f = 1; f < FOREST_KINDS.length; f++) {
    const forest = FOREST_KINDS[f] as Exclude<ForestKind, 'none'>;
    const [cold, coldLat, warm, warmLat] = stats[f];
    if (cold > 0) warnings.push({ kind: 'forestTooCold', forest, cells: cold, latitudeDeg: coldLat / cold });
    if (warm > 0) warnings.push({ kind: 'forestTooWarm', forest, cells: warm, latitudeDeg: warmLat / warm });
  }
  const inland = rivers.filter((r) => riverEnd(r, rivers, drawing, settings.baseCellKm) === 'inland').length;
  if (inland > 0) warnings.push({ kind: 'riverEndsInland', count: inland });
  return warnings;
}
