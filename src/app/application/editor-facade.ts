import { computed, inject, Injectable, signal } from '@angular/core';
import { Command, MapChange } from '../domain/commands/command';
import { CommandHistory } from '../domain/commands/command-history';
import { RenameMapCommand } from '../domain/commands/rename-map-command';
import { MapFactory } from '../domain/map/map-factory';
import { MapSummary } from '../domain/map/map-repository';
import { MapSettings } from '../domain/map/map-settings';
import { WorldMap } from '../domain/map/world-map';
import { MapFormatError } from '../domain/serialization/map-document';
import { AutoSave } from './auto-save';
import { MapStore } from './map-store';
import { MAP_FILE_CODEC, MAP_REPOSITORY } from './ports';

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
  private readonly history = new CommandHistory();
  /** CommandHistory is plain TS; this counter makes its state observable. */
  private readonly historyRevision = signal(0);
  private readonly savedMapsState = signal<readonly MapSummary[]>([]);
  private readonly errorState = signal<string | null>(null);

  readonly hasMap = computed(() => this.store.map() !== null);
  readonly currentMapId = computed(() => this.store.map()?.id ?? null);
  readonly mapName = this.store.mapName;
  readonly saveStatus = this.autoSave.status.asReadonly();
  readonly savedMaps = this.savedMapsState.asReadonly();
  readonly error = this.errorState.asReadonly();
  readonly fileExtension = this.fileCodec.fileExtension;
  readonly mapSummary = computed(() => {
    const map = this.store.map();
    if (!map) return null;
    const grid = map.terrain.baseAltitudeM;
    return {
      widthKm: map.settings.widthKm,
      heightKm: map.settings.heightKm,
      widthCells: grid.widthCells,
      heightCells: grid.heightCells,
      tileCount: grid.tiles.length,
    };
  });
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

  // --- Editing ---

  renameMap(name: string): void {
    const trimmed = name.trim();
    if (trimmed === '' || trimmed === this.store.mapName()) return;
    this.execute(new RenameMapCommand(trimmed));
  }

  undo(): void {
    const map = this.store.map();
    if (map) this.afterHistoryOp(this.history.undo(map));
  }

  redo(): void {
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
    this.historyRevision.update((r) => r + 1);
    if (change.metadata) void this.refreshList();
  }

  // --- Helpers ---

  private async openLoaded(map: WorldMap): Promise<void> {
    await this.autoSave.flush(); // never lose the previous map's pending edits
    this.history.clear();
    this.historyRevision.update((r) => r + 1);
    this.store.setMap(map);
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
