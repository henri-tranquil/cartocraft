import { Command, MapChange } from '../../domain/commands/command';
import { WorldMap } from '../../domain/map/world-map';
import { CellPoint } from '../../domain/terrain/brushes';
import { CellRect } from '../../domain/terrain/tiled-grid';

/** What a tool may do while a gesture is in progress. */
export interface ToolContext {
  readonly map: WorldMap;
  /** Live feedback: the renderer redraws this area on the next frame. */
  markTerrainDirty(rect: CellRect): void;
  /** Same for the drawing layer. */
  markDrawingDirty(rect: CellRect): void;
}

/** A finished gesture: the undoable command, and what it changed (already applied). */
export interface ToolResult {
  readonly command: Command;
  readonly change: MapChange;
}

/**
 * Strategy pattern: every editing tool exposes the same gesture lifecycle.
 * The facade forwards pointer events without knowing which tool is active.
 * `end` returns the undoable command for the whole gesture (or null if nothing changed).
 */
export interface EditorTool {
  begin(ctx: ToolContext, point: CellPoint): void;
  move(ctx: ToolContext, point: CellPoint): void;
  /** Called at a fixed rate while the pointer stays down, moving or not (airbrush). Optional. */
  hold?(ctx: ToolContext): void;
  end(ctx: ToolContext): ToolResult | null;
}
