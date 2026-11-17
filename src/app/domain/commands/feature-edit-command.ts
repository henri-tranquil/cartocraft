import { MapFeature } from '../features/map-feature';
import { WorldMap } from '../map/world-map';
import { Command, MapChange } from './command';

const FEATURES_CHANGE: MapChange = { terrainTiles: [], metadata: true };
const LAKES_CHANGE: MapChange = { ...FEATURES_CHANGE, hydrology: true };

/** Renaming a lake changes nothing for the water; moving it or its level does. */
function changesHydrology(before: MapFeature | null, after: MapFeature | null): boolean {
  const lake = (f: MapFeature | null) => (f?.kind === 'lake' ? f : null);
  const a = lake(before);
  const b = lake(after);
  if (!a && !b) return false;
  return !a || !b || a.xKm !== b.xKm || a.yKm !== b.yKm || a.surfaceM !== b.surfaceM;
}

/**
 * Add (before = null), modify, or delete (after = null) one named place.
 * Features are immutable values, so the command simply keeps both versions:
 * undo puts `before` back at the same position in the list.
 */
export class FeatureEditCommand implements Command {
  private index = -1;
  private readonly change: MapChange;

  constructor(
    readonly label: string,
    private readonly before: MapFeature | null,
    private readonly after: MapFeature | null,
  ) {
    if (!before && !after) throw new Error('FeatureEditCommand needs a before or an after');
    if (before && after && before.id !== after.id) throw new Error('FeatureEditCommand cannot change an id');
    this.change = changesHydrology(before, after) ? LAKES_CHANGE : FEATURES_CHANGE;
  }

  execute(map: WorldMap): MapChange {
    const id = (this.before ?? this.after)?.id;
    const existing = map.features.findIndex((f) => f.id === id);
    if (this.before) {
      if (existing < 0) throw new Error(`Feature ${id} not found`);
      this.index = existing;
      if (this.after) map.features[existing] = this.after;
      else map.features.splice(existing, 1);
    } else if (this.after) {
      if (existing >= 0) throw new Error(`Feature ${id} already exists`);
      this.index = map.features.length;
      map.features.push(this.after);
    }
    return this.change;
  }

  undo(map: WorldMap): MapChange {
    if (this.index < 0) throw new Error('FeatureEditCommand undone before execution');
    if (this.after && this.before) map.features[this.index] = this.before;
    else if (this.after) map.features.splice(this.index, 1);
    else if (this.before) map.features.splice(this.index, 0, this.before);
    return this.change;
  }
}
