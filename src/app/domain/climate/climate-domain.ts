import { BeyondEdges, EDGES_CONTINUE } from '../map/map-settings';
import { CoarseGrid } from './advection';

/**
 * The climate is computed on a coarse DOMAIN larger than the map: the air
 * does not stop at the frame. A margin around the map is filled according to
 * what lies beyond each edge ('continue' = the edge's terrain, 'ocean',
 * 'land'), and latitudes keep running past the top and bottom edges. Only
 * the map part is kept afterwards.
 */

/**
 * Width of the margin: about the reach of a pressure system and of advected
 * air, but at most half the map's side, so small maps stay cheap (a valley
 * does not need to know what lies 800 km away).
 */
export const MARGIN_KM = 800;
/** Upper bound for the domain side, in coarse cells (cost grows with its square). */
export const MAX_DOMAIN_CELLS_PER_SIDE = 320;
/** Height of a continent beyond the edge (plains: no orographic effect). */
const LAND_BEYOND_M = 200;

export interface ClimateDomain {
  /** The map part, in coarse cells (same factor/cellKm as the domain). */
  readonly map: CoarseGrid;
  /** Margin, in coarse cells, on every side. */
  readonly margin: number;
  readonly width: number;
  readonly height: number;
  readonly cellKm: number;
}

export function climateDomainFor(widthCells: number, heightCells: number, cellKm: number): ClimateDomain {
  const sideKm = Math.max(widthCells, heightCells) * cellKm;
  const marginKm = Math.min(MARGIN_KM, sideKm / 2);
  const factor = Math.max(1, Math.ceil((sideKm + 2 * marginKm) / (MAX_DOMAIN_CELLS_PER_SIDE * cellKm)));
  const coarseKm = factor * cellKm;
  const map: CoarseGrid = { width: Math.ceil(widthCells / factor), height: Math.ceil(heightCells / factor), factor, cellKm: coarseKm };
  const margin = Math.round(marginKm / coarseKm);
  return { map, margin, width: map.width + 2 * margin, height: map.height + 2 * margin, cellKm: coarseKm };
}

export type FieldKind = 'seaFraction' | 'heightM';

/** Pads a map-sized coarse field to the domain, filling the margin per edge. */
export function padField(field: Float32Array, domain: ClimateDomain, kind: FieldKind, edges: BeyondEdges = EDGES_CONTINUE): Float32Array {
  const { width: dw, height: dh, margin: m } = domain;
  const { width: cw, height: ch } = domain.map;
  const out = new Float32Array(dw * dh);
  for (let py = 0; py < dh; py++) {
    const my = py - m;
    const cy = Math.min(ch - 1, Math.max(0, my));
    const overY = my < 0 ? -my : my >= ch ? my - ch + 1 : 0;
    for (let px = 0; px < dw; px++) {
      const mx = px - m;
      const cx = Math.min(cw - 1, Math.max(0, mx));
      const overX = mx < 0 ? -mx : mx >= cw ? mx - cw + 1 : 0;
      let value = field[cy * cw + cx];
      if (overX > 0 || overY > 0) {
        // The edge we are furthest beyond decides (corners take the dominant side).
        const side = overX >= overY ? (mx < 0 ? edges.west : edges.east) : my < 0 ? edges.north : edges.south;
        if (side === 'ocean') value = kind === 'seaFraction' ? 1 : 0;
        else if (side === 'land') value = kind === 'seaFraction' ? 0 : LAND_BEYOND_M;
      }
      out[py * dw + px] = value;
    }
  }
  return out;
}

/** Copies the map part of a domain field out (map-sized coarse field). */
export function cropToMap(field: Float32Array, domain: ClimateDomain, out: Float32Array): Float32Array {
  const { width: dw, margin: m } = domain;
  const { width: cw, height: ch } = domain.map;
  for (let y = 0; y < ch; y++) out.set(field.subarray((y + m) * dw + m, (y + m) * dw + m + cw), y * cw);
  return out;
}
