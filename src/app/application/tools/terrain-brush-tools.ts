import { TileChangeRecorder } from '../../domain/commands/terrain-edit-command';
import { BrushDab, brushRect, CellPoint, dabPositionsAlong, raiseTerrain, smoothTerrain } from '../../domain/terrain/brushes';
import { CellRect, Int16TiledGrid, tileIndicesInRect } from '../../domain/terrain/tiled-grid';
import { EditorTool, ToolContext, ToolResult } from './editor-tool';

export interface BrushOptions {
  readonly radiusKm: number;
  /** 0..1 */
  readonly strength: number;
}

/** Altitude change of one dab at full strength, at the brush centre. */
export const MAX_DELTA_PER_DAB_M = 40;
/** Distance between dabs, as a fraction of the radius. */
const DAB_SPACING_RATIO = 0.25;

/**
 * Template for all terrain brushes: handles the stroke (dab spacing, undo
 * recording, dirty marking); subclasses only define what ONE dab does.
 */
abstract class TerrainBrushTool implements EditorTool {
  protected abstract readonly label: string;
  private recorder: TileChangeRecorder | null = null;
  private last: CellPoint | null = null;
  private carried = 0;

  constructor(private readonly options: () => BrushOptions) {}

  begin(ctx: ToolContext, point: CellPoint): void {
    this.recorder = new TileChangeRecorder(ctx.map.terrain.baseAltitudeM);
    this.last = point;
    this.carried = 0;
    this.dab(ctx, point);
  }

  move(ctx: ToolContext, point: CellPoint): void {
    if (!this.recorder || !this.last) return;
    const spacing = Math.max(0.5, this.radiusCells(ctx) * DAB_SPACING_RATIO);
    const { points, carried } = dabPositionsAlong(this.last, point, spacing, this.carried);
    points.forEach((p) => this.dab(ctx, p));
    this.last = point;
    this.carried = carried;
  }

  /** Airbrush: keep applying at the last position while the button is held. */
  hold(ctx: ToolContext): void {
    if (this.recorder && this.last) this.dab(ctx, this.last);
  }

  end(): ToolResult | null {
    const command = this.recorder?.finish(this.label) ?? null;
    this.recorder = null;
    this.last = null;
    return command ? { command, change: { terrainTiles: command.tileIndices, metadata: false } } : null;
  }

  protected abstract applyDab(grid: Int16TiledGrid, dab: BrushDab, strength: number): CellRect | null;

  private radiusCells(ctx: ToolContext): number {
    return this.options().radiusKm / ctx.map.settings.baseCellKm;
  }

  private dab(ctx: ToolContext, center: CellPoint): void {
    const grid = ctx.map.terrain.baseAltitudeM;
    const dab: BrushDab = { center, radiusCells: this.radiusCells(ctx) };
    const rect = brushRect(grid, dab);
    if (!rect || !this.recorder) return;
    // Snapshot tiles BEFORE modifying them (first touch only) for undo.
    for (const tile of tileIndicesInRect(grid, rect.x0, rect.y0, rect.x1, rect.y1)) this.recorder.touch(tile);
    const changed = this.applyDab(grid, dab, this.options().strength);
    if (changed) ctx.markTerrainDirty(changed);
  }
}

export class RaiseTerrainTool extends TerrainBrushTool {
  protected readonly label = 'Élever le relief';
  protected applyDab(grid: Int16TiledGrid, dab: BrushDab, strength: number): CellRect | null {
    return raiseTerrain(grid, dab, MAX_DELTA_PER_DAB_M * strength);
  }
}

export class LowerTerrainTool extends TerrainBrushTool {
  protected readonly label = 'Abaisser le relief';
  protected applyDab(grid: Int16TiledGrid, dab: BrushDab, strength: number): CellRect | null {
    return raiseTerrain(grid, dab, -MAX_DELTA_PER_DAB_M * strength);
  }
}

export class SmoothTerrainTool extends TerrainBrushTool {
  protected readonly label = 'Lisser le relief';
  protected applyDab(grid: Int16TiledGrid, dab: BrushDab, strength: number): CellRect | null {
    return smoothTerrain(grid, dab, strength);
  }
}
