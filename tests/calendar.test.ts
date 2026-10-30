import { describe, expect, it } from 'vitest';
import { decodeBits, encodeBits, gtfsServiceBits, parseYmd, serviceRuns } from '../src/lib/calendar';

describe('calendrier GTFS', () => {
  // Le 2026-11-02 est un lundi.
  const cal = { weekdays: [1, 1, 1, 1, 1, 0, 0], start: '20261101', end: '20261130' };
  const ex = new Map([
    ['20261111', 2], // 11 novembre supprimé
    ['20261108', 1], // dimanche 8 ajouté
  ]);
  const bits = gtfsServiceBits('20261101', 30, cal, ex);
  const runs = (d: string) => serviceRuns(bits, '20261101', 30, parseYmd(d));
  it('jours de semaine', () => {
    expect(runs('2026-11-01')).toBe(false); // dimanche
    expect(runs('2026-11-02')).toBe(true);
    expect(runs('2026-11-07')).toBe(false); // samedi
  });
  it('exceptions calendar_dates', () => {
    expect(runs('2026-11-11')).toBe(false);
    expect(runs('2026-11-08')).toBe(true);
  });
  it("hors de l'horizon : inconnu", () => {
    expect(runs('2026-12-05')).toBeUndefined();
    expect(runs('2026-10-31')).toBeUndefined();
  });
  it('encodage base64 réversible', () => {
    expect([...decodeBits(encodeBits(bits))]).toEqual([...bits]);
  });
  it('service défini uniquement par calendar_dates', () => {
    const b = gtfsServiceBits('20261101', 30, undefined, new Map([['20261103', 1]]));
    expect(serviceRuns(b, '20261101', 30, parseYmd('20261103'))).toBe(true);
    expect(serviceRuns(b, '20261101', 30, parseYmd('20261104'))).toBe(false);
  });
});
