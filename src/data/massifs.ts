// Liste fermée des massifs. Partagée entre l'application et les scripts de build.
// bbox = [ouest, sud, est, nord] en degrés WGS84.

export type BBox = [number, number, number, number];

export interface Massif {
  id: string;
  name: string;
  bbox: BBox;
  /** Identifiants des jeux GTFS locaux (voir scripts/lib/feeds.ts) en plus des jeux nationaux. */
  feeds: string[];
  /** Haute montagne : avertissements neige / avalanche plus marqués. */
  alpine: boolean;
  /** Zones exclues de l'emprise (rattachées à un massif voisin). */
  exclude?: BBox[];
}

export const MASSIFS: Massif[] = [
  { id: 'vosges', name: 'Vosges', bbox: [6.6, 47.72, 7.45, 48.65], feeds: ['fluo67', 'fluo68', 'fluo88'], alpine: false },
  { id: 'jura', name: 'Jura', bbox: [5.6, 46.15, 6.95, 47.3], exclude: [[6.2, 46.15, 6.95, 46.48]], feeds: ['mobigo', 'haute-savoie'], alpine: false },
  { id: 'alpes-nord', name: 'Alpes du Nord (Bauges, Aravis, Chablais)', bbox: [5.95, 45.55, 6.85, 46.4], feeds: ['haute-savoie', 'savoie'], alpine: true },
  { id: 'mont-blanc', name: 'Mont-Blanc', bbox: [6.65, 45.7, 7.1, 46.05], feeds: ['haute-savoie', 'chamonix'], alpine: true },
  { id: 'vanoise', name: 'Vanoise', bbox: [6.5, 45.2, 7.15, 45.6], feeds: ['savoie', 'val-isere'], alpine: true },
  { id: 'ecrins', name: 'Écrins', bbox: [6.0, 44.6, 6.6, 45.1], feeds: ['isere', 'zou-express', 'zou-proximite', 'transaltitude'], alpine: true },
  { id: 'vercors-chartreuse', name: 'Vercors / Chartreuse', bbox: [5.25, 44.65, 6.0, 45.55], exclude: [[5.88, 44.65, 6.0, 45.45], [5.95, 45.45, 6.0, 45.55], [5.76, 44.95, 5.88, 45.2]], feeds: ['isere', 'drome', 'savoie', 'transaltitude'], alpine: false },
  { id: 'mercantour', name: 'Alpes du Sud / Mercantour', bbox: [6.5, 43.9, 7.7, 44.45], feeds: ['zou-express', 'zou-proximite', 'lignes-azur'], alpine: true },
  { id: 'pyrenees', name: 'Pyrénées', bbox: [-1.8, 42.6, 3.2, 43.2], feeds: ['lio', 'pyrenees-atlantiques'], alpine: true },
  { id: 'massif-central', name: 'Massif central / Cévennes', bbox: [2.3, 43.85, 4.3, 45.6], feeds: ['lio', 'cantal', 'puy-de-dome', 'ardeche'], alpine: false },
  { id: 'corse', name: 'Corse', bbox: [8.5, 41.35, 9.6, 43.05], feeds: ['corse', 'cf-corse'], alpine: true },
];

/** Point dans l'emprise du massif (bbox élargie de `padM` mètres, hors zones exclues). */
export function inMassif(m: Massif, p: readonly number[], padM = 0): boolean {
  const dLat = padM / 111320;
  const dLon = padM / (111320 * Math.cos((((m.bbox[1] + m.bbox[3]) / 2) * Math.PI) / 180));
  const [w, s, e, n] = m.bbox;
  if (p[0] < w - dLon || p[0] > e + dLon || p[1] < s - dLat || p[1] > n + dLat) return false;
  return !(m.exclude ?? []).some((x) => p[0] >= x[0] && p[0] <= x[2] && p[1] >= x[1] && p[1] <= x[3]);
}

export function getMassif(id: string): Massif | undefined {
  return MASSIFS.find((m) => m.id === id);
}
