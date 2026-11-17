import { detectSketchMode, SketchImage, SketchMode, SketchPoint, sketchSeaMask, sketchToAltitude } from '../domain/terrain/sketch';
import { computed, inject, Injectable, signal } from '@angular/core';
import { Command, MapChange } from '../domain/commands/command';
import { CommandHistory } from '../domain/commands/command-history';
import { RenameMapCommand } from '../domain/commands/rename-map-command';
import { FeatureEditCommand } from '../domain/commands/feature-edit-command';
import {
  createFeature,
  FeatureTemplate,
  ImportanceRank,
  isZoneTemplate,
  MapFeature,
  MAX_FEATURE_NAME_LENGTH,
  MAX_OUTLINE_POINTS,
  MIN_OUTLINE_POINTS,
} from '../domain/features/map-feature';
import { poleOfInaccessibility, ringArea, translateRing } from '../domain/features/polygon';
import { MapFactory } from '../domain/map/map-factory';
import { MapSummary } from '../domain/map/map-repository';
import { BeyondEdge, BeyondEdges, gridSizeCells, MapSettings, validateMapSettings } from '../domain/map/map-settings';
import { LatitudePin, latitudeAtRow, latitudesFromPins } from '../domain/map/latitude';
import { UpdateSettingsCommand } from '../domain/commands/update-settings-command';
import { WorldMap } from '../domain/map/world-map';
import { MapFormatError } from '../domain/serialization/map-document';
import { CellPoint } from '../domain/terrain/brushes';
import { CellRect, getCell, isInside } from '../domain/terrain/tiled-grid';
import { AutoSave } from './auto-save';
import { ClimateService } from './climate';
import { SampleMaps } from './sample-maps';
import { windAt, WindVector } from '../domain/climate/wind';
import { ClimateResult, precipitationAtMm, snowDepthAtCm, temperatureAtC } from '../domain/climate/climate-model';
import { MapStore } from './map-store';
import { MAP_FILE_CODEC, MAP_REPOSITORY } from './ports';
import { EditorTool, ToolContext } from './tools/editor-tool';
import {
  BrushOptions,
  LowerTerrainTool,
  RaiseTerrainTool,
  SmoothTerrainTool,
} from './tools/terrain-brush-tools';

/** What the map shows: the editing relief view, or a climate field. */
export type ViewMode = 'relief' | 'landscape' | 'temperature' | 'precipitation' | 'wind';

/** What the renderer needs to colour by a climate field. */
export interface ClimateOverlay {
  readonly result: ClimateResult;
  readonly yearPhase: number;
  /** Wind view draws its arrows over landscape colours. */
  readonly colouring: 'landscape' | 'temperature' | 'precipitation';
}

/** 'pan' is a view-only mode handled by the canvas; the others are EditorTools. */
export type ToolId = 'pan' | 'raise' | 'lower' | 'smooth';

export const TOOL_LABELS: Record<ToolId, string> = {
  pan: 'Déplacer',
  raise: 'Élever',
  lower: 'Abaisser',
  smooth: 'Lisser',
};

/** Airbrush rate while the pointer is held (dabs per second). */
export const HOLD_DABS_PER_SECOND = 15;

export const BRUSH_LIMITS = { minRadiusKm: 1, maxRadiusKm: 200 } as const;

export interface SketchMapRequest {
  readonly name: string;
  readonly settings: MapSettings;
  readonly image: SketchImage;
  readonly sea: SketchPoint;
  readonly land: SketchPoint;
}

export interface ExportedFile {
  readonly blob: Blob;
  readonly fileName: string;
}

/** Single entry point for the UI: components never touch the store, commands, storage or workers directly. */
@Injectable({ providedIn: 'root' })
export class EditorFacade {
  private readonly store = inject(MapStore);
  private readonly repository = inject(MAP_REPOSITORY);
  private readonly fileCodec = inject(MAP_FILE_CODEC);
  private readonly autoSave = inject(AutoSave);
  private readonly climate = inject(ClimateService);
  private readonly samples = inject(SampleMaps);
  private readonly viewModeState = signal<ViewMode>('relief');
  /** Design view (editor colours) or rendered "old map" view. */
  private readonly renderedState = signal(false);
  /** Year phase t ∈ [0, 1[ (0 = 1st January) shown by the season slider. */
  private readonly yearPhaseState = signal(0.54);
  private readonly history = new CommandHistory();
  /** CommandHistory is plain TS; this counter makes its state observable. */
  private readonly historyRevision = signal(0);
  private readonly savedMapsState = signal<readonly MapSummary[]>([]);
  private readonly errorState = signal<string | null>(null);
  private readonly brushState = signal<BrushOptions>({ radiusKm: 25, strength: 0.5 });
  private readonly activeToolState = signal<ToolId>('raise');
  /** False while a non-editing panel (maps, climate) is shown: the map can only be panned. */
  private readonly editingEnabledState = signal(true);
  /** Axial tilt being dragged on the map (tropic / polar circle), before it is committed. */
  private readonly tiltPreviewState = signal<number | null>(null);
  /** Two pins while the latitude ruler is being set up; null otherwise. */
  private readonly latitudePinsState = signal<readonly [LatitudePin, LatitudePin] | null>(null);
  /** Names section open: clicks on the map place and select names. */
  private readonly namesEditingState = signal(false);
  private readonly selectedFeatureIdState = signal<string | null>(null);
  private readonly newPlaceTemplateState = signal<FeatureTemplate>({ kind: 'settlement', size: 'village' });
  private readonly tools: Record<Exclude<ToolId, 'pan'>, EditorTool> = {
    raise: new RaiseTerrainTool(() => this.brushState()),
    lower: new LowerTerrainTool(() => this.brushState()),
    smooth: new SmoothTerrainTool(() => this.brushState()),
  };
  /** Tool of the gesture in progress (pointer down), if any. */
  private gestureTool: EditorTool | null = null;
  private holdTimer: ReturnType<typeof setInterval> | null = null;

  readonly hasMap = computed(() => this.store.map() !== null);
  readonly currentMapId = computed(() => this.store.map()?.id ?? null);
  readonly mapName = this.store.mapName;
  readonly saveStatus = this.autoSave.status.asReadonly();
  readonly savedMaps = this.savedMapsState.asReadonly();
  readonly error = this.errorState.asReadonly();
  readonly fileExtension = this.fileCodec.fileExtension;
  readonly activeTool = this.activeToolState.asReadonly();
  readonly namesEditing = this.namesEditingState.asReadonly();
  readonly selectedFeatureId = this.selectedFeatureIdState.asReadonly();
  readonly newPlaceTemplate = this.newPlaceTemplateState.asReadonly();
  /** A copy: the map's array is mutated in place, a new reference lets `computed`s see the change. */
  readonly features = computed<readonly MapFeature[]>(() => {
    this.store.revision();
    return [...(this.store.map()?.features ?? [])];
  });
  readonly selectedFeature = computed(() => this.features().find((f) => f.id === this.selectedFeatureIdState()) ?? null);
  readonly latitudePins = this.latitudePinsState.asReadonly();
  readonly settings = computed(() => {
    this.store.revision();
    return this.store.map()?.settings ?? null;
  });
  /** Tilt shown by the ruler: the one being dragged, else the map's own. */
  readonly displayedTilt = computed(() => this.tiltPreviewState() ?? this.settings()?.axialTiltDeg ?? null);
  /** Edges implied by the pins being dragged (preview), else the map's own. */
  readonly displayedLatitudes = computed(() => {
    const map = this.store.map();
    const settings = this.settings();
    if (!map || !settings) return null;
    const pins = this.latitudePinsState();
    const fromPins = pins ? latitudesFromPins(pins[0], pins[1], map.terrain.baseAltitudeM.heightCells) : null;
    return fromPins ?? { latitudeTopDeg: settings.latitudeTopDeg, latitudeBottomDeg: settings.latitudeBottomDeg };
  });
  /** The tool that actually handles the pointer: 'pan' whenever editing is disabled. */
  readonly effectiveTool = computed<ToolId>(() => (this.editingEnabledState() ? this.activeToolState() : 'pan'));
  readonly brush = this.brushState.asReadonly();

  readonly viewMode = this.viewModeState.asReadonly();
  readonly rendered = this.renderedState.asReadonly();
  readonly yearPhase = this.yearPhaseState.asReadonly();
  readonly climateStatus = this.climate.status;
  readonly climateDurationMs = this.climate.lastDurationMs;
  readonly hasClimate = computed(() => this.climate.result() !== null);
  /** Wind arrows to draw over the relief colours; null outside the wind view. */
  readonly windOverlay = computed<ClimateOverlay | null>(() => {
    const result = this.climate.result();
    return this.viewModeState() === 'wind' && result ? { result, yearPhase: this.yearPhaseState(), colouring: 'landscape' } : null;
  });

  /** Null in relief view or before the first climate result. */
  readonly climateOverlay = computed<ClimateOverlay | null>(() => {
    const result = this.climate.result();
    const mode = this.viewModeState();
    if (!result || mode === 'relief') return null;
    return { result, yearPhase: this.yearPhaseState(), colouring: mode === 'wind' ? 'landscape' : mode };
  });

  // Read-only access for the renderer: rendering reads the model, never writes it.
  readonly renderMap = this.store.map;
  readonly renderRevision = this.store.revision;
  readonly renderClimate = this.climate.result;
  /** Rivers (null until the first climate run of the map). */
  readonly renderHydrology = this.climate.hydrology;
  readonly undoLabel = computed(() => {
    this.historyRevision();
    return this.history.undoLabel;
  });
  readonly redoLabel = computed(() => {
    this.historyRevision();
    return this.history.redoLabel;
  });

  // --- Map lifecycle ---

  /**
   * Installs bundled sample maps (first launch / new sample version), then
   * opens `preferredMapId` if it still exists (e.g. from the URL), else the
   * most recently edited map.
   */
  async startUp(preferredMapId?: string): Promise<void> {
    await this.samples.install();
    await this.restoreLastSession(preferredMapId);
  }

  async restoreLastSession(preferredMapId?: string): Promise<void> {
    await this.run(async () => {
      await this.refreshList();
      const maps = this.savedMapsState();
      const target = maps.find((m) => m.id === preferredMapId) ?? maps[0];
      if (target) await this.openLoaded(await this.repository.load(target.id));
    });
  }

  async createBlankMap(settings: MapSettings, name = 'Nouvelle carte'): Promise<void> {
    await this.run(async () => {
      const map = MapFactory.blank(settings, { id: crypto.randomUUID(), name, nowIso: new Date().toISOString() });
      await this.openLoaded(map);
      this.autoSave.markFullSave();
      await this.autoSave.flush();
      await this.refreshList();
    });
  }

  /** Land/sea classification of a drawing, for the import preview (1 = sea, 0 = land, 2 = unknown). */
  previewSketch(image: SketchImage, sea: SketchPoint, land: SketchPoint): { mask: Uint8Array; mode: SketchMode } {
    return { mask: sketchSeaMask(image, sea, land), mode: detectSketchMode(image, sea, land) };
  }

  /** New map whose relief is a first draft read from a drawing (no climate input: it is computed as usual). */
  async createMapFromSketch(request: SketchMapRequest): Promise<void> {
    await this.run(async () => {
      const { widthCells, heightCells } = gridSizeCells(request.settings);
      const mask = sketchSeaMask(request.image, request.sea, request.land);
      const altitudeM = sketchToAltitude(request.image, mask, request.sea, request.land, {
        widthCells,
        heightCells,
        cellKm: request.settings.baseCellKm,
        seaLevelM: request.settings.seaLevelM,
        seed: request.settings.seed,
      });
      const identity = { id: crypto.randomUUID(), name: request.name, nowIso: new Date().toISOString() };
      await this.openLoaded(MapFactory.fromAltitudes(request.settings, identity, altitudeM));
      this.autoSave.markFullSave();
      await this.autoSave.flush();
      await this.refreshList();
    });
  }

  async openMap(id: string): Promise<void> {
    if (id === this.currentMapId()) return;
    await this.run(async () => this.openLoaded(await this.repository.load(id)));
  }

  async duplicateMap(id: string): Promise<void> {
    await this.run(async () => {
      await this.autoSave.flush();
      const source = await this.repository.load(id);
      await this.repository.save(this.withNewIdentity(source, `${source.name} (copie)`), 'all');
      await this.refreshList();
    });
  }

  async deleteMap(id: string): Promise<void> {
    await this.run(async () => {
      if (id === this.currentMapId()) {
        await this.autoSave.flush();
        this.history.clear();
        this.historyRevision.update((r) => r + 1);
        this.store.setMap(null);
        this.climate.reset();
      }
      await this.repository.delete(id);
      await this.refreshList();
    });
  }

  /** Imported maps always get a new id: an import never overwrites a local map. */
  async importMapFile(file: Blob): Promise<void> {
    await this.run(async () => {
      const imported = await this.fileCodec.importMap(file);
      const map = this.withNewIdentity(imported, imported.name);
      await this.repository.save(map, 'all');
      await this.openLoaded(map);
      await this.refreshList();
    });
  }

  async exportCurrentMap(): Promise<ExportedFile | null> {
    const map = this.store.map();
    if (!map) return null;
    let result: ExportedFile | null = null;
    await this.run(async () => {
      result = { blob: await this.fileCodec.exportMap(map), fileName: this.fileCodec.fileNameFor(map) };
    });
    return result;
  }

  dismissError(): void {
    this.errorState.set(null);
  }

  // --- Rendering support ---

  takeDirtyRects(): CellRect[] {
    return this.store.takeDirtyRects();
  }

  /** Altitude under a point, for the status bar; null outside the map. */
  altitudeAt(point: CellPoint): number | null {
    const grid = this.store.map()?.terrain.baseAltitudeM;
    const x = Math.floor(point.x);
    const y = Math.floor(point.y);
    return grid && isInside(grid, x, y) ? getCell(grid, x, y) : null;
  }

  /** Temperature under a point at the current season, °C; null if unknown. */
  temperatureAt(point: CellPoint): number | null {
    const result = this.climate.result();
    if (!result) return null;
    const x = Math.floor(point.x);
    const y = Math.floor(point.y);
    if (x < 0 || y < 0 || x >= result.widthCells || y >= result.heightCells) return null;
    return temperatureAtC(result, y * result.widthCells + x, this.yearPhaseState());
  }

  /** Snow depth under a point at the current season, cm; null if unknown. */
  snowAt(point: CellPoint): number | null {
    const result = this.climate.result();
    if (!result) return null;
    const x = Math.floor(point.x);
    const y = Math.floor(point.y);
    if (x < 0 || y < 0 || x >= result.widthCells || y >= result.heightCells) return null;
    return snowDepthAtCm(result, y * result.widthCells + x, this.yearPhaseState());
  }

  /** Precipitation under a point at the current season, mm/month; null if unknown. */
  precipitationAt(point: CellPoint): number | null {
    const result = this.climate.result();
    if (!result || point.x < 0 || point.y < 0 || point.x >= result.widthCells || point.y >= result.heightCells) return null;
    return precipitationAtMm(result, point.x, point.y, this.yearPhaseState());
  }

  /** Mean annual river flow through a point, m³/s; null if unknown. */
  dischargeAt(point: CellPoint): number | null {
    const result = this.climate.hydrology();
    const x = Math.floor(point.x);
    const y = Math.floor(point.y);
    if (!result || x < 0 || y < 0 || x >= result.widthCells || y >= result.heightCells) return null;
    return result.dischargeM3s[y * result.widthCells + x];
  }

  /** Prevailing wind under a point at the current season; null if unknown. */
  windAt(point: CellPoint): WindVector | null {
    const result = this.climate.result();
    if (!result || point.x < 0 || point.y < 0 || point.x >= result.widthCells || point.y >= result.heightCells) return null;
    return windAt(result, point.x, point.y, this.yearPhaseState());
  }

  // --- Climate & view ---

  setRendered(rendered: boolean): void {
    this.renderedState.set(rendered);
  }

  setViewMode(mode: ViewMode): void {
    this.viewModeState.set(mode);
  }

  setYearPhase(phase: number): void {
    this.yearPhaseState.set(((phase % 1) + 1) % 1);
  }

  // --- Latitudes ---

  /** Shows the ruler with two pins at 1/4 and 3/4 of the height, at their current latitudes. */
  startLatitudeEditing(): void {
    const map = this.store.map();
    if (!map) return;
    const h = map.terrain.baseAltitudeM.heightCells;
    const pin = (y: number): LatitudePin => ({ yCell: y, latitudeDeg: round1(latitudeAtRow(map.settings, h, y)) });
    this.latitudePinsState.set([pin(h * 0.25), pin(h * 0.75)]);
  }

  stopLatitudeEditing(): void {
    this.latitudePinsState.set(null);
  }

  /** Live drag: moves the pin (preview only, no command yet). */
  moveLatitudePin(index: 0 | 1, yCell: number): void {
    const pins = this.latitudePinsState();
    const map = this.store.map();
    if (!pins || !map) return;
    const h = map.terrain.baseAltitudeM.heightCells;
    this.latitudePinsState.set(replacePin(pins, index, { ...pins[index], yCell: clamp(yCell, 0, h) }));
  }

  setLatitudePinValue(index: 0 | 1, latitudeDeg: number): void {
    const pins = this.latitudePinsState();
    if (!pins || !Number.isFinite(latitudeDeg)) return;
    this.latitudePinsState.set(replacePin(pins, index, { ...pins[index], latitudeDeg }));
    this.commitLatitudes();
  }

  /** Applies the pins to the map settings as one undoable command (then the climate recomputes). */
  commitLatitudes(): void {
    const pins = this.latitudePinsState();
    const map = this.store.map();
    if (!pins || !map) return;
    const edges = latitudesFromPins(pins[0], pins[1], map.terrain.baseAltitudeM.heightCells);
    if (!edges) {
      this.errorState.set('Les deux repères doivent être sur des lignes différentes.');
      return;
    }
    const patch = { latitudeTopDeg: round2(edges.latitudeTopDeg), latitudeBottomDeg: round2(edges.latitudeBottomDeg) };
    if (patch.latitudeTopDeg === map.settings.latitudeTopDeg && patch.latitudeBottomDeg === map.settings.latitudeBottomDeg) return;
    const errors = validateMapSettings({ ...map.settings, ...patch });
    if (errors.length > 0) {
      // Keep the pins as typed: with two pins, intermediate states are often
      // invalid; the change applies as soon as the pair becomes valid.
      this.errorState.set(errors.join(' '));
      return;
    }
    this.errorState.set(null);
    this.execute(new UpdateSettingsCommand('Régler les latitudes', patch));
  }

  /** Live drag of a tropic or polar circle: preview only. */
  previewTilt(axialTiltDeg: number): void {
    this.tiltPreviewState.set(Math.round(Math.min(MAX_TILT_DEG, Math.max(0, axialTiltDeg)) * 10) / 10);
  }

  commitTiltPreview(): void {
    const tilt = this.tiltPreviewState();
    this.tiltPreviewState.set(null);
    if (tilt !== null) this.updateClimateSettings({ axialTiltDeg: tilt });
  }

  // --- Planet settings ---

  /** Axial tilt, global temperature offset, what lies beyond the edges: one undoable command (then the climate recomputes). */
  updateClimateSettings(patch: Partial<Pick<MapSettings, 'axialTiltDeg' | 'globalTemperatureOffsetC' | 'beyondEdges'>>): void {
    const map = this.store.map();
    if (!map) return;
    const changed = (Object.keys(patch) as (keyof typeof patch)[]).some((k) => patch[k] !== undefined && patch[k] !== map.settings[k]);
    if (!changed) return;
    const errors = validateMapSettings({ ...map.settings, ...patch });
    if (errors.length > 0) {
      this.errorState.set(errors.join(' '));
      return;
    }
    this.errorState.set(null);
    const label =
      patch.axialTiltDeg !== undefined
        ? 'Régler l’inclinaison de l’axe'
        : patch.beyondEdges !== undefined
          ? 'Régler l’au-delà des bords'
          : 'Régler la température globale';
    this.execute(new UpdateSettingsCommand(label, patch));
  }

  /** Sets what lies beyond one edge of the map. */
  setBeyondEdge(side: keyof BeyondEdges, value: BeyondEdge): void {
    const edges = this.store.map()?.settings.beyondEdges;
    if (edges && edges[side] !== value) this.updateClimateSettings({ beyondEdges: { ...edges, [side]: value } });
  }

  // --- Tools ---

  selectTool(id: ToolId): void {
    if (!this.gestureTool) this.activeToolState.set(id);
  }

  /** The relief tool is remembered and comes back when editing is re-enabled. */
  setEditingEnabled(enabled: boolean): void {
    if (!this.gestureTool) this.editingEnabledState.set(enabled);
  }

  setBrush(options: Partial<BrushOptions>): void {
    this.brushState.update((b) => ({
      radiusKm: clamp(options.radiusKm ?? b.radiusKm, BRUSH_LIMITS.minRadiusKm, BRUSH_LIMITS.maxRadiusKm),
      strength: clamp(options.strength ?? b.strength, 0, 1),
    }));
  }

  pointerDown(point: CellPoint): void {
    const id = this.effectiveTool();
    const ctx = this.toolContext();
    if (id === 'pan' || !ctx || this.gestureTool) return;
    const tool = this.tools[id];
    this.gestureTool = tool;
    tool.begin(ctx, point);
    if (tool.hold) {
      this.holdTimer = setInterval(() => {
        const current = this.toolContext();
        if (current) tool.hold?.(current);
      }, 1000 / HOLD_DABS_PER_SECOND);
    }
  }

  pointerMove(point: CellPoint): void {
    const ctx = this.toolContext();
    if (this.gestureTool && ctx) this.gestureTool.move(ctx, point);
  }

  pointerUp(): void {
    const ctx = this.toolContext();
    const tool = this.gestureTool;
    this.gestureTool = null;
    if (this.holdTimer !== null) clearInterval(this.holdTimer);
    this.holdTimer = null;
    if (!tool || !ctx) return;
    const result = tool.end(ctx);
    if (!result) return;
    // Already applied (and redrawn) live: record it without executing it again.
    this.history.record(result.command);
    this.store.touchMap();
    this.autoSave.markChanged(result.change.terrainTiles, result.change.metadata);
    this.climate.invalidate();
    this.historyRevision.update((r) => r + 1);
  }

  // --- Names ---

  setNamesEditing(enabled: boolean): void {
    this.namesEditingState.set(enabled);
    if (!enabled) this.selectedFeatureIdState.set(null);
  }

  setNewPlaceTemplate(template: FeatureTemplate): void {
    this.newPlaceTemplateState.set(template);
  }

  selectFeature(id: string | null): void {
    this.selectedFeatureIdState.set(id);
  }

  /** New place of the current template at `point`, selected so that its name can be typed right away. */
  addFeatureAt(point: CellPoint): void {
    const map = this.store.map();
    if (!map || !this.namesEditingState() || isZoneTemplate(this.newPlaceTemplateState()) || !isInside(map.terrain.baseAltitudeM, Math.floor(point.x), Math.floor(point.y))) return;
    const km = map.settings.baseCellKm;
    const feature = createFeature(this.newPlaceTemplateState(), crypto.randomUUID(), '', round2(point.x * km), round2(point.y * km));
    this.execute(new FeatureEditCommand('Ajouter un lieu', null, feature));
    this.selectedFeatureIdState.set(feature.id);
  }

  /**
   * New zone of the current (zone) template from a lasso outline in cell
   * coordinates (flat [x0, y0, …], already simplified by the canvas).
   * Too small or degenerate outlines are ignored.
   */
  addZone(outlineCells: readonly number[]): void {
    const map = this.store.map();
    const template = this.newPlaceTemplateState();
    const points = outlineCells.length / 2;
    if (!map || !this.namesEditingState() || !isZoneTemplate(template)) return;
    if (points < MIN_OUTLINE_POINTS || points > MAX_OUTLINE_POINTS) return;
    const km = map.settings.baseCellKm;
    const outlineKm = outlineCells.map((v) => round2(v * km));
    if (ringArea(outlineKm) < MIN_ZONE_AREA_CELLS * km * km) return;
    const pole = poleOfInaccessibility(outlineKm, km / 4);
    const feature = createFeature(template, crypto.randomUUID(), '', round2(pole.x), round2(pole.y), outlineKm);
    this.execute(new FeatureEditCommand('Dessiner une zone', null, feature));
    this.selectedFeatureIdState.set(feature.id);
  }

  renameFeature(id: string, name: string): void {
    const trimmed = name.trim().slice(0, MAX_FEATURE_NAME_LENGTH);
    this.replaceFeature(id, 'Nommer un lieu', (f) => (f.name === trimmed ? f : { ...f, name: trimmed }));
  }

  setFeatureRank(id: string, rank: ImportanceRank): void {
    this.replaceFeature(id, 'Changer l’importance d’un lieu', (f) => (f.rank === rank ? f : { ...f, rank }));
  }

  /** Changes the type; the importance follows the new type's default. */
  setFeatureTemplate(id: string, template: FeatureTemplate): void {
    this.replaceFeature(id, 'Changer le type d’un lieu', (f) =>
      isZoneTemplate(template) !== (f.kind === 'region') ? f : createFeature(template, f.id, f.name, f.xKm, f.yKm, f.kind === 'region' ? f.outlineKm : []),
    );
  }

  moveFeature(id: string, xKm: number, yKm: number): void {
    this.replaceFeature(id, 'Déplacer un lieu', (f): MapFeature => {
      const x = round2(xKm);
      const y = round2(yKm);
      if (f.kind !== 'region') return { ...f, xKm: x, yKm: y };
      // A zone moves with its name.
      return { ...f, xKm: x, yKm: y, outlineKm: translateRing(f.outlineKm, x - f.xKm, y - f.yKm).map(round2) };
    });
  }

  removeFeature(id: string): void {
    const feature = this.features().find((f) => f.id === id);
    if (!feature) return;
    this.execute(new FeatureEditCommand('Supprimer un lieu', feature, null));
    if (this.selectedFeatureIdState() === id) this.selectedFeatureIdState.set(null);
  }

  private replaceFeature(id: string, label: string, change: (feature: MapFeature) => MapFeature): void {
    const before = this.features().find((f) => f.id === id);
    if (!before) return;
    const after = change(before);
    if (after !== before && JSON.stringify(after) !== JSON.stringify(before)) this.execute(new FeatureEditCommand(label, before, after));
  }

  // --- Editing ---

  renameMap(name: string): void {
    const trimmed = name.trim();
    if (trimmed === '' || trimmed === this.store.mapName()) return;
    this.execute(new RenameMapCommand(trimmed));
  }

  undo(): void {
    if (this.gestureTool) return; // never undo in the middle of a stroke
    const map = this.store.map();
    if (map) this.afterHistoryOp(this.history.undo(map));
  }

  redo(): void {
    if (this.gestureTool) return;
    const map = this.store.map();
    if (map) this.afterHistoryOp(this.history.redo(map));
  }

  private execute(command: Command): void {
    const map = this.store.map();
    if (!map) return;
    this.afterHistoryOp(this.history.execute(command, map));
  }

  private afterHistoryOp(change: MapChange | null): void {
    if (!change) return;
    this.store.applyChange(change);
    this.autoSave.markChanged(change.terrainTiles, change.metadata);
    if (change.terrainTiles.length > 0) this.climate.invalidate();
    if (change.settings) {
      this.climate.invalidate(0);
      if (this.latitudePinsState()) this.refreshPinsFromSettings();
    }
    this.historyRevision.update((r) => r + 1);
    if (change.metadata) void this.refreshList();
  }

  // --- Helpers ---

  /** After undo/redo: keep the pins' rows, re-read their latitudes from the settings. */
  private refreshPinsFromSettings(): void {
    const pins = this.latitudePinsState();
    const map = this.store.map();
    if (!pins || !map) return;
    const h = map.terrain.baseAltitudeM.heightCells;
    const at = (p: LatitudePin): LatitudePin => ({ ...p, latitudeDeg: round1(latitudeAtRow(map.settings, h, p.yCell)) });
    this.latitudePinsState.set([at(pins[0]), at(pins[1])]);
  }

  private toolContext(): ToolContext | null {
    const map = this.store.map();
    return map ? { map, markTerrainDirty: (rect) => this.store.markTerrainDirty(rect) } : null;
  }

  private async openLoaded(map: WorldMap): Promise<void> {
    await this.autoSave.flush(); // never lose the previous map's pending edits
    this.history.clear();
    this.historyRevision.update((r) => r + 1);
    this.store.setMap(map);
    this.latitudePinsState.set(null);
    this.climate.reset();
    this.climate.invalidate(0);
  }

  private async refreshList(): Promise<void> {
    this.savedMapsState.set(await this.repository.list());
  }

  /** Safe only on a map object we own exclusively (freshly loaded/imported): grids are shared, not copied. */
  private withNewIdentity(map: WorldMap, name: string): WorldMap {
    const now = new Date().toISOString();
    return { ...map, id: crypto.randomUUID(), name, createdAt: now, updatedAt: now };
  }

  /** Turns failures into a UI message; nothing is overwritten on error. */
  private async run(action: () => Promise<void>): Promise<void> {
    this.errorState.set(null);
    try {
      await action();
    } catch (error) {
      console.error(error);
      this.errorState.set(error instanceof MapFormatError ? error.message : 'Une erreur inattendue est survenue.');
    }
  }
}

/** Smallest zone worth naming (cells²): below, it was surely a slip of the mouse. */
const MIN_ZONE_AREA_CELLS = 4;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** Beyond ~60° the "tropics" pass the polar circles: seasons become extreme and the model leaves its calibration. */
export const MAX_TILT_DEG = 60;

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function replacePin(
  pins: readonly [LatitudePin, LatitudePin],
  index: 0 | 1,
  pin: LatitudePin,
): readonly [LatitudePin, LatitudePin] {
  return index === 0 ? [pin, pins[1]] : [pins[0], pin];
}
