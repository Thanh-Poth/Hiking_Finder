// Contour simplifié de la France métropolitaine (IGN Admin Express, Licence Ouverte, via le
// projet france-geojson). Sert à écarter les itinéraires situés surtout en Suisse ou en Italie.

import { pointInPolygon } from '../../src/lib/geo';
import { fetchJson } from './http';

const URL = 'https://raw.githubusercontent.com/gregoiredavid/france-geojson/master/metropole-version-simplifiee.geojson';

type Rings = number[][][];
let polygons: Rings[] | null = null;

export async function loadFrance(): Promise<void> {
  if (polygons) return;
  type Geom = { geometry: GeoJSON.Polygon | GeoJSON.MultiPolygon };
  const json = await fetchJson<Geom | { features: Geom[] }>(URL, { maxAgeH: 24 * 365, cacheName: 'france-metropole.geojson' });
  // Le fichier est une Feature unique (MultiPolygon) ; on accepte aussi une FeatureCollection.
  const features = 'features' in json ? json.features : [json];
  polygons = features.flatMap((f) => (f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates));
}

export function inFrance(p: readonly number[]): boolean {
  if (!polygons) throw new Error('loadFrance() doit être appelé avant inFrance()');
  return polygons.some((rings) => pointInPolygon(p, rings));
}
