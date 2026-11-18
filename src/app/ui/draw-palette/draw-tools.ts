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
      {
        id: 'volcano',
        icon: 'volcano',
        label: 'Volcan',
        key: 'V',
        description: 'Choisis son type à droite, puis clique sur la terre pour le poser. Glisse un volcan existant pour le déplacer.',
        hint: 'Un volcan est un sommet isolé, pas une zone : il se pose n’importe où sur la terre, même en plaine. Pour l’enlever : outil « Effacer » (E). Pour le nommer : outil « Nommer » (N), type « Sommet ».',
      },
    ],
  },
  {
    step: 3,
    title: 'Forêts',
    tools: [
      {
        id: 'forest',
        icon: 'broadleaf',
        label: 'Forêt',
        key: '5',
        description: 'Peins une forêt : le climat choisit les arbres qui y poussent.',
        hint: 'Résineux au froid et en altitude, feuillus en climat tempéré, palmiers là où il ne gèle jamais et où il pleut ; mélangés dans les zones de transition. Trop sec ou trop froid : la forêt s’éclaircit, voire disparaît. Change le mois ou les latitudes pour voir l’effet.',
      },
      {
        id: 'clearing',
        icon: 'clearing',
        label: 'Défricher',
        key: '6',
        description: 'Enlève les arbres, sans toucher au relief.',
      },
    ],
  },
  {
    step: 4,
    title: 'Eaux',
    tools: [
      {
        id: 'lake',
        icon: 'lake',
        label: 'Lac',
        key: 'L',
        description: 'Peins un lac dans les terres. Sa rive se dessine comme la côte.',
        hint: 'Ne se peint que sur la terre. Un fleuve tracé jusqu’au lac s’y arrête ; tracé depuis le lac vers la mer, c’est son émissaire. Pour agrandir les terres sur un lac : outil « Terre ».',
      },
      {
        id: 'river',
        icon: 'river',
        label: 'Fleuve',
        key: 'R',
        description: 'Appuie à la source et glisse jusqu’à la mer, puis relâche. Le tracé est lissé tout seul.',
        hint: 'Aimant : pars d’un rond orange (bout d’un fleuve) pour le prolonger, d’un rond blanc (sur son cours) pour lui ajouter un affluent. Dépasser la côte ne gêne pas. Trace de la source vers la mer ; parti de la mer ou d’un fleuve, le tracé est retourné tout seul. Le fleuve s’élargit vers l’aval avec sa longueur et ses affluents.',
      },
      {
        id: 'riverErase',
        icon: 'trash',
        label: 'Effacer',
        key: 'E',
        description: 'Clique sur un fleuve ou un volcan pour le supprimer.',
        hint: 'Les affluents d’un fleuve effacé restent : ils sont signalés dans « À vérifier » s’ils ne finissent plus nulle part. Pour un lac : repeins-le avec « Terre ».',
      },
    ],
  },
  {
    step: 5,
    title: 'Noms',
    tools: [
      {
        id: 'names',
        icon: 'names',
        label: 'Nommer',
        key: 'N',
        description: 'Pose et modifie les noms : villes, sommets, régions, mers, chaînes, fleuves.',
        hint: 'Choisis le type dans le panneau de droite, puis clique sur la carte. Clique un nom pour le modifier, glisse-le pour le déplacer.',
      },
    ],
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
