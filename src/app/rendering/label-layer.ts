import { MapFeature, RangeFeature, RegionFeature, RiverFeature } from '../domain/features/map-feature';
import { ringBounds } from '../domain/features/polygon';
import { findRiverPoint, RiverNetwork } from '../domain/hydrology/rivers';
import { cumulativeLength, Glyph, layoutTextOnPath } from './path-text';
import { chaikin } from './river-layer';
import { LABEL_STYLE, labelFontPx, minPxPerKm } from './style/label-style';
import { cellToScreen, Viewport } from './viewport';

/**
 * Place names, drawn over the map in screen space (never baked into the
 * terrain bitmap: text must stay sharp at every zoom and never be cut).
 *
 * Two filters decide what shows:
 *  1. Scale: each importance rank has a minimum px/km (label-style.ts).
 *     A zone's name also needs room: it shows only once it fits inside the
 *     zone on screen, so a small plain gets named only when zoomed in. Same
 *     for river and range names, which must fit along their line (a river's
 *     name also needs the river itself to be shown at this scale).
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
  /** Symbol + text: overall bounds. */
  readonly box: ScreenBox;
  /** Boxes used for collisions and clicks: [box] for straight names, one per letter for curved ones. */
  readonly parts: readonly ScreenBox[];
  /** Letters of a name drawn along a line (river, range); null for straight names. */
  readonly glyphs: readonly Glyph[] | null;
}

/** Width in px of `text` at `fontPx` with `spacingPx` between letters (canvas measureText in practice). */
export type TextMeasure = (text: string, fontPx: number, spacingPx: number) => number;

export interface LabelLayoutOptions {
  /** Always shown, and placed first (it is being edited). */
  readonly selectedId?: string | null;
  /** Live position of a place being dragged (km). */
  readonly dragged?: { readonly id: string; readonly xKm: number; readonly yKm: number } | null;
  /** Computed rivers, and the smallest discharge drawn at this scale (river names follow them). */
  readonly rivers?: { readonly network: RiverNetwork; readonly minDischargeM3s: number } | null;
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
    case 'region':
    case 'river':
    case 'range':
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
    const selected = feature.id === selectedId;
    let label: PlacedLabel | null;
    switch (feature.kind) {
      case 'region':
        label = layoutZone(feature, x, y, vp, cellKm, measure, selected);
        break;
      case 'river':
        label = options.rivers ? layoutRiver(feature, x, y, vp, cellKm, measure, options.rivers, selected) : null;
        break;
      case 'range':
        label = layoutRange(feature, x, y, dragged ? { dx: dragged.xKm - feature.xKm, dy: dragged.yKm - feature.yKm } : null, vp, cellKm, measure, selected);
        break;
      default:
        label = layoutOne(feature, x, y, measure);
    }
    if (!label) continue;
    const { box } = label;
    if (box.x1 < 0 || box.y1 < 0 || box.x0 > vp.widthPx || box.y0 > vp.heightPx) continue;
    const overlaps = (a: ScreenBox, b: ScreenBox) => a.x0 < b.x1 + m && a.x1 + m > b.x0 && a.y0 < b.y1 + m && a.y1 + m > b.y0;
    const collides = placed.some((p) => overlaps(box, p.box) && label.parts.some((a) => p.parts.some((b) => overlaps(a, b))));
    if (collides && feature.id !== selectedId) continue;
    placed.push(label);
  }
  return placed;
}

function layoutOne(feature: MapFeature, x: number, y: number, measure: TextMeasure): PlacedLabel {
  const fontPx = labelFontPx(feature.rank);
  const water = isWaterName(feature);
  const spacingPx = water ? fontPx * LABEL_STYLE.waterSpacingEm : 0;
  const text = feature.name.trim() || UNNAMED_TEXT;
  const width = measure(text, fontPx, spacingPx);
  const symbolPx = symbolSizePx(feature);
  const half = Math.max(fontPx * 0.6, symbolPx);
  if (symbolPx === 0) {
    const box = { x0: x - width / 2, y0: y - half, x1: x + width / 2, y1: y + half };
    return { feature, x, y, text, textX: x, align: 'center', fontPx, spacingPx, symbolPx, box, parts: [box], glyphs: null };
  }
  const textX = x + symbolPx + LABEL_STYLE.gapPx;
  const box = { x0: x - symbolPx, y0: y - half, x1: textX + width, y1: y + half };
  return { feature, x, y, text, textX, align: 'left', fontPx, spacingPx, symbolPx, box, parts: [box], glyphs: null };
}

/**
 * A zone's name: size grows with the zone on screen, letters spread over ~60 %
 * of its width (the old-map look). Null when the name does not fit.
 */
function layoutZone(
  feature: RegionFeature,
  x: number,
  y: number,
  vp: Viewport,
  cellKm: number,
  measure: TextMeasure,
  selected: boolean,
): PlacedLabel | null {
  const bounds = ringBounds(feature.outlineKm);
  const zoneWidthPx = ((bounds.x1 - bounds.x0) / cellKm) * vp.pixelsPerCell;
  const fontPx = Math.min(LABEL_STYLE.zoneFontMaxPx, Math.max(LABEL_STYLE.zoneFontMinPx, zoneWidthPx / 14));
  const text = feature.name.trim() || UNNAMED_TEXT;
  const plainWidth = measure(text, fontPx, 0);
  if (plainWidth > zoneWidthPx * LABEL_STYLE.zoneFitFraction && !selected) return null;
  const gaps = Math.max(1, text.length - 1);
  const spread = (zoneWidthPx * LABEL_STYLE.zoneSpreadFraction - plainWidth) / gaps;
  const spacingPx = Math.max(feature.tone === 'water' ? fontPx * LABEL_STYLE.waterSpacingEm : 0, Math.min(fontPx * LABEL_STYLE.zoneMaxSpacingEm, spread));
  const width = measure(text, fontPx, spacingPx);
  const half = fontPx * 0.6;
  const box = { x0: x - width / 2, y0: y - half, x1: x + width / 2, y1: y + half };
  return { feature, x, y, text, textX: x, align: 'center', fontPx, spacingPx, symbolPx: 0, box, parts: [box], glyphs: null };
}

/** A curved name from its letters: overall box and one box per letter. */
function curvedLabel(feature: MapFeature, x: number, y: number, text: string, fontPx: number, spacingPx: number, glyphs: readonly Glyph[]): PlacedLabel {
  const half = fontPx * 0.6;
  const parts = glyphs.map((g) => {
    const r = Math.max(half, g.widthPx / 2);
    return { x0: g.x - r, y0: g.y - r, x1: g.x + r, y1: g.y + r };
  });
  const box = {
    x0: Math.min(...parts.map((p) => p.x0)),
    y0: Math.min(...parts.map((p) => p.y0)),
    x1: Math.max(...parts.map((p) => p.x1)),
    y1: Math.max(...parts.map((p) => p.y1)),
  };
  return { feature, x, y, text, textX: x, align: 'center', fontPx, spacingPx, symbolPx: 0, box, parts, glyphs };
}

const charMeasure = (measure: TextMeasure) => (ch: string, fontPx: number) => measure(ch, fontPx, 0);

/** Where a river name anchors, cached per river network (rivers change only when the climate is recomputed). */
const riverPointCache = new WeakMap<RiverNetwork, Map<string, { line: number; point: number } | null>>();
/** Tolerance when re-finding a named river after a recomputation (it may shift by a cell or two). */
export const RIVER_ANCHOR_RADIUS_CELLS = 2;

function cachedRiverPoint(network: RiverNetwork, xCell: number, yCell: number): { line: number; point: number } | null {
  let cache = riverPointCache.get(network);
  if (!cache) {
    cache = new Map();
    riverPointCache.set(network, cache);
  }
  const key = `${xCell.toFixed(2)},${yCell.toFixed(2)}`;
  if (!cache.has(key)) cache.set(key, findRiverPoint(network, xCell, yCell, RIVER_ANCHOR_RADIUS_CELLS));
  return cache.get(key) ?? null;
}

/**
 * A river's name, along the shown part of its line, centred on the anchor.
 * Hidden when the river itself is too small to be drawn at this scale.
 */
function layoutRiver(
  feature: RiverFeature,
  x: number,
  y: number,
  vp: Viewport,
  cellKm: number,
  measure: TextMeasure,
  rivers: { readonly network: RiverNetwork; readonly minDischargeM3s: number },
  selected: boolean,
): PlacedLabel | null {
  const { network, minDischargeM3s } = rivers;
  const anchorCell = { x: (vp.centerX + (x - vp.widthPx / 2) / vp.pixelsPerCell), y: (vp.centerY + (y - vp.heightPx / 2) / vp.pixelsPerCell) };
  const hit = cachedRiverPoint(network, anchorCell.x, anchorCell.y);
  if (!hit) return null;
  const q = network.dischargeM3s;
  if (q[hit.point] < minDischargeM3s && !selected) return null;
  let first = network.starts[hit.line];
  while (first < hit.point && q[first] < minDischargeM3s) first++;
  const xs: number[] = [];
  const ys: number[] = [];
  const vs: number[] = [];
  for (let p = first; p < network.starts[hit.line + 1]; p++) {
    const s = cellToScreen(vp, network.pointsCells[2 * p], network.pointsCells[2 * p + 1]);
    xs.push(s.x);
    ys.push(s.y);
    vs.push(p);
  }
  if (xs.length < 2) return null;
  const smooth = chaikin(xs, ys, vs, 3);
  const cum = cumulativeLength(smooth.xs, smooth.ys);
  // Centre on the smoothed point closest to the anchor's river point.
  const anchor = cellToScreen(vp, network.pointsCells[2 * hit.point], network.pointsCells[2 * hit.point + 1]);
  let centerS = 0;
  let bestD = Infinity;
  for (let i = 0; i < smooth.xs.length; i++) {
    const d = (smooth.xs[i] - anchor.x) ** 2 + (smooth.ys[i] - anchor.y) ** 2;
    if (d < bestD) {
      bestD = d;
      centerS = cum[i];
    }
  }
  const fontPx = Math.min(LABEL_STYLE.riverFontMaxPx, LABEL_STYLE.riverFontMinPx + 1.2 * Math.log2(q[hit.point] / minDischargeM3s + 1));
  const spacingPx = fontPx * LABEL_STYLE.riverSpacingEm;
  const text = feature.name.trim() || UNNAMED_TEXT;
  const glyphs = layoutTextOnPath(text, smooth.xs, smooth.ys, centerS, fontPx, spacingPx, charMeasure(measure), 0.9);
  return glyphs ? curvedLabel(feature, anchor.x, anchor.y, text, fontPx, spacingPx, glyphs) : null;
}

/** A range's name along its crest line, size and spacing growing with the line's length on screen. */
function layoutRange(
  feature: RangeFeature,
  x: number,
  y: number,
  shift: { dx: number; dy: number } | null,
  vp: Viewport,
  cellKm: number,
  measure: TextMeasure,
  selected: boolean,
): PlacedLabel | null {
  const xs: number[] = [];
  const ys: number[] = [];
  const path = feature.pathKm;
  for (let i = 0; i < path.length; i += 2) {
    const s = cellToScreen(vp, (path[i] + (shift?.dx ?? 0)) / cellKm, (path[i + 1] + (shift?.dy ?? 0)) / cellKm);
    xs.push(s.x);
    ys.push(s.y);
  }
  const smooth = chaikin(xs, ys, xs.map(() => 0), 3);
  const cum = cumulativeLength(smooth.xs, smooth.ys);
  const length = cum[cum.length - 1];
  const fontPx = Math.min(LABEL_STYLE.zoneFontMaxPx, Math.max(LABEL_STYLE.zoneFontMinPx, length / 16));
  const text = feature.name.trim() || UNNAMED_TEXT;
  const plain = [...text].reduce((sum, ch) => sum + measure(ch, fontPx, 0), 0);
  const spread = (length * LABEL_STYLE.rangeSpreadFraction - plain) / Math.max(1, text.length - 1);
  const spacingPx = Math.max(0, Math.min(fontPx * LABEL_STYLE.zoneMaxSpacingEm, spread));
  const glyphs = layoutTextOnPath(text, smooth.xs, smooth.ys, length / 2, fontPx, spacingPx, charMeasure(measure), selected ? 10 : 0.9);
  return glyphs ? curvedLabel(feature, x, y, text, fontPx, spacingPx, glyphs) : null;
}

/** Guides for the Names section only (the finished map shows just the names): zone outlines, range lines, river anchors. */
export function drawZoneOutlines(
  ctx: CanvasRenderingContext2D,
  vp: Viewport,
  cellKm: number,
  features: readonly MapFeature[],
  selectedId: string | null,
): void {
  ctx.save();
  for (const feature of features) {
    const selected = feature.id === selectedId;
    if (feature.kind === 'range') {
      ctx.beginPath();
      for (let i = 0; i < feature.pathKm.length; i += 2) {
        const p = cellToScreen(vp, feature.pathKm[i] / cellKm, feature.pathKm[i + 1] / cellKm);
        if (i === 0) ctx.moveTo(p.x, p.y);
        else ctx.lineTo(p.x, p.y);
      }
      ctx.setLineDash(selected ? [] : [5, 4]);
      ctx.lineWidth = selected ? 2 : 1.25;
      ctx.strokeStyle = selected ? LABEL_STYLE.selection : LABEL_STYLE.ink;
      ctx.stroke();
      continue;
    }
    if (feature.kind === 'river') {
      const p = cellToScreen(vp, feature.xKm / cellKm, feature.yKm / cellKm);
      ctx.setLineDash([]);
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = selected ? LABEL_STYLE.selection : LABEL_STYLE.waterInk;
      ctx.beginPath();
      ctx.arc(p.x, p.y, 4, 0, Math.PI * 2);
      ctx.stroke();
      continue;
    }
    if (feature.kind !== 'region') continue;
    ctx.beginPath();
    const ring = feature.outlineKm;
    for (let i = 0; i < ring.length; i += 2) {
      const p = cellToScreen(vp, ring[i] / cellKm, ring[i + 1] / cellKm);
      if (i === 0) ctx.moveTo(p.x, p.y);
      else ctx.lineTo(p.x, p.y);
    }
    ctx.closePath();
    ctx.setLineDash(selected ? [] : [5, 4]);
    ctx.lineWidth = selected ? 2 : 1.25;
    ctx.strokeStyle = selected ? LABEL_STYLE.selection : feature.tone === 'water' ? LABEL_STYLE.waterInk : LABEL_STYLE.ink;
    if (selected) {
      ctx.fillStyle = LABEL_STYLE.zoneFill;
      ctx.fill();
    }
    ctx.stroke();
  }
  ctx.restore();
}

/** Live stroke while drawing a zone outline (closed) or a range line (open), screen points. */
export function drawLasso(ctx: CanvasRenderingContext2D, points: readonly number[], closed: boolean): void {
  if (points.length < 4) return;
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(points[0], points[1]);
  for (let i = 2; i < points.length; i += 2) ctx.lineTo(points[i], points[i + 1]);
  if (closed) {
    ctx.closePath();
    ctx.fillStyle = LABEL_STYLE.zoneFill;
    ctx.fill();
  }
  ctx.setLineDash([5, 4]);
  ctx.lineWidth = 2;
  ctx.strokeStyle = LABEL_STYLE.selection;
  ctx.stroke();
  ctx.restore();
}

/** Topmost placed label under a screen point (with a small tolerance for tiny symbols). */
export function labelAt(placed: readonly PlacedLabel[], sx: number, sy: number, tolerancePx = 3): PlacedLabel | null {
  for (const label of placed) {
    for (const b of label.parts) {
      if (sx >= b.x0 - tolerancePx && sx <= b.x1 + tolerancePx && sy >= b.y0 - tolerancePx && sy <= b.y1 + tolerancePx) return label;
    }
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
    const water = isWaterName(label.feature);
    ctx.font = `${label.fontPx}px ${LABEL_STYLE.font}`;
    if (label.glyphs) {
      drawGlyphs(ctx, label.glyphs, water ? LABEL_STYLE.waterInk : LABEL_STYLE.ink);
      continue;
    }
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

function isWaterName(feature: MapFeature): boolean {
  return feature.kind === 'river' || ((feature.kind === 'label' || feature.kind === 'region') && feature.tone === 'water');
}

function drawGlyphs(ctx: CanvasRenderingContext2D, glyphs: readonly Glyph[], ink: string): void {
  ctx.letterSpacing = '0px';
  ctx.textAlign = 'center';
  for (const g of glyphs) {
    ctx.save();
    ctx.translate(g.x, g.y);
    ctx.rotate(g.angle);
    ctx.strokeStyle = LABEL_STYLE.halo;
    ctx.lineWidth = LABEL_STYLE.haloWidthPx;
    ctx.strokeText(g.ch, 0, 0);
    ctx.fillStyle = ink;
    ctx.fillText(g.ch, 0, 0);
    ctx.restore();
  }
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
