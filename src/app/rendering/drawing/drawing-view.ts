import { WorldMap } from '../../domain/map/world-map';
import { CellRect } from '../../domain/terrain/tiled-grid';
import { cellToScreen, screenToCell, Viewport } from '../viewport';
import { CoveragePyramid, FOREST_VALUE, LAKE_VALUE, RELIEF_VALUE } from './coverage-pyramid';
import { DrawnRiver } from '../../domain/drawing/drawn-river';
import { drawDrawingGlyphs, glyphZoom, RELIEF_GLYPH_REACH_PX, VOLCANO_GLYPH, VolcanoGlyphSpot } from './drawing-glyphs';
import { DrawnVolcano } from '../../domain/drawing/drawn-volcano';
import { glyphSnowChance } from '../../domain/drawing/drawing-climate';
import { buildRiverShapes, inRiver, RiverShapes, waterCoverage } from './river-raster';
import { GroundClimate, zonalGroundClimate, zonalRows, ZonalRows } from '../../domain/drawing/drawing-climate';
import { DrawingWeather, weatherGroundClimate } from '../../domain/drawing/drawing-weather';
import { MapSettings } from '../../domain/map/map-settings';
import { DRAWING_TILE_PX, DrawingTileKey, influenceCells, renderDrawingTile, tileCells } from './drawing-tile';

interface CachedTile {
  readonly key: DrawingTileKey;
  readonly canvas: OffscreenCanvas;
  /** The drawing changed under this tile: still shown, re-rendered when time allows. */
  stale: boolean;
  lastUsed: number;
}

/** 256 KB each: ~64 MB at most. */
export const MAX_CACHED_TILES = 256;
/** Rendering budget per frame (ms); the rest waits for the next frames. */
const FRAME_BUDGET_MS = 10;
const MIN_LEVEL = -6;
const MAX_LEVEL = 5;

/**
 * Draws the DRAWING layer in the illustrated look, by tiles of fixed pixel
 * size at power-of-two zoom levels, kept in an LRU cache.
 *
 * - Panning reuses cached tiles; zooming within a factor 2 rescales them.
 * - A dab marks the tiles it influences as stale: they stay on screen and are
 *   re-rendered on the next frames (no flicker), most of the time within one.
 * - A missing tile is replaced by the same area from another cached level
 *   (blurry or sharp for a moment) rather than a hole.
 *
 * `draw` returns true while work remains: the caller asks for another frame.
 */
export class DrawingView {
  private readonly pyramid: CoveragePyramid;
  private readonly reliefPyramid: CoveragePyramid;
  private readonly forestPyramid: CoveragePyramid;
  private readonly lakePyramid: CoveragePyramid;
  /** Device px per CSS px the cached tiles were drawn for (glyph sizes depend on it). */
  private pxScale = 1;
  private readonly cache = new Map<string, CachedTile>();
  private frame = 0;
  private readonly pixels = new ImageData(DRAWING_TILE_PX, DRAWING_TILE_PX);
  /** River beds per tile level, rebuilt when the rivers or the drawing change. */
  private readonly riverShapes = new Map<number, RiverShapes>();
  /** The rivers the cached tiles were drawn with (items are immutable: identity tells a change). */
  private drawnRivers: readonly DrawnRiver[] = [];
  /** The volcanoes the cached tiles were drawn with (same identity check). */
  private drawnVolcanoes: readonly DrawnVolcano[] = [];
  /** Ground colour by latitude, and the settings it was computed for. */
  private zonal: ZonalRows;
  private zonalKey: string;
  /** Weather brought by the winds (null: not computed, the zonal climate stands in). */
  private weather: DrawingWeather | null = null;
  private climate: GroundClimate;

  constructor(private readonly map: WorldMap) {
    this.pyramid = new CoveragePyramid(map.terrain.drawing);
    this.reliefPyramid = new CoveragePyramid(map.terrain.drawing, RELIEF_VALUE);
    this.forestPyramid = new CoveragePyramid(map.terrain.drawing, FOREST_VALUE);
    this.lakePyramid = new CoveragePyramid(map.terrain.drawing, LAKE_VALUE);
    this.zonalKey = zonalKeyOf(map.settings);
    this.zonal = zonalRows(map.settings, map.terrain.drawing.heightCells);
    this.climate = zonalGroundClimate(this.zonal);
  }

  /** Month shown (season slider): snow comes and goes. */
  private yearPhase = 0.54;

  /** The winds' weather changed (after an edit or a latitude change), or the month shown: every tile's colours may change. */
  setWeather(weather: DrawingWeather | null, yearPhase: number): void {
    if (weather === this.weather && yearPhase === this.yearPhase) return;
    this.weather = weather;
    this.yearPhase = yearPhase;
    this.refreshClimate();
  }

  private refreshClimate(): void {
    this.climate = this.weather ? weatherGroundClimate(this.weather, this.map.settings.baseCellKm, this.yearPhase) : zonalGroundClimate(this.zonal);
    for (const tile of this.cache.values()) tile.stale = true;
  }

  /** Latitudes or tilt changed (settings are replaced, not mutated, but compare values to be safe). */
  private syncZonal(): void {
    const key = zonalKeyOf(this.map.settings);
    if (key === this.zonalKey) return;
    this.zonalKey = key;
    this.zonal = zonalRows(this.map.settings, this.map.terrain.drawing.heightCells);
    this.refreshClimate();
  }

  /** The drawing changed in these cell rectangles. */
  invalidate(rects: readonly CellRect[]): void {
    // Deltas follow the drawn coast: river beds may change too.
    if (rects.length > 0) this.riverShapes.clear();
    for (const rect of rects) {
      this.pyramid.update(rect);
      this.reliefPyramid.update(rect);
      this.forestPyramid.update(rect);
      this.lakePyramid.update(rect);
      for (const tile of this.cache.values()) {
        const reach = influenceCells(tile.key.level, this.pyramid.maxLevel, RELIEF_GLYPH_REACH_PX * this.glyphPxScale(tile.key.level));
        const size = tileCells(tile.key.level);
        const x0 = tile.key.tx * size - reach;
        const y0 = tile.key.ty * size - reach;
        if (rect.x1 >= x0 && rect.x0 < x0 + size + 2 * reach && rect.y1 >= y0 && rect.y0 < y0 + size + 2 * reach) tile.stale = true;
      }
    }
  }

  draw(ctx: CanvasRenderingContext2D, vp: Viewport, devicePixelRatio: number): boolean {
    this.frame++;
    const start = performance.now();
    if (devicePixelRatio !== this.pxScale) {
      // Moved to a screen of another density: glyph sizes change, start over.
      this.pxScale = devicePixelRatio;
      this.cache.clear();
      this.riverShapes.clear();
    }
    this.syncRivers();
    this.syncVolcanoes();
    this.syncZonal();
    const level = Math.max(MIN_LEVEL, Math.min(MAX_LEVEL, Math.ceil(Math.log2(vp.pixelsPerCell * devicePixelRatio))));
    const visible = this.visibleTiles(vp, level);
    let pending = false;

    // Render what is missing first (holes are worse than stale tiles), then refresh stale ones.
    for (const pass of ['missing', 'stale'] as const) {
      for (const key of visible) {
        const cached = this.cache.get(id(key));
        const todo = pass === 'missing' ? !cached : cached?.stale === true;
        if (!todo) continue;
        if (performance.now() - start > FRAME_BUDGET_MS) {
          pending = true;
          continue;
        }
        this.render(key, cached);
      }
    }

    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'medium';
    for (const key of visible) {
      const tile = this.cache.get(id(key));
      if (tile) {
        tile.lastUsed = this.frame;
        this.blit(ctx, vp, tile, key);
      } else {
        this.drawFallback(ctx, vp, key);
      }
    }
    this.evict();
    return pending;
  }

  private visibleTiles(vp: Viewport, level: number): DrawingTileKey[] {
    const size = tileCells(level);
    const grid = this.map.terrain.drawing;
    const a = screenToCell(vp, 0, 0);
    const b = screenToCell(vp, vp.widthPx, vp.heightPx);
    const tx0 = Math.max(0, Math.floor(a.x / size));
    const ty0 = Math.max(0, Math.floor(a.y / size));
    const tx1 = Math.min(Math.ceil(grid.widthCells / size) - 1, Math.floor(b.x / size));
    const ty1 = Math.min(Math.ceil(grid.heightCells / size) - 1, Math.floor(b.y / size));
    const keys: DrawingTileKey[] = [];
    for (let ty = ty0; ty <= ty1; ty++) for (let tx = tx0; tx <= tx1; tx++) keys.push({ level, tx, ty });
    // Centre first: what the user looks at appears first.
    const cx = (a.x + b.x) / 2 / size - 0.5;
    const cy = (a.y + b.y) / 2 / size - 0.5;
    return keys.sort((p, q) => Math.hypot(p.tx - cx, p.ty - cy) - Math.hypot(q.tx - cx, q.ty - cy));
  }

  private render(key: DrawingTileKey, cached: CachedTile | undefined): void {
    const grid = this.map.terrain.drawing;
    const seed = this.map.settings.seed;
    const shapes = this.shapesAt(key.level);
    const water = waterCoverage(shapes, key.tx * DRAWING_TILE_PX - 1, key.ty * DRAWING_TILE_PX - 1, DRAWING_TILE_PX + 2);
    renderDrawingTile(
      { pyramid: this.pyramid, reliefPyramid: this.reliefPyramid, forestPyramid: this.forestPyramid, lakePyramid: this.lakePyramid, climate: this.climate, widthCells: grid.widthCells, heightCells: grid.heightCells, seed },
      key,
      this.pixels.data,
      water,
    );
    const tile = cached ?? { key, canvas: new OffscreenCanvas(DRAWING_TILE_PX, DRAWING_TILE_PX), stale: false, lastUsed: this.frame };
    const tctx = tile.canvas.getContext('2d');
    if (!tctx) throw new Error('2D context unavailable');
    tctx.putImageData(this.pixels, 0, 0);
    // Glyphs may spill past the map edge: keep them inside the map like the paper.
    tctx.save();
    const size = tileCells(key.level);
    const pxPerCell = 2 ** key.level;
    const inside = {
      w: Math.min(DRAWING_TILE_PX, (grid.widthCells - key.tx * size) * pxPerCell),
      h: Math.min(DRAWING_TILE_PX, (grid.heightCells - key.ty * size) * pxPerCell),
    };
    tctx.beginPath();
    tctx.rect(0, 0, inside.w, inside.h);
    tctx.clip();
    const margin = 3 * this.pxScale;
    drawDrawingGlyphs(tctx, grid, seed, key.level, key.tx * DRAWING_TILE_PX, key.ty * DRAWING_TILE_PX, DRAWING_TILE_PX, this.glyphPxScale(key.level), (x, y) =>
      inRiver(shapes, x, y, margin),
      this.climate,
      this.volcanoSpots(key),
    );
    tctx.restore();
    tile.stale = false;
    this.cache.set(id(key), tile);
  }

  private shapesAt(level: number): RiverShapes {
    let shapes = this.riverShapes.get(level);
    if (!shapes) {
      const map = this.map;
      shapes = buildRiverShapes(map.rivers, map.terrain.drawing, map.settings.baseCellKm, level, map.settings.seed);
      this.riverShapes.set(level, shapes);
    }
    return shapes;
  }

  /**
   * Rivers changed (traced, extended, erased, undone): re-render the tiles
   * near the old and the new ones. A tributary also widens its main river
   * downstream, so every river's area is refreshed, not only the edited one.
   */
  private syncRivers(): void {
    const rivers = this.map.rivers;
    if (rivers.length === this.drawnRivers.length && rivers.every((r, i) => r === this.drawnRivers[i])) return;
    const cellKm = this.map.settings.baseCellKm;
    const marginKm = 100; // deltas and estuaries reach this far around a course
    const rects: CellRect[] = [];
    for (const river of [...this.drawnRivers, ...rivers]) {
      const p = river.pointsKm;
      let x0 = Infinity;
      let y0 = Infinity;
      let x1 = -Infinity;
      let y1 = -Infinity;
      for (let i = 0; i < p.length; i += 2) {
        x0 = Math.min(x0, p[i]);
        x1 = Math.max(x1, p[i]);
        y0 = Math.min(y0, p[i + 1]);
        y1 = Math.max(y1, p[i + 1]);
      }
      rects.push({
        x0: Math.floor((x0 - marginKm) / cellKm),
        y0: Math.floor((y0 - marginKm) / cellKm),
        x1: Math.ceil((x1 + marginKm) / cellKm),
        y1: Math.ceil((y1 + marginKm) / cellKm),
      });
    }
    this.drawnRivers = [...rivers];
    this.riverShapes.clear();
    for (const tile of this.cache.values()) {
      const size = tileCells(tile.key.level);
      const tx0 = tile.key.tx * size;
      const ty0 = tile.key.ty * size;
      if (rects.some((r) => r.x1 >= tx0 && r.x0 < tx0 + size && r.y1 >= ty0 && r.y0 < ty0 + size)) tile.stale = true;
    }
  }

  /** Volcanoes whose glyph may touch this tile, in the level's px. */
  private volcanoSpots(key: DrawingTileKey): VolcanoGlyphSpot[] {
    const volcanoes = this.map.volcanoes;
    if (volcanoes.length === 0) return [];
    const pxPerKm = 2 ** key.level / this.map.settings.baseCellKm;
    const scale = this.glyphPxScale(key.level);
    const reachX = VOLCANO_GLYPH.w * scale;
    const reachY = VOLCANO_GLYPH.h * 1.8 * scale; // cone, bombs and ash plume above the base
    const x0 = key.tx * DRAWING_TILE_PX;
    const y0 = key.ty * DRAWING_TILE_PX;
    const spots: VolcanoGlyphSpot[] = [];
    for (const v of volcanoes) {
      const x = v.xKm * pxPerKm;
      const y = v.yKm * pxPerKm;
      if (x < x0 - reachX || x > x0 + DRAWING_TILE_PX + reachX || y < y0 || y > y0 + DRAWING_TILE_PX + reachY) continue;
      const cellKm = this.map.settings.baseCellKm;
      spots.push({ x, y, snow: glyphSnowChance(this.climate, v.xKm / cellKm, v.yKm / cellKm, 2, true) >= 0.5, kind: v.kind, variant: idVariant(v.id), scale: volcanoScale(pxPerKm, scale, this.pxScale) });
    }
    return spots;
  }

  /** Volcanoes placed, moved or erased: re-render the tiles around the old and new ones. */
  private syncVolcanoes(): void {
    const volcanoes = this.map.volcanoes;
    if (volcanoes.length === this.drawnVolcanoes.length && volcanoes.every((v, i) => v === this.drawnVolcanoes[i])) return;
    const kept = new Set(volcanoes);
    const changed = [...this.drawnVolcanoes.filter((v) => !kept.has(v)), ...volcanoes.filter((v) => !this.drawnVolcanoes.includes(v))];
    this.drawnVolcanoes = [...volcanoes];
    const cellKm = this.map.settings.baseCellKm;
    for (const tile of this.cache.values()) {
      const size = tileCells(tile.key.level);
      // Glyph reach in cells at this tile's level.
      const reach = (VOLCANO_GLYPH.h * 1.8 * this.glyphPxScale(tile.key.level)) / 2 ** tile.key.level;
      const tx0 = tile.key.tx * size;
      const ty0 = tile.key.ty * size;
      if (
        changed.some((v) => {
          const cx = v.xKm / cellKm;
          const cy = v.yKm / cellKm;
          return cx + reach >= tx0 && cx - reach < tx0 + size && cy + reach >= ty0 && cy - reach < ty0 + size;
        })
      )
        tile.stale = true;
    }
  }

  /** Device px per glyph unit at a level: screen density × zoom growth. */
  private glyphPxScale(level: number): number {
    const grid = this.map.terrain.drawing;
    return this.pxScale * glyphZoom(level, Math.max(grid.widthCells, grid.heightCells));
  }

  private blit(ctx: CanvasRenderingContext2D, vp: Viewport, tile: CachedTile, key: DrawingTileKey): void {
    const size = tileCells(key.level);
    const a = cellToScreen(vp, key.tx * size, key.ty * size);
    const b = cellToScreen(vp, (key.tx + 1) * size, (key.ty + 1) * size);
    // Round both edges (not the size) so neighbouring tiles share the same pixel border: no seams.
    const x = Math.round(a.x);
    const y = Math.round(a.y);
    ctx.drawImage(tile.canvas, x, y, Math.round(b.x) - x, Math.round(b.y) - y);
  }

  /** Fills a missing tile's area from cached tiles of the nearest other levels. */
  private drawFallback(ctx: CanvasRenderingContext2D, vp: Viewport, key: DrawingTileKey): void {
    const size = tileCells(key.level);
    const area = { x0: key.tx * size, y0: key.ty * size, x1: (key.tx + 1) * size, y1: (key.ty + 1) * size };
    for (const delta of [-1, 1, -2, 2, -3]) {
      const level = key.level + delta;
      const s = tileCells(level);
      const found: CachedTile[] = [];
      let complete = true;
      for (let ty = Math.floor(area.y0 / s); ty * s < area.y1; ty++) {
        for (let tx = Math.floor(area.x0 / s); tx * s < area.x1; tx++) {
          const tile = this.cache.get(id({ level, tx, ty }));
          if (tile) found.push(tile);
          else complete = false;
        }
      }
      if (!complete) continue;
      const a = cellToScreen(vp, area.x0, area.y0);
      const b = cellToScreen(vp, area.x1, area.y1);
      ctx.save();
      ctx.beginPath();
      ctx.rect(Math.round(a.x), Math.round(a.y), Math.round(b.x) - Math.round(a.x), Math.round(b.y) - Math.round(a.y));
      ctx.clip();
      for (const tile of found) this.blit(ctx, vp, tile, tile.key);
      ctx.restore();
      return;
    }
  }

  private evict(): void {
    if (this.cache.size <= MAX_CACHED_TILES) return;
    const byAge = [...this.cache.entries()].sort((p, q) => p[1].lastUsed - q[1].lastUsed);
    for (const [k] of byAge.slice(0, this.cache.size - MAX_CACHED_TILES)) this.cache.delete(k);
  }
}

function id(key: DrawingTileKey): string {
  return `${key.level}:${key.tx}:${key.ty}`;
}

function zonalKeyOf(s: MapSettings): string {
  return `${s.latitudeTopDeg}|${s.latitudeBottomDeg}|${s.axialTiltDeg}|${s.globalTemperatureOffsetC}`;
}

/** A stable 0..1 number from a volcano id (FNV-1a): its shape survives moves and reloads. */
function idVariant(id: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 0x01000193);
  return ((h >>> 0) % 100000) / 100000;
}

/**
 * Volcano size on far views: full size (like the mountain glyphs) as long as
 * it stays under VOLCANO_MAX_KM wide on the ground; zoomed out further, it
 * shrinks with the map, down to VOLCANO_MIN_PX (CSS px) so it never vanishes.
 */
const VOLCANO_MAX_KM = 45;
const VOLCANO_MIN_PX = 16;
function volcanoScale(levelPxPerKm: number, glyphScale: number, devicePxScale: number): number {
  const fullPx = VOLCANO_GLYPH.w * glyphScale;
  const groundPx = VOLCANO_MAX_KM * levelPxPerKm;
  const minPx = VOLCANO_MIN_PX * devicePxScale;
  return Math.min(1, Math.max(minPx, groundPx) / fullPx);
}
