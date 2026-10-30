// Formats des fichiers statiques produits par /scripts et servis depuis public/data.

export type Potability = 'yes' | 'no' | 'unknown';

export type PoiKind =
  | 'water' // fontaine, robinet, point d'eau potable déclaré
  | 'spring' // source
  | 'hut_guarded' // refuge gardé
  | 'hut_unguarded' // refuge non gardé, cabane
  | 'shelter' // abri
  | 'camp_site'
  | 'shop' // ravitaillement
  | 'parking';

export interface Poi {
  id: string; // ex. "osm:n123", "ri:456"
  kind: PoiKind;
  lon: number;
  lat: number;
  ele?: number;
  name?: string;
  potable?: Potability;
  /** Source intermittente / saisonnière d'après la source. */
  seasonal?: boolean;
  /** Horaires ou période d'ouverture tels que fournis par la source. */
  opening?: string;
  /** Nombre de places (refuges). */
  capacity?: number;
  /** Lien vers la fiche source. */
  url?: string;
  source: 'osm' | 'refuges.info';
}

export interface AccessStop {
  stopId: number; // indice dans transit.stops
  name: string;
  lon: number;
  lat: number;
  /** Abscisse du point le plus proche sur l'itinéraire (m). */
  along: number;
  /** Distance à vol d'oiseau arrêt ↔ itinéraire (m). */
  distance: number;
  /** Nombre moyen de départs par jour (tous jours de l'horizon). */
  departuresPerDay: number;
}

export interface RouteScore {
  notoriety: number; // 0–1
  access: number; // 0–1
  total: number; // 0–1
  details: string[];
}

export interface RouteData {
  id: string;
  name: string;
  ref?: string;
  network?: string; // iwn | nwn | rwn | lwn
  osmRelation: number;
  wikipedia?: string;
  loop: boolean;
  lengthM: number;
  gain: number;
  loss: number;
  /** [lon, lat, ele] rééchantillonné. */
  coords: [number, number, number][];
  score: RouteScore;
  access: AccessStop[];
  /** Section du tracé OSM conservée dans le massif. */
  clipped: boolean;
}

export type RuleType = 'forbidden' | 'night_only' | 'near_hut_only' | 'allowed' | 'unknown';

export interface BivouacRule {
  id: string;
  type: RuleType;
  /** Heures autorisées, ex. "19:00–09:00". */
  hours?: string;
  title: string;
  /** Texte de la règle (citation ou résumé fidèle). */
  text: string;
  sourceName: string;
  sourceUrl: string;
  /** Date de vérification de la source (AAAA-MM-JJ). */
  checked: string;
}

export interface ProtectedFeature {
  type: 'Feature';
  properties: { name: string; category: string; ruleId: string; inpnId?: string };
  geometry: GeoJSON.Polygon | GeoJSON.MultiPolygon;
}

export interface ProtectedCollection {
  type: 'FeatureCollection';
  features: ProtectedFeature[];
}

/** Horaires compactés pour un massif (voir scripts/06-transit.ts). */
export interface TransitData {
  /** Premier jour de l'horizon, AAAAMMJJ. */
  start: string;
  days: number;
  /** [nom, lon, lat, uic8 | ""]. */
  stops: [string, number, number, string][];
  /** [nom, url, flux]. */
  agencies: [string, string, string][];
  /** [agence, nom court, route_type GTFS, prix GTFS en € ou -1]. */
  routes: [number, string, number, number][];
  /** Jours de circulation : chaîne base64 d'un champ de bits, bit i = jour start + i. */
  services: string[];
  /** [ligne, service, arrêts[], heures (minutes depuis minuit du jour de service)[]]. */
  trips: [number, number, number[], number[]][];
  /** Correspondances à pied [arrêt A, arrêt B, minutes]. */
  footpaths: [number, number, number][];
  /** Arrêts proposés comme points de départ (grandes gares). */
  origins: number[];
}

export interface Station {
  name: string;
  lon: number;
  lat: number;
  uic: string;
  /** Segment DRG SNCF (a = national, b = régional, c = local). */
  segment: string;
}

export interface FareEntry {
  /** Clé "uicA-uicB" (ordre alphabétique). */
  min: number;
  max: number;
  carrier: string;
}

export interface FaresData {
  updated: string;
  validFrom: string;
  source: string;
  sourceUrl: string;
  od: Record<string, FareEntry[]>;
}

export interface DatasetMeta {
  id: string;
  name: string;
  licence: string;
  licenceUrl: string;
  attribution: string;
  url: string;
  /** Date de dernière mise à jour de la source (AAAA-MM-JJ). */
  updated: string;
  /** Date de préparation par nos scripts. */
  fetched: string;
}

export interface MassifMeta {
  massif: string;
  built: string;
  routes: number;
  pois: number;
  datasets: string[];
  dem?: { bbox: [number, number, number, number]; width: number; height: number; step: number };
}
