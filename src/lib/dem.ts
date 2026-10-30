// Grille d'altitude (voir scripts/08-dem.ts) : géométrie partagée et interpolation bilinéaire.

import type { BBox } from '../data/massifs';

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
  const top = v(x0, y0) * (1 - tx) + v(x1, y0) * tx;
  const bottom = v(x0, y1) * (1 - tx) + v(x1, y1) * tx;
  return top * (1 - ty) + bottom * ty;
}
