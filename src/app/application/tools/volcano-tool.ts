import { DrawnVolcanoEditCommand } from '../../domain/commands/drawn-volcano-edit-command';
import { isLandCode } from '../../domain/drawing/drawing-cell';
import { DrawnVolcano, VolcanoKind, volcanoAt } from '../../domain/drawing/drawn-volcano';
import { CellPoint } from '../../domain/terrain/brushes';
import { getCellClamped } from '../../domain/terrain/tiled-grid';
import { EditorTool, ToolContext, ToolResult } from './editor-tool';


/**
 * Volcano tool: a click on land places a volcano of the chosen kind; a click
 * on an existing one gives it the chosen kind; pressing on one and dragging
 * moves it (it follows the pointer live). One command per gesture, on release.
 */
export class VolcanoTool implements EditorTool {
  private grabbed: DrawnVolcano | null = null;
  private current: DrawnVolcano | null = null;
  private start: CellPoint | null = null;

  constructor(
    private readonly kmPerPx: () => number,
    private readonly kind: () => VolcanoKind,
  ) {}

  begin(ctx: ToolContext, point: CellPoint): void {
    const km = ctx.map.settings.baseCellKm;
    this.start = point;
    this.grabbed = volcanoAt(ctx.map.volcanoes, point.x * km, point.y * km, this.kmPerPx());
    this.current = this.grabbed;
  }

  move(ctx: ToolContext, point: CellPoint): void {
    if (!this.grabbed || !this.current || !onLand(ctx, point)) return;
    const km = ctx.map.settings.baseCellKm;
    const moved = { ...this.current, xKm: round(point.x * km), yKm: round(point.y * km) };
    const index = ctx.map.volcanoes.findIndex((v) => v.id === moved.id);
    if (index < 0) return;
    ctx.map.volcanoes[index] = moved;
    this.current = moved;
    // Asks for a frame; the view sees the new volcano and refreshes the tiles around it.
    ctx.markDrawingDirty({ x0: Math.floor(point.x), y0: Math.floor(point.y), x1: Math.floor(point.x), y1: Math.floor(point.y) });
  }

  end(ctx: ToolContext): ToolResult | null {
    const { grabbed, current, start } = this;
    this.grabbed = this.current = this.start = null;
    if (grabbed && current) {
      if (current === grabbed) {
        // A click without moving: change its kind.
        if (grabbed.kind === this.kind()) return null;
        const command = new DrawnVolcanoEditCommand('Changer un volcan', grabbed, { ...grabbed, kind: this.kind() });
        return { command, change: command.execute(ctx.map) };
      }
      const command = new DrawnVolcanoEditCommand('Déplacer un volcan', grabbed, current);
      return { command, change: command.execute(ctx.map) };
    }
    if (!start || !onLand(ctx, start)) return null;
    const km = ctx.map.settings.baseCellKm;
    const volcano: DrawnVolcano = { id: crypto.randomUUID(), xKm: round(start.x * km), yKm: round(start.y * km), kind: this.kind() };
    const command = new DrawnVolcanoEditCommand('Poser un volcan', null, volcano);
    return { command, change: command.execute(ctx.map) };
  }
}

function onLand(ctx: ToolContext, point: CellPoint): boolean {
  return isLandCode(getCellClamped(ctx.map.terrain.drawing, Math.floor(point.x), Math.floor(point.y)));
}

/** Metre precision. */
function round(km: number): number {
  return Math.round(km * 1000) / 1000;
}
