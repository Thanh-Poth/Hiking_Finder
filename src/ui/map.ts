// Carte MapLibre : fonds Plan IGN / OpenStreetMap, estompage IGN, itinéraires, étapes, eau,
// refuges et zones réglementées. Aucune couche de texte (pas de police distante à charger).

import maplibregl, { type GeoJSONSource, type Map as MlMap } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import type { BBox } from '../data/massifs';
import type { BivouacRule, Poi, ProtectedCollection, RouteData } from '../data/types';
import type { Stage } from '../lib/stages';
import { pointAt, cumulativeDistances } from '../lib/geo';

const IGN = (layer: string, style: string, fmt = 'image/png') =>
  `https://data.geopf.fr/wmts?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0&LAYER=${layer}&STYLE=${style}&TILEMATRIXSET=PM&TILEMATRIX={z}&TILEROW={y}&TILECOL={x}&FORMAT=${fmt}`;

export const KIND_LABEL: Record<Poi['kind'], string> = {
  water: "Point d'eau",
  spring: 'Source',
  hut_guarded: 'Refuge gardé',
  hut_unguarded: 'Cabane / refuge non gardé',
  shelter: 'Abri',
  camp_site: 'Camping',
  shop: 'Ravitaillement',
  parking: 'Parking',
};

const empty = (): GeoJSON.FeatureCollection => ({ type: 'FeatureCollection', features: [] });

export interface MapApi {
  map: MlMap;
  setBasemap(kind: 'ign' | 'osm'): void;
  setDark(dark: boolean): void;
  fitBBox(b: BBox | number[]): void;
  showRoutes(routes: RouteData[], selected: string | null, onPick: (id: string) => void): void;
  showItinerary(coords: number[][] | null, stages: Stage[]): void;
  /** Tous les points ; ceux de `onRoute` (ids) sont visibles à tout zoom, les autres à partir du zoom 12. */
  showPois(pois: Poi[], onRoute: Set<string>): void;
  showProtected(fc: ProtectedCollection | null, rules: Record<string, BivouacRule>): void;
  startDrawing(onChange: (pts: number[][]) => void): void;
  stopDrawing(): number[][];
  undoDrawing(): void;
  flyTo(lon: number, lat: number, zoom?: number): void;
}

export function createMap(container: HTMLElement): MapApi {
  const map = new maplibregl.Map({
    container,
    attributionControl: false,
    center: [6.3, 44.9],
    zoom: 9,
    maxZoom: 17,
    style: {
      version: 8,
      sources: {
        ign: { type: 'raster', tiles: [IGN('GEOGRAPHICALGRIDSYSTEMS.PLANIGNV2', 'normal')], tileSize: 256, maxzoom: 18, attribution: '© <a href="https://www.ign.fr/">IGN</a> – Plan IGN' },
        osm: { type: 'raster', tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'], tileSize: 256, maxzoom: 19, attribution: '© <a href="https://www.openstreetmap.org/copyright">les contributeurs d’OpenStreetMap</a>' },
        shade: { type: 'raster', tiles: [IGN('ELEVATION.ELEVATIONGRIDCOVERAGE.SHADOW', 'estompage_grayscale')], tileSize: 256, maxzoom: 15, attribution: '© IGN – estompage' },
      },
      layers: [
        { id: 'ign', type: 'raster', source: 'ign' },
        { id: 'osm', type: 'raster', source: 'osm', layout: { visibility: 'none' } },
        { id: 'shade', type: 'raster', source: 'shade', paint: { 'raster-opacity': 0.25 } },
      ],
    },
  });
  map.addControl(new maplibregl.AttributionControl({ compact: true, customAttribution: 'Données © OpenStreetMap (ODbL), Refuges.info (CC BY-SA), IGN, transport.data.gouv.fr' }));
  map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');
  // Géolocalisation : API du navigateur uniquement, la position ne quitte pas l'appareil.
  map.addControl(new maplibregl.GeolocateControl({ positionOptions: { enableHighAccuracy: true }, trackUserLocation: false }), 'top-right');
  map.addControl(new maplibregl.ScaleControl({ unit: 'metric' }), 'bottom-left');

  let markers: maplibregl.Marker[] = [];
  let drawPts: number[][] = [];
  let drawCb: ((pts: number[][]) => void) | null = null;
  const ready = new Promise<void>((r) => map.once('load', () => r()));

  void ready.then(() => {
    container.querySelector('.maplibregl-ctrl-attrib')?.classList.remove('maplibregl-compact-show');
    container.querySelector('.maplibregl-ctrl-attrib')?.removeAttribute('open');
    const add = (id: string) => map.addSource(id, { type: 'geojson', data: empty() });
    ['protected', 'routes', 'itinerary', 'stage-ends', 'pois', 'draw'].forEach(add);
    map.addLayer({ id: 'protected-fill', type: 'fill', source: 'protected', paint: { 'fill-color': ['get', 'color'], 'fill-opacity': 0.12 } });
    map.addLayer({ id: 'protected-line', type: 'line', source: 'protected', paint: { 'line-color': ['get', 'color'], 'line-width': 1.5, 'line-dasharray': [3, 2] } });
    map.addLayer({ id: 'routes', type: 'line', source: 'routes', paint: { 'line-color': '#7a3fb0', 'line-width': ['case', ['get', 'selected'], 3, 2], 'line-opacity': ['case', ['get', 'selected'], 0.9, 0.45] } });
    map.addLayer({ id: 'routes-hit', type: 'line', source: 'routes', paint: { 'line-color': '#000', 'line-width': 14, 'line-opacity': 0 } });
    map.addLayer({ id: 'itinerary-casing', type: 'line', source: 'itinerary', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': '#ffffff', 'line-width': 7 } });
    map.addLayer({ id: 'itinerary', type: 'line', source: 'itinerary', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': ['get', 'color'], 'line-width': 4 } });
    const poiPaint = {
      'circle-radius': ['interpolate', ['linear'], ['zoom'], 9, 3, 14, 6],
      'circle-color': ['get', 'color'],
      'circle-stroke-color': '#ffffff',
      'circle-stroke-width': 1,
    } as maplibregl.CircleLayerSpecification['paint'];
    map.addLayer({ id: 'pois-all', type: 'circle', source: 'pois', minzoom: 12, filter: ['!', ['get', 'onRoute']], paint: poiPaint });
    map.addLayer({ id: 'pois', type: 'circle', source: 'pois', filter: ['get', 'onRoute'], paint: poiPaint });
    map.addLayer({ id: 'draw-line', type: 'line', source: 'draw', paint: { 'line-color': '#d1495b', 'line-width': 3, 'line-dasharray': [2, 1] } });
    map.addLayer({ id: 'draw-pts', type: 'circle', source: 'draw', filter: ['==', '$type', 'Point'], paint: { 'circle-radius': 5, 'circle-color': '#d1495b' } });

    const poiClick = (e: maplibregl.MapLayerMouseEvent) => {
      const f = e.features?.[0];
      if (!f) return;
      const p = f.properties as Record<string, string>;
      const html = document.createElement('div');
      const title = document.createElement('strong');
      title.textContent = p.name || p.label;
      html.append(title, document.createElement('br'), p.label + (p.ele ? ` · ${p.ele} m` : ''));
      if (p.potable) html.append(document.createElement('br'), `Eau : ${p.potable}`);
      if (p.opening) html.append(document.createElement('br'), `Ouverture : ${p.opening}`);
      if (p.url) {
        const a = document.createElement('a');
        a.href = p.url;
        a.target = '_blank';
        a.rel = 'noopener noreferrer';
        a.textContent = p.source === 'refuges.info' ? 'Fiche Refuges.info' : 'Fiche OpenStreetMap';
        html.append(document.createElement('br'), a);
      }
      new maplibregl.Popup({ maxWidth: '260px' }).setLngLat(e.lngLat).setDOMContent(html).addTo(map);
    };
    map.on('click', 'pois', poiClick);
    map.on('click', 'pois-all', poiClick);
    map.on('click', 'protected-fill', (e) => {
      if (drawCb || map.queryRenderedFeatures(e.point, { layers: ['pois', 'pois-all', 'routes-hit'] }).length) return;
      const p = e.features?.[0]?.properties as Record<string, string> | undefined;
      if (!p) return;
      const html = document.createElement('div');
      const t = document.createElement('strong');
      t.textContent = p.name;
      html.append(t, document.createElement('br'), p.ruleTitle);
      new maplibregl.Popup({ maxWidth: '280px' }).setLngLat(e.lngLat).setDOMContent(html).addTo(map);
    });
    for (const l of ['pois', 'pois-all', 'routes-hit']) {
      map.on('mouseenter', l, () => (map.getCanvas().style.cursor = 'pointer'));
      map.on('mouseleave', l, () => (map.getCanvas().style.cursor = drawCb ? 'crosshair' : ''));
    }
    map.on('click', (e) => {
      if (!drawCb) return;
      drawPts.push([Math.round(e.lngLat.lng * 1e5) / 1e5, Math.round(e.lngLat.lat * 1e5) / 1e5]);
      renderDraw();
    });
  });

  const setData = (id: string, data: GeoJSON.FeatureCollection) => void ready.then(() => (map.getSource(id) as GeoJSONSource).setData(data));

  function renderDraw() {
    setData('draw', {
      type: 'FeatureCollection',
      features: [
        ...(drawPts.length > 1 ? [{ type: 'Feature' as const, properties: {}, geometry: { type: 'LineString' as const, coordinates: drawPts } }] : []),
        ...drawPts.map((c) => ({ type: 'Feature' as const, properties: {}, geometry: { type: 'Point' as const, coordinates: c } })),
      ],
    });
    drawCb?.(drawPts);
  }

  let routeClick: ((e: maplibregl.MapLayerMouseEvent) => void) | null = null;
  const POI_COLOR: Record<string, string> = { water: '#1f6fd1', spring: '#1f6fd1', hut_guarded: '#b23a48', hut_unguarded: '#e07a1f', shelter: '#8a6d3b', camp_site: '#2f6b3a', shop: '#6c757d', parking: '#555' };
  const POT_COLOR: Record<string, string> = { yes: '#1f6fd1', unknown: '#7fb3f0', no: '#9aa5b1' };
  const RULE_COLOR: Record<string, string> = { forbidden: '#c0392b', near_hut_only: '#d35400', night_only: '#b7950b', unknown: '#7f8c8d', allowed: '#27ae60' };
  const STAGE_COLORS = ['#d1495b', '#00798c', '#edae49', '#30638e', '#66a182', '#8d5a97', '#ef8354', '#2e4057', '#b0413e', '#4f6d7a'];

  return {
    map,
    setBasemap(kind) {
      void ready.then(() => {
        map.setLayoutProperty('ign', 'visibility', kind === 'ign' ? 'visible' : 'none');
        map.setLayoutProperty('osm', 'visibility', kind === 'osm' ? 'visible' : 'none');
      });
    },
    setDark(dark) {
      void ready.then(() => {
        for (const l of ['ign', 'osm']) {
          map.setPaintProperty(l, 'raster-brightness-max', dark ? 0.75 : 1);
          map.setPaintProperty(l, 'raster-saturation', dark ? -0.3 : 0);
        }
      });
    },
    fitBBox(b) {
      void ready.then(() => map.fitBounds([[b[0], b[1]], [b[2], b[3]]], { padding: 30, duration: 0 }));
    },
    showRoutes(routes, selected, onPick) {
      setData('routes', {
        type: 'FeatureCollection',
        features: routes.map((r) => ({ type: 'Feature', properties: { id: r.id, selected: r.id === selected }, geometry: { type: 'LineString', coordinates: r.coords.map((c) => [c[0], c[1]]) } })),
      });
      void ready.then(() => {
        if (routeClick) map.off('click', 'routes-hit', routeClick);
        routeClick = (e) => {
          if (drawCb) return;
          const id = e.features?.[0]?.properties?.id as string | undefined;
          if (id) onPick(id);
        };
        map.on('click', 'routes-hit', routeClick);
      });
    },
    showItinerary(coords, stages) {
      markers.forEach((m) => m.remove());
      markers = [];
      if (!coords) {
        setData('itinerary', empty());
        return;
      }
      const cum = cumulativeDistances(coords);
      const features: GeoJSON.Feature[] = stages.map((s, i) => {
        const pts: number[][] = [pointAt(coords, cum, s.from)];
        for (let k = 0; k < coords.length; k++) if (cum[k] > s.from && cum[k] < s.to) pts.push(coords[k]);
        pts.push(pointAt(coords, cum, s.to));
        return { type: 'Feature', properties: { color: STAGE_COLORS[i % STAGE_COLORS.length] }, geometry: { type: 'LineString', coordinates: pts.map((p) => [p[0], p[1]]) } };
      });
      setData('itinerary', { type: 'FeatureCollection', features });
      stages.forEach((s, i) => {
        if (i === stages.length - 1) return;
        const el = document.createElement('button');
        el.type = 'button';
        el.className = 'marker-bivouac' + (s.issues.length ? ' warn' : '');
        el.textContent = String(i + 1);
        el.title = `Bivouac ${i + 1}${s.bivouac?.water ? ' (eau à proximité)' : ''}`;
        el.setAttribute('aria-label', el.title);
        el.addEventListener('click', () => document.getElementById(`stage-${i}`)?.scrollIntoView({ behavior: 'smooth' }));
        const p = s.bivouac ? [s.bivouac.lon, s.bivouac.lat] : pointAt(coords, cum, s.to);
        markers.push(new maplibregl.Marker({ element: el }).setLngLat([p[0], p[1]]).addTo(map));
      });
    },
    showPois(pois, onRoute) {
      setData('pois', {
        type: 'FeatureCollection',
        features: pois.map((p) => ({
          type: 'Feature',
          properties: {
            name: p.name ?? '',
            label: KIND_LABEL[p.kind],
            ele: p.ele ?? '',
            potable: p.potable ? { yes: 'potable', no: 'non potable', unknown: 'potabilité inconnue' }[p.potable] : '',
            opening: p.opening ?? '',
            url: p.url ?? '',
            source: p.source,
            color: p.potable ? POT_COLOR[p.potable] : POI_COLOR[p.kind],
            onRoute: onRoute.has(p.id),
          },
          geometry: { type: 'Point', coordinates: [p.lon, p.lat] },
        })),
      });
    },
    showProtected(fc, rules) {
      setData('protected', {
        type: 'FeatureCollection',
        features: (fc?.features ?? []).map((f) => {
          const r = rules[f.properties.ruleId];
          return { ...f, properties: { ...f.properties, color: RULE_COLOR[r?.type ?? 'unknown'], ruleTitle: r?.title ?? 'Règle inconnue : vérifier' } };
        }),
      });
    },
    startDrawing(onChange) {
      drawPts = [];
      drawCb = onChange;
      map.getCanvas().style.cursor = 'crosshair';
      map.doubleClickZoom.disable();
      renderDraw();
    },
    stopDrawing() {
      const pts = drawPts;
      drawCb = null;
      drawPts = [];
      map.getCanvas().style.cursor = '';
      map.doubleClickZoom.enable();
      setData('draw', empty());
      return pts;
    },
    undoDrawing() {
      drawPts.pop();
      renderDraw();
    },
    flyTo(lon, lat, zoom = 13) {
      map.flyTo({ center: [lon, lat], zoom });
    },
  };
}
