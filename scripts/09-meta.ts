// Métadonnées affichées dans l'application : sources, licences, attributions et dates de mise à jour.

import { existsSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { MASSIFS } from '../src/data/massifs';
import type { DatasetMeta, FaresData, MassifMeta, Poi, RouteData } from '../src/data/types';
import { demGrid } from '../src/lib/dem';
import { FEEDS } from './lib/feeds';
import { CACHE, fetchJson, OUT, readJson, today, writeJson } from './lib/http';
import { DEM_STEP_M } from './08-dem';

const ODBL = 'https://opendatacommons.org/licenses/odbl/1-0/';
const LO = 'https://www.etalab.gouv.fr/licence-ouverte-open-licence/';

const fileDate = (f: string) => (existsSync(f) ? statSync(f).mtime.toISOString().slice(0, 10) : today());

async function main() {
  const built = today();
  const datasets: DatasetMeta[] = [
    {
      id: 'osm',
      name: 'OpenStreetMap (itinéraires de randonnée, points d’eau, refuges, abris, espaces protégés)',
      licence: 'ODbL 1.0',
      licenceUrl: ODBL,
      attribution: '© les contributeurs d’OpenStreetMap',
      url: 'https://www.openstreetmap.org/copyright',
      updated: built,
      fetched: built,
    },
    {
      id: 'refuges-info',
      name: 'Refuges.info (refuges, cabanes, points d’eau)',
      licence: 'CC BY-SA 2.0',
      licenceUrl: 'https://creativecommons.org/licenses/by-sa/2.0/fr/',
      attribution: '© les contributeurs de Refuges.info',
      url: 'https://www.refuges.info/wiki/licence',
      updated: built,
      fetched: built,
    },
    {
      id: 'ign-alti',
      name: 'IGN Géoplateforme – calcul altimétrique (RGE ALTI)',
      licence: 'Licence Ouverte 2.0',
      licenceUrl: LO,
      attribution: '© IGN',
      url: 'https://geoservices.ign.fr/documentation/services/services-geoplateforme/altimetrie',
      updated: built,
      fetched: built,
    },
    {
      id: 'ign-plan',
      name: 'IGN Géoplateforme – fond Plan IGN v2 et estompage (tuiles)',
      licence: 'Licence Ouverte 2.0',
      licenceUrl: LO,
      attribution: '© IGN – Plan IGN',
      url: 'https://geoservices.ign.fr/services-geoplateforme-diffusion',
      updated: built,
      fetched: built,
    },
    {
      id: 'wikimedia',
      name: 'Wikidata et statistiques de consultation Wikipédia (classement des itinéraires)',
      licence: 'CC0 (Wikidata) / données publiques Wikimedia',
      licenceUrl: 'https://creativecommons.org/publicdomain/zero/1.0/',
      attribution: 'Wikidata, Wikimedia REST API',
      url: 'https://wikimedia.org/api/rest_v1/',
      updated: built,
      fetched: built,
    },
  ];
  // Gares SNCF.
  try {
    const g = await fetchJson<{ metas: { default: { modified: string } } }>('https://ressources.data.sncf.com/api/explore/v2.1/catalog/datasets/gares-de-voyageurs', { maxAgeH: 24 });
    datasets.push({ id: 'sncf-gares', name: 'SNCF – Gares de voyageurs', licence: 'ODbL 1.0', licenceUrl: ODBL, attribution: 'SNCF Open Data', url: 'https://ressources.data.sncf.com/explore/dataset/gares-de-voyageurs/', updated: g.metas.default.modified.slice(0, 10), fetched: fileDate(join(CACHE, 'gares-de-voyageurs.json')) });
  } catch {
    /* source facultative pour les métadonnées */
  }
  // Tarifs SNCF.
  if (existsSync(join(OUT, 'fares.json'))) {
    const f: FaresData = readJson(join(OUT, 'fares.json'));
    datasets.push({ id: 'sncf-tarifs', name: `SNCF – Tarifs TGV INOUI, OUIGO et Intercités (grilles : ${f.validFrom})`, licence: 'ODbL 1.0', licenceUrl: ODBL, attribution: 'SNCF Open Data', url: f.sourceUrl, updated: f.updated, fetched: fileDate(join(OUT, 'fares.json')) });
  }
  // Horaires GTFS.
  let tdg: { id: string; updated?: string }[] = [];
  try {
    tdg = await fetchJson('https://transport.data.gouv.fr/api/datasets', { maxAgeH: 24, cacheName: 'tdg-datasets.json' });
  } catch {
    /* dates de mise à jour indisponibles : on garde la date de téléchargement */
  }
  for (const feed of FEEDS) {
    const d = tdg.find((x) => x.id === feed.dataset);
    datasets.push({
      id: `gtfs-${feed.id}`,
      name: `Horaires – ${feed.name}`,
      licence: feed.licence,
      licenceUrl: feed.licence === 'ODbL' ? ODBL : LO,
      attribution: 'transport.data.gouv.fr',
      url: `https://transport.data.gouv.fr/datasets/${feed.dataset}`,
      updated: d?.updated?.slice(0, 10) ?? fileDate(join(CACHE, `gtfs-${feed.id}.zip`)),
      fetched: fileDate(join(CACHE, `gtfs-${feed.id}.json`)),
    });
  }
  datasets.push({
    id: 'regles-bivouac',
    name: 'Règles de bivouac (textes officiels des parcs et réserves, saisis à la main)',
    licence: 'Textes réglementaires publics',
    licenceUrl: 'https://www.legifrance.gouv.fr/',
    attribution: 'Établissements publics des parcs nationaux, réserves naturelles',
    url: 'https://www.parcsnationaux.fr/',
    updated: '2026-10-31',
    fetched: '2026-10-31',
  });
  writeJson(join(OUT, 'sources.json'), datasets);

  for (const m of MASSIFS) {
    const dir = join(OUT, m.id);
    if (!existsSync(join(dir, 'routes.json'))) continue;
    const routes: RouteData[] = readJson(join(dir, 'routes.json'));
    const pois: Poi[] = existsSync(join(dir, 'pois.json')) ? readJson(join(dir, 'pois.json')) : [];
    const meta: MassifMeta = {
      massif: m.id,
      built,
      routes: routes.length,
      pois: pois.length,
      datasets: ['osm', 'refuges-info', 'ign-alti', 'ign-plan', 'wikimedia', 'sncf-gares', 'sncf-tarifs', 'regles-bivouac', ...FEEDS.filter((f) => f.national || m.feeds.includes(f.id)).map((f) => `gtfs-${f.id}`)],
    };
    if (existsSync(join(dir, 'dem.bin'))) {
      const g = demGrid(m.bbox, DEM_STEP_M);
      meta.dem = { bbox: m.bbox, width: g.width, height: g.height, step: DEM_STEP_M };
    }
    writeJson(join(dir, 'meta.json'), meta);
  }
  console.log(`sources.json : ${datasets.length} jeux de données`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
