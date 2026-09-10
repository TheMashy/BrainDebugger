/*
 * POSER UN RESSENTI, DE BOUT EN BOUT.
 *
 * La route est le seul endroit où un chiffre entre dans le journal sans que
 * personne ne l'ait tapé : elle doit donc refuser tout ce qui n'est pas une
 * réponse à une vraie question. Sans ce garde-fou, n'importe quel appel
 * poserait un point sur n'importe quel message, et l'amplitude de la journée
 * compterait des valeurs qui ne veulent rien dire.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.BD_DB = join(mkdtempSync(join(tmpdir(), 'bd-ress-')), 'test.db');
const { OWNER, addMessage, relevesDuJour, relevesDeToi, amplitude } = await import('../server/db.js');
const { routes } = await import('../server/api.js');

const AUJ = new Date().toISOString().slice(0, 10);
const ecrire = (role, text) => addMessage({ ts: new Date().toISOString(), date: AUJ, source: 'web', role, text, userId: OWNER });
const poser = (messageId, valeur) => routes['POST /api/releve']({ body: { messageId, valeur }, userId: OWNER });

test('la question du compagnon reçoit un ressenti', async () => {
  ecrire('user', 'là je suis en train de prendre une douche');
  const q = ecrire('assistant', 'Comment tu te sens, là ?');
  const r = await poser(q, 7);
  assert.equal(r.ok, true);
  assert.equal(r.releve.valeur, 7);
  assert.equal(r.releve.source, 'toi');
  assert.deepEqual(relevesDeToi([q], OWNER).map(x => x.valeur), [7]);
});

test('on ne répond pas deux fois à la même question', async () => {
  const q = ecrire('assistant', 'Tu te sens comment ?');
  assert.equal((await poser(q, 4)).ok, true);
  const encore = await poser(q, 9);
  // Le refus est maintenant nommé pour ce qu'il est : la question n'a pas
  // changé de nature, c'est le MÊME INSTANT qu'on relèverait deux fois.
  assert.match(encore.erreur, /viens de le poser/);
  assert.equal(relevesDeToi([q], OWNER).length, 1, 'un seul relevé, pas deux');
});

test('UN MESSAGE QUI NE DEMANDE RIEN EST REFUSÉ', async () => {
  const m = ecrire('assistant', 'Ok. Rejoindre un vocal puis rouler, tu l’as déjà écrit.');
  assert.match((await poser(m, 5)).erreur, /ne demande pas/);
  assert.equal(relevesDeToi([m], OWNER).length, 0);
});

test('on ne pose pas un ressenti sur ce que TU as écrit', async () => {
  const m = ecrire('user', 'comment tu te sens toi ?');
  assert.match((await poser(m, 5)).erreur, /ne demande pas/);
});

test('une question à laquelle on a déjà parlé après ne compte plus', async () => {
  const q = ecrire('assistant', 'Où tu en es ?');
  ecrire('user', 'ça va mieux');
  ecrire('assistant', 'Ok.');                       // il a repris la parole depuis
  assert.match((await poser(q, 6)).erreur, /ne demande pas/,
    'ce serait relever un instant qui n’est plus le présent');
});

test('une valeur illisible ou un message inconnu ne posent rien', async () => {
  const q = ecrire('assistant', 'Ça donne quoi là ?');
  assert.match((await poser(q, 'beaucoup')).erreur, /valeur/);
  assert.match((await poser(999999, 5)).erreur, /plus dans le fil/);
  assert.equal(relevesDeToi([q], OWNER).length, 0);
});

test('les valeurs sont bornées à 0..10', async () => {
  const q = ecrire('assistant', 'Tu tiens comment ?');
  assert.equal((await poser(q, 42)).releve.valeur, 10);
});

test('DEUX RESSENTIS DANS LA MÊME JOURNÉE FONT UNE AMPLITUDE', () => {
  /* C'est tout l'objet : deux réponses dans la même soirée disent à quelle
     vitesse ça bouge, ce qu'aucune note de fin de journée ne dit. */
  const a = amplitude(AUJ, OWNER);
  assert.ok(a && a.ecart > 0, `deux relevés au moins doivent donner un écart : ${JSON.stringify(a)}`);
  assert.ok(relevesDuJour(AUJ, OWNER).length >= 2);
});

/* =====================================================================
 *  LE RELEVÉ QU'ON POSE SOI-MÊME, SANS QU'ON L'AIT DEMANDÉ.
 *
 * L'échelle n'existait que sous la question du compagnon. Mesuré sur quatre
 * ans de journal réel, il ne la formulait de façon reconnaissable que sur 8
 * de ses 486 messages — 1,6 %. Attendre qu'il la pose, c'est ne jamais rien
 * relever ; le bouton du champ de saisie ouvre la même échelle à tout moment.
 * ===================================================================== */

const poserSeul = valeur => routes['POST /api/releve']({ body: { valeur }, userId: OWNER });

test('SANS QUESTION, LE RELEVÉ PASSE QUAND MÊME', async () => {
  ecrire('user', 'je sors de deux heures de scroll');
  const dernier = ecrire('assistant', 'Ok. Rejoindre un vocal, tu l’as déjà écrit.');
  const r = await poserSeul(6);
  assert.equal(r.ok, true, `refusé : ${r.erreur}`);
  assert.equal(r.releve.source, 'toi', 'un relevé posé à la main n’est pas une estimation du modèle');
  assert.equal(r.messageId, dernier,
    'il ne s’accroche pas au dernier message : le chiffre s’afficherait sous une autre bulle que celle où il a été posé');
});

test('le même instant ne se relève pas deux fois', async () => {
  ecrire('user', 'et là je sais plus quoi faire');
  ecrire('assistant', 'Tu veux en dire plus ?');
  assert.equal((await poserSeul(4)).ok, true);
  const encore = await poserSeul(9);
  assert.match(encore.erreur, /viens de le poser/,
    'rien n’a été dit entre les deux : ce serait deux clics, pas un écart');
});

test('la valeur reste la seule chose obligatoire, et elle est vérifiée', async () => {
  ecrire('assistant', 'Et ensuite ?');
  assert.match((await poserSeul('bof')).erreur, /valeur/);
  assert.match((await routes['POST /api/releve']({ body: {}, userId: OWNER })).erreur, /valeur/);
});

test('la route rend le message AUQUEL elle a accroché, elle ne le fait pas deviner', async () => {
  /*
   * La page affiche la pastille sous la bulle que le serveur nomme. Si elle
   * refaisait le calcul de son côté, le chiffre s'afficherait sous une bulle
   * et serait enregistré sous une autre le jour où le fil a bougé entre-temps.
   */
  ecrire('user', 'bon');
  const dernier = ecrire('assistant', 'Bon ?');
  const r = await poserSeul(2);
  assert.equal(r.messageId, dernier);
  assert.deepEqual(relevesDeToi([dernier], OWNER).map(x => x.valeur), [2]);
});
