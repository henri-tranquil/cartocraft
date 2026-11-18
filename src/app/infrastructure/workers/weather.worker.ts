/// <reference lib="webworker" />
import { computeDrawingWeather } from '../../domain/drawing/drawing-weather';
import { WeatherWorkerRequest, WeatherWorkerResponse } from './weather-protocol';

/** Weather and wind streamlines of the drawing, off the main thread. */
addEventListener('message', (event: MessageEvent<WeatherWorkerRequest>) => {
  const request = event.data;
  switch (request.kind) {
    case 'compute': {
      const start = performance.now();
      try {
        const result = computeDrawingWeather(request.field);
        const response: WeatherWorkerResponse = { kind: 'result', requestId: request.requestId, result, durationMs: performance.now() - start };
        postMessage(response);
      } catch (error) {
        const response: WeatherWorkerResponse = { kind: 'error', requestId: request.requestId, message: error instanceof Error ? error.message : String(error) };
        postMessage(response);
      }
      break;
    }
  }
});
