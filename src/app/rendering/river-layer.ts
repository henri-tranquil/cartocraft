import { RiverNetwork } from '../domain/hydrology/rivers';
import { MIN_RIVER_DISCHARGE_M3S } from '../domain/hydrology/rivers';
import { Viewport } from './viewport';

/**
 * Rivers, drawn as vector lines over the terrain in screen space (sharp at
 * every zoom, like the names).
 *
 * Semantic zoom by discharge: the smallest flow shown falls as the scale
 * grows (RIVER_STYLE.dischargePerPx / px-per-km), so the whole-map view keeps
 * the big rivers and the valley view shows every stream. Width grows with the
 * log of the flow relative to that threshold: a river looks "big" compared to
 * what is visible, not in absolute terms.
 *
 * The D8 drainage only moves in 8 directions, which makes staircases; two
 * rounds of Chaikin corner cutting (each corner replaced by two points at ¼
 * and ¾ of its edges) turn them into smooth curves.
 */
export interface RiverStyle {
  readonly colour: string;
  /** Shown discharge threshold = dischargePerPx / (px per km), m³/s. */
  readonly dischargePerPx: number;
  readonly minWidthPx: number;
  readonly maxWidthPx: number;
}

export const EDIT_RIVER_STYLE: RiverStyle = { colour: 'rgb(38 98 168)', dischargePerPx: 40, minWidthPx: 0.8, maxWidthPx: 3.5 };
export const VINTAGE_RIVER_STYLE: RiverStyle = { colour: 'rgb(44 86 104)', dischargePerPx: 40, minWidthPx: 0.8, maxWidthPx: 3.2 };

export function visibleDischargeM3s(style: RiverStyle, pxPerKm: number): number {
  return Math.max(MIN_RIVER_DISCHARGE_M3S, style.dischargePerPx / pxPerKm);
}

export function riverWidthPx(style: RiverStyle, dischargeM3s: number, thresholdM3s: number): number {
  return Math.min(style.maxWidthPx, style.minWidthPx + 0.55 * Math.log2(dischargeM3s / thresholdM3s + 1));
}

/** Two rounds of Chaikin corner cutting on an open polyline (ends kept), with a value carried along. */
export function chaikin(xs: number[], ys: number[], vs: number[], rounds = 2): { xs: number[]; ys: number[]; vs: number[] } {
  let px = xs;
  let py = ys;
  let pv = vs;
  for (let r = 0; r < rounds && px.length > 2; r++) {
    const nx = [px[0]];
    const ny = [py[0]];
    const nv = [pv[0]];
    for (let i = 0; i < px.length - 1; i++) {
      nx.push(0.75 * px[i] + 0.25 * px[i + 1], 0.25 * px[i] + 0.75 * px[i + 1]);
      ny.push(0.75 * py[i] + 0.25 * py[i + 1], 0.25 * py[i] + 0.75 * py[i + 1]);
      nv.push(0.75 * pv[i] + 0.25 * pv[i + 1], 0.25 * pv[i] + 0.75 * pv[i + 1]);
    }
    nx.push(px[px.length - 1]);
    ny.push(py[py.length - 1]);
    nv.push(pv[pv.length - 1]);
    px = nx;
    py = ny;
    pv = nv;
  }
  return { xs: px, ys: py, vs: pv };
}

export function drawRivers(ctx: CanvasRenderingContext2D, vp: Viewport, network: RiverNetwork, cellKm: number, style: RiverStyle): void {
  const threshold = visibleDischargeM3s(style, vp.pixelsPerCell / cellKm);
  const halfW = vp.widthPx / 2;
  const halfH = vp.heightPx / 2;
  const sx = (x: number) => (x - vp.centerX) * vp.pixelsPerCell + halfW;
  const sy = (y: number) => (y - vp.centerY) * vp.pixelsPerCell + halfH;
  const { pointsCells: pts, dischargeM3s: q, starts, lineMaxDischargeM3s: lineMax, lineBounds: b } = network;

  ctx.save();
  ctx.strokeStyle = style.colour;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  for (let k = 0; k < starts.length - 1; k++) {
    if (lineMax[k] < threshold) continue;
    if (sx(b[4 * k + 2]) < -4 || sx(b[4 * k]) > vp.widthPx + 4 || sy(b[4 * k + 3]) < -4 || sy(b[4 * k + 1]) > vp.heightPx + 4) continue;
    // Flow only grows downstream: skip the part of the line still below the threshold.
    let first = starts[k];
    while (first < starts[k + 1] - 1 && q[first] < threshold) first++;
    const xs: number[] = [];
    const ys: number[] = [];
    const vs: number[] = [];
    for (let p = first; p < starts[k + 1]; p++) {
      xs.push(sx(pts[2 * p]));
      ys.push(sy(pts[2 * p + 1]));
      vs.push(q[p]);
    }
    if (xs.length < 2) continue;
    const smooth = chaikin(xs, ys, vs);
    // One stroke per run of equal (quarter-pixel) width: few canvas calls, smooth tapering.
    let runWidth = -1;
    ctx.beginPath();
    for (let i = 0; i < smooth.xs.length; i++) {
      const width = Math.round(riverWidthPx(style, smooth.vs[i], threshold) * 4) / 4;
      if (i === 0) {
        runWidth = width;
        ctx.moveTo(smooth.xs[0], smooth.ys[0]);
        continue;
      }
      ctx.lineTo(smooth.xs[i], smooth.ys[i]);
      if (width !== runWidth || i === smooth.xs.length - 1) {
        ctx.lineWidth = runWidth;
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(smooth.xs[i], smooth.ys[i]);
        runWidth = width;
      }
    }
  }
  ctx.restore();
}
