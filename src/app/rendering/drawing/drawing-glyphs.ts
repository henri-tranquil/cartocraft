import { isLandCode, reliefIndexOf } from '../../domain/drawing/drawing-cell';
import { hash2 } from '../../domain/terrain/noise';
import { getCellClamped, Int16TiledGrid } from '../../domain/terrain/tiled-grid';
import { VINTAGE } from '../style/vintage-style';
import { Ctx2D, drawMountainGlyph } from '../vintage-mountains';

/**
 * Relief pictograms of the drawing (hills, mountains, high mountains), in
 * CSS px: their size on screen stays about the same at every zoom level, and
 * zooming in shows MORE of them, each standing for a smaller area
 * (semantic zoom). Placement is a jittered lattice in the tile level's pixel
 * space: deterministic, so a glyph drawn across two tiles is the same in both.
 */
export const RELIEF_GLYPHS = {
  /** Lattice step (CSS px). Glyphs are wider than this: they overlap into ranges. */
  spacingPx: 17,
  /** Jitter, as a fraction of the step (1 = anywhere in its lattice cell: no visible rows). */
  jitter: 1,
  /** Base width and height (CSS px) per class: hills, mid mountains, high mountains. */
  sizes: [
    { w: 17, h: 6 },
    { w: 22, h: 15 },
    { w: 29, h: 25 },
  ],
  /** Size variation (±). */
  sizeJitter: 0.15,
  /** Fraction of lattice points that get a hill (hills are sparse, mountains crowd). */
  hillDensity: 0.6,
} as const;

/**
 * Glyph size factor at a zoom level. Constant-size glyphs turn a close-up
 * range into a uniform field of tiny peaks; growing them as fast as the map
 * shows only a few giants. In between: size ∝ zoom^0.45, measured from the
 * level where the whole map fits about 800 px, clamped.
 */
export function glyphZoom(level: number, mapSideCells: number): number {
  const fitLevel = Math.log2(800 / mapSideCells);
  return Math.min(2.5, Math.max(0.8, 2 ** ((level - fitLevel) * 0.45)));
}

/** Largest glyph extent (CSS px) beyond its lattice point: how far a cell change can reach on screen. */
export const RELIEF_GLYPH_REACH_PX =
  RELIEF_GLYPHS.sizes[2].h * (1 + RELIEF_GLYPHS.sizeJitter) + RELIEF_GLYPHS.spacingPx;

const SALT_X = 0x91e1;
const SALT_Y = 0x37c5;
const SALT_KEEP = 0x5a17;
const SALT_SIZE = 0x2b3d;
const SALT_VARIANT = 0x6e0f;

export interface ReliefGlyph {
  readonly x: number;
  readonly y: number;
  /** 1 hills, 2 mid mountain, 3 high mountain. */
  readonly relief: number;
  readonly scale: number;
  readonly variant: number;
}

/**
 * Draws the relief glyphs whose footprint touches the tile whose top-left
 * pixel is (originX, originY) at `level` (2^level px per cell), back to
 * front. `pxScale` = device pixels per CSS px.
 */
export function drawReliefGlyphs(
  ctx: Ctx2D,
  drawing: Int16TiledGrid,
  seed: number,
  level: number,
  originX: number,
  originY: number,
  tilePx: number,
  pxScale: number,
): void {
  for (const g of placeReliefGlyphs(drawing, seed, level, originX, originY, tilePx, pxScale)) {
    const size = RELIEF_GLYPHS.sizes[g.relief - 1];
    const w = size.w * g.scale * pxScale;
    const h = size.h * g.scale * pxScale;
    if (g.relief === 1) drawHillGlyph(ctx, g.x, g.y, w, h, g.variant);
    else drawMountainGlyph(ctx, g.x, g.y, w, h, g.variant, g.relief === 3);
  }
}

/** The glyphs of one tile, sorted back to front, positions relative to the tile's top-left pixel. */
export function placeReliefGlyphs(
  drawing: Int16TiledGrid,
  seed: number,
  level: number,
  originX: number,
  originY: number,
  tilePx: number,
  pxScale: number,
): ReliefGlyph[] {
  const step = RELIEF_GLYPHS.spacingPx * pxScale;
  const reach = RELIEF_GLYPH_REACH_PX * pxScale;
  const cellsPerPx = 1 / 2 ** level;
  // Lattice points whose glyph can touch the tile: glyphs rise above their base and spread sideways.
  const a0 = Math.floor((originX - reach) / step);
  const a1 = Math.ceil((originX + tilePx + reach) / step);
  const b0 = Math.floor(originY / step) - 1;
  const b1 = Math.ceil((originY + tilePx + reach) / step);
  const glyphs: ReliefGlyph[] = [];
  const s = seed ^ (level * 0x9e37);
  for (let b = b0; b <= b1; b++) {
    for (let a = a0; a <= a1; a++) {
      const x = (a + 0.5 + (hash2(s ^ SALT_X, a, b) - 0.5) * RELIEF_GLYPHS.jitter) * step;
      const y = (b + 0.5 + (hash2(s ^ SALT_Y, a, b) - 0.5) * RELIEF_GLYPHS.jitter) * step;
      const code = getCellClamped(drawing, Math.floor(x * cellsPerPx), Math.floor(y * cellsPerPx));
      const relief = reliefIndexOf(code);
      if (!isLandCode(code) || relief === 0) continue;
      if (relief === 1 && hash2(s ^ SALT_KEEP, a, b) > RELIEF_GLYPHS.hillDensity) continue;
      const scale = 1 + (hash2(s ^ SALT_SIZE, a, b) - 0.5) * 2 * RELIEF_GLYPHS.sizeJitter;
      glyphs.push({ x: x - originX, y: y - originY, relief, scale, variant: hash2(s ^ SALT_VARIANT, a, b) });
    }
  }
  return glyphs.sort((p, q) => p.y - q.y);
}

/** A low rounded hump, outlined on top, a few hatches on the shaded (east) side. */
export function drawHillGlyph(ctx: Ctx2D, x: number, y: number, w: number, h: number, v: number): void {
  const top = y - h * (1.6 + v * 0.4);
  const crestX = x + (v - 0.5) * w * 0.2;
  ctx.beginPath();
  ctx.moveTo(x - w / 2, y);
  ctx.quadraticCurveTo(crestX, top, x + w / 2, y);
  const g = ctx.createLinearGradient(0, top, 0, y);
  g.addColorStop(0, VINTAGE.mountainLit);
  g.addColorStop(1, 'rgb(0 0 0 / 0)');
  ctx.fillStyle = g;
  ctx.fill();
  ctx.strokeStyle = VINTAGE.ink;
  ctx.lineCap = 'round';
  ctx.lineWidth = Math.max(0.7, Math.min(1.2, w / 16));
  ctx.beginPath();
  // Outline only over the top: open at the base, like a pen sketch.
  ctx.moveTo(x - w * 0.42, y - h * 0.25);
  ctx.quadraticCurveTo(crestX, top + h * 0.08, x + w * 0.42, y - h * 0.25);
  ctx.stroke();
  ctx.lineWidth = Math.max(0.5, ctx.lineWidth * 0.7);
  ctx.beginPath();
  for (const t of [0.18, 0.32]) {
    const hx = x + w * t;
    ctx.moveTo(hx, y - h * 0.75);
    ctx.lineTo(hx + w * 0.05, y - h * 0.2);
  }
  ctx.stroke();
}
