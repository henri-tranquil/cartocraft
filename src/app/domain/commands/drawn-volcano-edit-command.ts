import { DrawnVolcano } from '../drawing/drawn-volcano';
import { WorldMap } from '../map/world-map';
import { Command, MapChange } from './command';

const VOLCANOES_CHANGE: MapChange = { terrainTiles: [], metadata: true, volcanoes: true };

/** One volcano added (before = null), moved (both), or removed (after = null). */
export class DrawnVolcanoEditCommand implements Command {
  private index = -1;
  readonly sizeBytes = 64;

  constructor(
    readonly label: string,
    private readonly before: DrawnVolcano | null,
    private readonly after: DrawnVolcano | null,
  ) {
    if (!before && !after) throw new Error('A volcano edit needs a before or an after');
    if (before && after && before.id !== after.id) throw new Error('A volcano edit cannot change an id');
  }

  execute(map: WorldMap): MapChange {
    const id = (this.before ?? this.after)?.id;
    const existing = map.volcanoes.findIndex((v) => v.id === id);
    if (this.before) {
      if (existing < 0) throw new Error(`Volcano ${id} not found`);
      if (this.after) map.volcanoes[existing] = this.after;
      else map.volcanoes.splice(existing, 1);
      this.index = existing;
    } else {
      if (existing >= 0) throw new Error(`Volcano ${id} already exists`);
      map.volcanoes.push(this.after as DrawnVolcano);
      this.index = map.volcanoes.length - 1;
    }
    return VOLCANOES_CHANGE;
  }

  undo(map: WorldMap): MapChange {
    if (this.index < 0) throw new Error('DrawnVolcanoEditCommand undone before execution');
    if (this.before && this.after) map.volcanoes[this.index] = this.before;
    else if (this.after) map.volcanoes.splice(this.index, 1);
    else if (this.before) map.volcanoes.splice(this.index, 0, this.before);
    return VOLCANOES_CHANGE;
  }
}
