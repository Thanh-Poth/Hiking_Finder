// Moteur de sélection : propose des itinéraires (tracé complet, tronçon entre deux accès
// en transport, ou aller-retour) compatibles avec le nombre de jours et le budget d'effort.

import { cumulativeDistances, sliceLine } from './geo';
import { sectionStats } from './stages';
import { walkingHours, type PaceSettings } from './timing';
import type { AccessStop, RouteData } from '../data/types';

export type TripMode = 'traverse' | 'roundtrip';

export interface SelectionSettings {
  days: number;
  maxKmPerDay: number;
  maxGainPerDay: number;
  pace: PaceSettings;
  mode: TripMode;
}

export interface CutPoint {
  along: number;
  label: string;
  stop?: AccessStop;
}

export interface Proposal {
  id: string;
  route: RouteData;
  kind: 'full' | 'section' | 'out-and-back';
  start: CutPoint;
  end: CutPoint;
  /** Tracé à parcourir [lon, lat, ele]. */
  coords: number[][];
  lengthM: number;
  gain: number;
  loss: number;
  hours: number;
  fit: number;
  score: number;
  explanation: string;
}

const fmtKm = (m: number) => (m / 1000).toFixed(m < 10000 ? 1 : 0).replace('.', ',');

/** Adéquation 0–1 : idéal entre 55 % et 95 % du budget journalier, nul au-delà de 110 %. */
export function dailyFit(perDay: number, budget: number): number {
  if (budget <= 0) return 0;
  const r = perDay / budget;
  if (r > 1.1) return 0;
  if (r > 0.95) return 1 - (r - 0.95) / 0.15;
  if (r >= 0.55) return 1;
  return Math.max(0, r / 0.55);
}

/** Points de coupure : extrémités du tracé + arrêts de transport dédoublonnés (500 m). */
export function cutPoints(route: RouteData, total: number): CutPoint[] {
  const pts: CutPoint[] = [{ along: 0, label: 'début du tracé' }];
  const stops = [...route.access].sort((a, b) => b.departuresPerDay - a.departuresPerDay);
  const kept: AccessStop[] = [];
  for (const s of stops) if (!kept.some((k) => Math.abs(k.along - s.along) < 500)) kept.push(s);
  for (const s of kept.sort((a, b) => a.along - b.along)) pts.push({ along: s.along, label: s.name, stop: s });
  if (!route.loop) pts.push({ along: total, label: 'fin du tracé' });
  return pts;
}

function accessQuality(p: CutPoint): number {
  if (!p.stop) return 0;
  return Math.min(1, Math.log10(1 + p.stop.departuresPerDay) / Math.log10(21));
}

export function proposeItineraries(routes: RouteData[], s: SelectionSettings, limit = 12): Proposal[] {
  const out: Proposal[] = [];
  const n = Math.max(1, s.days);
  for (const route of routes) {
    const coords = route.coords;
    const cum = cumulativeDistances(coords);
    const total = cum[cum.length - 1];
    const cuts = cutPoints(route, total);
    const consider = (kind: Proposal['kind'], start: CutPoint, end: CutPoint) => {
      let path: number[][];
      if (kind === 'out-and-back') {
        // Aller de `start` vers `end` (dans un sens ou dans l'autre), puis retour.
        let fwd = sliceLine(coords, cum, Math.min(start.along, end.along), Math.max(start.along, end.along));
        if (end.along < start.along) fwd = fwd.reverse();
        path = [...fwd, ...fwd.slice(0, -1).reverse()];
      } else if (kind === 'full') {
        path = coords.map((c) => [...c]);
      } else {
        path = sliceLine(coords, cum, start.along, end.along);
      }
      const pc = cumulativeDistances(path);
      const st = sectionStats(path, pc, 0, pc[pc.length - 1]);
      const kmDay = st.distance / n;
      const gainDay = st.gain / n;
      const fit = Math.min(dailyFit(kmDay / 1000, s.maxKmPerDay), dailyFit(gainDay, s.maxGainPerDay) || (st.gain < 50 ? 1 : 0));
      if (fit <= 0) return;
      const sameEnds = kind === 'out-and-back' || (kind === 'full' && route.loop);
      const access = sameEnds ? accessQuality(start) : (accessQuality(start) + accessQuality(end)) / 2;
      const score = 0.45 * fit + 0.35 * route.score.total + 0.2 * access;
      const hours = walkingHours(st.distance, st.gain, st.loss, s.pace);
      const where =
        kind === 'full'
          ? route.loop ? 'boucle complète' : 'tracé complet'
          : kind === 'out-and-back'
            ? `aller-retour depuis ${start.label}`
            : `de ${start.label} à ${end.label}`;
      out.push({
        id: `${route.id}:${kind}:${Math.round(start.along)}-${Math.round(end.along)}`,
        route,
        kind,
        start,
        end,
        coords: path,
        lengthM: st.distance,
        gain: st.gain,
        loss: st.loss,
        hours,
        fit,
        score,
        explanation: `${n} jour${n > 1 ? 's' : ''}, ${fmtKm(kmDay)} km et +${Math.round(gainDay)} m par jour en moyenne (${where}).`,
      });
    };
    if (s.mode === 'roundtrip') {
      if (route.loop) consider('full', cuts[1] ?? cuts[0], cuts[1] ?? cuts[0]);
      for (const a of cuts) {
        // Aller-retour : on cherche le point de demi-tour le plus adapté au budget.
        const halfBudget = (n * s.maxKmPerDay * 1000 * 0.8) / 2;
        for (const dir of [1, -1]) {
          const turn = Math.max(0, Math.min(total, a.along + dir * halfBudget));
          if (Math.abs(turn - a.along) < 2000) continue;
          consider('out-and-back', a, { along: turn, label: 'demi-tour' });
        }
      }
    } else {
      consider('full', cuts[0], route.loop ? cuts[0] : cuts[cuts.length - 1]);
      for (let i = 0; i < cuts.length; i++) {
        for (let j = i + 1; j < cuts.length; j++) {
          if (i === 0 && j === cuts.length - 1) continue;
          if (cuts[j].along - cuts[i].along < 3000) continue;
          consider('section', cuts[i], cuts[j]);
        }
      }
    }
  }
  // Garde au plus 3 propositions par itinéraire, puis les meilleures au total.
  out.sort((a, b) => b.score - a.score);
  const perRoute = new Map<string, number>();
  const res: Proposal[] = [];
  for (const p of out) {
    const c = perRoute.get(p.route.id) ?? 0;
    if (c >= 3) continue;
    if (res.some((r) => r.route.id === p.route.id && Math.abs(r.lengthM - p.lengthM) < 1500 && Math.abs(r.start.along - p.start.along) < 1500)) continue;
    perRoute.set(p.route.id, c + 1);
    res.push(p);
    if (res.length >= limit) break;
  }
  return res;
}
