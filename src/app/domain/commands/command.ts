import { WorldMap } from '../map/world-map';

/**
 * What a command touched, so the store can notify only what changed
 * (the renderer will redraw only `terrainTiles`).
 */
export interface MapChange {
  readonly terrainTiles: readonly number[];
  readonly metadata: boolean;
  /** Map settings (latitudes, tilt…) changed: derived data like the climate must be recomputed. */
  readonly settings?: boolean;
  /** Something the hydrology reads changed (a lake's place or level): rivers must be recomputed. */
  readonly hydrology?: boolean;
}

export const NO_CHANGE: MapChange = { terrainTiles: [], metadata: false };

/**
 * Command pattern: every edit is reversible. `undo` must restore exactly the
 * state before `execute`, and `execute` must be replayable after `undo` (redo).
 */
export interface Command {
  /** French, shown in the UI (e.g. "Annuler : Renommer la carte"). */
  readonly label: string;
  /** Approximate memory held by this command (for the history budget). Omit if negligible. */
  readonly sizeBytes?: number;
  execute(map: WorldMap): MapChange;
  undo(map: WorldMap): MapChange;
}
