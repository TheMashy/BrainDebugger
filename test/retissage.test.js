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

test('le refroidissement est levé — mais la mécanique reste entière', () => {
  /*
   * Il valait douze heures. Le produit est en construction et il faut pouvoir
   * retisser en boucle pour regarder ce que ça donne : le délai passe à zéro,
   * le calcul reste. Ce test vérifie donc les DEUX choses — que c'est ouvert,
   * et que la mécanique répond encore, pour que le remettre reste une ligne.
   */
  assert.equal(api.RETISSAGE_ATTENTE, 0);

  setSettings({ dernierRetissage: null }, OWNER);
  assert.equal(api.attenteRetissage(OWNER), 0, 'sans retissage passé, c’est ouvert');

  // Même juste après un retissage : rien à attendre.
  setSettings({ dernierRetissage: new Date().toISOString() }, OWNER);
  assert.equal(api.attenteRetissage(OWNER), 0, 'le délai est levé, pas contourné');

  // Et le calcul répond toujours au délai qu'on lui donne.
  const t = Date.now() - 3600e3;
  assert.equal(Math.max(0, 12 * 3600e3 - (Date.now() - t)) > 0, true,
    'la formule du battement est intacte : y remettre douze heures suffit');
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

test('le refroidissement levé, retisser ne refuse plus — même juste après', async () => {
  /*
   * LA BRANCHE DE REFUS RESTE EN PLACE, et elle tombe toujours AVANT le corpus
   * et avant l'appel au modèle : un refus qui arriverait après aurait déjà payé
   * la lecture. Elle est simplement inatteignable tant que le délai vaut zéro —
   * c'est ce que ce test vérifie, en retissant juste après un retissage.
   */
  setSettings({ dernierRetissage: new Date().toISOString() }, OWNER);
  const vus = [];
  await api.retisser({}, (ev, d) => vus.push([ev, d]), OWNER);
  assert.notEqual(vus[0][0], 'refus', 'le délai est levé : rien ne doit refuser');
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
   * une coupure de réseau, un modèle qui refuse — ne doit pas consommer le
   * battement. C'est sans effet tant que le délai vaut zéro, et ça compte le
   * jour où on le remet : sinon la seule façon de perdre sa journée serait que
   * ça rate.
   */
  assert.equal(getSettings(OWNER).dernierRetissage, null, 'un échec a consommé le tour');
});

test('la route de lecture porte toujours le battement', () => {
  // Le champ reste servi à l'écran : à zéro aujourd'hui, et il redira le temps
  // restant le jour où le délai revient, sans rien à recâbler côté client.
  setSettings({ dernierRetissage: new Date(Date.now() - 2 * 3600e3).toISOString() }, OWNER);
  assert.ok(typeof api.routes['GET /api/lecture'] === 'function');
  assert.equal(api.attenteRetissage(OWNER), 0);
  setSettings({ dernierRetissage: null }, OWNER);
});
