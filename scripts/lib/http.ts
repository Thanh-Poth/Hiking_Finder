// Accès réseau des scripts de build : cache disque, délai entre requêtes, nouvelles tentatives.
// User-Agent générique, sans nom ni contact personnel.

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
export const CACHE = join(ROOT, 'scripts', '.cache');
export const OUT = join(ROOT, 'public', 'data');

export const UA = 'bivouac-planner-build/0.1 (static open-data build script)';

export function ensureDir(d: string): string {
  mkdirSync(d, { recursive: true });
  return d;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export interface FetchOpts {
  method?: 'GET' | 'POST';
  body?: string;
  headers?: Record<string, string>;
  /** Durée de validité du cache (heures). */
  maxAgeH?: number;
  retries?: number;
  /** Nom de fichier en cache (sinon hachage de l'URL + corps). */
  cacheName?: string;
}

/** Télécharge (ou relit du cache) et renvoie le contenu binaire. */
export async function fetchCached(url: string, o: FetchOpts = {}): Promise<Buffer> {
  ensureDir(CACHE);
  const key = o.cacheName ?? createHash('sha1').update(url + (o.body ?? '')).digest('hex');
  const file = join(CACHE, key);
  const maxAge = (o.maxAgeH ?? 24 * 7) * 3600 * 1000;
  if (existsSync(file) && Date.now() - statSync(file).mtimeMs < maxAge) return readFileSync(file);
  let lastErr: unknown;
  for (let attempt = 0; attempt <= (o.retries ?? 4); attempt++) {
    try {
      const res = await fetch(url, {
        method: o.method ?? 'GET',
        body: o.body,
        headers: { 'User-Agent': UA, ...(o.headers ?? {}) },
        redirect: 'follow',
      });
      if (res.status === 429 || res.status >= 500) {
        const wait = Number(res.headers.get('retry-after')) * 1000 || 5000 * (attempt + 1);
        console.warn(`  ${res.status} sur ${url.slice(0, 80)}… nouvel essai dans ${wait / 1000}s`);
        await sleep(wait);
        continue;
      }
      if (!res.ok) throw new Error(`HTTP ${res.status} ${url}`);
      const buf = Buffer.from(await res.arrayBuffer());
      writeFileSync(file, buf);
      return buf;
    } catch (e) {
      lastErr = e;
      await sleep(3000 * (attempt + 1));
    }
  }
  throw lastErr;
}

export async function fetchJson<T>(url: string, o: FetchOpts = {}): Promise<T> {
  return JSON.parse((await fetchCached(url, o)).toString('utf8')) as T;
}

/** Limiteur simple : au plus `perSecond` appels par seconde. */
export function rateLimiter(perSecond: number) {
  let next = 0;
  return async () => {
    const now = Date.now();
    const wait = Math.max(0, next - now);
    next = Math.max(now, next) + 1000 / perSecond;
    if (wait) await sleep(wait);
  };
}

export function writeJson(path: string, data: unknown): void {
  ensureDir(dirname(path));
  writeFileSync(path, JSON.stringify(data));
}

export function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, 'utf8')) as T;
}

export const today = () => new Date().toISOString().slice(0, 10);
