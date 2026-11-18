import { DrawingAirField } from '../../domain/drawing/drawing-winds';
import { DrawingWeatherResult } from '../../domain/drawing/drawing-weather';

/** Typed messages between the main thread and the drawing weather worker (discriminated on `kind`). */
export interface WeatherWorkerRequest {
  readonly kind: 'compute';
  readonly requestId: number;
  readonly field: DrawingAirField;
}

export type WeatherWorkerResponse =
  | { readonly kind: 'result'; readonly requestId: number; readonly result: DrawingWeatherResult; readonly durationMs: number }
  | { readonly kind: 'error'; readonly requestId: number; readonly message: string };
