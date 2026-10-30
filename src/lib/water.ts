// Points d'eau le long d'un itinéraire et analyse par étape.

import { cumulativeDistances, snapToLine } from './geo';
import { cumulativeHours } from './stages';
import type { PaceSettings } from './timing';
import type { Poi } from '../data/types';

export interface PoiOnRoute {
  poi: Poi;
  /** Distance depuis le départ de l'itinéraire (m). */
  along: number;
  /** Écart au tracé (m). */
  offset: number;
}

/** POI à moins de `bufferM` du tracé, triés par abscisse. Pré-filtre par bbox pour la rapidité. */
export function poisAlongRoute(
  coords: readonly (readonly number[])[],
  pois: readonly Poi[],
  bufferM: number,
  cum: readonly number[] = cumulativeDistances(coords),
): PoiOnRoute[] {
  let w = Infinity, s = Infinity, e = -Infinity, n = -Infinity;
  for (const c of coords) {
    w = Math.min(w, c[0]); e = Math.max(e, c[0]);
    s = Math.min(s, c[1]); n = Math.max(n, c[1]);
  }
  const dLat = bufferM / 111320;
  const dLon = bufferM / (111320 * Math.cos(((s + n) / 2) * (Math.PI / 180)));
  const out: PoiOnRoute[] = [];
  for (const poi of pois) {
    if (poi.lon < w - dLon || poi.lon > e + dLon || poi.lat < s - dLat || poi.lat > n + dLat) continue;
    const snap = snapToLine([poi.lon, poi.lat], coords, cum);
    if (snap.distance <= bufferM) out.push({ poi, along: snap.along, offset: snap.distance });
  }
  return out.sort((a, b) => a.along - b.along);
}

export const isWater = (p: Poi) => p.kind === 'water' || p.kind === 'spring';

export interface WaterSettings {
  /** Tampon de recherche des points d'eau autour du tracé (m). */
  bufferM: number;
  /** Consommation en marche (L/h). */
  litersPerHour: number;
  /** Besoin au bivouac sans eau (soir + matin), en litres. */
  bivouacLiters: number;
  /** Seuil d'alerte pour un tronçon sans eau (km). */
  alertKm: number;
}

export const DEFAULT_WATER: WaterSettings = { bufferM: 200, litersPerHour: 0.5, bivouacLiters: 2.5, alertKm: 8 };

export interface StageWater {
  points: PoiOnRoute[];
  /** Plus long tronçon sans eau dans l'étape (m) et durée estimée (h). */
  longestDryM: number;
  longestDryH: number;
  longestDryFrom: number;
  waterAtBivouac: boolean;
  litersToCarry: number;
  alert: boolean;
}

/**
 * Analyse d'une étape [from, to]. Le départ compte comme un point d'eau si `waterAtStart`
 * (bivouac précédent avec eau, ou départ depuis un village).
 */
export function analyzeStageWater(
  coords: readonly (readonly number[])[],
  waterOnRoute: readonly PoiOnRoute[],
  from: number,
  to: number,
  waterAtStart: boolean,
  waterAtEnd: boolean,
  isLastStage: boolean,
  pace: PaceSettings,
  settings: WaterSettings,
  cum: readonly number[] = cumulativeDistances(coords),
  hrs: readonly number[] = cumulativeHours(coords, pace),
): StageWater {
  const points = waterOnRoute.filter((w) => w.along >= from && w.along <= to);
  const usable = points.filter((w) => w.poi.potable !== 'no');
  const marks = [...(waterAtStart ? [from] : []), ...usable.map((w) => w.along), ...(waterAtEnd ? [to] : [])];
  const hoursAt = (a: number) => {
    let lo = 0, hi = cum.length - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (cum[mid] <= a) lo = mid;
      else hi = mid;
    }
    const t = (a - cum[lo]) / (cum[hi] - cum[lo] || 1);
    return hrs[lo] + Math.max(0, Math.min(1, t)) * (hrs[hi] - hrs[lo]);
  };
  let longest = 0, longestH = 0, longestFrom = from;
  // Sans eau au départ, on part avec ce qu'on porte : le premier tronçon commence quand même à `from`.
  let prev = from;
  const bounds = [...marks.filter((m) => m > from), to];
  for (const m of bounds) {
    const d = m - prev;
    if (d > longest) {
      longest = d;
      longestH = hoursAt(m) - hoursAt(prev);
      longestFrom = prev;
    }
    prev = m;
  }
  const carryWalk = longestH * settings.litersPerHour + 0.5; // réserve 0,5 L
  const carryBivouac = !waterAtEnd && !isLastStage ? settings.bivouacLiters : 0;
  // Arrondi au demi-litre supérieur (après arrondi au centilitre pour éviter les artefacts flottants).
  const litersToCarry = Math.ceil((Math.round((carryWalk + carryBivouac) * 100) / 100) * 2) / 2;
  return {
    points,
    longestDryM: longest,
    longestDryH: longestH,
    longestDryFrom: longestFrom,
    waterAtBivouac: waterAtEnd,
    litersToCarry,
    alert: longest / 1000 > settings.alertKm,
  };
}
