// Altitudes IGN Géoplateforme (service de calcul altimétrique, RGE ALTI), au build uniquement.
// Limite publiée : 5 requêtes/s par IP. On reste à 3/s et 4 000 points par requête.

import { fetchCached, rateLimiter } from './http';

const URL = 'https://data.geopf.fr/altimetrie/1.0/calcul/alti/rest/elevation.json';
const wait = rateLimiter(3);
const CHUNK = 4000;

export async function elevations(points: readonly (readonly number[])[]): Promise<number[]> {
  return fillGaps(await rawElevations(points));
}

/** Altitudes brutes : NaN hors de la couverture IGN (c'est-à-dire hors de France). */
export async function rawElevations(points: readonly (readonly number[])[]): Promise<number[]> {
  const out: number[] = [];
  for (let i = 0; i < points.length; i += CHUNK) {
    const chunk = points.slice(i, i + CHUNK);
    await wait();
    const body = JSON.stringify({
      lon: chunk.map((p) => p[0].toFixed(5)).join('|'),
      lat: chunk.map((p) => p[1].toFixed(5)).join('|'),
      resource: 'ign_rge_alti_wld',
      zonly: 'true',
    });
    const buf = await fetchCached(URL, { method: 'POST', body, headers: { 'Content-Type': 'application/json' }, maxAgeH: 24 * 90 });
    const res = JSON.parse(buf.toString('utf8')) as { elevations: number[] };
    // -99999 = hors couverture (mer, étranger) : on garde NaN pour l'interpolation.
    out.push(...res.elevations.map((e) => (e > -1000 ? Math.round(e * 10) / 10 : NaN)));
  }
  return out;
}

/** Remplace les NaN par interpolation linéaire (ou la valeur voisine aux extrémités). */
export function fillGaps(v: number[]): number[] {
  const out = v.slice();
  const n = v.length;
  // Indice du prochain point connu, calculé en un seul passage arrière (temps linéaire).
  const next = new Int32Array(n).fill(-1);
  for (let i = n - 1, k = -1; i >= 0; i--) {
    next[i] = k;
    if (Number.isFinite(v[i])) k = i;
  }
  let prev = -1;
  for (let i = 0; i < n; i++) {
    if (Number.isFinite(v[i])) {
      prev = i;
      continue;
    }
    const nx = next[i];
    if (prev < 0 && nx < 0) out[i] = 0;
    else if (prev < 0) out[i] = v[nx];
    else if (nx < 0) out[i] = v[prev];
    else out[i] = v[prev] + ((v[nx] - v[prev]) * (i - prev)) / (nx - prev);
  }
  return out;
}

/** Moyenne glissante sur `w` points (lissage du bruit du MNT avant calcul du dénivelé). */
export function smooth(v: readonly number[], w = 3): number[] {
  const h = Math.floor(w / 2);
  return v.map((_, i) => {
    let s = 0;
    let n = 0;
    for (let k = Math.max(0, i - h); k <= Math.min(v.length - 1, i + h); k++) {
      s += v[k];
      n++;
    }
    return Math.round((s / n) * 10) / 10;
  });
}
