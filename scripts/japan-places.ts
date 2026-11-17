/**
 * Named places of the Japan sample map, in real coordinates (degrees).
 * Projected by build-sample-japan.ts with the same sinusoidal projection as the relief.
 * Zones are rough outlines (a handful of points), good enough to carry a name.
 */
import { FeatureTemplate, ImportanceRank } from '../src/app/domain/features/map-feature';

export interface JapanPlace {
  readonly name: string;
  readonly template: FeatureTemplate;
  /** [lat, lon] for a point. */
  readonly at?: readonly [number, number];
  /** [lat, lon, lat, lon, …] for a zone. */
  readonly outline?: readonly number[];
  /** Overrides the template's default importance. */
  readonly rank?: ImportanceRank;
}

const capital: FeatureTemplate = { kind: 'settlement', size: 'capital' };
const city: FeatureTemplate = { kind: 'settlement', size: 'city' };
const town: FeatureTemplate = { kind: 'settlement', size: 'town' };
const peak: FeatureTemplate = { kind: 'peak' };
const sea: FeatureTemplate = { kind: 'label', tone: 'water' };
const land: FeatureTemplate = { kind: 'label', tone: 'land' };
const plain: FeatureTemplate = { kind: 'region', tone: 'land' };
const bay: FeatureTemplate = { kind: 'region', tone: 'water' };

export const JAPAN_PLACES: readonly JapanPlace[] = [
  // Cities
  { name: 'Tokyo', template: capital, at: [35.68, 139.69] },
  { name: 'Osaka', template: city, at: [34.69, 135.5] },
  { name: 'Nagoya', template: city, at: [35.18, 136.91] },
  { name: 'Sapporo', template: city, at: [43.06, 141.35] },
  { name: 'Fukuoka', template: city, at: [33.59, 130.4] },
  { name: 'Sendai', template: city, at: [38.27, 140.87] },
  { name: 'Hiroshima', template: city, at: [34.39, 132.46] },
  { name: 'Kyoto', template: city, at: [35.01, 135.77], rank: 3 },
  { name: 'Busan', template: city, at: [35.18, 129.08] },
  { name: 'Vladivostok', template: city, at: [43.12, 131.89] },
  { name: 'Kobe', template: town, at: [34.69, 135.2] },
  { name: 'Yokohama', template: town, at: [35.44, 139.64] },
  { name: 'Niigata', template: town, at: [37.92, 139.04], rank: 3 },
  { name: 'Kagoshima', template: town, at: [31.6, 130.56], rank: 3 },
  { name: 'Kanazawa', template: town, at: [36.56, 136.66] },
  { name: 'Asahikawa', template: town, at: [43.77, 142.37] },
  { name: 'Hakodate', template: town, at: [41.77, 140.73] },
  { name: 'Aomori', template: town, at: [40.82, 140.74] },
  { name: 'Akita', template: town, at: [39.72, 140.1] },
  { name: 'Morioka', template: town, at: [39.7, 141.15] },
  { name: 'Kushiro', template: town, at: [42.98, 144.38] },
  { name: 'Nagano', template: town, at: [36.65, 138.18] },
  { name: 'Shizuoka', template: town, at: [34.98, 138.38] },
  { name: 'Okayama', template: town, at: [34.66, 133.92] },
  { name: 'Matsue', template: town, at: [35.47, 133.05] },
  { name: 'Matsuyama', template: town, at: [33.84, 132.77] },
  { name: 'Kōchi', template: town, at: [33.56, 133.53] },
  { name: 'Takamatsu', template: town, at: [34.34, 134.05] },
  { name: 'Nagasaki', template: town, at: [32.75, 129.88] },
  { name: 'Kumamoto', template: town, at: [32.8, 130.71] },
  { name: 'Miyazaki', template: town, at: [31.91, 131.42] },
  { name: 'Daegu', template: town, at: [35.87, 128.6] },

  // Peaks
  { name: 'Mont Fuji', template: peak, at: [35.36, 138.73], rank: 2 },
  { name: 'Kita-dake', template: peak, at: [35.67, 138.24], rank: 5 },
  { name: 'Hotaka', template: peak, at: [36.29, 137.65] },
  { name: 'Ontake', template: peak, at: [35.89, 137.48], rank: 5 },
  { name: 'Haku-san', template: peak, at: [36.15, 136.77], rank: 5 },
  { name: 'Asama', template: peak, at: [36.4, 138.52], rank: 5 },
  { name: 'Nantai', template: peak, at: [36.76, 139.49], rank: 5 },
  { name: 'Bandai', template: peak, at: [37.6, 140.07], rank: 5 },
  { name: 'Chōkai', template: peak, at: [39.1, 140.05], rank: 5 },
  { name: 'Iwaki', template: peak, at: [40.66, 140.3], rank: 5 },
  { name: 'Yōtei', template: peak, at: [42.83, 140.81], rank: 5 },
  { name: 'Asahi-dake', template: peak, at: [43.66, 142.85] },
  { name: 'Daisen', template: peak, at: [35.37, 133.55], rank: 5 },
  { name: 'Ishizuchi', template: peak, at: [33.77, 133.12], rank: 5 },
  { name: 'Aso', template: peak, at: [32.88, 131.1] },
  { name: 'Kirishima', template: peak, at: [31.93, 130.87], rank: 5 },
  { name: 'Sakurajima', template: peak, at: [31.58, 130.66], rank: 5 },
  { name: 'Paektu', template: peak, at: [42.0, 128.06] },

  // Seas and straits
  { name: 'Mer du Japon', template: sea, at: [40.3, 135.0] },
  { name: 'Océan Pacifique', template: sea, at: [33.0, 143.5] },
  { name: 'Mer d’Okhotsk', template: sea, at: [45.2, 145.5] },
  { name: 'Mer de Chine orientale', template: sea, at: [31.3, 129.6], rank: 2 },
  { name: 'Détroit de Corée', template: sea, at: [34.3, 129.6], rank: 3 },
  { name: 'Mer intérieure de Seto', template: sea, at: [34.15, 133.1], rank: 3 },
  { name: 'Détroit de Tsugaru', template: sea, at: [41.45, 140.45], rank: 4 },
  { name: 'Détroit de La Pérouse', template: sea, at: [45.6, 142.0], rank: 3 },

  // Islands, peninsulas, countries
  { name: 'Hokkaidō', template: land, at: [43.5, 142.9] },
  { name: 'Honshū', template: land, at: [37.4, 138.0] },
  { name: 'Shikoku', template: land, at: [33.75, 133.6] },
  { name: 'Kyūshū', template: land, at: [32.5, 131.0] },
  { name: 'Corée', template: land, at: [36.5, 128.9], rank: 1 },
  { name: 'Primorié', template: land, at: [44.5, 134.0] },
  { name: 'Sado', template: land, at: [38.05, 138.4], rank: 4 },
  { name: 'Tsushima', template: land, at: [34.4, 129.33], rank: 4 },
  { name: 'Oki', template: land, at: [36.2, 133.25], rank: 5 },
  { name: 'Awaji', template: land, at: [34.4, 134.85], rank: 5 },
  { name: 'Péninsule de Noto', template: land, at: [37.2, 136.9], rank: 4 },
  { name: 'Péninsule de Kii', template: land, at: [34.0, 135.8], rank: 4 },
  { name: 'Péninsule de Bōsō', template: land, at: [35.2, 140.1], rank: 5 },

  // Plains and ranges (zones)
  { name: 'Plaine du Kantō', template: plain, outline: [36.4, 139.0, 36.6, 139.6, 36.3, 140.3, 35.9, 140.6, 35.6, 140.2, 35.75, 139.75, 35.7, 139.3, 36.1, 139.0] },
  { name: 'Plaine d’Ishikari', template: plain, outline: [43.4, 141.3, 43.5, 141.7, 43.1, 141.9, 42.8, 141.7, 42.95, 141.35, 43.2, 141.25] },
  { name: 'Plaine d’Echigo', template: plain, outline: [38.1, 139.4, 37.95, 139.2, 37.6, 138.8, 37.4, 138.75, 37.45, 139.0, 37.8, 139.3, 38.05, 139.5] },
  { name: 'Plaine de Nōbi', template: plain, outline: [35.45, 136.55, 35.4, 137.0, 35.1, 137.0, 35.0, 136.75, 35.2, 136.5] },
  { name: 'Plaine d’Osaka', template: plain, outline: [34.85, 135.4, 34.85, 135.7, 34.5, 135.65, 34.45, 135.4, 34.7, 135.35] },
  { name: 'Plaine de Tsukushi', template: plain, outline: [33.45, 130.3, 33.4, 130.75, 33.2, 130.7, 33.15, 130.3] },
  { name: 'Plaine de Tokachi', template: plain, outline: [43.2, 142.8, 43.2, 143.5, 42.6, 143.5, 42.5, 143.2, 42.9, 142.9] },
  { name: 'Plaine de Sendai', template: plain, outline: [38.5, 140.9, 38.4, 141.3, 38.0, 141.0, 38.1, 140.85] },
  { name: 'Alpes japonaises', template: plain, outline: [36.9, 137.6, 36.3, 137.9, 35.4, 138.3, 35.2, 138.1, 35.8, 137.6, 36.6, 137.4] },
  { name: 'Monts Hidaka', template: plain, outline: [43.1, 142.6, 43.0, 142.9, 42.2, 143.3, 42.1, 143.15, 42.8, 142.6] },

  // Bays (zones)
  { name: 'Baie de Tokyo', template: bay, outline: [35.65, 139.85, 35.55, 140.05, 35.25, 139.85, 35.15, 139.75, 35.4, 139.65] },
  { name: 'Baie d’Ise', template: bay, outline: [35.0, 136.65, 34.95, 136.95, 34.6, 136.9, 34.65, 136.6] },
  { name: 'Baie de Suruga', template: bay, outline: [35.1, 138.6, 35.05, 138.8, 34.65, 138.8, 34.7, 138.4] },
  { name: 'Baie de Funka', template: bay, outline: [42.55, 140.4, 42.4, 140.95, 42.1, 140.9, 42.05, 140.6, 42.3, 140.3] },
  { name: 'Baie de Toyama', template: bay, outline: [36.95, 137.1, 36.95, 137.45, 36.75, 137.4, 36.8, 137.1] },
  { name: 'Golfe de Pierre-le-Grand', template: bay, outline: [43.3, 131.4, 43.0, 133.0, 42.4, 132.8, 42.6, 131.2] },
];
