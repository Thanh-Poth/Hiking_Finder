// Horaires compactés par massif (TransitData) pour la recherche d'itinéraires dans le navigateur.
//
// Sélection en trois niveaux pour rester léger :
//  T1 : courses desservant un arrêt d'accès d'un itinéraire retenu (L0) ; L1 = leurs arrêts.
//  T2 : courses desservant un arrêt de L1 et une grande gare ou un autre arrêt de L1 ; L2 = leurs arrêts.
//  T3 : trains entre deux grandes gares dont l'une est dans L2 (approche depuis toute la France).
// Les arrêts des différents réseaux à moins de 400 m sont reliés par des correspondances à pied.

import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { MASSIFS, type Massif } from '../src/data/massifs';
import { haversine } from '../src/lib/geo';
import type { RouteData, Station, TransitData } from '../src/data/types';
import { FEEDS } from './lib/feeds';
import { CACHE, OUT, readJson, writeJson } from './lib/http';
import type { NormalizedFeed } from './lib/gtfs';
import { loadNormalized, normalizedPath } from './02-gtfs';

const WALK_M = 400;
const WALK_KMH = 4.5;

interface GTrip {
  feed: string;
  route: string;
  service: string;
  stops: string[]; // clés globales "feed|stop"
  times: number[];
}

export function buildTransit(m: Massif, feeds: NormalizedFeed[], originUics: Set<string>, accessKeys: string[]): { data: TransitData; index: Map<string, number> } {
  const stopInfo = new Map<string, { name: string; lon: number; lat: number; uic: string }>();
  const trips: GTrip[] = [];
  for (const f of feeds) {
    for (const [k, s] of Object.entries(f.stops)) stopInfo.set(`${f.feed}|${k}`, s);
    for (const t of f.trips) trips.push({ feed: f.feed, route: t.route, service: t.service, stops: t.stops.map((s) => `${f.feed}|${s}`), times: t.times });
  }
  const origins = new Set([...stopInfo].filter(([, s]) => s.uic && originUics.has(s.uic)).map(([k]) => k));

  const L0 = new Set(accessKeys);
  // Les arrêts proches des accès (autres réseaux, même lieu) comptent aussi comme accès.
  const near = (a: string, b: string) => {
    const A = stopInfo.get(a)!;
    const B = stopInfo.get(b)!;
    return haversine([A.lon, A.lat], [B.lon, B.lat]) <= WALK_M;
  };
  const touches = (t: GTrip, set: Set<string>) => t.stops.some((s) => set.has(s));
  const T1 = trips.filter((t) => touches(t, L0));
  const inT1 = new Set(T1);
  const L1 = new Set(T1.flatMap((t) => t.stops));
  // Arrêts à distance de marche de L1 (correspondances entre réseaux).
  const allKeys = [...stopInfo.keys()];
  const grid = new Map<string, string[]>();
  const cell = (lon: number, lat: number) => `${Math.floor(lon * 200)},${Math.floor(lat * 300)}`;
  for (const k of allKeys) {
    const s = stopInfo.get(k)!;
    const c = cell(s.lon, s.lat);
    if (!grid.has(c)) grid.set(c, []);
    grid.get(c)!.push(k);
  }
  const neighbours = (k: string): string[] => {
    const s = stopInfo.get(k)!;
    const cx = Math.floor(s.lon * 200);
    const cy = Math.floor(s.lat * 300);
    const out: string[] = [];
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (const o of grid.get(`${cx + dx},${cy + dy}`) ?? []) if (o !== k && near(k, o)) out.push(o);
    return out;
  };
  const L1w = new Set(L1);
  for (const k of L1) for (const o of neighbours(k)) L1w.add(o);
  const useful2 = new Set([...L1w, ...origins]);
  const T2 = trips.filter((t) => !inT1.has(t) && t.stops.some((s) => L1w.has(s)) && t.stops.filter((s) => useful2.has(s)).length >= 2);
  const L2 = new Set(T2.flatMap((t) => t.stops.filter((s) => useful2.has(s))));
  const inT2 = new Set(T2);
  const hubs = new Set([...L2].filter((s) => origins.has(s)));
  for (const k of L1w) if (origins.has(k)) hubs.add(k);
  const T3 = trips.filter((t) => t.feed === 'sncf' && !inT1.has(t) && !inT2.has(t) && t.stops.some((s) => hubs.has(s)) && t.stops.filter((s) => origins.has(s)).length >= 2);

  const keep = new Set([...L1w, ...L2, ...origins]);
  const selected: GTrip[] = [];
  for (const t of [...T1, ...T2, ...T3]) {
    const idx = t.stops.map((s, i) => (inT1.has(t) || keep.has(s) ? i : -1)).filter((i) => i >= 0);
    if (idx.length < 2) continue;
    selected.push({ ...t, stops: idx.map((i) => t.stops[i]), times: idx.map((i) => t.times[i]) });
  }

  // Tables compactes.
  const stopIdx = new Map<string, number>();
  const stops: TransitData['stops'] = [];
  const sid = (k: string) => {
    let i = stopIdx.get(k);
    if (i === undefined) {
      i = stops.length;
      stopIdx.set(k, i);
      const s = stopInfo.get(k)!;
      stops.push([s.name, s.lon, s.lat, s.uic]);
    }
    return i;
  };
  for (const k of accessKeys) if (stopInfo.has(k)) sid(k);
  const agencies: TransitData['agencies'] = [];
  const agencyIdx = new Map<string, number>();
  const routes: TransitData['routes'] = [];
  const routeIdx = new Map<string, number>();
  const services: string[] = [];
  const serviceIdx = new Map<string, number>();
  const byFeed = new Map(feeds.map((f) => [f.feed, f]));
  const outTrips: TransitData['trips'] = [];
  for (const t of selected) {
    const f = byFeed.get(t.feed)!;
    const rk = `${t.feed}|${t.route}`;
    let r = routeIdx.get(rk);
    if (r === undefined) {
      const route = f.routes[t.route];
      const ak = `${t.feed}|${route.agency}`;
      let a = agencyIdx.get(ak);
      if (a === undefined) {
        const ag = f.agencies[route.agency] ?? Object.values(f.agencies)[0] ?? { name: t.feed, url: '' };
        a = agencies.length;
        agencyIdx.set(ak, a);
        agencies.push([ag.name, ag.url, t.feed]);
      }
      r = routes.length;
      routeIdx.set(rk, r);
      routes.push([a, route.short, route.type, route.price]);
    }
    const sk = `${t.feed}|${t.service}`;
    let s = serviceIdx.get(sk);
    if (s === undefined) {
      s = services.length;
      serviceIdx.set(sk, s);
      services.push(f.services[t.service]);
    }
    outTrips.push([r, s, t.stops.map(sid), t.times]);
  }
  // Correspondances à pied entre arrêts retenus.
  const footpaths: TransitData['footpaths'] = [];
  for (const [k, i] of stopIdx) {
    for (const o of neighbours(k)) {
      const j = stopIdx.get(o);
      if (j === undefined || j <= i) continue;
      const a = stopInfo.get(k)!;
      const b = stopInfo.get(o)!;
      const d = haversine([a.lon, a.lat], [b.lon, b.lat]);
      footpaths.push([i, j, Math.max(2, Math.round(((d * 1.2) / 1000 / WALK_KMH) * 60))]);
    }
  }
  // Dernier jour de l'horizon où au moins une course circule.
  const start = feeds[0].start;
  let lastDay = 0;
  for (const b64 of services) {
    const bin = Buffer.from(b64, 'base64');
    for (let i = bin.length * 8 - 1; i > lastDay; i--) if (bin[i >> 3] & (1 << (i & 7))) {
      lastDay = i;
      break;
    }
  }
  const days = lastDay + 1;
  const nBytes = Math.ceil(days / 8);
  const data: TransitData = {
    start,
    days,
    stops,
    agencies,
    routes,
    services: services.map((b) => Buffer.from(b, 'base64').subarray(0, nBytes).toString('base64')),
    trips: outTrips,
    footpaths,
    origins: [...stopIdx].filter(([k]) => origins.has(k)).map(([, i]) => i),
  };
  console.log(`${m.id} : ${stops.length} arrêts, ${outTrips.length} courses (T1 ${T1.length}, T2 ${T2.length}, T3 ${T3.length}), ${footpaths.length} correspondances, horizon ${days} j`);
  return { data, index: stopIdx };
}

async function main() {
  const stations: Station[] = readJson(join(OUT, 'stations.json'));
  const originUics = new Set(stations.filter((s) => s.segment === 'a').map((s) => s.uic));
  const only = process.argv.slice(2);
  for (const m of MASSIFS) {
    if (only.length && !only.includes(m.id)) continue;
    const accessFile = join(CACHE, `access-${m.id}.json`);
    const routesFile = join(OUT, m.id, 'routes.json');
    if (!existsSync(accessFile) || !existsSync(routesFile)) {
      console.warn(`${m.id} : itinéraires absents, lancer d'abord 03-routes`);
      continue;
    }
    const access: { key: string; id: number }[] = readJson(accessFile);
    const feeds = FEEDS.filter((f) => (f.national || m.feeds.includes(f.id)) && existsSync(normalizedPath(f.id))).map((f) => loadNormalized(f.id));
    const { data, index } = buildTransit(m, feeds, originUics, access.map((a) => a.key));
    writeJson(join(OUT, m.id, 'transit.json'), data);
    // Renumérote les arrêts d'accès des itinéraires selon les indices de transit.json.
    const remap = new Map(access.map((a) => [a.id, index.get(a.key) ?? -1]));
    const routes: RouteData[] = readJson(routesFile);
    for (const r of routes) {
      r.access = r.access.map((a) => ({ ...a, stopId: remap.get(a.stopId) ?? -1 })).filter((a) => a.stopId >= 0);
    }
    writeJson(routesFile, routes);
    // Les ids d'accès sont désormais ceux de transit.json : on met à jour le fichier de correspondance.
    writeJson(accessFile, access.map((a) => ({ key: a.key, id: index.get(a.key) ?? -1 })));
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
