import { VintageInput } from '../vintage-pixels';

/** Typed messages between the main thread and the rendered-view worker. */
export interface VintageBuildRequest {
  readonly kind: 'build';
  readonly requestId: number;
  readonly input: VintageInput;
}

export type VintageWorkerRequest = VintageBuildRequest;

export interface VintageBuilt {
  readonly widthCells: number;
  readonly heightCells: number;
  /** RGBA, 1 pixel per cell, row-major. */
  readonly pixels: Uint8ClampedArray<ArrayBuffer>;
  /** Coastline segments [x0, y0, x1, y1, …] in cell coordinates. */
  readonly coast: Float32Array<ArrayBuffer>;
  /** Mountain glyphs per level of detail, GLYPH_STRIDE floats each, sorted back to front. */
  readonly mountains: readonly Float32Array<ArrayBuffer>[];
  /** Trees per level of detail, TREE_STRIDE floats each, sorted back to front. */
  readonly forests: readonly Float32Array<ArrayBuffer>[];
  readonly durationMs: number;
}

export type VintageWorkerResponse =
  | { readonly kind: 'built'; readonly requestId: number; readonly built: VintageBuilt }
  | { readonly kind: 'error'; readonly requestId: number; readonly message: string };
