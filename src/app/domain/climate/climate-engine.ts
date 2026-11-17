import { HydrologyResult } from '../hydrology/rivers';
import { ClimateInput, ClimateResult } from './climate-model';

/**
 * What one background run produces: the climate, then the rivers it feeds
 * (they need its runoff, and both are invalidated by the same edits).
 */
export interface ClimateRun {
  readonly climate: ClimateResult;
  readonly hydrology: HydrologyResult;
}

/**
 * Port: "something that computes the climate and the rivers". The real
 * adapter runs the domain algorithms in a Web Worker (infrastructure); tests
 * use a synchronous one.
 */
export interface ClimateEngine {
  compute(input: ClimateInput): Promise<ClimateRun>;
}
