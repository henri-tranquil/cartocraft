import { RiverSnap } from '../../domain/drawing/drawn-river';
import { VINTAGE } from '../style/vintage-style';
import { cellToScreen, Viewport } from '../viewport';

/**
 * Drawn rivers: their size (shared by the water rendered in the tiles, see
 * river-raster.ts) and the overlays of the River tool (stroke preview,
 * magnet). Width grows with the upstream length (own course + tributaries),
 * like a real river widening downstream.
 */
export const DRAWN_RIVER_STYLE = {
  /**
   * Width (KM, fixed on the ground: it does not change with the zoom) =
   * kmPerKm · L^exponent, L = upstream length (km, tributaries included).
   * Real rivers: width ∝ √discharge, and the basin grows a bit faster than
   * the length (Hack's law) ⇒ width ∝ ~L^0.8: zero at the source, a 1000 km
   * river ≈ 10 km wide at its mouth (fantasy-map scale, not the real one).
   * Thin reaches still get a minimum width on screen (river-raster.ts).
   */
  kmPerKm: 0.04,
  exponent: 0.8,
  maxWidthKm: 16,
  /** Estuary: width multiplied up to 1 + this at the mouth. */
  estuaryFlare: 1.5,
  /** Delta: width kept by the main channel below the fork, and by each branch. */
  deltaMainShare: 0.7,
  deltaBranchShare: 0.5,
  previewColour: 'rgb(58 112 128 / 0.85)',
} as const;

/** Width (km) of a drawn river where `upstreamKm` of river flows through. */
export function drawnRiverWidthKm(upstreamKm: number): number {
  const s = DRAWN_RIVER_STYLE;
  return Math.min(s.maxWidthKm, s.kmPerKm * Math.max(0, upstreamKm) ** s.exponent);
}

/** The stroke being traced, dashed, until the pointer is released (the river itself is water in the tiles). */
export function drawRiverPreview(ctx: CanvasRenderingContext2D, vp: Viewport, preview: readonly number[] | null, cellKm: number): void {
  if (!preview || preview.length < 4) return;
  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.strokeStyle = DRAWN_RIVER_STYLE.previewColour;
  ctx.lineWidth = 2;
  ctx.setLineDash([6, 4]);
  ctx.beginPath();
  for (let i = 0; i < preview.length; i += 2) {
    const s = cellToScreen(vp, preview[i] / cellKm, preview[i + 1] / cellKm);
    if (i === 0) ctx.moveTo(s.x, s.y);
    else ctx.lineTo(s.x, s.y);
  }
  ctx.stroke();
  ctx.restore();
}

/**
 * The magnet of the River tool, under the pointer: a ring on the point a
 * stroke would start from. Filled (ochre) at a river's end = extend it;
 * hollow on its course = start a tributary.
 */
export function drawRiverMagnet(ctx: CanvasRenderingContext2D, vp: Viewport, snap: RiverSnap, cellKm: number): void {
  const s = cellToScreen(vp, snap.x / cellKm, snap.y / cellKm);
  ctx.save();
  ctx.lineWidth = 2;
  ctx.strokeStyle = VINTAGE.ink;
  ctx.fillStyle = snap.kind === 'branch' ? 'rgb(255 255 255 / 0.7)' : 'rgb(214 160 60)';
  ctx.beginPath();
  ctx.arc(s.x, s.y, snap.kind === 'branch' ? 5 : 6.5, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.restore();
}
