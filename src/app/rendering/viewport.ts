/**
 * The camera. World unit = base-grid cell; screen unit = CSS pixel.
 * `center` is the cell coordinate shown at the middle of the canvas.
 */
export interface Viewport {
  readonly centerX: number;
  readonly centerY: number;
  readonly pixelsPerCell: number;
  readonly widthPx: number;
  readonly heightPx: number;
}

export interface ZoomLimits {
  readonly minPixelsPerCell: number;
  readonly maxPixelsPerCell: number;
}

/** Narrowest view: a "valley" of ~10 km across the screen (CLAUDE.md semantic zoom). */
export const MIN_VISIBLE_KM = 10;

export function screenToCell(vp: Viewport, sx: number, sy: number): { x: number; y: number } {
  return {
    x: vp.centerX + (sx - vp.widthPx / 2) / vp.pixelsPerCell,
    y: vp.centerY + (sy - vp.heightPx / 2) / vp.pixelsPerCell,
  };
}

export function cellToScreen(vp: Viewport, x: number, y: number): { x: number; y: number } {
  return {
    x: (x - vp.centerX) * vp.pixelsPerCell + vp.widthPx / 2,
    y: (y - vp.centerY) * vp.pixelsPerCell + vp.heightPx / 2,
  };
}

/** Fits the whole grid with a small margin. */
export function fitViewport(widthCells: number, heightCells: number, widthPx: number, heightPx: number): Viewport {
  return {
    centerX: widthCells / 2,
    centerY: heightCells / 2,
    pixelsPerCell: Math.min(widthPx / widthCells, heightPx / heightCells) * 0.95,
    widthPx,
    heightPx,
  };
}

export function zoomLimits(widthCells: number, heightCells: number, baseCellKm: number, vp: Viewport): ZoomLimits {
  const fit = Math.min(vp.widthPx / widthCells, vp.heightPx / heightCells);
  const minSidePx = Math.min(vp.widthPx, vp.heightPx);
  return { minPixelsPerCell: fit * 0.5, maxPixelsPerCell: Math.max(fit, (minSidePx * baseCellKm) / MIN_VISIBLE_KM) };
}

/**
 * Zooms by `factor` while keeping the cell under (sx, sy) fixed on screen:
 * the point under the cursor is the anchor, the center moves around it.
 */
export function zoomAt(vp: Viewport, sx: number, sy: number, factor: number, limits: ZoomLimits): Viewport {
  const anchor = screenToCell(vp, sx, sy);
  const pixelsPerCell = Math.min(limits.maxPixelsPerCell, Math.max(limits.minPixelsPerCell, vp.pixelsPerCell * factor));
  return {
    ...vp,
    pixelsPerCell,
    centerX: anchor.x - (sx - vp.widthPx / 2) / pixelsPerCell,
    centerY: anchor.y - (sy - vp.heightPx / 2) / pixelsPerCell,
  };
}

export function panBy(vp: Viewport, dxPx: number, dyPx: number): Viewport {
  return { ...vp, centerX: vp.centerX - dxPx / vp.pixelsPerCell, centerY: vp.centerY - dyPx / vp.pixelsPerCell };
}

export function resize(vp: Viewport, widthPx: number, heightPx: number): Viewport {
  return { ...vp, widthPx, heightPx };
}
