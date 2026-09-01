/**
 * RETISSER : le battement, et ce qui le consomme.
 *
 * Deux fois par jour, douze heures entre les deux. Ce n'est pas d'abord une
 * limite de coût — une lecture de fond vaut entre dix-huit et soixante
 * centimes. C'est que RIEN NE CHANGE en une heure : une toile qu'on peut
 * refaire à volonté devient un bouton qu'on presse en attendant qu'il dise
 * autre chose, et une lecture qu'on rejoue jusqu'à ce qu'elle plaise n'est
 * plus une lecture.
 *
 * CE FICHIER EXISTE À CAUSE D'UNE PANNE MUETTE. `setSettings` ignore en silence
 * toute clé absente de `DEFAULT_SETTINGS` : `dernierRetissage` n'y était pas,
 * l'écriture ne levait rien, ne cassait rien — et le battement n'aurait tout
 * simplement jamais pris. Aucun test ne l'aurait vu, parce que le chemin normal
 * ne repasse jamais deux fois dessus dans la même seconde.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.BD_DB = join(mkdtempSync(join(tmpdir(), 'bd-retis-')), 'test.db');

const { OWNER, setSettings, getSettings, DEFAULT_SETTINGS } = await import('../server/db.js');
const api = await import('../server/api.js');

test('le champ du battement EXISTE dans les réglages par défaut', () => {
  /*
   * La garde qui manquait. `setSettings` filtre sur `DEFAULT_SETTINGS` : un
   * réglage oublié là s'écrit dans le vide. Le test ne vérifie pas une valeur,
   * il vérifie que la clé est déclarée — c'est ça, la panne.
   */
  assert.ok('dernierRetissage' in DEFAULT_SETTINGS,
    'dernierRetissage n’est pas déclaré : setSettings l’ignorera en silence');
});

test('ce qu’on écrit dans le battement se relit', () => {
  const q = new Date().toISOString();
  setSettings({ dernierRetissage: q }, OWNER);
  assert.equal(getSettings(OWNER).dernierRetissage, q, 'l’écriture n’a pas pris');
});

test('douze heures, et le temps restant se dit en clair', () => {
  assert.equal(api.RETISSAGE_ATTENTE, 12 * 3600 * 1000);

  setSettings({ dernierRetissage: null }, OWNER);
  assert.equal(api.attenteRetissage(OWNER), 0, 'sans retissage passé, c’est ouvert');

  // Il y a une heure : il reste onze heures, à la seconde près.
  setSettings({ dernierRetissage: new Date(Date.now() - 3600e3).toISOString() }, OWNER);
  const reste = api.attenteRetissage(OWNER);
  assert.ok(Math.abs(reste - 11 * 3600e3) < 5000, `il reste ${reste} ms`);

  // Il y a treize heures : c'est rouvert.
  setSettings({ dernierRetissage: new Date(Date.now() - 13 * 3600e3).toISOString() }, OWNER);
  assert.equal(api.attenteRetissage(OWNER), 0);
});

test('une date illisible n’enferme personne', () => {
  /*
   * Un champ corrompu — une migration, une écriture à la main — ne doit pas
   * fermer la porte pour toujours. En cas de doute on ouvre : le pire qui
   * arrive est un retissage de trop, contre une fonction inaccessible à vie.
   */
  setSettings({ dernierRetissage: 'nawak' }, OWNER);
  assert.equal(api.attenteRetissage(OWNER), 0);
  setSettings({ dernierRetissage: null }, OWNER);
});

test('le battement refuse AVANT de dépenser quoi que ce soit', async () => {
  /*
   * L'ordre compte : le refus doit tomber avant le corpus et avant l'appel au
   * modèle. Un refus qui arrive après aurait déjà payé la lecture.
   */
  setSettings({ dernierRetissage: new Date().toISOString() }, OWNER);
  const vus = [];
  await api.retisser({}, (ev, d) => vus.push([ev, d]), OWNER);
  assert.deepEqual(vus.map(v => v[0]), ['refus'], `événements reçus : ${vus.map(v => v[0])}`);
  assert.ok(vus[0][1].attente > 0);
  setSettings({ dernierRetissage: null }, OWNER);
});

test('sans journal, ça le dit — et ça ne consomme pas le tour', async () => {
  // La base de ce fichier est vide : c'est exactement le cas.
  const vus = [];
  await api.retisser({}, (ev, d) => vus.push([ev, d]), OWNER);
  assert.equal(vus[0][0], 'erreur');
  assert.match(vus[0][1].error, /journées écrites|rien à lire/);
  /*
   * ET LE TOUR RESTE ENTIER. Un retissage qui échoue — pas assez de journal,
   * une coupure de réseau, un modèle qui refuse — ne doit pas coûter les douze
   * heures. Sinon la seule façon de perdre sa journée est que ça rate.
   */
  assert.equal(api.attenteRetissage(OWNER), 0, 'un échec a consommé le tour');
  assert.equal(getSettings(OWNER).dernierRetissage, null);
});

test('la route de lecture dit combien de temps il reste', () => {
  setSettings({ dernierRetissage: new Date(Date.now() - 2 * 3600e3).toISOString() }, OWNER);
  const r = api.routes['GET /api/lecture'];
  assert.ok(typeof r === 'function');
  // Elle est async et touche la base ; on vérifie ici la seule chose qui nous
  // regarde : que le calcul qu'elle expose est bien celui-là.
  assert.ok(Math.abs(api.attenteRetissage(OWNER) - 10 * 3600e3) < 5000);
  setSettings({ dernierRetissage: null }, OWNER);
});
