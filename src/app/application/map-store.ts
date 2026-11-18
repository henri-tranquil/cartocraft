import { computed, Injectable, signal } from '@angular/core';
import { MapChange } from '../domain/commands/command';
import { WorldMap } from '../domain/map/world-map';
import { CellRect, tileRect } from '../domain/terrain/tiled-grid';

/**
 * Holds the current map and notifies changes.
 *
 * The WorldMap is mutated in place (grids are big TypedArrays), so a plain
 * `signal<WorldMap>` would never fire: its reference doesn't change. Instead,
 * every change bumps `revision`, and derived values are `computed`s that read
 * `revision()` to subscribe to it.
 *
 * Only EditorFacade should write here.
 */
@Injectable({ providedIn: 'root' })
export class MapStore {
  private readonly currentMap = signal<WorldMap | null>(null);
  private readonly currentRevision = signal(0);
  /** Areas the renderer must redraw. Consumed by a single reader (the canvas). */
  private dirtyRects: CellRect[] = [];
  /** Same for the drawing layer (its own renderer). */
  private dirtyDrawingRects: CellRect[] = [];

  readonly map = this.currentMap.asReadonly();
  readonly revision = this.currentRevision.asReadonly();

  readonly mapName = computed(() => {
    this.currentRevision();
    return this.currentMap()?.name ?? '';
  });

  setMap(map: WorldMap | null): void {
    const grid = map?.terrain.baseAltitudeM;
    this.dirtyRects = grid ? [{ x0: 0, y0: 0, x1: grid.widthCells - 1, y1: grid.heightCells - 1 }] : [];
    this.dirtyDrawingRects = []; // a new map gets a new drawing renderer: nothing to invalidate
    this.currentMap.set(map);
    this.bump();
  }

  /** Change from a command (execute / undo / redo). */
  applyChange(change: MapChange): void {
    const map = this.currentMap();
    if (!map) return;
    for (const tile of change.terrainTiles) this.dirtyRects.push(tileRect(map.terrain.baseAltitudeM, tile));
    for (const tile of change.drawingTiles ?? []) this.dirtyDrawingRects.push(tileRect(map.terrain.drawing, tile));
    map.updatedAt = new Date().toISOString();
    this.bump();
  }

  /** Live change during a gesture (not yet a command). */
  markTerrainDirty(rect: CellRect): void {
    this.dirtyRects.push(rect);
    this.bump();
  }

  /** Live change of the drawing during a gesture. */
  markDrawingDirty(rect: CellRect): void {
    this.dirtyDrawingRects.push(rect);
    this.bump();
  }

  /** Ends a live gesture: its areas were already marked dirty; only the timestamp changes. */
  touchMap(): void {
    const map = this.currentMap();
    if (!map) return;
    map.updatedAt = new Date().toISOString();
    this.bump();
  }

  takeDirtyRects(): CellRect[] {
    const rects = this.dirtyRects;
    this.dirtyRects = [];
    return rects;
  }

  takeDirtyDrawingRects(): CellRect[] {
    const rects = this.dirtyDrawingRects;
    this.dirtyDrawingRects = [];
    return rects;
  }

  private bump(): void {
    this.currentRevision.update((r) => r + 1);
  }
}
