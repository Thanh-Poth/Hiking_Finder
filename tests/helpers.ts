import type { BivouacRule, Poi, RouteData } from '../src/data/types';

/** Ligne droite vers le nord, un sommet tous les ~100 m, altitude fournie par `ele(i)`. */
export function northLine(n: number, ele: (i: number) => number = () => 1000, lon = 6.0, lat0 = 45.0): [number, number, number][] {
  const dLat = 100 / 111195; // ≈ 100 m
  return Array.from({ length: n }, (_, i) => [lon, lat0 + i * dLat, ele(i)] as [number, number, number]);
}

export const ALLOWED: BivouacRule = { id: 'ok', type: 'allowed', title: 'ok', text: '', sourceName: '', sourceUrl: '', checked: '' };
export const FORBIDDEN: BivouacRule = { ...ALLOWED, id: 'no', type: 'forbidden' };

export function water(id: string, lon: number, lat: number, potable: Poi['potable'] = 'yes'): Poi {
  return { id, kind: 'water', lon, lat, potable, source: 'osm' };
}

export function route(coords: [number, number, number][], extra: Partial<RouteData> = {}): RouteData {
  return {
    id: 'r1', name: 'Test', osmRelation: 1, loop: false, lengthM: 0, gain: 0, loss: 0, coords,
    score: { notoriety: 0.5, access: 0.5, total: 0.5, details: [] }, access: [], clipped: false, ...extra,
  };
}
