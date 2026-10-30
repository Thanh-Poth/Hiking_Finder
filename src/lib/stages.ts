// Découpage d'un itinéraire en étapes, chaque nuit en bivouac.
//
// Principe :
// 1. L'effort est mesuré en heures de marche (formule DIN 33466, segment par segment).
// 2. L'effort restant est réparti entre les jours restants au prorata des heures disponibles
//    (jour 1 à partir de l'arrivée du transport, dernier jour jusqu'au dernier retour, sinon
//    du lever au coucher du soleil).
// 3. Pour chaque nuit, on cherche près du point idéal un emplacement candidat : point d'eau
//    à moins de `waterRadiusM` du tracé, règle de bivouac non interdite, à l'écart des refuges
//    (sauf si la règle impose la proximité d'un refuge), dans les limites km / D+ / heures du jour.
// 4. À défaut : fenêtre élargie, puis bivouac sans eau signalé, puis problème signalé.

import { cumulativeDistances, elevationGainLoss, haversine, pointAt, snapToLine } from './geo';
import { DEFAULT_PACE, walkingHours, type PaceSettings } from './timing';
import type { BivouacRule, Poi } from '../data/types';

export interface StageSettings {
  days: number;
  maxKmPerDay: number;
  maxGainPerDay: number;
  pace: PaceSettings;
  /** Rayon de recherche de l'eau autour du bivouac (m). */
  waterRadiusM: number;
  /** Distance en dessous de laquelle un refuge est jugé « proche » (m). */
  hutAvoidM: number;
  /** Heure de départ de marche du jour 1 (heures décimales). */
  firstStartHour: number;
  /** Heure limite d'arrivée le dernier jour (heures décimales). */
  lastDeadlineHour: number;
  /** Lever / coucher du soleil (heures décimales) pour chaque jour. */
  daylight: { sunrise: number; sunset: number }[];
  /** Marge avant le coucher du soleil pour monter le camp (h). */
  sunsetMarginH: number;
}

export const DEFAULT_STAGE_SETTINGS: Omit<StageSettings, 'days' | 'daylight'> = {
  maxKmPerDay: 22,
  maxGainPerDay: 1200,
  pace: DEFAULT_PACE,
  waterRadiusM: 300,
  hutAvoidM: 400,
  firstStartHour: 9,
  lastDeadlineHour: 17,
  sunsetMarginH: 1,
};

export interface BivouacSpot {
  along: number;
  lon: number;
  lat: number;
  ele: number;
  water: Poi | null;
  waterDistance: number;
  rule: BivouacRule;
  nearHut: Poi | null;
  hutDistance: number;
}

export interface Stage {
  index: number;
  from: number;
  to: number;
  distance: number;
  gain: number;
  loss: number;
  hours: number;
  /** Heures disponibles ce jour-là. */
  availableHours: number;
  startHour: number;
  bivouac: BivouacSpot | null;
  issues: string[];
}

export type RuleLookup = (lon: number, lat: number) => BivouacRule;

/** Heures de marche cumulées à chaque sommet. */
export function cumulativeHours(coords: readonly (readonly number[])[], pace: PaceSettings): number[] {
  const out = [0];
  for (let i = 1; i < coords.length; i++) {
    const d = haversine(coords[i - 1], coords[i]);
    const dz = (coords[i][2] ?? 0) - (coords[i - 1][2] ?? 0);
    out.push(out[i - 1] + walkingHours(d, Math.max(0, dz), Math.max(0, -dz), pace));
  }
  return out;
}

function interp(cum: readonly number[], values: readonly number[], along: number): number {
  if (along <= 0) return values[0];
  const last = cum.length - 1;
  if (along >= cum[last]) return values[last];
  let lo = 0;
  let hi = last;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (cum[mid] <= along) lo = mid;
    else hi = mid;
  }
  const t = (along - cum[lo]) / (cum[hi] - cum[lo] || 1);
  return values[lo] + t * (values[hi] - values[lo]);
}

/** Statistiques d'un tronçon [from, to] (m). */
export function sectionStats(
  coords: readonly (readonly number[])[],
  cum: readonly number[],
  from: number,
  to: number,
): { distance: number; gain: number; loss: number } {
  const eles: number[] = [pointAt(coords, cum, from)[2] ?? 0];
  for (let i = 0; i < coords.length; i++) if (cum[i] > from && cum[i] < to) eles.push(coords[i][2] ?? 0);
  eles.push(pointAt(coords, cum, to)[2] ?? 0);
  return { distance: to - from, ...elevationGainLoss(eles, 3) };
}

/** Emplacements candidats : points d'eau proches du tracé + points réguliers sans eau (secours). */
export function bivouacCandidates(
  coords: readonly (readonly number[])[],
  cum: readonly number[],
  pois: readonly Poi[],
  ruleAt: RuleLookup,
  waterRadiusM: number,
  hutAvoidM: number,
  fallbackStepM = 500,
): BivouacSpot[] {
  const huts = pois.filter((p) => p.kind === 'hut_guarded' || p.kind === 'hut_unguarded');
  const spots: BivouacSpot[] = [];
  const nearestHut = (lon: number, lat: number) => {
    let best: Poi | null = null;
    let bd = Infinity;
    for (const h of huts) {
      const d = haversine([lon, lat], [h.lon, h.lat]);
      if (d < bd) {
        bd = d;
        best = h;
      }
    }
    return { hut: bd <= Math.max(hutAvoidM, 300) ? best : null, d: bd };
  };
  for (const p of pois) {
    if (p.kind !== 'water' && p.kind !== 'spring') continue;
    const snap = snapToLine([p.lon, p.lat], coords, cum);
    if (snap.distance > waterRadiusM) continue;
    const pt = pointAt(coords, cum, snap.along);
    const rule = ruleAt(p.lon, p.lat);
    if (rule.type === 'forbidden') continue;
    const h = nearestHut(p.lon, p.lat);
    spots.push({ along: snap.along, lon: pt[0], lat: pt[1], ele: pt[2] ?? 0, water: p, waterDistance: snap.distance, rule, nearHut: h.hut, hutDistance: h.d });
  }
  const total = cum[cum.length - 1];
  for (let a = fallbackStepM; a < total; a += fallbackStepM) {
    const pt = pointAt(coords, cum, a);
    const rule = ruleAt(pt[0], pt[1]);
    if (rule.type === 'forbidden') continue;
    const h = nearestHut(pt[0], pt[1]);
    spots.push({ along: a, lon: pt[0], lat: pt[1], ele: pt[2] ?? 0, water: null, waterDistance: Infinity, rule, nearHut: h.hut, hutDistance: h.d });
  }
  return spots.sort((x, y) => x.along - y.along);
}

/** Pénalité (en heures équivalentes) d'un emplacement ; Infinity = inacceptable. */
export function spotPenalty(s: BivouacSpot, hutAvoidM: number): number {
  let p = 0;
  if (!s.water) p += 1.5;
  else if (s.water.potable === 'no') p += 0.5;
  if (s.rule.type === 'unknown') p += 0.25;
  if (s.rule.type === 'near_hut_only') {
    if (!s.nearHut || s.hutDistance > 300) return Infinity;
  } else if (s.nearHut && s.hutDistance < hutAvoidM) {
    p += 0.3;
  }
  return p;
}

export function availableHours(settings: StageSettings, day: number): { start: number; hours: number } {
  const dl = settings.daylight[day] ?? { sunrise: 7, sunset: 19 };
  const start = day === 0 ? Math.max(settings.firstStartHour, dl.sunrise) : dl.sunrise + 0.5;
  let end = dl.sunset - settings.sunsetMarginH;
  if (day === settings.days - 1) end = Math.min(end + settings.sunsetMarginH, settings.lastDeadlineHour);
  return { start, hours: Math.max(0, end - start) };
}

export function splitStages(
  coords: readonly (readonly number[])[],
  pois: readonly Poi[],
  ruleAt: RuleLookup,
  settings: StageSettings,
): Stage[] {
  const cum = cumulativeDistances(coords);
  const total = cum[cum.length - 1];
  const hrs = cumulativeHours(coords, settings.pace);
  const effortAt = (a: number) => interp(cum, hrs, a);
  const n = Math.max(1, Math.round(settings.days));
  const avail = Array.from({ length: n }, (_, d) => availableHours(settings, d));
  const candidates = n > 1 ? bivouacCandidates(coords, cum, pois, ruleAt, settings.waterRadiusM, settings.hutAvoidM) : [];

  const stages: Stage[] = [];
  let from = 0;
  for (let day = 0; day < n; day++) {
    const issues: string[] = [];
    const isLast = day === n - 1;
    let to = total;
    let spot: BivouacSpot | null = null;
    const e0 = effortAt(from);
    if (!isLast) {
      const remaining = effortAt(total) - e0;
      const remainingAvail = avail.slice(day).reduce((s, a) => s + a.hours, 0) || 1;
      // Répartition au prorata des heures disponibles ; si le temps manque, on remplit chaque jour
      // au maximum pour ne pas reporter tout le retard sur le dernier jour.
      const target = remaining > remainingAvail ? avail[day].hours : (remaining * avail[day].hours) / remainingAvail;
      // Limite de faisabilité du jour : heures, km et D+.
      const feasible = (s: BivouacSpot) => {
        if (s.along <= from + 100) return false;
        const e = effortAt(s.along) - e0;
        if (e > avail[day].hours) return false;
        const st = sectionStats(coords, cum, from, s.along);
        return st.distance / 1000 <= settings.maxKmPerDay && st.gain <= settings.maxGainPerDay;
      };
      const pick = (lo: number, hi: number) => {
        let best: BivouacSpot | null = null;
        let bestScore = Infinity;
        for (const s of candidates) {
          const e = effortAt(s.along) - e0;
          if (e < lo || e > hi) continue;
          const pen = spotPenalty(s, settings.hutAvoidM);
          if (!Number.isFinite(pen) || !feasible(s)) continue;
          const score = Math.abs(e - target) + pen;
          if (score < bestScore) {
            bestScore = score;
            best = s;
          }
        }
        return best;
      };
      // Une seule notation : écart à la cible (h) + pénalités (sans eau = 1,5 h, règle inconnue…).
      spot = pick(target * 0.6, target * 1.3) ?? pick(target * 0.3, target * 1.7) ?? pick(0, Infinity);
      if (spot) {
        to = spot.along;
        if (!spot.water) issues.push(`Pas de point d'eau à moins de ${settings.waterRadiusM} m d'un emplacement autorisé près du point idéal : bivouac sans eau, prévoir l'eau du soir et du matin.`);
        if (Math.abs(effortAt(spot.along) - e0 - target) > Math.max(1, target * 0.4)) issues.push("Aucun bivouac conforme près du point idéal : l'étape a été décalée.");
      } else {
        // Dernier recours : point idéal, signalé comme problème.
        let lo = from;
        let hi = total;
        for (let k = 0; k < 40; k++) {
          const mid = (lo + hi) / 2;
          if (effortAt(mid) - e0 < target) lo = mid;
          else hi = mid;
        }
        to = lo;
        issues.push('Aucun emplacement de bivouac autorisé trouvé sur cette étape : vérifier sur place ou raccourcir.');
      }
    }
    const st = sectionStats(coords, cum, from, to);
    const hours = effortAt(to) - e0;
    if (hours > avail[day].hours + 0.01) {
      issues.push(
        isLast
          ? `Étape finale trop longue : ${hours.toFixed(1)} h de marche pour ${avail[day].hours.toFixed(1)} h disponibles avant l'heure limite (dernier transport ou coucher du soleil).`
          : `Étape plus longue que la durée de jour disponible (${hours.toFixed(1)} h pour ${avail[day].hours.toFixed(1)} h).`,
      );
    }
    if (st.distance / 1000 > settings.maxKmPerDay + 0.05) issues.push(`Distance supérieure au maximum réglé (${(st.distance / 1000).toFixed(1)} km).`);
    if (st.gain > settings.maxGainPerDay) issues.push(`Dénivelé positif supérieur au maximum réglé (+${st.gain} m).`);
    stages.push({ index: day, from, to, ...st, hours, availableHours: avail[day].hours, startHour: avail[day].start, bivouac: spot, issues });
    from = to;
    if (from >= total && !isLast) {
      stages[stages.length - 1].issues.push("L'itinéraire est trop court pour le nombre de jours choisi.");
      break;
    }
  }
  return stages;
}
