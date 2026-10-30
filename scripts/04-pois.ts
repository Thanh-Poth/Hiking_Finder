// Points utiles par massif : eau, refuges, cabanes, abris, campings, ravitaillements, parkings.
// Sources : OpenStreetMap (Overpass, ODbL) et Refuges.info (API, CC BY-SA 2.0).
// Pour limiter le volume, seuls les points situés à moins de 2 km d'un des itinéraires retenus
// sont conservés (sauf l'eau et les abris, gardés sur tout le massif pour l'import GPX).

import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { MASSIFS, type Massif } from '../src/data/massifs';
import { cumulativeDistances, haversine, simplify, snapToLine } from '../src/lib/geo';
import type { Poi, PoiKind, Potability, RouteData } from '../src/data/types';
import { elevations } from './lib/elevation';
import { fetchJson, OUT, readJson, rateLimiter, writeJson } from './lib/http';
import { obbox, overpass, type OsmElement } from './lib/overpass';

const NEAR_ROUTE_M = 2000;
const PARKING_NEAR_M = 300;

function osmKind(t: Record<string, string>): PoiKind | null {
  if (t.amenity === 'drinking_water' || t.man_made === 'water_tap' || t.amenity === 'water_point') return 'water';
  if (t.amenity === 'fountain' && t.drinking_water === 'yes') return 'water';
  if (t.natural === 'spring') return 'spring';
  if (t.tourism === 'alpine_hut') return 'hut_guarded';
  if (t.tourism === 'wilderness_hut') return 'hut_unguarded';
  if (t.amenity === 'shelter' && (t.shelter_type === 'basic_hut' || t.shelter_type === 'lean_to')) return 'hut_unguarded';
  if (t.amenity === 'shelter') return 'shelter';
  if (t.tourism === 'camp_site') return 'camp_site';
  if (t.shop && /^(supermarket|convenience|bakery|general|greengrocer|farm)$/.test(t.shop)) return 'shop';
  if (t.amenity === 'parking' && t.access !== 'private' && t.access !== 'customers') return 'parking';
  return null;
}

function osmPotable(t: Record<string, string>, kind: PoiKind): Potability | undefined {
  if (kind !== 'water' && kind !== 'spring') return undefined;
  if (t.drinking_water === 'yes' || t['drinking_water:legal'] === 'yes') return 'yes';
  if (t.drinking_water === 'no' || t['drinking_water:legal'] === 'no') return 'no';
  if (t.amenity === 'drinking_water') return 'yes';
  return 'unknown';
}

function fromOsm(e: OsmElement): Poi | null {
  const t = e.tags ?? {};
  const kind = osmKind(t);
  if (!kind) return null;
  const lat = e.lat ?? e.center?.lat;
  const lon = e.lon ?? e.center?.lon;
  if (lat === undefined || lon === undefined) return null;
  const p: Poi = { id: `osm:${e.type[0]}${e.id}`, kind, lon: Math.round(lon * 1e5) / 1e5, lat: Math.round(lat * 1e5) / 1e5, source: 'osm', url: `https://www.openstreetmap.org/${e.type}/${e.id}` };
  if (t.name) p.name = t.name;
  const pot = osmPotable(t, kind);
  if (pot) p.potable = pot;
  if (t.seasonal && t.seasonal !== 'no') p.seasonal = true;
  if (t.intermittent === 'yes') p.seasonal = true;
  if (t.opening_hours) p.opening = t.opening_hours;
  if (t.capacity && /^\d+$/.test(t.capacity)) p.capacity = Number(t.capacity);
  if (t.ele && /^-?\d+(\.\d+)?$/.test(t.ele)) p.ele = Math.round(Number(t.ele));
  return p;
}

// Refuges.info : types de points (https://www.refuges.info/api/doc/).
const RI_TYPES: Record<string, PoiKind> = {
  'refuge gardé': 'hut_guarded',
  'cabane non gardée': 'hut_unguarded',
  "gîte d'étape": 'hut_guarded',
  "point d'eau": 'water',
};

interface RiFeature {
  geometry: { coordinates: [number, number, number?] };
  properties: {
    id: number;
    nom: string;
    type: { valeur: string };
    coord?: { alt?: number };
    lien?: string;
    places?: { valeur?: number };
    etat?: { valeur?: string };
    date?: { derniere_modif?: string };
  };
}

const riWait = rateLimiter(1);

async function refugesInfo(m: Massif): Promise<Poi[]> {
  await riWait();
  const url = `https://www.refuges.info/api/bbox?bbox=${m.bbox.join(',')}&type_points=all&nb_points=all&format=geojson&detail=simple`;
  const d = await fetchJson<{ features: RiFeature[] }>(url, { maxAgeH: 24 * 7 });
  const out: Poi[] = [];
  for (const f of d.features) {
    const kind = RI_TYPES[f.properties.type?.valeur?.toLowerCase() ?? ''];
    if (!kind) continue;
    if (/détruit|ruine|fermé/i.test(f.properties.etat?.valeur ?? '')) continue;
    const [lon, lat, alt] = f.geometry.coordinates;
    const p: Poi = {
      id: `ri:${f.properties.id}`,
      kind,
      lon: Math.round(lon * 1e5) / 1e5,
      lat: Math.round(lat * 1e5) / 1e5,
      name: f.properties.nom,
      source: 'refuges.info',
      url: f.properties.lien ?? `https://www.refuges.info/point/${f.properties.id}`,
    };
    const ele = alt ?? f.properties.coord?.alt;
    if (ele) p.ele = Math.round(ele);
    if (kind === 'water') p.potable = 'unknown';
    if (f.properties.places?.valeur) p.capacity = f.properties.places.valeur;
    if (f.properties.etat?.valeur) p.opening = f.properties.etat.valeur;
    out.push(p);
  }
  return out;
}

/** Fusion : un point refuges.info à moins de 80 m d'un point OSM de même famille est un doublon. */
function dedupe(osm: Poi[], ri: Poi[]): Poi[] {
  const fam = (k: PoiKind) => (k === 'water' || k === 'spring' ? 'eau' : k.startsWith('hut') ? 'hut' : k);
  const out = [...osm];
  for (const p of ri) {
    const dup = osm.find((o) => fam(o.kind) === fam(p.kind) && haversine([o.lon, o.lat], [p.lon, p.lat]) < 80);
    if (dup) {
      dup.name ??= p.name;
      dup.capacity ??= p.capacity;
      if (!dup.opening && p.opening) dup.opening = p.opening;
    } else out.push(p);
  }
  return out;
}

export async function buildMassifPois(m: Massif): Promise<void> {
  const routesFile = join(OUT, m.id, 'routes.json');
  const routes: RouteData[] = existsSync(routesFile) ? readJson(routesFile) : [];
  const q = `[out:json][timeout:240];
(
  nwr["amenity"~"^(drinking_water|water_point|shelter)$"](${obbox(m.bbox)});
  nwr["man_made"="water_tap"](${obbox(m.bbox)});
  nwr["amenity"="fountain"]["drinking_water"="yes"](${obbox(m.bbox)});
  node["natural"="spring"](${obbox(m.bbox)});
  nwr["tourism"~"^(alpine_hut|wilderness_hut|camp_site)$"](${obbox(m.bbox)});
  nwr["shop"~"^(supermarket|convenience|bakery|general|greengrocer|farm)$"](${obbox(m.bbox)});
  nwr["amenity"="parking"](${obbox(m.bbox)});
);
out center tags;`;
  const els = await overpass(q);
  const osm = els.map(fromOsm).filter((p): p is Poi => p !== null);
  let ri: Poi[] = [];
  try {
    ri = await refugesInfo(m);
  } catch (e) {
    console.warn(`  refuges.info indisponible : ${(e as Error).message}`);
  }
  let pois = dedupe(osm, ri);
  // Filtre de proximité pour les commerces, parkings et campings.
  const lines = routes.map((r) => {
    const l = simplify(r.coords, 30);
    return { l, c: cumulativeDistances(l) };
  });
  const nearRoute = (p: Poi, radius: number) => lines.some(({ l, c }) => snapToLine([p.lon, p.lat], l, c).distance <= radius);
  pois = pois.filter(
    (p) => ['water', 'spring', 'hut_guarded', 'hut_unguarded', 'shelter'].includes(p.kind) || nearRoute(p, p.kind === 'parking' ? PARKING_NEAR_M : NEAR_ROUTE_M),
  );
  // Altitude IGN pour les points qui n'en ont pas.
  const missing = pois.filter((p) => p.ele === undefined);
  if (missing.length) {
    const eles = await elevations(missing.map((p) => [p.lon, p.lat]));
    missing.forEach((p, i) => {
      if (Number.isFinite(eles[i])) p.ele = Math.round(eles[i]);
    });
  }
  writeJson(join(OUT, m.id, 'pois.json'), pois);
  const count = (k: string) => pois.filter((p) => p.kind === k).length;
  console.log(`${m.id} : ${pois.length} points (eau ${count('water')}, sources ${count('spring')}, refuges ${count('hut_guarded')}, cabanes ${count('hut_unguarded')}, abris ${count('shelter')}, campings ${count('camp_site')}, commerces ${count('shop')}, parkings ${count('parking')})`);
}

async function main() {
  const only = process.argv.slice(2);
  for (const m of MASSIFS) {
    if (only.length && !only.includes(m.id)) continue;
    await buildMassifPois(m);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
