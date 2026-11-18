import { TileChangeRecorder } from '../../domain/commands/terrain-edit-command';
import { paintDrawing } from '../../domain/drawing/drawing-brush';
import { DrawingPaint } from '../../domain/drawing/drawing-cell';
import { CellPoint, dabPositionsAlong } from '../../domain/terrain/brushes';
import { tileIndicesInRect } from '../../domain/terrain/tiled-grid';
import { EditorTool, ToolContext, ToolResult } from './editor-tool';

export interface DrawingBrushOptions {
  readonly radiusKm: number;
  /** 0 = clean edge, 1 = deeply indented (see paintDrawing). */
  readonly roughness: number;
}

/** Zone brushes paint by stamping: discs close enough to overlap into a continuous band. */
const DAB_SPACING_RATIO = 0.3;

/**
 * Paints the drawing layer (land, sea, and later relief classes and forests).
 * One stroke = one undoable command holding the touched drawing tiles.
 * Unlike the relief brushes there is no airbrush: a zone is either painted or not.
 */
export class DrawingBrushTool implements EditorTool {
  private recorder: TileChangeRecorder | null = null;
  private last: CellPoint | null = null;
  private carried = 0;

  constructor(
    private readonly label: string,
    private readonly paint: DrawingPaint,
    private readonly options: () => DrawingBrushOptions,
  ) {}

  begin(ctx: ToolContext, point: CellPoint): void {
    this.recorder = new TileChangeRecorder(ctx.map.terrain.drawing, 'drawing');
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

  end(): ToolResult | null {
    const command = this.recorder?.finish(this.label) ?? null;
    this.recorder = null;
    this.last = null;
    return command ? { command, change: command.change } : null;
  }

  private radiusCells(ctx: ToolContext): number {
    return this.options().radiusKm / ctx.map.settings.baseCellKm;
  }

  private dab(ctx: ToolContext, center: CellPoint): void {
    const grid = ctx.map.terrain.drawing;
    const r = this.radiusCells(ctx);
    if (!this.recorder) return;
    // Snapshot tiles BEFORE modifying them (first touch only) for undo.
    for (const tile of tileIndicesInRect(grid, center.x - r, center.y - r, center.x + r, center.y + r)) this.recorder.touch(tile);
    const changed = paintDrawing(
      grid,
      { center, radiusCells: r, roughness: this.options().roughness, cellKm: ctx.map.settings.baseCellKm, seed: ctx.map.settings.seed },
      this.paint,
    );
    if (changed) ctx.markDrawingDirty(changed);
  }
}
