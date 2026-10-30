// Météo en altitude (Open-Meteo, CC BY 4.0, usage non commercial gratuit).
// Appel uniquement sur action explicite de l'utilisateur : la requête part du navigateur et
// révèle son adresse IP à Open-Meteo, ce qui est indiqué à côté du bouton.

import { toIsoDate, addDays } from '../lib/calendar';

export interface WeatherPoint {
  label: string;
  lon: number;
  lat: number;
  ele: number;
  /** Indice du jour concerné (0 = jour de départ). */
  day: number;
}

export interface WeatherRow {
  point: WeatherPoint;
  date: string;
  tmin?: number;
  tmax?: number;
  precip?: number;
  gusts?: number;
  freezing?: number;
}

const FORECAST_DAYS = 16;

interface OmResponse {
  daily?: { time: string[]; temperature_2m_max: number[]; temperature_2m_min: number[]; precipitation_sum: number[]; wind_gusts_10m_max: number[] };
  hourly?: { time: string[]; freezing_level_height: number[] };
}

export async function fetchWeather(points: WeatherPoint[], start: Date): Promise<{ rows: WeatherRow[]; beyond: number }> {
  const today = new Date();
  const limit = addDays(today, FORECAST_DAYS - 1);
  const inRange = points.filter((p) => addDays(start, p.day) <= limit);
  const beyond = points.length - inRange.length;
  if (!inRange.length) return { rows: [], beyond };
  const dates = inRange.map((p) => toIsoDate(addDays(start, p.day)));
  const first = dates.reduce((a, b) => (a < b ? a : b));
  const last = dates.reduce((a, b) => (a > b ? a : b));
  const q = new URLSearchParams({
    latitude: inRange.map((p) => p.lat.toFixed(4)).join(','),
    longitude: inRange.map((p) => p.lon.toFixed(4)).join(','),
    elevation: inRange.map((p) => Math.round(p.ele)).join(','),
    daily: 'temperature_2m_max,temperature_2m_min,precipitation_sum,wind_gusts_10m_max',
    hourly: 'freezing_level_height',
    timezone: 'Europe/Paris',
    start_date: first < toIsoDate(today) ? toIsoDate(today) : first,
    end_date: last,
  });
  const res = await fetch(`https://api.open-meteo.com/v1/forecast?${q}`, { referrerPolicy: 'no-referrer', credentials: 'omit' });
  if (!res.ok) throw new Error(`Open-Meteo : HTTP ${res.status}`);
  const json = (await res.json()) as OmResponse | OmResponse[];
  const list = Array.isArray(json) ? json : [json];
  const rows: WeatherRow[] = inRange.map((point, i) => {
    const r = list[i];
    const date = dates[i];
    const k = r.daily?.time.indexOf(date) ?? -1;
    const fl = r.hourly ? r.hourly.time.map((t, j) => (t.startsWith(date) ? r.hourly!.freezing_level_height[j] : NaN)).filter(Number.isFinite) : [];
    return {
      point,
      date,
      tmin: k >= 0 ? r.daily!.temperature_2m_min[k] : undefined,
      tmax: k >= 0 ? r.daily!.temperature_2m_max[k] : undefined,
      precip: k >= 0 ? r.daily!.precipitation_sum[k] : undefined,
      gusts: k >= 0 ? r.daily!.wind_gusts_10m_max[k] : undefined,
      freezing: fl.length ? Math.round(Math.min(...fl)) : undefined,
    };
  });
  return { rows, beyond };
}
