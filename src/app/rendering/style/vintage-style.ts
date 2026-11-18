/**
 * "Old map" look (rendered view): dark mottled teal sea, a lighter turquoise
 * glow along the coasts, parchment land darkening towards the shore, ink
 * coastline. Colours sampled by eye from Henri's reference (fantasy map in the
 * Wonderdraft style), not copied from any asset.
 *
 * Widths are fractions of the map's larger side, not km: this is a visual
 * convention (a 200 km D&D island and a 1700 km Japan get the same look at
 * full view). Revisit with semantic zoom (step 8).
 */
export type Rgb = readonly [number, number, number];

export const VINTAGE = {
  seaDeep: [27, 66, 84] as Rgb,
  seaOpen: [40, 92, 108] as Rgb,
  seaShallow: [96, 165, 168] as Rgb,
  parchment: [228, 214, 178] as Rgb,
  parchmentEdge: [182, 158, 112] as Rgb,
  ink: 'rgb(52 38 24)',

  /** Coastal glow e-folding width (fraction of the map's larger side). */
  seaGlowFraction: 0.022,
  /** Land darkening near the shore. */
  landEdgeFraction: 0.006,
  /** Size of the large stains (fraction of the map side). */
  stainFraction: 0.12,
  stainOctaves: 5,
  /** Brightness swing of the stains (sea, land) and of the per-cell paper grain. */
  seaStainStrength: 0.42,
  landStainStrength: 0.14,
  grainStrength: 0.06,
  /** Climate wash on land: colours and how strongly they cover the parchment. */
  landDry: [212, 176, 112] as Rgb,
  landWet: [146, 162, 96] as Rgb,
  landCold: [214, 216, 206] as Rgb,
  washStrength: 0.6,
  /** Annual wetness (%) from fully dry to fully wet colour. */
  washDryPct: 20,
  washWetPct: 55,
  /** Warmest-month temperature (°C) below which land turns pale (no trees). */
  washColdC: 4,
  washMildC: 11,

  coastWidthPx: 1.1,

  /** Mountain glyphs: base width (fraction of the map side) and grid spacing (× width). */
  mountainWidthFraction: 0.018,
  mountainSpacing: 0.62,
  /** Score = ½ peak height + ½ local relief, each ramping from Min to Min + Full (m). */
  mountainMinPeakM: 300,
  mountainFullPeakM: 1500,
  mountainMinReliefM: 200,
  mountainFullReliefM: 1000,
  /** Glyph probability ramps from 0 to 1 between these scores. */
  mountainScoreFrom: 0.4,
  mountainScoreTo: 0.75,
  /** On-screen glyph width the level of detail aims for (px). */
  mountainTargetPx: 22,
  mountainLit: 'rgb(226 214 190)',
  mountainShade: 'rgb(150 132 108)',
  snowCap: 'rgb(250 248 242)',

  /** Forest glyphs: width as a fraction of the mountain width, grid spacing (× width). */
  treeWidthRatio: 0.38,
  treeSpacing: 0.62,
  /** Forest patches: noise scale (fraction of the map side) and threshold band. */
  forestPatchFraction: 0.025,
  forestPatchFrom: 0.4,
  forestPatchTo: 0.55,
  /** Tree density ramps with annual wetness (%) and warmest month (°C). */
  forestDryPct: 35,
  forestWetPct: 65,
  treeLineC: 9,
  treeFullC: 13,
  /** Annual mean (°C) from all conifers to all broadleaf trees. */
  coniferBelowC: 4,
  broadleafAboveC: 13,
  leaf: 'rgb(118 142 70)',
  leafShade: 'rgb(78 104 50)',
  needle: 'rgb(74 106 72)',
  needleShade: 'rgb(46 74 50)',
  trunk: 'rgb(96 70 44)',
} as const;
