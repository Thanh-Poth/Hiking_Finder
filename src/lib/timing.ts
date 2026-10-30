// Temps de marche. Formule DIN 33466 (utilisée par les clubs alpins allemand, autrichien et suisse) :
//   th = distance / vitesse à plat
//   tv = D+ / vitesse de montée + D- / vitesse de descente
//   temps = max(th, tv) + min(th, tv) / 2
// Les trois vitesses sont modifiables dans les réglages avancés. Les pauses ne sont pas incluses.

export interface PaceSettings {
  /** Vitesse horizontale (km/h). */
  flatKmh: number;
  /** Vitesse de montée (m de D+ par heure). */
  upMh: number;
  /** Vitesse de descente (m de D- par heure). */
  downMh: number;
}

export const DEFAULT_PACE: PaceSettings = { flatKmh: 4, upMh: 300, downMh: 500 };

/** Durée en heures pour une distance (m) et des dénivelés (m). */
export function walkingHours(distanceM: number, gain: number, loss: number, pace: PaceSettings = DEFAULT_PACE): number {
  const th = distanceM / 1000 / pace.flatKmh;
  const tv = gain / pace.upMh + loss / pace.downMh;
  return Math.max(th, tv) + Math.min(th, tv) / 2;
}

/** « 5 h 30 » ou « 45 min ». */
export function formatDuration(hours: number): string {
  if (!Number.isFinite(hours)) return '—';
  const totalMin = Math.round(hours * 60);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return h > 0 ? `${h} h ${String(m).padStart(2, '0')}` : `${m} min`;
}
