import { WorldMap } from '../map/world-map';
import { Int16TiledGrid } from '../terrain/tiled-grid';
import { Command, MapChange } from './command';

export interface TileDiff {
  readonly tileIndex: number;
  readonly before: Int16Array;
  readonly after: Int16Array;
}

/**
 * One brush stroke = one command holding before/after copies of the touched
 * tiles only (not a full-map snapshot). A 256² Int16 tile costs 128 KB per
 * copy, so a stroke over 4 tiles weighs ~1 MB in history.
 */
export class TerrainEditCommand implements Command {
  readonly sizeBytes: number;
  readonly tileIndices: readonly number[];

  constructor(
    readonly label: string,
    private readonly diffs: readonly TileDiff[],
  ) {
    this.sizeBytes = diffs.reduce((sum, d) => sum + d.before.byteLength + d.after.byteLength, 0);
    this.tileIndices = diffs.map((d) => d.tileIndex);
  }

  execute(map: WorldMap): MapChange {
    return this.apply(map.terrain.baseAltitudeM, 'after');
  }

  undo(map: WorldMap): MapChange {
    return this.apply(map.terrain.baseAltitudeM, 'before');
  }

  private apply(grid: Int16TiledGrid, side: 'before' | 'after'): MapChange {
    for (const diff of this.diffs) grid.tiles[diff.tileIndex].set(diff[side]);
    return { terrainTiles: this.tileIndices, metadata: false };
  }
}

/**
 * Used while a stroke is in progress: call `touch(tileIndex)` BEFORE modifying
 * a tile; the first call snapshots it. `finish()` captures the "after" state
 * and drops tiles that ended up unchanged.
 */
export class TileChangeRecorder {
  private readonly before = new Map<number, Int16Array>();

  constructor(private readonly grid: Int16TiledGrid) {}

  touch(tileIndex: number): void {
    if (!this.before.has(tileIndex)) this.before.set(tileIndex, this.grid.tiles[tileIndex].slice());
  }

  finish(label: string): TerrainEditCommand | null {
    const diffs: TileDiff[] = [];
    for (const [tileIndex, before] of this.before) {
      const after = this.grid.tiles[tileIndex].slice();
      if (!sameContent(before, after)) diffs.push({ tileIndex, before, after });
    }
    this.before.clear();
    return diffs.length > 0 ? new TerrainEditCommand(label, diffs) : null;
  }
}

function sameContent(a: Int16Array, b: Int16Array): boolean {
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}
