import { WorldMap } from '../map/world-map';
import { Command, MapChange } from './command';

const METADATA_CHANGE: MapChange = { terrainTiles: [], metadata: true };

export class RenameMapCommand implements Command {
  readonly label = 'Renommer la carte';
  private previousName: string | null = null;

  constructor(private readonly newName: string) {}

  execute(map: WorldMap): MapChange {
    this.previousName = map.name;
    map.name = this.newName;
    return METADATA_CHANGE;
  }

  undo(map: WorldMap): MapChange {
    if (this.previousName === null) throw new Error('RenameMapCommand undone before execution');
    map.name = this.previousName;
    return METADATA_CHANGE;
  }
}
