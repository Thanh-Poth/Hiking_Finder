// Couche « Règles de bivouac » : espaces protégés (cœurs de parcs nationaux, réserves naturelles,
// réserves biologiques, arrêtés de biotope) et règle associée.
//
// Source des contours : OpenStreetMap (ODbL). Les téléchargements INPN (inpn.mnhn.fr) et le WFS
// carmencarto étaient indisponibles au 2026-10-31 (incident MNHN) ; le script les remplacera
// lorsqu'ils seront rétablis. Les règles viennent de data-src/bivouac-rules.json (textes officiels).

import { copyFileSync } from 'node:fs';
import { join } from 'node:path';
import { MASSIFS, type Massif } from '../src/data/massifs';
import { simplify } from '../src/lib/geo';
import type { ProtectedCollection, ProtectedFeature } from '../src/data/types';
import { ensureDir, OUT, ROOT, writeJson } from './lib/http';
import { obbox, overpass, type OsmElement } from './lib/overpass';

type Ring = [number, number][];

/** Assemble les chemins (outer ou inner) d'une relation en anneaux fermés. */
export function assembleRings(segments: Ring[]): Ring[] {
  const key = (p: [number, number]) => `${p[0].toFixed(7)},${p[1].toFixed(7)}`;
  const pool = segments.filter((s) => s.length >= 2).map((s) => [...s]);
  const rings: Ring[] = [];
  while (pool.length) {
    let ring = pool.shift()!;
    let guard = 0;
    while (key(ring[0]) !== key(ring[ring.length - 1]) && guard++ < 10000) {
      const end = key(ring[ring.length - 1]);
      const i = pool.findIndex((s) => key(s[0]) === end || key(s[s.length - 1]) === end);
      if (i < 0) break;
      const s = pool.splice(i, 1)[0];
      ring = ring.concat((key(s[0]) === end ? s : [...s].reverse()).slice(1));
    }
    if (ring.length >= 4 && key(ring[0]) === key(ring[ring.length - 1])) rings.push(ring);
  }
  return rings;
}

function classify(t: Record<string, string>): { category: string; ruleId: string } | null {
  const name = t.name ?? '';
  const title = (t.protection_title ?? '').toLowerCase();
  const pc = t.protect_class;
  if (pc === '5' || pc === '6' || /adhésion|adhesion/i.test(name) || /parc naturel régional/i.test(name)) return null;
  if (t.boundary === 'national_park' || pc === '2' || /cœur|coeur/i.test(title)) {
    const park = [
      [/écrins|ecrins/i, 'pn-ecrins-coeur'],
      [/vanoise/i, 'pn-vanoise-coeur'],
      [/mercantour/i, 'pn-mercantour-coeur'],
      [/pyrénées|pyrenees/i, 'pn-pyrenees-coeur'],
      [/cévennes|cevennes/i, 'pn-cevennes-coeur'],
    ] as const;
    const hit = park.find(([re]) => re.test(name));
    return { category: 'Cœur de parc national', ruleId: hit ? hit[1] : 'pn-coeur' };
  }
  if (/hauts[- ]plateaux du vercors/i.test(name)) return { category: 'Réserve naturelle nationale', ruleId: 'rnn-hauts-plateaux-vercors' };
  if (/réserve naturelle nationale/.test(title) || (/^réserve naturelle/i.test(name) && !/régionale/.test(title))) return { category: 'Réserve naturelle nationale', ruleId: 'rnn' };
  if (/régionale/.test(title)) return { category: 'Réserve naturelle régionale', ruleId: 'rnr' };
  if (/réserve biologique/.test(title) || /réserve biologique/i.test(name)) return { category: 'Réserve biologique', ruleId: 'rb' };
  if (/biotope/.test(title) || /biotope/i.test(name)) return { category: 'Arrêté de protection de biotope', ruleId: 'apb' };
  if (pc === '1' || pc === '4' || t.leisure === 'nature_reserve') return { category: 'Espace protégé', ruleId: 'rnn' };
  return null;
}

function toFeature(e: OsmElement): ProtectedFeature | null {
  const t = e.tags ?? {};
  const c = classify(t);
  if (!c) return null;
  let outer: Ring[] = [];
  let inner: Ring[] = [];
  if (e.type === 'way' && e.geometry) {
    outer = [e.geometry.map((g) => [g.lon, g.lat])];
  } else if (e.type === 'relation' && e.members) {
    const seg = (role: string) =>
      e.members!
        .filter((m) => m.type === 'way' && (m.role || 'outer') === role && m.geometry)
        .map((m) => m.geometry!.map((g) => [g.lon, g.lat] as [number, number]));
    outer = assembleRings(seg('outer'));
    inner = assembleRings(seg('inner'));
  }
  if (!outer.length) return null;
  const clean = (r: Ring) => simplify(r, 15).map(([x, y]) => [Math.round(x * 1e5) / 1e5, Math.round(y * 1e5) / 1e5] as [number, number]);
  // Chaque anneau intérieur est rattaché au premier anneau extérieur (approximation suffisante ici).
  const polys = outer.map((o, i) => [clean(o), ...(i === 0 ? inner.map(clean) : [])]);
  return {
    type: 'Feature',
    properties: { name: t.name ?? c.category, category: c.category, ruleId: c.ruleId, inpnId: t['ref:mnhn'] ?? t['ref:FR:MNHN'] },
    geometry: polys.length === 1 ? { type: 'Polygon', coordinates: polys[0] } : { type: 'MultiPolygon', coordinates: polys.map((p) => p) },
  };
}

export async function buildMassifProtected(m: Massif): Promise<void> {
  const b = obbox(m.bbox);
  const els = await overpass(`[out:json][timeout:240];
(
  rel["boundary"~"^(national_park|protected_area)$"](${b});
  rel["leisure"="nature_reserve"](${b});
  way["boundary"~"^(national_park|protected_area)$"](${b});
  way["leisure"="nature_reserve"](${b});
);
out geom;`);
  const features = els.map(toFeature).filter((f): f is ProtectedFeature => f !== null);
  const fc: ProtectedCollection = { type: 'FeatureCollection', features };
  writeJson(join(OUT, m.id, 'protected.json'), fc);
  const byRule = new Map<string, number>();
  for (const f of features) byRule.set(f.properties.ruleId, (byRule.get(f.properties.ruleId) ?? 0) + 1);
  console.log(`${m.id} : ${features.length} espaces protégés (${[...byRule].map(([k, v]) => `${k} ${v}`).join(', ')})`);
}

async function main() {
  ensureDir(OUT);
  copyFileSync(join(ROOT, 'data-src', 'bivouac-rules.json'), join(OUT, 'bivouac-rules.json'));
  const only = process.argv.slice(2);
  for (const m of MASSIFS) {
    if (only.length && !only.includes(m.id)) continue;
    await buildMassifProtected(m);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
