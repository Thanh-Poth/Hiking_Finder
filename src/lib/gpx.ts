// Lecture et écriture GPX 1.1. Le fichier importé est lu uniquement dans le navigateur.
// Parseur volontairement minimal (sans DOMParser) pour être testable hors navigateur.

export interface GpxPoint {
  lon: number;
  lat: number;
  ele?: number;
}

export interface GpxWaypoint extends GpxPoint {
  name?: string;
}

export interface GpxData {
  name?: string;
  /** Une polyligne par segment de trace (trkseg) ou par route (rte). */
  lines: GpxPoint[][];
  waypoints: GpxWaypoint[];
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

function decode(s: string): string {
  return s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (m, e: string) => {
      if (e[0] === '#') {
        const code = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
        return Number.isFinite(code) ? String.fromCodePoint(code) : m;
      }
      return ENTITIES[e] ?? m;
    })
    .trim();
}

function attr(tag: string, name: string): number {
  const m = new RegExp(`\\b${name}\\s*=\\s*["']([^"']+)["']`, 'i').exec(tag);
  return m ? parseFloat(m[1]) : NaN;
}

function child(body: string, name: string): string | undefined {
  const m = new RegExp(`<(?:\\w+:)?${name}\\b[^>]*>([\\s\\S]*?)</(?:\\w+:)?${name}>`, 'i').exec(body);
  return m ? decode(m[1]) : undefined;
}

function parsePoints(xml: string, tagName: string): GpxWaypoint[] {
  const out: GpxWaypoint[] = [];
  const re = new RegExp(`<(?:\\w+:)?${tagName}\\b([^>]*?)(?:/>|>([\\s\\S]*?)</(?:\\w+:)?${tagName}>)`, 'gi');
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml))) {
    const lat = attr(m[1], 'lat');
    const lon = attr(m[1], 'lon');
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    if (lat < -90 || lat > 90 || lon < -180 || lon > 180) continue;
    const p: GpxWaypoint = { lon, lat };
    const body = m[2] ?? '';
    const ele = parseFloat(child(body, 'ele') ?? '');
    if (Number.isFinite(ele)) p.ele = ele;
    const name = child(body, 'name');
    if (name) p.name = name;
    out.push(p);
  }
  return out;
}

function blocks(xml: string, tagName: string): string[] {
  const re = new RegExp(`<(?:\\w+:)?${tagName}\\b[^>]*>([\\s\\S]*?)</(?:\\w+:)?${tagName}>`, 'gi');
  const out: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml))) out.push(m[1]);
  return out;
}

export class GpxError extends Error {}

export function parseGpx(xml: string): GpxData {
  if (!/<(?:\w+:)?gpx\b/i.test(xml)) throw new GpxError("Ce fichier n'est pas un GPX.");
  // Retire commentaires et extensions, qui peuvent contenir des balises parasites.
  const clean = xml.replace(/<!--[\s\S]*?-->/g, '').replace(/<(?:\w+:)?extensions\b[\s\S]*?<\/(?:\w+:)?extensions>/gi, '');
  const lines: GpxPoint[][] = [];
  let name: string | undefined;
  for (const trk of blocks(clean, 'trk')) {
    name ??= child(trk.replace(/<(?:\w+:)?trkseg\b[\s\S]*$/i, ''), 'name');
    for (const seg of blocks(trk, 'trkseg')) {
      const pts = parsePoints(seg, 'trkpt').map(({ lon, lat, ele }) => (ele === undefined ? { lon, lat } : { lon, lat, ele }));
      if (pts.length >= 2) lines.push(pts);
    }
  }
  for (const rte of blocks(clean, 'rte')) {
    name ??= child(rte.replace(/<(?:\w+:)?rtept\b[\s\S]*$/i, ''), 'name');
    const pts = parsePoints(rte, 'rtept').map(({ lon, lat, ele }) => (ele === undefined ? { lon, lat } : { lon, lat, ele }));
    if (pts.length >= 2) lines.push(pts);
  }
  // Waypoints au niveau racine uniquement.
  const root = clean.replace(/<(?:\w+:)?(trk|rte)\b[\s\S]*?<\/(?:\w+:)?\1>/gi, '');
  const waypoints = parsePoints(root, 'wpt');
  if (!name) {
    const meta = blocks(clean, 'metadata')[0];
    if (meta) name = child(meta, 'name');
  }
  if (lines.length === 0) throw new GpxError('Aucune trace ni route exploitable dans ce GPX.');
  return { name, lines, waypoints };
}

/** Fusionne les segments en une seule polyligne [lon, lat, ele?]. */
export function gpxToLine(data: GpxData): number[][] {
  const out: number[][] = [];
  for (const line of data.lines) {
    for (const p of line) out.push(p.ele === undefined ? [p.lon, p.lat] : [p.lon, p.lat, p.ele]);
  }
  return out;
}

function esc(s: string): string {
  return s.replace(/[<>&"']/g, (c) => `&${{ '<': 'lt', '>': 'gt', '&': 'amp', '"': 'quot', "'": 'apos' }[c]};`);
}

export interface GpxExportTrack {
  name: string;
  coords: readonly (readonly number[])[];
}

export function buildGpx(tracks: GpxExportTrack[], waypoints: GpxWaypoint[] = [], title = 'Itinéraire'): string {
  const f = (n: number) => n.toFixed(6);
  const wpts = waypoints
    .map(
      (w) =>
        `  <wpt lat="${f(w.lat)}" lon="${f(w.lon)}">${w.ele !== undefined ? `<ele>${Math.round(w.ele)}</ele>` : ''}` +
        `${w.name ? `<name>${esc(w.name)}</name>` : ''}</wpt>`,
    )
    .join('\n');
  const trks = tracks
    .map((t) => {
      const pts = t.coords
        .map((c) => `      <trkpt lat="${f(c[1])}" lon="${f(c[0])}">${c[2] !== undefined ? `<ele>${Math.round(c[2])}</ele>` : ''}</trkpt>`)
        .join('\n');
      return `  <trk>\n    <name>${esc(t.name)}</name>\n    <trkseg>\n${pts}\n    </trkseg>\n  </trk>`;
    })
    .join('\n');
  return (
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<gpx version="1.1" creator="Bivouac planner" xmlns="http://www.topografix.com/GPX/1/1">\n` +
    `  <metadata><name>${esc(title)}</name></metadata>\n` +
    (wpts ? wpts + '\n' : '') +
    trks +
    `\n</gpx>\n`
  );
}
