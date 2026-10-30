// Gares de départ proposées dans la recherche : référentiel SNCF « Gares de voyageurs » (ODbL).
// Segments DRG A (gares nationales) et B (gares régionales) ; les gares A servent d'origines
// pour la préparation des horaires de chaque massif.

import { join } from 'node:path';
import type { Station } from '../src/data/types';
import { fetchJson, OUT, writeJson } from './lib/http';

interface Gare {
  nom: string;
  segment_drg: string | null;
  position_geographique: { lon: number; lat: number } | null;
  codes_uic: string | null;
}

export const STATIONS_URL = 'https://ressources.data.sncf.com/api/explore/v2.1/catalog/datasets/gares-de-voyageurs/exports/json';

async function main() {
  const gares = await fetchJson<Gare[]>(STATIONS_URL, { maxAgeH: 24 * 7, cacheName: 'gares-de-voyageurs.json' });
  const out: Station[] = [];
  for (const g of gares) {
    if (!g.position_geographique || !g.codes_uic) continue;
    const seg = (g.segment_drg ?? 'C').split(';').sort()[0].toLowerCase();
    if (seg !== 'a' && seg !== 'b') continue;
    const uic = g.codes_uic.split(';')[0].trim().padStart(8, '0');
    out.push({ name: g.nom, lon: Math.round(g.position_geographique.lon * 1e5) / 1e5, lat: Math.round(g.position_geographique.lat * 1e5) / 1e5, uic, segment: seg });
  }
  out.sort((a, b) => a.name.localeCompare(b.name, 'fr'));
  writeJson(join(OUT, 'stations.json'), out);
  console.log(`${out.length} gares (dont ${out.filter((s) => s.segment === 'a').length} nationales)`);
}

if (process.argv[1]?.endsWith('01-stations.ts')) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
