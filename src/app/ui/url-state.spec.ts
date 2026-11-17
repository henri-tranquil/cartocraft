import { formatUrlState, parseUrlState } from './url-state';

describe('url state', () => {
  it('round-trips map, section, tool and view', () => {
    const state = { mapId: 'sample-japon', section: 'climate', tool: 'smooth', view: 'landscape' } as const;
    const hash = formatUrlState(state);
    expect(hash).toBe('#/carte/sample-japon?section=climate&outil=smooth&vue=landscape');
    expect(parseUrlState(hash)).toEqual(state);
  });

  it('escapes odd ids and ignores unknown or malformed values', () => {
    expect(parseUrlState(formatUrlState({ mapId: 'a/b c' })).mapId).toBe('a/b c');
    expect(parseUrlState('#/carte/%E0?section=nope&outil=raise&vue=???')).toEqual({ mapId: undefined, section: undefined, tool: 'raise', view: undefined });
    expect(parseUrlState('')).toEqual({ mapId: undefined, section: undefined, tool: undefined, view: undefined });
  });
});
