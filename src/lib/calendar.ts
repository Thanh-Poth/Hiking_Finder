// Jours de circulation des services de transport (champ de bits encodé en base64)
// et petites fonctions de dates en heure locale (AAAAMMJJ / AAAA-MM-JJ).

export function parseYmd(s: string): Date {
  const c = s.replace(/-/g, '');
  return new Date(Number(c.slice(0, 4)), Number(c.slice(4, 6)) - 1, Number(c.slice(6, 8)), 12);
}

export function toIsoDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function addDays(d: Date, n: number): Date {
  const r = new Date(d);
  r.setDate(r.getDate() + n);
  return r;
}

/** Nombre de jours entre deux dates (b - a), insensible aux changements d'heure. */
export function dayDiff(a: Date, b: Date): number {
  const ua = Date.UTC(a.getFullYear(), a.getMonth(), a.getDate());
  const ub = Date.UTC(b.getFullYear(), b.getMonth(), b.getDate());
  return Math.round((ub - ua) / 86400000);
}

export function decodeBits(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function encodeBits(bits: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bits.length; i++) s += String.fromCharCode(bits[i]);
  return btoa(s);
}

export function bitAt(bits: Uint8Array, i: number): boolean {
  if (i < 0 || i >= bits.length * 8) return false;
  return (bits[i >> 3] & (1 << (i & 7))) !== 0;
}

export function setBit(bits: Uint8Array, i: number): void {
  bits[i >> 3] |= 1 << (i & 7);
}

/** Le service circule-t-il à la date donnée ? `undefined` si la date sort de l'horizon publié. */
export function serviceRuns(bits: Uint8Array, horizonStart: string, horizonDays: number, date: Date): boolean | undefined {
  const i = dayDiff(parseYmd(horizonStart), date);
  if (i < 0 || i >= horizonDays) return undefined;
  return bitAt(bits, i);
}

/**
 * Calcule les jours actifs d'un service GTFS (calendar.txt + calendar_dates.txt) sur l'horizon.
 * `weekdays` : lundi..dimanche (0/1) ; exceptions : AAAAMMJJ → 1 (ajout) ou 2 (suppression).
 */
export function gtfsServiceBits(
  horizonStart: string,
  horizonDays: number,
  calendar: { weekdays: number[]; start: string; end: string } | undefined,
  exceptions: Map<string, number> | undefined,
): Uint8Array {
  const bits = new Uint8Array(Math.ceil(horizonDays / 8));
  const d0 = parseYmd(horizonStart);
  for (let i = 0; i < horizonDays; i++) {
    const d = addDays(d0, i);
    const ymd = toIsoDate(d).replace(/-/g, '');
    let on = false;
    if (calendar && ymd >= calendar.start && ymd <= calendar.end) {
      on = calendar.weekdays[(d.getDay() + 6) % 7] === 1;
    }
    const ex = exceptions?.get(ymd);
    if (ex === 1) on = true;
    else if (ex === 2) on = false;
    if (on) setBit(bits, i);
  }
  return bits;
}
