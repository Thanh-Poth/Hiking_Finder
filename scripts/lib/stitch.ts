// Reconstitue une polyligne continue à partir des chemins (ways) d'une relation OSM route=hiking.
// Les relations contiennent souvent des variantes et des chemins non ordonnés : on construit un
// graphe sur les sommets, on garde la plus grande composante, puis on prend son « diamètre »
// (chemin le plus long entre deux extrémités). Pour une boucle, on referme le tour par le chemin
// le plus court qui n'emprunte pas le premier tronçon.

import { haversine, inBBox } from '../../src/lib/geo';

type Pt = [number, number];

class Heap {
  private a: [number, number][] = [];
  get size() {
    return this.a.length;
  }
  push(v: [number, number]) {
    const a = this.a;
    a.push(v);
    let i = a.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (a[p][0] <= a[i][0]) break;
      [a[p], a[i]] = [a[i], a[p]];
      i = p;
    }
  }
  pop(): [number, number] {
    const a = this.a;
    const top = a[0];
    const last = a.pop()!;
    if (a.length) {
      a[0] = last;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let m = i;
        if (l < a.length && a[l][0] < a[m][0]) m = l;
        if (r < a.length && a[r][0] < a[m][0]) m = r;
        if (m === i) break;
        [a[m], a[i]] = [a[i], a[m]];
        i = m;
      }
    }
    return top;
  }
}

export class LineGraph {
  pts: Pt[] = [];
  adj: Map<number, number>[] = [];
  private index = new Map<string, number>();

  node(p: Pt): number {
    const k = `${p[0].toFixed(7)},${p[1].toFixed(7)}`;
    let i = this.index.get(k);
    if (i === undefined) {
      i = this.pts.length;
      this.index.set(k, i);
      this.pts.push(p);
      this.adj.push(new Map());
    }
    return i;
  }

  addWay(coords: Pt[], bbox?: readonly number[]) {
    for (let i = 1; i < coords.length; i++) {
      if (bbox && (!inBBox(coords[i - 1], bbox) || !inBBox(coords[i], bbox))) continue;
      const a = this.node(coords[i - 1]);
      const b = this.node(coords[i]);
      if (a === b) continue;
      const d = haversine(coords[i - 1], coords[i]);
      this.adj[a].set(b, d);
      this.adj[b].set(a, d);
    }
  }

  dijkstra(src: number, banned?: Set<string>): { dist: Float64Array; prev: Int32Array } {
    const n = this.pts.length;
    const dist = new Float64Array(n).fill(Infinity);
    const prev = new Int32Array(n).fill(-1);
    dist[src] = 0;
    const h = new Heap();
    h.push([0, src]);
    while (h.size) {
      const [d, u] = h.pop();
      if (d > dist[u]) continue;
      for (const [v, w] of this.adj[u]) {
        if (banned?.has(u < v ? `${u}-${v}` : `${v}-${u}`)) continue;
        const nd = d + w;
        if (nd < dist[v]) {
          dist[v] = nd;
          prev[v] = u;
          h.push([nd, v]);
        }
      }
    }
    return { dist, prev };
  }

  /** Composante connexe la plus longue (somme des longueurs d'arêtes). */
  largestComponent(): number[] {
    const seen = new Uint8Array(this.pts.length);
    let best: number[] = [];
    let bestLen = -1;
    for (let s = 0; s < this.pts.length; s++) {
      if (seen[s] || this.adj[s].size === 0) continue;
      const comp: number[] = [];
      let len = 0;
      const stack = [s];
      seen[s] = 1;
      while (stack.length) {
        const u = stack.pop()!;
        comp.push(u);
        for (const [v, w] of this.adj[u]) {
          len += w / 2;
          if (!seen[v]) {
            seen[v] = 1;
            stack.push(v);
          }
        }
      }
      if (len > bestLen) {
        bestLen = len;
        best = comp;
      }
    }
    return best;
  }
}

function farthest(dist: Float64Array, nodes: number[]): number {
  let best = nodes[0];
  for (const n of nodes) if (Number.isFinite(dist[n]) && dist[n] > dist[best]) best = n;
  return best;
}

function path(prev: Int32Array, to: number): number[] {
  const out: number[] = [];
  for (let v = to; v >= 0; v = prev[v]) out.push(v);
  return out.reverse();
}

export interface Stitched {
  coords: Pt[];
  loop: boolean;
  /** Longueur totale des chemins de la relation dans l'emprise (m). */
  networkLength: number;
}

export function stitch(ways: Pt[][], bbox: readonly number[], roundtrip: boolean): Stitched | null {
  const g = new LineGraph();
  for (const w of ways) g.addWay(w, bbox);
  const comp = g.largestComponent();
  if (comp.length < 2) return null;
  let networkLength = 0;
  for (const u of comp) for (const w of g.adj[u].values()) networkLength += w / 2;
  const a = farthest(g.dijkstra(comp[0]).dist, comp);
  const fromA = g.dijkstra(a);
  const b = farthest(fromA.dist, comp);
  const main = path(fromA.prev, b);
  const mainLen = fromA.dist[b];
  // Tentative de fermeture de boucle.
  const banned = new Set<string>();
  for (let i = 1; i < main.length; i++) {
    const [u, v] = [main[i - 1], main[i]];
    banned.add(u < v ? `${u}-${v}` : `${v}-${u}`);
  }
  const back = g.dijkstra(b, banned);
  const closesLoop = Number.isFinite(back.dist[a]) && back.dist[a] > 0.3 * mainLen;
  if (closesLoop && (roundtrip || back.dist[a] < 1.5 * mainLen)) {
    const ret = path(back.prev, a);
    return { coords: [...main, ...ret.slice(1)].map((i) => g.pts[i]), loop: true, networkLength };
  }
  return { coords: main.map((i) => g.pts[i]), loop: false, networkLength };
}
