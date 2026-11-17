/**
 * Lakes placed by the user: a point of the bed and a water level.
 *
 * Why not "every filled pit is a lake"? At 1 km per cell, a gorge narrower
 * than a cell vanishes into the average altitude of its slopes: it becomes a
 * dam, and priority-flood drowns the whole basin behind it (Lake Biwa's basin
 * filled to 193 m instead of 85 m). The fill is right for routing water, not
 * for drawing it. So lakes are explicit, and only their extent is computed.
 *
 * Extent = cells strictly below the level, connected (8 neighbours) to the
 * seed, never sea. The level is capped at the spill level (filledM at the
 * seed): above it, the water would flow out. Below the spill level everything
 * connected and lower is part of the same basin, so the flood cannot leak.
 */

export interface LakeSeed {
  readonly xCell: number;
  readonly yCell: number;
  /** Water level (m); null = brim-full (the spill level). */
  readonly surfaceM: number | null;
}

export interface LakeInfo {
  /** Effective water level (m), after capping at the spill level. */
  readonly surfaceM: number;
  /** 0 when the seed is not below the level (a dry lake: nothing drawn). */
  readonly areaCells: number;
}

export interface Lakes {
  /** Per cell: 0 = no lake, k + 1 = lake of seeds[k] (row-major). */
  readonly lakeId: Uint16Array;
  /** One per seed, same order. */
  readonly lakes: readonly LakeInfo[];
}

/** At most 65535 lakes (Uint16 ids). Seeds beyond are ignored. */
export const MAX_LAKES = 65535;

export function computeLakes(
  altitudeM: Int16Array,
  filledM: Int16Array,
  sea: Uint8Array,
  widthCells: number,
  heightCells: number,
  seeds: readonly LakeSeed[],
): Lakes {
  const w = widthCells;
  const h = heightCells;
  const lakeId = new Uint16Array(w * h);
  const queue = new Int32Array(w * h);
  const lakes: LakeInfo[] = [];
  seeds.slice(0, MAX_LAKES).forEach((seed, k) => {
    const x = Math.floor(seed.xCell);
    const y = Math.floor(seed.yCell);
    if (x < 0 || y < 0 || x >= w || y >= h) {
      lakes.push({ surfaceM: seed.surfaceM ?? 0, areaCells: 0 });
      return;
    }
    const start = y * w + x;
    const spillM = filledM[start];
    const levelM = seed.surfaceM === null ? spillM : Math.min(seed.surfaceM, spillM);
    // Brim-full on a flat (filled == altitude, e.g. a real lake surface in the data): nothing below.
    const id = k + 1;
    let area = 0;
    if (!sea[start] && lakeId[start] === 0 && altitudeM[start] < levelM) {
      let tail = 0;
      lakeId[start] = id;
      queue[tail++] = start;
      for (let q = 0; q < tail; q++) {
        const i = queue[q];
        area++;
        const cx = i % w;
        const cy = (i - cx) / w;
        for (let ny = Math.max(0, cy - 1); ny <= Math.min(h - 1, cy + 1); ny++) {
          for (let nx = Math.max(0, cx - 1); nx <= Math.min(w - 1, cx + 1); nx++) {
            const j = ny * w + nx;
            if (lakeId[j] === 0 && !sea[j] && altitudeM[j] < levelM) {
              lakeId[j] = id;
              queue[tail++] = j;
            }
          }
        }
      }
    }
    lakes.push({ surfaceM: levelM, areaCells: area });
  });
  return { lakeId, lakes };
}
