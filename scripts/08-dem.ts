// Grille d'altitude grossière (pas de 250 m) par massif, depuis le service altimétrique IGN.
// Sert au profil des tracés libres et des GPX sans altitude, sans appel réseau depuis le navigateur.
// Format : Int16 petit-boutiste, lignes du nord au sud, colonnes d'ouest en est (mètres).

import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { MASSIFS, type Massif } from '../src/data/massifs';
import { demGrid } from '../src/lib/dem';
import { elevations } from './lib/elevation';
import { ensureDir, OUT } from './lib/http';

export const DEM_STEP_M = 250;

export async function buildDem(m: Massif): Promise<void> {
  const g = demGrid(m.bbox, DEM_STEP_M);
  const pts: [number, number][] = [];
  for (let y = 0; y < g.height; y++) {
    for (let x = 0; x < g.width; x++) pts.push([g.bbox[0] + x * g.dLon, g.bbox[3] - y * g.dLat]);
  }
  console.log(`${m.id} : ${g.width}×${g.height} = ${pts.length} points…`);
  const eles = await elevations(pts);
  const buf = Buffer.alloc(pts.length * 2);
  eles.forEach((e, i) => buf.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(e))), i * 2));
  ensureDir(join(OUT, m.id));
  writeFileSync(join(OUT, m.id, 'dem.bin'), buf);
}

async function main() {
  const only = process.argv.slice(2);
  for (const m of MASSIFS) {
    if (only.length && !only.includes(m.id)) continue;
    await buildDem(m);
  }
}

if (process.argv[1]?.endsWith('08-dem.ts')) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
