import { computeHydrology } from '../hydrology/rivers';
import { computeClimate } from './climate';
import type { ClimateRun } from './climate-engine';
import { ClimateInput } from './climate-model';

/** Climate, then hydrology from its runoff. Pure: runs in the worker or synchronously in tests. */
export function computeClimateRun(input: ClimateInput): ClimateRun {
  const climate = computeClimate(input);
  const hydrology = computeHydrology(input.altitudeM, input.widthCells, input.heightCells, input.seaLevelM, input.cellKm, climate.runoffMm);
  return { climate, hydrology };
}
