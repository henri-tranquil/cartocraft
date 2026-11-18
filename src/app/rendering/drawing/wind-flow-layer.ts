import { AirStreamline } from '../../domain/drawing/drawing-winds';
import { DrawingWeather } from '../../domain/drawing/drawing-weather';
import { cellToScreen, screenToCell, Viewport } from '../viewport';

/**
 * Wind overlay of the Draw step, like a weather animation: each streamline
 * is a faint track along which short luminous traces run in the direction of
 * the air. Colour = air temperature (blue cold → red warm, same stops as the
 * legend, `--cc-wind-*` in styles.scss); width = humidity (dry air thin,
 * moist air thick).
 *
 * Everything is in SCREEN pixels (spacing, speed, trace length): the
 * animation keeps the same look at every zoom.
 */
const WIND_STYLE = {
  /** [°C, r, g, b] colour stops of the temperature scale. */
  stops: [
    [-15, 44, 79, 180],
    [0, 140, 190, 235],
    [15, 240, 200, 120],
    [30, 210, 60, 40],
  ],
  trackAlpha: 0.18,
  trackWidthPx: 1,
  /** Distance between two traces on a streamline, trace length, speed. */
  spacingPx: 140,
  traceLengthPx: 46,
  speedPxPerS: 60,
  /** Pieces of a trace (alpha and width ramp up towards the head). */
  tracePieces: 5,
  /** Trace width at the head for dry and for saturated air. */
  dryWidthPx: 1.4,
  wetWidthPx: 4,
} as const;

export function drawWindFlows(ctx: CanvasRenderingContext2D, vp: Viewport, cellKm: number, lines: readonly AirStreamline[], timeS: number): void {
  const topLeft = screenToCell(vp, 0, 0);
  const bottomRight = screenToCell(vp, vp.widthPx, vp.heightPx);
  const view = { x0: topLeft.x * cellKm, y0: topLeft.y * cellKm, x1: bottomRight.x * cellKm, y1: bottomRight.y * cellKm };
  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  for (const line of lines) {
    const b = line.box;
    if (b.x1 < view.x0 || b.x0 > view.x1 || b.y1 < view.y0 || b.y0 > view.y1) continue;
    drawStreamline(ctx, vp, cellKm, line, timeS);
  }
  ctx.restore();
}

function drawStreamline(ctx: CanvasRenderingContext2D, vp: Viewport, cellKm: number, line: AirStreamline, timeS: number): void {
  const n = line.tempC.length;
  const xs = new Float32Array(n);
  const ys = new Float32Array(n);
  // Arc length along the line, screen px.
  const along = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const s = cellToScreen(vp, line.pointsKm[2 * i] / cellKm, line.pointsKm[2 * i + 1] / cellKm);
    xs[i] = s.x;
    ys[i] = s.y;
    if (i > 0) along[i] = along[i - 1] + Math.hypot(xs[i] - xs[i - 1], ys[i] - ys[i - 1]);
  }
  const total = along[n - 1];
  if (total < 2) return;

  // The faint track, coloured by the temperature at its middle.
  ctx.lineWidth = WIND_STYLE.trackWidthPx;
  ctx.strokeStyle = colour(line.tempC[n >> 1], WIND_STYLE.trackAlpha);
  ctx.beginPath();
  ctx.moveTo(xs[0], ys[0]);
  for (let i = 1; i < n; i++) ctx.lineTo(xs[i], ys[i]);
  ctx.stroke();

  // The running traces: heads every `spacingPx`, moving downwind. The phase depends on where
  // the line starts, so neighbouring lines do not march in step.
  const { spacingPx, traceLengthPx, tracePieces } = WIND_STYLE;
  const phase = ((line.pointsKm[0] * 7.31 + line.pointsKm[1] * 3.17) % 1000) / 1000;
  const offset = (timeS * WIND_STYLE.speedPxPerS + phase * spacingPx) % spacingPx;
  const piece = traceLengthPx / tracePieces;
  let cursor = 0;
  for (let head = offset; head - traceLengthPx < total; head += spacingPx) {
    for (let k = 0; k < tracePieces; k++) {
      const a = head - traceLengthPx + k * piece;
      const b = a + piece;
      if (b <= 0 || a >= total) continue;
      const from = Math.max(0, a);
      const to = Math.min(total, b);
      while (cursor > 0 && along[cursor] > from) cursor--;
      while (cursor < n - 2 && along[cursor + 1] < from) cursor++;
      const t = (k + 1) / tracePieces;
      const humidity = valueAt(line.humidity, along, cursor, from);
      ctx.lineWidth = (WIND_STYLE.dryWidthPx + (WIND_STYLE.wetWidthPx - WIND_STYLE.dryWidthPx) * Math.sqrt(humidity)) * (0.4 + 0.6 * t);
      ctx.strokeStyle = colour(valueAt(line.tempC, along, cursor, from), 0.85 * t);
      ctx.beginPath();
      const p0 = pointAt(xs, ys, along, cursor, from);
      ctx.moveTo(p0[0], p0[1]);
      let j = cursor + 1;
      while (j < n && along[j] < to) {
        ctx.lineTo(xs[j], ys[j]);
        j++;
      }
      const p1 = pointAt(xs, ys, along, Math.max(cursor, j - 1), to);
      ctx.lineTo(p1[0], p1[1]);
      ctx.stroke();
    }
  }
}

function pointAt(xs: Float32Array, ys: Float32Array, along: Float32Array, i: number, s: number): [number, number] {
  const j = Math.min(i + 1, along.length - 1);
  const span = along[j] - along[i];
  const t = span > 0 ? Math.min(1, Math.max(0, (s - along[i]) / span)) : 0;
  return [xs[i] + (xs[j] - xs[i]) * t, ys[i] + (ys[j] - ys[i]) * t];
}

function valueAt(values: Float32Array, along: Float32Array, i: number, s: number): number {
  const j = Math.min(i + 1, along.length - 1);
  const span = along[j] - along[i];
  const t = span > 0 ? Math.min(1, Math.max(0, (s - along[i]) / span)) : 0;
  return values[i] + (values[j] - values[i]) * t;
}

/** Colour of an air temperature on the blue → red scale. */
function colour(tempC: number, alpha: number): string {
  const stops = WIND_STYLE.stops;
  let i = 1;
  while (i < stops.length - 1 && tempC > stops[i][0]) i++;
  const [t0, r0, g0, b0] = stops[i - 1];
  const [t1, r1, g1, b1] = stops[i];
  const t = Math.min(1, Math.max(0, (tempC - t0) / (t1 - t0)));
  const mix = (a: number, b: number) => Math.round(a + (b - a) * t);
  return `rgb(${mix(r0, r1)} ${mix(g0, g1)} ${mix(b0, b1)} / ${alpha.toFixed(3)})`;
}

/** Fronts: a violet veil where air masses meet (as on weather maps, where fronts are drawn in colour). */
const FRONT_COLOUR = [128, 64, 170] as const;
const FRONT_MAX_ALPHA = 0.35;
let frontCache: { weather: DrawingWeather; canvas: HTMLCanvasElement } | null = null;

export function drawFronts(ctx: CanvasRenderingContext2D, vp: Viewport, cellKm: number, weather: DrawingWeather): void {
  if (frontCache?.weather !== weather) {
    const canvas = document.createElement('canvas');
    canvas.width = weather.widthCells;
    canvas.height = weather.heightCells;
    const image = new ImageData(weather.widthCells, weather.heightCells);
    for (let i = 0; i < weather.frontiness.length; i++) {
      image.data[4 * i] = FRONT_COLOUR[0];
      image.data[4 * i + 1] = FRONT_COLOUR[1];
      image.data[4 * i + 2] = FRONT_COLOUR[2];
      image.data[4 * i + 3] = Math.round(255 * FRONT_MAX_ALPHA * weather.frontiness[i]);
    }
    canvas.getContext('2d')?.putImageData(image, 0, 0);
    frontCache = { weather, canvas };
  }
  const topLeft = cellToScreen(vp, 0, 0);
  const sizeCells = weather.cellKm / cellKm;
  ctx.save();
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(frontCache.canvas, topLeft.x, topLeft.y, weather.widthCells * sizeCells * vp.pixelsPerCell, weather.heightCells * sizeCells * vp.pixelsPerCell);
  ctx.restore();
}
