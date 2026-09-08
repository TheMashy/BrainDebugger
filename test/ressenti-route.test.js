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
  assert.match(encore.erreur, /ne demande pas/);
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
