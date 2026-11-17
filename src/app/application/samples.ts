/**
 * Bundled sample maps (plain data, no Angular: also read by the build script).
 * Bump `version` whenever the file is regenerated: the app then replaces the
 * local copy (local edits to a sample are lost on update — it is a test map).
 */
export interface SampleMap {
  readonly id: string;
  readonly name: string;
  readonly version: number;
  /** Relative to the app base href (works under /cartocraft/ on GitHub Pages). */
  readonly path: string;
}

export const SAMPLE_JAPAN: SampleMap = {
  id: 'sample-japon',
  name: 'Japon (exemple)',
  version: 1,
  path: 'samples/japon.cartocraft',
};

export const SAMPLE_MAPS: readonly SampleMap[] = [SAMPLE_JAPAN];
