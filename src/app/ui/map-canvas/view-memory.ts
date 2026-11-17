/**
 * Remembers the camera per map, so reopening a map (or reloading the page)
 * brings you back where you were instead of the full zoomed-out view.
 *
 * This is a per-browser convenience, not map data: it is not exported and
 * may vanish (private mode, cleared storage) without harm. Hence
 * localStorage (tiny value) with the project prefix, and every access guarded.
 */
const KEY_PREFIX = 'cartocraft:view:';

export interface SavedView {
  readonly centerX: number;
  readonly centerY: number;
  readonly pixelsPerCell: number;
}

export function loadView(mapId: string): SavedView | null {
  try {
    const raw = localStorage.getItem(KEY_PREFIX + mapId);
    if (!raw) return null;
    const value: unknown = JSON.parse(raw);
    if (typeof value !== 'object' || value === null) return null;
    const { centerX, centerY, pixelsPerCell } = value as Record<string, unknown>;
    if ([centerX, centerY, pixelsPerCell].every((n) => typeof n === 'number' && Number.isFinite(n)) && (pixelsPerCell as number) > 0) {
      return { centerX: centerX as number, centerY: centerY as number, pixelsPerCell: pixelsPerCell as number };
    }
    return null;
  } catch {
    return null;
  }
}

export function saveView(mapId: string, view: SavedView): void {
  try {
    localStorage.setItem(
      KEY_PREFIX + mapId,
      JSON.stringify({ centerX: view.centerX, centerY: view.centerY, pixelsPerCell: view.pixelsPerCell }),
    );
  } catch {
    // Storage unavailable or full: the view simply won't be remembered.
  }
}
