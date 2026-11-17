import { WorldMap } from '../domain/map/world-map';
import { CellRect, clipRect, expandRect, Int16TiledGrid, tileRect } from '../domain/terrain/tiled-grid';
import { AltitudePalette, buildAltitudePalette } from './style/altitude-palette';
import { renderTerrainPixels } from './terrain-pixels';
import { cellToScreen, screenToCell, Viewport } from './viewport';

interface TileBitmap {
  readonly canvas: OffscreenCanvas;
  readonly ctx: OffscreenCanvasRenderingContext2D;
  readonly image: ImageData;
}

/**
 * Keeps one 1-pixel-per-cell bitmap per data tile and redraws only dirty
 * rectangles. Drawing the screen is then just scaling those bitmaps.
 *
 * Step 3 renders on the main thread at base resolution; semantic LOD,
 * procedural detail and worker rendering come in step 8.
 */
export class TerrainRaster {
  private readonly grid: Int16TiledGrid;
  private readonly palette: AltitudePalette;
  private readonly cellSizeM: number;
  private readonly bitmaps: TileBitmap[];

  constructor(map: WorldMap) {
    this.grid = map.terrain.baseAltitudeM;
    this.palette = buildAltitudePalette(map.settings.seaLevelM);
    this.cellSizeM = map.settings.baseCellKm * 1000;
    const size = this.grid.tileSize;
    this.bitmaps = this.grid.tiles.map(() => {
      const canvas = new OffscreenCanvas(size, size);
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('2D context unavailable');
      return { canvas, ctx, image: ctx.createImageData(size, size) };
    });
  }

  /** Re-renders the given cell rectangles (plus a 1-cell margin: hillshading reads neighbours). */
  update(rects: readonly CellRect[]): void {
    for (const rect of mergeIfWorthwhile(rects)) {
      const area = clipRect(this.grid, expandRect(rect, 1));
      if (!area) continue;
      this.bitmaps.forEach((bitmap, tileIndex) => {
        const part = intersect(area, tileRect(this.grid, tileIndex));
        if (!part) return;
        renderTerrainPixels(this.grid, tileIndex, part, bitmap.image.data, this.palette, this.cellSizeM);
        const { x0, y0 } = tileRect(this.grid, tileIndex);
        bitmap.ctx.putImageData(bitmap.image, 0, 0, part.x0 - x0, part.y0 - y0, part.x1 - part.x0 + 1, part.y1 - part.y0 + 1);
      });
    }
  }

  draw(ctx: CanvasRenderingContext2D, vp: Viewport): void {
    // Zoomed in, show cells as crisp squares (honest about data resolution,
    // and avoids seams between bilinear-filtered tiles). Zoomed out, smooth.
    ctx.imageSmoothingEnabled = vp.pixelsPerCell < 1;
    const topLeft = screenToCell(vp, 0, 0);
    const bottomRight = screenToCell(vp, vp.widthPx, vp.heightPx);
    const visible = { x0: Math.floor(topLeft.x), y0: Math.floor(topLeft.y), x1: Math.ceil(bottomRight.x), y1: Math.ceil(bottomRight.y) };

    this.bitmaps.forEach((bitmap, tileIndex) => {
      const cells = tileRect(this.grid, tileIndex);
      if (!intersect(cells, visible)) return;
      const w = cells.x1 - cells.x0 + 1;
      const h = cells.y1 - cells.y0 + 1;
      // Round both edges (not the size) so neighbouring tiles share the exact same pixel border: no gaps.
      const a = cellToScreen(vp, cells.x0, cells.y0);
      const b = cellToScreen(vp, cells.x0 + w, cells.y0 + h);
      const x = Math.round(a.x);
      const y = Math.round(a.y);
      ctx.drawImage(bitmap.canvas, 0, 0, w, h, x, y, Math.round(b.x) - x, Math.round(b.y) - y);
    });
  }
}

/**
 * Consecutive dabs of one frame overlap heavily: rendering their bounding
 * box once is cheaper than rendering each. We merge only when the box is no
 * bigger than the sum of the parts (two distant dabs stay separate).
 */
export function mergeIfWorthwhile(rects: readonly CellRect[]): readonly CellRect[] {
  if (rects.length < 2) return rects;
  const area = (r: CellRect) => (r.x1 - r.x0 + 1) * (r.y1 - r.y0 + 1);
  const union = rects.reduce((u, r) => ({
    x0: Math.min(u.x0, r.x0),
    y0: Math.min(u.y0, r.y0),
    x1: Math.max(u.x1, r.x1),
    y1: Math.max(u.y1, r.y1),
  }));
  return area(union) <= rects.reduce((sum, r) => sum + area(r), 0) ? [union] : rects;
}

function intersect(a: CellRect, b: CellRect): CellRect | null {
  const x0 = Math.max(a.x0, b.x0);
  const y0 = Math.max(a.y0, b.y0);
  const x1 = Math.min(a.x1, b.x1);
  const y1 = Math.min(a.y1, b.y1);
  return x0 > x1 || y0 > y1 ? null : { x0, y0, x1, y1 };
}
