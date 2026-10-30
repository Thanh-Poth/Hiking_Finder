// Lecture d'archives GTFS et normalisation en un format intermédiaire compact (cache de build).

import { unzipSync, strFromU8 } from 'fflate';
import { encodeBits, gtfsServiceBits } from '../../src/lib/calendar';

/** Analyse CSV (RFC 4180) : guillemets, virgules et retours à la ligne dans les champs, BOM. */
export function* csvRows(text: string): Generator<string[]> {
  let i = text.charCodeAt(0) === 0xfeff ? 1 : 0;
  const n = text.length;
  while (i < n) {
    const row: string[] = [];
    for (;;) {
      let field = '';
      if (text[i] === '"') {
        i++;
        for (;;) {
          const q = text.indexOf('"', i);
          if (q < 0) {
            field += text.slice(i);
            i = n;
            break;
          }
          field += text.slice(i, q);
          i = q + 1;
          if (text[i] === '"') {
            field += '"';
            i++;
          } else break;
        }
      }
      let j = i;
      while (j < n && text[j] !== ',' && text[j] !== '\n' && text[j] !== '\r') j++;
      field += text.slice(i, j);
      row.push(field);
      i = j;
      if (text[i] === ',') {
        i++;
        continue;
      }
      if (text[i] === '\r') i++;
      if (text[i] === '\n') i++;
      break;
    }
    if (row.length > 1 || row[0] !== '') yield row;
  }
}

/** Itère sur les lignes d'un fichier GTFS sous forme d'objets {colonne: valeur}. */
export function* table(files: Record<string, Uint8Array>, name: string): Generator<Record<string, string>> {
  const key = Object.keys(files).find((k) => k === name || k.endsWith('/' + name));
  if (!key) return;
  const rows = csvRows(strFromU8(files[key]));
  const header = rows.next().value?.map((h) => h.trim());
  if (!header) return;
  for (const r of rows) {
    const o: Record<string, string> = {};
    for (let k = 0; k < header.length; k++) o[header[k]] = (r[k] ?? '').trim();
    yield o;
  }
}

export function parseTime(s: string): number {
  const m = /^(\d+):(\d{2})(?::(\d{2}))?$/.exec(s);
  return m ? Number(m[1]) * 60 + Number(m[2]) + Math.round(Number(m[3] ?? 0) / 60) : NaN;
}

export interface NStop {
  name: string;
  lon: number;
  lat: number;
  uic: string;
}

export interface NormalizedFeed {
  feed: string;
  start: string;
  days: number;
  agencies: Record<string, { name: string; url: string }>;
  routes: Record<string, { agency: string; short: string; type: number; price: number }>;
  /** Arrêts fusionnés par zone d'arrêt (parent_station). */
  stops: Record<string, NStop>;
  services: Record<string, string>;
  trips: { route: string; service: string; stops: string[]; times: number[] }[];
}

const UIC_RE = /(87\d{6})/;

export function normalizeGtfs(feedId: string, zip: Uint8Array, start: string, days: number): NormalizedFeed {
  // Les archives imbriquées (un zip de zips, ex. Mobigo) sont dépliées.
  let files = unzipSync(zip);
  const inner = Object.keys(files).filter((k) => k.toLowerCase().endsWith('.zip'));
  if (!Object.keys(files).some((k) => k.endsWith('stop_times.txt')) && inner.length) {
    const merged: Record<string, Uint8Array> = {};
    for (const k of inner) {
      const sub = unzipSync(files[k]);
      for (const [name, data] of Object.entries(sub)) merged[`${k}/${name}`] = data;
    }
    files = merged;
    return mergeFeeds(
      feedId,
      inner.map((k) => {
        const sub: Record<string, Uint8Array> = {};
        for (const [name, data] of Object.entries(files)) if (name.startsWith(k + '/')) sub[name.slice(k.length + 1)] = data;
        return normalizeFiles(`${feedId}~${k}`, sub, start, days);
      }),
      start,
      days,
    );
  }
  return normalizeFiles(feedId, files, start, days);
}

function mergeFeeds(feedId: string, parts: NormalizedFeed[], start: string, days: number): NormalizedFeed {
  const out: NormalizedFeed = { feed: feedId, start, days, agencies: {}, routes: {}, stops: {}, services: {}, trips: [] };
  parts.forEach((p, i) => {
    const pre = (s: string) => `${i}:${s}`;
    for (const [k, v] of Object.entries(p.agencies)) out.agencies[pre(k)] = v;
    for (const [k, v] of Object.entries(p.routes)) out.routes[pre(k)] = { ...v, agency: pre(v.agency) };
    for (const [k, v] of Object.entries(p.stops)) out.stops[pre(k)] = v;
    for (const [k, v] of Object.entries(p.services)) out.services[pre(k)] = v;
    for (const t of p.trips) out.trips.push({ route: pre(t.route), service: pre(t.service), stops: t.stops.map(pre), times: t.times });
  });
  return out;
}

function normalizeFiles(feedId: string, files: Record<string, Uint8Array>, start: string, days: number): NormalizedFeed {
  const agencies: NormalizedFeed['agencies'] = {};
  let firstAgency = '';
  for (const a of table(files, 'agency.txt')) {
    const id = a.agency_id || '_';
    firstAgency ||= id;
    agencies[id] = { name: a.agency_name, url: a.agency_url };
  }
  // Tarifs GTFS (fare_attributes + fare_rules), quand le producteur les publie.
  const fareById = new Map<string, number>();
  for (const f of table(files, 'fare_attributes.txt')) {
    const p = parseFloat(f.price);
    if (Number.isFinite(p) && (f.currency_type || 'EUR') === 'EUR') fareById.set(f.fare_id, p);
  }
  const routeFare = new Map<string, number>();
  let generic: number | undefined;
  for (const r of table(files, 'fare_rules.txt')) {
    const p = fareById.get(r.fare_id);
    if (p === undefined) continue;
    // On ne retient que les tarifs uniques par ligne (sans zones origine/destination).
    if (r.route_id && !r.origin_id && !r.destination_id && !r.contains_id) routeFare.set(r.route_id, p);
  }
  if (fareById.size === 1 && routeFare.size === 0 && !Object.keys(files).some((k) => k.endsWith('fare_rules.txt'))) {
    generic = [...fareById.values()][0];
  }
  const routes: NormalizedFeed['routes'] = {};
  for (const r of table(files, 'routes.txt')) {
    routes[r.route_id] = {
      agency: r.agency_id || firstAgency,
      short: r.route_short_name || r.route_long_name || '',
      type: Number(r.route_type),
      price: routeFare.get(r.route_id) ?? generic ?? -1,
    };
  }
  // Arrêts : fusion sur la zone d'arrêt parente.
  const raw = new Map<string, Record<string, string>>();
  for (const s of table(files, 'stops.txt')) raw.set(s.stop_id, s);
  const canonical = new Map<string, string>();
  const stops: NormalizedFeed['stops'] = {};
  for (const [id, s] of raw) {
    const parentId = s.parent_station && raw.has(s.parent_station) ? s.parent_station : id;
    canonical.set(id, parentId);
    if (!stops[parentId]) {
      const p = raw.get(parentId)!;
      const lat = parseFloat(p.stop_lat);
      const lon = parseFloat(p.stop_lon);
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
      const uic = UIC_RE.exec(parentId)?.[1] ?? UIC_RE.exec(id)?.[1] ?? '';
      stops[parentId] = { name: p.stop_name, lon: Math.round(lon * 1e5) / 1e5, lat: Math.round(lat * 1e5) / 1e5, uic: feedId === 'sncf' ? uic : '' };
    }
  }
  // Calendriers.
  const cals = new Map<string, { weekdays: number[]; start: string; end: string }>();
  for (const c of table(files, 'calendar.txt')) {
    cals.set(c.service_id, {
      weekdays: ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'].map((d) => Number(c[d])),
      start: c.start_date,
      end: c.end_date,
    });
  }
  const exc = new Map<string, Map<string, number>>();
  for (const c of table(files, 'calendar_dates.txt')) {
    if (!exc.has(c.service_id)) exc.set(c.service_id, new Map());
    exc.get(c.service_id)!.set(c.date, Number(c.exception_type));
  }
  const services: Record<string, string> = {};
  const activeService = new Set<string>();
  for (const id of new Set([...cals.keys(), ...exc.keys()])) {
    const bits = gtfsServiceBits(start, days, cals.get(id), exc.get(id));
    if (bits.some((b) => b !== 0)) {
      services[id] = encodeBits(bits);
      activeService.add(id);
    }
  }
  // Courses actives sur l'horizon.
  const tripInfo = new Map<string, { route: string; service: string }>();
  for (const t of table(files, 'trips.txt')) {
    if (activeService.has(t.service_id) && routes[t.route_id]) tripInfo.set(t.trip_id, { route: t.route_id, service: t.service_id });
  }
  const seq = new Map<string, [number, string, number][]>();
  for (const st of table(files, 'stop_times.txt')) {
    if (!tripInfo.has(st.trip_id)) continue;
    const time = parseTime(st.departure_time || st.arrival_time);
    const stop = canonical.get(st.stop_id);
    if (!stop || !stops[stop] || !Number.isFinite(time)) continue;
    if (st.pickup_type === '1' && st.drop_off_type === '1') continue;
    if (!seq.has(st.trip_id)) seq.set(st.trip_id, []);
    seq.get(st.trip_id)!.push([Number(st.stop_sequence), stop, time]);
  }
  const trips: NormalizedFeed['trips'] = [];
  for (const [id, list] of seq) {
    if (list.length < 2) continue;
    list.sort((a, b) => a[0] - b[0]);
    const info = tripInfo.get(id)!;
    trips.push({ route: info.route, service: info.service, stops: list.map((x) => x[1]), times: list.map((x) => x[2]) });
  }
  return { feed: feedId, start, days, agencies, routes, stops, services, trips };
}
