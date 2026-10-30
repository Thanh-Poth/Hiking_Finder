// Télécharge et normalise les GTFS (transport.data.gouv.fr), puis indexe les arrêts de chaque massif
// avec leur fréquence de desserte (utilisée par le score d'accessibilité des itinéraires).

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { MASSIFS } from '../src/data/massifs';
import { padBBox, inBBox } from '../src/lib/geo';
import { FEEDS } from './lib/feeds';
import { CACHE, ensureDir, fetchCached, today, writeJson } from './lib/http';
import { normalizeGtfs, type NormalizedFeed } from './lib/gtfs';

export const HORIZON_DAYS = 120;

export function horizonStart(): string {
  return today().replace(/-/g, '');
}

export function normalizedPath(id: string): string {
  return join(CACHE, `gtfs-${id}.json`);
}

export function loadNormalized(id: string): NormalizedFeed {
  return JSON.parse(readFileSync(normalizedPath(id), 'utf8')) as NormalizedFeed;
}

export interface IndexedStop {
  feed: string;
  key: string;
  name: string;
  lon: number;
  lat: number;
  departuresPerDay: number;
}

async function main() {
  ensureDir(CACHE);
  const start = horizonStart();
  const only = process.argv.slice(2);
  for (const feed of FEEDS) {
    if (only.length && !only.includes(feed.id)) continue;
    const out = normalizedPath(feed.id);
    const stamp = out + '.stamp';
    if (existsSync(out) && existsSync(stamp) && readFileSync(stamp, 'utf8') === start) {
      console.log(`GTFS ${feed.id} : déjà normalisé aujourd'hui`);
      continue;
    }
    console.log(`GTFS ${feed.id} : téléchargement…`);
    const zip = await fetchCached(feed.url, { cacheName: `gtfs-${feed.id}.zip`, maxAgeH: 24 });
    console.log(`  ${(zip.length / 1e6).toFixed(1)} Mo, normalisation…`);
    const n = normalizeGtfs(feed.id, new Uint8Array(zip), start, HORIZON_DAYS);
    console.log(`  ${Object.keys(n.stops).length} arrêts, ${n.trips.length} courses actives`);
    writeFileSync(out, JSON.stringify(n));
    writeFileSync(stamp, start);
  }

  // Index des arrêts par massif (bbox élargie de 5 km) et fréquence moyenne.
  for (const m of MASSIFS) {
    const bbox = padBBox(m.bbox, 5000);
    const feeds = FEEDS.filter((f) => f.national || m.feeds.includes(f.id));
    const stops: IndexedStop[] = [];
    for (const f of feeds) {
      if (!existsSync(normalizedPath(f.id))) continue;
      const n = loadNormalized(f.id);
      const counts = new Map<string, number>();
      const serviceDays = new Map<string, number>();
      for (const [id, b64] of Object.entries(n.services)) {
        const bin = Buffer.from(b64, 'base64');
        let c = 0;
        for (const byte of bin) for (let k = 0; k < 8; k++) if (byte & (1 << k)) c++;
        serviceDays.set(id, c);
      }
      for (const t of n.trips) {
        const d = serviceDays.get(t.service) ?? 0;
        // Une montée possible à chaque arrêt sauf le dernier.
        for (const s of t.stops.slice(0, -1)) {
          const st = n.stops[s];
          if (st && inBBox([st.lon, st.lat], bbox)) counts.set(s, (counts.get(s) ?? 0) + d);
        }
      }
      for (const [key, c] of counts) {
        const st = n.stops[key];
        stops.push({ feed: f.id, key, name: st.name, lon: st.lon, lat: st.lat, departuresPerDay: Math.round((c / n.days) * 10) / 10 });
      }
    }
    writeJson(join(CACHE, `stops-${m.id}.json`), stops);
    console.log(`Massif ${m.id} : ${stops.length} arrêts desservis`);
  }
}

if (process.argv[1]?.endsWith('02-gtfs.ts')) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
