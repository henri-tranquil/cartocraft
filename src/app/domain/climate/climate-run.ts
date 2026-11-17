import { computeHydrology } from '../hydrology/rivers';
import { computeSeaMask } from '../terrain/sea-mask';
import { computeClimate } from './climate';
import type { ClimateRun } from './climate-engine';
import { ClimateInput } from './climate-model';

/** Climate, then hydrology from its runoff. Pure: runs in the worker or synchronously in tests. */
export function computeClimateRun(input: ClimateInput): ClimateRun {
  const sea = computeSeaMask(input.altitudeM, input.widthCells, input.heightCells, input.seaLevelM);
  const climate = computeClimate(input, sea);
  const hydrology = computeHydrology(input.altitudeM, input.widthCells, input.heightCells, sea, input.cellKm, climate.runoffMm, input.lakes);
  return { climate, hydrology };
}
