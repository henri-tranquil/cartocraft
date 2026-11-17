import { ClimateInput, ClimateResult } from './climate-model';

/**
 * Port: "something that computes the climate". The real adapter runs the
 * domain algorithm in a Web Worker (infrastructure); tests use a synchronous one.
 */
export interface ClimateEngine {
  compute(input: ClimateInput): Promise<ClimateResult>;
}
