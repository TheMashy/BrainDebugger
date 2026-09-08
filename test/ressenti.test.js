/*
 * L'ÉCHELLE SOUS LA QUESTION.
 *
 * Elle n'apparaît que sous une question qui porte sur MAINTENANT, et sur la
 * dernière prise de parole du compagnon. Ce fichier tient surtout le bord
 * étroit : une échelle proposée trop souvent transforme la conversation en
 * questionnaire, et un questionnaire, on cesse de l'ouvrir.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { demandeUnRessenti, proposerLechelle, FRAICHEUR_MS } from '../web/ressenti.js';

test('les façons de demander où tu en es, maintenant', () => {
  const oui = [
    'Comment tu te sens, là ?',
    'Tu te sens comment à cette heure-là ?',
    'Et là, ça va comment ?',
    'Où tu en es, ce soir ?',
    'Tu tiens comment ?',
    'Ça donne quoi là ?',
    'Tu dirais quoi, maintenant ?',
    'C’est à combien ?',
    'Un quart d’heure de douche. Comment tu te sens ?',
  ];
  for (const t of oui) assert.equal(demandeUnRessenti(t), true, t);
});

test('CE QUI N’EST PAS UNE QUESTION SUR MAINTENANT', () => {
  const non = [
    'Comment tu te sentais à ce moment-là ?',            // le passé
    'Comment ça allait hier soir ?',
    'Comment elle va, ta sœur ?',                        // quelqu’un d’autre
    'Comment tu expliques que ça revienne ?',            // une explication
    'Comment tu as tenu, cette nuit-là ?',
    'Tu as fumé à quelle heure ?',                       // autre chose
    'Ok. Rejoindre un vocal puis rouler, c’est un enchaînement que tu as déjà écrit.',
    'Comment tu te sens quand tu écris ça.',             // pas une question
  ];
  for (const t of non) assert.equal(demandeUnRessenti(t), false, t);
});

test('c’est la phrase interrogative qui décide, pas le message entier', () => {
  // « comment tu te sens » traîne trois phrases plus haut, mais la question
  // posée porte sur autre chose : proposer l'échelle répondrait à côté.
  assert.equal(demandeUnRessenti(
    'Tu m’avais dit comment tu te sens après une soirée. Tu as fumé à quelle heure ?'), false);
  assert.equal(demandeUnRessenti(
    'Tu as fumé à 23h, tu me disais. Et là, comment tu te sens ?'), true);
});

const msg = (o = {}) => ({ id: 7, role: 'assistant', text: 'Comment tu te sens, là ?',
                           ts: new Date().toISOString(), ...o });

test('seulement sous la DERNIÈRE prise de parole du compagnon', () => {
  assert.equal(proposerLechelle(msg(), { dernier: true }), true);
  assert.equal(proposerLechelle(msg(), { dernier: false }), false,
    'répondre à une question à laquelle on a déjà parlé après relèverait le mauvais instant');
});

test('jamais sous ce que la personne a écrit', () => {
  assert.equal(proposerLechelle(msg({ role: 'user' }), { dernier: true }), false);
});

test('on ne redemande pas ce qui a déjà été répondu', () => {
  assert.equal(proposerLechelle(msg(), { dernier: true, repondus: new Set([7]) }), false);
});

test('une question d’il y a six heures ne porte plus sur maintenant', () => {
  const vieux = new Date(Date.now() - FRAICHEUR_MS - 60_000).toISOString();
  assert.equal(proposerLechelle(msg({ ts: vieux }), { dernier: true }), false);
  const frais = new Date(Date.now() - 60_000).toISOString();
  assert.equal(proposerLechelle(msg({ ts: frais }), { dernier: true }), true);
});

test('un instant illisible ne fait pas disparaître l’échelle', () => {
  // Le repli de `heureDe` a déjà coûté une journée entière : ici, une date
  // qu'on ne sait pas lire ne doit pas non plus décider à la place de la règle.
  assert.equal(proposerLechelle(msg({ ts: 'n’importe quoi' }), { dernier: true }), true);
});
