// État de l'application : paramètres principaux dans le hash de l'URL (partageables, sans
// donnée personnelle), réglages avancés, checklist et itinéraires sauvegardés en IndexedDB.
// Rien n'est envoyé à un serveur.

import { DEFAULT_COST, type CostSettings } from '../lib/cost';
import { DEFAULT_PACE, type PaceSettings } from '../lib/timing';
import { DEFAULT_WATER, type WaterSettings } from '../lib/water';
import type { TripMode } from '../lib/selection';

export interface Params {
  massif: string;
  /** Code UIC de la gare de départ, ou "" si non choisie. */
  depart: string;
  car: boolean;
  days: number;
  /** AAAA-MM-JJ. */
  date: string;
  mode: TripMode;
  /** Identifiant de la proposition affichée. */
  pick: string;
}

export interface Settings {
  pace: PaceSettings;
  maxKmPerDay: number;
  maxGainPerDay: number;
  cost: CostSettings;
  water: WaterSettings;
  /** Rayon de recherche de l'eau autour d'un bivouac (m). */
  bivouacWaterRadiusM: number;
  /** Distance à partir de laquelle on s'écarte d'un refuge (m). */
  hutAvoidM: number;
  /** Tampon des points utiles (refuges, campings, ravitaillement) autour du tracé (m). */
  poiBufferM: number;
  /** Heure de départ de marche le jour 1 si aucun horaire de transport n'est connu. */
  defaultStartHour: number;
  /** Heure limite le dernier jour si aucun retour en transport n'est connu. */
  defaultDeadlineHour: number;
  /** Marge entre l'arrivée du transport et le départ de la marche (min). */
  transferMarginMin: number;
}

export const DEFAULT_SETTINGS: Settings = {
  pace: { ...DEFAULT_PACE },
  maxKmPerDay: 20,
  maxGainPerDay: 1200,
  cost: { ...DEFAULT_COST },
  water: { ...DEFAULT_WATER },
  bivouacWaterRadiusM: 300,
  hutAvoidM: 400,
  poiBufferM: 1000,
  defaultStartHour: 9,
  defaultDeadlineHour: 17,
  transferMarginMin: 15,
};

export function defaultParams(): Params {
  const d = new Date();
  d.setDate(d.getDate() + 7);
  return { massif: 'ecrins', depart: '', car: false, days: 3, date: isoDate(d), mode: 'traverse', pick: '' };
}

export function isoDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function readHash(defaults: Params): Params {
  const h = new URLSearchParams(location.hash.replace(/^#/, ''));
  const p = { ...defaults };
  if (h.get('m')) p.massif = h.get('m')!;
  // Code UIC SNCF (8 chiffres) ou identifiant de gare hors SNCF (ex. « cfc-ajaccio »).
  if (h.has('d')) p.depart = h.get('d')!.replace(/[^a-z0-9-]/gi, '').slice(0, 32);
  p.car = h.get('car') === '1' ? true : h.has('car') ? false : p.car;
  const days = Number(h.get('j'));
  if (days >= 1 && days <= 10) p.days = Math.round(days);
  if (/^\d{4}-\d{2}-\d{2}$/.test(h.get('date') ?? '')) p.date = h.get('date')!;
  if (h.get('mode') === 'roundtrip' || h.get('mode') === 'traverse') p.mode = h.get('mode') as TripMode;
  if (h.get('it')) p.pick = h.get('it')!;
  return p;
}

export function writeHash(p: Params): void {
  const h = new URLSearchParams();
  h.set('m', p.massif);
  if (p.depart) h.set('d', p.depart);
  if (p.car) h.set('car', '1');
  h.set('j', String(p.days));
  h.set('date', p.date);
  h.set('mode', p.mode);
  if (p.pick) h.set('it', p.pick);
  const next = '#' + h.toString();
  if (location.hash !== next) history.replaceState(null, '', next);
}

// ---------- IndexedDB (clé → valeur), avec repli en mémoire si indisponible ----------

const DB = 'bivouac';
const STORE = 'kv';
const memory = new Map<string, unknown>();
let dbPromise: Promise<IDBDatabase | null> | null = null;

function openDb(): Promise<IDBDatabase | null> {
  dbPromise ??= new Promise((resolve) => {
    try {
      const req = indexedDB.open(DB, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(STORE);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
  return dbPromise;
}

export async function kvGet<T>(key: string): Promise<T | undefined> {
  const db = await openDb();
  if (!db) return memory.get(key) as T | undefined;
  return new Promise((resolve) => {
    const req = db.transaction(STORE).objectStore(STORE).get(key);
    req.onsuccess = () => resolve(req.result as T | undefined);
    req.onerror = () => resolve(undefined);
  });
}

export async function kvSet(key: string, value: unknown): Promise<void> {
  memory.set(key, value);
  const db = await openDb();
  if (!db) return;
  await new Promise<void>((resolve) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put(value, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => resolve();
  });
}

/** Fusion profonde des réglages enregistrés avec les valeurs par défaut (champs ajoutés plus tard). */
export function mergeSettings(saved: Partial<Settings> | undefined): Settings {
  const s = structuredClone(DEFAULT_SETTINGS);
  if (!saved) return s;
  for (const k of Object.keys(s) as (keyof Settings)[]) {
    const v = saved[k];
    if (v === undefined) continue;
    if (typeof v === 'object' && v !== null) Object.assign(s[k] as object, v);
    else (s as unknown as Record<string, unknown>)[k] = v;
  }
  return s;
}

export interface SavedItinerary {
  id: string;
  name: string;
  savedAt: string;
  params: Params;
  /** Tracé personnel (dessin ou GPX), sinon null. */
  custom: number[][] | null;
}
