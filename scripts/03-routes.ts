// Catalogue d'itinéraires : les 5 meilleures randonnées itinérantes de chaque massif.
//
// Classement à partir de sources ouvertes uniquement (les avis des sites de randonnée ne sont
// pas des données ouvertes) :
// - notoriété (60 %) : niveau du réseau (GR international/national, GRP régional, PR local),
//   article Wikipédia (Wikidata) et nombre de consultations sur 12 mois (API Wikimedia) ;
// - accessibilité (40 %) : arrêts de transport en commun à moins de 1,5 km du tracé et nombre
//   moyen de départs par jour (GTFS transport.data.gouv.fr).
// Les tracés se recouvrant à plus de 50 % avec un itinéraire déjà retenu sont écartés.

import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { inMassif, MASSIFS, type Massif } from '../src/data/massifs';
import { cumulativeDistances, haversine, padBBox, resample, simplify, snapToLine } from '../src/lib/geo';
import { elevationGainLoss } from '../src/lib/geo';
import type { AccessStop, RouteData } from '../src/data/types';
import { elevations, smooth } from './lib/elevation';
import { inFrance, loadFrance } from './lib/france';
import { CACHE, fetchJson, OUT, readJson, writeJson } from './lib/http';
import { obbox, overpass, type OsmElement } from './lib/overpass';
import { stitch } from './lib/stitch';
import type { IndexedStop } from './02-gtfs';

const TOP = 5;
const MIN_LENGTH_M = 15000;
/** Part minimale du tracé située en France (les emprises des massifs débordent sur la Suisse et l'Italie). */
const MIN_FRANCE_SHARE = 0.6;
const ACCESS_RADIUS_M = 1500;
const NETWORK_WEIGHT: Record<string, number> = { iwn: 1, nwn: 0.9, rwn: 0.6, lwn: 0.3 };

/** Chemins de pèlerinage : surtout en plaine et sur route, peu adaptés à l'itinérance en bivouac. */
function isPilgrimage(tags: Record<string, string>): boolean {
  return tags.pilgrimage === 'yes' || /compostelle|saint-jacques|st-jacques|francigena|via cluny|podiensis|gebennensis|camino|chemin de st|szombathely|sancti martini/i.test(`${tags.name ?? ''} ${tags.ref ?? ''}`);
}
const PILGRIMAGE_FACTOR = 0.5;

interface Candidate {
  rel: OsmElement;
  name: string;
  pre: number;
  wikiTitle?: string;
  pageviews: number;
}

async function frWikiTitle(tags: Record<string, string>): Promise<string | undefined> {
  if (tags.wikipedia?.startsWith('fr:')) return tags.wikipedia.slice(3);
  if (!tags.wikidata) return undefined;
  try {
    const d = await fetchJson<{ entities: Record<string, { sitelinks?: Record<string, { title: string }> }> }>(
      `https://www.wikidata.org/w/api.php?action=wbgetentities&ids=${tags.wikidata}&props=sitelinks&format=json`,
      { maxAgeH: 24 * 30 },
    );
    return d.entities[tags.wikidata]?.sitelinks?.frwiki?.title;
  } catch {
    return undefined;
  }
}

async function yearlyPageviews(title: string): Promise<number> {
  const now = new Date();
  const end = `${now.getUTCFullYear()}${String(now.getUTCMonth() + 1).padStart(2, '0')}01`;
  const start = `${now.getUTCFullYear() - 1}${String(now.getUTCMonth() + 1).padStart(2, '0')}01`;
  try {
    const d = await fetchJson<{ items: { views: number }[] }>(
      `https://wikimedia.org/api/rest_v1/metrics/pageviews/per-article/fr.wikipedia/all-access/user/${encodeURIComponent(title.replace(/ /g, '_'))}/monthly/${start}/${end}`,
      { maxAgeH: 24 * 30 },
    );
    return d.items.reduce((s, i) => s + i.views, 0);
  } catch {
    return 0;
  }
}

function isVariant(tags: Record<string, string>): boolean {
  const s = `${tags.name ?? ''} ${tags.ref ?? ''} ${tags.state ?? ''}`.toLowerCase();
  // Variantes, liaisons et relations qui ne décrivent qu'une étape d'un itinéraire plus long.
  // \b ne reconnaît pas les lettres accentuées : on délimite les mots à la main.
  if (/(^|[\s(–-])(é|e)tapes?($|[\s\d:–-])|\bstage\b|tronçon|\bsection\b/.test(s)) return true;
  return /variante|liaison|raccourci|alternative|accès|acces|bretelle|proposed/.test(s) || /^gr ?\d+[a-z]$/i.test((tags.ref ?? '').trim()) && !tags.name;
}

async function geometry(relId: number): Promise<OsmElement[]> {
  return overpass(`[out:json][timeout:180];rel(${relId});(._;rel(r););(._;rel(r););way(r);out geom;`);
}

function accessStops(coords: number[][], stops: IndexedStop[], stopIndex: Map<string, number>): AccessStop[] {
  const cum = cumulativeDistances(coords);
  const lite = simplify(coords, 30);
  const liteCum = cumulativeDistances(lite);
  const out: AccessStop[] = [];
  for (const s of stops) {
    if (s.departuresPerDay < 0.2) continue;
    // Pré-filtre rapide sur le tracé simplifié, puis projection précise.
    if (snapToLine([s.lon, s.lat], lite, liteCum).distance > ACCESS_RADIUS_M + 100) continue;
    const snap = snapToLine([s.lon, s.lat], coords, cum);
    if (snap.distance > ACCESS_RADIUS_M) continue;
    const key = `${s.feed}|${s.key}`;
    if (!stopIndex.has(key)) stopIndex.set(key, stopIndex.size);
    out.push({ stopId: stopIndex.get(key)!, name: s.name, lon: s.lon, lat: s.lat, along: Math.round(snap.along), distance: Math.round(snap.distance), departuresPerDay: s.departuresPerDay });
  }
  // Un même lieu desservi par plusieurs réseaux : on garde l'arrêt le mieux desservi par tranche de 300 m.
  out.sort((a, b) => b.departuresPerDay - a.departuresPerDay);
  const kept: AccessStop[] = [];
  for (const s of out) if (!kept.some((k) => haversine([k.lon, k.lat], [s.lon, s.lat]) < 300)) kept.push(s);
  return kept.sort((a, b) => a.along - b.along);
}

/** Part du tracé `a` située à moins de 200 m du tracé `b`. */
function overlap(a: number[][], b: number[][]): number {
  const sa = resample(a, 500);
  const bl = simplify(b, 20);
  const bc = cumulativeDistances(bl);
  return sa.filter((p) => snapToLine(p, bl, bc).distance < 200).length / sa.length;
}

export async function buildMassifRoutes(m: Massif): Promise<void> {
  console.log(`\n== ${m.name}`);
  const bbox = padBBox(m.bbox, 2000);
  await loadFrance();
  const rels = await overpass(`[out:json][timeout:180];rel["route"="hiking"](${obbox(m.bbox)});out tags bb;`);
  const stopsFile = join(CACHE, `stops-${m.id}.json`);
  const stops: IndexedStop[] = existsSync(stopsFile) ? readJson(stopsFile) : [];

  // 1. Pré-sélection par réseau et emprise.
  const cands: Candidate[] = [];
  for (const r of rels) {
    const t = r.tags ?? {};
    const name = t['name:fr'] ?? t.name ?? t.ref;
    if (!name || isVariant(t) || !r.bounds) continue;
    // Une relation sans nom (simple code de balisage) n'est pas présentable, sauf un GR.
    if (!t.name && !t['name:fr'] && !/^gr/i.test(t.ref ?? '')) continue;
    // Emprise sans aucun point en France (coins, milieux des côtés, centre) : itinéraire étranger.
    const { minlon: w, minlat: so, maxlon: e, maxlat: n } = r.bounds;
    const probes = [[w, so], [w, n], [e, so], [e, n], [(w + e) / 2, (so + n) / 2], [(w + e) / 2, so], [(w + e) / 2, n], [w, (so + n) / 2], [e, (so + n) / 2]];
    if (!probes.some((p) => inFrance(p))) continue;
    const net = NETWORK_WEIGHT[t.network ?? ''] ?? 0;
    if (net < 0.3 || (net === 0.3 && !t.wikidata && !t.wikipedia)) continue;
    const diag = haversine([r.bounds.minlon, r.bounds.minlat], [r.bounds.maxlon, r.bounds.maxlat]);
    if (diag < 4000) continue;
    const pre = (net + (t.wikidata || t.wikipedia ? 0.3 : 0)) * (isPilgrimage(t) ? PILGRIMAGE_FACTOR : 1);
    cands.push({ rel: r, name: t.ref && !name.includes(t.ref) ? `${t.ref} – ${name}` : name, pre, pageviews: 0 });
  }
  cands.sort((a, b) => b.pre - a.pre);
  const short = cands.slice(0, 30);
  for (const c of short) {
    c.wikiTitle = await frWikiTitle(c.rel.tags ?? {});
    if (c.wikiTitle) c.pageviews = await yearlyPageviews(c.wikiTitle);
  }
  console.log(`  ${rels.length} relations, ${cands.length} candidates, ${short.length} évaluées`);

  // 2. Géométrie, accès, scores bruts.
  const stopIndex = new Map<string, number>();
  const evaluated: (RouteData & { raw: { notoriety: number; access: number } })[] = [];
  for (const c of short) {
    const els = await geometry(c.rel.id);
    const ways = els.filter((e) => e.type === 'way' && e.geometry).map((e) => e.geometry!.map((g) => [g.lon, g.lat] as [number, number]));
    const st = stitch(ways, (p) => inMassif(m, p, 2000), c.rel.tags?.roundtrip === 'yes');
    if (!st) continue;
    const line = simplify(st.coords, 5);
    const lengthM = cumulativeDistances(line).at(-1)!;
    if (lengthM < MIN_LENGTH_M) continue;
    const probe = resample(line, 1000);
    const franceShare = probe.filter((p) => inFrance(p)).length / probe.length;
    if (franceShare < MIN_FRANCE_SHARE) {
      console.log(`  × ${c.name} : ${Math.round(franceShare * 100)} % du tracé en France, écarté`);
      continue;
    }
    const access = accessStops(line, stops, stopIndex);
    const top3 = [...access].sort((a, b) => b.departuresPerDay - a.departuresPerDay).slice(0, 3);
    const accessRaw = Math.log1p(top3.reduce((s, a) => s + a.departuresPerDay, 0)) + 0.15 * Math.min(access.length, 10);
    const t = c.rel.tags ?? {};
    const notorietyRaw = ((NETWORK_WEIGHT[t.network ?? ''] ?? 0) + (c.wikiTitle ? 0.4 : 0) + Math.log10(1 + c.pageviews) / 5) * (isPilgrimage(t) ? PILGRIMAGE_FACTOR : 1);
    // Tracé complet de la relation dépassant l'emprise du massif ?
    const b = c.rel.bounds!;
    const clipped = b.minlon < bbox[0] || b.minlat < bbox[1] || b.maxlon > bbox[2] || b.maxlat > bbox[3];
    evaluated.push({
      id: `osm-${c.rel.id}`,
      name: c.name,
      ref: t.ref,
      network: t.network,
      osmRelation: c.rel.id,
      wikipedia: c.wikiTitle,
      loop: st.loop,
      lengthM: Math.round(lengthM),
      gain: 0,
      loss: 0,
      coords: line.map((p) => [p[0], p[1], 0] as [number, number, number]),
      score: { notoriety: 0, access: 0, total: 0, details: [] },
      access,
      clipped,
      raw: { notoriety: notorietyRaw, access: accessRaw },
    });
    console.log(`  · ${c.name} : ${(lengthM / 1000).toFixed(0)} km${st.loop ? ' (boucle)' : ''}, ${access.length} accès, ${c.pageviews} vues`);
  }

  // 3. Normalisation et sélection gloutonne sans doublon.
  const maxN = Math.max(...evaluated.map((e) => e.raw.notoriety), 1e-9);
  const maxA = Math.max(...evaluated.map((e) => e.raw.access), 1e-9);
  for (const e of evaluated) {
    const n = e.raw.notoriety / maxN;
    const a = e.raw.access / maxA;
    const net = { iwn: 'itinéraire international', nwn: 'GR (national)', rwn: 'GR de pays / régional', lwn: 'itinéraire local' }[e.network ?? ''] ?? 'réseau non précisé';
    const pv = short.find((c) => c.rel.id === e.osmRelation)!.pageviews;
    e.score = {
      notoriety: Math.round(n * 100) / 100,
      access: Math.round(a * 100) / 100,
      total: Math.round((0.6 * n + 0.4 * a) * 100) / 100,
      details: [
        `Réseau : ${net}`,
        e.wikipedia ? `Article Wikipédia « ${e.wikipedia} » : ${pv.toLocaleString('fr-FR')} consultations sur 12 mois` : 'Pas d’article Wikipédia en français',
        ...(isPilgrimage(short.find((c) => c.rel.id === e.osmRelation)!.rel.tags ?? {}) ? ['Chemin de pèlerinage : notoriété divisée par deux (itinéraire souvent en plaine et sur route)'] : []),
        `${e.access.length} arrêt(s) de transport à moins de ${(ACCESS_RADIUS_M / 1000).toLocaleString('fr-FR')} km du tracé`,
      ],
    };
  }
  evaluated.sort((a, b) => b.score.total - a.score.total);
  const chosen: typeof evaluated = [];
  for (const e of evaluated) {
    if (chosen.length >= TOP) break;
    if (chosen.some((c) => c.name === e.name)) continue;
    if (chosen.some((c) => overlap(e.coords, c.coords) > 0.5 || overlap(c.coords, e.coords) > 0.5)) continue;
    chosen.push(e);
  }

  // 4. Altitudes IGN (pas de 40 m) et dénivelés pour les itinéraires retenus.
  const routes: RouteData[] = [];
  for (const e of chosen) {
    const pts = resample(e.coords, 40);
    const eles = smooth(await elevations(pts), 3);
    const coords = pts.map((p, i) => [Math.round(p[0] * 1e5) / 1e5, Math.round(p[1] * 1e5) / 1e5, Math.round(eles[i])] as [number, number, number]);
    const { gain, loss } = elevationGainLoss(eles, 5);
    const cum = cumulativeDistances(coords);
    const access = e.access.map((a) => ({ ...a, along: Math.round(snapToLine([a.lon, a.lat], coords, cum).along) }));
    const { raw: _raw, ...rest } = e;
    void _raw;
    routes.push({ ...rest, coords, gain, loss, lengthM: Math.round(cum.at(-1)!), access });
    console.log(`  ✔ ${e.name} : ${(cum.at(-1)! / 1000).toFixed(0)} km, +${gain} m / -${loss} m, score ${e.score.total}`);
  }
  writeJson(join(OUT, m.id, 'routes.json'), routes);
  // Clés des arrêts d'accès (utilisées par 06-transit pour construire les horaires du massif).
  writeJson(join(CACHE, `access-${m.id}.json`), [...stopIndex.entries()].filter(([, i]) => routes.some((r) => r.access.some((a) => a.stopId === i))).map(([k, i]) => ({ key: k, id: i })));
}

async function main() {
  const only = process.argv.slice(2);
  for (const m of MASSIFS) {
    if (only.length && !only.includes(m.id)) continue;
    await buildMassifRoutes(m);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
