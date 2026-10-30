import { describe, expect, it } from 'vitest';
import { buildGpx, GpxError, gpxToLine, parseGpx } from '../src/lib/gpx';

const SAMPLE = `<?xml version="1.0"?>
<gpx version="1.1" creator="x" xmlns="http://www.topografix.com/GPX/1/1">
  <metadata><name>Meta</name></metadata>
  <wpt lat="45.1" lon="6.1"><ele>1500</ele><name>Source &amp; fontaine</name></wpt>
  <trk><name>Tour test</name>
    <trkseg>
      <trkpt lon="6.0" lat="45.0"><ele>1000</ele><extensions><foo lat="1" lon="1"/></extensions></trkpt>
      <trkpt lat="45.001" lon="6.0"><ele>1010.5</ele></trkpt>
    </trkseg>
    <trkseg>
      <trkpt lat="45.002" lon="6.0"/>
      <trkpt lat="45.003" lon="6.0"></trkpt>
    </trkseg>
  </trk>
</gpx>`;

describe('parseur GPX', () => {
  it('lit traces, segments, altitudes et waypoints', () => {
    const g = parseGpx(SAMPLE);
    expect(g.name).toBe('Tour test');
    expect(g.lines).toHaveLength(2);
    expect(g.lines[0][1]).toEqual({ lon: 6, lat: 45.001, ele: 1010.5 });
    expect(g.lines[1][0].ele).toBeUndefined();
    expect(g.waypoints).toEqual([{ lon: 6.1, lat: 45.1, ele: 1500, name: 'Source & fontaine' }]);
    expect(gpxToLine(g)).toHaveLength(4);
  });
  it('lit les routes (rte) et les préfixes de namespace', () => {
    const g = parseGpx(`<gpx:gpx><gpx:rte><gpx:name>R</gpx:name><gpx:rtept lat="1" lon="2"/><gpx:rtept lat="1.1" lon="2"/></gpx:rte></gpx:gpx>`);
    expect(g.name).toBe('R');
    expect(g.lines[0]).toHaveLength(2);
  });
  it('rejette un fichier non GPX ou vide', () => {
    expect(() => parseGpx('<kml></kml>')).toThrow(GpxError);
    expect(() => parseGpx('<gpx></gpx>')).toThrow(GpxError);
  });
  it('aller-retour export → import', () => {
    const xml = buildGpx([{ name: 'Étape 1 <test>', coords: [[6, 45, 1000], [6.001, 45.001, 1100]] }], [{ lon: 6, lat: 45, name: 'Eau' }]);
    const g = parseGpx(xml);
    expect(g.name).toBe('Étape 1 <test>');
    expect(g.lines[0][1]).toEqual({ lon: 6.001, lat: 45.001, ele: 1100 });
    expect(g.waypoints[0].name).toBe('Eau');
  });
});
