import { describe, expect, it } from 'vitest';
import { encodeBits, gtfsServiceBits } from '../src/lib/calendar';
import { fmtTime, TransitIndex } from '../src/lib/transit';
import type { TransitData } from '../src/data/types';

const everyDay = encodeBits(gtfsServiceBits('20261101', 7, { weekdays: [1, 1, 1, 1, 1, 1, 1], start: '20261101', end: '20261130' }, undefined));
const weekdays = encodeBits(gtfsServiceBits('20261101', 7, { weekdays: [1, 1, 1, 1, 1, 0, 0], start: '20261101', end: '20261130' }, undefined));

// 0 Paris, 1 Grenoble gare, 2 Grenoble gare routière (3 min à pied), 3 Village, 4 Col
const data: TransitData = {
  start: '20261101',
  days: 7,
  stops: [['Paris', 0, 0, ''], ['Grenoble', 0, 0, ''], ['Grenoble GR', 0, 0, ''], ['Village', 0, 0, ''], ['Col', 0, 0, '']],
  agencies: [['A', '', 'f']],
  routes: [[0, 'T', 2, -1], [0, 'B', 3, -1]],
  services: [everyDay, weekdays],
  trips: [
    [0, 0, [0, 1], [420, 600]], // Paris 07:00 → Grenoble 10:00
    [1, 1, [2, 3, 4], [612, 660, 700]], // car de semaine 10:12 → Village 11:00 → Col 11:40
    [1, 0, [2, 3], [900, 950]], // car quotidien 15:00 → Village 15:50
    [1, 0, [3, 2], [1000, 1050]], // Village 16:40 → Grenoble GR 17:30
    [0, 0, [1, 0], [1080, 1260]], // Grenoble 18:00 → Paris 21:00
    [0, 0, [1, 0], [1200, 1390]], // Grenoble 20:00 → Paris 23:10
  ],
  footpaths: [[1, 2, 3]],
  origins: [0],
};
const idx = new TransitIndex(data);

describe("recherche d'itinéraires (Connection Scan)", () => {
  it('correspondance avec marche, en semaine', () => {
    const j = idx.earliestArrival(1, [0], 360, [{ stop: 3, extra: 10 }]); // lundi 2/11
    expect(j).not.toBeNull();
    expect(j!.arrive).toBe(660);
    expect(j!.arriveAtTarget).toBe(670);
    expect(j!.legs.map((l) => l.type)).toEqual(['ride', 'walk', 'ride']);
  });
  it('respecte les jours de circulation (dimanche : car de 15:00)', () => {
    const j = idx.earliestArrival(0, [0], 360, [{ stop: 3, extra: 0 }]); // dimanche 1/11
    expect(j!.arrive).toBe(950);
  });
  it("hors de l'horizon : jour inconnu", () => {
    expect(idx.dayIndex(new Date(2026, 11, 25))).toBe(-1);
  });
  it('dernier retour du jour', () => {
    const opts = idx.returnOptions(1, [{ stop: 3, extra: 0 }], [0]);
    expect(opts).toHaveLength(1);
    // Village 16:40 → Grenoble 17:30, 3 min à pied + 6 min de correspondance → train de 18:00.
    expect(opts[0].depart).toBe(1000);
    expect(opts[0].arrive).toBe(1260);
  });
  it('formatage des heures', () => {
    expect(fmtTime(605)).toBe('10:05');
    expect(fmtTime(1450)).toBe('00:10 (+1 j)');
  });
});
