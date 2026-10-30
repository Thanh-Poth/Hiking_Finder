// Recherche d'itinéraires en transports en commun sur les horaires théoriques compactés
// (algorithme Connection Scan, Dibbelt et al. 2013). Tout est calculé dans le navigateur.

import { addDays, bitAt, dayDiff, decodeBits, parseYmd } from './calendar';
import type { TransitData } from '../data/types';

export interface Connection {
  dep: number;
  arr: number;
  depTime: number;
  arrTime: number;
  trip: number;
}

export interface RideLeg {
  type: 'ride';
  trip: number;
  route: number;
  from: number;
  to: number;
  dep: number;
  arr: number;
}

export interface WalkLeg {
  type: 'walk';
  from: number;
  to: number;
  minutes: number;
}

export type Leg = RideLeg | WalkLeg;

export interface Journey {
  legs: Leg[];
  /** Minutes depuis minuit du jour de recherche. */
  depart: number;
  arrive: number;
  /** Arrêt d'arrivée retenu (parmi les cibles). */
  target: number;
  /** Arrivée à la cible, marche finale incluse. */
  arriveAtTarget: number;
}

export interface Target {
  stop: number;
  /** Minutes à ajouter (marche jusqu'au départ du sentier, par ex.). */
  extra: number;
}

/** Correspondance minimale entre deux véhicules (min). */
export const MIN_CHANGE = 6;

export class TransitIndex {
  readonly services: Uint8Array[];
  private readonly feet: Map<number, [number, number][]>;
  private readonly cache = new Map<number, Connection[]>();

  constructor(readonly data: TransitData) {
    this.services = data.services.map(decodeBits);
    this.feet = new Map();
    for (const [a, b, m] of data.footpaths) {
      if (!this.feet.has(a)) this.feet.set(a, []);
      if (!this.feet.has(b)) this.feet.set(b, []);
      this.feet.get(a)!.push([b, m]);
      this.feet.get(b)!.push([a, m]);
    }
  }

  /** Indice du jour dans l'horizon publié, ou -1 hors horizon. */
  dayIndex(date: Date): number {
    const i = dayDiff(parseYmd(this.data.start), date);
    return i >= 0 && i < this.data.days ? i : -1;
  }

  horizonEnd(): Date {
    return addDays(parseYmd(this.data.start), this.data.days - 1);
  }

  /** Connexions du jour (y compris les courses de la veille qui passent minuit), triées par départ. */
  connections(day: number): Connection[] {
    const hit = this.cache.get(day);
    if (hit) return hit;
    const out: Connection[] = [];
    this.data.trips.forEach(([, svc, stops, times], t) => {
      const bits = this.services[svc];
      const today = bitAt(bits, day);
      const yesterday = day > 0 && bitAt(bits, day - 1) && times[times.length - 1] >= 1440;
      for (const shift of [today ? 0 : null, yesterday ? -1440 : null]) {
        if (shift === null) continue;
        for (let i = 0; i < stops.length - 1; i++) {
          const depTime = times[i] + shift;
          if (depTime < 0) continue;
          out.push({ dep: stops[i], arr: stops[i + 1], depTime, arrTime: times[i + 1] + shift, trip: t });
        }
      }
    });
    out.sort((a, b) => a.depTime - b.depTime || a.arrTime - b.arrTime);
    this.cache.set(day, out);
    return out;
  }

  /** Arrivée au plus tôt depuis `origins` en partant après `departAfter` (min). */
  earliestArrival(day: number, origins: number[], departAfter: number, targets: Target[]): Journey | null {
    if (day < 0 || origins.length === 0 || targets.length === 0) return null;
    const conns = this.connections(day);
    const n = this.data.stops.length;
    const ready = new Float64Array(n).fill(Infinity); // heure à partir de laquelle on peut monter
    const arrival = new Float64Array(n).fill(Infinity); // arrivée réelle
    const parentConn = new Int32Array(n).fill(-1);
    const parentEnter = new Int32Array(n).fill(-1);
    const walkFrom = new Int32Array(n).fill(-1);
    const walkMin = new Float64Array(n);
    const tripEnter = new Map<number, number>();
    const relax = (s: number, t: number) => {
      for (const [b, m] of this.feet.get(s) ?? []) {
        const at = t + m;
        if (at < arrival[b]) {
          arrival[b] = at;
          ready[b] = at + MIN_CHANGE;
          parentConn[b] = -1;
          walkFrom[b] = s;
          walkMin[b] = m;
        }
      }
    };
    for (const o of origins) {
      ready[o] = departAfter;
      arrival[o] = departAfter;
    }
    for (const o of origins) relax(o, departAfter);
    const targetSet = new Map(targets.map((t) => [t.stop, t.extra]));
    let best = Infinity;
    for (let i = 0; i < conns.length; i++) {
      const c = conns[i];
      if (c.depTime >= best) break;
      const onTrip = tripEnter.has(c.trip);
      if (!onTrip && ready[c.dep] > c.depTime) continue;
      if (!onTrip) tripEnter.set(c.trip, i);
      if (c.arrTime < arrival[c.arr]) {
        arrival[c.arr] = c.arrTime;
        ready[c.arr] = c.arrTime + MIN_CHANGE;
        parentConn[c.arr] = i;
        parentEnter[c.arr] = tripEnter.get(c.trip)!;
        walkFrom[c.arr] = -1;
        relax(c.arr, c.arrTime);
      }
      const extra = targetSet.get(c.arr);
      if (extra !== undefined) best = Math.min(best, arrival[c.arr] + extra);
    }
    let bestTarget = -1;
    let bestAt = Infinity;
    for (const t of targets) {
      const at = arrival[t.stop] + t.extra;
      if (at < bestAt) {
        bestAt = at;
        bestTarget = t.stop;
      }
    }
    if (bestTarget < 0 || !Number.isFinite(bestAt)) return null;
    // Reconstruction.
    const legs: Leg[] = [];
    const originSet = new Set(origins);
    let s = bestTarget;
    for (let guard = 0; guard < 64 && !(originSet.has(s) && parentConn[s] < 0 && walkFrom[s] < 0); guard++) {
      if (parentConn[s] >= 0) {
        const exit = conns[parentConn[s]];
        const enter = conns[parentEnter[s]];
        legs.unshift({ type: 'ride', trip: exit.trip, route: this.data.trips[exit.trip][0], from: enter.dep, to: exit.arr, dep: enter.depTime, arr: exit.arrTime });
        s = enter.dep;
      } else if (walkFrom[s] >= 0) {
        legs.unshift({ type: 'walk', from: walkFrom[s], to: s, minutes: walkMin[s] });
        s = walkFrom[s];
      } else break;
    }
    const firstRide = legs.find((l): l is RideLeg => l.type === 'ride');
    if (!firstRide) return null;
    return { legs, depart: firstRide.dep - legs.slice(0, legs.indexOf(firstRide)).reduce((m, l) => m + (l.type === 'walk' ? l.minutes : 0), 0), arrive: arrival[bestTarget], target: bestTarget, arriveAtTarget: bestAt };
  }

  /**
   * Retours possibles le jour `day` : pour chaque départ depuis les arrêts `sources`
   * (après `notBefore`), arrivée au plus tôt vers `destinations`. Renvoie les trajets
   * non dominés, du plus tôt au plus tard ; le dernier est le « dernier retour ».
   */
  returnOptions(day: number, sources: Target[], destinations: number[], notBefore = 0, latestArrival = 26 * 60): Journey[] {
    if (day < 0) return [];
    const conns = this.connections(day);
    const srcSet = new Set(sources.map((s) => s.stop));
    const times = [...new Set(conns.filter((c) => srcSet.has(c.dep) && c.depTime >= notBefore).map((c) => c.depTime))];
    const results: Journey[] = [];
    const targets = destinations.map((d) => ({ stop: d, extra: 0 }));
    for (const t of times) {
      const j = this.earliestArrival(day, [...srcSet], t, targets);
      if (!j || j.arrive > latestArrival) continue;
      if (results.some((r) => r.depart === j.depart && r.arrive === j.arrive)) continue;
      results.push(j);
    }
    // Retire les trajets dominés (partir plus tôt pour arriver plus tard).
    return results.filter((a) => !results.some((b) => b !== a && b.depart >= a.depart && b.arrive <= a.arrive && (b.depart > a.depart || b.arrive < a.arrive)));
  }
}

export function fmtTime(min: number): string {
  if (!Number.isFinite(min)) return '—';
  const m = Math.round(min);
  const h = Math.floor(m / 60);
  const day = h >= 24 ? ' (+1 j)' : '';
  return `${String(h % 24).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}${day}`;
}
