import { forestIndexOf, isLandCode, reliefIndexOf } from '../../domain/drawing/drawing-cell';
import { hash2 } from '../../domain/terrain/noise';
import { glyphSnowChance, GroundClimate, reliefCoolingC, treeMix } from '../../domain/drawing/drawing-climate';
import { getCellClamped, Int16TiledGrid } from '../../domain/terrain/tiled-grid';
import { VINTAGE } from '../style/vintage-style';
import { VolcanoKind } from '../../domain/drawing/drawn-volcano';
import { drawTreeGlyph } from '../vintage-forests';
import { Ctx2D, drawMountainGlyph } from '../vintage-mountains';

/**
 * Relief pictograms of the drawing (hills, mountains, high mountains), in
 * CSS px: their size on screen stays about the same at every zoom level, and
 * zooming in shows MORE of them, each standing for a smaller area
 * (semantic zoom). Placement is a jittered lattice in the tile level's pixel
 * space: deterministic, so a glyph drawn across two tiles is the same in both.
 */
export const RELIEF_GLYPHS = {
  /** Lattice step (CSS px). Glyphs are wider than this: they overlap into ranges. */
  spacingPx: 17,
  /** Jitter, as a fraction of the step (1 = anywhere in its lattice cell: no visible rows). */
  jitter: 1,
  /** Base width and height (CSS px) per class: hills, mid mountains, high mountains. */
  sizes: [
    { w: 17, h: 6 },
    { w: 22, h: 15 },
    { w: 29, h: 25 },
  ],
  /** Size variation (±). */
  sizeJitter: 0.15,
  /** Fraction of lattice points that get a hill (hills are sparse, mountains crowd). */
  hillDensity: 0.6,
} as const;

/**
 * Tree pictograms of forest zones: a denser lattice of smaller glyphs, so a
 * forest reads as a mass of crowns. Mountains are drawn among them, sorted
 * by their base: a peak stands in front of the trees behind it.
 */
export const FOREST_GLYPHS = {
  spacingPx: 8,
  jitter: 1,
  /** Tree height (CSS px) per kind: broadleaf, conifer, tropical. */
  sizes: [11, 12, 12],
  sizeJitter: 0.2,
  /** Fraction of trees kept per relief class: woods thin out on mountains and stop below the snow. */
  keepByRelief: [1, 0.85, 0.35, 0],
} as const;

/**
 * Glyph size factor at a zoom level. Constant-size glyphs turn a close-up
 * range into a uniform field of tiny peaks; growing them as fast as the map
 * shows only a few giants. In between: size ∝ zoom^0.45, measured from the
 * level where the whole map fits about 800 px, clamped.
 */
export function glyphZoom(level: number, mapSideCells: number): number {
  const fitLevel = Math.log2(800 / mapSideCells);
  return Math.min(2.5, Math.max(0.8, 2 ** ((level - fitLevel) * 0.45)));
}

/**
 * Volcano pictogram (CSS px, times the same zoom factor as the mountains): a
 * truncated mountain a bit larger than a high mountain, so it stands out of a range.
 * Mountain and tree glyphs under its cone are left out.
 */
export const VOLCANO_GLYPH = { w: 34, h: 30 } as const;

/** A volcano to draw in a tile: base position in the level's px (absolute), and whether it has snow. */
export interface VolcanoGlyphSpot {
  readonly x: number;
  readonly y: number;
  readonly snow: boolean;
  readonly kind: VolcanoKind;
  /** 0..1, fixed per volcano: its own small irregularities. */
  readonly variant: number;
  /** Size factor ≤ 1: shrinks the glyph on far views, where a full-size volcano covers a whole region. */
  readonly scale: number;
}

/** Largest glyph extent (CSS px) beyond its lattice point: how far a cell change can reach on screen. */
export const RELIEF_GLYPH_REACH_PX =
  RELIEF_GLYPHS.sizes[2].h * (1 + RELIEF_GLYPHS.sizeJitter) + RELIEF_GLYPHS.spacingPx;

const SALT_X = 0x91e1;
const SALT_Y = 0x37c5;
const SALT_KEEP = 0x5a17;
const SALT_SIZE = 0x2b3d;
const SALT_VARIANT = 0x6e0f;
const SALT_SNOW = 0x4c2b;


export interface TreeGlyph {
  readonly x: number;
  readonly y: number;
  /** 1 broadleaf, 2 conifer, 3 palm (picked by the climate). */
  readonly forest: number;
  readonly scale: number;
  readonly variant: number;
  /** Snow on the crown (snow zone). */
  readonly snow: boolean;
}

const SALT_TREE = 0x3f1d;
const SALT_DENSITY = 0x71c3;
const SALT_SPECIES = 0x1e59;

export interface ReliefGlyph {
  readonly x: number;
  readonly y: number;
  /** 1 hills, 2 mid mountain, 3 high mountain. */
  readonly relief: number;
  readonly scale: number;
  readonly variant: number;
  /** Snow cap (mountains) or snowy hump (hills). */
  readonly snow: boolean;
}

/**
 * Draws the relief and tree glyphs whose footprint touches the tile whose
 * top-left pixel is (originX, originY) at `level` (2^level px per cell),
 * back to front. `pxScale` = device pixels per CSS px.
 */
export function drawDrawingGlyphs(
  ctx: Ctx2D,
  drawing: Int16TiledGrid,
  seed: number,
  level: number,
  originX: number,
  originY: number,
  tilePx: number,
  pxScale: number,
  /** Lattice points (level px) where nothing grows: river beds. */
  blocked: (x: number, y: number) => boolean = () => false,
  /** Warmest month at sea level per cell row (°C): where glyphs get snow. */
  climate: GroundClimate | null = null,
  /** Volcanoes near the tile (level px, absolute). */
  volcanoes: readonly VolcanoGlyphSpot[] = [],
): void {
  // Nothing grows on a volcano's cone: a triangle-ish footprint above its base.
  const underCone = (x: number, y: number): boolean =>
    volcanoes.some((v) => {
      const vw = VOLCANO_GLYPH.w * pxScale * v.scale;
      const vh = VOLCANO_GLYPH.h * pxScale * v.scale;
      return y <= v.y + vh * 0.1 && y >= v.y - vh * 0.9 && Math.abs(x - v.x) <= vw * 0.5 * (0.35 + 0.65 * Math.min(1, (y - (v.y - vh)) / vh));
    });
  const free = volcanoes.length > 0 ? (x: number, y: number) => blocked(x, y) || underCone(x, y) : blocked;
  const reliefs = placeReliefGlyphs(drawing, seed, level, originX, originY, tilePx, pxScale, free, climate);
  const trees = placeTreeGlyphs(drawing, seed, level, originX, originY, tilePx, pxScale, free, climate);
  const cones = volcanoes.map((v) => ({ ...v, x: v.x - originX, y: v.y - originY })).sort((p, q) => p.y - q.y);
  // Merge the three sorted lists by base: back to front.
  let i = 0;
  let j = 0;
  let k = 0;
  while (i < reliefs.length || j < trees.length || k < cones.length) {
    const ry = i < reliefs.length ? reliefs[i].y : Infinity;
    const ty = j < trees.length ? trees[j].y : Infinity;
    const cy = k < cones.length ? cones[k].y : Infinity;
    if (cy <= ry && cy <= ty) {
      const c = cones[k++];
      drawVolcanoGlyph(ctx, c.x, c.y, VOLCANO_GLYPH.w * pxScale * c.scale, VOLCANO_GLYPH.h * pxScale * c.scale, c.kind, c.snow, c.variant);
    } else if (ry <= ty) {
      const g = reliefs[i++];
      const size = RELIEF_GLYPHS.sizes[g.relief - 1];
      const w = size.w * g.scale * pxScale;
      const h = size.h * g.scale * pxScale;
      if (g.relief === 1) drawHillGlyph(ctx, g.x, g.y, w, h, g.variant, g.snow);
      else drawMountainGlyph(ctx, g.x, g.y, w, h, g.variant, g.snow);
    } else {
      const t = trees[j++];
      const s = FOREST_GLYPHS.sizes[t.forest - 1] * t.scale * pxScale;
      if (t.forest === 3) drawPalmGlyph(ctx, t.x, t.y, s, t.variant);
      else drawTreeGlyph(ctx, t.x, t.y, s, t.variant, t.forest === 2 ? 1 : 0, t.snow);
    }
  }
}

/** The trees of one tile, sorted back to front, positions relative to the tile's top-left pixel. */
export function placeTreeGlyphs(
  drawing: Int16TiledGrid,
  seed: number,
  level: number,
  originX: number,
  originY: number,
  tilePx: number,
  pxScale: number,
  blocked: (x: number, y: number) => boolean = () => false,
  climate: GroundClimate | null = null,
): TreeGlyph[] {
  const step = FOREST_GLYPHS.spacingPx * pxScale;
  const reach = Math.max(...FOREST_GLYPHS.sizes) * (1 + FOREST_GLYPHS.sizeJitter) * pxScale;
  const cellsPerPx = 1 / 2 ** level;
  const a0 = Math.floor((originX - reach) / step);
  const a1 = Math.ceil((originX + tilePx + reach) / step);
  const b0 = Math.floor(originY / step) - 1;
  const b1 = Math.ceil((originY + tilePx + reach) / step);
  const trees: TreeGlyph[] = [];
  const s = seed ^ (level * 0x9e37) ^ SALT_TREE;
  for (let b = b0; b <= b1; b++) {
    for (let a = a0; a <= a1; a++) {
      const x = (a + 0.5 + (hash2(s ^ SALT_X, a, b) - 0.5) * FOREST_GLYPHS.jitter) * step;
      const y = (b + 0.5 + (hash2(s ^ SALT_Y, a, b) - 0.5) * FOREST_GLYPHS.jitter) * step;
      const code = getCellClamped(drawing, Math.floor(x * cellsPerPx), Math.floor(y * cellsPerPx));
      if (forestIndexOf(code) === 0 || !isLandCode(code)) continue;
      const relief = reliefIndexOf(code);
      if (hash2(s ^ SALT_KEEP, a, b) >= FOREST_GLYPHS.keepByRelief[relief]) continue;
      if (blocked(x, y)) continue;
      // The climate picks the tree (and thins the forest where little grows); before any
      // climate is known, a plain broadleaf forest.
      let forest = 1;
      if (climate) {
        const cx = x * cellsPerPx;
        const cy = y * cellsPerPx;
        const cooling = reliefCoolingC(relief);
        const mix = treeMix(climate.warmestC(cx, cy) - cooling, climate.coldestC(cx, cy) - cooling, climate.wetnessPct(cx, cy));
        if (hash2(s ^ SALT_DENSITY, a, b) >= mix.density) continue;
        const pick = hash2(s ^ SALT_SPECIES, a, b);
        forest = pick < mix.conifer ? 2 : pick < mix.conifer + mix.broadleaf ? 1 : 3;
      }
      const scale = 1 + (hash2(s ^ SALT_SIZE, a, b) - 0.5) * 2 * FOREST_GLYPHS.sizeJitter;
      // Palms never get snow (they only grow where it never freezes).
      const snow = forest !== 3 && climate !== null && hash2(s ^ SALT_SNOW, a, b) < glyphSnowChance(climate, x * cellsPerPx, y * cellsPerPx, relief, false);
      trees.push({ x: x - originX, y: y - originY, forest, scale, variant: hash2(s ^ SALT_VARIANT, a, b), snow });
    }
  }
  return trees.sort((p, q) => p.y - q.y);
}

/** A palm: leaning trunk and a crown of drooping fronds (tropical forest). */
export function drawPalmGlyph(ctx: Ctx2D, x: number, y: number, s: number, v: number): void {
  const lean = (v - 0.5) * s * 0.35;
  const topX = x + lean;
  const topY = y - s * 0.78;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.strokeStyle = VINTAGE.trunk;
  ctx.lineWidth = Math.max(0.6, s / 12);
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.quadraticCurveTo(x + lean * 0.2, y - s * 0.45, topX, topY);
  ctx.stroke();
  // Fronds: thin leaves bent down, shaded ones (east) first.
  const line = Math.max(0.35, Math.min(0.7, s / 20));
  for (const [angle, shade] of [
    [-0.25, true],
    [0.35, true],
    [Math.PI + 0.25, false],
    [Math.PI - 0.35, false],
    [-Math.PI / 2, false],
  ] as const) {
    const len = s * (0.5 + 0.1 * v);
    const tipX = topX + Math.cos(angle) * len;
    const tipY = topY + Math.sin(angle) * len * 0.55 + len * 0.35;
    const midX = topX + Math.cos(angle) * len * 0.55;
    const midY = topY + Math.sin(angle) * len * 0.55 - len * 0.12;
    const width = len * 0.24;
    ctx.beginPath();
    ctx.moveTo(topX, topY);
    ctx.quadraticCurveTo(midX, midY - width, tipX, tipY);
    ctx.quadraticCurveTo(midX, midY + width, topX, topY);
    ctx.fillStyle = shade ? VINTAGE.palmShade : VINTAGE.palm;
    ctx.fill();
    ctx.strokeStyle = VINTAGE.ink;
    ctx.lineWidth = line;
    ctx.stroke();
  }
}

/** The glyphs of one tile, sorted back to front, positions relative to the tile's top-left pixel. */
export function placeReliefGlyphs(
  drawing: Int16TiledGrid,
  seed: number,
  level: number,
  originX: number,
  originY: number,
  tilePx: number,
  pxScale: number,
  blocked: (x: number, y: number) => boolean = () => false,
  climate: GroundClimate | null = null,
): ReliefGlyph[] {
  const step = RELIEF_GLYPHS.spacingPx * pxScale;
  const reach = RELIEF_GLYPH_REACH_PX * pxScale;
  const cellsPerPx = 1 / 2 ** level;
  // Lattice points whose glyph can touch the tile: glyphs rise above their base and spread sideways.
  const a0 = Math.floor((originX - reach) / step);
  const a1 = Math.ceil((originX + tilePx + reach) / step);
  const b0 = Math.floor(originY / step) - 1;
  const b1 = Math.ceil((originY + tilePx + reach) / step);
  const glyphs: ReliefGlyph[] = [];
  const s = seed ^ (level * 0x9e37);
  for (let b = b0; b <= b1; b++) {
    for (let a = a0; a <= a1; a++) {
      const x = (a + 0.5 + (hash2(s ^ SALT_X, a, b) - 0.5) * RELIEF_GLYPHS.jitter) * step;
      const y = (b + 0.5 + (hash2(s ^ SALT_Y, a, b) - 0.5) * RELIEF_GLYPHS.jitter) * step;
      const code = getCellClamped(drawing, Math.floor(x * cellsPerPx), Math.floor(y * cellsPerPx));
      const relief = reliefIndexOf(code);
      if (!isLandCode(code) || relief === 0) continue;
      if (relief === 1 && hash2(s ^ SALT_KEEP, a, b) > RELIEF_GLYPHS.hillDensity) continue;
      if (blocked(x, y)) continue;
      const scale = 1 + (hash2(s ^ SALT_SIZE, a, b) - 0.5) * 2 * RELIEF_GLYPHS.sizeJitter;
      // Hills wear the ground's snow; mountains have caps (longer-lasting, perennial where summers are cold).
      const chance = climate === null ? (relief === 3 ? 1 : 0) : glyphSnowChance(climate, x * cellsPerPx, y * cellsPerPx, relief, relief >= 2);
      const snow = hash2(s ^ SALT_SNOW, a, b) < chance;
      glyphs.push({ x: x - originX, y: y - originY, relief, scale, variant: hash2(s ^ SALT_VARIANT, a, b), snow });
    }
  }
  return glyphs.sort((p, q) => p.y - q.y);
}

/**
 * A volcano = the mountain pictogram with its head cut off: same pen flanks,
 * same shaded east side and hatching, but a flat broken top holding the
 * crater. The kind (chosen by the user) changes the proportions and details:
 * erupting (red crater, two short lava trickles, a puff of smoke), smoking
 * (dark crater, a thin wisp), shield (wider and lower, red crater, no smoke).
 */
export function drawVolcanoGlyph(ctx: Ctx2D, x: number, y: number, w: number, h: number, kind: VolcanoKind, snow = false, v = 0.5): void {
  if (kind === 'shield') {
    w *= 1.25;
    h *= 0.7;
  }
  let state = Math.floor(v * 0x7fffffff) || 1;
  const rand = (): number => {
    state = (Math.imul(state, 48271) % 0x7fffffff) >>> 0;
    return state / 0x7fffffff;
  };
  const half = w / 2;
  // The cone would peak at y − h; it is cut at 72 % of that height.
  const peakX = x + (rand() - 0.5) * w * 0.15;
  const cut = 0.28;
  const topY = y - h * (1 - cut);
  const lipL = { x: peakX - half * cut * 1.1, y: topY + h * 0.015 * rand() };
  const lipR = { x: peakX + half * cut * 1.1, y: topY + h * (0.02 + 0.03 * rand()) };
  // Pen flanks: from each lip down to the foot, slightly concave and jittered (as the mountains).
  const flank = (from: { x: number; y: number }, toX: number): [number, number][] => {
    const pts: [number, number][] = [];
    const steps = 4;
    for (let k = 1; k < steps; k++) {
      const t = k / steps;
      const tt = t * (0.85 + 0.3 * rand());
      pts.push([from.x + (toX - from.x) * tt + (rand() - 0.5) * w * 0.05, from.y + (y - from.y) * Math.pow(t, 0.8) - rand() * h * 0.06]);
    }
    pts.push([toX, y]);
    return pts;
  };
  const left = flank(lipL, x - half).reverse();
  const right = flank(lipR, x + half);
  const ridgeFootX = x + (peakX - x) * 0.3 + w * (0.06 + 0.08 * rand());
  const fade = (color: string) => {
    const g = ctx.createLinearGradient(0, topY, 0, y);
    g.addColorStop(0, color);
    g.addColorStop(0.55, color);
    g.addColorStop(1, 'rgb(0 0 0 / 0)');
    return g;
  };
  const outline = () => {
    ctx.moveTo(left[0][0], left[0][1]);
    for (const [px, py] of left) ctx.lineTo(px, py);
    ctx.lineTo(lipL.x, lipL.y);
    ctx.lineTo(lipR.x, lipR.y);
    for (const [px, py] of right) ctx.lineTo(px, py);
  };

  // Smoke behind the cone: a few soft puffs drifting east.
  if (kind !== 'shield') {
    const puffs = kind === 'erupting' ? 4 : 3;
    ctx.lineWidth = Math.max(0.5, Math.min(0.9, w / 40));
    ctx.strokeStyle = 'rgb(52 38 24 / 0.5)';
    for (let k = 0; k < puffs; k++) {
      const t = (k + 1) / puffs;
      const r = w * (kind === 'erupting' ? 0.07 + 0.07 * t : 0.04 + 0.04 * t);
      const px = peakX + w * (0.04 + 0.16 * t) * (0.8 + 0.4 * rand());
      const py = topY - h * (0.12 + 0.55 * t);
      ctx.beginPath();
      ctx.arc(px, py, r, 0, 2 * Math.PI);
      ctx.fillStyle = `rgb(${200 - 40 * t} ${192 - 40 * t} ${182 - 36 * t} / ${0.85 - 0.3 * t})`;
      ctx.fill();
      ctx.beginPath();
      ctx.arc(px, py, r, Math.PI * 1.1, Math.PI * 1.9);
      ctx.stroke();
    }
  }

  ctx.beginPath();
  outline();
  ctx.closePath();
  ctx.fillStyle = fade(VOLCANO_LIT);
  ctx.fill();
  // Shaded flank.
  ctx.beginPath();
  ctx.moveTo(peakX + (lipR.x - peakX) * 0.2, topY);
  ctx.lineTo(lipR.x, lipR.y);
  for (const [px, py] of right) ctx.lineTo(px, py);
  ctx.lineTo(ridgeFootX, y);
  ctx.closePath();
  ctx.fillStyle = fade(VOLCANO_SHADE);
  ctx.fill();
  if (snow) {
    const l = left[left.length - 1];
    const r = right[0];
    ctx.beginPath();
    ctx.moveTo(lipL.x, lipL.y);
    ctx.lineTo(l[0], l[1]);
    ctx.lineTo(lipL.x + (l[0] - lipL.x) * 0.3, l[1] - h * 0.04);
    ctx.lineTo(peakX, topY + h * 0.18);
    ctx.lineTo(lipR.x + (r[0] - lipR.x) * 0.5, r[1] - h * 0.02);
    ctx.lineTo(r[0], r[1]);
    ctx.lineTo(lipR.x, lipR.y);
    ctx.closePath();
    ctx.fillStyle = VINTAGE.snowCap;
    ctx.fill();
  }
  // Lava: two short red trickles from the rim (erupting only).
  if (kind === 'erupting') {
    ctx.lineCap = 'round';
    for (const side of [-1, 1]) {
      const sx = peakX + side * half * cut * 0.5;
      ctx.beginPath();
      ctx.moveTo(sx, topY + h * 0.02);
      ctx.quadraticCurveTo(sx + side * w * 0.05, topY + h * 0.18, sx + side * w * (0.06 + 0.05 * rand()), topY + h * (0.3 + 0.15 * rand()));
      ctx.strokeStyle = VINTAGE_LAVA;
      ctx.lineWidth = Math.max(0.8, Math.min(1.8, w / 16));
      ctx.stroke();
    }
  }
  ctx.strokeStyle = VINTAGE.ink;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  // Hatching on the shaded flank.
  const hatches = Math.max(2, Math.min(7, Math.round(w / 5)));
  ctx.lineWidth = Math.max(0.5, Math.min(0.9, w / 36));
  ctx.beginPath();
  for (let k = 1; k <= hatches; k++) {
    const t = (k - 0.3 + 0.6 * rand()) / (hatches + 1);
    const sx = lipR.x + (ridgeFootX - lipR.x) * t * 0.6;
    const sy = topY + (y - topY) * t;
    const len = Math.min((x + half - sx) * (0.3 + 0.4 * rand()), (y - sy) * 1.2);
    ctx.moveTo(sx + 0.5, sy + 0.5);
    ctx.lineTo(sx + len * 0.55, sy + len * 0.8);
  }
  ctx.stroke();
  // Outline, open at the base.
  ctx.lineWidth = Math.max(0.7, Math.min(1.4, w / 18));
  ctx.beginPath();
  outline();
  ctx.strokeStyle = fade(VINTAGE.ink);
  ctx.stroke();
  // Crater: an ellipse in the cut top, red (or dark when only smoking).
  ctx.beginPath();
  ctx.ellipse(peakX, (lipL.y + lipR.y) / 2, (lipR.x - lipL.x) * 0.42, Math.max(0.7, h * 0.045), 0, 0, 2 * Math.PI);
  ctx.fillStyle = kind === 'smoking' ? VINTAGE.ink : VINTAGE_LAVA;
  ctx.fill();
  ctx.lineWidth = Math.max(0.5, Math.min(1, w / 30));
  ctx.strokeStyle = VINTAGE.ink;
  ctx.stroke();
}

/** Lava red of the volcano glyphs: a muted vermilion, like an old map's red ink. */
const VINTAGE_LAVA = 'rgb(196 58 32)';
/** Volcanic rock: the mountain colours, a good deal darker (ash and basalt). */
const VOLCANO_LIT = 'rgb(172 156 136)';
const VOLCANO_SHADE = 'rgb(104 88 74)';

/** A low rounded hump, outlined on top, a few hatches on the shaded (east) side. */
export function drawHillGlyph(ctx: Ctx2D, x: number, y: number, w: number, h: number, v: number, snow = false): void {
  const top = y - h * (1.6 + v * 0.4);
  const crestX = x + (v - 0.5) * w * 0.2;
  ctx.beginPath();
  ctx.moveTo(x - w / 2, y);
  ctx.quadraticCurveTo(crestX, top, x + w / 2, y);
  const g = ctx.createLinearGradient(0, top, 0, y);
  // Snowy hill: white on top, the same fade to the ground.
  g.addColorStop(0, snow ? VINTAGE.snowCap : VINTAGE.mountainLit);
  if (snow) g.addColorStop(0.5, VINTAGE.snowCap);
  g.addColorStop(1, 'rgb(0 0 0 / 0)');
  ctx.fillStyle = g;
  ctx.fill();
  ctx.strokeStyle = VINTAGE.ink;
  ctx.lineCap = 'round';
  ctx.lineWidth = Math.max(0.7, Math.min(1.2, w / 16));
  ctx.beginPath();
  // Outline only over the top: open at the base, like a pen sketch.
  ctx.moveTo(x - w * 0.42, y - h * 0.25);
  ctx.quadraticCurveTo(crestX, top + h * 0.08, x + w * 0.42, y - h * 0.25);
  ctx.stroke();
  ctx.lineWidth = Math.max(0.5, ctx.lineWidth * 0.7);
  ctx.beginPath();
  for (const t of [0.18, 0.32]) {
    const hx = x + w * t;
    ctx.moveTo(hx, y - h * 0.75);
    ctx.lineTo(hx + w * 0.05, y - h * 0.2);
  }
  ctx.stroke();
}
