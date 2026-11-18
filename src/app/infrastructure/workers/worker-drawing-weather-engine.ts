import { DrawingAirField } from '../../domain/drawing/drawing-winds';
import { DrawingWeatherEngine, DrawingWeatherResult } from '../../domain/drawing/drawing-weather';
import { WeatherWorkerRequest, WeatherWorkerResponse } from './weather-protocol';

/** Adapter: DrawingWeatherEngine backed by a Web Worker, created on first use. */
export class WorkerDrawingWeatherEngine implements DrawingWeatherEngine {
  private worker: Worker | null = null;
  private nextRequestId = 1;
  private readonly pending = new Map<number, { resolve: (result: DrawingWeatherResult) => void; reject: (error: Error) => void }>();

  compute(field: DrawingAirField): Promise<DrawingWeatherResult> {
    const worker = this.ensureWorker();
    const requestId = this.nextRequestId++;
    return new Promise<DrawingWeatherResult>((resolve, reject) => {
      this.pending.set(requestId, { resolve, reject });
      // The field is small (coarse grid) and still used by the main thread: cloned, not transferred.
      const request: WeatherWorkerRequest = { kind: 'compute', requestId, field };
      worker.postMessage(request);
    });
  }

  private ensureWorker(): Worker {
    if (this.worker) return this.worker;
    const worker = new Worker(new URL('./weather.worker', import.meta.url), { type: 'module' });
    worker.addEventListener('message', (event: MessageEvent<WeatherWorkerResponse>) => {
      const response = event.data;
      const pending = this.pending.get(response.requestId);
      if (!pending) return;
      this.pending.delete(response.requestId);
      if (response.kind === 'result') pending.resolve(response.result);
      else pending.reject(new Error(response.message));
    });
    worker.addEventListener('error', (event) => {
      for (const p of this.pending.values()) p.reject(new Error(event.message || 'Weather worker failed'));
      this.pending.clear();
    });
    this.worker = worker;
    return worker;
  }
}
