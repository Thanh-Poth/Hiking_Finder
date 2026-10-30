// Avertissements saisonniers et heures de jour (calculées localement avec suncalc).

import SunCalc from 'suncalc';

export interface Daylight {
  sunrise: number;
  sunset: number;
  hours: number;
}

const decimalHours = (d: Date) => d.getHours() + d.getMinutes() / 60;

/** Lever / coucher du soleil à l'heure locale du navigateur (heure française attendue). */
export function daylightAt(date: Date, lat: number, lon: number): Daylight {
  const t = SunCalc.getTimes(new Date(date.getFullYear(), date.getMonth(), date.getDate(), 12), lat, lon);
  const sunrise = decimalHours(t.sunrise);
  const sunset = decimalHours(t.sunset);
  return { sunrise, sunset, hours: sunset - sunrise };
}

export interface SeasonWarning {
  level: 'info' | 'warn';
  text: string;
  link?: { label: string; url: string };
}

/**
 * Avertissements selon les dates, l'altitude maximale du parcours et le type de massif.
 * Les périodes sont indicatives : elles varient selon les années et les départements.
 */
export function seasonWarnings(dates: Date[], maxEle: number, alpine: boolean, minDaylightH: number): SeasonWarning[] {
  const months = new Set(dates.map((d) => d.getMonth() + 1));
  const has = (...m: number[]) => m.some((x) => months.has(x));
  const w: SeasonWarning[] = [];
  if (minDaylightH < 10) {
    w.push({ level: 'warn', text: `Jours courts : ${minDaylightH.toFixed(1).replace('.', ',')} h de jour seulement. Prévoir une frontale et des étapes plus courtes.` });
  }
  if ((has(11, 12, 1, 2, 3, 4) && maxEle > 1200) || (has(5, 10) && maxEle > 1800) || (has(6) && maxEle > 2400)) {
    w.push({
      level: 'warn',
      text: `Risque de neige ou de névés au-dessus d'environ ${has(6) ? 2400 : has(5, 10) ? 1800 : 1200} m (le parcours monte à ${Math.round(maxEle)} m). Consulter le bulletin d'estimation du risque d'avalanche.`,
      link: { label: 'Bulletins avalanche Météo-France', url: 'https://meteofrance.com/meteo-montagne' },
    });
  }
  if (has(11, 12, 1, 2, 3, 4)) {
    w.push({ level: 'warn', text: "Sources et fontaines possiblement gelées ou coupées pour l'hiver." });
  }
  if (has(8, 9, 10)) {
    w.push({ level: 'warn', text: "Fin d'été / automne : des sources peuvent être à sec. Ne pas compter sur un seul point d'eau." });
  }
  if (alpine && (has(10, 11, 12, 1, 2, 3, 4, 5) || dates.some((d) => d.getMonth() === 5 && d.getDate() < 15) || dates.some((d) => d.getMonth() === 8 && d.getDate() > 20))) {
    w.push({ level: 'info', text: "Hors saison estivale (mi-juin à mi-septembre en général) : la plupart des refuges gardés sont fermés. Vérifier les dates d'ouverture." });
  }
  if (has(9, 10, 11, 12, 1, 2)) {
    w.push({
      level: 'info',
      text: "Période de chasse (ouverture générale en général de septembre à fin février, dates fixées par département) : porter des couleurs visibles, se renseigner sur les battues.",
      link: { label: 'Fédération nationale des chasseurs', url: 'https://www.chasseurdefrance.com/' },
    });
  }
  return w;
}
