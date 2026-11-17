/// <reference lib="webworker" />
import { computeMonthlyTemperatures } from '../../domain/climate/temperature';
import { ClimateWorkerRequest, ClimateWorkerResponse } from './climate-protocol';

/**
 * Runs on its own thread: a long computation here never freezes the UI.
 * The result's big buffer is TRANSFERRED (moved, not copied) back to the
 * main thread, which is instant whatever its size.
 */
addEventListener('message', (event: MessageEvent<ClimateWorkerRequest>) => {
  const request = event.data;
  switch (request.kind) {
    case 'compute': {
      const start = performance.now();
      try {
        const result = computeMonthlyTemperatures(request.input);
        const response: ClimateWorkerResponse = {
          kind: 'result',
          requestId: request.requestId,
          result,
          durationMs: performance.now() - start,
        };
        postMessage(response, [result.temperatureDeciC.buffer, result.windUMs.buffer, result.windVMs.buffer]);
      } catch (error) {
        const response: ClimateWorkerResponse = { kind: 'error', requestId: request.requestId, message: String(error) };
        postMessage(response);
      }
      break;
    }
  }
});
