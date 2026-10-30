// Coût de la sortie, ligne par ligne, avec le calcul affiché.
// Règle : aucun prix n'est inventé. Un trajet sans tarif ouvert est marqué « non disponible »
// et accompagné du lien officiel du transporteur.

import type { FaresData, TransitData } from '../data/types';
import type { Journey, RideLeg } from './transit';

export interface CostSettings {
  /** Réduction sur les transports (%) : 0 = aucune. */
  discountPct: number;
  /** Budget ravitaillement par jour (€). */
  foodPerDay: number;
  /** Coût kilométrique voiture (€ / km) : carburant + usure. */
  carCostPerKm: number;
  /** Facteur route / vol d'oiseau pour estimer la distance routière. */
  roadFactor: number;
  /** Nuits en refuge ou camping (le reste en bivouac à 0 €) et prix par nuit. */
  paidNights: number;
  pricePerNight: number;
  /** Parking (€ par jour), saisi par l'utilisateur. */
  parkingPerDay: number;
}

export const DEFAULT_COST: CostSettings = {
  discountPct: 0,
  foodPerDay: 15,
  carCostPerKm: 0.15,
  roadFactor: 1.3,
  paidNights: 0,
  pricePerNight: 20,
  parkingPerDay: 0,
};

export interface CostLine {
  label: string;
  /** Fourchette en € ; null = prix non disponible. */
  min: number | null;
  max: number | null;
  /** Détail du calcul, lisible. */
  detail: string;
  estimate: boolean;
  /** Source et date de la grille utilisée. */
  source?: string;
  link?: { label: string; url: string };
}

export interface CostSummary {
  lines: CostLine[];
  min: number;
  max: number;
  /** Au moins un poste sans prix : le total est incomplet. */
  incomplete: boolean;
  perDayMin: number;
  perDayMax: number;
}

const euro = (n: number) => `${n.toFixed(2).replace('.', ',')} €`;

function fareKey(a: string, b: string): string {
  return a < b ? `${a}-${b}` : `${b}-${a}`;
}

/** Lien officiel par défaut quand l'agence GTFS n'en fournit pas. */
export function officialLink(agencyName: string, agencyUrl: string): { label: string; url: string } {
  const n = agencyName.toLowerCase();
  if (/sncf|ter|tgv|ouigo|intercit/.test(n)) return { label: 'SNCF Connect', url: 'https://www.sncf-connect.com/' };
  if (n.includes('flix')) return { label: 'FlixBus', url: 'https://www.flixbus.fr/' };
  if (n.includes('blablacar')) return { label: 'BlaBlaCar Bus', url: 'https://www.blablacar.fr/bus' };
  return { label: agencyName || 'Site du transporteur', url: agencyUrl || 'https://transport.data.gouv.fr/' };
}

/** Prix d'un trajet en transport en commun, tronçon par tronçon. */
export function rideCost(
  leg: RideLeg,
  transit: TransitData,
  fares: FaresData | null,
  discountPct: number,
  label: string,
): CostLine {
  const [agencyIdx, shortName, , gtfsPrice] = transit.routes[leg.route];
  const [agencyName, agencyUrl, feed] = transit.agencies[agencyIdx];
  const from = transit.stops[leg.from];
  const to = transit.stops[leg.to];
  const link = officialLink(agencyName, agencyUrl);
  const k = 1 - discountPct / 100;
  const title = `${label} : ${agencyName}${shortName ? ` ${shortName}` : ''}, ${from[0]} → ${to[0]}`;
  if (gtfsPrice >= 0) {
    return {
      label: title,
      min: gtfsPrice * k,
      max: gtfsPrice * k,
      detail: `${euro(gtfsPrice)} (tarif publié dans les données GTFS)${discountPct ? ` × (1 − ${discountPct} %)` : ''}`,
      estimate: true,
      source: `GTFS ${feed}`,
      link,
    };
  }
  if (fares && from[3] && to[3]) {
    const entries = fares.od[fareKey(from[3], to[3])];
    if (entries?.length) {
      const min = Math.min(...entries.map((e) => e.min));
      const max = Math.max(...entries.map((e) => e.max));
      return {
        label: title,
        min: min * k,
        max: max * k,
        detail: `Fourchette plein tarif 2de classe ${euro(min)} – ${euro(max)}${discountPct ? ` × (1 − ${discountPct} %)` : ''}`,
        estimate: true,
        source: `${fares.source}, grille en vigueur au ${fares.validFrom}`,
        link,
      };
    }
  }
  return { label: title, min: null, max: null, detail: 'Prix non disponible : voir le site officiel', estimate: true, link };
}

export function journeyCost(j: Journey | null, transit: TransitData, fares: FaresData | null, discountPct: number, label: string): CostLine[] {
  if (!j) return [];
  return j.legs.filter((l): l is RideLeg => l.type === 'ride').map((l) => rideCost(l, transit, fares, discountPct, label));
}

/** Voiture : aller-retour, distance routière estimée = vol d'oiseau × facteur. */
export function carCost(crowKm: number, days: number, s: CostSettings): CostLine[] {
  const roadKm = crowKm * s.roadFactor * 2;
  const lines: CostLine[] = [
    {
      label: 'Voiture : carburant et usure (aller-retour)',
      min: roadKm * s.carCostPerKm,
      max: roadKm * s.carCostPerKm,
      detail: `${crowKm.toFixed(0)} km à vol d'oiseau × ${s.roadFactor} (facteur route) × 2 = ${roadKm.toFixed(0)} km × ${euro(s.carCostPerKm)}/km`,
      estimate: true,
    },
    {
      label: 'Péages',
      min: null,
      max: null,
      detail: "Prix non disponible : aucune grille de péage ouverte n'est intégrée",
      estimate: true,
      link: { label: 'Autoroutes.fr (ASFA)', url: 'https://www.autoroutes.fr/fr/itineraires.htm' },
    },
  ];
  if (s.parkingPerDay > 0) {
    lines.push({ label: 'Parking', min: s.parkingPerDay * days, max: s.parkingPerDay * days, detail: `${days} j × ${euro(s.parkingPerDay)}`, estimate: true });
  }
  return lines;
}

export function stayCost(days: number, s: CostSettings): CostLine[] {
  const nights = Math.max(0, days - 1);
  const paid = Math.min(nights, s.paidNights);
  return [
    {
      label: 'Hébergement',
      min: paid * s.pricePerNight,
      max: paid * s.pricePerNight,
      detail: paid ? `${nights - paid} nuit(s) en bivouac à 0 € + ${paid} × ${euro(s.pricePerNight)}` : `${nights} nuit(s) en bivouac : 0 €`,
      estimate: paid > 0,
    },
    {
      label: 'Ravitaillement',
      min: days * s.foodPerDay,
      max: days * s.foodPerDay,
      detail: `${days} j × ${euro(s.foodPerDay)}`,
      estimate: false,
    },
  ];
}

export function summarize(lines: CostLine[], days: number): CostSummary {
  let min = 0;
  let max = 0;
  let incomplete = false;
  for (const l of lines) {
    if (l.min === null || l.max === null) incomplete = true;
    else {
      min += l.min;
      max += l.max;
    }
  }
  const d = Math.max(1, days);
  return { lines, min, max, incomplete, perDayMin: min / d, perDayMax: max / d };
}

export { euro as formatEuro };
