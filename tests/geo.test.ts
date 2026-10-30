import { describe, expect, it } from 'vitest';
import { cumulativeDistances, elevationGainLoss, haversine, lineLength, pointAt, pointInPolygon, resample, simplify, sliceLine, snapToLine } from '../src/lib/geo';
import { northLine } from './helpers';

describe('distances', () => {
  it('haversine : 1° de latitude ≈ 111,2 km', () => {
    expect(haversine([6, 45], [6, 46])).toBeCloseTo(111195, -1);
  });
  it('haversine : Paris → Grenoble ≈ 480 km', () => {
    expect(haversine([2.3522, 48.8566], [5.7245, 45.1885]) / 1000).toBeGreaterThan(475);
    expect(haversine([2.3522, 48.8566], [5.7245, 45.1885]) / 1000).toBeLessThan(485);
  });
  it('longueur et cumul cohérents', () => {
    const l = northLine(11);
    const cum = cumulativeDistances(l);
    expect(cum[0]).toBe(0);
    expect(cum[10]).toBeCloseTo(1000, 0);
    expect(lineLength(l)).toBeCloseTo(cum[10], 6);
  });
});

describe('dénivelé', () => {
  it('compte montées et descentes au-delà du seuil', () => {
    expect(elevationGainLoss([1000, 1100, 1050, 1200, 1000])).toEqual({ gain: 250, loss: 250 });
  });
  it('filtre le bruit inférieur au seuil', () => {
    expect(elevationGainLoss([1000, 1002, 999, 1003, 1001], 5)).toEqual({ gain: 0, loss: 0 });
  });
  it('ignore les valeurs manquantes', () => {
    expect(elevationGainLoss([1000, NaN, 1100])).toEqual({ gain: 100, loss: 0 });
  });
});

describe('projection et découpe', () => {
  const l = northLine(11);
  const cum = cumulativeDistances(l);
  it('projette un point latéral sur la ligne', () => {
    const p = [6.0 + 50 / (111195 * Math.cos((45 * Math.PI) / 180)), l[5][1]];
    const s = snapToLine(p, l, cum);
    expect(s.distance).toBeCloseTo(50, 0);
    expect(s.along).toBeCloseTo(500, 0);
  });
  it('pointAt interpole', () => {
    const p = pointAt(l, cum, 250);
    expect(p[1]).toBeCloseTo((l[2][1] + l[3][1]) / 2, 8);
  });
  it('sliceLine renvoie le bon tronçon', () => {
    const s = sliceLine(l, cum, 250, 750);
    expect(lineLength(s)).toBeCloseTo(500, 0);
  });
  it('resample et simplify', () => {
    expect(resample(l, 250).length).toBe(5);
    expect(simplify(l, 1).length).toBe(2);
  });
  it('point dans polygone avec trou', () => {
    const outer = [[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]];
    const hole = [[4, 4], [6, 4], [6, 6], [4, 6], [4, 4]];
    expect(pointInPolygon([2, 2], [outer, hole])).toBe(true);
    expect(pointInPolygon([5, 5], [outer, hole])).toBe(false);
    expect(pointInPolygon([12, 5], [outer])).toBe(false);
  });
});
