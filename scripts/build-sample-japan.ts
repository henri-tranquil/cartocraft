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
import { clampInt16, setCell } from '../src/app/domain/terrain/tiled-grid';
import { exportMapToBlob } from '../src/app/infrastructure/persistence/map-file';
import { SAMPLE_JAPAN } from '../src/app/application/samples';

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

async function main(): Promise<void> {
  const nowIso = new Date().toISOString();
  const map = MapFactory.blank(settings, { id: SAMPLE_JAPAN.id, name: SAMPLE_JAPAN.name, nowIso });
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
  await mkdir(dirname(OUT), { recursive: true });
  const blob = await exportMapToBlob(map);
  await writeFile(OUT, Buffer.from(await blob.arrayBuffer()));
  console.log(`\n→ ${OUT} (${(blob.size / 1e6).toFixed(1)} Mo, ${tiles.size} tuiles)`);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
