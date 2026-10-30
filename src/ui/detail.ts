// Rendu HTML du détail d'une sortie. Toutes les valeurs dynamiques sont échappées.

import type { TransitData } from '../data/types';
import { formatEuro, type CostSummary } from '../lib/cost';
import type { PlanResult } from '../lib/plan';
import type { Proposal } from '../lib/selection';
import { formatDuration } from '../lib/timing';
import { fmtTime, type Journey } from '../lib/transit';
import { KIND_LABEL } from './map';

export const esc = (v: unknown): string =>
  String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

/** Lien sortant sûr (http/https uniquement), sans référent. */
export function extLink(url: string | undefined, label: string): string {
  if (!url || !/^https?:\/\//i.test(url)) return esc(label);
  return `<a href="${esc(url)}" target="_blank" rel="noopener noreferrer">${esc(label)}</a>`;
}

const km = (m: number) => `${(m / 1000).toFixed(1).replace('.', ',')} km`;
const hh = (h: number) => `${String(Math.floor(h)).padStart(2, '0')}:${String(Math.round((h % 1) * 60) % 60).padStart(2, '0')}`;
const dateFr = (d: Date) => d.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });
const POT: Record<string, string> = { yes: '<span class="pot-yes">potable</span>', no: '<span class="pot-no">non potable</span>', unknown: '<span class="pot-unknown">potabilité inconnue</span>' };

function journeyHtml(j: Journey, t: TransitData): string {
  return j.legs
    .map((l) => {
      if (l.type === 'walk') return `<div class="leg">🚶 ${l.minutes} min à pied : ${esc(t.stops[l.from][0])} → ${esc(t.stops[l.to][0])}</div>`;
      const [a, short] = t.routes[l.route];
      return `<div class="leg">🚆 <b>${fmtTime(l.dep)}</b> ${esc(t.stops[l.from][0])} → <b>${fmtTime(l.arr)}</b> ${esc(t.stops[l.to][0])} <span class="hint">(${esc(t.agencies[a][0])} ${esc(short)})</span></div>`;
    })
    .join('');
}

export function costHtml(c: CostSummary, days: number): string {
  const rows = c.lines
    .map(
      (l) => `<tr><td>${esc(l.label)}${l.estimate ? '<span class="tag">estimation</span>' : ''}<div class="hint">${esc(l.detail)}${l.source ? ` · ${esc(l.source)}` : ''}${l.link ? ` · ${extLink(l.link.url, l.min === null ? `Prix réel et réservation : ${l.link.label}` : `Réserver : ${l.link.label}`)}` : ''}</div></td>
      <td class="num">${l.min === null ? '—' : l.min === l.max ? formatEuro(l.min) : `${formatEuro(l.min)} – ${formatEuro(l.max!)}`}</td></tr>`,
    )
    .join('');
  const total = c.min === c.max ? formatEuro(c.min) : `${formatEuro(c.min)} – ${formatEuro(c.max)}`;
  const perDay = c.perDayMin === c.perDayMax ? formatEuro(c.perDayMin) : `${formatEuro(c.perDayMin)} – ${formatEuro(c.perDayMax)}`;
  return `<table class="cost"><thead><tr><th>Poste</th><th class="num">Montant</th></tr></thead><tbody>${rows}</tbody>
    <tfoot><tr><td>Total${c.incomplete ? ' (incomplet : postes sans prix ouvert)' : ''}</td><td class="num">${total}</td></tr>
    <tr><td>Par jour (${days} j)</td><td class="num">${perDay}</td></tr></tfoot></table>
    <p class="hint">Les prix de transport sont des estimations issues de grilles ouvertes ; seul le site officiel du transporteur fait foi.</p>`;
}

export function detailHtml(p: Proposal, plan: PlanResult, transit: TransitData | null, departName: string, car: boolean): string {
  const r = p.route;
  const osm = `https://www.openstreetmap.org/relation/${r.osmRelation}`;
  const head = `
  <div class="card" id="roadbook">
    <h2>${esc(r.name)}</h2>
    <p>${esc(p.explanation)}</p>
    <div class="stats"><span>Distance <b>${km(p.lengthM)}</b></span><span>D+ <b>${p.gain} m</b></span><span>D− <b>${p.loss} m</b></span><span>Marche <b>${formatDuration(p.hours)}</b></span><span>Point haut <b>${Math.round(plan.maxEle)} m</b></span></div>
    ${r.osmRelation > 0 ? `<p class="hint">Tracé : ${extLink(osm, 'relation OpenStreetMap')}${r.wikipedia ? ` · ${extLink(`https://fr.wikipedia.org/wiki/${encodeURIComponent(r.wikipedia)}`, 'Wikipédia')}` : ''}${r.clipped ? ' · section située dans le massif' : ''}</p>
    <details><summary>Pourquoi cet itinéraire ?</summary><ul class="compact">${r.score.details.map((d) => `<li>${esc(d)}</li>`).join('')}<li>Score : notoriété ${Math.round(r.score.notoriety * 100)} %, accessibilité ${Math.round(r.score.access * 100)} % (pondération 60 / 40, sources ouvertes uniquement)</li></ul></details>` : ''}
    <div class="btn-row no-print">
      <button type="button" data-act="gpx">Export GPX complet</button>
      <button type="button" data-act="gpx-stages">GPX par étape</button>
      <button type="button" data-act="print">Imprimer la feuille de route</button>
      <button type="button" data-act="save">Sauvegarder</button>
    </div>
  </div>`;

  const warn = `
  <div class="card">
    <h3>À savoir avant de partir</h3>
    ${plan.warnings.map((w) => `<div class="alert ${w.level === 'info' ? 'info' : ''}">${esc(w.text)}${w.link ? ` ${extLink(w.link.url, w.link.label)}` : ''}</div>`).join('')}
    <ul class="compact">
      <li>L'eau des sources et ruisseaux est à <b>traiter ou filtrer</b>.</li>
      <li>Montagne : consulter la ${extLink('https://meteofrance.com/meteo-montagne', 'météo montagne officielle')} et le ${extLink('https://meteofrance.com/meteo-montagne', "bulletin d'estimation du risque d'avalanche")} ; prévenir un proche de son itinéraire.</li>
      <li>Règles de bivouac indicatives : vérifier auprès du parc ou de la mairie.</li>
      <li>Prix et horaires de transport indicatifs : vérifier sur le site officiel avant de partir (services réduits ou supprimés possibles : saison, travaux, grèves).</li>
    </ul>
  </div>`;

  let transport = '';
  if (car) {
    transport = `<div class="card"><h3>Accès en voiture</h3><p>Départ estimé de la marche à ${hh(plan.firstStartHour)} (route estimée à 70 km/h de moyenne depuis ${esc(departName || 'votre point de départ')}).</p></div>`;
  } else if (plan.transport && transit) {
    const t = plan.transport;
    const out = t.outbound
      ? `<p><b>Aller, ${dateFr(plan.dates[0])}</b> : arrivée au départ du sentier vers ${fmtTime(t.outbound.arriveAtTarget)}.</p>${journeyHtml(t.outbound, transit)}`
      : '<p><b>Aller</b> : aucun trajet trouvé.</p>';
    const ret = t.chosenReturn
      ? `<p><b>Retour, ${dateFr(plan.dates[plan.dates.length - 1])}</b> : dernier retour possible au départ de ${fmtTime(t.chosenReturn.depart)} (arrivée ${fmtTime(t.chosenReturn.arrive)}). Terminer la marche au plus tard vers ${hh(plan.lastDeadlineHour)} (trajet à pied jusqu'à l'arrêt et marge compris).</p>${journeyHtml(t.chosenReturn, transit)}
         ${t.returns.length > 1 ? `<details><summary>Autres retours ce jour-là (${t.returns.length - 1})</summary>${t.returns.slice(0, -1).map((j) => `<div class="leg">${fmtTime(j.depart)} → ${fmtTime(j.arrive)}</div>`).join('')}</details>` : ''}`
      : '<p><b>Retour</b> : aucun trajet trouvé.</p>';
    transport = `<div class="card"><h3>Transports en commun (horaires théoriques)</h3>
      ${t.notes.map((n) => `<div class="alert">${esc(n)}</div>`).join('')}
      ${out}${ret}
      <p class="hint">Arrêts proches du départ : ${t.startAccess.slice(0, 4).map((a) => `${esc(a.name)} (${a.walkMin} min)`).join(', ') || '—'}.<br>Arrêts proches de l'arrivée : ${t.endAccess.slice(0, 4).map((a) => `${esc(a.name)} (${a.walkMin} min)`).join(', ') || '—'}.</p>
      <p class="hint">Réservation et prix réels : ${extLink('https://www.sncf-connect.com/', 'SNCF Connect')} · ${extLink('https://www.flixbus.fr/', 'FlixBus')} · ${extLink('https://www.blablacar.fr/bus', 'BlaBlaCar Bus')} · réseaux régionaux via ${extLink('https://transport.data.gouv.fr/', 'transport.data.gouv.fr')}.</p></div>`;
  } else {
    transport = `<div class="card"><h3>Transports</h3><p class="hint">Choisissez une gare de départ pour calculer les horaires et le coût du trajet.</p></div>`;
  }

  const stages = plan.stages
    .map((s, i) => {
      const w = plan.water[i];
      const b = s.bivouac;
      const pois = plan.usefulPois.filter((u) => u.along >= s.from && u.along <= s.to);
      const isLast = i === plan.stages.length - 1;
      return `<div class="stage" id="stage-${i}">
        <h4>Jour ${i + 1} · ${dateFr(plan.dates[i])}</h4>
        <div class="stats"><span><b>${km(s.distance)}</b></span><span>D+ <b>${s.gain} m</b></span><span>D− <b>${s.loss} m</b></span><span>≈ <b>${formatDuration(s.hours)}</b></span><span>départ ${hh(s.startHour)} · ${s.availableHours.toFixed(1).replace('.', ',')} h disponibles</span></div>
        ${s.issues.map((t) => `<div class="alert danger">${esc(t)}</div>`).join('')}
        ${
          isLast
            ? '<p>Arrivée.</p>'
            : b
              ? `<p>⛺ <b>Bivouac ${i + 1}</b> : km ${(b.along / 1000).toFixed(1).replace('.', ',')}, ${Math.round(b.ele)} m${b.water ? ` · eau : ${esc(b.water.name ?? KIND_LABEL[b.water.kind])} à ${Math.round(b.waterDistance)} m du tracé (${POT[b.water.potable ?? 'unknown']})` : ' · <b>pas d’eau à proximité</b>'}${b.nearHut ? ` · ${esc(b.nearHut.name ?? 'refuge')} à ${Math.round(b.hutDistance)} m` : ''}</p>
                 <div class="rule"><b>${esc(b.rule.title)}</b>${b.rule.hours ? ` (${esc(b.rule.hours)})` : ''}<br>${esc(b.rule.text)}<div class="src">Source : ${extLink(b.rule.sourceUrl, b.rule.sourceName)}${b.rule.checked ? ` · vérifié le ${esc(b.rule.checked)}` : ''}</div></div>`
              : ''
        }
        <p><b>Eau</b> : plus long tronçon sans eau ${km(w.longestDryM)} (≈ ${formatDuration(w.longestDryH)}) · porter <b>${String(w.litersToCarry).replace('.', ',')} L</b>${w.waterAtBivouac || isLast ? '' : ' (dont l’eau du soir et du matin)'}.</p>
        ${w.alert ? `<div class="alert">Tronçon de plus de ${km(w.longestDryM)} sans point d'eau connu à partir du km ${(w.longestDryFrom / 1000).toFixed(1).replace('.', ',')}.</div>` : ''}
        ${w.points.length ? `<ul class="compact">${w.points.map((x) => `<li>💧 km ${(x.along / 1000).toFixed(1).replace('.', ',')} · ${esc(x.poi.name ?? KIND_LABEL[x.poi.kind])}${x.poi.ele ? ` · ${x.poi.ele} m` : ''} · ${POT[x.poi.potable ?? 'unknown']}${x.poi.seasonal ? ' · saisonnier' : ''}${x.offset > 50 ? ` · à ${Math.round(x.offset)} m` : ''}</li>`).join('')}</ul>` : '<p class="hint">Aucun point d’eau connu sur cette étape.</p>'}
        ${pois.length ? `<details><summary>Points utiles (${pois.length})</summary><ul class="compact">${pois.map((x) => `<li>km ${(x.along / 1000).toFixed(1).replace('.', ',')} · ${esc(KIND_LABEL[x.poi.kind])} ${esc(x.poi.name ?? '')}${x.poi.capacity ? ` · ${x.poi.capacity} place${x.poi.capacity > 1 ? 's' : ''}` : ''}${x.poi.opening ? ` · ${esc(x.poi.opening)}` : ''} · à ${Math.round(x.offset)} m ${x.poi.url ? extLink(x.poi.url, '(fiche)') : ''}</li>`).join('')}</ul></details>` : ''}
      </div>`;
    })
    .join('');

  return `${head}${warn}${transport}
  <div class="card"><h3>Étapes et bivouacs</h3>${stages}</div>
  <div class="card"><h3>Coût depuis ${esc(departName || 'le point de départ')}</h3>${costHtml(plan.cost, plan.stages.length)}</div>
  <div class="card weather no-print"><h3>Météo en altitude</h3>
    <p class="hint">La météo est chargée seulement si vous le demandez. L'appel part de votre navigateur vers Open-Meteo, qui voit donc votre adresse IP.</p>
    <button type="button" data-act="weather">Charger la météo</button><div id="weather-out"></div></div>
  <div class="card no-print"><h3>Checklist matériel</h3><div id="checklist"></div></div>`;
}
