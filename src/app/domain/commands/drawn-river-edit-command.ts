import { DrawnRiver } from '../drawing/drawn-river';
import { WorldMap } from '../map/world-map';
import { Command, MapChange } from './command';

const RIVERS_CHANGE: MapChange = { terrainTiles: [], metadata: true };

/** One river added (before = null), reshaped, or deleted (after = null). */
export interface RiverEdit {
  readonly before: DrawnRiver | null;
  readonly after: DrawnRiver | null;
}

/**
 * Edits of drawn rivers made by one gesture (a new river may re-attach older
 * ones as its tributaries): applied in order, undone in reverse order.
 * Rivers are immutable values: each edit keeps both versions, and undo puts
 * `before` back at the same position in the list.
 */
export class DrawnRiverEditCommand implements Command {
  private indices: number[] = [];
  private readonly edits: readonly RiverEdit[];

  constructor(
    readonly label: string,
    edits: RiverEdit | readonly RiverEdit[],
  ) {
    this.edits = Array.isArray(edits) ? edits : [edits as RiverEdit];
    for (const { before, after } of this.edits) {
      if (!before && !after) throw new Error('A river edit needs a before or an after');
      if (before && after && before.id !== after.id) throw new Error('A river edit cannot change an id');
    }
  }

  get sizeBytes(): number {
    return this.edits.reduce((sum, e) => sum + ((e.before?.pointsKm.length ?? 0) + (e.after?.pointsKm.length ?? 0)) * 8, 0);
  }

  execute(map: WorldMap): MapChange {
    this.indices = this.edits.map(({ before, after }) => {
      const id = (before ?? after)?.id;
      const existing = map.rivers.findIndex((r) => r.id === id);
      if (before) {
        if (existing < 0) throw new Error(`River ${id} not found`);
        if (after) map.rivers[existing] = after;
        else map.rivers.splice(existing, 1);
        return existing;
      }
      if (existing >= 0) throw new Error(`River ${id} already exists`);
      map.rivers.push(after as DrawnRiver);
      return map.rivers.length - 1;
    });
    return RIVERS_CHANGE;
  }

  undo(map: WorldMap): MapChange {
    if (this.indices.length !== this.edits.length) throw new Error('DrawnRiverEditCommand undone before execution');
    for (let i = this.edits.length - 1; i >= 0; i--) {
      const { before, after } = this.edits[i];
      const index = this.indices[i];
      if (after && before) map.rivers[index] = before;
      else if (after) map.rivers.splice(index, 1);
      else if (before) map.rivers.splice(index, 0, before);
    }
    return RIVERS_CHANGE;
  }
}
