import { MapSettings } from '../map/map-settings';
import { WorldMap } from '../map/world-map';
import { Command, MapChange } from './command';

const SETTINGS_CHANGE: MapChange = { terrainTiles: [], metadata: true, settings: true };

/** Replaces some map settings (validated beforehand by the caller). Undoable. */
export class UpdateSettingsCommand implements Command {
  private previous: MapSettings | null = null;

  constructor(
    readonly label: string,
    private readonly patch: Partial<MapSettings>,
  ) {}

  execute(map: WorldMap): MapChange {
    this.previous = map.settings;
    map.settings = { ...map.settings, ...this.patch };
    return SETTINGS_CHANGE;
  }

  undo(map: WorldMap): MapChange {
    if (!this.previous) throw new Error('UpdateSettingsCommand undone before execution');
    map.settings = this.previous;
    return SETTINGS_CHANGE;
  }
}
