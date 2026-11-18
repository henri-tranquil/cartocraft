import { formatLatitude, LatitudePin, rowAtLatitude } from '../domain/map/latitude';
import { cellToScreen, Viewport } from './viewport';

export interface LatitudeOverlayInput {
  readonly latitudeTopDeg: number;
  readonly latitudeBottomDeg: number;
  readonly axialTiltDeg: number;
  readonly widthCells: number;
  readonly heightCells: number;
  readonly pins: readonly [LatitudePin, LatitudePin];
  /** Handle under the pointer or being dragged, highlighted. */
  readonly active: LatitudeHandle | null;
}

/**
 * What can be dragged on the ruler: one of the two pins, the tilt lines
 * (tropics, polar circles), or the ruler itself (scrolls the latitudes, scale kept).
 */
export type LatitudeHandle = 0 | 1 | 'tropic' | 'polar' | 'ruler';

/** Latitudes of the lines set by the axial tilt: tropics at ±tilt, polar circles at ±(90° − tilt). */
export function tiltLines(axialTiltDeg: number): { latitudeDeg: number; kind: 'tropic' | 'polar'; name: string }[] {
  return [
    { latitudeDeg: axialTiltDeg, kind: 'tropic', name: 'Tropique du Cancer' },
    { latitudeDeg: -axialTiltDeg, kind: 'tropic', name: 'Tropique du Capricorne' },
    { latitudeDeg: 90 - axialTiltDeg, kind: 'polar', name: 'Cercle arctique' },
    { latitudeDeg: -(90 - axialTiltDeg), kind: 'polar', name: 'Cercle antarctique' },
  ];
}

/** Overlay colours, kept in line with the UI theme tokens (canvas cannot read CSS variables cheaply). */
const INK = '#1f1a13';
const PANEL = '#f3e9d2';
const ACCENT = '#e0a43a';
const ACTIVE = '#2f6b5a';

const RULER_WIDTH_PX = 44;
/** Minimum spacing between two labelled graduations. */
const MIN_LABEL_SPACING_PX = 32;
const STEPS_DEG = [0.1, 0.2, 0.5, 1, 2, 5, 10, 15, 30];
const FONT = '600 11px "Space Grotesk", sans-serif';
export const PIN_HIT_TOLERANCE_PX = 8;

/** Is the screen point on the ruler strip (left edge of the visible map)? */
export function rulerContains(vp: Viewport, widthCells: number, heightCells: number, sx: number, sy: number): boolean {
  const left = Math.max(0, cellToScreen(vp, 0, 0).x);
  const right = Math.min(vp.widthPx, cellToScreen(vp, widthCells, 0).x);
  const top = Math.max(0, cellToScreen(vp, 0, 0).y);
  const bottom = Math.min(vp.heightPx, cellToScreen(vp, 0, heightCells).y);
  return sx >= left && sx <= Math.min(right, left + RULER_WIDTH_PX) && sy >= top && sy <= bottom;
}

export function pinScreenY(vp: Viewport, pin: LatitudePin): number {
  return cellToScreen(vp, 0, pin.yCell).y;
}

/** Screen y of a latitude for the current (possibly previewed) edges. */
export function latitudeScreenY(
  vp: Viewport,
  input: Pick<LatitudeOverlayInput, 'latitudeTopDeg' | 'latitudeBottomDeg' | 'heightCells'>,
  latitudeDeg: number,
): number {
  return cellToScreen(vp, 0, rowAtLatitude(input, input.heightCells, latitudeDeg)).y;
}

export function drawLatitudeOverlay(ctx: CanvasRenderingContext2D, vp: Viewport, input: LatitudeOverlayInput): void {
  const mapLeft = Math.max(0, cellToScreen(vp, 0, 0).x);
  const mapRight = Math.min(vp.widthPx, cellToScreen(vp, input.widthCells, 0).x);
  const mapTop = Math.max(0, cellToScreen(vp, 0, 0).y);
  const mapBottom = Math.min(vp.heightPx, cellToScreen(vp, 0, input.heightCells).y);
  if (mapRight <= mapLeft || mapBottom <= mapTop) return;

  ctx.save();
  ctx.font = FONT;
  ctx.textBaseline = 'middle';

  drawNotableParallels(ctx, vp, input, mapLeft, mapRight, mapTop, mapBottom);
  drawRuler(ctx, vp, input, mapLeft, mapTop, mapBottom);
  input.pins.forEach((pin, i) => drawPin(ctx, vp, pin, mapLeft, mapRight, input.active === i));

  ctx.restore();
}

/**
 * Equator, tropics (±tilt: the sun can be overhead there) and polar circles
 * (90° − tilt: polar day/night). Tropics and polar circles are draggable:
 * moving one sets the axial tilt.
 */
function drawNotableParallels(
  ctx: CanvasRenderingContext2D,
  vp: Viewport,
  input: LatitudeOverlayInput,
  left: number,
  right: number,
  top: number,
  bottom: number,
): void {
  const tiltActive = input.active === 'tropic' || input.active === 'polar';
  const parallels = [{ latitudeDeg: 0, kind: 'equator', name: 'Équateur' }, ...tiltLines(input.axialTiltDeg)];
  for (const { latitudeDeg, kind, name } of parallels) {
    const y = latitudeScreenY(vp, input, latitudeDeg);
    if (y < top || y > bottom) continue;
    const draggable = kind !== 'equator';
    ctx.setLineDash(draggable && tiltActive ? [] : [6, 5]);
    ctx.lineWidth = draggable && tiltActive ? 3 : 1.5;
    ctx.strokeStyle = draggable && tiltActive ? ACTIVE : INK;
    ctx.beginPath();
    ctx.moveTo(left, y);
    ctx.lineTo(right, y);
    ctx.stroke();
    const label = draggable ? `⇕ ${name} · inclinaison ${input.axialTiltDeg.toLocaleString('fr-FR', { maximumFractionDigits: 1 })}°` : name;
    labelBox(ctx, label, right - 8, y - 11, 'right', draggable ? (tiltActive ? ACTIVE : ACCENT) : PANEL, draggable && tiltActive);
  }
  ctx.setLineDash([]);
}

function drawRuler(ctx: CanvasRenderingContext2D, vp: Viewport, input: LatitudeOverlayInput, left: number, top: number, bottom: number): void {
  ctx.fillStyle = PANEL;
  ctx.fillRect(left, top, RULER_WIDTH_PX, bottom - top);
  const active = input.active === 'ruler';
  ctx.strokeStyle = active ? ACTIVE : INK;
  ctx.lineWidth = active ? 3 : 2;
  ctx.strokeRect(left + 1, top + 1, RULER_WIDTH_PX - 2, bottom - top - 2);

  const degPerPx = Math.abs(input.latitudeBottomDeg - input.latitudeTopDeg) / input.heightCells / vp.pixelsPerCell;
  const step = STEPS_DEG.find((s) => s / degPerPx >= MIN_LABEL_SPACING_PX) ?? 30;
  const minor = step / 2;
  const north = Math.max(input.latitudeTopDeg, input.latitudeBottomDeg);
  const south = Math.min(input.latitudeTopDeg, input.latitudeBottomDeg);
  const digits = step < 1 ? 1 : 0;

  ctx.fillStyle = INK;
  ctx.textAlign = 'left';
  for (let lat = Math.ceil(south / minor) * minor; lat <= north + 1e-9; lat += minor) {
    const y = latitudeScreenY(vp, input, lat);
    if (y < top + 2 || y > bottom - 2) continue;
    const major = Math.abs(lat / step - Math.round(lat / step)) < 1e-6;
    ctx.beginPath();
    ctx.lineWidth = major ? 2 : 1;
    ctx.moveTo(left + RULER_WIDTH_PX - (major ? 10 : 5), y);
    ctx.lineTo(left + RULER_WIDTH_PX, y);
    ctx.stroke();
    if (major) ctx.fillText(formatLatitude(lat, digits).replace(' ', ''), left + 4, y);
  }
}

function drawPin(ctx: CanvasRenderingContext2D, vp: Viewport, pin: LatitudePin, left: number, right: number, active: boolean): void {
  const y = pinScreenY(vp, pin);
  if (y < 0 || y > vp.heightPx) return;
  ctx.strokeStyle = active ? ACTIVE : INK;
  ctx.lineWidth = active ? 3 : 2;
  ctx.beginPath();
  ctx.moveTo(left, y);
  ctx.lineTo(right, y);
  ctx.stroke();
  labelBox(ctx, `⇕ ${formatLatitude(pin.latitudeDeg, 1)}`, left + RULER_WIDTH_PX + 6, y, 'left', active ? ACTIVE : ACCENT, active);
}

function labelBox(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  align: 'left' | 'right',
  fill: string,
  invert = false,
): void {
  const width = ctx.measureText(text).width + 12;
  const boxX = align === 'left' ? x : x - width;
  ctx.fillStyle = fill;
  ctx.fillRect(boxX, y - 10, width, 20);
  ctx.strokeStyle = INK;
  ctx.lineWidth = 2;
  ctx.strokeRect(boxX, y - 10, width, 20);
  ctx.fillStyle = invert ? PANEL : INK;
  ctx.textAlign = 'left';
  ctx.fillText(text, boxX + 6, y + 1);
}
