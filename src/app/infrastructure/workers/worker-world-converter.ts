import { WorldConversionInput, WorldConverter } from '../../domain/drawing/drawing-to-world';
import { ConversionWorkerRequest, ConversionWorkerResponse } from './conversion-protocol';

/** Adapter: WorldConverter backed by a Web Worker, created on first use (bundled by the Angular builder). */
export class WorkerWorldConverter implements WorldConverter {
  private worker: Worker | null = null;
  private nextRequestId = 1;
  private readonly pending = new Map<number, { resolve: (altitudeM: Int16Array) => void; reject: (error: Error) => void }>();

  convert(input: WorldConversionInput): Promise<Int16Array> {
    const worker = this.ensureWorker();
    const requestId = this.nextRequestId++;
    return new Promise<Int16Array>((resolve, reject) => {
      this.pending.set(requestId, { resolve, reject });
      const request: ConversionWorkerRequest = { kind: 'convert', requestId, input };
      // The drawing is a fresh copy made for this request: transfer it instead of cloning.
      worker.postMessage(request, [input.drawing.buffer]);
    });
  }

  private ensureWorker(): Worker {
    if (this.worker) return this.worker;
    const worker = new Worker(new URL('./conversion.worker', import.meta.url), { type: 'module' });
    worker.addEventListener('message', (event: MessageEvent<ConversionWorkerResponse>) => {
      const response = event.data;
      const pending = this.pending.get(response.requestId);
      if (!pending) return;
      this.pending.delete(response.requestId);
      if (response.kind === 'result') pending.resolve(response.altitudeM);
      else pending.reject(new Error(response.message));
    });
    worker.addEventListener('error', (event) => {
      for (const p of this.pending.values()) p.reject(new Error(event.message || 'Conversion worker failed'));
      this.pending.clear();
    });
    this.worker = worker;
    return worker;
  }
}
