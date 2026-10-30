// Chargement des données statiques (public/data), à la demande et par massif.

import type { BivouacRule, DatasetMeta, FaresData, MassifMeta, Poi, ProtectedCollection, RouteData, Station, TransitData } from './types';

const BASE = `${import.meta.env.BASE_URL}data/`;
const cache = new Map<string, Promise<unknown>>();

async function get<T>(path: string, optional = false): Promise<T | null> {
  if (!cache.has(path)) {
    cache.set(
      path,
      fetch(BASE + path).then((r) => {
        if (!r.ok) throw new Error(`${path} : HTTP ${r.status}`);
        return path.endsWith('.bin') ? r.arrayBuffer() : r.json();
      }),
    );
  }
  try {
    return (await cache.get(path)) as T;
  } catch (e) {
    cache.delete(path);
    if (optional) return null;
    throw e;
  }
}

export interface MassifData {
  routes: RouteData[];
  pois: Poi[];
  protectedAreas: ProtectedCollection | null;
  transit: TransitData | null;
  meta: MassifMeta | null;
}

export async function loadMassif(id: string): Promise<MassifData> {
  const [routes, pois, protectedAreas, transit, meta] = await Promise.all([
    get<RouteData[]>(`${id}/routes.json`, true),
    get<Poi[]>(`${id}/pois.json`, true),
    get<ProtectedCollection>(`${id}/protected.json`, true),
    get<TransitData>(`${id}/transit.json`, true),
    get<MassifMeta>(`${id}/meta.json`, true),
  ]);
  return { routes: routes ?? [], pois: pois ?? [], protectedAreas, transit, meta };
}

export async function loadDem(id: string): Promise<Int16Array | null> {
  const buf = await get<ArrayBuffer>(`${id}/dem.bin`, true);
  return buf ? new Int16Array(buf) : null;
}

export interface GlobalData {
  stations: Station[];
  fares: FaresData | null;
  rules: Record<string, BivouacRule>;
  sources: DatasetMeta[];
}

export async function loadGlobal(): Promise<GlobalData> {
  const [stations, fares, rules, sources] = await Promise.all([
    get<Station[]>('stations.json', true),
    get<FaresData>('fares.json', true),
    get<Record<string, BivouacRule>>('bivouac-rules.json', true),
    get<DatasetMeta[]>('sources.json', true),
  ]);
  return { stations: stations ?? [], fares, rules: rules ?? {}, sources: sources ?? [] };
}
