import { DOCUMENT, inject, Injectable, signal } from '@angular/core';
import { MapChange } from '../domain/commands/command';
import { ChangedTiles } from '../domain/map/map-repository';
import { WorldMap } from '../domain/map/world-map';
import { MapStore } from './map-store';
import { MAP_REPOSITORY } from './ports';

export const AUTO_SAVE_DEBOUNCE_MS = 2000;

export type SaveStatus = 'idle' | 'pending' | 'saving' | 'saved' | 'error';

/**
 * Debounced auto-save: each change restarts a 2 s timer; when it fires,
 * only the tiles touched since the last save are written.
 *
 * Writes are chained on a single promise so two saves never overlap
 * (otherwise an older write could finish after a newer one).
 */
@Injectable({ providedIn: 'root' })
export class AutoSave {
  private readonly repository = inject(MAP_REPOSITORY);
  private readonly store = inject(MapStore);

  private readonly pendingTiles = { altitude: new Set<number>(), drawing: new Set<number>() };
  private pendingFull = false;
  private pendingMetadata = false;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private chain: Promise<void> = Promise.resolve();

  readonly status = signal<SaveStatus>('idle');

  constructor() {
    // `beforeunload` cannot wait for async IndexedDB writes; `visibilitychange`
    // (tab hidden, switched, or closing) fires early enough in practice.
    inject(DOCUMENT).addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') void this.flush();
    });
  }

  markChanged(change: MapChange): void {
    for (const t of change.terrainTiles) this.pendingTiles.altitude.add(t);
    for (const t of change.drawingTiles ?? []) this.pendingTiles.drawing.add(t);
    this.pendingMetadata ||= change.metadata;
    this.schedule();
  }

  markFullSave(): void {
    this.pendingFull = true;
    this.schedule();
  }

  /** Writes pending changes now (e.g. before switching maps). Resolves when everything is on disk. */
  flush(): Promise<void> {
    this.clearTimer();
    const map = this.store.map();
    const { altitude, drawing } = this.pendingTiles;
    const hasPending = this.pendingFull || this.pendingMetadata || altitude.size > 0 || drawing.size > 0;
    if (!map || !hasPending) return this.chain;

    const tiles: ChangedTiles | 'all' = this.pendingFull ? 'all' : { altitude: [...altitude], drawing: [...drawing] };
    altitude.clear();
    drawing.clear();
    this.pendingFull = false;
    this.pendingMetadata = false;
    this.chain = this.chain.then(() => this.write(map, tiles));
    return this.chain;
  }

  private async write(map: WorldMap, tiles: ChangedTiles | 'all'): Promise<void> {
    this.status.set('saving');
    try {
      await this.repository.save(map, tiles);
      if (this.timer === null) this.status.set('saved');
    } catch (error) {
      console.error('Auto-save failed', error);
      this.status.set('error');
      // Unknown state on disk: retry with a full save on the next change.
      if (this.store.map() === map) this.pendingFull = true;
    }
  }

  private schedule(): void {
    this.clearTimer();
    this.status.set('pending');
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.flush();
    }, AUTO_SAVE_DEBOUNCE_MS);
  }

  private clearTimer(): void {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
  }
}
