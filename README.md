# Bivouac — préparer une randonnée itinérante en bivouac en France

Application web **gratuite, statique et sans compte** pour préparer une randonnée de 1 à 10 jours
avec nuits en bivouac : choix du massif, du point de départ et des dates, itinéraires proposés,
découpage en étapes avec bivouacs près de l'eau et conformes aux règles connues, points d'eau,
horaires de transport, coût estimé, météo à la demande, export GPX et feuille de route imprimable.

- Fonctionne en local sur votre ordinateur (Vite + TypeScript, MapLibre GL), sans serveur distant.
- Aucune donnée personnelle collectée : ni compte, ni cookie, ni statistique de visite. Les
  réglages, la checklist et les sorties sauvegardées restent dans le navigateur (IndexedDB).
  Les fichiers GPX importés sont lus localement.
- Toutes les données lourdes (OpenStreetMap, horaires, altitudes, espaces protégés) sont
  préparées **au build** par les scripts de `scripts/` et servies en fichiers statiques par massif.
  Le navigateur n'interroge ni Overpass ni aucun service de transport.
- Appels externes depuis le navigateur : tuiles de carte (IGN, OpenStreetMap) et, uniquement
  sur clic sur « Charger la météo », Open-Meteo (qui voit alors l'adresse IP).

## Lancer l'application

Prérequis : [Node.js](https://nodejs.org) (version LTS).

- **Windows** : double-cliquer sur `Lancer.bat`. La première fois, les dépendances s'installent
  (une minute environ), puis l'application s'ouvre dans le navigateur sur http://localhost:5290.
  Fermer la fenêtre noire pour l'arrêter.
- **Autres systèmes** : `npm install` (une seule fois), puis `npm start`.

Les données des 11 massifs sont déjà fournies dans `public/data/` : rien d'autre à préparer.

Pour le développement :

```bash
npm test           # tests unitaires (Vitest)
npm run lint       # ESLint
npm run build      # vérification TypeScript + build dans dist/
```

## Préparation des données (facultatif, déjà faite)

```bash
npm run data                       # tout, pour tous les massifs (long : ~10 min par massif)
npm run data -- ecrins vanoise     # seulement certains massifs
```

Étapes (lançables séparément, par ex. `npm run data:routes -- ecrins`) :

| Script | Rôle | Sortie |
|---|---|---|
| `01-stations.ts` | Gares de départ (SNCF, segments A et B) | `public/data/stations.json` |
| `02-gtfs.ts` | Téléchargement et normalisation des GTFS, index des arrêts par massif | `scripts/.cache/` |
| `03-routes.ts` | Catalogue : les **5 meilleurs itinéraires** de chaque massif, altitudes IGN | `<massif>/routes.json` |
| `04-pois.ts` | Eau, refuges, cabanes, abris, campings, ravitaillements, parkings | `<massif>/pois.json` |
| `05-protected.ts` | Espaces protégés et règle de bivouac associée | `<massif>/protected.json`, `bivouac-rules.json` |
| `06-transit.ts` | Horaires compactés (accès aux itinéraires + approche depuis les grandes gares) | `<massif>/transit.json` |
| `07-fares.ts` | Fourchettes tarifaires ouvertes SNCF (TGV INOUI, OUIGO, Intercités) | `fares.json` |
| `08-dem.ts` | Grille d'altitude 250 m (profil des tracés libres et des GPX sans altitude) | `<massif>/dem.bin` |
| `09-meta.ts` | Sources, licences, dates de mise à jour affichées dans l'application | `sources.json`, `<massif>/meta.json` |

Les scripts mettent en cache leurs téléchargements dans `scripts/.cache/` (ignoré par git),
espacent leurs requêtes (Overpass : 1 requête / 2 s ; IGN : 3 requêtes / s) et s'identifient
avec un User-Agent générique.

### Choix des 5 itinéraires par massif

Les avis des randonneurs publiés sur les sites spécialisés ne sont pas des données ouvertes
(leurs conditions interdisent l'extraction et la republication). Le classement repose donc sur
des sources ouvertes :

- **Notoriété (60 %)** : niveau du réseau OSM (`iwn` international, `nwn` GR, `rwn` GR de pays,
  `lwn` local), présence d'un article Wikipédia (via Wikidata) et nombre de consultations sur
  12 mois (API Wikimedia).
- **Accessibilité (40 %)** : arrêts de transport en commun à moins de 1,5 km du tracé et nombre
  moyen de départs par jour sur l'horizon des horaires publiés.
- Les tracés qui recouvrent à plus de 50 % un itinéraire déjà retenu sont écartés ; seuls les
  tracés d'au moins 15 km dans le massif et situés au moins à 60 % en France sont gardés.
- Un itinéraire découpé en sections ou en étapes dans OSM (relation `superroute`, ex. GR 10) est
  évalué en entier ; les variantes, liaisons et étapes isolées sont écartées, de même que les
  itinéraires internationaux découpés en étapes (Via Alpina, Via Arverna…). Les chemins de
  pèlerinage voient leur notoriété divisée par deux (souvent en plaine et sur route).

### Règles de bivouac

`data-src/bivouac-rules.json` contient les règles saisies à la main depuis les textes officiels
(texte, source, date de vérification). Elles sont associées aux espaces protégés par
`05-protected.ts`. Hors de ces règles vérifiées, l'application affiche « règle inconnue : vérifier ».

| Espace | Règle | Source |
|---|---|---|
| Cœur du PN des Écrins | 19 h – 9 h, conditions cumulatives | Arrêté n°148/2026 (consolidé 185-2026) |
| Cœur du PN du Mercantour | 19 h – 9 h, > 1 h de marche des limites / routes | Démarche officielle du parc |
| Cœur du PN des Pyrénées | 19 h – 9 h, > 1 h des voies carrossables ou aires agréées | Arrêté du 29/08/2013 |
| Cœur du PN des Cévennes | 19 h – 9 h, à 50 m des GR/GRP, exclusions | Arrêté n°2014-0007 |
| Cœur du PN de la Vanoise | Près d'une vingtaine de refuges, en été, sur réservation | Brochure « Bivouac » du parc (2025) |
| RN des Hauts-Plateaux du Vercors | Une nuit, 17 h – 9 h | Arrêté d'application, art. 15 |

## Sources, licences et accès (vérifiés le 2026-10-31)

| Donnée | Source | Licence | Accès |
|---|---|---|---|
| Itinéraires, eau, refuges, abris, campings, commerces, espaces protégés | OpenStreetMap via Overpass (build) | ODbL 1.0 | gratuit, usage raisonnable |
| Refuges, cabanes, points d'eau | [API Refuges.info](https://www.refuges.info/api/doc/) | CC BY-SA 2.0 | gratuit, sans clé |
| Altitudes | IGN Géoplateforme, calcul altimétrique (RGE ALTI) | Licence Ouverte 2.0 | sans clé, 5 req/s/IP |
| Fond de carte, estompage | IGN Plan IGN v2 (WMTS) ; OpenStreetMap | Licence Ouverte 2.0 ; ODbL | sans clé |
| Horaires | [transport.data.gouv.fr](https://transport.data.gouv.fr) : SNCF (TGV, Intercités, TER), FlixBus, BlaBlaCar Bus, réseaux régionaux et départementaux | ODbL ou Licence Ouverte 2.0 selon le jeu | gratuit |
| Gares | SNCF Open Data « Gares de voyageurs » | ODbL | gratuit |
| Tarifs | SNCF Open Data « Tarifs TGV INOUI et OUIGO », « Tarifs Intercités » | ODbL | gratuit |
| Notoriété | Wikidata, statistiques Wikimedia | CC0 / données publiques | gratuit |
| Météo (navigateur, sur demande) | Open-Meteo | CC BY 4.0, non commercial | gratuit |

Les dates de mise à jour de chaque jeu de données sont affichées dans l'application (bouton ⓘ).

### Limites connues

- **Tarifs TER et cars régionaux** : aucune grille ouverte à jour n'existe. Les jeux SNCF
  « Tarifs TER » régionaux ont été retirés en 2025 ; les copies data.gouv.fr sont archivées.
  Ces trajets affichent « prix non disponible : voir le site officiel », avec un lien. Les prix
  publiés dans les GTFS (`fare_attributes`) sont utilisés quand un réseau les fournit.
- **Péages** : pas de grille ouverte intégrée ; un lien sortant est proposé.
- **Espaces protégés** : les téléchargements INPN et le WFS associé étaient indisponibles au
  2026-10-31 (incident au MNHN). Les contours viennent d'OpenStreetMap en attendant.
- **Horaires** : l'horizon publié varie selon les réseaux (environ 3 mois pour les TER). Les
  navettes estivales n'apparaissent que lorsque leurs horaires sont publiés : le score
  d'accessibilité dépend donc de la saison du build.
- **Jeux d'horaires expirés** (Chemins de fer de la Corse : une seule semaine de mars 2026 ;
  navettes de Val d'Isère) : la dernière semaine publiée est répétée sur l'horizon et ces trajets
  sont marqués « horaire indicatif », avec un avertissement invitant à vérifier sur le site du
  transporteur.
- **Corse** : la traversée (ferry, avion) n'est pas couverte ; choisir comme départ une gare de
  l'île (Ajaccio et Bastia sont proches des ports, Calvi, Corte).
- **Tracé libre** : segments en ligne droite entre les clics (pas de routage sur le réseau de
  sentiers) ; l'altitude vient de la grille 250 m.

## Mettre à jour les données

Les données de `public/data/` sont versionnées. Pour les rafraîchir (nouveaux horaires, par
exemple), lancer `npm run data` (long : environ 10 minutes par massif), puis relancer l'application.

## Licence

Code sous licence MIT (voir `LICENSE`). Les données dérivées de `public/data/` restent sous la
licence de leur source (ODbL pour OpenStreetMap et les données SNCF / transport.data.gouv.fr,
CC BY-SA 2.0 pour Refuges.info, Licence Ouverte 2.0 pour l'IGN).
