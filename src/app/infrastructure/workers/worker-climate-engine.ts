import { ClimateEngine } from '../../domain/climate/climate-engine';
import { ClimateInput, ClimateResult } from '../../domain/climate/climate-model';
import { ClimateWorkerRequest, ClimateWorkerResponse } from './climate-protocol';

interface Pending {
  readonly resolve: (result: ClimateResult) => void;
  readonly reject: (error: Error) => void;
}

/**
 * Adapter: ClimateEngine backed by a Web Worker. The worker is created lazily
 * on first use. `new URL('./climate.worker', import.meta.url)` lets the
 * Angular builder bundle the worker and resolve its URL under the deploy
 * base path (/cartocraft/ on GitHub Pages).
 */
export class WorkerClimateEngine implements ClimateEngine {
  private worker: Worker | null = null;
  private nextRequestId = 1;
  private readonly pending = new Map<number, Pending>();

  compute(input: ClimateInput): Promise<ClimateResult> {
    const worker = this.ensureWorker();
    const requestId = this.nextRequestId++;
    return new Promise<ClimateResult>((resolve, reject) => {
      this.pending.set(requestId, { resolve, reject });
      const request: ClimateWorkerRequest = { kind: 'compute', requestId, input };
      // Altitudes are a fresh copy made for this request: transfer it instead of cloning.
      worker.postMessage(request, [input.altitudeM.buffer]);
    });
  }

  private ensureWorker(): Worker {
    if (this.worker) return this.worker;
    const worker = new Worker(new URL('./climate.worker', import.meta.url), { type: 'module' });
    worker.addEventListener('message', (event: MessageEvent<ClimateWorkerResponse>) => {
      const response = event.data;
      const pending = this.pending.get(response.requestId);
      if (!pending) return;
      this.pending.delete(response.requestId);
      if (response.kind === 'result') pending.resolve(response.result);
      else pending.reject(new Error(response.message));
    });
    worker.addEventListener('error', (event) => {
      for (const p of this.pending.values()) p.reject(new Error(event.message || 'Climate worker failed'));
      this.pending.clear();
    });
    this.worker = worker;
    return worker;
  }
}
