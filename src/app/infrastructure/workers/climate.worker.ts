/// <reference lib="webworker" />
import { computeClimateRun } from '../../domain/climate/climate-run';
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
        const result = computeClimateRun(request.input);
        const { climate, hydrology } = result;
        const rivers = hydrology.rivers;
        const response: ClimateWorkerResponse = {
          kind: 'result',
          requestId: request.requestId,
          result,
          durationMs: performance.now() - start,
        };
        postMessage(response, [
          climate.temperatureDeciC.buffer,
          climate.windUMs.buffer,
          climate.windVMs.buffer,
          climate.precipitationMm.buffer,
          climate.wetnessPct.buffer,
          climate.snowDepthCm.buffer,
          climate.runoffMm.buffer,
          hydrology.dischargeM3s.buffer,
          rivers.pointsCells.buffer,
          rivers.dischargeM3s.buffer,
          rivers.starts.buffer,
          rivers.lineMaxDischargeM3s.buffer,
          rivers.lineBounds.buffer,
        ]);
      } catch (error) {
        const response: ClimateWorkerResponse = { kind: 'error', requestId: request.requestId, message: String(error) };
        postMessage(response);
      }
      break;
    }
  }
});
