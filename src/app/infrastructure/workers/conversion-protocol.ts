import { WorldConversionInput } from '../../domain/drawing/drawing-to-world';

/** Typed messages between the main thread and the conversion worker (discriminated on `kind`). */
export interface ConversionWorkerRequest {
  readonly kind: 'convert';
  readonly requestId: number;
  readonly input: WorldConversionInput;
}

export type ConversionWorkerResponse =
  | { readonly kind: 'result'; readonly requestId: number; readonly altitudeM: Int16Array; readonly durationMs: number }
  | { readonly kind: 'error'; readonly requestId: number; readonly message: string };
