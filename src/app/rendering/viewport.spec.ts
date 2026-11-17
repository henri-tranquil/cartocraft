import { cellToScreen, fitViewport, panBy, screenToCell, zoomAt, zoomLimits } from './viewport';

describe('viewport', () => {
  const vp = fitViewport(1000, 500, 800, 600);

  it('fits the grid and maps the centre both ways', () => {
    expect(vp.pixelsPerCell).toBeCloseTo(0.76);
    expect(screenToCell(vp, 400, 300)).toEqual({ x: 500, y: 250 });
    const s = cellToScreen(vp, 123, 45);
    const back = screenToCell(vp, s.x, s.y);
    expect(back.x).toBeCloseTo(123);
    expect(back.y).toBeCloseTo(45);
  });

  it('keeps the cell under the cursor fixed while zooming, within limits', () => {
    const limits = zoomLimits(1000, 500, 1, vp);
    const before = screenToCell(vp, 100, 50);
    const zoomed = zoomAt(vp, 100, 50, 4, limits);
    const after = screenToCell(zoomed, 100, 50);
    expect(after.x).toBeCloseTo(before.x);
    expect(after.y).toBeCloseTo(before.y);
    expect(zoomAt(vp, 0, 0, 1e6, limits).pixelsPerCell).toBe(limits.maxPixelsPerCell);
    expect(limits.maxPixelsPerCell).toBeCloseTo(60); // 600 px for 10 km
  });

  it('pans opposite to the drag direction in world space', () => {
    expect(panBy(vp, 76, 0).centerX).toBeCloseTo(400);
  });
});
