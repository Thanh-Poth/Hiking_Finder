// Règle de bivouac applicable en un point : zone protégée la plus contraignante qui le contient,
// sinon règle générale (hors espace protégé connu).

import { bboxOf, pointInPolygon } from './geo';
import type { BivouacRule, ProtectedCollection, ProtectedFeature, RuleType } from '../data/types';

const SEVERITY: Record<RuleType, number> = { forbidden: 4, near_hut_only: 3, night_only: 2, unknown: 1, allowed: 0 };

export const UNKNOWN_RULE: BivouacRule = {
  id: 'unknown',
  type: 'unknown',
  title: 'Règle inconnue : vérifier',
  text: "Aucune règle de bivouac n'est connue pour cet endroit. Se renseigner auprès de la mairie ou du gestionnaire de l'espace.",
  sourceName: '—',
  sourceUrl: '',
  checked: '',
};

interface Indexed {
  f: ProtectedFeature;
  bbox: [number, number, number, number];
}

export class RuleIndex {
  private readonly items: Indexed[];
  constructor(
    collection: ProtectedCollection | null,
    private readonly rules: Record<string, BivouacRule>,
    private readonly fallbackId = 'hors-espace-protege',
  ) {
    this.items = (collection?.features ?? []).map((f) => {
      const rings = f.geometry.type === 'Polygon' ? f.geometry.coordinates[0] : f.geometry.coordinates.flatMap((p) => p[0]);
      return { f, bbox: bboxOf(rings) };
    });
  }

  zonesAt(lon: number, lat: number): ProtectedFeature[] {
    const p = [lon, lat];
    return this.items
      .filter(({ bbox }) => lon >= bbox[0] && lon <= bbox[2] && lat >= bbox[1] && lat <= bbox[3])
      .filter(({ f }) =>
        f.geometry.type === 'Polygon'
          ? pointInPolygon(p, f.geometry.coordinates)
          : f.geometry.coordinates.some((poly) => pointInPolygon(p, poly)),
      )
      .map(({ f }) => f);
  }

  ruleAt = (lon: number, lat: number): BivouacRule => {
    const zones = this.zonesAt(lon, lat);
    if (zones.length === 0) return this.rules[this.fallbackId] ?? UNKNOWN_RULE;
    let best: BivouacRule | null = null;
    for (const z of zones) {
      const r = this.rules[z.properties.ruleId] ?? { ...UNKNOWN_RULE, title: `${z.properties.name} : règle inconnue, vérifier` };
      if (!best || SEVERITY[r.type] > SEVERITY[best.type]) best = r;
    }
    return best!;
  };
}
