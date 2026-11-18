import { DrawToolId } from '../../application/editor-facade';
import { IconName } from '../icon/icon';

/** A tool of the Draw palette. `id` null = announced, not available yet (greyed, with its step). */
export interface DrawToolDef {
  readonly id: DrawToolId | null;
  readonly icon: IconName;
  readonly label: string;
  readonly key?: string;
  readonly description: string;
  readonly hint?: string;
}

export interface DrawToolGroup {
  /** Recommended order of drawing: coast, relief, forests, rivers. */
  readonly step: number;
  readonly title: string;
  readonly tools: readonly DrawToolDef[];
  /** Shown when the whole group is still to come. */
  readonly soon?: string;
}

export const PAN_TOOL: DrawToolDef = {
  id: 'pan',
  icon: 'pan',
  label: 'Déplacer',
  key: 'H',
  description: 'Glisser pour déplacer la carte, molette pour zoomer.',
  hint: 'Avec n’importe quel outil, le clic droit glissé déplace aussi la carte.',
};

export const DRAW_GROUPS: readonly DrawToolGroup[] = [
  {
    step: 1,
    title: 'Terre et mer',
    tools: [
      {
        id: 'land',
        icon: 'land',
        label: 'Terre',
        key: 'T',
        description: 'Peins les terres émergées. Le trait de côte se dessine tout seul.',
        hint: 'Avec « Bord » vers « découpé », la côte devient dentelée, comme sur une vraie carte. Repasser au même endroit redonne la même découpe.',
      },
      {
        id: 'sea',
        icon: 'sea',
        label: 'Mer',
        key: 'M',
        description: 'Rend la zone à la mer : creuse des baies, sépare des îles.',
        hint: 'Efface aussi le relief et les forêts dessinés dessous. Le relief ne se peint que sur la terre.',
      },
    ],
  },
  {
    step: 2,
    title: 'Relief',
    tools: [
      {
        id: 'plain',
        icon: 'plain',
        label: 'Plaine',
        key: '1',
        description: 'Terres basses, sans picto. Sert aussi de gomme pour les collines et les montagnes.',
        hint: 'À la conversion en monde : 0 à 200 m.',
      },
      {
        id: 'hills',
        icon: 'hills',
        label: 'Collines',
        key: '2',
        description: 'Relief doux, dessiné en petits mamelons.',
        hint: 'À la conversion en monde : 200 à 600 m.',
      },
      {
        id: 'midMountain',
        icon: 'midMountain',
        label: 'Moyenne montagne',
        key: '3',
        description: 'Massifs arrondis aux vallées habitables.',
        hint: 'À la conversion en monde : 600 à 1 500 m. Entoure les hautes montagnes d’une bande de moyenne montagne : la chaîne sera plus crédible.',
      },
      {
        id: 'highMountain',
        icon: 'highMountain',
        label: 'Haute montagne',
        key: '4',
        description: 'Grandes chaînes aux sommets enneigés.',
        hint: 'À la conversion en monde : 1 500 à 4 000 m. Plus on zoome, plus les pictos sont nombreux et petits par rapport à la chaîne.',
      },
    ],
  },
  {
    step: 3,
    title: 'Forêts',
    soon: 'prochaine étape',
    tools: [
      { id: null, icon: 'broadleaf', label: 'Feuillus', description: 'Forêts tempérées.' },
      { id: null, icon: 'conifer', label: 'Résineux', description: 'Forêts froides ou d’altitude.' },
      { id: null, icon: 'tropical', label: 'Tropicale', description: 'Forêt dense des climats chauds et humides.' },
      { id: null, icon: 'clearing', label: 'Défricher', description: 'Enlève les arbres.' },
    ],
  },
  {
    step: 4,
    title: 'Eaux',
    soon: 'bientôt',
    tools: [{ id: null, icon: 'river', label: 'Fleuve', description: 'Tracer un fleuve de la source à la mer.' }],
  },
];

export function drawToolDef(id: DrawToolId): DrawToolDef {
  if (id === 'pan') return PAN_TOOL;
  for (const group of DRAW_GROUPS) for (const tool of group.tools) if (tool.id === id) return tool;
  return PAN_TOOL;
}

export function drawToolForKey(key: string): DrawToolId | null {
  const upper = key.toUpperCase();
  for (const tool of [PAN_TOOL, ...DRAW_GROUPS.flatMap((g) => g.tools)]) if (tool.id && tool.key === upper) return tool.id;
  return null;
}
