import { formatLatitude, latitudeAtRow, latitudesFromPins, rowAtLatitude } from './latitude';

describe('latitude mapping', () => {
  const settings = { latitudeTopDeg: 60, latitudeBottomDeg: 40 };

  it('is linear from the top edge to the bottom edge, both ways', () => {
    expect(latitudeAtRow(settings, 1000, 0)).toBe(60);
    expect(latitudeAtRow(settings, 1000, 500)).toBe(50);
    expect(rowAtLatitude(settings, 1000, 45)).toBe(750);
  });

  it('derives the edges from two pins, in any order', () => {
    const edges = latitudesFromPins({ yCell: 250, latitudeDeg: 50 }, { yCell: 750, latitudeDeg: 30 }, 1000);
    expect(edges).toEqual({ latitudeTopDeg: 60, latitudeBottomDeg: 20 });
    expect(latitudesFromPins({ yCell: 750, latitudeDeg: 30 }, { yCell: 250, latitudeDeg: 50 }, 1000)).toEqual(edges);
    expect(latitudesFromPins({ yCell: 10, latitudeDeg: 50 }, { yCell: 10, latitudeDeg: 30 }, 1000)).toBeNull();
  });

  it('formats north, south and the equator', () => {
    expect(formatLatitude(45)).toBe('45° N');
    expect(formatLatitude(-12.25, 1)).toBe('12,3° S');
    expect(formatLatitude(0.2)).toBe('0°');
  });
});
