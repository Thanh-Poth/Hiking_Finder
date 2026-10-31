import { describe, expect, it } from 'vitest';
import { DEM_NODATA, demGrid, demSample, fillUnknown } from '../src/lib/dem';
import { fillGaps } from '../scripts/lib/elevation';

describe("grille d'altitude", () => {
  const g = demGrid([6, 45, 6.01, 45.01], 250);
  const data = new Int16Array(g.width * g.height).map((_, i) => 1000 + (i % g.width) * 10);
  it('interpole entre les cellules', () => {
    expect(demSample(g, data, 6 + g.dLon / 2, 45.01)).toBeCloseTo(1005, 0);
    expect(demSample(g, data, 5.9, 45)).toBeNaN();
  });
  it('renvoie NaN près d’une cellule sans donnée', () => {
    const d = data.slice();
    d[0] = DEM_NODATA;
    expect(demSample(g, d, 6 + g.dLon / 3, 45.01 - g.dLat / 3)).toBeNaN();
  });
  it('comble les altitudes inconnues (navigateur et scripts)', () => {
    expect(fillUnknown([NaN, 100, NaN, 300, NaN])).toEqual([100, 100, 200, 300, 300]);
    expect(fillUnknown([NaN, NaN])).toEqual([0, 0]);
    expect(fillGaps([NaN, 100, NaN, NaN, 400, NaN])).toEqual([100, 100, 200, 300, 400, 400]);
  });
});
