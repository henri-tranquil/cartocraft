/// <reference lib="webworker" />
import { convertDrawingToWorld } from '../../domain/drawing/drawing-to-world';
import { ConversionWorkerRequest, ConversionWorkerResponse } from './conversion-protocol';

/** Converts a drawing into altitudes off the main thread; the result buffer is transferred back. */
addEventListener('message', (event: MessageEvent<ConversionWorkerRequest>) => {
  const request = event.data;
  switch (request.kind) {
    case 'convert': {
      const start = performance.now();
      try {
        const altitudeM = convertDrawingToWorld(request.input);
        const response: ConversionWorkerResponse = { kind: 'result', requestId: request.requestId, altitudeM, durationMs: performance.now() - start };
        postMessage(response, [altitudeM.buffer]);
      } catch (error) {
        const response: ConversionWorkerResponse = { kind: 'error', requestId: request.requestId, message: error instanceof Error ? error.message : String(error) };
        postMessage(response);
      }
      break;
    }
  }
});
