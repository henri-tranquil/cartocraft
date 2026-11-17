import { WorldMap } from '../map/world-map';
import { Command, MapChange } from './command';

export const DEFAULT_HISTORY_SIZE = 100;

/**
 * Two stacks: `done` (undoable) and `undone` (redoable).
 * Any new command clears `undone`: once you edit after undoing, the old
 * "future" no longer applies to the current state.
 */
export class CommandHistory {
  private readonly done: Command[] = [];
  private readonly undone: Command[] = [];

  constructor(private readonly maxEntries = DEFAULT_HISTORY_SIZE) {}

  execute(command: Command, map: WorldMap): MapChange {
    const change = command.execute(map);
    this.record(command);
    return change;
  }

  /** Records a command whose effect is already applied (e.g. a brush stroke painted live). */
  record(command: Command): void {
    this.done.push(command);
    if (this.done.length > this.maxEntries) this.done.shift();
    this.undone.length = 0;
  }

  undo(map: WorldMap): MapChange | null {
    const command = this.done.pop();
    if (!command) return null;
    const change = command.undo(map);
    this.undone.push(command);
    return change;
  }

  redo(map: WorldMap): MapChange | null {
    const command = this.undone.pop();
    if (!command) return null;
    const change = command.execute(map);
    this.done.push(command);
    return change;
  }

  get undoLabel(): string | null {
    return this.done.at(-1)?.label ?? null;
  }

  get redoLabel(): string | null {
    return this.undone.at(-1)?.label ?? null;
  }

  clear(): void {
    this.done.length = 0;
    this.undone.length = 0;
  }
}
