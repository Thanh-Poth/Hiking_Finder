import './style.css';
import { getMassif, MASSIFS } from './data/massifs';
import { loadDem, loadGlobal, loadMassif, type GlobalData, type MassifData } from './data/load';
import type { RouteData, Station } from './data/types';
import { demGrid, demSample, fillUnknown } from './lib/dem';
import { cumulativeDistances, elevationGainLoss, haversine, resample, snapToLine } from './lib/geo';
import { buildGpx, gpxToLine, parseGpx } from './lib/gpx';
import { computePlan, type PlanResult } from './lib/plan';
import { RuleIndex } from './lib/rules';
import { proposeItineraries, type Proposal } from './lib/selection';
import { walkingHours } from './lib/timing';
import { defaultParams, isoDate, kvGet, kvSet, mergeSettings, readHash, writeHash, type Params, type SavedItinerary, type Settings } from './state/store';
import { detailHtml, esc, extLink } from './ui/detail';
import { createMap } from './ui/map';
import { renderProfile } from './ui/profile';
import { fetchWeather, type WeatherPoint } from './ui/weather';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

// ---------------------------------------------------------------- état
let params: Params = readHash(defaultParams());
let settings: Settings = mergeSettings(undefined);
let global: GlobalData = { stations: [], fares: null, rules: {}, sources: [] };
let data: MassifData | null = null;
let rules = new RuleIndex(null, {});
let proposals: Proposal[] = [];
let current: { proposal: Proposal; plan: PlanResult } | null = null;
let custom: Proposal | null = null;
let drawing = false;

const map = createMap($('map'));

// ---------------------------------------------------------------- thème
const media = matchMedia('(prefers-color-scheme: dark)');
let theme: 'auto' | 'light' | 'dark' = 'auto';
function applyTheme() {
  if (theme === 'auto') delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = theme;
  map.setDark(theme === 'dark' || (theme === 'auto' && media.matches));
}
media.addEventListener('change', applyTheme);
$('btn-theme').addEventListener('click', () => {
  const dark = theme === 'dark' || (theme === 'auto' && media.matches);
  theme = dark ? 'light' : 'dark';
  applyTheme();
  void kvSet('theme', theme);
});

// ---------------------------------------------------------------- formulaire
const form = $<HTMLFormElement>('form');
const massifSel = $<HTMLSelectElement>('f-massif');
massifSel.innerHTML = MASSIFS.map((m) => `<option value="${m.id}">${esc(m.name)}</option>`).join('');
const departInput = $<HTMLInputElement>('f-depart');
const WEEKDAYS = ['lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi', 'dimanche'];
$('f-weekdays').innerHTML = WEEKDAYS.map((d, i) => `<label><input type="radio" name="wd" value="${i}" />${d.slice(0, 3)}.</label>`).join('');

function stationByUic(uic: string): Station | null {
  return global.stations.find((s) => s.uic === uic) ?? null;
}

function syncForm() {
  massifSel.value = params.massif;
  departInput.value = stationByUic(params.depart)?.name ?? '';
  ($<HTMLInputElement>('f-car')).checked = params.car;
  ($<HTMLInputElement>('f-days')).value = String(params.days);
  ($<HTMLInputElement>('f-date')).value = params.date;
  for (const r of form.querySelectorAll<HTMLInputElement>('input[name=mode]')) r.checked = r.value === params.mode;
}

form.addEventListener('submit', (e) => e.preventDefault());
form.addEventListener('change', (e) => {
  const t = e.target as HTMLInputElement;
  if (t.closest('#advanced-body')) return;
  if (t.name === 'wd') {
    const want = Number(t.value);
    const d = new Date();
    d.setDate(d.getDate() + 1);
    while ((d.getDay() + 6) % 7 !== want) d.setDate(d.getDate() + 1);
    params.date = isoDate(d);
    $<HTMLInputElement>('f-date').value = params.date;
  }
  if (t.name === 'date') for (const r of form.querySelectorAll<HTMLInputElement>('input[name=wd]')) r.checked = false;
  const massifChanged = massifSel.value !== params.massif;
  params.massif = massifSel.value;
  const st = global.stations.find((s) => s.name.toLowerCase() === departInput.value.trim().toLowerCase());
  params.depart = st?.uic ?? '';
  params.car = $<HTMLInputElement>('f-car').checked;
  params.days = Math.min(10, Math.max(1, Math.round(Number($<HTMLInputElement>('f-days').value) || 1)));
  params.date = $<HTMLInputElement>('f-date').value || params.date;
  params.mode = (form.querySelector<HTMLInputElement>('input[name=mode]:checked')?.value as Params['mode']) ?? 'traverse';
  if (massifChanged) {
    params.pick = '';
    custom = null;
    void loadCurrentMassif(true);
  } else schedule();
});
departInput.addEventListener('input', () => {
  if (global.stations.some((s) => s.name === departInput.value)) form.dispatchEvent(new Event('change'));
});

// Réglages avancés : générés depuis un schéma, enregistrés en IndexedDB.
type Path = [keyof Settings, string?];
const ADVANCED: { group: string; items: [Path, string, number, number, number][] }[] = [
  { group: 'Effort', items: [[['maxKmPerDay'], 'Distance max / jour (km)', 3, 50, 1], [['maxGainPerDay'], 'D+ max / jour (m)', 100, 3000, 50]] },
  { group: 'Rythme (formule DIN 33466)', items: [[['pace', 'flatKmh'], 'Vitesse à plat (km/h)', 2, 7, 0.1], [['pace', 'upMh'], 'Montée (m/h)', 150, 700, 10], [['pace', 'downMh'], 'Descente (m/h)', 200, 1000, 10]] },
  { group: 'Bivouac', items: [[['bivouacWaterRadiusM'], 'Eau à moins de (m)', 50, 2000, 50], [['hutAvoidM'], "S'écarter des refuges (m)", 0, 2000, 50]] },
  { group: 'Eau', items: [[['water', 'bufferM'], 'Tampon eau autour du tracé (m)', 50, 1000, 50], [['water', 'litersPerHour'], 'Consommation (L/h)', 0.2, 1.5, 0.05], [['water', 'bivouacLiters'], 'Eau au bivouac sans source (L)', 0, 5, 0.5], [['water', 'alertKm'], 'Alerte tronçon sec (km)', 2, 30, 1]] },
  { group: 'Points utiles', items: [[['poiBufferM'], 'Tampon refuges, campings… (m)', 100, 5000, 100]] },
  { group: 'Coût', items: [[['cost', 'discountPct'], 'Réduction transport (%)', 0, 100, 1], [['cost', 'foodPerDay'], 'Ravitaillement / jour (€)', 0, 100, 1], [['cost', 'carCostPerKm'], 'Voiture (€ / km)', 0, 1, 0.01], [['cost', 'roadFactor'], 'Facteur route / vol d’oiseau', 1, 2, 0.05], [['cost', 'parkingPerDay'], 'Parking (€ / jour)', 0, 50, 0.5], [['cost', 'paidNights'], 'Nuits en refuge / camping', 0, 9, 1], [['cost', 'pricePerNight'], 'Prix par nuit payante (€)', 0, 150, 1]] },
  { group: 'Horaires', items: [[['defaultStartHour'], 'Départ de marche sans transport (h)', 5, 14, 0.25], [['defaultDeadlineHour'], 'Heure limite sans transport (h)', 12, 22, 0.25], [['transferMarginMin'], 'Marge transport ↔ marche (min)', 0, 90, 5]] },
];
const getPath = (p: Path): number => (p[1] ? (settings[p[0]] as unknown as Record<string, number>)[p[1]] : (settings[p[0]] as unknown as number));
const setPath = (p: Path, v: number) => {
  if (p[1]) (settings[p[0]] as unknown as Record<string, number>)[p[1]] = v;
  else (settings as unknown as Record<string, number>)[p[0]] = v;
};
function renderAdvanced() {
  $('advanced-body').innerHTML =
    ADVANCED.map(
      (g) =>
        `<h4>${esc(g.group)}</h4>` +
        g.items.map(([p, label, min, max, step]) => {
          const id = `adv-${p.join('-')}`;
          return `<div><label for="${id}">${esc(label)}</label><input id="${id}" data-path="${p.join('.')}" type="number" min="${min}" max="${max}" step="${step}" value="${getPath(p)}" /></div>`;
        }).join(''),
    ).join('') + `<div style="grid-column:1/-1"><button type="button" id="btn-reset-adv" class="link">Revenir aux valeurs par défaut</button></div>`;
}
$('advanced-body').addEventListener('change', (e) => {
  const t = e.target as HTMLInputElement;
  if (!t.dataset.path) return;
  const v = Number(t.value);
  if (!Number.isFinite(v)) return;
  setPath(t.dataset.path.split('.') as Path, Math.min(Number(t.max), Math.max(Number(t.min), v)));
  void kvSet('settings', settings);
  schedule();
});
$('advanced-body').addEventListener('click', (e) => {
  if ((e.target as HTMLElement).id !== 'btn-reset-adv') return;
  settings = mergeSettings(undefined);
  void kvSet('settings', settings);
  renderAdvanced();
  schedule();
});

// ---------------------------------------------------------------- données
async function loadCurrentMassif(fit: boolean) {
  const m = getMassif(params.massif) ?? MASSIFS[0];
  params.massif = m.id;
  $('proposals').innerHTML = '<p class="hint">Chargement des données du massif…</p>';
  data = await loadMassif(m.id);
  rules = new RuleIndex(data.protectedAreas, global.rules);
  map.showProtected(data.protectedAreas, global.rules);
  if (fit) map.fitBBox(m.bbox);
  const places = [
    ...data.routes.map((r) => r.name),
    ...data.pois.filter((p) => p.name && (p.kind === 'hut_guarded' || p.kind === 'hut_unguarded')).map((p) => p.name!),
    ...global.stations.filter((s) => s.lon >= m.bbox[0] - 0.3 && s.lon <= m.bbox[2] + 0.3 && s.lat >= m.bbox[1] - 0.3 && s.lat <= m.bbox[3] + 0.3).map((s) => `Gare : ${s.name}`),
  ];
  $('places').innerHTML = [...new Set(places)].slice(0, 800).map((n) => `<option value="${esc(n)}"></option>`).join('');
  schedule();
}

let timer = 0;
function schedule() {
  clearTimeout(timer);
  timer = window.setTimeout(recompute, 120);
}

function recompute() {
  writeHash(params);
  if (!data) return;
  const m = getMassif(params.massif)!;
  proposals = data.routes.length
    ? proposeItineraries(data.routes, { days: params.days, maxKmPerDay: settings.maxKmPerDay, maxGainPerDay: settings.maxGainPerDay, pace: settings.pace, mode: params.mode })
    : [];
  renderProposals();
  let pick: Proposal | undefined;
  if (custom && params.pick === 'custom') pick = custom;
  else pick = proposals.find((p) => p.id === params.pick) ?? proposals[0];
  map.showRoutes(data.routes, pick?.route.id ?? null, (id) => {
    const p = proposals.find((x) => x.route.id === id);
    if (p) select(p.id);
  });
  if (!pick) {
    current = null;
    $('detail').innerHTML = '';
    map.showPois(data.pois.filter((p) => p.kind !== 'parking'), new Set());
    map.showItinerary(null, []);
    renderProfile($('profile'), null, [], []);
    return;
  }
  params.pick = pick.id;
  writeHash(params);
  const station = stationByUic(params.depart);
  const plan = computePlan(pick, data.pois, rules, data.transit, global.fares, station, params, settings, m.alpine);
  current = { proposal: pick, plan };
  $('detail').innerHTML = detailHtml(pick, plan, data.transit, station?.name ?? '', params.car);
  map.showItinerary(pick.coords, plan.stages);
  map.showPois(data.pois.filter((p) => p.kind !== 'parking'), new Set([...plan.waterOnRoute, ...plan.usefulPois].map((x) => x.poi.id)));
  renderProfile($('profile'), pick.coords, plan.stages, plan.waterOnRoute);
  void renderChecklist();
}

function renderProposals() {
  const host = $('proposals');
  if (!data?.routes.length) {
    host.innerHTML = '<p class="hint">Les données de ce massif ne sont pas encore préparées (voir le README : npm run data).</p>';
    return;
  }
  const items = proposals.map(
    (p) => `<button type="button" class="proposal" data-pick="${esc(p.id)}" aria-pressed="${p.id === params.pick}">
      <span class="score">${Math.round(p.score * 100)} %</span><strong>${esc(p.route.name)}</strong><span class="why">${esc(p.explanation)}</span></button>`,
  );
  if (custom) items.unshift(`<button type="button" class="proposal" data-pick="custom" aria-pressed="${params.pick === 'custom'}"><strong>${esc(custom.route.name)}</strong><span class="why">${esc(custom.explanation)}</span></button>`);
  host.innerHTML =
    (items.length ? items.join('') : `<p class="hint">Aucun itinéraire du catalogue ne correspond à ${params.days} jour(s) avec ${settings.maxKmPerDay} km et ${settings.maxGainPerDay} m de D+ maximum par jour. Modifiez le nombre de jours ou les réglages avancés, ou tracez votre itinéraire.</p>`) +
    `<p class="hint">Les ${data.routes.length} itinéraires du massif sont classés par notoriété (réseau GR, Wikipédia) et accessibilité en transport, à partir de sources ouvertes.</p>`;
}

function select(id: string) {
  params.pick = id;
  recompute();
  $('detail').scrollIntoView({ behavior: 'smooth', block: 'start' });
}
$('proposals').addEventListener('click', (e) => {
  const b = (e.target as HTMLElement).closest<HTMLElement>('[data-pick]');
  if (b) select(b.dataset.pick!);
});

// ---------------------------------------------------------------- itinéraire personnel
async function withElevation(line: number[][]): Promise<number[][]> {
  const pts = resample(line, 40);
  const hasEle = line.every((c) => Number.isFinite(c[2]));
  if (hasEle) {
    const cum = cumulativeDistances(line);
    return pts.map((p) => {
      const s = snapToLine(p, line, cum);
      const a = line[s.index];
      const b = line[Math.min(line.length - 1, s.index + 1)];
      return [p[0], p[1], Math.round(a[2] + s.t * (b[2] - a[2]))];
    });
  }
  const m = getMassif(params.massif)!;
  const dem = await loadDem(m.id);
  const g = demGrid(m.bbox, data?.meta?.dem?.step ?? 250);
  const eles = fillUnknown(pts.map((p) => (dem ? demSample(g, dem, p[0], p[1]) : NaN)));
  return pts.map((p, i) => [p[0], p[1], Math.round(eles[i])]);
}

async function setCustom(name: string, line: number[][]) {
  if (line.length < 2) return;
  const coords = (await withElevation(line)) as [number, number, number][];
  const cum = cumulativeDistances(coords);
  const { gain, loss } = elevationGainLoss(coords.map((c) => c[2]), 5);
  const lengthM = cum[cum.length - 1];
  const route: RouteData = {
    id: 'custom',
    name,
    osmRelation: 0,
    loop: haversine(coords[0], coords[coords.length - 1]) < 500,
    lengthM,
    gain,
    loss,
    coords,
    score: { notoriety: 0, access: 0, total: 0, details: [] },
    access: [],
    clipped: false,
  };
  const n = params.days;
  const noEle = !line.every((c) => Number.isFinite(c[2]));
  custom = {
    id: 'custom',
    route,
    kind: 'full',
    start: { along: 0, label: 'départ' },
    end: { along: lengthM, label: 'arrivée' },
    coords,
    lengthM,
    gain,
    loss,
    hours: walkingHours(lengthM, gain, loss, settings.pace),
    fit: 1,
    score: 1,
    explanation: `${n} jour${n > 1 ? 's' : ''}, ${(lengthM / 1000 / n).toFixed(1).replace('.', ',')} km et +${Math.round(gain / n)} m par jour en moyenne (itinéraire personnel${noEle ? ', altitudes approchées sur une grille de 250 m' : ''}).`,
  };
  params.pick = 'custom';
  recompute();
}

$('btn-draw').addEventListener('click', () => {
  drawing = !drawing;
  $('draw-tools').hidden = !drawing;
  $('btn-draw').textContent = drawing ? 'Annuler le tracé' : 'Tracer sur la carte';
  if (drawing) map.startDrawing(() => undefined);
  else map.stopDrawing();
});
$('btn-draw-undo').addEventListener('click', () => map.undoDrawing());
$('btn-draw-done').addEventListener('click', () => {
  const pts = map.stopDrawing();
  drawing = false;
  $('draw-tools').hidden = true;
  $('btn-draw').textContent = 'Tracer sur la carte';
  void setCustom('Mon tracé', pts);
});
$<HTMLInputElement>('f-gpx').addEventListener('change', async (e) => {
  const input = e.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = '';
  if (!file) return;
  try {
    const gpx = parseGpx(await file.text());
    const line = gpxToLine(gpx);
    await setCustom(gpx.name ?? file.name.replace(/\.gpx$/i, ''), line);
    const lons = line.map((c) => c[0]);
    const lats = line.map((c) => c[1]);
    map.fitBBox([Math.min(...lons), Math.min(...lats), Math.max(...lons), Math.max(...lats)]);
  } catch (err) {
    alert(`Import impossible : ${(err as Error).message}`);
  }
});

// ---------------------------------------------------------------- actions du détail
function download(name: string, content: string, type = 'application/gpx+xml') {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const a = Object.assign(document.createElement('a'), { href: url, download: name });
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
const slug = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase() || 'itineraire';

$('detail').addEventListener('click', async (e) => {
  const act = (e.target as HTMLElement).closest<HTMLElement>('[data-act]')?.dataset.act;
  if (!act || !current) return;
  const { proposal: p, plan } = current;
  const cum = cumulativeDistances(p.coords);
  const wpts = [
    ...plan.stages.slice(0, -1).map((s, i) => ({ lon: s.bivouac?.lon ?? 0, lat: s.bivouac?.lat ?? 0, ele: s.bivouac?.ele, name: `Bivouac ${i + 1}` })).filter((w) => w.lon),
    ...plan.waterOnRoute.map((w) => ({ lon: w.poi.lon, lat: w.poi.lat, ele: w.poi.ele, name: `Eau : ${w.poi.name ?? (w.poi.kind === 'spring' ? 'source' : "point d'eau")}` })),
  ];
  if (act === 'gpx') download(`${slug(p.route.name)}.gpx`, buildGpx([{ name: p.route.name, coords: p.coords }], wpts, p.route.name));
  if (act === 'gpx-stages') {
    const tracks = plan.stages.map((s, i) => ({ name: `Jour ${i + 1}`, coords: p.coords.filter((_, k) => cum[k] >= s.from - 1 && cum[k] <= s.to + 1) }));
    download(`${slug(p.route.name)}-etapes.gpx`, buildGpx(tracks, wpts, `${p.route.name} (par étape)`));
  }
  if (act === 'print') window.print();
  if (act === 'save') {
    const saved = (await kvGet<SavedItinerary[]>('saved')) ?? [];
    saved.unshift({ id: String(Date.now()), name: `${p.route.name} · ${params.days} j · ${params.date}`, savedAt: new Date().toISOString(), params: { ...params }, custom: p.id === 'custom' ? p.coords : null });
    await kvSet('saved', saved.slice(0, 30));
    renderSaved();
    (e.target as HTMLElement).textContent = 'Sauvegardé ✓';
  }
  if (act === 'weather') {
    const out = $('weather-out');
    out.textContent = 'Chargement…';
    const points: WeatherPoint[] = [];
    plan.stages.forEach((s, i) => {
      let hi = -1;
      for (let k = 0; k < p.coords.length; k++) if (cum[k] >= s.from && cum[k] <= s.to && (hi < 0 || p.coords[k][2] > p.coords[hi][2])) hi = k;
      if (hi >= 0) points.push({ label: `Jour ${i + 1} – point haut`, lon: p.coords[hi][0], lat: p.coords[hi][1], ele: p.coords[hi][2], day: i });
      if (s.bivouac) points.push({ label: `Bivouac ${i + 1}`, lon: s.bivouac.lon, lat: s.bivouac.lat, ele: s.bivouac.ele, day: i });
    });
    try {
      const { rows, beyond } = await fetchWeather(points, plan.dates[0]);
      const f = (v: number | undefined, u: string) => (v === undefined || v === null ? '—' : `${Math.round(v)} ${u}`);
      out.innerHTML =
        (rows.length
          ? `<table><thead><tr><th>Lieu</th><th>Date</th><th>Min / max</th><th>Pluie</th><th>Rafales</th><th>Isotherme 0 °C</th></tr></thead><tbody>${rows
              .map((r) => `<tr><td>${esc(r.point.label)} (${Math.round(r.point.ele)} m)</td><td>${esc(r.date.slice(5))}</td><td>${f(r.tmin, '°C')} / ${f(r.tmax, '°C')}</td><td>${r.precip === undefined ? '—' : `${r.precip.toFixed(1)} mm`}</td><td>${f(r.gusts, 'km/h')}</td><td>${f(r.freezing, 'm')}</td></tr>`)
              .join('')}</tbody></table>`
          : '') +
        (beyond ? `<p class="hint">${beyond} point(s) au-delà de la limite de prévision (16 jours).</p>` : '') +
        `<p class="hint">Données ${extLink('https://open-meteo.com/', 'Open-Meteo')} (CC BY 4.0), modèle à l'altitude indiquée. Consulter aussi la ${extLink('https://meteofrance.com/meteo-montagne', 'météo montagne Météo-France')}.</p>`;
    } catch (err) {
      out.textContent = `Météo indisponible : ${(err as Error).message}`;
    }
  }
});

// ---------------------------------------------------------------- checklist (locale)
const DEFAULT_CHECKLIST = ['Tente ou tarp', 'Sac de couchage', 'Matelas', 'Réchaud, gaz, briquet', 'Popote et couverts', 'Filtre ou pastilles pour l’eau', 'Gourdes / poche à eau', 'Frontale et piles', 'Trousse de secours', 'Couverture de survie', 'Carte, boussole', 'Téléphone et batterie', 'Veste de pluie', 'Doudoune', 'Bonnet et gants', 'Crème solaire, lunettes', 'Sacs à déchets', 'Truelle (toilettes)', 'Papiers, argent liquide'];
async function renderChecklist() {
  const host = document.getElementById('checklist');
  if (!host) return;
  const list = (await kvGet<{ label: string; done: boolean }[]>('checklist')) ?? DEFAULT_CHECKLIST.map((label) => ({ label, done: false }));
  host.innerHTML = `<ul class="checklist">${list.map((it, i) => `<li><label class="check"><input type="checkbox" data-ck="${i}" ${it.done ? 'checked' : ''}/> ${esc(it.label)}</label><button type="button" class="link" data-ck-del="${i}" aria-label="Retirer ${esc(it.label)}">retirer</button></li>`).join('')}</ul>
    <form id="ck-add" class="btn-row"><label class="sr-only" for="ck-new">Nouvel élément</label><input id="ck-new" placeholder="Ajouter un élément" maxlength="80" /><button>Ajouter</button></form>
    <button type="button" class="link" data-ck-reset>Tout décocher</button>`;
  const save = (l: typeof list) => kvSet('checklist', l).then(renderChecklist);
  host.onchange = (e) => {
    const i = (e.target as HTMLElement).dataset.ck;
    if (i !== undefined) {
      list[Number(i)].done = (e.target as HTMLInputElement).checked;
      void kvSet('checklist', list);
    }
  };
  host.onclick = (e) => {
    const t = e.target as HTMLElement;
    if (t.dataset.ckDel !== undefined) void save(list.filter((_, k) => k !== Number(t.dataset.ckDel)));
    if (t.dataset.ckReset !== undefined) void save(list.map((x) => ({ ...x, done: false })));
  };
  $('ck-add').addEventListener('submit', (e) => {
    e.preventDefault();
    const v = $<HTMLInputElement>('ck-new').value.trim();
    if (v) void save([...list, { label: v, done: false }]);
  });
}

// ---------------------------------------------------------------- sorties sauvegardées
async function renderSaved() {
  const saved = (await kvGet<SavedItinerary[]>('saved')) ?? [];
  let host = document.getElementById('saved');
  if (!host) {
    host = document.createElement('div');
    host.id = 'saved';
    $('results').append(host);
  }
  host.innerHTML = saved.length
    ? `<h3>Mes sorties sauvegardées (sur cet appareil)</h3><ul class="compact">${saved.map((s) => `<li><button type="button" class="link" data-load="${esc(s.id)}">${esc(s.name)}</button> <button type="button" class="link" data-del="${esc(s.id)}" aria-label="Supprimer">✕</button></li>`).join('')}</ul>`
    : '';
  host.onclick = async (e) => {
    const t = e.target as HTMLElement;
    const all = (await kvGet<SavedItinerary[]>('saved')) ?? [];
    if (t.dataset.del) {
      await kvSet('saved', all.filter((s) => s.id !== t.dataset.del));
      void renderSaved();
    }
    const s = all.find((x) => x.id === t.dataset.load);
    if (s) {
      params = { ...s.params };
      syncForm();
      await loadCurrentMassif(true);
      if (s.custom) await setCustom(s.name, s.custom);
    }
  };
}

// ---------------------------------------------------------------- recherche, fond, à propos
$<HTMLSelectElement>('f-basemap').addEventListener('change', (e) => map.setBasemap((e.target as HTMLSelectElement).value as 'ign' | 'osm'));
$<HTMLInputElement>('f-search').addEventListener('change', (e) => {
  const q = (e.target as HTMLInputElement).value.trim();
  if (!q || !data) return;
  const st = global.stations.find((s) => `Gare : ${s.name}` === q || s.name === q);
  if (st) return map.flyTo(st.lon, st.lat, 13);
  const poi = data.pois.find((p) => p.name === q);
  if (poi) return map.flyTo(poi.lon, poi.lat, 14);
  const r = data.routes.find((x) => x.name === q);
  if (r) {
    const p = proposals.find((x) => x.route.id === r.id);
    if (p) select(p.id);
    const lons = r.coords.map((c) => c[0]);
    const lats = r.coords.map((c) => c[1]);
    map.fitBBox([Math.min(...lons), Math.min(...lats), Math.max(...lons), Math.max(...lats)]);
  }
});

$('btn-about').addEventListener('click', () => {
  const rows = global.sources
    .map((s) => `<tr><td>${extLink(s.url, s.name)}</td><td>${extLink(s.licenceUrl, s.licence)}</td><td>${esc(s.updated)}</td><td>${esc(s.fetched)}</td></tr>`)
    .join('');
  $('about-body').innerHTML = `<h2>Sources, licences et confidentialité</h2>
    <p><b>Confidentialité.</b> Aucun compte, aucun cookie, aucune statistique de visite. Vos paramètres, votre checklist et vos sorties sauvegardées restent dans votre navigateur (IndexedDB). Les fichiers GPX sont lus localement. La géolocalisation, si vous l'activez, reste sur votre appareil. Les seuls appels externes sont les tuiles de carte (IGN, OpenStreetMap) et, sur demande, la météo (Open-Meteo).</p>
    <p><b>Classement des itinéraires.</b> Les avis des sites de randonnée ne sont pas des données ouvertes : le classement repose sur la notoriété (réseau GR, article et consultations Wikipédia) et l'accessibilité en transport (arrêts à moins de 1,5 km et fréquence).</p>
    <p><b>Temps de marche.</b> Formule DIN 33466 : max(th, tv) + min(th, tv) / 2, avec th = distance / vitesse à plat et tv = D+ / vitesse de montée + D− / vitesse de descente (modifiables).</p>
    <div style="overflow-x:auto"><table class="cost"><thead><tr><th>Jeu de données</th><th>Licence</th><th>Mise à jour</th><th>Préparé le</th></tr></thead><tbody>${rows}</tbody></table></div>
    <p class="hint">Carte : © IGN, © les contributeurs d’OpenStreetMap. Données dérivées publiées sous ODbL.</p>
    <h3>Hors ligne</h3><p class="hint">Mettre en cache les tuiles Plan IGN de la zone affichée (zooms 11 à 15, 1 500 tuiles au plus) pour un usage hors ligne limité. Les tuiles OpenStreetMap ne sont pas téléchargées en masse, conformément à leur politique d'usage.</p>
    <button type="button" id="btn-offline">Préparer la zone affichée hors ligne</button> <span id="offline-status" class="hint"></span>`;
  ($('about') as HTMLDialogElement).showModal();
  $('btn-offline').addEventListener('click', cacheTiles);
});

// ---------------------------------------------------------------- PWA et tuiles hors ligne
function tileUrls(): string[] {
  const b = map.map.getBounds();
  const urls: string[] = [];
  const lon2x = (lon: number, z: number) => Math.floor(((lon + 180) / 360) * 2 ** z);
  const lat2y = (lat: number, z: number) => Math.floor(((1 - Math.log(Math.tan((lat * Math.PI) / 180) + 1 / Math.cos((lat * Math.PI) / 180)) / Math.PI) / 2) * 2 ** z);
  for (let z = 11; z <= 15; z++) {
    for (let x = lon2x(b.getWest(), z); x <= lon2x(b.getEast(), z); x++) {
      for (let y = lat2y(b.getNorth(), z); y <= lat2y(b.getSouth(), z); y++) {
        urls.push(`https://data.geopf.fr/wmts?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0&LAYER=GEOGRAPHICALGRIDSYSTEMS.PLANIGNV2&STYLE=normal&TILEMATRIXSET=PM&TILEMATRIX=${z}&TILEROW=${y}&TILECOL=${x}&FORMAT=image/png`);
      }
    }
  }
  return urls;
}
async function cacheTiles() {
  const status = $('offline-status');
  const urls = tileUrls();
  if (urls.length > 1500) {
    status.textContent = `Zone trop grande (${urls.length} tuiles) : zoomez davantage.`;
    return;
  }
  if (!('caches' in window)) {
    status.textContent = 'Cache indisponible dans ce navigateur.';
    return;
  }
  const cache = await caches.open('tiles-ign-v1');
  let done = 0;
  for (const u of urls) {
    try {
      if (!(await cache.match(u))) {
        const r = await fetch(u, { referrerPolicy: 'strict-origin' });
        if (r.ok) await cache.put(u, r);
        await new Promise((res) => setTimeout(res, 60)); // reste sous les limites de débit IGN
      }
    } catch {
      /* tuile ignorée */
    }
    done++;
    if (done % 25 === 0 || done === urls.length) status.textContent = `${done} / ${urls.length} tuiles`;
  }
  status.textContent = `${urls.length} tuiles prêtes hors ligne.`;
}
if ('serviceWorker' in navigator && import.meta.env.PROD) {
  void navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`);
}

window.addEventListener('hashchange', () => {
  const next = readHash(params);
  const massifChanged = next.massif !== params.massif;
  params = next;
  syncForm();
  if (massifChanged) void loadCurrentMassif(true);
  else schedule();
});
window.addEventListener('resize', () => current && renderProfile($('profile'), current.proposal.coords, current.plan.stages, current.plan.waterOnRoute));

// ---------------------------------------------------------------- démarrage
(async () => {
  theme = (await kvGet<typeof theme>('theme')) ?? 'auto';
  applyTheme();
  settings = mergeSettings(await kvGet<Partial<Settings>>('settings'));
  renderAdvanced();
  global = await loadGlobal();
  $('stations').innerHTML = global.stations.map((s) => `<option value="${esc(s.name)}"></option>`).join('');
  // Dernier départ utilisé, si l'URL n'en précise pas.
  if (!params.depart) params.depart = (await kvGet<string>('depart')) ?? '';
  syncForm();
  await loadCurrentMassif(true);
  void renderSaved();
  form.addEventListener('change', () => void kvSet('depart', params.depart));
})();
