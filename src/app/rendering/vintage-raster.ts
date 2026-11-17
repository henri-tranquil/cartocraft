import { WorldMap } from '../domain/map/world-map';
import { toRowMajor } from '../domain/terrain/tiled-grid';
import { VINTAGE } from './style/vintage-style';
import { cellToScreen, screenToCell, Viewport } from './viewport';
import { drawMountainGlyph, GLYPH_STRIDE } from './vintage-mountains';
import { drawTreeGlyph, TREE_STRIDE } from './vintage-forests';
import { ClimateResult } from '../domain/climate/climate-model';
import { summariseClimate } from './vintage-climate';
import { VintageBuilt, VintageWorkerRequest, VintageWorkerResponse } from './workers/vintage-protocol';

/**
 * Rendered ("old map") view, first brick: one bitmap of the whole map
 * (1 pixel = 1 cell, smoothed when scaled) plus the coastline as a vector
 * path, so the ink line stays crisp at any zoom.
 * Tiles and semantic zoom come with step 8.
 */
export class VintageRaster {
  private readonly canvas: OffscreenCanvas;
  private readonly coast = new Path2D();
  private readonly mountains: readonly Float32Array[];
  private readonly forests: readonly Float32Array[];

  constructor(built: VintageBuilt) {
    this.canvas = new OffscreenCanvas(built.widthCells, built.heightCells);
    const ctx = this.canvas.getContext('2d');
    if (!ctx) throw new Error('2D context unavailable');
    ctx.putImageData(new ImageData(built.pixels, built.widthCells, built.heightCells), 0, 0);
    this.mountains = built.mountains;
    this.forests = built.forests;
    const segs = built.coast;
    for (let i = 0; i < segs.length; i += 4) {
      this.coast.moveTo(segs[i], segs[i + 1]);
      this.coast.lineTo(segs[i + 2], segs[i + 3]);
    }
  }

  draw(ctx: CanvasRenderingContext2D, vp: Viewport): void {
    const origin = cellToScreen(vp, 0, 0);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(this.canvas, origin.x, origin.y, this.canvas.width * vp.pixelsPerCell, this.canvas.height * vp.pixelsPerCell);

    ctx.save();
    ctx.translate(origin.x, origin.y);
    ctx.scale(vp.pixelsPerCell, vp.pixelsPerCell);
    // Line width is in the scaled space: divide to keep it constant on screen.
    ctx.lineWidth = VINTAGE.coastWidthPx / vp.pixelsPerCell;
    ctx.lineCap = 'round';
    ctx.strokeStyle = VINTAGE.ink;
    ctx.stroke(this.coast);
    ctx.restore();

    // Woods first: mountains stand out on top of them.
    const level = this.levelFor(vp);
    this.drawForests(ctx, vp, level);
    this.drawMountains(ctx, vp, level);
  }

  /** Level whose glyph width on screen is closest to the target (size halves per level). */
  private levelFor(vp: Viewport): number {
    const level0Px = Math.max(this.canvas.width, this.canvas.height) * VINTAGE.mountainWidthFraction * vp.pixelsPerCell;
    return Math.max(0, Math.min(this.mountains.length - 1, Math.round(Math.log2(level0Px / VINTAGE.mountainTargetPx))));
  }

  private drawForests(ctx: CanvasRenderingContext2D, vp: Viewport, level: number): void {
    const t = this.forests[level];
    const topLeft = screenToCell(vp, 0, 0);
    const bottomRight = screenToCell(vp, vp.widthPx, vp.heightPx);
    for (let i = 0; i < t.length; i += TREE_STRIDE) {
      const x = t[i];
      const y = t[i + 1];
      const s = t[i + 2];
      if (x + s < topLeft.x || x - s > bottomRight.x || y < topLeft.y || y - s * 1.2 > bottomRight.y) continue;
      const p = cellToScreen(vp, x, y);
      drawTreeGlyph(ctx, p.x, p.y, s * vp.pixelsPerCell, t[i + 3], t[i + 4]);
    }
  }

  /** Vector glyphs, back to front; those outside the screen are skipped. */
  private drawMountains(ctx: CanvasRenderingContext2D, vp: Viewport, level: number): void {
    const m = this.mountains[level];
    const topLeft = screenToCell(vp, 0, 0);
    const bottomRight = screenToCell(vp, vp.widthPx, vp.heightPx);
    for (let i = 0; i < m.length; i += GLYPH_STRIDE) {
      const x = m[i];
      const y = m[i + 1];
      const w = m[i + 2];
      const h = m[i + 3];
      if (x + w < topLeft.x || x - w > bottomRight.x || y < topLeft.y || y - h > bottomRight.y) continue;
      const s = cellToScreen(vp, x, y);
      drawMountainGlyph(ctx, s.x, s.y, w * vp.pixelsPerCell, h * vp.pixelsPerCell, m[i + 4]);
    }
  }
}

/**
 * Runs the build in a Worker. Only the latest request matters: an older
 * answer arriving late is dropped (its promise never resolves).
 */
export class VintageBuilder {
  private worker: Worker | null = null;
  private lastRequestId = 0;
  private readonly pending = new Map<number, (raster: VintageRaster | Error) => void>();

  build(map: WorldMap, climate: ClimateResult | null): Promise<VintageRaster> {
    const grid = map.terrain.baseAltitudeM;
    const requestId = ++this.lastRequestId;
    const request: VintageWorkerRequest = {
      kind: 'build',
      requestId,
      input: {
        altitudeM: toRowMajor(grid), // a fresh copy: safe to transfer
        widthCells: grid.widthCells,
        heightCells: grid.heightCells,
        seaLevelM: map.settings.seaLevelM,
        cellSizeM: map.settings.baseCellKm * 1000,
        seed: map.settings.seed,
        climate: climate ? summariseClimate(climate) : null,
      },
    };
    return new Promise((resolve, reject) => {
      this.pending.set(requestId, (outcome) => (outcome instanceof Error ? reject(outcome) : resolve(outcome)));
      const c = request.input.climate;
      const transfer: ArrayBuffer[] = [request.input.altitudeM.buffer as ArrayBuffer];
      if (c) transfer.push(c.wetnessPct.buffer, c.meanDeciC.buffer, c.warmestDeciC.buffer);
      this.ensureWorker().postMessage(request, transfer);
    });
  }

  dispose(): void {
    this.worker?.terminate();
    this.worker = null;
    this.pending.clear();
  }

  private ensureWorker(): Worker {
    if (this.worker) return this.worker;
    const worker = new Worker(new URL('./workers/vintage.worker', import.meta.url), { type: 'module' });
    worker.addEventListener('message', (event: MessageEvent<VintageWorkerResponse>) => {
      const response = event.data;
      const settle = this.pending.get(response.requestId);
      this.pending.delete(response.requestId);
      if (!settle || response.requestId !== this.lastRequestId) return; // stale
      settle(response.kind === 'built' ? new VintageRaster(response.built) : new Error(response.message));
    });
    worker.addEventListener('error', (event) => {
      for (const settle of this.pending.values()) settle(new Error(event.message));
      this.pending.clear();
    });
    this.worker = worker;
    return worker;
  }
}
