import { describe, expect, it } from 'vitest';
import { glyphSnowChance, treeMix, reliefAltitudeM, reliefCoolingC, snowCapChance, snowCoverChance, snowZoneChance, zonalRows, zonalWetnessPct } from './drawing-climate';

describe('drawing zonal climate', () => {
  it('is wet at the equator and in mid-latitudes, dry in the subtropics', () => {
    expect(zonalWetnessPct(0)).toBeGreaterThan(60);
    expect(zonalWetnessPct(27)).toBeLessThan(20);
    expect(zonalWetnessPct(-27)).toBe(zonalWetnessPct(27));
    expect(zonalWetnessPct(50)).toBeGreaterThan(55);
  });

  it('cools with the relief class', () => {
    expect(reliefAltitudeM(0)).toBe(100);
    expect(reliefAltitudeM(1)).toBe(2500);
    expect(reliefCoolingC(1)).toBeCloseTo(16.25, 2);
    expect(reliefAltitudeM(0.5)).toBeCloseTo(700, 5);
  });

  it('gives warm summers in the south and cold ones in the far north', () => {
    const rows = zonalRows({ latitudeTopDeg: 80, latitudeBottomDeg: 10, axialTiltDeg: 23.44, globalTemperatureOffsetC: 0 }, 70);
    expect(rows.warmestC[69]).toBeGreaterThan(25);
    expect(rows.warmestC[0]).toBeLessThan(10);
    expect(rows.warmestC[0]).toBeLessThan(rows.warmestC[35]);
  });

  it('puts snow on glyphs where summers are cold, and caps on mid mountains further south', () => {
    expect(snowZoneChance(25, 0)).toBe(0);
    expect(snowZoneChance(5, 0)).toBe(1);
    // Same latitude, higher ground: colder, snowier.
    expect(snowZoneChance(13, 2)).toBeGreaterThan(snowZoneChance(13, 0));
    // Mid mountain: no cap in the tropics, a cap at ~55° (warmest ≈ 15 °C at sea level).
    expect(snowCapChance(29, 2)).toBe(0);
    expect(snowCapChance(15, 2)).toBe(1);
    expect(snowCapChance(29, 3)).toBe(1);
    expect(snowCapChance(5, 1)).toBe(0);
  });

  it('puts seasonal snow on the ground below about 0 °C, and keeps it longer on summits', () => {
    expect(snowCoverChance(-5)).toBe(1);
    expect(snowCoverChance(5)).toBe(0);
    const march = { wetnessPct: () => 50, warmestC: () => 20, monthC: () => 3, coldestC: () => -5 };
    expect(glyphSnowChance(march, 0, 0, 0, false)).toBe(0); // plain at 100 m: +2.4 °C
    expect(glyphSnowChance(march, 0, 0, 2, true)).toBe(1); // mid mountain summit at 2000 m: −10 °C
  });

  it('mixes the trees at the transitions and thins the forest where little grows', () => {
    const mixed = treeMix(15, -8, 50);
    expect(mixed.conifer).toBeGreaterThan(0.2);
    expect(mixed.broadleaf).toBeGreaterThan(0.2);
    expect(treeMix(27, 24, 80).palm).toBe(1);
    expect(treeMix(6, -20, 60).density).toBe(0); // above the tree line
    expect(treeMix(25, 5, 10).density).toBe(0); // desert
    expect(treeMix(25, 5, 30).density).toBeLessThan(0.7); // steppe: a thin wood
  });
});
