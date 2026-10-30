import { describe, expect, it } from 'vitest';
import { splitStages, type StageSettings, DEFAULT_STAGE_SETTINGS, cumulativeHours } from '../src/lib/stages';
import { walkingHours, DEFAULT_PACE } from '../src/lib/timing';
import { ALLOWED, FORBIDDEN, northLine, water } from './helpers';

const day = { sunrise: 6.5, sunset: 20.5 };
const settings = (days: number, extra: Partial<StageSettings> = {}): StageSettings => ({
  ...DEFAULT_STAGE_SETTINGS,
  days,
  daylight: Array(days).fill(day),
  firstStartHour: 8,
  lastDeadlineHour: 18,
  maxKmPerDay: 30,
  ...extra,
});

describe('temps de marche DIN 33466', () => {
  it('plat : 12 km à 4 km/h = 3 h', () => expect(walkingHours(12000, 0, 0)).toBeCloseTo(3));
  it('max + moitié du min', () => {
    // th = 2 h, tv = 600/300 = 2 h → 3 h
    expect(walkingHours(8000, 600, 0)).toBeCloseTo(3);
  });
  it('cumul monotone', () => {
    const h = cumulativeHours(northLine(50, (i) => 1000 + i * 10), DEFAULT_PACE);
    expect(h.every((v, i) => i === 0 || v >= h[i - 1])).toBe(true);
  });
});

describe('découpage en étapes', () => {
  const line = northLine(401); // 40 km à plat
  it("place la nuit au point d'eau proche du milieu", () => {
    const pois = [water('w1', 6.0, line[190][1]), water('w2', 6.0, line[80][1])];
    const st = splitStages(line, pois, () => ALLOWED, settings(2));
    expect(st).toHaveLength(2);
    expect(st[0].bivouac?.water?.id).toBe('w1');
    expect(st[0].to).toBeCloseTo(19000, -2);
    expect(st[1].to).toBeCloseTo(40000, -2);
    expect(st[0].issues).toEqual([]);
  });
  it('évite les zones interdites', () => {
    const pois = [water('w1', 6.0, line[200][1]), water('w2', 6.0, line[230][1])];
    const ruleAt = (_lon: number, lat: number) => (Math.abs(lat - line[200][1]) < 1e-4 ? FORBIDDEN : ALLOWED);
    const st = splitStages(line, pois, ruleAt, settings(2));
    expect(st[0].bivouac?.water?.id).toBe('w2');
  });
  it("signale un bivouac sans eau quand il n'y a pas de source", () => {
    const st = splitStages(line, [], () => ALLOWED, settings(2));
    expect(st[0].bivouac?.water).toBeNull();
    expect(st[0].issues.join(' ')).toMatch(/sans eau/);
  });
  it('signale une étape finale trop longue pour le dernier transport', () => {
    const st = splitStages(line, [], () => ALLOWED, settings(1, { lastDeadlineHour: 11 }));
    expect(st[0].issues.join(' ')).toMatch(/Étape finale trop longue/);
  });
  it("signale l'absence de tout emplacement autorisé", () => {
    const st = splitStages(line, [], () => FORBIDDEN, settings(2));
    expect(st[0].bivouac).toBeNull();
    expect(st[0].issues.join(' ')).toMatch(/Aucun emplacement/);
  });
  it("respecte la règle « près d'un refuge uniquement »", () => {
    const hut = { id: 'h', kind: 'hut_guarded' as const, lon: 6.0, lat: line[220][1], source: 'osm' as const };
    const pois = [water('w1', 6.0, line[200][1]), water('w2', 6.0, line[221][1]), hut];
    const rule = { ...ALLOWED, type: 'near_hut_only' as const };
    const st = splitStages(line, pois, () => rule, settings(2));
    expect(st[0].bivouac?.water?.id).toBe('w2');
  });
});
