// Tarifs ouverts SNCF (ODbL) : fourchettes plein tarif 2de classe par origine-destination.
// - Tarifs TGV INOUI et OUIGO : ressources.data.sncf.com/explore/dataset/tarifs-tgv-inoui-ouigo
// - Tarifs Intercités : ressources.data.sncf.com/explore/dataset/tarifs-intercites
// Aucun tarif TER ouvert à jour n'existe (jeux régionaux retirés en 2025) : ces trajets restent
// « prix non disponible » dans l'application, avec un lien vers le site officiel.

import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { MASSIFS } from '../src/data/massifs';
import type { FareEntry, FaresData, TransitData } from '../src/data/types';
import { fetchJson, OUT, readJson, writeJson } from './lib/http';

const API = 'https://ressources.data.sncf.com/api/explore/v2.1/catalog/datasets/';

interface Meta {
  metas: { default: { modified: string; description: string } };
}

const key = (a: string, b: string) => (a < b ? `${a}-${b}` : `${b}-${a}`);

async function dataset(id: string) {
  const meta = await fetchJson<Meta>(`${API}${id}`, { maxAgeH: 24 });
  const rows = await fetchJson<Record<string, string | number>[]>(`${API}${id}/exports/json`, { maxAgeH: 24, cacheName: `fares-${id}.json` });
  const desc = meta.metas.default.description.replace(/<[^>]+>/g, ' ');
  const valid = [...desc.matchAll(/(\d{2}\/\d{2}\/\d{4})/g)].map((m) => m[1]);
  return { rows, modified: meta.metas.default.modified.slice(0, 10), valid };
}

async function main() {
  // Paires de gares utiles : toutes celles qui apparaissent dans les horaires d'un massif.
  const uics = new Set<string>();
  for (const m of MASSIFS) {
    const f = join(OUT, m.id, 'transit.json');
    if (!existsSync(f)) continue;
    const t: TransitData = readJson(f);
    for (const s of t.stops) if (s[3]) uics.add(s[3]);
  }
  const od: Record<string, FareEntry[]> = {};
  const add = (a: string, b: string, e: FareEntry) => {
    if (!uics.has(a) || !uics.has(b) || !Number.isFinite(e.min) || !Number.isFinite(e.max)) return;
    const k = key(a, b);
    (od[k] ??= []).push(e);
  };
  const tgv = await dataset('tarifs-tgv-inoui-ouigo');
  for (const r of tgv.rows) {
    if (String(r.classe) !== '2' || !/normal/i.test(String(r.profil_tarifaire))) continue;
    add(String(r.gare_origine_code_uic), String(r.gare_destination_code_uic), { min: Number(r.prix_minimum), max: Number(r.prix_maximum), carrier: String(r.transporteur) });
  }
  const ic = await dataset('tarifs-intercites');
  for (const r of ic.rows) {
    if (String(r.classe) !== '2' && !/2/.test(String(r.classe))) continue;
    if (r.profil_tarifaire && !/normal|plein/i.test(String(r.profil_tarifaire))) continue;
    add(String(r.origine_uic8), String(r.destination_uic8), { min: Number(r.prix_min), max: Number(r.prix_max), carrier: String(r.transporteur || 'Intercités') });
  }
  const fares: FaresData = {
    updated: [tgv.modified, ic.modified].sort().at(-1)!,
    validFrom: `TGV INOUI ${tgv.valid[0] ?? '?'}, OUIGO ${tgv.valid[1] ?? '?'}, Intercités ${ic.valid[0] ?? '?'}`,
    source: 'SNCF Open Data (ODbL)',
    sourceUrl: 'https://ressources.data.sncf.com/explore/dataset/tarifs-tgv-inoui-ouigo/',
    od,
  };
  writeJson(join(OUT, 'fares.json'), fares);
  console.log(`${Object.keys(od).length} relations tarifées (grilles : ${fares.validFrom})`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
