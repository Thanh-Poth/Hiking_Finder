import { describe, expect, it } from 'vitest';
import { bitAt } from '../src/lib/calendar';
import { projectLastWeek } from '../scripts/lib/gtfs';

describe('jeu GTFS expiré', () => {
  // Une seule semaine publiée en mars 2026 (comme les Chemins de fer de la Corse) : un service par jour.
  const cals = new Map<string, { weekdays: number[]; start: string; end: string }>();
  const days = ['20260309', '20260303', '20260304', '20260305', '20260306', '20260307', '20260308'];
  days.forEach((d, i) => cals.set(String(i + 1), { weekdays: [0, 1, 2, 3, 4, 5, 6].map((k) => (k === i ? 1 : 0)), start: d, end: d }));

  it('répète la dernière semaine publiée sur l’horizon', () => {
    // Le 2026-11-02 est un lundi.
    const { until, services } = projectLastWeek('20261102', 14, new Set(cals.keys()), cals, new Map());
    expect(until).toBe('20260309');
    const monday = services.get('1')!;
    expect(bitAt(monday, 0)).toBe(true);
    expect(bitAt(monday, 7)).toBe(true);
    expect(bitAt(monday, 1)).toBe(false);
    const sunday = services.get('7')!;
    expect(bitAt(sunday, 6)).toBe(true);
    expect(bitAt(sunday, 0)).toBe(false);
  });

  it('ignore les services absents de la dernière semaine', () => {
    const old = new Map(cals);
    old.set('vieux', { weekdays: [1, 1, 1, 1, 1, 1, 1], start: '20250101', end: '20250201' });
    const { services } = projectLastWeek('20261102', 7, new Set(old.keys()), old, new Map());
    expect(services.has('vieux')).toBe(false);
  });
});
