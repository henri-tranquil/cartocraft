import { latitudeAtRow } from '../map/latitude';
import { MapSettings } from '../map/map-settings';
import { Int16TiledGrid } from '../terrain/tiled-grid';
import { DrawnRiver, riverEnd } from './drawn-river';
import { FOREST_KINDS, ForestKind, forestIndexOf, isLandCode, reliefIndexOf } from './drawing-cell';
import { reliefClassAltitudeM } from './drawing-climate';
import { DrawingWeather } from './drawing-weather';
import { LAPSE_RATE_C_PER_M } from '../climate/temperature';

/**
 * Things worth checking in a drawing, shown as warnings ("À vérifier"),
 * never as blocking errors: the user may want a strange world.
 */
export type DrawingWarning =
  | { readonly kind: 'noLand' }
  /** Rivers ending neither in the sea (or an inland sea: a lake) nor on another river. */
  | { readonly kind: 'riverEndsInland'; readonly count: number }
  | {
      /** Forest painted where its trees would not grow: too cold, too warm or too dry for that kind. */
      readonly kind: 'forestTooCold' | 'forestTooWarm' | 'forestTooDry';
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

/**
 * Where each forest kind grows, once the winds' weather is known (ground
 * temperatures, at the altitude of the relief class):
 * - summer: trees need a warm enough month (the tree line is near 10 °C for
 *   the warmest month; broadleaf trees need longer, warmer summers);
 * - winter: tropical trees cannot stand frost; broadleaf and conifer forests
 *   of the lowlands give way to tropical forest where it never gets cool;
 * - water: below some wetness the forest becomes savanna or steppe.
 */
export const FOREST_CLIMATE_LIMITS: Readonly<
  Record<Exclude<ForestKind, 'none'>, { readonly minWarmestC: number; readonly minColdestC: number; readonly maxColdestC: number; readonly minWetnessPct: number }>
> = {
  broadleaf: { minWarmestC: 13, minColdestC: -30, maxColdestC: 18, minWetnessPct: 35 },
  conifer: { minWarmestC: 10, minColdestC: -60, maxColdestC: 15, minWetnessPct: 25 },
  tropical: { minWarmestC: 18, minColdestC: 14, maxColdestC: 99, minWetnessPct: 45 },
};

/** Smallest misplaced forest worth a warning once the climate is known, km². */
const MIN_WARNED_CELLS = 100;

type CheckedSettings = Pick<MapSettings, 'latitudeTopDeg' | 'latitudeBottomDeg' | 'baseCellKm'>;

/** With the winds' weather, forests are checked against their climate; without it (not computed yet), by latitude. */
export function checkDrawing(
  drawing: Int16TiledGrid,
  settings: CheckedSettings,
  rivers: readonly DrawnRiver[] = [],
  weather: DrawingWeather | null = null,
): DrawingWarning[] {
  // Per forest kind (index 1..3): [cold count, cold Σlat, warm count, warm Σlat, dry count, dry Σlat].
  const stats = Array.from({ length: FOREST_KINDS.length }, () => [0, 0, 0, 0, 0, 0]);
  const coarse = weather ? weather.cellKm / settings.baseCellKm : 0;
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
          const s = stats[forest];
          if (weather) {
            const x = tx * tileSize + c;
            const i = Math.min(weather.heightCells - 1, Math.floor(y / coarse)) * weather.widthCells + Math.min(weather.widthCells - 1, Math.floor(x / coarse));
            const cooling = reliefClassAltitudeM(reliefIndexOf(code)) * LAPSE_RATE_C_PER_M;
            const limits = FOREST_CLIMATE_LIMITS[FOREST_KINDS[forest] as Exclude<ForestKind, 'none'>];
            const coldest = weather.coldestTempC[i] - cooling;
            if (weather.warmestTempC[i] - cooling < limits.minWarmestC || coldest < limits.minColdestC) {
              s[0]++;
              s[1] += lat;
            } else if (coldest > limits.maxColdestC) {
              s[2]++;
              s[3] += lat;
            } else if (weather.wetnessPct[i] < limits.minWetnessPct) {
              s[4]++;
              s[5] += lat;
            }
            continue;
          }
          const limits = FOREST_LATITUDE_LIMITS[FOREST_KINDS[forest] as Exclude<ForestKind, 'none'>];
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
    const [cold, coldLat, warm, warmLat, dry, dryLat] = stats[f];
    // A few scattered cells at the edge of a forest are not worth a warning.
    const min = weather ? MIN_WARNED_CELLS / (settings.baseCellKm * settings.baseCellKm) : 1;
    if (cold >= min) warnings.push({ kind: 'forestTooCold', forest, cells: cold, latitudeDeg: coldLat / cold });
    if (warm >= min) warnings.push({ kind: 'forestTooWarm', forest, cells: warm, latitudeDeg: warmLat / warm });
    if (dry >= min) warnings.push({ kind: 'forestTooDry', forest, cells: dry, latitudeDeg: dryLat / dry });
  }
  const inland = rivers.filter((r) => riverEnd(r, rivers, drawing, settings.baseCellKm) === 'inland').length;
  if (inland > 0) warnings.push({ kind: 'riverEndsInland', count: inland });
  return warnings;
}
