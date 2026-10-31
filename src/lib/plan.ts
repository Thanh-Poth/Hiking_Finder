// Calcul complet d'une sortie pour une proposition donnée : transports aller / retour, étapes avec
// bivouacs, eau, points utiles, coût et avertissements. Sans accès au DOM.

import type { FaresData, Poi, Station, TransitData } from '../data/types';
import { addDays, parseYmd } from './calendar';
import { carCost, journeyCost, stayCost, summarize, type CostLine, type CostSummary } from './cost';
import { cumulativeDistances, haversine } from './geo';
import { RuleIndex } from './rules';
import { daylightAt, seasonWarnings, type Daylight, type SeasonWarning } from './season';
import type { Proposal } from './selection';
import { cumulativeHours, splitStages, type Stage } from './stages';
import { TransitIndex, type Journey, type Target } from './transit';
import { analyzeStageWater, isWater, poisAlongRoute, type PoiOnRoute, type StageWater } from './water';
import type { Params, Settings } from '../state/store';

export interface AccessCandidate {
  stop: number;
  name: string;
  walkMin: number;
}

export interface TransportPlan {
  /** Horaires publiés pour la date de départ et le dernier jour ? */
  outboundKnown: boolean;
  returnKnown: boolean;
  outbound: Journey | null;
  returns: Journey[];
  /** Retour retenu (dernier possible). */
  chosenReturn: Journey | null;
  startAccess: AccessCandidate[];
  endAccess: AccessCandidate[];
  notes: string[];
}

export interface PlanResult {
  dates: Date[];
  daylight: Daylight[];
  stages: Stage[];
  water: StageWater[];
  waterOnRoute: PoiOnRoute[];
  usefulPois: PoiOnRoute[];
  transport: TransportPlan | null;
  firstStartHour: number;
  lastDeadlineHour: number;
  cost: CostSummary;
  warnings: SeasonWarning[];
  maxEle: number;
}

const WALK_KMH = 4.5;

/** Arrêts de transport proches d'un point du tracé (accès et distance de marche). */
export function accessNear(transit: TransitData, point: readonly number[], radiusM = 2000): AccessCandidate[] {
  const out: AccessCandidate[] = [];
  transit.stops.forEach((s, i) => {
    const d = haversine(point, [s[1], s[2]]);
    if (d <= radiusM) out.push({ stop: i, name: s[0], walkMin: Math.round(((d * 1.3) / 1000 / WALK_KMH) * 60) });
  });
  return out.sort((a, b) => a.walkMin - b.walkMin).slice(0, 12);
}

/** Arrêts correspondant à une gare de départ (même code UIC, sinon à moins de 600 m). */
export function originStops(transit: TransitData, station: Station): number[] {
  const byUic = transit.stops.map((s, i) => (s[3] === station.uic ? i : -1)).filter((i) => i >= 0);
  if (byUic.length) return byUic;
  return transit.stops.map((s, i) => (haversine([station.lon, station.lat], [s[1], s[2]]) < 600 ? i : -1)).filter((i) => i >= 0);
}

export function planTransport(
  transit: TransitData,
  station: Station,
  start: readonly number[],
  end: readonly number[],
  dates: Date[],
): TransportPlan {
  const idx = new TransitIndex(transit);
  const origins = originStops(transit, station);
  const startAccess = accessNear(transit, start);
  const endAccess = accessNear(transit, end);
  const notes: string[] = [];
  const d0 = idx.dayIndex(dates[0]);
  const dN = idx.dayIndex(dates[dates.length - 1]);
  const plan: TransportPlan = { outboundKnown: d0 >= 0, returnKnown: dN >= 0, outbound: null, returns: [], chosenReturn: null, startAccess, endAccess, notes };
  if (!origins.length) {
    notes.push(`Horaires non préparés pour la gare « ${station.name} » dans ce massif : choisissez une grande gare (préfecture, gare TGV).`);
    return plan;
  }
  if (!startAccess.length) notes.push('Aucun arrêt de transport en commun à moins de 2 km du départ.');
  if (!endAccess.length) notes.push("Aucun arrêt de transport en commun à moins de 2 km de l'arrivée.");
  const end_ = idx.horizonEnd().toLocaleDateString('fr-FR');
  if (d0 < 0) notes.push(`Horaires du jour de départ pas encore publiés (données disponibles jusqu'au ${end_}).`);
  if (dN < 0) notes.push(`Horaires du dernier jour pas encore publiés (données disponibles jusqu'au ${end_}).`);
  const toTargets = (a: AccessCandidate[]): Target[] => a.map((x) => ({ stop: x.stop, extra: x.walkMin }));
  if (d0 >= 0 && startAccess.length) {
    plan.outbound = idx.earliestArrival(d0, origins, 4 * 60, toTargets(startAccess));
    if (!plan.outbound) notes.push("Aucun trajet aller trouvé ce jour-là : essayez un autre jour ou partez la veille.");
  }
  if (dN >= 0 && endAccess.length) {
    // Le départ du retour se fait depuis l'arrêt : la marche jusqu'à l'arrêt est retranchée de l'heure limite.
    plan.returns = idx.returnOptions(dN, toTargets(endAccess), origins, 6 * 60);
    plan.chosenReturn = plan.returns.at(-1) ?? null;
    if (!plan.chosenReturn) notes.push('Aucun retour trouvé le dernier jour : prévoyez une nuit de plus ou un autre jour.');
  }
  return plan;
}

export function computePlan(
  proposal: Proposal,
  pois: Poi[],
  rules: RuleIndex,
  transit: TransitData | null,
  fares: FaresData | null,
  station: Station | null,
  params: Params,
  settings: Settings,
  alpine: boolean,
): PlanResult {
  const coords = proposal.coords;
  const start = coords[0];
  const end = coords[coords.length - 1];
  const n = Math.max(1, params.days);
  const d0 = parseYmd(params.date);
  const dates = Array.from({ length: n }, (_, i) => addDays(d0, i));
  const mid = coords[Math.floor(coords.length / 2)];
  const daylight = dates.map((d) => daylightAt(d, mid[1], mid[0]));

  // Transports.
  let transport: TransportPlan | null = null;
  let firstStartHour = settings.defaultStartHour;
  let lastDeadlineHour = settings.defaultDeadlineHour;
  const costLines: CostLine[] = [];
  if (!params.car && station && transit) {
    transport = planTransport(transit, station, start, end, dates);
    if (transport.outbound) firstStartHour = (transport.outbound.arriveAtTarget + settings.transferMarginMin) / 60;
    const ret = transport.chosenReturn;
    if (ret) {
      const walk = transport.endAccess.find((a) => a.stop === ret.legs.find((l) => l.type === 'ride')?.from)?.walkMin ?? 15;
      lastDeadlineHour = (ret.depart - walk - settings.transferMarginMin) / 60;
    }
    costLines.push(...journeyCost(transport.outbound, transit, fares, settings.cost.discountPct, 'Aller'));
    costLines.push(...journeyCost(transport.chosenReturn, transit, fares, settings.cost.discountPct, 'Retour'));
    if (!transport.outbound) costLines.push({ label: 'Transport aller', min: null, max: null, detail: 'Trajet non trouvé dans les horaires ouverts : voir le site officiel', estimate: true, link: { label: 'SNCF Connect', url: 'https://www.sncf-connect.com/' } });
    if (!transport.chosenReturn) costLines.push({ label: 'Transport retour', min: null, max: null, detail: 'Trajet non trouvé dans les horaires ouverts : voir le site officiel', estimate: true, link: { label: 'SNCF Connect', url: 'https://www.sncf-connect.com/' } });
  } else if (params.car && station) {
    const crowKm = haversine([station.lon, station.lat], start) / 1000;
    const driveH = (crowKm * settings.cost.roadFactor) / 70;
    firstStartHour = Math.max(settings.defaultStartHour, 6.5 + driveH + 0.25);
    costLines.push(...carCost(crowKm, n, settings.cost));
  }
  costLines.push(...stayCost(n, settings.cost));

  // Étapes.
  const stages = splitStages(coords, pois, rules.ruleAt, {
    days: n,
    maxKmPerDay: settings.maxKmPerDay,
    maxGainPerDay: settings.maxGainPerDay,
    pace: settings.pace,
    waterRadiusM: settings.bivouacWaterRadiusM,
    hutAvoidM: settings.hutAvoidM,
    firstStartHour,
    lastDeadlineHour,
    daylight: daylight.map((d) => ({ sunrise: d.sunrise, sunset: d.sunset })),
    sunsetMarginH: 1,
  });

  // Eau et points utiles.
  const cum = cumulativeDistances(coords);
  const hrs = cumulativeHours(coords, settings.pace);
  const waterOnRoute = poisAlongRoute(coords, pois.filter(isWater), settings.water.bufferM, cum);
  const usefulPois = poisAlongRoute(coords, pois.filter((p) => !isWater(p) && p.kind !== 'parking'), settings.poiBufferM, cum);
  const water = stages.map((s, i) => {
    const prev = stages[i - 1]?.bivouac;
    const startsWithWater = i === 0 ? true : Boolean(prev?.water);
    const endsWithWater = i === stages.length - 1 ? true : Boolean(s.bivouac?.water);
    return analyzeStageWater(coords, waterOnRoute, s.from, s.to, startsWithWater, endsWithWater, i === stages.length - 1, settings.pace, settings.water, cum, hrs);
  });

  const maxEle = Math.max(...coords.map((c) => c[2] ?? 0));
  const warnings = seasonWarnings(dates, maxEle, alpine, Math.min(...daylight.map((d) => d.hours)));
  // Proposition d'ajustement quand la marche dépasse le temps disponible (jour, transports).
  const need = stages.reduce((s, x) => s + x.hours, 0);
  const have = stages.reduce((s, x) => s + x.availableHours, 0);
  if (need > have + 0.25) {
    const fix = [`ajouter ${Math.max(1, Math.ceil((need - have) / 7))} jour(s)`, 'partir la veille au soir', 'choisir un tronçon plus court'];
    if (!params.car && transport?.chosenReturn) fix.push('rentrer le lendemain du dernier jour');
    warnings.unshift({ level: 'warn', text: `Il manque environ ${(need - have).toFixed(1).replace('.', ',')} h de marche par rapport au temps disponible (heures de jour, arrivée et dernier retour en transport). Ajustements possibles : ${fix.join(', ')}.` });
  }
  // Horaires répétés depuis un jeu de données expiré : à vérifier auprès du transporteur.
  const used = [transport?.outbound, transport?.chosenReturn].flatMap((j) => j?.legs ?? []);
  const stale = new Map<string, string>();
  for (const l of used) {
    if (l.type !== 'ride' || !transit) continue;
    const [name, , feed] = transit.agencies[transit.routes[l.route][0]];
    const until = transit.indicative?.[feed];
    if (until) stale.set(name, `${until.slice(6, 8)}/${until.slice(4, 6)}/${until.slice(0, 4)}`);
  }
  for (const [name, until] of stale) {
    warnings.unshift({ level: 'warn', text: `Horaires ${name} indicatifs : les données ouvertes publiées s'arrêtent au ${until}, la dernière semaine connue est répétée. Vérifier les horaires réels sur le site du transporteur.` });
  }
  return { dates, daylight, stages, water, waterOnRoute, usefulPois, transport, firstStartHour, lastDeadlineHour, cost: summarize(costLines, n), warnings, maxEle };
}
