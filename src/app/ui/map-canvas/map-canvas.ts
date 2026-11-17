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
import { ClimateResult } from '../../domain/climate/climate-model';
import { CellPoint } from '../../domain/terrain/brushes';
import { TerrainRaster } from '../../rendering/terrain-raster';
import { VintageBuilder, VintageRaster } from '../../rendering/vintage-raster';
import { cellToScreen, fitViewport, panBy, resize, screenToCell, Viewport, zoomAt, zoomLimits } from '../../rendering/viewport';
import { loadView, saveView } from './view-memory';
import { drawWindOverlay } from '../../rendering/wind-overlay';
import { windFromDirection } from '../../domain/climate/wind';
import { drawLatitudeOverlay, LatitudeHandle, latitudeScreenY, PIN_HIT_TOLERANCE_PX, pinScreenY, tiltLines } from '../../rendering/latitude-overlay';
import { latitudeAtRow } from '../../domain/map/latitude';
import { canvasTextMeasure, drawLabels, drawLasso, drawZoneOutlines, labelAt, layoutLabels, PlacedLabel } from '../../rendering/label-layer';
import { simplifyPolyline } from '../../domain/features/polygon';
import { isZoneTemplate } from '../../domain/features/map-feature';
import { LABEL_STYLE } from '../../rendering/style/label-style';

const WHEEL_ZOOM_SPEED = 0.0015;
const VIEW_SAVE_DEBOUNCE_MS = 400;
/** Outside the map: same parchment as the frame. */
const BACKGROUND = '#e2cfa6';
/** Below this pointer travel a press is a click (place / select), above it a drag (move / pan). */
const CLICK_SLOP_PX = 4;
/** Lasso: a new point every 3 px of pointer travel, simplified to 1.5 px on release. */
const LASSO_STEP_PX = 3;
const LASSO_TOLERANCE_PX = 1.5;

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
      (pointerleave)="hover.set(null); hoveredPin.set(null)"
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
        @if (info.temperatureC !== null) {
          <span class="chip" title="Température à la saison affichée">{{ info.temperatureC | number: '1.0-0' }} °C</span>
        }
        @if (info.precipitationMm !== null) {
          <span class="chip" title="Précipitations (pluie ou neige) du mois affiché">{{ info.precipitationMm | number: '1.0-0' }} mm/mois</span>
        }
        @if (info.snowCm !== null && info.snowCm >= 1) {
          <span class="chip" title="Épaisseur du manteau neigeux">neige {{ info.snowCm >= 255 ? '≥ 255' : (info.snowCm | number: '1.0-0') }} cm</span>
        }
        @if (info.windLabel) {
          <span class="chip" title="Vent dominant (d’où il vient) et sa vitesse">vent {{ info.windLabel }}</span>
        }
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
  /** Rendered view, rebuilt when the map or its revision changes. */
  private vintage: { raster: VintageRaster; map: WorldMap; revision: number; climate: ClimateResult | null } | null = null;
  private vintageRequested: { map: WorldMap; revision: number; climate: ClimateResult | null } | null = null;
  private readonly vintageBuilder = new VintageBuilder();
  private frameRequest: number | null = null;
  private panning: { pointerId: number; lastX: number; lastY: number } | null = null;
  private viewSaveTimer: ReturnType<typeof setTimeout> | null = null;
  /** Latitude pin being dragged, or hovered (for the highlight and the cursor). */
  private pinDrag: { pointerId: number; index: LatitudeHandle } | null = null;
  protected readonly hoveredPin = signal<LatitudeHandle | null>(null);
  /** Names drawn in the last frame, for clicks (what you see is what you can click). */
  private placedLabels: PlacedLabel[] = [];
  /** Press in the Names section: on a name (drag = move it) or on empty map (click = new place, drag = pan). */
  private namesGesture: { pointerId: number; startX: number; startY: number; lastX: number; lastY: number; hitId: string | null; moved: boolean } | null = null;
  private readonly draggedFeature = signal<{ id: string; xKm: number; yKm: number } | null>(null);
  protected readonly hoveringLabel = signal(false);
  /** Zone outline being drawn (screen px, flat [x0, y0, …]). */
  private readonly lasso = signal<readonly number[] | null>(null);

  protected readonly cursor = computed(() => {
    if (this.hoveredPin() !== null) return 'ns-resize';
    if (this.facade.namesEditing()) return this.hoveringLabel() ? 'move' : isZoneTemplate(this.facade.newPlaceTemplate()) ? 'crosshair' : 'copy';
    return this.facade.effectiveTool() === 'pan' ? 'grab' : 'crosshair';
  });

  protected readonly hoverInfo = computed(() => {
    this.facade.renderRevision(); // altitude changes while painting
    const point = this.hover();
    const map = this.facade.renderMap();
    if (!point || !map) return null;
    const altitudeM = this.facade.altitudeAt(point);
    if (altitudeM === null) return null;
    const km = map.settings.baseCellKm;
    this.facade.yearPhase();
    this.facade.hasClimate();
    const wind = this.facade.windAt(point);
    const windLabel = wind ? `${windFromDirection(wind)} ${Math.hypot(wind.uMs, wind.vMs).toFixed(0)} m/s` : null;
    return { xKm: point.x * km, yKm: point.y * km, altitudeM, temperatureC: this.facade.temperatureAt(point), precipitationMm: this.facade.precipitationAt(point), snowCm: this.facade.snowAt(point), windLabel };
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
      this.facade.rendered();
      this.facade.renderClimate();
      this.viewport();
      this.hover();
      this.facade.brush();
      this.facade.effectiveTool();
      this.facade.climateOverlay();
      this.facade.windOverlay();
      this.facade.latitudePins();
      this.facade.displayedLatitudes();
      this.facade.displayedTilt();
      this.hoveredPin();
      this.facade.features();
      this.facade.selectedFeatureId();
      this.draggedFeature();
      this.lasso();
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
      // Canvas text does not wait for web fonts: redraw once the map font is there.
      void document.fonts.load(`16px ${LABEL_STYLE.font}`).then(() => this.requestDraw());
      const observer = new ResizeObserver(() => this.onResize());
      observer.observe(this.host.nativeElement);
      this.destroyRef.onDestroy(() => observer.disconnect());
    });

    this.destroyRef.onDestroy(() => {
      if (this.frameRequest !== null) cancelAnimationFrame(this.frameRequest);
      this.vintageBuilder.dispose();
      if (this.viewSaveTimer !== null) clearTimeout(this.viewSaveTimer);
    });
  }

  // --- Input ---

  protected onPointerDown(event: PointerEvent): void {
    const vp = this.viewport();
    if (!vp) return;
    this.canvasRef().nativeElement.setPointerCapture(event.pointerId);
    const pin = event.button === 0 ? this.pinAt(vp, event.offsetY) : null;
    if (pin !== null) {
      this.pinDrag = { pointerId: event.pointerId, index: pin };
      return;
    }
    if (event.button === 0 && this.facade.namesEditing()) {
      // Commit a name being typed before the selection changes.
      if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
      const hit = labelAt(this.placedLabels, event.offsetX, event.offsetY);
      if (hit) this.facade.selectFeature(hit.feature.id);
      else if (isZoneTemplate(this.facade.newPlaceTemplate())) this.lasso.set([event.offsetX, event.offsetY]);
      this.namesGesture = { pointerId: event.pointerId, startX: event.offsetX, startY: event.offsetY, lastX: event.offsetX, lastY: event.offsetY, hitId: hit?.feature.id ?? null, moved: false };
      return;
    }
    // Middle or right button always pans; left button uses the active tool.
    if (event.button !== 0 || this.facade.effectiveTool() === 'pan') {
      this.panning = { pointerId: event.pointerId, lastX: event.offsetX, lastY: event.offsetY };
      return;
    }
    if (event.button === 0) this.facade.pointerDown(screenToCell(vp, event.offsetX, event.offsetY));
  }

  protected onPointerMove(event: PointerEvent): void {
    const vp = this.viewport();
    if (!vp) return;
    if (this.pinDrag?.pointerId === event.pointerId) {
      const yCell = screenToCell(vp, event.offsetX, event.offsetY).y;
      const handle = this.pinDrag.index;
      if (handle === 0 || handle === 1) {
        this.facade.moveLatitudePin(handle, yCell);
      } else {
        // Tropic at ±tilt, polar circle at ±(90° − tilt): the latitude under the pointer gives the tilt.
        const edges = this.facade.displayedLatitudes();
        const map = this.facade.renderMap();
        if (edges && map) {
          const lat = Math.abs(latitudeAtRow(edges, map.terrain.baseAltitudeM.heightCells, yCell));
          this.facade.previewTilt(handle === 'tropic' ? lat : 90 - lat);
        }
      }
      return;
    }
    const names = this.namesGesture;
    if (names?.pointerId === event.pointerId) {
      names.moved ||= Math.hypot(event.offsetX - names.startX, event.offsetY - names.startY) > CLICK_SLOP_PX;
      const lasso = this.lasso();
      if (lasso) {
        const n = lasso.length;
        if (Math.hypot(event.offsetX - lasso[n - 2], event.offsetY - lasso[n - 1]) >= LASSO_STEP_PX) {
          this.lasso.set([...lasso, event.offsetX, event.offsetY]);
        }
      } else if (names.moved && names.hitId) {
        const map = this.facade.renderMap();
        const cell = screenToCell(vp, event.offsetX, event.offsetY);
        if (map) this.draggedFeature.set({ id: names.hitId, xKm: cell.x * map.settings.baseCellKm, yKm: cell.y * map.settings.baseCellKm });
      } else if (names.moved) {
        this.viewport.set(panBy(vp, event.offsetX - names.lastX, event.offsetY - names.lastY));
      }
      names.lastX = event.offsetX;
      names.lastY = event.offsetY;
      return;
    }
    if (this.facade.namesEditing()) this.hoveringLabel.set(labelAt(this.placedLabels, event.offsetX, event.offsetY) !== null);
    if (!this.panning) this.hoveredPin.set(this.pinAt(vp, event.offsetY));
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
    if (this.pinDrag?.pointerId === event.pointerId) {
      const handle = this.pinDrag.index;
      this.pinDrag = null;
      if (handle === 0 || handle === 1) this.facade.commitLatitudes();
      else this.facade.commitTiltPreview();
      return;
    }
    if (this.panning?.pointerId === event.pointerId) {
      this.panning = null;
      return;
    }
    const names = this.namesGesture;
    if (names?.pointerId === event.pointerId) {
      this.namesGesture = null;
      const dragged = this.draggedFeature();
      this.draggedFeature.set(null);
      const lasso = this.lasso();
      this.lasso.set(null);
      const vp = this.viewport();
      if (lasso) {
        if (vp && event.type === 'pointerup') {
          const outline = simplifyPolyline(lasso, LASSO_TOLERANCE_PX);
          const cells: number[] = [];
          for (let i = 0; i < outline.length; i += 2) {
            const c = screenToCell(vp, outline[i], outline[i + 1]);
            cells.push(c.x, c.y);
          }
          this.facade.addZone(cells);
        }
      } else if (dragged && event.type === 'pointerup') this.facade.moveFeature(dragged.id, dragged.xKm, dragged.yKm);
      else if (!names.moved && !names.hitId && vp && event.type === 'pointerup') {
        this.facade.addFeatureAt(screenToCell(vp, event.offsetX, event.offsetY));
      }
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

    if (this.facade.rendered()) {
      this.drawRendered(ctx, vp, map);
      this.drawNames(ctx, vp, map);
      return; // dirty rects stay queued for the design raster
    }

    const dirty = this.facade.takeDirtyRects();
    // Season or view change: every pixel's colour changes.
    if (this.raster.setClimate(this.facade.climateOverlay())) dirty.push(this.raster.fullRect());
    this.raster.update(dirty);
    this.raster.draw(ctx, vp);
    const wind = this.facade.windOverlay();
    if (wind) drawWindOverlay(ctx, vp, wind.result, wind.yearPhase);
    this.drawBrushCursor(ctx, vp, map);
    this.drawNames(ctx, vp, map);

    const pins = this.facade.latitudePins();
    const edges = this.facade.displayedLatitudes();
    if (pins && edges) {
      const grid = map.terrain.baseAltitudeM;
      drawLatitudeOverlay(ctx, vp, {
        ...edges,
        axialTiltDeg: this.facade.displayedTilt() ?? map.settings.axialTiltDeg,
        widthCells: grid.widthCells,
        heightCells: grid.heightCells,
        pins,
        active: this.pinDrag?.index ?? this.hoveredPin(),
      });
    }
  }

  private drawRendered(ctx: CanvasRenderingContext2D, vp: Viewport, map: WorldMap): void {
    const revision = this.facade.renderRevision();
    const climate = this.facade.renderClimate();
    const upToDate = (v: { map: WorldMap; revision: number; climate: ClimateResult | null } | null) =>
      v?.map === map && v.revision === revision && v.climate === climate;
    if (!upToDate(this.vintage) && !upToDate(this.vintageRequested)) {
      this.vintageRequested = { map, revision, climate };
      this.vintageBuilder.build(map, climate).then(
        (raster) => {
          this.vintage = { raster, map, revision, climate };
          this.requestDraw();
        },
        (error: unknown) => console.error('Rendu de la carte impossible', error),
      );
    }
    // While (re)building, keep showing the previous rendering of the same map.
    if (this.vintage?.map === map) {
      this.vintage.raster.draw(ctx, vp);
    } else {
      ctx.fillStyle = 'rgb(31 26 19 / 0.7)';
      ctx.font = '600 13px "Space Grotesk", system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('Préparation du rendu…', vp.widthPx / 2, vp.heightPx / 2);
    }
  }

  private drawNames(ctx: CanvasRenderingContext2D, vp: Viewport, map: WorldMap): void {
    const selectedId = this.facade.selectedFeatureId();
    if (this.facade.namesEditing()) drawZoneOutlines(ctx, vp, map.settings.baseCellKm, this.facade.features(), selectedId);
    this.placedLabels = layoutLabels(this.facade.features(), vp, map.settings.baseCellKm, canvasTextMeasure(ctx), {
      selectedId,
      dragged: this.draggedFeature(),
    });
    drawLabels(ctx, this.placedLabels, selectedId);
    const lasso = this.lasso();
    if (lasso) drawLasso(ctx, lasso);
  }

  /** Which ruler handle (pin, tropic, polar circle) is within reach of screen row `sy`; pins win ties. */
  private pinAt(vp: Viewport, sy: number): LatitudeHandle | null {
    const pins = this.facade.latitudePins();
    const edges = this.facade.displayedLatitudes();
    const tilt = this.facade.displayedTilt();
    const map = this.facade.renderMap();
    if (!pins || !edges || tilt === null || !map) return null;
    const candidates: [LatitudeHandle, number][] = [
      [0, pinScreenY(vp, pins[0])],
      [1, pinScreenY(vp, pins[1])],
      ...tiltLines(tilt).map((line): [LatitudeHandle, number] => [
        line.kind,
        latitudeScreenY(vp, { ...edges, heightCells: map.terrain.baseAltitudeM.heightCells }, line.latitudeDeg),
      ]),
    ];
    let best: LatitudeHandle | null = null;
    let bestDistance = PIN_HIT_TOLERANCE_PX;
    for (const [handle, y] of candidates) {
      const d = Math.abs(y - sy);
      if (d <= bestDistance) {
        if (best !== null && (best === 0 || best === 1) && d === bestDistance) continue;
        best = handle;
        bestDistance = d;
      }
    }
    return best;
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
    if (!point || this.facade.effectiveTool() === 'pan') return;
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
