import { computeSeaMask } from './sea-mask';

/** Rows of digits: '0' = at sea level, '-' = below, '#' = land (10 m). */
function grid(rows: string[]): { alt: Int16Array; w: number; h: number } {
  const w = rows[0].length;
  const alt = new Int16Array(rows.join('').split('').map((c) => (c === '#' ? 10 : c === '-' ? -5 : 0)));
  return { alt, w, h: rows.length };
}

describe('computeSeaMask', () => {
  it('keeps low cells connected to the frame, drops an enclosed basin', () => {
    const { alt, w, h } = grid([
      '-######', //
      '-#####',
      '-#--##',
      '-#--##',
      '-#####',
    ].map((r) => r.padEnd(7, '#')));
    const sea = computeSeaMask(alt, w, h, 0);
    expect(sea[0]).toBe(1);
    expect(sea[4 * w]).toBe(1);
    expect(sea[2 * w + 2]).toBe(0); // the basin is land
    expect(sea[1]).toBe(0);
  });

  it('lets the sea through a diagonal 1-cell strait', () => {
    const { alt, w, h } = grid([
      '-####', //
      '#-###',
      '##--#',
      '##--#',
      '#####',
    ]);
    const sea = computeSeaMask(alt, w, h, 0);
    expect(sea[2 * w + 2]).toBe(1);
  });

  it('respects the sea level setting', () => {
    const { alt, w, h } = grid(['000', '0#0', '000']);
    expect(Array.from(computeSeaMask(alt, w, h, -1))).toEqual(new Array(9).fill(0));
    expect(computeSeaMask(alt, w, h, 0)[4]).toBe(0);
  });
});
