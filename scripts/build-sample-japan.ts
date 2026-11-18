/**
 * Builds the "Japon" test map from real elevation data.
 *
 *   npm run sample:japan
 *
 * Source: AWS Terrain Tiles, "Terrarium" encoding (public dataset, SRTM land
 * relief + ocean bathymetry), zoom 7 (~1 km per pixel at Japan's latitude).
 * Tiles are cached in scripts/.cache. Output: public/samples/japon.cartocraft,
 * loaded into IndexedDB by the app (SampleMaps service).
 *
 * PROJECTION. Our maps have rows linear in latitude and columns in kilometres.
 * We use a sinusoidal projection centred on 137.5° E: a row is a parallel, and
 * along it 1 km = 1/(111.32·cos φ) degree of longitude. Widths and areas stay
 * true everywhere; only shapes far from the central meridian lean a little.
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';
import { MapFactory } from '../src/app/domain/map/map-factory';
import { MapSettings } from '../src/app/domain/map/map-settings';
import { clampInt16, setCell, toRowMajor } from '../src/app/domain/terrain/tiled-grid';
import { drawingFromAltitudes } from '../src/app/domain/drawing/drawing-from-altitudes';
import { exportMapToBlob } from '../src/app/infrastructure/persistence/map-file';
import { SAMPLE_JAPAN } from '../src/app/application/samples';
import { createFeature, MapFeature } from '../src/app/domain/features/map-feature';
import { poleOfInaccessibility } from '../src/app/domain/features/polygon';
import { computeClimateRun } from '../src/app/domain/climate/climate-run';
import { buildClimateInput } from '../src/app/application/climate';
import { RiverNetwork } from '../src/app/domain/hydrology/rivers';
import { JAPAN_PLACES } from './japan-places';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CACHE = join(ROOT, 'scripts/.cache/terrarium');
const OUT = join(ROOT, 'public/samples/japon.cartocraft');
const ZOOM = 7;
const TILE_PX = 256;
const KM_PER_DEG_LAT = 111.32;

const CENTRAL_LON = 137.5;
const settings: MapSettings = {
  widthKm: 1700,
  heightKm: 1700,
  baseCellKm: 1,
  seed: 1868, // Meiji
  latitudeTopDeg: 46,
  latitudeBottomDeg: 46 - 1700 / KM_PER_DEG_LAT, // ≈ 30.7° N: 1 cell = 1 km north–south too
  axialTiltDeg: 23.44,
  seaLevelM: 0,
  globalTemperatureOffsetC: 0,
  // Siberia / Manchuria lie north (cold winters, the winter monsoon); the Pacific east and south.
  // West stays 'continue': that edge is half Korea / Primorye, half Yellow and East China seas.
  beyondEdges: { north: 'land', south: 'ocean', east: 'ocean', west: 'continue' },
};

// --- Web-Mercator tile maths (the tiles' own projection) ---
const tileCount = 2 ** ZOOM;
function lonToTileX(lon: number): number {
  return ((lon + 180) / 360) * tileCount;
}
function latToTileY(lat: number): number {
  const r = (lat * Math.PI) / 180;
  return ((1 - Math.asinh(Math.tan(r)) / Math.PI) / 2) * tileCount;
}

const tiles = new Map<string, Float32Array>();

async function loadTile(tx: number, ty: number): Promise<Float32Array> {
  const key = `${tx}/${ty}`;
  const cached = tiles.get(key);
  if (cached) return cached;
  const file = join(CACHE, `${ZOOM}-${tx}-${ty}.png`);
  if (!existsSync(file)) {
    const url = `https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${ZOOM}/${tx}/${ty}.png`;
    const response = await fetch(url);
    if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
    await mkdir(CACHE, { recursive: true });
    await writeFile(file, Buffer.from(await response.arrayBuffer()));
    process.stdout.write('.');
  }
  const png = PNG.sync.read(await readFile(file));
  const elevation = new Float32Array(TILE_PX * TILE_PX);
  for (let i = 0; i < elevation.length; i++) {
    // Terrarium: metres = R·256 + G + B/256 − 32768
    elevation[i] = png.data[i * 4] * 256 + png.data[i * 4 + 1] + png.data[i * 4 + 2] / 256 - 32768;
  }
  tiles.set(key, elevation);
  return elevation;
}

async function pixel(gx: number, gy: number): Promise<number> {
  const tx = Math.floor(gx / TILE_PX);
  const ty = Math.floor(gy / TILE_PX);
  const tile = await loadTile(tx, ty);
  return tile[(gy - ty * TILE_PX) * TILE_PX + (gx - tx * TILE_PX)];
}

/** Bilinear sample in global tile-pixel space. */
async function elevationAt(lat: number, lon: number): Promise<number> {
  const gx = lonToTileX(lon) * TILE_PX - 0.5;
  const gy = latToTileY(lat) * TILE_PX - 0.5;
  const x0 = Math.floor(gx);
  const y0 = Math.floor(gy);
  const fx = gx - x0;
  const fy = gy - y0;
  const a = await pixel(x0, y0);
  const b = await pixel(x0 + 1, y0);
  const c = await pixel(x0, y0 + 1);
  const d = await pixel(x0 + 1, y0 + 1);
  return (a * (1 - fx) + b * fx) * (1 - fy) + (c * (1 - fx) + d * fx) * fy;
}

/** Inverse of the per-cell projection used for the relief (km from the top-left corner). */
function projectKm(lat: number, lon: number): [number, number] {
  const kmPerDegLon = KM_PER_DEG_LAT * Math.cos((lat * Math.PI) / 180);
  return [(lon - CENTRAL_LON) * kmPerDegLon + settings.widthKm / 2, (settings.latitudeTopDeg - lat) * KM_PER_DEG_LAT];
}

const round2 = (v: number) => Math.round(v * 100) / 100;

/** Anchors are given roughly: snap each onto the BIGGEST computed river within this distance. */
const RIVER_SNAP_CELLS = 8;

function snapToRiver(network: RiverNetwork, x: number, y: number): [number, number] | null {
  let best = -1;
  for (let p = 0; p < network.dischargeM3s.length; p++) {
    const dx = network.pointsCells[2 * p] - x;
    const dy = network.pointsCells[2 * p + 1] - y;
    if (dx * dx + dy * dy <= RIVER_SNAP_CELLS ** 2 && (best < 0 || network.dischargeM3s[p] > network.dischargeM3s[best])) best = p;
  }
  return best < 0 ? null : [network.pointsCells[2 * best], network.pointsCells[2 * best + 1]];
}

function japanFeatures(rivers: RiverNetwork): MapFeature[] {
  return JAPAN_PLACES.flatMap((place, i): MapFeature[] => {
    const id = `japon-${i}`;
    let feature: MapFeature;
    if (place.template.kind === 'river' && place.at) {
      const [x, y] = projectKm(place.at[0], place.at[1]);
      const snapped = snapToRiver(rivers, x, y);
      if (!snapped) {
        console.warn(`\n${place.name}: no computed river nearby, skipped`);
        return [];
      }
      feature = createFeature(place.template, id, place.name, round2(snapped[0]), round2(snapped[1]));
    } else if (place.outline && place.template.kind === 'range') {
      const pathKm: number[] = [];
      for (let k = 0; k < place.outline.length; k += 2) pathKm.push(...projectKm(place.outline[k], place.outline[k + 1]).map(round2));
      const middle = Math.floor(pathKm.length / 4) * 2;
      feature = createFeature(place.template, id, place.name, pathKm[middle], pathKm[middle + 1], pathKm);
    } else if (place.outline) {
      const outlineKm: number[] = [];
      for (let k = 0; k < place.outline.length; k += 2) outlineKm.push(...projectKm(place.outline[k], place.outline[k + 1]).map(round2));
      const pole = poleOfInaccessibility(outlineKm, 0.5);
      feature = createFeature(place.template, id, place.name, round2(pole.x), round2(pole.y), outlineKm);
    } else if (place.at) {
      const [x, y] = projectKm(place.at[0], place.at[1]);
      feature = createFeature(place.template, id, place.name, round2(x), round2(y));
      if (feature.kind === 'lake' && place.lakeLevelM !== undefined) feature = { ...feature, surfaceM: place.lakeLevelM };
    } else {
      throw new Error(`${place.name}: no position`);
    }
    return [place.rank ? { ...feature, rank: place.rank } : feature];
  });
}

async function main(): Promise<void> {
  const nowIso = new Date().toISOString();
  const map = MapFactory.blank(settings, { id: SAMPLE_JAPAN.id, name: SAMPLE_JAPAN.name, nowIso }, 'world');
  const grid = map.terrain.baseAltitudeM;
  const { widthCells: w, heightCells: h } = grid;
  process.stdout.write(`Japon ${w}×${h} cells, fetching tiles `);
  for (let y = 0; y < h; y++) {
    const lat = settings.latitudeTopDeg + ((settings.latitudeBottomDeg - settings.latitudeTopDeg) * (y + 0.5)) / h;
    const kmPerDegLon = KM_PER_DEG_LAT * Math.cos((lat * Math.PI) / 180);
    for (let x = 0; x < w; x++) {
      const lon = CENTRAL_LON + (x + 0.5 - w / 2) / kmPerDegLon;
      setCell(grid, x, y, clampInt16(Math.round(await elevationAt(lat, lon))));
    }
  }
  // First drawing guessed from the altitudes (same rule as the v3 → v4 migration); D7 will refine it.
  const drawing = drawingFromAltitudes(toRowMajor(grid), w, h, settings.seaLevelM);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) setCell(map.terrain.drawing, x, y, drawing[y * w + x]);
  // River names snap onto the rivers the app will compute (same climate + hydrology run).
  const { hydrology } = computeClimateRun(buildClimateInput(map));
  map.features.push(...japanFeatures(hydrology.rivers));
  await mkdir(dirname(OUT), { recursive: true });
  const blob = await exportMapToBlob(map);
  await writeFile(OUT, Buffer.from(await blob.arrayBuffer()));
  console.log(`\n→ ${OUT} (${(blob.size / 1e6).toFixed(1)} Mo, ${tiles.size} tuiles)`);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
