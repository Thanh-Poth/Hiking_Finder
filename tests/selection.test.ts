import { describe, expect, it } from 'vitest';
import { dailyFit, proposeItineraries } from '../src/lib/selection';
import { DEFAULT_PACE } from '../src/lib/timing';
import { northLine, route } from './helpers';

describe("sélection d'itinéraires", () => {
  it('adéquation journalière', () => {
    expect(dailyFit(15, 20)).toBe(1);
    expect(dailyFit(25, 20)).toBe(0);
    expect(dailyFit(5, 20)).toBeCloseTo(5 / 20 / 0.55);
  });
  it('propose le tracé complet quand il convient, avec une explication', () => {
    const r = route(northLine(451, (i) => 1000 + (i % 40 < 20 ? i % 20 : 20 - (i % 20)) * 10)); // 45 km
    const p = proposeItineraries([r], { days: 3, maxKmPerDay: 20, maxGainPerDay: 1500, pace: DEFAULT_PACE, mode: 'traverse' });
    expect(p[0].kind).toBe('full');
    expect(p[0].explanation).toMatch(/^3 jours, 15 km et \+\d+ m par jour en moyenne/);
  });
  it('découpe un tracé trop long entre deux accès en transport', () => {
    const coords = northLine(1501); // 150 km
    const access = [
      { stopId: 0, name: 'Village A', lon: 6, lat: coords[300][1], along: 30000, distance: 100, departuresPerDay: 8 },
      { stopId: 1, name: 'Village B', lon: 6, lat: coords[640][1], along: 64000, distance: 200, departuresPerDay: 4 },
    ];
    const p = proposeItineraries([route(coords, { access })], { days: 2, maxKmPerDay: 20, maxGainPerDay: 1000, pace: DEFAULT_PACE, mode: 'traverse' });
    expect(p[0].kind).toBe('section');
    expect(p[0].start.label).toBe('Village A');
    expect(p[0].end.label).toBe('Village B');
  });
  it('mode aller-retour : revient au point de départ', () => {
    const coords = northLine(801);
    const access = [{ stopId: 0, name: 'Gare', lon: 6, lat: coords[0][1], along: 0, distance: 50, departuresPerDay: 10 }];
    const p = proposeItineraries([route(coords, { access })], { days: 2, maxKmPerDay: 20, maxGainPerDay: 1000, pace: DEFAULT_PACE, mode: 'roundtrip' });
    expect(p[0].kind).toBe('out-and-back');
    const first = p[0].coords[0];
    const last = p[0].coords[p[0].coords.length - 1];
    expect(first[1]).toBeCloseTo(last[1], 8);
  });
});
