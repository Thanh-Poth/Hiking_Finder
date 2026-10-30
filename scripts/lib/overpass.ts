// Requêtes Overpass (au build uniquement), en série, avec cache et miroir de secours.

import { fetchCached, rateLimiter } from './http';

const ENDPOINTS = ['https://overpass-api.de/api/interpreter', 'https://overpass.private.coffee/api/interpreter'];
const wait = rateLimiter(0.5);

export interface OsmElement {
  type: 'node' | 'way' | 'relation';
  id: number;
  lat?: number;
  lon?: number;
  center?: { lat: number; lon: number };
  bounds?: { minlat: number; minlon: number; maxlat: number; maxlon: number };
  tags?: Record<string, string>;
  geometry?: { lat: number; lon: number }[];
  members?: { type: string; ref: number; role: string; geometry?: { lat: number; lon: number }[] }[];
}

export async function overpass(query: string, maxAgeH = 24 * 7): Promise<OsmElement[]> {
  let last: unknown;
  for (const url of ENDPOINTS) {
    try {
      await wait();
      const buf = await fetchCached(url, {
        method: 'POST',
        body: 'data=' + encodeURIComponent(query),
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        maxAgeH,
        retries: 2,
      });
      const json = JSON.parse(buf.toString('utf8')) as { elements: OsmElement[]; remark?: string };
      if (json.remark && /runtime error|timed out/i.test(json.remark)) throw new Error(json.remark);
      return json.elements;
    } catch (e) {
      last = e;
      console.warn(`  Overpass ${url} : ${(e as Error).message}`);
    }
  }
  throw last;
}

/** bbox [O, S, E, N] → "S,O,N,E" (ordre Overpass). */
export const obbox = (b: readonly number[]) => `${b[1]},${b[0]},${b[3]},${b[2]}`;
