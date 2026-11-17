import { computed, inject, Injectable, signal } from '@angular/core';
import { Command, MapChange } from '../domain/commands/command';
import { CommandHistory } from '../domain/commands/command-history';
import { RenameMapCommand } from '../domain/commands/rename-map-command';
import { MapFactory } from '../domain/map/map-factory';
import { MapSummary } from '../domain/map/map-repository';
import { MapSettings } from '../domain/map/map-settings';
import { WorldMap } from '../domain/map/world-map';
import { MapFormatError } from '../domain/serialization/map-document';
import { CellPoint } from '../domain/terrain/brushes';
import { CellRect, getCell, isInside } from '../domain/terrain/tiled-grid';
import { AutoSave } from './auto-save';
import { ClimateService } from './climate';
import { ClimateResult, temperatureAtC } from '../domain/climate/climate-model';
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
export type ViewMode = 'relief' | 'temperature';

/** What the renderer needs to colour by temperature. */
export interface ClimateOverlay {
  readonly result: ClimateResult;
  readonly yearPhase: number;
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
  private readonly viewModeState = signal<ViewMode>('relief');
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
  /** The tool that actually handles the pointer: 'pan' whenever editing is disabled. */
  readonly effectiveTool = computed<ToolId>(() => (this.editingEnabledState() ? this.activeToolState() : 'pan'));
  readonly brush = this.brushState.asReadonly();

  readonly viewMode = this.viewModeState.asReadonly();
  readonly yearPhase = this.yearPhaseState.asReadonly();
  readonly climateStatus = this.climate.status;
  readonly climateDurationMs = this.climate.lastDurationMs;
  readonly hasClimate = computed(() => this.climate.result() !== null);
  /** Null in relief view or before the first climate result. */
  readonly climateOverlay = computed<ClimateOverlay | null>(() => {
    const result = this.climate.result();
    return this.viewModeState() === 'temperature' && result ? { result, yearPhase: this.yearPhaseState() } : null;
  });

  // Read-only access for the renderer: rendering reads the model, never writes it.
  readonly renderMap = this.store.map;
  readonly renderRevision = this.store.revision;
  readonly undoLabel = computed(() => {
    this.historyRevision();
    return this.history.undoLabel;
  });
  readonly redoLabel = computed(() => {
    this.historyRevision();
    return this.history.redoLabel;
  });

  // --- Map lifecycle ---

  /** Opens the most recently edited local map, if any. */
  async restoreLastSession(): Promise<void> {
    await this.run(async () => {
      await this.refreshList();
      const latest = this.savedMapsState()[0];
      if (latest) await this.openLoaded(await this.repository.load(latest.id));
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

  // --- Climate & view ---

  setViewMode(mode: ViewMode): void {
    this.viewModeState.set(mode);
  }

  setYearPhase(phase: number): void {
    this.yearPhaseState.set(((phase % 1) + 1) % 1);
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
    this.historyRevision.update((r) => r + 1);
    if (change.metadata) void this.refreshList();
  }

  // --- Helpers ---

  private toolContext(): ToolContext | null {
    const map = this.store.map();
    return map ? { map, markTerrainDirty: (rect) => this.store.markTerrainDirty(rect) } : null;
  }

  private async openLoaded(map: WorldMap): Promise<void> {
    await this.autoSave.flush(); // never lose the previous map's pending edits
    this.history.clear();
    this.historyRevision.update((r) => r + 1);
    this.store.setMap(map);
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

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
