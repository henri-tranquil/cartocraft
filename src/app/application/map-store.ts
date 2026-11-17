import { computed, Injectable, signal } from '@angular/core';
import { MapChange } from '../domain/commands/command';
import { WorldMap } from '../domain/map/world-map';
import { allTileIndices } from '../domain/terrain/tiled-grid';

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
  private readonly dirtyTiles = new Set<number>();

  readonly map = this.currentMap.asReadonly();
  readonly revision = this.currentRevision.asReadonly();

  readonly mapName = computed(() => {
    this.currentRevision();
    return this.currentMap()?.name ?? '';
  });

  setMap(map: WorldMap | null): void {
    this.dirtyTiles.clear();
    if (map) for (const i of allTileIndices(map.terrain.baseAltitudeM)) this.dirtyTiles.add(i);
    this.currentMap.set(map);
    this.currentRevision.update((r) => r + 1);
  }

  applyChange(change: MapChange): void {
    const map = this.currentMap();
    if (!map) return;
    for (const i of change.terrainTiles) this.dirtyTiles.add(i);
    map.updatedAt = new Date().toISOString();
    this.currentRevision.update((r) => r + 1);
  }

  /** For the renderer (step 3): returns tiles to redraw and resets the set. */
  takeDirtyTiles(): number[] {
    const tiles = [...this.dirtyTiles];
    this.dirtyTiles.clear();
    return tiles;
  }
}
