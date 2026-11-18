import { ToolId, ViewMode, Workspace } from '../application/editor-facade';

/**
 * What the address bar remembers, so a reload (or a shared link) comes back
 * to the same map, section, tool and view. It lives in the fragment (#…):
 * GitHub Pages serves a single index.html and never sees the fragment.
 *
 *   #/carte/<map id>?etape=monde&section=climate&outil=raise&vue=landscape
 */
export type SectionId = 'relief' | 'climate' | 'water' | 'names' | 'render';

export interface UrlState {
  readonly mapId?: string;
  readonly workspace?: Workspace;
  readonly section?: SectionId;
  readonly tool?: ToolId;
  readonly view?: ViewMode;
}

const SECTIONS: readonly SectionId[] = ['relief', 'climate', 'water', 'names', 'render'];
const TOOLS: readonly ToolId[] = ['pan', 'raise', 'lower', 'smooth'];
const VIEWS: readonly ViewMode[] = ['relief', 'landscape', 'temperature', 'precipitation', 'wind'];
const MAP_PREFIX = '/carte/';
/** French words in the address bar, like the rest of the UI. */
const WORKSPACE_WORDS: Readonly<Record<Workspace, string>> = { draw: 'dessin', world: 'monde' };

function oneOf<T extends string>(allowed: readonly T[], value: string | null): T | undefined {
  return allowed.find((a) => a === value);
}

/** Reads a location hash; unknown or malformed parts are ignored. */
export function parseUrlState(hash: string): UrlState {
  const raw = hash.startsWith('#') ? hash.slice(1) : hash;
  const [path, query = ''] = raw.split('?', 2);
  const params = new URLSearchParams(query);
  let mapId: string | undefined;
  if (path.startsWith(MAP_PREFIX)) {
    try {
      mapId = decodeURIComponent(path.slice(MAP_PREFIX.length)) || undefined;
    } catch {
      mapId = undefined; // malformed escape: ignore
    }
  }
  const step = params.get('etape');
  return {
    mapId,
    workspace: (Object.keys(WORKSPACE_WORDS) as Workspace[]).find((w) => WORKSPACE_WORDS[w] === step),
    section: oneOf(SECTIONS, params.get('section')),
    tool: oneOf(TOOLS, params.get('outil')),
    view: oneOf(VIEWS, params.get('vue')),
  };
}

export function formatUrlState(state: UrlState): string {
  const params = new URLSearchParams();
  if (state.workspace) params.set('etape', WORKSPACE_WORDS[state.workspace]);
  if (state.section) params.set('section', state.section);
  if (state.tool) params.set('outil', state.tool);
  if (state.view) params.set('vue', state.view);
  const path = state.mapId ? MAP_PREFIX + encodeURIComponent(state.mapId) : '/';
  const query = params.toString();
  return `#${path}${query ? `?${query}` : ''}`;
}
