import {
  afterNextRender,
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  effect,
  ElementRef,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { EditorFacade } from '../../application/editor-facade';
import { Icon } from '../icon/icon';
import { WorldMap } from '../../domain/map/world-map';
import { CellPoint } from '../../domain/terrain/brushes';
import { TerrainRaster } from '../../rendering/terrain-raster';
import { cellToScreen, fitViewport, panBy, resize, screenToCell, Viewport, zoomAt, zoomLimits } from '../../rendering/viewport';
import { loadView, saveView } from './view-memory';

const WHEEL_ZOOM_SPEED = 0.0015;
const VIEW_SAVE_DEBOUNCE_MS = 400;
/** Outside the map: same parchment as the frame. */
const BACKGROUND = '#e2cfa6';

@Component({
  selector: 'cc-map-canvas',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [DecimalPipe, Icon],
  template: `
    <canvas
      #canvas
      [style.cursor]="cursor()"
      (pointerdown)="onPointerDown($event)"
      (pointermove)="onPointerMove($event)"
      (pointerup)="onPointerUp($event)"
      (pointercancel)="onPointerUp($event)"
      (pointerleave)="hover.set(null)"
      (wheel)="onWheel($event)"
      (contextmenu)="$event.preventDefault()"
    ></canvas>
    <button type="button" class="cc-btn shape-sceau fit" title="Afficher toute la carte" (click)="fitToMap()">
      <cc-icon name="fit" [size]="13" [strokeWidth]="2.6" />
      <span class="cc-caption">Recadrer</span>
    </button>
    <footer class="status">
      @if (hoverInfo(); as info) {
        <span class="chip" title="Position">{{ info.xKm | number: '1.0-0' }} · {{ info.yKm | number: '1.0-0' }} km</span>
        <span class="chip chip--accent" title="Altitude"><cc-icon name="altitude" [size]="9" /> {{ info.altitudeM | number: '1.0-0' }} m</span>
      }
      @if (visibleWidthKm(); as km) {
        <span class="chip scale" title="Largeur visible">↔ {{ km | number: '1.0-0' }} km</span>
      }
    </footer>
  `,
  styles: `
    :host { position: relative; display: block; width: 100%; height: 100%; overflow: hidden; }
    canvas { display: block; width: 100%; height: 100%; touch-action: none; }
    .status { position: absolute; left: 8px; right: 8px; bottom: 8px; display: flex; gap: 6px; pointer-events: none; }
    .chip { display: inline-flex; align-items: center; gap: 4px; padding: 2px 7px; background: var(--cc-panel); border: var(--cc-border) solid var(--cc-ink); font-weight: 600; font-size: 11px; font-variant-numeric: tabular-nums; }
    .chip--accent { background: var(--cc-accent); }
    .scale { margin-left: auto; }
    .fit { position: absolute; top: 8px; right: 8px; height: 26px; padding: 0 10px; --cc-shadow: 2px; }
  `,
})
export class MapCanvas {
  private readonly facade = inject(EditorFacade);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly destroyRef = inject(DestroyRef);
  private readonly canvasRef = viewChild.required<ElementRef<HTMLCanvasElement>>('canvas');

  private readonly viewport = signal<Viewport | null>(null);
  protected readonly hover = signal<CellPoint | null>(null);
  private raster: TerrainRaster | null = null;
  private rasterMap: WorldMap | null = null;
  private frameRequest: number | null = null;
  private panning: { pointerId: number; lastX: number; lastY: number } | null = null;
  private viewSaveTimer: ReturnType<typeof setTimeout> | null = null;

  protected readonly cursor = computed(() => (this.facade.activeTool() === 'pan' ? 'grab' : 'crosshair'));

  protected readonly hoverInfo = computed(() => {
    this.facade.renderRevision(); // altitude changes while painting
    const point = this.hover();
    const map = this.facade.renderMap();
    if (!point || !map) return null;
    const altitudeM = this.facade.altitudeAt(point);
    if (altitudeM === null) return null;
    const km = map.settings.baseCellKm;
    return { xKm: point.x * km, yKm: point.y * km, altitudeM };
  });

  protected readonly visibleWidthKm = computed(() => {
    const vp = this.viewport();
    const map = this.facade.renderMap();
    return vp && map ? (vp.widthPx / vp.pixelsPerCell) * map.settings.baseCellKm : null;
  });

  constructor() {
    // Redraw (at most once per animation frame) whenever the model, view or cursor changes.
    effect(() => {
      this.facade.renderRevision();
      this.facade.renderMap();
      this.viewport();
      this.hover();
      this.facade.brush();
      this.requestDraw();
    });

    // Remember the camera of the current map (debounced: panning fires many changes).
    effect(() => {
      const vp = this.viewport();
      const mapId = this.facade.currentMapId();
      if (!vp || !mapId || this.rasterMap?.id !== mapId) return;
      if (this.viewSaveTimer !== null) clearTimeout(this.viewSaveTimer);
      this.viewSaveTimer = setTimeout(() => saveView(mapId, vp), VIEW_SAVE_DEBOUNCE_MS);
    });

    afterNextRender(() => {
      const observer = new ResizeObserver(() => this.onResize());
      observer.observe(this.host.nativeElement);
      this.destroyRef.onDestroy(() => observer.disconnect());
    });

    this.destroyRef.onDestroy(() => {
      if (this.frameRequest !== null) cancelAnimationFrame(this.frameRequest);
      if (this.viewSaveTimer !== null) clearTimeout(this.viewSaveTimer);
    });
  }

  // --- Input ---

  protected onPointerDown(event: PointerEvent): void {
    const vp = this.viewport();
    if (!vp) return;
    this.canvasRef().nativeElement.setPointerCapture(event.pointerId);
    // Middle or right button always pans; left button uses the active tool.
    if (event.button !== 0 || this.facade.activeTool() === 'pan') {
      this.panning = { pointerId: event.pointerId, lastX: event.offsetX, lastY: event.offsetY };
      return;
    }
    if (event.button === 0) this.facade.pointerDown(screenToCell(vp, event.offsetX, event.offsetY));
  }

  protected onPointerMove(event: PointerEvent): void {
    const vp = this.viewport();
    if (!vp) return;
    if (this.panning?.pointerId === event.pointerId) {
      this.viewport.set(panBy(vp, event.offsetX - this.panning.lastX, event.offsetY - this.panning.lastY));
      this.panning = { ...this.panning, lastX: event.offsetX, lastY: event.offsetY };
      return;
    }
    const point = screenToCell(vp, event.offsetX, event.offsetY);
    this.hover.set(point);
    this.facade.pointerMove(point);
  }

  protected onPointerUp(event: PointerEvent): void {
    if (this.panning?.pointerId === event.pointerId) {
      this.panning = null;
      return;
    }
    this.facade.pointerUp();
  }

  protected onWheel(event: WheelEvent): void {
    event.preventDefault();
    const vp = this.viewport();
    const map = this.facade.renderMap();
    if (!vp || !map) return;
    const grid = map.terrain.baseAltitudeM;
    const limits = zoomLimits(grid.widthCells, grid.heightCells, map.settings.baseCellKm, vp);
    this.viewport.set(zoomAt(vp, event.offsetX, event.offsetY, Math.exp(-event.deltaY * WHEEL_ZOOM_SPEED), limits));
  }

  // --- Drawing ---

  private onResize(): void {
    const { clientWidth: w, clientHeight: h } = this.host.nativeElement;
    // The backing store is in DEVICE pixels (sharp on HiDPI screens);
    // all our maths stays in CSS pixels, and setTransform(dpr) bridges the two.
    const canvas = this.canvasRef().nativeElement;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    const vp = this.viewport();
    this.viewport.set(vp ? resize(vp, w, h) : null);
    this.requestDraw();
  }

  private requestDraw(): void {
    if (this.frameRequest !== null) return;
    this.frameRequest = requestAnimationFrame(() => {
      this.frameRequest = null;
      this.draw();
    });
  }

  private draw(): void {
    const canvas = this.canvasRef().nativeElement;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const dpr = window.devicePixelRatio || 1;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = BACKGROUND;
    ctx.fillRect(0, 0, canvas.width / dpr, canvas.height / dpr);

    const map = this.facade.renderMap();
    if (!map || canvas.width === 0) return; // not laid out yet: the ResizeObserver will redraw
    if (map !== this.rasterMap) {
      this.raster = new TerrainRaster(map);
      this.rasterMap = map;
      // Setting a signal here re-triggers the effect → one more frame; harmless.
      this.viewport.set(this.initialViewport(map, canvas.width / dpr, canvas.height / dpr));
    }
    const vp = this.viewport();
    if (!this.raster || !vp) return;

    this.raster.update(this.facade.takeDirtyRects());
    this.raster.draw(ctx, vp);
    this.drawBrushCursor(ctx, vp, map);
  }

  protected fitToMap(): void {
    const map = this.facade.renderMap();
    const vp = this.viewport();
    if (!map || !vp) return;
    const grid = map.terrain.baseAltitudeM;
    this.viewport.set(fitViewport(grid.widthCells, grid.heightCells, vp.widthPx, vp.heightPx));
  }

  /** Last view of this map if remembered (zoom clamped to current limits), else fit the whole map. */
  private initialViewport(map: WorldMap, widthPx: number, heightPx: number): Viewport {
    const grid = map.terrain.baseAltitudeM;
    const fit = fitViewport(grid.widthCells, grid.heightCells, widthPx, heightPx);
    const saved = loadView(map.id);
    if (!saved) return fit;
    const limits = zoomLimits(grid.widthCells, grid.heightCells, map.settings.baseCellKm, fit);
    const pixelsPerCell = Math.min(limits.maxPixelsPerCell, Math.max(limits.minPixelsPerCell, saved.pixelsPerCell));
    return { ...fit, centerX: saved.centerX, centerY: saved.centerY, pixelsPerCell };
  }

  private drawBrushCursor(ctx: CanvasRenderingContext2D, vp: Viewport, map: WorldMap): void {
    const point = this.hover();
    if (!point || this.facade.activeTool() === 'pan') return;
    const center = cellToScreen(vp, point.x, point.y);
    const radiusPx = (this.facade.brush().radiusKm / map.settings.baseCellKm) * vp.pixelsPerCell;
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = 'rgb(40 30 20 / 0.8)';
    ctx.beginPath();
    ctx.arc(center.x, center.y, radiusPx, 0, Math.PI * 2);
    ctx.stroke();
    ctx.strokeStyle = 'rgb(255 255 255 / 0.6)';
    ctx.beginPath();
    ctx.arc(center.x, center.y, radiusPx + 1.5, 0, Math.PI * 2);
    ctx.stroke();
  }
}
