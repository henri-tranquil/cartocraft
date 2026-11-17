# CLAUDE.md — Cartocraft

**Cartocraft** : éditeur de cartes de monde en Angular, au rendu « carte illustrée rétro ».
Sous-projet de **Pangea** (jeu de gestion de réseau ferroviaire contemplatif, sous Godot), mais l'outil est générique : il doit aussi servir pour des cartes de JDR (D&D, etc.).

## Objectif

- **Maintenant** : créer en détail et visualiser un monde imaginé. On règle la forme, le relief, le climat et les saisons, et on nomme les régions, les fleuves, les montagnes, les mers et les villages.
- **Plus tard** : exporter des données exploitables pour fabriquer la vraie carte de jeu (heightmap pour Godot, etc.). Toute décision de modèle doit garder cette porte ouverte.

## Façon de travailler avec moi (Henri)

- Je suis développeur web Angular / NestJS. Tu peux être technique, mais **explique de façon pédagogique** les algorithmes et les notions nouvelles (simulation climatique, hydrologie, LOD, etc.) : je veux apprendre, pas seulement recevoir du code.
- **Pas de complaisance.** Si une idée, une demande ou un code existant ne tient pas la route, dis-le clairement et propose une alternative.
- Repère les incohérences entre ce fichier, le code et mes demandes, et signale-les.
- Pose des questions quand une décision m'appartient. Sinon, prends l'option raisonnable et annonce-la.
- Livre par petites étapes testables plutôt qu'un gros bloc.
- **Sois économe en tokens** : réponses concises, pas de relectures ni d'explorations inutiles, pas de sous-agents sans nécessité. Le but est d'être efficace (la pédagogie reste prioritaire quand une notion est nouvelle).

## Stack

- **Angular** (dernière version stable) : composants standalone, **signals** pour l'état, `inject()`, nouveau control flow (`@if`, `@for`). Pas de NgModules et pas de NgRx.
- **TypeScript strict** (`strict: true`, pas de `any` ; utiliser `unknown` puis un type guard si besoin).
- **Canvas 2D** pour le rendu, et **Web Workers** pour les calculs lourds (climat, hydrologie, génération de tuiles).
- **IndexedDB** pour la sauvegarde automatique, et **non localStorage** : sa limite de ~5 Mo est trop basse pour les grilles. Utiliser un petit wrapper (`idb`) ou l'API native.
- Compression avec `CompressionStream` / `DecompressionStream` natifs (gzip), sans dépendance.
- Tests : **Vitest** (runner par défaut d'Angular) sur tout le domaine ; `fake-indexeddb` pour la persistance.
- **ESLint** (`angular-eslint`) : une règle `no-restricted-imports` interdit à `domain/` d'importer Angular, RxJS ou les autres couches.
- Le code (identifiants, commentaires) est en anglais, l'UI en français. Prévoir l'i18n plus tard, sans l'implémenter maintenant.

## Principes d'architecture

1. **Le domaine est du TypeScript pur, sans Angular.** Les algorithmes (relief, climat, fleuves, sérialisation) ne doivent pas importer `@angular/*`. On peut ainsi les tester, les exécuter dans des Workers et, un jour, les porter ou les réutiliser pour l'export Godot.
2. **Dépendances à sens unique** : `ui → application → domain` et `infrastructure → domain`. Le domaine ne dépend de rien.
3. **Données vs rendu** : le modèle ne sait rien de l'apparence. Le rendu lit le modèle et ne le modifie jamais.
4. **Les patterns doivent résoudre un vrai problème.** Si un pattern n'apporte rien à un endroit, ne l'impose pas.

### Arborescence cible

```
src/app/
  domain/                 # TS pur
    map/                  # WorldMap, MapSettings, coordonnées, unités
    terrain/              # grilles, tuiles, quadtree, bruit procédural
    climate/              # vents, température, précipitations, saisons
    hydrology/            # remplissage des cuvettes, directions d'écoulement, accumulation, fleuves
    features/             # régions, fleuves nommés, lacs, sommets, villages, étiquettes
    commands/             # Command + CommandHistory
    serialization/        # format de fichier, versions, migrations
  application/            # services Angular d'orchestration
    map-store.ts          # état (signals)
    editor-facade.ts      # point d'entrée unique pour l'UI
    tools/                # outils d'édition (Strategy)
  infrastructure/
    persistence/          # IndexedDbMapRepository, FileMapRepository
    workers/              # workers + protocole de messages typé
  rendering/
    layers/               # couches de rendu (pipeline)
    sprites/              # jeux de pictos (montagnes, arbres…)
    style/                # le style « carte illustrée »
    tile-cache.ts         # cache LRU des tuiles rendues
  ui/                     # composants : canvas, panneaux, barre d'outils, timeline des saisons
```

## Design patterns retenus

| Pattern | Où | Pourquoi |
|---|---|---|
| **Command** | `domain/commands` | Annuler/rétablir. Chaque édition est une commande `execute()/undo()`. Un coup de pinceau = **une** commande qui stocke le diff des tuiles touchées (avant/après), pas un snapshot complet. Historique borné à 100 entrées **et** 256 Mo (`Command.sizeBytes`). Un geste est peint en direct puis enregistré via `history.record()` (pas ré-exécuté). |
| **Strategy** | `application/tools` | Les outils (`RaiseTerrain`, `LowerTerrain`, `Smooth`, `CarveValley`, `PlaceRiverSource`, `PlaceLabel`, `DrawRegion`, `Select`…) implémentent la même interface `EditorTool` (`onPointerDown/Move/Up`, curseur, options). |
| **Pipeline / couches** | `rendering/layers` (à introduire quand il y aura ≥ 2 couches ; à l'étape 3, un seul `TerrainRaster`) | Chaque couche (`OceanLayer`, `LandLayer`, `ReliefLayer`, `ForestLayer`, `HydroLayer`, `RegionLayer`, `LabelLayer`…) implémente `RenderLayer` avec une plage de zoom visible et dessine dans le contexte d'une tuile. L'ordre se définit dans un tableau, et on ajoute une couche sans toucher aux autres. |
| **Strategy (style)** | `rendering/style` | Un seul style pour l'instant (« carte illustrée »), mais derrière une interface `MapStyle` (palettes, sprites, typos). On n'en implémente **qu'un seul** : pas de sélecteur de style maintenant. |
| **Repository + Adapter** | `domain/map/map-repository.ts` (ports) + `infrastructure/persistence` (adapters) | `MapRepository` (`save(map, changedTiles)`, `load`, `list`, `delete`) implémenté par `IndexedDbMapRepository`. Le fichier `.cartocraft` n'est **pas** un repository (ni liste ni suppression) : c'est un port `MapFileCodec` (`exportMap`, `importMap`). Les implémentations sont injectées via des `InjectionToken` (`application/ports.ts`) liés dans `app.config.ts`, pour que `application` ne dépende pas d'`infrastructure`. |
| **Factory** | `domain/map` | `MapFactory.blank(settings)` et `MapFactory.fromNoise(settings, seed)` pour « Nouvelle carte ». |
| **Facade** | `application/editor-facade.ts` | Les composants ne parlent qu'à la façade, jamais directement au store, aux commandes ou aux workers. |
| **Observer (signals)** | `application/map-store.ts` | L'état est exposé en signals, et les `computed` dérivent ce qui est affiché. Une modification marque des tuiles « sales » : le rendu ne recalcule que celles-là. |
| **Chaîne de migrations** | `domain/serialization` | Chaque fichier porte une `formatVersion`. Une liste ordonnée de migrations `vN → vN+1` s'applique à l'import. On ne casse jamais la lecture d'une ancienne carte. |

## Modèle de données

### Échelle et résolution : le point le plus critique

Un monde peut faire la taille de la France (~1000 × 1000 km), et le zoom maximal est l'**échelle d'une vallée** (pas de maisons : un village = un point + un nom). Un raster fin uniforme est donc impossible (des milliards de valeurs). Le relief se construit en trois étages :

1. **Grille de base peinte par l'utilisateur** : résolution réglable à la création, par défaut **1 cellule = 1 km**, avec un maximum indicatif de 2048 × 2048 cellules. L'altitude est stockée en `Int16` (mètres, −32768..32767), soit 2 Mo pour 1000 × 1000.
2. **Retouches locales haute résolution** (×4 par défaut, soit 250 m) : stockées **uniquement là où l'utilisateur peint zoomé**, dans des tuiles creuses indexées par un quadtree. Une zone non retouchée ne coûte rien.
3. **Détail procédural** : au-delà des données stockées, un bruit fractal **déterministe** (graine de la carte + coordonnées) ajoute du détail à l'affichage. Le même endroit donne toujours le même relief, et ce détail n'est **jamais** stocké.

Altitude finale en un point = interpolation (base + retouches) + détail procédural, ce dernier atténué près du niveau de la mer pour ne pas créer d'îles parasites.

Les données sont **découpées en tuiles** (ex. 256 × 256 cellules) pour le stockage, le diff des commandes et l'invalidation du rendu.

### WorldMap (schématique)

```ts
interface WorldMap {
  id: string;
  name: string;
  formatVersion: number;
  settings: MapSettings;
  terrain: TerrainData;        // base + tuiles de retouche
  climateOverrides: Grid;      // corrections d'humidité peintes à la main (optionnel)
  features: MapFeature[];      // éléments vectoriels
  hydrologyHints: RiverHint[]; // sources et points de passage imposés
  createdAt: string; updatedAt: string;
}

interface MapSettings {
  widthKm: number; heightKm: number;
  baseCellKm: number;          // 1 par défaut
  seed: number;
  latitudeTopDeg: number;      // ex. 70 (°N)
  latitudeBottomDeg: number;   // ex. 10 ; indépendant de la taille de la carte
  axialTiltDeg: number;        // 23.4 par défaut ; pilote l'amplitude des saisons
  seaLevelM: number;           // 0 m
  globalTemperatureOffsetC: number;
}
```

Dans le code, `terrain` contient `baseAltitudeM` (grille `Int16` en tuiles). Les champs `features`, `climateOverrides` et `hydrologyHints` sont ajoutés à leur étape respective (6, 4, 5), chacun avec une migration de format.

La `WorldMap` est **mutable** (grilles modifiées en place par les commandes). Le store notifie via un compteur `revision` (signal), pas par changement de référence.

### Éléments vectoriels (`MapFeature`, union discriminée sur `kind`)

- `region` : polygone + nom + couleur de frontière optionnelle
- `river` : référence à un fleuve **calculé** (identifié par sa source ou son embouchure) + nom. Le tracé n'est pas stocké, il est recalculé.
- `lake`, `sea` : zone + nom
- `peak`, `range` : point ou polyligne + nom (sommet, chaîne de montagnes)
- `settlement` : point + nom + importance (village, ville, capitale)
- `label` : texte libre, position, angle ou chemin courbe

Chaque élément nommé a un **rang d'importance**, qui détermine à partir de quel zoom il apparaît.

## Climat (pas de biomes)

**Règle absolue : aucune classification en biomes.** Le climat est fait de **champs continus**, et la couleur se calcule directement à partir des valeurs.

Le calcul se fait sur la grille de base (inutile de descendre plus fin), dans un Worker :

1. **Insolation** selon la latitude et la saison. La saison est un paramètre `t ∈ [0,1[` cyclique, et l'inclinaison de l'axe décale l'équateur thermique.
2. **Température de base** = f(insolation) − gradient d'altitude (~6,5 °C / 1000 m).
3. **Vents dominants par bandes de latitude** (alizés, vents d'ouest, vents polaires), qui se décalent avec la saison.
4. **Advection** : la chaleur, le froid et l'humidité sont transportés le long des vents, par itérations sur la grille. La mer est une source d'humidité et adoucit les températures.
5. **Effet du relief** :
   - côté exposé au vent, l'air monte et il pleut ;
   - côté abrité, l'air redescend sec (ombre pluviométrique) ;
   - **une chaîne de montagnes bloque et dévie l'air froid** venu du nord. Ses vallées abritées restent plus douces.
6. Sorties par saison : `temperature`, `precipitation`, plus un champ d'enneigement déduit de la température.

**Implémentation (étape 4, briques 1-2)** :
- Saison = phase de l'année `t ∈ [0,1[`, **0 = 1er janvier** (plus lisible dans l'UI que l'équinoxe).
- 12 instantanés mensuels (milieu de mois) précalculés ; le curseur interpole entre deux mois. Stockage `Int16` en **dixièmes de °C** (24 Mo pour 1000², ~100 Mo pour 2048² : à surveiller).
- Température moyenne annuelle = **table** insolation → °C calée sur les moyennes zonales terrestres (pas une droite : la vraie relation est plate sous les tropiques, raide vers les pôles). Amplitude saisonnière amortie et retardée par l'inertie thermique (terre 45 %, ~1 mois ; mer 22 %, ~2 mois). Surface de la mer bornée à −1,8 °C (gel de l'eau de mer).
- Inclinaison de l'axe (brique 5) : réglée **comme les latitudes**, dans le même bloc, en glissant un tropique (±inclinaison) ou un cercle polaire (±(90° − inclinaison)) sur la règle, ou au clavier ; aperçu pendant le glissement, une commande annulable au relâchement ; bouton « Terre » (23,4°), max 60°. Le décalage global de température reste dans le modèle mais **sans UI** (choix d'Henri).
- Calcul dans `infrastructure/workers/climate.worker.ts` derrière le port `ClimateEngine` ; `ClimateService` relance avec un délai de 1,5 s après une édition, une seule exécution à la fois, résultats périmés ignorés (compteur de génération).

**Brique 3 (vents + advection)** :
- Vents dominants : modèle à trois cellules, `u = −U·sin(6|φ|)`, ceintures décalées de 40 % de la déclinaison.
- Advection semi-lagrangienne sur une **grille grossière** (≤ 256 cellules de côté), balayages alternés en place ; relaxation `e^(−Δs/L)`, `L = vitesse × τ` (τ terre 1 j, mer ½ j). La correction (T advectée − T locale) est rééchantillonnée et ajoutée aux températures fines (qui gardent l'altitude).
- Humidité : vapeur d'eau advectée ; la mer évapore selon **sa propre température** (air froid sur mer chaude → averses, effet de lac).
- **Mousson** (`monsoon.ts`) : anomalie thermique (T d'équilibre − T de la mer à la même latitude), lissée à ~600 km ; l'air remonte ce gradient (froid → chaud, des hautes vers les basses pressions), dévié par Coriolis jusqu'à 55° (traversée des isobares à 35° à cause du frottement), atténué près de l'équateur. Vent total = ceintures + mousson, **par cellule grossière** (`windGrid`).
- Calibrage sur le Japon : mer à 22 % de l'oscillation saisonnière, τ mer 1 jour. Écart moyen aux 7 stations ≈ 1,9 °C. Restent trop doux en hiver : Sapporo (+4), Osaka/Kagoshima/Busan (+2,5) — le vrai anticyclone de Sibérie est hors de la carte.

**Brique 4 (précipitations, relief)** :
- Vapeur plafonnée à 90 % de la saturation **à la hauteur du relief** (hauteur vue par l'air = moyenne + ½ (max − moyenne) de la cellule grossière). L'excédent condense : pluie orographique = efficacité × flux de vapeur × excédent / largeur de cellule. L'air redescend sec derrière : ombre pluviométrique, sans règle spéciale.
- Pluie de fond (fronts, convection) : colonne d'eau × lissage(HR 0,45 → 0,9) / temps de vidange.
- Sorties : `precipitationMm` (Float32, grille grossière) et `wetnessPct` (Uint8, fine) = pluie / (pluie + ETP), moyenne mois courant + précédent ; ETP ≈ 10 + 4,6·T mm/mois. La végétation (vue Paysage) suit `wetnessPct`. Vue « Pluie » en mm/mois.
- Calibrage (Japon) : temps de vidange 3 j, efficacité orographique 0,2, HR d'équilibre terre 0,6. Écart annuel moyen ×1,5. **Limites** : Sapporo ×3 trop sec, Busan trop humide, Tokyo sec en hiver ; pas de front saisonnier (baiu), ni de typhons, ni de rails de tempêtes. - **Manteau neigeux** (`snow.ts`) : bilan mensuel sur la grille fine, `stock = stock + chutes − fonte` ; méthode des **degrés-jours positifs statistique** (températures journalières ~ N(moyenne, 3 °C) : part de jours < +1 °C pour la neige, E[max(0, T)] × facteur pour la fonte), tables précalculées. Facteur degré-jour = 0,5 + 4 × insolation/500 W/m² (≈ 1,5 mm/°C/j en janvier à 43° N, ≈ 4 au printemps : la fonte vient surtout du soleil). Un an simulé depuis août + report du stock de fin juillet (glaciers). Sortie `snowDepthCm` (Uint8, fine, ~35 Mo pour 1700²). La vue Paysage blanchit selon l'épaisseur (≈ 15 cm = couverture totale).
- **Relief et air** (`terrain-flow.ts`) : stabilité de l'air ≈ anomalie thermique lissée à ~100 km (continent froid → air froid stable). L'air stable est **dévié** le long des pentes (part montante retirée, vitesse en partie gardée) ; l'air doux et instable monte et nourrit la pluie orographique. En advection, chaque mètre à monter érode la mémoire : `× e^(−montée / D)`, D = 1000 m pour l'air plus froid que le sol, 3000 m pour l'air plus chaud (blocage asymétrique).
- **Foehn** : la chaleur latente de condensation (≈ 2,5 °C par g/kg, 30 % gardés près du sol) est une source de chaleur advectée ; le versant sous le vent reçoit un air plus chaud et sec. Tokyo en janvier : 4,5 °C (réel 5,4) contre 3,2 sans foehn.
- **Domaine élargi et « au-delà des bords »** (`climate-domain.ts`) : le calcul grossier se fait sur la carte + une marge de 800 km (au plus ½ côté de la carte), remplie par bord selon `settings.beyondEdges` (`continue` = prolonger le bord, `ocean`, `land`) ; les latitudes continuent au-delà du haut et du bas. Réglage dans le panneau Climat (4 menus en croix), commande annulable. Format **v2** (migration v1→v2 : `continue` partout). Limite : un bord est uniforme (le bord ouest du Japon est moitié continent, moitié mer).
- **Continentalité** : l'amplitude saisonnière des terres augmente avec la part de terre dans un rayon de 800 km (`CONTINENTAL_GAIN` 0,3, smoothstep 0,3→0,9). Sans elle, un continent au-delà du bord n'était pas plus froid que le Japon.
- Performance : ~3,3 s pour 1700² (Worker chaud) malgré le domaine élargi : échantillonnage amont et mémoire de blocage précalculés une fois par advection, passe fine unique (température + humidité + neige), neige et humidité ignorées sur la mer, `Math.hypot` remplacé. 8 balayages restent nécessaires (4 ne convergent pas). La grille grossière passe à ~11 km (7 km avant) pour le Japon.
- **Biais connus (Japon, bords N continent / S, E océan / O prolonger)** : températures justes à Hokkaidō (Sapporo −2,9 °C, Asahikawa −9 °C en janvier), mais **trop peu de neige en plaine** (Sapporo 3 cm, Asahikawa 9 cm en février) car trop peu de précipitations hivernales (Sapporo 36 mm en janvier contre 108). L'effet de mer est sous-estimé : l'air se réchauffe aussi vite qu'il s'humidifie et ne sature jamais au ras de l'eau. Essai rejeté : soulèvement convectif fixe (1500 m) + bandes transportées, qui condense tout en début de traversée et assèche la côte (Niigata 84 → 46 mm). Piste : couche instable qui s'épaissit avec la distance parcourue sur la mer. Vladivostok 4 °C et Busan 5 °C trop froids en hiver, Kagoshima 3 °C trop doux. Pic de pluie irréaliste au sommet du Fuji (cellules très raides).

**Dossier en pause : la neige du nord du Japon** (Sapporo ~1 m, Niigata ~1 m en février ; modèle : 3 cm, 0 cm).
- Résolu : hiver trop doux (+4 à +7 °C) → domaine élargi + « au-delà des bords » + continentalité ; Sapporo −2,9 °C (réel −3,2), Asahikawa −9 °C (réel −7,5).
- Résolu : fonte d'hiver excessive → facteur degré-jour piloté par l'insolation, σ journalier 3 °C.
- Écarté : la chaleur latente du foehn (−0,5 °C seulement), 4 balayages d'advection (non convergé), une marge « continent » à l'ouest (Kagoshima −6 °C de trop).
- **Reste** : précipitations d'hiver trop faibles (Sapporo 36 mm en janvier contre 108, Niigata 84 contre 180). Cause : sur la mer, l'air se réchauffe aussi vite qu'il s'humidifie et ne sature jamais au ras de l'eau. Essai rejeté : soulèvement convectif fixe de 1500 m + bandes de neige transportées (tout condense en début de traversée, Niigata tombe à 46 mm).
- Piste unique si on reprend : couche convective dont l'épaisseur croît avec la distance parcourue sur une mer plus chaude que l'air (champ advecté), condensation en altitude au sommet de cette couche. Également : vents d'hiver trop faibles sur la mer du Japon (5–8 m/s, réel 10–12).

Rendu : la couleur des terres suit un dégradé continu en fonction (température, humidité) : ocre sec, vert humide, blanc enneigé. Un curseur (timeline) de saison anime le tout : la neige descend, la végétation change de teinte, les fleuves du nord gèlent.

## Hydrologie (fleuves hybrides)

- **Calcul automatique** à partir du relief :
  1. remplissage des cuvettes (algorithme *priority-flood*), pour qu'aucun fleuve ne reste bloqué ;
  2. direction d'écoulement de chaque cellule vers sa voisine la plus basse (D8) ;
  3. accumulation (combien de cellules se déversent dans chacune) ;
  4. un fleuve apparaît au-delà d'un seuil, et ce seuil est modulé par les précipitations.
- **Contrôle par l'utilisateur** (hybride) :
  - pinceau « creuser une vallée » : on modifie le relief et le fleuve suit ;
  - poser une **source** ou des **points de passage** : ils sont traduits en creusement léger le long du chemin, puis on recalcule ;
  - nommer un fleuve calculé.
- **Principe** : on ne force jamais un tracé qui contredit le relief. On modifie le relief, et l'eau suit.
- Les cuvettes profondes peuvent devenir des lacs (option).

## Rendu et niveaux de détail

Style : **inspiré** des cartes de fantasy illustrées (référence d'Henri, genre Wonderdraft : mer sarcelle sombre marbrée avec halo turquoise côtier, terres parchemin, plaines vert olive pilotées par le climat, montagnes en pictos 3/4 ombrés, forêts en grappes d'arbres, typo à empattements, noms courbés). C'est une inspiration et non une copie : adapter le look au niveau de zoom.

Zoom sémantique, avec trois niveaux indicatifs (ajustables) :

| Niveau | Échelle | Contenu |
|---|---|---|
| **Continent** | toute la carte | aplats climatiques, chaînes en pictos groupés, grands fleuves, noms de mers et de régions |
| **Région** | ~100–300 km | pictos de montagne individuels, forêts, fleuves principaux et secondaires, villes |
| **Vallée** (zoom max) | ~10–30 km | pictos plus petits et plus denses, tous les cours d'eau, villages = point + nom, noms secondaires |

- **Vue Rendu (étape 7 avancée, brique 1)** : section « Rendu » (lecture seule) ; `rendering/vintage-pixels.ts` (mer marbrée par fBm, halo côtier et bord de parchemin pilotés par deux champs de distance chanfrein, grain, trait de côte vectoriel (1,1 px) (marching squares). Calcul dans `rendering/workers/vintage.worker.ts` (~0,7 s pour 1700²). Largeurs en fraction de la carte, pas en km (convention visuelle, à revoir avec le zoom sémantique). Pictos de montagnes (`vintage-mountains.ts`) : grille jitterée, score = ½ altitude du sommet + ½ dénivelé local, tirés vers le sommet (ils suivent les crêtes), triés d'arrière en avant ; flancs à la plume irréguliers, ombre hachurée à l'est, pied fondu. **4 niveaux de détail** précalculés (taille ÷ 2 par niveau), choisis pour ~22 px à l'écran : premier zoom sémantique. **Pas d'ombrage** en vue Rendu (choix d'Henri : le relief ne se lit que par les pictos). **Couleur** : lavis climatique sur le parchemin (ocre sec → vert humide selon l'humidité annuelle, pâle si le mois le plus chaud < ~10 °C), modulé par les taches. **Forêts** (`vintage-forests.ts`) : densité = humidité × été assez chaud (limite des arbres ~10 °C au mois le plus chaud) × taches de bruit (bois en grappes, échelle liée à la carte) ; pas sous les montagnes ; conifères si température annuelle basse. Résumés annuels du climat (`vintage-climate.ts`) calculés sur le thread principal puis transférés au Worker ; la vue montre l'année, pas la saison. Suite, puis fleuves (étape 5) et noms (étape 6).
- **Étape 3 (actuel)** : `TerrainRaster` garde un bitmap 1 pixel = 1 cellule par tuile de données, mis à jour par rectangles sales (`MapStore.takeDirtyRects`), sur le thread principal. Teintes hypsométriques + ombrage (lumière NO, exagération verticale ×4). Zoom avant affiché en pixels nets (pas de lissage), pour rester honnête sur la résolution des données jusqu'à l'étape 8.
- **Rendu par tuiles** de taille fixe en pixels, calculées dans un Worker (`OffscreenCanvas`) et mises dans un **cache LRU**. Une édition invalide seulement les tuiles concernées.
- Le placement des pictos est **déterministe** (graine + coordonnées de la tuile), sinon ils « sautent » à chaque rendu.
- Les étiquettes sont dessinées dans une couche à part, au-dessus des tuiles (elles ne doivent pas être coupées par les bords de tuile), avec une gestion simple des collisions par importance.
- Les **sprites** (montagnes, arbres, collines) sont dans des jeux remplaçables. On commence avec des pictos simples générés, puis on affine : c'est la partie visuelle la plus difficile, ne pas viser la perfection au premier jet.
- Cadre, cartouche de titre, rose des vents et échelle : **plus tard**, au moment de l'export image.

## Interface (chrome de l'éditeur)

Style **néo-brutalisme sur parchemin**, palette « C1 Encre & ocre » (maquettes : https://claude.ai/artifact/EnBzBz4x8FrS3a2jhmYAPw).

- Traits d'encre épais (3–4 px), ombres pleines décalées, aplats ; un bouton actif « s'enfonce » (perd son ombre).
- **Peu de texte, des pictos, mais la compréhension d'abord** : chaque bouton porte un picto (`ui/icon/icon.ts`, SVG inline en `currentColor`) **et une légende courte** (`.cc-caption`, 1 mot). Seules exceptions : les symboles universels dans un espace très réduit (dupliquer, supprimer), qui gardent `aria-label` + bulle. Les bulles (`title`) donnent le détail et le raccourci clavier.
- Mise en page : barre sombre au bord gauche = **cartes enregistrées en petits carrés** (initiales, bulle = nom/taille/date) suivies de « + » (nouvelle) et Importer ; à côté, la barre des sections (Relief/Climat/Eaux/Noms) ; puis le panneau d'outils de la section, avec en bas, sous un séparateur, les actions sur la carte ouverte (Exporter, Copier, Supprimer en rouge) ; la carte encadrée prend le reste. Seule la section Relief modifie le terrain ; ailleurs, le clic déplace la carte.
- Latitudes : réglées par **deux repères** glissés sur la carte (règle graduée + équateur, tropiques, cercles polaires affichés pendant le réglage ; tropiques et cercles polaires glissables pour l'inclinaison) ; une commande annulable `UpdateSettingsCommand`.
- Jetons et classes globales dans `src/styles.scss` (`--cc-*`, `.cc-btn`, `.cc-nav-btn`, `.cc-panel`). Pas de couleur en dur dans les composants.
- **Forme des boutons = signature de la famille d'outils** : `shape-tampon` (sections, Relief), `shape-sceau` (actions fichier, annuler, Eaux), `shape-galet` (Climat), `shape-feuille` (Noms).
- Polices : Space Grotesk (UI), IM Fell English SC (noms de lieux, titres).
- Interface compacte : base 14 px, traits 2 px (`--cc-border`), 3 px pour les cadres (`--cc-border-strong`), ombres 3 px.
- La vue (centre + zoom) est mémorisée **par carte** dans `localStorage` (`cartocraft:view:<id>`) : confort local, pas une donnée de carte ; bouton « recadrer » pour revenir à la vue d'ensemble.
- **URL** (`ui/url-state.ts`) : `#/carte/<id>?section=…&outil=…&vue=…` (fragment, compatible GitHub Pages, sans Router). Lue au démarrage (la carte de l'URL, sinon la plus récente) et sur `hashchange`, réécrite par `history.replaceState` (pas d'entrée d'historique).

## Carte de test : Japon

- Données réelles (AWS Terrain Tiles « Terrarium », SRTM + bathymétrie, zoom 7), projection sinusoïdale centrée sur 137,5° E, 1700 × 1700 km à 1 km, 46° N → 30,7° N.
- `npm run sample:japan` (script `scripts/build-sample-japan.ts`, tuiles en cache dans `scripts/.cache`) → `public/samples/japon.cartocraft`.
- Installée dans IndexedDB par `SampleMaps` avec un id fixe (`sample-japon`). **Incrémenter `SAMPLE_JAPAN.version`** (`application/samples.ts`) à chaque régénération : l'app remplace alors la copie locale (les retouches locales de l'exemple sont perdues). Une carte d'exemple supprimée n'est réinstallée qu'à la version suivante.
- **À tenir à jour à chaque étape** (fleuves nommés, villes, régions…) ; c'est la référence pour juger le réalisme (comparer aux stations : Sapporo, Niigata, Tokyo, Osaka, Kagoshima, Vladivostok, Busan).

## Import d'un dessin de carte

- Bouton « dessin » de la barre de gauche → `ui/sketch-import-dialog` : l'utilisateur clique un point de **mer** puis un point de **terre** ; aperçu de la mer détectée ; largeur en km (hauteur déduite des proportions), résolution, latitudes. Crée **toujours une nouvelle carte** (`MapFactory.fromAltitudes`), sans réglage de climat (calculé ensuite comme d'habitude).
- Domaine `domain/terrain/sketch.ts` : couleurs des deux clics proches → **dessin au trait** (remplissage de la mer depuis le clic, l'encre dilatée de 1 px fait barrière ; une mer intérieure non reliée reste terre) ; sinon **carte en couleur** (couleur la plus proche). Nettoyage par composantes connexes (petites mers non reliées → terre, poussières d'îlots → mer). Relief **inventé** : terres basses qui montent avec la distance à la côte, montagnes là où l'encre est dense (lissée, estompée sur la côte), fonds qui se creusent au large, bruit fractal.
- Limites connues : les forêts dessinées deviennent des montagnes (encre dense) ; les noms écrits aussi ; traitement sur le thread principal (image ≤ 1600 px, ~1 s).

## Persistance

- **Auto-save** dans IndexedDB (base `cartocraft`), avec un debounce de 2 s après la dernière modification, plus un flush sur `visibilitychange` et avant tout changement de carte. Seules les tuiles modifiées sont réécrites (une entrée IndexedDB par tuile, clé `[mapId, grille, index]`). Au chargement, les tuiles sont réassemblées et passent par **la même chaîne migrations + validation** que les fichiers.
- **Export** : fichier `.cartocraft` = gzip(`"CCFT"` + longueur d'en-tête uint32 LE + en-tête JSON + blocs binaires). Grilles en **row-major little-endian**, indépendantes de la taille de tuile en mémoire. Pas de JSON pour les grilles : un tableau de nombres en JSON est 5 à 10 fois plus gros.
- **Import** : crée toujours une **nouvelle** carte locale (nouvel id), il n'écrase jamais une carte existante.
- **Import** : lecture de l'en-tête, vérification de `formatVersion`, application de la chaîne de migrations, puis validation. En cas d'échec : message clair, et rien n'est écrasé.
- **Nouvelle carte** : dialogue de réglages (taille, résolution, latitudes, graine, relief vierge ou généré).
- Liste des cartes locales : ouvrir, dupliquer, supprimer.

## Déploiement (GitHub Pages)

Dépôt GitHub : **`cartocraft`**. L'interface sera publiée plus tard sur `https://<user>.github.io/cartocraft/` (donc `<repo>` = `cartocraft` ci-dessous, et le préfixe de stockage = `cartocraft`). Les choix techniques doivent rester compatibles avec ça dès maintenant :

- **100 % statique, côté client** : aucun backend, aucune API serveur. Tout le calcul se fait dans le navigateur (c'est déjà le cas avec les Workers).
- **Base href** : build avec `ng build --base-href /<repo>/`. Aucun chemin absolu codé en dur (`/assets/...`) : toujours des chemins relatifs, ou résolus via la base.
- **Routing** : GitHub Pages ne sait pas rediriger les routes profondes vers `index.html`. Utiliser `withHashLocation()`, ou copier `index.html` en `404.html` au build.
- **Origine partagée** : toutes les pages `<user>.github.io/*` partagent la **même origine**, donc le même IndexedDB et le même localStorage. Il faut **préfixer** le nom de la base IndexedDB et toutes les clés avec le nom du projet pour éviter les collisions avec d'autres projets publiés.
- **Workers et sprites** : vérifier qu'ils se chargent bien sous le sous-chemin `/<repo>/` (à tester dès le premier déploiement, pas à la fin).
- **CI** : déploiement via une GitHub Action (build puis publication sur Pages) à chaque push sur `main`.

## Feuille de route

1. **Socle** : projet Angular, arborescence, modèle `WorldMap`, tuiles, Command + historique, façade, store.
2. **Persistance** : IndexedDB, export/import `.cartocraft` avec version et migrations, nouvelle carte.
3. **Relief** : canvas avec pan/zoom, pinceaux relief (monter, baisser, lisser), côte déduite du niveau de la mer, rendu simple (aplats).
4. **Climat** : réglage des latitudes, vents, advection, effets orographiques, timeline des saisons, dégradés de couleur.
5. **Hydrologie** : calcul automatique, outils source, passage et creusement, nommage.
6. **Nommage** : régions, sommets, chaînes, mers, villages, étiquettes courbes, visibilité selon le zoom.
7. **Style illustré** : pictos de montagnes et forêts, hachures de vagues, halo côtier, typo. Bouton **« Rendre la carte »** qui bascule entre la vue *édition* (teintes hypsométriques lisibles, actuelle) et la vue *rendu* (style illustré, accordé à la charte parchemin).
8. **Niveaux de détail** : retouches haute résolution en quadtree, détail procédural, rendu par tuiles en Workers.
9. **Export** image (PNG avec cadre, cartouche, rose, échelle) puis heightmap pour Godot.

Chaque étape doit être utilisable à la fin. Ne pas commencer l'étape suivante avec des bugs connus non signalés.

## Budgets de performance

- Pinceau : retour visuel < 16 ms (60 fps) sur la zone touchée. Les recalculs lourds (climat, fleuves) sont différés et faits dans un Worker.
- Recalcul du climat sur 1000 × 1000 : quelques secondes au maximum, avec un indicateur, sans figer l'UI.
- Mémoire : surveiller la taille du cache de tuiles (le plafonner).

## Conventions

- Fonctions pures pour les algorithmes du domaine, avec un test unitaire pour chacun.
- Messages des workers typés (union discriminée), jamais de `postMessage` avec un objet libre.
- `TypedArray` pour toutes les grilles, jamais de `number[][]`.
- Pas de magie silencieuse : toute valeur d'échelle (km, m, °C) est nommée avec son unité (`widthKm`, `altitudeM`).
- Composants Angular en `ChangeDetectionStrategy.OnPush`.

## Questions ouvertes

- ~~Résolution de base et taille maximale réalistes~~ : **mesuré à l'étape 3** sur 2048² (V8) : touche de pinceau r=25 + rendu ≈ 0,4 ms ; r=200 ≈ 9 ms + 14 ms de rendu (limite) ; rendu complet ≈ 325 ms (ouverture) ; 6 ms par tuile entière (annuler). **2048² reste le maximum**, la limite pratique est le rayon du pinceau en cellules, pas la taille de la grille.
- Faut-il des calques (plusieurs couches de noms, couches masquables) dès l'étape 6 ?
- Format exact de l'export vers Godot : à définir quand le prototype Godot existera.
