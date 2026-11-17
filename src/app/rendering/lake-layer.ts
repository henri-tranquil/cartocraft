import { contourSegments } from '../domain/terrain/contour';
import { Rgb, VINTAGE } from './style/vintage-style';
import { cellToScreen, Viewport } from './viewport';

/**
 * Lakes, from the hydrology's per-cell lake ids: a bitmap of the lake cells
 * (cropped to their bounding box, lakes are small next to the map), plus a
 * shore line (marching squares on the lake mask) in the rendered view.
 * Rebuilt only when a new hydrology result arrives.
 */
export interface LakeStyle {
  readonly fill: Rgb;
  /** Shore ink, or null for none (edit view: crisp cells, like the terrain). */
  readonly shore: string | null;
  readonly shoreWidthPx: number;
  /** Smooth the bitmap when zoomed in (rendered view) or keep crisp cells (edit view). */
  readonly smooth: boolean;
}

export const EDIT_LAKE_STYLE: LakeStyle = { fill: [70, 132, 196], shore: null, shoreWidthPx: 0, smooth: false };
export const VINTAGE_LAKE_STYLE: LakeStyle = { fill: VINTAGE.seaOpen, shore: VINTAGE.ink, shoreWidthPx: VINTAGE.coastWidthPx, smooth: true };

interface Built {
  readonly canvas: OffscreenCanvas;
  readonly x0: number;
  readonly y0: number;
  readonly shore: Path2D;
}

export class LakeLayer {
  private source: Uint16Array | null = null;
  private built: Built | null = null;

  constructor(private readonly style: LakeStyle) {}

  draw(ctx: CanvasRenderingContext2D, vp: Viewport, lakeId: Uint16Array, widthCells: number): void {
    if (lakeId !== this.source) {
      this.source = lakeId;
      this.built = build(lakeId, widthCells, this.style);
    }
    const built = this.built;
    if (!built) return;
    const origin = cellToScreen(vp, built.x0, built.y0);
    ctx.save();
    ctx.imageSmoothingEnabled = this.style.smooth || vp.pixelsPerCell < 1;
    ctx.drawImage(built.canvas, origin.x, origin.y, built.canvas.width * vp.pixelsPerCell, built.canvas.height * vp.pixelsPerCell);
    if (this.style.shore) {
      ctx.translate(origin.x, origin.y);
      ctx.scale(vp.pixelsPerCell, vp.pixelsPerCell);
      ctx.lineWidth = this.style.shoreWidthPx / vp.pixelsPerCell;
      ctx.lineCap = 'round';
      ctx.strokeStyle = this.style.shore;
      ctx.stroke(built.shore);
    }
    ctx.restore();
  }
}

function build(lakeId: Uint16Array, w: number, style: LakeStyle): Built | null {
  const h = lakeId.length / w;
  let x0 = w;
  let y0 = h;
  let x1 = -1;
  let y1 = -1;
  for (let i = 0; i < lakeId.length; i++) {
    if (lakeId[i] === 0) continue;
    const x = i % w;
    const y = (i - x) / w;
    if (x < x0) x0 = x;
    if (x > x1) x1 = x;
    if (y < y0) y0 = y;
    if (y > y1) y1 = y;
  }
  if (x1 < 0) return null;
  // One empty cell of margin all around, so the shore closes on every side.
  x0 = Math.max(0, x0 - 1);
  y0 = Math.max(0, y0 - 1);
  x1 = Math.min(w - 1, x1 + 1);
  y1 = Math.min(h - 1, y1 + 1);
  const bw = x1 - x0 + 1;
  const bh = y1 - y0 + 1;
  const mask = new Uint8Array(bw * bh);
  const pixels = new Uint8ClampedArray(bw * bh * 4);
  const [r, g, b] = style.fill;
  for (let y = 0; y < bh; y++) {
    for (let x = 0; x < bw; x++) {
      if (lakeId[(y0 + y) * w + x0 + x] === 0) continue;
      const k = y * bw + x;
      mask[k] = 1;
      pixels.set([r, g, b, 255], k * 4);
    }
  }
  const canvas = new OffscreenCanvas(bw, bh);
  canvas.getContext('2d')?.putImageData(new ImageData(pixels, bw, bh), 0, 0);
  const shore = new Path2D();
  if (style.shore) {
    const segs = contourSegments(mask, bw, bh, 0.5);
    for (let i = 0; i < segs.length; i += 4) {
      shore.moveTo(segs[i], segs[i + 1]);
      shore.lineTo(segs[i + 2], segs[i + 3]);
    }
  }
  return { canvas, x0, y0, shore };
}
