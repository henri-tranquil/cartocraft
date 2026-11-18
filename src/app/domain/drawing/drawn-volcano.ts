/**
 * A volcano of the drawing: a single cone, placed by a click. Not a zone of
 * the grid (a volcano is one mountain, not an area): a point in KM, kept in
 * the map header like the drawn rivers, drawn as its own pictogram.
 */
export interface DrawnVolcano {
  readonly id: string;
  readonly xKm: number;
  readonly yKm: number;
  readonly kind: VolcanoKind;
}

/** Chosen by the user: erupting stratovolcano, dormant smoking cone, wide shield volcano. */
export const VOLCANO_KINDS = ['erupting', 'smoking', 'shield'] as const;
export type VolcanoKind = (typeof VOLCANO_KINDS)[number];

/**
 * The volcano under the pointer: its pictogram stands ABOVE its base point,
 * so a click anywhere on the cone (up to `upPx` above the base, `halfWidthPx`
 * to each side) picks it. The nearest base wins when several overlap.
 */
export function volcanoAt(
  volcanoes: readonly DrawnVolcano[],
  xKm: number,
  yKm: number,
  kmPerPx: number,
  { upPx = 30, downPx = 6, halfWidthPx = 18 } = {},
): DrawnVolcano | null {
  let best: DrawnVolcano | null = null;
  let bestD = Infinity;
  for (const volcano of volcanoes) {
    const dxPx = (xKm - volcano.xKm) / kmPerPx;
    const abovePx = (volcano.yKm - yKm) / kmPerPx;
    if (Math.abs(dxPx) > halfWidthPx || abovePx > upPx || abovePx < -downPx) continue;
    const d = Math.hypot(dxPx, abovePx);
    if (d < bestD) {
      best = volcano;
      bestD = d;
    }
  }
  return best;
}

/** The volcano nearest to (x, y) within `maxKm`, for picking with the pointer. */
export function volcanoNear(volcanoes: readonly DrawnVolcano[], xKm: number, yKm: number, maxKm: number): DrawnVolcano | null {
  let best: DrawnVolcano | null = null;
  let bestD = maxKm;
  for (const volcano of volcanoes) {
    const d = Math.hypot(volcano.xKm - xKm, volcano.yKm - yKm);
    if (d <= bestD) {
      best = volcano;
      bestD = d;
    }
  }
  return best;
}
