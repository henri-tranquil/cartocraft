import { ClimateResult } from '../domain/climate/climate-model';
import { windAt } from '../domain/climate/wind';
import { cellToScreen, screenToCell, Viewport } from './viewport';

const INK = '#1f1a13';
const PANEL = '#f3e9d2';
/** One arrow per square of this size, in screen pixels (density independent of zoom). */
const SPACING_PX = 56;
/** Arrow length for a 1 m/s wind. */
const PX_PER_MS = 3.2;
const MIN_LENGTH_PX = 6;

/**
 * Wind arrows in screen space, pointing where the air GOES, sampled on a
 * fixed screen grid: zooming changes which cells are sampled, not the density.
 */
export function drawWindOverlay(ctx: CanvasRenderingContext2D, vp: Viewport, result: ClimateResult, yearPhase: number): void {
  const topLeft = cellToScreen(vp, 0, 0);
  const bottomRight = cellToScreen(vp, result.widthCells, result.heightCells);
  const x0 = Math.max(0, topLeft.x);
  const y0 = Math.max(0, topLeft.y);
  const x1 = Math.min(vp.widthPx, bottomRight.x);
  const y1 = Math.min(vp.heightPx, bottomRight.y);

  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  // Align the grid to the map, not the screen, so arrows slide with it when panning.
  const startX = topLeft.x + Math.ceil((x0 - topLeft.x) / SPACING_PX) * SPACING_PX + SPACING_PX / 2;
  const startY = topLeft.y + Math.ceil((y0 - topLeft.y) / SPACING_PX) * SPACING_PX + SPACING_PX / 2;
  for (let sy = startY; sy < y1; sy += SPACING_PX) {
    for (let sx = startX; sx < x1; sx += SPACING_PX) {
      const cell = screenToCell(vp, sx, sy);
      const wind = windAt(result, cell.x, cell.y, yearPhase);
      const speed = Math.hypot(wind.uMs, wind.vMs);
      if (speed < 0.5) {
        drawCalm(ctx, sx, sy);
        continue;
      }
      const length = Math.max(MIN_LENGTH_PX, speed * PX_PER_MS);
      // Screen y points down, north is up: flip the north component.
      const dx = (wind.uMs / speed) * length;
      const dy = (-wind.vMs / speed) * length;
      drawArrow(ctx, sx - dx / 2, sy - dy / 2, sx + dx / 2, sy + dy / 2);
    }
  }
  ctx.restore();
}

function drawArrow(ctx: CanvasRenderingContext2D, ax: number, ay: number, bx: number, by: number): void {
  const angle = Math.atan2(by - ay, bx - ax);
  const head = 7;
  const path = new Path2D();
  path.moveTo(ax, ay);
  path.lineTo(bx, by);
  path.moveTo(bx - head * Math.cos(angle - 0.5), by - head * Math.sin(angle - 0.5));
  path.lineTo(bx, by);
  path.lineTo(bx - head * Math.cos(angle + 0.5), by - head * Math.sin(angle + 0.5));
  // Light halo under the ink so arrows read on dark and light terrain alike.
  ctx.strokeStyle = PANEL;
  ctx.lineWidth = 5;
  ctx.stroke(path);
  ctx.strokeStyle = INK;
  ctx.lineWidth = 2;
  ctx.stroke(path);
}

/** Calm belt (doldrums, horse latitudes): a small circle, as on weather maps. */
function drawCalm(ctx: CanvasRenderingContext2D, x: number, y: number): void {
  ctx.beginPath();
  ctx.arc(x, y, 3.5, 0, Math.PI * 2);
  ctx.strokeStyle = PANEL;
  ctx.lineWidth = 4;
  ctx.stroke();
  ctx.strokeStyle = INK;
  ctx.lineWidth = 1.5;
  ctx.stroke();
}
