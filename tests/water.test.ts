import { describe, expect, it } from 'vitest';
import { analyzeStageWater, DEFAULT_WATER, poisAlongRoute } from '../src/lib/water';
import { DEFAULT_PACE } from '../src/lib/timing';
import { northLine, water } from './helpers';

describe("points d'eau le long du tracé", () => {
  const line = northLine(201); // 20 km
  const east = (m: number) => 6.0 + m / (111195 * Math.cos((45 * Math.PI) / 180));
  it('recherche dans le tampon', () => {
    const pois = [water('a', east(100), line[50][1]), water('b', east(400), line[60][1]), water('c', 6.5, 46)];
    const r = poisAlongRoute(line, pois, 200);
    expect(r.map((x) => x.poi.id)).toEqual(['a']);
    expect(r[0].along).toBeCloseTo(5000, -1);
    expect(r[0].offset).toBeCloseTo(100, 0);
  });
  it('plus long tronçon sans eau, litres et alerte', () => {
    const pois = [water('a', 6.0, line[30][1]), water('b', 6.0, line[150][1]), water('x', 6.0, line[100][1], 'no')];
    const on = poisAlongRoute(line, pois, 200);
    const w = analyzeStageWater(line, on, 0, 20000, true, false, false, DEFAULT_PACE, DEFAULT_WATER);
    // 3 km → 15 km : la source non potable ne compte pas.
    expect(w.longestDryM).toBeCloseTo(12000, -1);
    expect(w.longestDryH).toBeCloseTo(3, 1);
    expect(w.alert).toBe(true);
    // 3 h × 0,5 L + 0,5 L de réserve + 2,5 L au bivouac sans eau = 4,5 L
    expect(w.litersToCarry).toBe(4.5);
    expect(w.points).toHaveLength(3);
  });
});
