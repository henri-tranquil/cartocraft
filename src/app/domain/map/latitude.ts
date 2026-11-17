import { MapSettings } from './map-settings';

/**
 * Latitude varies LINEARLY from the top edge (y = 0) to the bottom edge
 * (y = heightCells). A straight north–south line on our flat map is a
 * meridian, so this is like a simple cylindrical projection: fine at the
 * scale of a country or a continent.
 *
 * Two pins "this row is at this latitude" fully define that line (two points
 * define a straight line), hence the top and bottom latitudes.
 */
export interface LatitudePin {
  /** Continuous row coordinate (0 = top edge). */
  readonly yCell: number;
  readonly latitudeDeg: number;
}

export function latitudeAtRow(settings: Pick<MapSettings, 'latitudeTopDeg' | 'latitudeBottomDeg'>, heightCells: number, yCell: number): number {
  return settings.latitudeTopDeg + ((settings.latitudeBottomDeg - settings.latitudeTopDeg) * yCell) / heightCells;
}

export function rowAtLatitude(settings: Pick<MapSettings, 'latitudeTopDeg' | 'latitudeBottomDeg'>, heightCells: number, latitudeDeg: number): number {
  return ((latitudeDeg - settings.latitudeTopDeg) * heightCells) / (settings.latitudeBottomDeg - settings.latitudeTopDeg);
}

/** Top/bottom latitudes through two pins; null when the pins share a row (no unique line). */
export function latitudesFromPins(
  a: LatitudePin,
  b: LatitudePin,
  heightCells: number,
): { latitudeTopDeg: number; latitudeBottomDeg: number } | null {
  if (Math.abs(a.yCell - b.yCell) < 1e-6) return null;
  const degPerCell = (b.latitudeDeg - a.latitudeDeg) / (b.yCell - a.yCell);
  return {
    latitudeTopDeg: a.latitudeDeg - degPerCell * a.yCell,
    latitudeBottomDeg: a.latitudeDeg + degPerCell * (heightCells - a.yCell),
  };
}

/** "45,5° N", "12° S", "0°" — French formatting for labels. */
export function formatLatitude(latitudeDeg: number, fractionDigits = 0): string {
  const rounded = Number(latitudeDeg.toFixed(fractionDigits));
  if (rounded === 0) return '0°';
  const text = Math.abs(rounded).toLocaleString('fr-FR', { maximumFractionDigits: fractionDigits });
  return `${text}° ${rounded > 0 ? 'N' : 'S'}`;
}
