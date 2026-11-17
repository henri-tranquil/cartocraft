import { MapFeature } from '../domain/features/map-feature';
import { LABEL_STYLE, labelFontPx, minPxPerKm } from './style/label-style';
import { cellToScreen, Viewport } from './viewport';

/**
 * Place names, drawn over the map in screen space (never baked into the
 * terrain bitmap: text must stay sharp at every zoom and never be cut).
 *
 * Two filters decide what shows:
 *  1. Scale: each importance rank has a minimum px/km (label-style.ts).
 *  2. Collisions: names are placed in order of importance; a name whose box
 *     overlaps an already placed one is dropped. Greedy, O(n²) in the
 *     number of visible names — fine for hundreds; a grid index if it ever
 *     becomes thousands.
 */

export interface ScreenBox {
  readonly x0: number;
  readonly y0: number;
  readonly x1: number;
  readonly y1: number;
}

export interface PlacedLabel {
  readonly feature: MapFeature;
  /** Screen position of the place itself. */
  readonly x: number;
  readonly y: number;
  readonly text: string;
  readonly textX: number;
  readonly align: 'left' | 'center';
  readonly fontPx: number;
  readonly spacingPx: number;
  readonly symbolPx: number;
  /** Symbol + text: used for collisions and clicks. */
  readonly box: ScreenBox;
}

/** Width in px of `text` at `fontPx` with `spacingPx` between letters (canvas measureText in practice). */
export type TextMeasure = (text: string, fontPx: number, spacingPx: number) => number;

export interface LabelLayoutOptions {
  /** Always shown, and placed first (it is being edited). */
  readonly selectedId?: string | null;
  /** Live position of a place being dragged (km). */
  readonly dragged?: { readonly id: string; readonly xKm: number; readonly yKm: number } | null;
}

export const UNNAMED_TEXT = '(sans nom)';

/** Symbol half-size (px); 0 = no symbol, the name is centred on the point. */
export function symbolSizePx(feature: MapFeature): number {
  switch (feature.kind) {
    case 'settlement':
      return { capital: 5.5, city: 4.5, town: 3.5, village: 2.5 }[feature.size];
    case 'peak':
      return 5;
    case 'label':
      return 0;
  }
}

export function layoutLabels(
  features: readonly MapFeature[],
  vp: Viewport,
  cellKm: number,
  measure: TextMeasure,
  options: LabelLayoutOptions = {},
): PlacedLabel[] {
  const pxPerKm = vp.pixelsPerCell / cellKm;
  const selectedId = options.selectedId ?? null;
  const candidates = features
    .map((feature, index) => ({ feature, index }))
    .filter(({ feature }) => feature.id === selectedId || pxPerKm >= minPxPerKm(feature.rank))
    // Selected first, then by importance; ties keep the list order (stable sort).
    .sort((a, b) => Number(b.feature.id === selectedId) - Number(a.feature.id === selectedId) || a.feature.rank - b.feature.rank);

  const placed: PlacedLabel[] = [];
  const m = LABEL_STYLE.collisionMarginPx;
  for (const { feature } of candidates) {
    const dragged = options.dragged?.id === feature.id ? options.dragged : null;
    const { x, y } = cellToScreen(vp, (dragged?.xKm ?? feature.xKm) / cellKm, (dragged?.yKm ?? feature.yKm) / cellKm);
    const label = layoutOne(feature, x, y, measure);
    const { box } = label;
    if (box.x1 < 0 || box.y1 < 0 || box.x0 > vp.widthPx || box.y0 > vp.heightPx) continue;
    const collides = placed.some((p) => box.x0 < p.box.x1 + m && box.x1 + m > p.box.x0 && box.y0 < p.box.y1 + m && box.y1 + m > p.box.y0);
    if (collides && feature.id !== selectedId) continue;
    placed.push(label);
  }
  return placed;
}

function layoutOne(feature: MapFeature, x: number, y: number, measure: TextMeasure): PlacedLabel {
  const fontPx = labelFontPx(feature.rank);
  const water = feature.kind === 'label' && feature.tone === 'water';
  const spacingPx = water ? fontPx * LABEL_STYLE.waterSpacingEm : 0;
  const text = feature.name.trim() || UNNAMED_TEXT;
  const width = measure(text, fontPx, spacingPx);
  const symbolPx = symbolSizePx(feature);
  const half = Math.max(fontPx * 0.6, symbolPx);
  if (symbolPx === 0) {
    return { feature, x, y, text, textX: x, align: 'center', fontPx, spacingPx, symbolPx, box: { x0: x - width / 2, y0: y - half, x1: x + width / 2, y1: y + half } };
  }
  const textX = x + symbolPx + LABEL_STYLE.gapPx;
  return { feature, x, y, text, textX, align: 'left', fontPx, spacingPx, symbolPx, box: { x0: x - symbolPx, y0: y - half, x1: textX + width, y1: y + half } };
}

/** Topmost placed label under a screen point (with a small tolerance for tiny symbols). */
export function labelAt(placed: readonly PlacedLabel[], sx: number, sy: number, tolerancePx = 3): PlacedLabel | null {
  for (const label of placed) {
    const b = label.box;
    if (sx >= b.x0 - tolerancePx && sx <= b.x1 + tolerancePx && sy >= b.y0 - tolerancePx && sy <= b.y1 + tolerancePx) return label;
  }
  return null;
}

export function canvasTextMeasure(ctx: CanvasRenderingContext2D): TextMeasure {
  return (text, fontPx, spacingPx) => {
    ctx.font = `${fontPx}px ${LABEL_STYLE.font}`;
    ctx.letterSpacing = `${spacingPx}px`;
    return ctx.measureText(text).width;
  };
}

export function drawLabels(ctx: CanvasRenderingContext2D, placed: readonly PlacedLabel[], selectedId: string | null): void {
  ctx.save();
  ctx.textBaseline = 'middle';
  ctx.lineJoin = 'round';
  // Back to front: the most important name ends on top.
  for (let k = placed.length - 1; k >= 0; k--) {
    const label = placed[k];
    if (label.feature.id === selectedId) drawSelection(ctx, label.box);
    drawSymbol(ctx, label);
    const water = label.feature.kind === 'label' && label.feature.tone === 'water';
    ctx.font = `${label.fontPx}px ${LABEL_STYLE.font}`;
    ctx.letterSpacing = `${label.spacingPx}px`;
    ctx.textAlign = label.align;
    ctx.strokeStyle = LABEL_STYLE.halo;
    ctx.lineWidth = LABEL_STYLE.haloWidthPx;
    ctx.strokeText(label.text, label.textX, label.y);
    ctx.fillStyle = water ? LABEL_STYLE.waterInk : LABEL_STYLE.ink;
    ctx.fillText(label.text, label.textX, label.y);
  }
  ctx.restore();
}

function drawSelection(ctx: CanvasRenderingContext2D, box: ScreenBox): void {
  ctx.strokeStyle = LABEL_STYLE.selection;
  ctx.lineWidth = 2;
  ctx.setLineDash([4, 3]);
  ctx.strokeRect(box.x0 - 4, box.y0 - 3, box.x1 - box.x0 + 8, box.y1 - box.y0 + 6);
  ctx.setLineDash([]);
}

function drawSymbol(ctx: CanvasRenderingContext2D, label: PlacedLabel): void {
  const { feature, x, y, symbolPx: r } = label;
  if (r === 0) return;
  ctx.lineWidth = 1.5;
  ctx.strokeStyle = LABEL_STYLE.ink;
  ctx.fillStyle = LABEL_STYLE.halo;
  ctx.beginPath();
  if (feature.kind === 'peak') {
    ctx.moveTo(x - r, y + r * 0.8);
    ctx.lineTo(x, y - r);
    ctx.lineTo(x + r, y + r * 0.8);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    return;
  }
  ctx.arc(x, y, r, 0, Math.PI * 2);
  if (feature.kind === 'settlement' && (feature.size === 'city' || feature.size === 'village')) {
    ctx.fillStyle = LABEL_STYLE.ink;
    ctx.fill();
    return;
  }
  ctx.fill();
  ctx.stroke();
  if (feature.kind === 'settlement' && feature.size === 'capital') {
    ctx.fillStyle = LABEL_STYLE.ink;
    ctx.beginPath();
    ctx.arc(x, y, r * 0.45, 0, Math.PI * 2);
    ctx.fill();
  }
}
