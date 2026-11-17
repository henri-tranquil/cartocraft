/**
 * Text along a curved path (river and range names), the classic look of
 * hand-lettered maps.
 *
 * Each letter is placed on its own: walk the path by arc length (s), put the
 * letter's centre at s, and rotate it along the local direction, measured
 * over the letter's own width (a chord from s − w/2 to s + w/2), which keeps
 * letters from twisting on small wiggles.
 *
 * Paths are read left to right: a path drawn eastward-to-westward is
 * reversed first, so names are never upside down.
 */

export interface Glyph {
  readonly ch: string;
  /** Centre of the letter, screen px. */
  readonly x: number;
  readonly y: number;
  /** Radians, 0 = horizontal. */
  readonly angle: number;
  readonly widthPx: number;
}

/** Width of one character (px) at the given font size. */
export type CharMeasure = (ch: string, fontPx: number) => number;

/** Cumulative arc length at each vertex (first = 0). */
export function cumulativeLength(xs: readonly number[], ys: readonly number[]): number[] {
  const s = [0];
  for (let i = 1; i < xs.length; i++) s.push(s[i - 1] + Math.hypot(xs[i] - xs[i - 1], ys[i] - ys[i - 1]));
  return s;
}

/** Point at arc length `at` (clamped to the path). */
export function pointAtLength(xs: readonly number[], ys: readonly number[], cum: readonly number[], at: number): { x: number; y: number } {
  const total = cum[cum.length - 1];
  const s = Math.max(0, Math.min(total, at));
  let lo = 0;
  let hi = cum.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (cum[mid] <= s) lo = mid;
    else hi = mid;
  }
  const span = cum[hi] - cum[lo];
  const f = span > 0 ? (s - cum[lo]) / span : 0;
  return { x: xs[lo] + (xs[hi] - xs[lo]) * f, y: ys[lo] + (ys[hi] - ys[lo]) * f };
}

/**
 * Letters of `text` centred at arc length `centerS` (shifted to stay on the
 * path). Null when the text is longer than `maxFill` × the path length.
 */
export function layoutTextOnPath(
  text: string,
  pathXs: readonly number[],
  pathYs: readonly number[],
  centerS: number,
  fontPx: number,
  spacingPx: number,
  measure: CharMeasure,
  maxFill = 0.95,
): Glyph[] | null {
  if (pathXs.length < 2) return null;
  let xs = pathXs;
  let ys = pathYs;
  let cum = cumulativeLength(xs, ys);
  const total = cum[cum.length - 1];
  let center = centerS;
  if (xs[xs.length - 1] < xs[0]) {
    xs = [...xs].reverse();
    ys = [...ys].reverse();
    cum = cumulativeLength(xs, ys);
    center = total - centerS;
  }

  const chars = [...text];
  const widths = chars.map((ch) => measure(ch, fontPx));
  const textLength = widths.reduce((a, b) => a + b, 0) + spacingPx * (chars.length - 1);
  if (textLength > total * maxFill) return null;

  let s = Math.max(0, Math.min(total - textLength, center - textLength / 2));
  const glyphs: Glyph[] = [];
  chars.forEach((ch, k) => {
    const w = widths[k];
    const mid = pointAtLength(xs, ys, cum, s + w / 2);
    const a = pointAtLength(xs, ys, cum, s);
    const b = pointAtLength(xs, ys, cum, s + Math.max(w, 1));
    glyphs.push({ ch, x: mid.x, y: mid.y, angle: Math.atan2(b.y - a.y, b.x - a.x), widthPx: w });
    s += w + spacingPx;
  });
  return glyphs;
}
