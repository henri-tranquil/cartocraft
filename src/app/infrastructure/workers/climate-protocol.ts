import { ClimateRun } from '../../domain/climate/climate-engine';
import { ClimateInput } from '../../domain/climate/climate-model';

/**
 * Typed message protocol between the main thread and the climate worker
 * (discriminated unions on `kind`: never a free-form object).
 * `requestId` pairs each response with its request.
 */
export interface ClimateComputeRequest {
  readonly kind: 'compute';
  readonly requestId: number;
  readonly input: ClimateInput;
}

/** Single variant today; a union so new requests (cancel, partial update) slot in. */
export type ClimateWorkerRequest = ClimateComputeRequest;

export type ClimateWorkerResponse =
  | { readonly kind: 'result'; readonly requestId: number; readonly result: ClimateRun; readonly durationMs: number }
  | { readonly kind: 'error'; readonly requestId: number; readonly message: string };
