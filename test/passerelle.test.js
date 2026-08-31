/**
 * LA PASSERELLE. Ce qui sort du site vers une application locale, et ce qui n'en
 * sort JAMAIS.
 *
 * Cette route répond sans session : elle est appelée par un programme, pas par
 * un navigateur. Tout ce qui la protège est une clé, et tout ce qui protège le
 * journal est le contenu de la réponse. Les deux se testent ici.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.BD_DB = join(mkdtempSync(join(tmpdir(), 'bd-pass-')), 'test.db');

const { OWNER, setNote, addEvent, setSettings } = await import('../server/db.js');
const P = await import('../server/passerelle.js');

const jour = n => {
  const d = new Date(); d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
};

/* ============ LA CLÉ ============ */

test('une clé neuve est longue, unique, et recopiable', () => {
  const a = P.nouvelleCle(), b = P.nouvelleCle();
  assert.notEqual(a, b);
  assert.ok(a.length >= 24, 'une clé courte se devine');
  // base64url : rien qui casse dans une URL, rien à échapper dans un en-tête.
  assert.match(a, /^[A-Za-z0-9_-]+$/);
});

test('la comparaison ne dit rien de plus que oui ou non', () => {
  assert.equal(P.memeCle('abc', 'abc'), true);
  assert.equal(P.memeCle('abc', 'abd'), false);
  // Deux longueurs différentes ne se comparent même pas — `timingSafeEqual`
  // JETTE sur des tampons de tailles différentes, et une exception qui remonte
  // ici serait un 500 sur une clé simplement fausse.
  assert.equal(P.memeCle('abc', 'abcd'), false);
  assert.equal(P.memeCle('', 'abc'), false);
  assert.equal(P.memeCle(null, null), false);
});

test('la clé est lue aux trois endroits où l’application la met', () => {
  const u = new URL('http://x/api/machitool/attente?cle=parURL');
  assert.equal(P.cleDeLaRequete({ headers: { authorization: 'Bearer parBearer' } }, u), 'parBearer');
  assert.equal(P.cleDeLaRequete({ headers: { 'x-machitool-cle': 'parEntete' } }, u), 'parEntete');
  assert.equal(P.cleDeLaRequete({ headers: {} }, u), 'parURL');
  assert.equal(P.cleDeLaRequete({ headers: {} }, new URL('http://x/a')), null);
  // « bearer » en minuscules : certains clients ne respectent pas la casse, et
  // refuser pour ça ferait chercher du côté de la clé.
  assert.equal(P.cleDeLaRequete({ headers: { authorization: 'bearer x' } }, new URL('http://x/a')), 'x');
});

test('la clé désigne son journal, et une clé inconnue ne désigne personne', () => {
  const cle = P.poserCle(OWNER);
  assert.equal(P.proprietaireDeLaCle(cle), OWNER);
  assert.equal(P.proprietaireDeLaCle('pas la bonne'), null);
  assert.equal(P.proprietaireDeLaCle(''), null);
  assert.equal(P.proprietaireDeLaCle(null), null);

  // Retirée, elle ne désigne plus rien — et surtout, la chaîne vide qui reste
  // en base ne doit pas se mettre à répondre « oui » à une requête sans clé.
  P.retirerCle(OWNER);
  assert.equal(P.proprietaireDeLaCle(cle), null);
  assert.equal(P.proprietaireDeLaCle(''), null);
});

/* ============ LES COULEURS ============ */

test('une note sort en hexadécimal, et une journée non notée n’a pas de couleur', () => {
  // La lampe ne sait pas lire `rgb(...)` ni `var(--line)`.
  assert.match(P.couleurDeNote(8), /^#[0-9A-F]{6}$/);
  assert.match(P.couleurDeNote(2), /^#[0-9A-F]{6}$/);
  assert.equal(P.couleurDeNote(null), null);
  assert.equal(P.couleurDeNote(undefined), null);
  // Haut et bas ne se confondent pas : c'est tout ce que la lampe montre.
  assert.notEqual(P.couleurDeNote(9), P.couleurDeNote(1));
});

test('chaque ambiance a sa couleur, et aucune n’est oubliée', async () => {
  const { SENS } = await import('../server/mood.js');
  for (const scene of Object.keys(SENS)) {
    assert.match(P.COULEUR_SCENE[scene] ?? '', /^#[0-9A-F]{6}$/i,
                 `la scène « ${scene} » n'a pas de couleur — la lampe s'éteindrait dessus`);
  }
});

/* ============ CE QUI SORT ============ */

test('la journée notée l’emporte sur l’ambiance : le mesuré passe devant le deviné', () => {
  setNote(jour(0), 9, OWNER);
  const h = P.humeurPour(OWNER, { scene: 'abyss', force: 3 });
  assert.equal(h.valeur, 9);
  assert.equal(h.libelle, '9/10');
  assert.equal(h.couleur, P.couleurDeNote(9));
  assert.notEqual(h.couleur, P.COULEUR_SCENE.abyss);
});

test('sans note du jour, l’ambiance donne la couleur et le sens', () => {
  const h = P.humeurPour('personne-sans-journal', { scene: 'monolith', force: 2 });
  assert.equal(h.valeur, null);
  assert.equal(h.couleur, P.COULEUR_SCENE.monolith);
  assert.ok(h.libelle.length > 3, 'un libellé vide ne dit rien à afficher');
});

test('les rappels ne parlent que de ce que personne ne peut faire à ta place', () => {
  const r = P.rappelsPour('journal-vide', new Date());
  assert.equal(r.length, 1);
  assert.match(r[0].titre, /noté/i);
  assert.ok(r[0].id, 'sans identifiant, l’application ne peut pas marquer comme lu');
});

test('une journée d’hier notée fait taire le rappel', () => {
  setNote(jour(1), 6, 'journal-hier');
  setNote(jour(0), 6, 'journal-hier');
  assert.deepEqual(P.rappelsPour('journal-hier', new Date()), []);
});

test('un repère sort dans la couleur de SA journée, pas dans une couleur de thème', () => {
  setNote('2024-03-12', 3, 'journal-rep');
  addEvent({ date: '2024-03-12', label: 'rupture', userId: 'journal-rep' });
  addEvent({ date: '2024-06-01', label: 'déménagement', teinte: 258, userId: 'journal-rep' });
  const r = P.reperesPour('journal-rep');
  const rupture = r.find(x => x.titre === 'rupture');
  assert.equal(rupture.couleur, P.couleurDeNote(3), 'la mesure passe devant la déclaration');
  // Journée non notée : la teinte déclarée prend le relais, en hexadécimal.
  const demenagement = r.find(x => x.titre === 'déménagement');
  assert.match(demenagement.couleur, /^#[0-9A-F]{6}$/);
});

test('LE JOURNAL NE PASSE PAS', () => {
  /*
   * LA GARDE QUI COMPTE. Une guirlande qui montrerait le texte du soir serait
   * une fuite avec un joli nom — et le tuyau est ouvert sans session, sur une
   * simple clé, vers un programme qu'on ne contrôle pas.
   *
   * On vérifie donc la FORME de la réponse, pas son contenu : aucune clé
   * inattendue ne peut apparaître sans casser ce test, y compris ajoutée par
   * quelqu'un qui aurait oublié pourquoi cette route existe.
   */
  setNote(jour(0), 7, 'journal-fuite');
  const a = P.attente('journal-fuite', { ambiance: { scene: 'brume', force: 1 } });
  assert.deepEqual(Object.keys(a).sort(),
                   ['humeur', 'jours', 'lecture', 'rappels', 'reperes']);
  assert.deepEqual(Object.keys(a.humeur).sort(), ['couleur', 'date', 'libelle', 'valeur']);
  for (const j of a.jours) assert.deepEqual(Object.keys(j).sort(), ['couleur', 'date', 'note']);
  for (const r of a.reperes) assert.deepEqual(Object.keys(r).sort(), ['couleur', 'date', 'titre']);
  for (const r of a.rappels) assert.deepEqual(Object.keys(r).sort(), ['id', 'texte', 'titre']);
  // Et rien, nulle part, qui ressemble au texte d'une journée.
  const tout = JSON.stringify(a);
  assert.equal(/"text"|"texte_journal"|"message"|"synthese"/.test(tout), false);
});

test('les journées envoyées sont bornées : une lampe n’a pas besoin de quatre ans', () => {
  for (let i = 0; i < 90; i++) setNote(jour(i), 5, 'journal-long');
  const j = P.joursPour('journal-long');
  assert.equal(j.length, P.JOURS_ENVOYES);
  // Les plus RÉCENTES : une bande qui s'arrête il y a deux mois ne montre rien.
  assert.equal(j[j.length - 1].date, jour(0));
});
