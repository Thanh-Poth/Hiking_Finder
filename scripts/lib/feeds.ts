// Jeux GTFS utilisés (transport.data.gouv.fr). Licences vérifiées le 2026-10-30.
// Les URL pointent vers la ressource « stable » de data.gouv.fr ou transport.data.gouv.fr.

export interface Feed {
  id: string;
  name: string;
  /** Identifiant du jeu sur transport.data.gouv.fr. */
  dataset: string;
  /** Une ou plusieurs ressources GTFS (fusionnées). */
  url: string | string[];
  licence: 'ODbL' | 'Licence Ouverte 2.0';
  /** Jeux nationaux : utilisés pour tous les massifs. */
  national?: boolean;
}

const DG = 'https://www.data.gouv.fr/api/1/datasets/r/';
const TDG = 'https://transport.data.gouv.fr/resources/';

export const FEEDS: Feed[] = [
  { id: 'sncf', name: 'SNCF TGV, Intercités et TER', dataset: '6853c089b3ed5781f6adfdf7', url: DG + '9ae758ec-cd7a-40cd-a890-bb3963224942', licence: 'ODbL', national: true },
  { id: 'flixbus', name: 'FlixBus et FlixTrain', dataset: '5c6ad5248b4c411c3d7ae435', url: DG + '30d94e83-48a4-4c44-8a96-c082377f5221', licence: 'ODbL', national: true },
  { id: 'blablacar', name: 'BlaBlaCar Bus', dataset: '5cdef3698b4c416d21fd76b9', url: DG + 'fd54f81f-4389-4e73-be75-491133d011c3', licence: 'ODbL', national: true },
  { id: 'fluo67', name: 'Fluo Grand Est – Bas-Rhin (67)', dataset: '63b4c3d306d317f5caa80dcf', url: TDG + '80417/download', licence: 'Licence Ouverte 2.0' },
  { id: 'fluo68', name: 'Fluo Grand Est – Haut-Rhin (68)', dataset: '63b4c3d374694a83b49dde9d', url: TDG + '80419/download', licence: 'Licence Ouverte 2.0' },
  { id: 'fluo88', name: 'Fluo Grand Est – Vosges (88)', dataset: '63b4c3d3d7857ab0c49dde9d', url: TDG + '80429/download', licence: 'Licence Ouverte 2.0' },
  { id: 'mobigo', name: 'Mobigo (Jura, Doubs, lignes régionales)', dataset: '5f2c9a79e4e713875a58be26', url: [DG + '4001fba7-6078-4345-8859-f424b787c3a7', DG + 'a5f952a8-e0d1-439d-9881-b98fb6c202bb', DG + '28d3c8bf-97f7-40ed-be9f-00e737f74757'], licence: 'Licence Ouverte 2.0' },
  { id: 'haute-savoie', name: 'Réseau interurbain Haute-Savoie (74)', dataset: '607861844a84ad655a94f8c5', url: DG + '71926816-92f8-4620-8b8f-e1804f645e26', licence: 'ODbL' },
  { id: 'savoie', name: 'Réseau interurbain Savoie (73)', dataset: '607862da7487e5d490677f14', url: [DG + '4b74f1b9-fcc0-4e59-bf48-7ed4102e5222', DG + '3f74ea07-5385-467c-be4c-74bca2404333'], licence: 'ODbL' },
  { id: 'chamonix', name: 'Réseau urbain Chamonix', dataset: '6569e1dd21f63c926518143b', url: DG + '83a2f241-a0a4-4901-b77b-8a71572a9f6a', licence: 'Licence Ouverte 2.0' },
  { id: 'val-isere', name: "Navettes saisonnières Val d'Isère", dataset: '6798942abc43332729738b53', url: DG + 'd6c3eae8-fab6-4ff2-adc2-32bb2d213dd7', licence: 'Licence Ouverte 2.0' },
  { id: 'isere', name: 'Réseau interurbain Isère (38)', dataset: '5bb1caa6634f4136693d9053', url: DG + '40ee9d6c-3bb9-409e-b670-986212de63f2', licence: 'ODbL' },
  { id: 'transaltitude', name: 'Navettes saisonnières Transaltitude (Isère)', dataset: '678d0721a9efa066b6eed606', url: DG + '932fb155-53d5-4717-87e0-b42fe3aa538b', licence: 'ODbL' },
  { id: 'drome', name: 'Réseau interurbain Drôme (26)', dataset: '607860847e79b65f245982db', url: DG + 'fda59af2-0eb3-4a8a-8e59-593f768f836a', licence: 'ODbL' },
  { id: 'zou-express', name: 'ZOU ! Express (Région Sud)', dataset: '668d0a08a847603d391cbed7', url: DG + '1164d75b-4a9f-4c5a-b765-31d861b34fda', licence: 'Licence Ouverte 2.0' },
  { id: 'zou-proximite', name: 'ZOU ! Proximité (Région Sud)', dataset: '668d0a18a847603d391cbeec', url: DG + '9c8116cb-2f1a-4045-b149-c5bf6cae6bef', licence: 'Licence Ouverte 2.0' },
  { id: 'lignes-azur', name: "Lignes d'Azur", dataset: '685181f3733800e180c475fa', url: DG + 'f5678ab2-c863-4b48-ba1f-9021c7d97634', licence: 'Licence Ouverte 2.0' },
  { id: 'lio', name: 'liO Occitanie', dataset: '647148f898aadb3cec613674', url: DG + 'd747fe79-2915-4cdd-8cc5-51a810baaca5', licence: 'ODbL' },
  { id: 'pyrenees-atlantiques', name: 'Réseau interurbain Pyrénées-Atlantiques (64)', dataset: '632a56a70dfc531954eacfa5', url: DG + '44806d1e-0798-40e6-8e7e-21d0ddfe81d2', licence: 'ODbL' },
  { id: 'cantal', name: 'Réseau interurbain Cantal (15)', dataset: '6082bcd3f3187a37252532bd', url: DG + '2053f06d-439c-43fe-87fb-528179a8502e', licence: 'ODbL' },
  { id: 'puy-de-dome', name: 'Réseau interurbain Puy-de-Dôme (63)', dataset: '6082dacfd1d05e89970795f5', url: DG + 'fff9c08f-6172-4c94-b46e-c0144ae0bd10', licence: 'ODbL' },
  { id: 'ardeche', name: 'Réseau interurbain Ardèche (07)', dataset: '60785d62ee7e37e2041a9c6a', url: DG + '4e69fff6-6ae5-4ac0-9fa4-9c24ac92f291', licence: 'ODbL' },
  { id: 'corse', name: 'Réseau interurbain Corse', dataset: '6425dda513316bf1ecaf7e4a', url: DG + 'fe20cb23-34b8-4965-acf7-1b28bf966891', licence: 'Licence Ouverte 2.0' },
  { id: 'cf-corse', name: 'Chemins de fer de la Corse', dataset: '6425def83ddb5f9cfd9652b2', url: DG + '69c3db8a-a5fd-471f-b59f-46b9faded381', licence: 'Licence Ouverte 2.0' },
];

export const feedById = (id: string) => FEEDS.find((f) => f.id === id);
