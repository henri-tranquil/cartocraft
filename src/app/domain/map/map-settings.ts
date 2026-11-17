export interface MapSettings {
  readonly widthKm: number;
  readonly heightKm: number;
  /** Size of one base-grid cell. */
  readonly baseCellKm: number;
  /** Uint32 seed for all procedural generation. */
  readonly seed: number;
  /** Latitude of the top edge, in degrees (positive = north). Independent of map size. */
  readonly latitudeTopDeg: number;
  readonly latitudeBottomDeg: number;
  /** Drives seasonal amplitude. Earth: 23.4. */
  readonly axialTiltDeg: number;
  readonly seaLevelM: number;
  readonly globalTemperatureOffsetC: number;
}

/** Indicative upper bound; to be validated by a performance test in step 3. */
export const MAX_GRID_CELLS_PER_SIDE = 2048;

export const DEFAULT_MAP_SETTINGS: MapSettings = {
  widthKm: 1000,
  heightKm: 1000,
  baseCellKm: 1,
  seed: 1,
  latitudeTopDeg: 55,
  latitudeBottomDeg: 40,
  axialTiltDeg: 23.4,
  seaLevelM: 0,
  globalTemperatureOffsetC: 0,
};

export function gridSizeCells(settings: MapSettings): { widthCells: number; heightCells: number } {
  return {
    widthCells: Math.ceil(settings.widthKm / settings.baseCellKm),
    heightCells: Math.ceil(settings.heightKm / settings.baseCellKm),
  };
}

/** Returns human-readable (French, UI-facing) errors; empty array means valid. */
export function validateMapSettings(settings: MapSettings): string[] {
  const errors: string[] = [];
  if (!(settings.widthKm > 0) || !(settings.heightKm > 0)) errors.push('La taille de la carte doit être positive.');
  if (!(settings.baseCellKm > 0)) errors.push('La résolution doit être positive.');
  if (errors.length === 0) {
    const { widthCells, heightCells } = gridSizeCells(settings);
    if (widthCells > MAX_GRID_CELLS_PER_SIDE || heightCells > MAX_GRID_CELLS_PER_SIDE) {
      errors.push(`La grille dépasse ${MAX_GRID_CELLS_PER_SIDE} cellules de côté (${widthCells}×${heightCells}).`);
    }
  }
  if (!Number.isInteger(settings.seed) || settings.seed < 0 || settings.seed > 0xffffffff) {
    errors.push('La graine doit être un entier entre 0 et 4294967295.');
  }
  const latOk = (v: number) => v >= -90 && v <= 90;
  if (!latOk(settings.latitudeTopDeg) || !latOk(settings.latitudeBottomDeg)) {
    errors.push('Les latitudes doivent être comprises entre -90° et 90°.');
  } else if (settings.latitudeTopDeg <= settings.latitudeBottomDeg) {
    errors.push('La latitude du haut doit être supérieure à celle du bas.');
  }
  if (!(settings.axialTiltDeg >= 0 && settings.axialTiltDeg <= 90)) {
    errors.push("L'inclinaison de l'axe doit être comprise entre 0° et 90°.");
  }
  return errors;
}
