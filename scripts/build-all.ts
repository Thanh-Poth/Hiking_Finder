// Enchaîne toute la préparation des données. Usage : npm run data [-- massif1 massif2 …]
// Chaque étape est aussi lançable seule (npm run data:routes -- ecrins, etc.).

import { spawnSync } from 'node:child_process';

const STEPS = ['01-stations', '02-gtfs', '03-routes', '04-pois', '05-protected', '06-transit', '07-fares', '08-dem', '09-meta'];
// Ces étapes acceptent une liste de massifs ; les autres travaillent sur toute la France.
const PER_MASSIF = new Set(['03-routes', '04-pois', '05-protected', '06-transit', '08-dem']);
const massifs = process.argv.slice(2);

for (const step of STEPS) {
  console.log(`\n▶ ${step}`);
  const args = ['--max-old-space-size=8192', 'node_modules/tsx/dist/cli.mjs', `scripts/${step}.ts`, ...(PER_MASSIF.has(step) ? massifs : [])];
  const r = spawnSync(process.execPath, args, { stdio: 'inherit' });
  if (r.status !== 0) {
    console.error(`Échec de l'étape ${step}`);
    process.exit(r.status ?? 1);
  }
}
