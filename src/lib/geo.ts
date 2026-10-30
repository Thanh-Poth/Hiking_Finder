// Fonctions géométriques de base, sans dépendance. Coordonnées [lon, lat] ou [lon, lat, ele].

export type LonLat = [number, number];
export type LonLatEle = [number, number, number];

const R = 6371008.8; // rayon terrestre moyen (m)
const toRad = (d: number) => (d * Math.PI) / 180;

/** Distance orthodromique (haversine) en mètres. */
export function haversine(a: readonly number[], b: readonly number[]): number {
  const dLat = toRad(b[1] - a[1]);
  const dLon = toRad(b[0] - a[0]);
  const s =
    Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a[1])) * Math.cos(toRad(b[1])) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
}

/** Distances cumulées (m) le long d'une polyligne. */
export function cumulativeDistances(coords: readonly (readonly number[])[]): number[] {
  const out = new Array<number>(coords.length);
  let acc = 0;
  for (let i = 0; i < coords.length; i++) {
    if (i > 0) acc += haversine(coords[i - 1], coords[i]);
    out[i] = acc;
  }
  return out;
}

export function lineLength(coords: readonly (readonly number[])[]): number {
  let acc = 0;
  for (let i = 1; i < coords.length; i++) acc += haversine(coords[i - 1], coords[i]);
  return acc;
}

/**
 * Dénivelés positif et négatif (m) avec seuil d'hystérésis : une variation n'est comptée
 * qu'au-delà de `threshold` mètres, ce qui filtre le bruit du MNT (RGE ALTI, pas de 25–50 m).
 */
export function elevationGainLoss(eles: readonly number[], threshold = 5): { gain: number; loss: number } {
  let gain = 0;
  let loss = 0;
  let ref: number | undefined;
  for (const e of eles) {
    if (!Number.isFinite(e)) continue;
    if (ref === undefined) {
      ref = e;
      continue;
    }
    const d = e - ref;
    if (d >= threshold) {
      gain += d;
      ref = e;
    } else if (d <= -threshold) {
      loss -= d;
      ref = e;
    }
  }
  return { gain: Math.round(gain), loss: Math.round(loss) };
}

/** Projection locale équirectangulaire (m) autour d'une latitude de référence. */
function project(p: readonly number[], lat0: number): [number, number] {
  return [toRad(p[0]) * R * Math.cos(toRad(lat0)), toRad(p[1]) * R];
}

export interface Snap {
  /** Distance du point à la polyligne (m). */
  distance: number;
  /** Indice du segment [i, i+1]. */
  index: number;
  /** Fraction le long du segment (0–1). */
  t: number;
  /** Abscisse curviligne du projeté (m depuis le départ). */
  along: number;
}

/** Projection d'un point sur une polyligne (distances cumulées précalculées). */
export function snapToLine(
  p: readonly number[],
  coords: readonly (readonly number[])[],
  cum: readonly number[] = cumulativeDistances(coords),
): Snap {
  let best: Snap = { distance: Infinity, index: 0, t: 0, along: 0 };
  if (coords.length === 1) return { distance: haversine(p, coords[0]), index: 0, t: 0, along: 0 };
  const lat0 = p[1];
  const P = project(p, lat0);
  for (let i = 0; i < coords.length - 1; i++) {
    const A = project(coords[i], lat0);
    const B = project(coords[i + 1], lat0);
    const dx = B[0] - A[0];
    const dy = B[1] - A[1];
    const len2 = dx * dx + dy * dy;
    let t = len2 > 0 ? ((P[0] - A[0]) * dx + (P[1] - A[1]) * dy) / len2 : 0;
    t = Math.max(0, Math.min(1, t));
    const qx = A[0] + t * dx - P[0];
    const qy = A[1] + t * dy - P[1];
    const d = Math.sqrt(qx * qx + qy * qy);
    if (d < best.distance) {
      best = { distance: d, index: i, t, along: cum[i] + t * (cum[i + 1] - cum[i]) };
    }
  }
  return best;
}

/** Point situé à l'abscisse `along` (m) sur la polyligne. Interpole l'altitude si présente. */
export function pointAt(coords: readonly (readonly number[])[], cum: readonly number[], along: number): number[] {
  if (along <= 0) return [...coords[0]];
  const last = coords.length - 1;
  if (along >= cum[last]) return [...coords[last]];
  let lo = 0;
  let hi = last;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (cum[mid] <= along) lo = mid;
    else hi = mid;
  }
  const seg = cum[hi] - cum[lo];
  const t = seg > 0 ? (along - cum[lo]) / seg : 0;
  const a = coords[lo];
  const b = coords[hi];
  return a.map((v, k) => v + t * ((b[k] ?? v) - v));
}

/** Indice du premier sommet dont l'abscisse est >= along. */
export function indexAt(cum: readonly number[], along: number): number {
  let lo = 0;
  let hi = cum.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (cum[mid] < along) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/** Sous-polyligne entre deux abscisses (m). */
export function sliceLine(
  coords: readonly (readonly number[])[],
  cum: readonly number[],
  from: number,
  to: number,
): number[][] {
  const out: number[][] = [pointAt(coords, cum, from)];
  for (let i = indexAt(cum, from); i < coords.length && cum[i] < to; i++) {
    if (cum[i] > from) out.push([...coords[i]]);
  }
  out.push(pointAt(coords, cum, to));
  return out;
}

export function bboxOf(coords: readonly (readonly number[])[]): [number, number, number, number] {
  let w = Infinity;
  let s = Infinity;
  let e = -Infinity;
  let n = -Infinity;
  for (const c of coords) {
    if (c[0] < w) w = c[0];
    if (c[0] > e) e = c[0];
    if (c[1] < s) s = c[1];
    if (c[1] > n) n = c[1];
  }
  return [w, s, e, n];
}

/** Élargit une bbox d'environ `meters` mètres. */
export function padBBox(b: readonly number[], meters: number): [number, number, number, number] {
  const dLat = meters / 111320;
  const dLon = meters / (111320 * Math.cos(toRad((b[1] + b[3]) / 2)));
  return [b[0] - dLon, b[1] - dLat, b[2] + dLon, b[3] + dLat];
}

export function inBBox(p: readonly number[], b: readonly number[]): boolean {
  return p[0] >= b[0] && p[0] <= b[2] && p[1] >= b[1] && p[1] <= b[3];
}

/** Point dans polygone (règle pair-impair). `rings[0]` = extérieur, suivants = trous. */
export function pointInPolygon(p: readonly number[], rings: readonly (readonly (readonly number[])[])[]): boolean {
  let inside = false;
  for (const ring of rings) {
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const xi = ring[i][0];
      const yi = ring[i][1];
      const xj = ring[j][0];
      const yj = ring[j][1];
      if (yi > p[1] !== yj > p[1] && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) inside = !inside;
    }
  }
  return inside;
}

/** Simplification de Douglas-Peucker (tolérance en mètres). Conserve les autres dimensions. */
export function simplify<T extends readonly number[]>(coords: readonly T[], tolerance: number): T[] {
  if (coords.length <= 2) return [...coords];
  const keep = new Uint8Array(coords.length);
  keep[0] = 1;
  keep[coords.length - 1] = 1;
  const lat0 = coords[0][1];
  const pts = coords.map((c) => project(c, lat0));
  const stack: [number, number][] = [[0, coords.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop()!;
    let maxD = 0;
    let idx = -1;
    const [ax, ay] = pts[a];
    const [bx, by] = pts[b];
    const dx = bx - ax;
    const dy = by - ay;
    const len2 = dx * dx + dy * dy;
    for (let i = a + 1; i < b; i++) {
      const [px, py] = pts[i];
      let t = len2 > 0 ? ((px - ax) * dx + (py - ay) * dy) / len2 : 0;
      t = Math.max(0, Math.min(1, t));
      const d = Math.hypot(ax + t * dx - px, ay + t * dy - py);
      if (d > maxD) {
        maxD = d;
        idx = i;
      }
    }
    if (idx >= 0 && maxD > tolerance) {
      keep[idx] = 1;
      stack.push([a, idx], [idx, b]);
    }
  }
  return coords.filter((_, i) => keep[i]);
}

/** Rééchantillonne une polyligne à pas régulier (m). Les sommets d'origine ne sont pas conservés. */
export function resample(coords: readonly (readonly number[])[], step: number): number[][] {
  const cum = cumulativeDistances(coords);
  const total = cum[cum.length - 1];
  const out: number[][] = [];
  for (let d = 0; d < total - 1e-3; d += step) out.push(pointAt(coords, cum, d));
  out.push([...coords[coords.length - 1]]);
  return out;
}
