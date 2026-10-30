import { describe, expect, it } from 'vitest';
import { carCost, DEFAULT_COST, journeyCost, stayCost, summarize } from '../src/lib/cost';
import type { FaresData, TransitData } from '../src/data/types';
import type { Journey } from '../src/lib/transit';

const transit: TransitData = {
  start: '20261101',
  days: 7,
  stops: [
    ['Paris Gare de Lyon', 2.37, 48.84, '87686006'],
    ['Grenoble', 5.71, 45.19, '87747006'],
    ['La Bérarde', 6.29, 44.93, ''],
  ],
  agencies: [['SNCF', 'https://www.sncf.com', 'sncf'], ['Cars Isère', '', 'isere']],
  routes: [[0, 'TGV INOUI 6901', 2, -1], [1, '3020', 3, -1], [1, 'Express', 3, 2.5], [0, 'Train TER K6', 2, -1]],
  services: [],
  trips: [],
  footpaths: [],
  origins: [0],
};
const fares: FaresData = {
  updated: '2026-03-17',
  validFrom: '01/04/2026',
  source: 'SNCF Open Data',
  sourceUrl: 'x',
  od: { '87686006-87747006': [{ min: 25, max: 110, carrier: 'TGV INOUI' }] },
};
const journey: Journey = {
  depart: 400,
  arrive: 800,
  target: 2,
  arriveAtTarget: 810,
  legs: [
    { type: 'ride', trip: 0, route: 0, from: 0, to: 1, dep: 400, arr: 600 },
    { type: 'ride', trip: 1, route: 1, from: 1, to: 2, dep: 650, arr: 800 },
  ],
};

describe('calcul de coût', () => {
  it('fourchette SNCF ouverte avec réduction ; prix non disponible sans tarif', () => {
    const lines = journeyCost(journey, transit, fares, 25, 'Aller');
    expect(lines[0].min).toBeCloseTo(18.75);
    expect(lines[0].max).toBeCloseTo(82.5);
    expect(lines[0].source).toMatch(/01\/04\/2026/);
    expect(lines[1].min).toBeNull();
    expect(lines[1].detail).toMatch(/Prix non disponible/);
    expect(lines[1].link?.url).toBeTruthy();
  });
  it("n'applique pas une grille TGV à un TER sur la même relation", () => {
    const j: Journey = { ...journey, legs: [{ type: 'ride', trip: 0, route: 3, from: 0, to: 1, dep: 0, arr: 1 }] };
    expect(journeyCost(j, transit, fares, 0, 'Aller')[0].min).toBeNull();
  });
  it('utilise le tarif GTFS quand il est publié', () => {
    const j: Journey = { ...journey, legs: [{ type: 'ride', trip: 0, route: 2, from: 1, to: 2, dep: 0, arr: 1 }] };
    expect(journeyCost(j, transit, null, 0, 'Aller')[0].min).toBe(2.5);
  });
  it('voiture, hébergement et ravitaillement', () => {
    const car = carCost(100, 3, { ...DEFAULT_COST, carCostPerKm: 0.2, roadFactor: 1.3 });
    expect(car[0].min).toBeCloseTo(52); // 100 × 1,3 × 2 × 0,20
    expect(car[1].min).toBeNull(); // péages : pas de source ouverte
    const stay = stayCost(3, { ...DEFAULT_COST, foodPerDay: 12, paidNights: 1, pricePerNight: 18 });
    expect(stay[0].min).toBe(18);
    expect(stay[1].min).toBe(36);
    const s = summarize([...car, ...stay], 3);
    expect(s.incomplete).toBe(true);
    expect(s.min).toBeCloseTo(52 + 18 + 36);
    expect(s.perDayMin).toBeCloseTo((52 + 18 + 36) / 3);
  });
});
