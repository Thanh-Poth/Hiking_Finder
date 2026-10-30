// Profil altimétrique en SVG : altitude, limites d'étapes (bivouacs) et points d'eau.

import { cumulativeDistances } from '../lib/geo';
import type { Stage } from '../lib/stages';
import type { PoiOnRoute } from '../lib/water';

const NS = 'http://www.w3.org/2000/svg';

function el<K extends keyof SVGElementTagNameMap>(name: K, attrs: Record<string, string | number>, text?: string): SVGElementTagNameMap[K] {
  const e = document.createElementNS(NS, name);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v));
  if (text !== undefined) e.textContent = text;
  return e;
}

export function renderProfile(host: HTMLElement, coords: number[][] | null, stages: Stage[], water: PoiOnRoute[]): void {
  host.replaceChildren();
  if (!coords || coords.length < 2) return;
  const cum = cumulativeDistances(coords);
  const total = cum[cum.length - 1];
  const eles = coords.map((c) => c[2] ?? 0);
  const minE = Math.floor(Math.min(...eles) / 100) * 100;
  const maxE = Math.ceil(Math.max(...eles) / 100) * 100 || minE + 100;
  const W = Math.max(320, host.clientWidth || 600);
  const H = Math.max(100, host.clientHeight || 130);
  const pad = { l: 40, r: 10, t: 8, b: 18 };
  const x = (d: number) => pad.l + (d / total) * (W - pad.l - pad.r);
  const y = (e: number) => pad.t + (1 - (e - minE) / (maxE - minE)) * (H - pad.t - pad.b);
  const svg = el('svg', { viewBox: `0 0 ${W} ${H}`, width: '100%', height: '100%', role: 'img' });
  svg.append(el('title', {}, `Profil altimétrique : ${(total / 1000).toFixed(1)} km, de ${Math.round(Math.min(...eles))} à ${Math.round(Math.max(...eles))} m`));
  const step = Math.max(1, Math.floor(coords.length / 800));
  let d = `M${x(0)},${y(eles[0])}`;
  for (let i = step; i < coords.length; i += step) d += `L${x(cum[i]).toFixed(1)},${y(eles[i]).toFixed(1)}`;
  d += `L${x(total)},${y(eles[eles.length - 1])}`;
  svg.append(el('path', { d: `${d}L${x(total)},${H - pad.b}L${x(0)},${H - pad.b}Z`, fill: 'currentColor', opacity: 0.12 }));
  svg.append(el('path', { d, fill: 'none', stroke: 'currentColor', 'stroke-width': 1.5 }));
  // Axes.
  const style = { 'font-size': 10, fill: 'currentColor' };
  for (const e of [minE, Math.round((minE + maxE) / 200) * 100, maxE]) {
    svg.append(el('text', { x: 2, y: y(e) + 3, ...style }, `${e} m`));
    svg.append(el('line', { x1: pad.l, x2: W - pad.r, y1: y(e), y2: y(e), stroke: 'currentColor', opacity: 0.12 }));
  }
  const kmStep = total > 100000 ? 20 : total > 40000 ? 10 : 5;
  for (let k = 0; k * 1000 <= total; k += kmStep) svg.append(el('text', { x: x(k * 1000) - 6, y: H - 4, ...style }, `${k}`));
  svg.append(el('text', { x: W - pad.r - 16, y: H - 4, ...style }, 'km'));
  // Étapes.
  stages.slice(0, -1).forEach((s, i) => {
    svg.append(el('line', { x1: x(s.to), x2: x(s.to), y1: pad.t, y2: H - pad.b, stroke: '#2f6b3a', 'stroke-width': 1.5, 'stroke-dasharray': '4 3' }));
    const t = el('text', { x: x(s.to) + 2, y: pad.t + 10, 'font-size': 11, 'font-weight': 700, fill: '#2f6b3a' }, `⛺${i + 1}`);
    t.append(el('title', {}, `Bivouac ${i + 1} : km ${(s.to / 1000).toFixed(1)}`));
    svg.append(t);
  });
  // Points d'eau.
  for (const w of water) {
    const i = Math.min(coords.length - 1, cum.findIndex((c) => c >= w.along));
    const c = el('circle', { cx: x(w.along), cy: y(eles[Math.max(0, i)]), r: 3.5, fill: w.poi.potable === 'no' ? '#9aa5b1' : '#1f6fd1', stroke: '#fff', 'stroke-width': 1 });
    c.append(el('title', {}, `${w.poi.name ?? "Point d'eau"} – km ${(w.along / 1000).toFixed(1)}${w.poi.ele ? `, ${w.poi.ele} m` : ''}`));
    svg.append(c);
  }
  host.append(svg);
}
