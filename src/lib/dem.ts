// Grille d'altitude (voir scripts/08-dem.ts) : géométrie partagée et interpolation bilinéaire.

import type { BBox } from '../data/massifs';

/** Valeur des cellules sans altitude connue (hors de France). */
export const DEM_NODATA = -32768;

export interface DemGrid {
  bbox: BBox;
  width: number;
  height: number;
  dLon: number;
  dLat: number;
}

export function demGrid(bbox: BBox, stepM: number): DemGrid {
  const midLat = ((bbox[1] + bbox[3]) / 2) * (Math.PI / 180);
  const dLat = stepM / 111320;
  const dLon = stepM / (111320 * Math.cos(midLat));
  return {
    bbox,
    width: Math.floor((bbox[2] - bbox[0]) / dLon) + 1,
    height: Math.floor((bbox[3] - bbox[1]) / dLat) + 1,
    dLon,
    dLat,
  };
}

/** Altitude interpolée (m), ou NaN hors de la grille. */
export function demSample(g: DemGrid, data: Int16Array, lon: number, lat: number): number {
  const fx = (lon - g.bbox[0]) / g.dLon;
  const fy = (g.bbox[3] - lat) / g.dLat;
  if (fx < 0 || fy < 0 || fx > g.width - 1 || fy > g.height - 1) return NaN;
  const x0 = Math.floor(fx);
  const y0 = Math.floor(fy);
  const x1 = Math.min(x0 + 1, g.width - 1);
  const y1 = Math.min(y0 + 1, g.height - 1);
  const tx = fx - x0;
  const ty = fy - y0;
  const v = (x: number, y: number) => data[y * g.width + x];
  if ([v(x0, y0), v(x1, y0), v(x0, y1), v(x1, y1)].includes(DEM_NODATA)) return NaN;
  const top = v(x0, y0) * (1 - tx) + v(x1, y0) * tx;
  const bottom = v(x0, y1) * (1 - tx) + v(x1, y1) * tx;
  return top * (1 - ty) + bottom * ty;
}

/** Remplace les altitudes inconnues (NaN) par interpolation entre voisins connus ; 0 si aucune. */
export function fillUnknown(v: readonly number[]): number[] {
  const out = v.slice();
  let prev = -1;
  for (let i = 0; i < v.length; i++) {
    if (Number.isFinite(v[i])) {
      for (let k = prev + 1; k < i; k++) out[k] = prev < 0 ? v[i] : v[prev] + ((v[i] - v[prev]) * (k - prev)) / (i - prev);
      prev = i;
    }
  }
  for (let k = prev + 1; k < v.length; k++) out[k] = prev < 0 ? 0 : v[prev];
  return out;
}
