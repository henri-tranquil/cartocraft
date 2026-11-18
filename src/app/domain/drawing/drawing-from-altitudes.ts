import { computeSeaMask } from '../terrain/sea-mask';
import { encodeDrawingCell, ReliefClass, SEA_CELL } from './drawing-cell';

/**
 * Altitude bands of the four relief classes, in metres above sea level.
 * The conversion drawing → world (step D6) generates altitudes inside these
 * bands; this module goes the other way for maps that only have altitudes.
 */
export const RELIEF_CLASS_FLOOR_M: Readonly<Record<ReliefClass, number>> = {
  plain: 0,
  hills: 200,
  midMountain: 600,
  highMountain: 1500,
};

export function reliefClassForAltitude(heightAboveSeaM: number): ReliefClass {
  if (heightAboveSeaM >= RELIEF_CLASS_FLOOR_M.highMountain) return 'highMountain';
  if (heightAboveSeaM >= RELIEF_CLASS_FLOOR_M.midMountain) return 'midMountain';
  if (heightAboveSeaM >= RELIEF_CLASS_FLOOR_M.hills) return 'hills';
  return 'plain';
}

/**
 * A first drawing guessed from altitudes (older maps, sketch imports, the
 * Japan sample): land = not sea (same sea mask as the rest of the app),
 * relief class from the altitude band, no forest. Row-major in and out.
 */
export function drawingFromAltitudes(altitudeM: Int16Array, widthCells: number, heightCells: number, seaLevelM: number): Int16Array {
  const sea = computeSeaMask(altitudeM, widthCells, heightCells, seaLevelM);
  const out = new Int16Array(altitudeM.length);
  for (let i = 0; i < out.length; i++) {
    out[i] = sea[i]
      ? SEA_CELL
      : encodeDrawingCell({ land: true, relief: reliefClassForAltitude(altitudeM[i] - seaLevelM), forest: 'none' });
  }
  return out;
}
