import { inject, Injectable, signal } from '@angular/core';
import { ClimateInput, ClimateResult } from '../domain/climate/climate-model';
import { WorldMap } from '../domain/map/world-map';
import { toRowMajor } from '../domain/terrain/tiled-grid';
import { MapStore } from './map-store';
import { CLIMATE_ENGINE } from './ports';

/** Wait this long after the last terrain edit before recomputing (edits come in bursts). */
export const CLIMATE_DEBOUNCE_MS = 1500;

export type ClimateStatus = 'idle' | 'stale' | 'computing' | 'ready' | 'error';

/**
 * Keeps the climate of the current map up to date, off the main thread.
 *
 * - `invalidate()` after edits: debounced, so a burst of strokes = one run.
 * - Only one run at a time; edits during a run schedule exactly one rerun.
 * - A `generation` counter drops results that arrive after a map switch.
 *
 * Only EditorFacade should call this.
 */
@Injectable({ providedIn: 'root' })
export class ClimateService {
  private readonly engine = inject(CLIMATE_ENGINE);
  private readonly store = inject(MapStore);

  private readonly currentResult = signal<ClimateResult | null>(null);
  private readonly currentStatus = signal<ClimateStatus>('idle');
  private readonly lastDuration = signal<number | null>(null);
  readonly result = this.currentResult.asReadonly();
  readonly status = this.currentStatus.asReadonly();
  readonly lastDurationMs = this.lastDuration.asReadonly();

  private timer: ReturnType<typeof setTimeout> | null = null;
  private running = false;
  private rerunRequested = false;
  private generation = 0;

  /** Forget the previous map's climate (on map switch / close). */
  reset(): void {
    this.generation++;
    this.clearTimer();
    this.rerunRequested = false;
    this.currentResult.set(null);
    this.currentStatus.set('idle');
  }

  invalidate(delayMs = CLIMATE_DEBOUNCE_MS): void {
    if (!this.store.map()) return;
    this.currentStatus.set(this.running ? 'computing' : 'stale');
    this.clearTimer();
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.run();
    }, delayMs);
  }

  private async run(): Promise<void> {
    if (this.running) {
      this.rerunRequested = true;
      return;
    }
    const map = this.store.map();
    if (!map) return;
    const generation = this.generation;
    this.running = true;
    this.currentStatus.set('computing');
    const start = performance.now();
    try {
      const result = await this.engine.compute(buildClimateInput(map));
      if (generation === this.generation) {
        this.currentResult.set(result);
        this.lastDuration.set(performance.now() - start);
        this.currentStatus.set(this.rerunRequested || this.timer !== null ? 'stale' : 'ready');
      }
    } catch (error) {
      console.error('Climate computation failed', error);
      if (generation === this.generation) this.currentStatus.set('error');
    } finally {
      this.running = false;
      if (this.rerunRequested) {
        this.rerunRequested = false;
        void this.run();
      }
    }
  }

  private clearTimer(): void {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
  }
}

export function buildClimateInput(map: WorldMap): ClimateInput {
  const grid = map.terrain.baseAltitudeM;
  const s = map.settings;
  return {
    widthCells: grid.widthCells,
    heightCells: grid.heightCells,
    altitudeM: toRowMajor(grid),
    latitudeTopDeg: s.latitudeTopDeg,
    latitudeBottomDeg: s.latitudeBottomDeg,
    axialTiltDeg: s.axialTiltDeg,
    seaLevelM: s.seaLevelM,
    globalTemperatureOffsetC: s.globalTemperatureOffsetC,
  };
}
