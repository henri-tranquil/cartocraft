/// <reference lib="webworker" />
import { contourSegments } from '../../domain/terrain/contour';
import { computeSeaMask } from '../../domain/terrain/sea-mask';
import { renderVintagePixels } from '../vintage-pixels';
import { MOUNTAIN_LEVELS, placeMountains } from '../vintage-mountains';
import { placeForests } from '../vintage-forests';
import { VintageWorkerRequest, VintageWorkerResponse } from './vintage-protocol';

/** Builds the rendered view off the main thread (~0.7 s for 1700², which would freeze the UI). */
addEventListener('message', (event: MessageEvent<VintageWorkerRequest>) => {
  const request = event.data;
  switch (request.kind) {
    case 'build': {
      const start = performance.now();
      try {
        const sea = computeSeaMask(request.input.altitudeM, request.input.widthCells, request.input.heightCells, request.input.seaLevelM);
        const input = { ...request.input, sea };
        const pixels = new Uint8ClampedArray(input.widthCells * input.heightCells * 4);
        renderVintagePixels(input, pixels);
        // Integer altitudes: +0.5 puts the line between the last sea and the first land value.
        // Inland depressions are lifted above that level: no coastline around them.
        const coastField = input.altitudeM.map((a, i) => (sea[i] ? a : Math.max(a, input.seaLevelM + 1)));
        const coast = contourSegments(coastField, input.widthCells, input.heightCells, input.seaLevelM + 0.5);
        const mountains = Array.from({ length: MOUNTAIN_LEVELS }, (_, level) => placeMountains(input, level));
        const forests = Array.from({ length: MOUNTAIN_LEVELS }, (_, level) => placeForests(input, input.climate, level));
        const response: VintageWorkerResponse = {
          kind: 'built',
          requestId: request.requestId,
          built: { widthCells: input.widthCells, heightCells: input.heightCells, pixels, coast, mountains, forests, durationMs: performance.now() - start },
        };
        postMessage(response, [pixels.buffer, coast.buffer, ...mountains.map((m) => m.buffer), ...forests.map((f) => f.buffer)]);
      } catch (error) {
        const response: VintageWorkerResponse = { kind: 'error', requestId: request.requestId, message: String(error) };
        postMessage(response);
      }
      break;
    }
  }
});
