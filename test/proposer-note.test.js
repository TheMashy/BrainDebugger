/*
 * QUAND LE COMPAGNON A LE DROIT DE DEMANDER OÙ QUELQU'UN EN EST.
 *
 * L'échelle sous la bulle existait déjà ; il manquait ce qui décide de poser la
 * question. Demandé sans règle, il la poserait tout le temps — et une
 * conversation où l'on est régulièrement invité à se chiffrer devient un
 * questionnaire, qui ne s'ouvre pas un mauvais soir, c'est-à-dire précisément
 * les soirs qui comptent.
 *
 * Ces tests portent donc surtout sur les FREINS. Un signal manqué ne coûte
 * rien ; une question de trop coûte la conversation.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { occasionDeDemander, proposerNoteBlock, FREINS } from '../server/proposer-note.js';

const T0 = Date.parse('2026-09-08T21:00:00.000Z');
const msg = (min, texte, role = 'user') => ({
  id: min, role, text: texte, ts: new Date(T0 + min * 60000).toISOString() });

const CALME = 'on a mangé tranquillement et j’ai regardé un documentaire sur les volcans';
/* Ce que la veille voit VRAIMENT : le danger, pas le ton. « je suis vide, plus
   rien ne me fait envie » lui est transparent — c'est la limite du signal, elle
   est assumée dans proposer-note.js et vérifiée plus bas. */
const SOMBRE = 'je me sens vraiment mal ce soir et j’ai envie de disparaître';
const PLAT = 'je suis vide, plus rien ne me fait envie, je tourne en rond depuis des heures';

test('le ton qui change est une occasion', () => {
  const o = occasionDeDemander([msg(0, CALME), msg(5, CALME), msg(10, SOMBRE)], [], T0 + 11 * 60000);
  assert.equal(o.demander, true);
  assert.match(o.pourquoi, /ton/);
});

test('rien qui bouge, rien à demander', () => {
  const o = occasionDeDemander([msg(0, CALME), msg(5, CALME), msg(10, CALME)], [], T0 + 11 * 60000);
  assert.equal(o.demander, false);
  assert.equal(o.pourquoi, 'rien n’a bougé');
});

test('la conversation qui reprend après deux heures est un autre moment', () => {
  const o = occasionDeDemander([msg(0, CALME), msg(200, CALME)], [], T0 + 201 * 60000);
  assert.equal(o.demander, true);
  assert.match(o.pourquoi, /coupure/);
});

test('on ne redemande pas dans la foulée', () => {
  const releves = [{ ts: new Date(T0 + 10 * 60000).toISOString() }];
  const o = occasionDeDemander([msg(0, CALME), msg(5, CALME), msg(11, SOMBRE)], releves, T0 + 12 * 60000);
  assert.equal(o.demander, false,
    'deux relevés à cinq minutes d’écart ne mesurent pas un écart, ils mesurent une insistance');
});

test('trois fois par jour au maximum', () => {
  const releves = Array.from({ length: FREINS.par_jour }, (_, i) =>
    ({ ts: new Date(T0 - (i + 4) * 3600000).toISOString() }));
  const o = occasionDeDemander([msg(0, CALME), msg(5, CALME), msg(10, SOMBRE)], releves, T0 + 11 * 60000);
  assert.equal(o.demander, false, 'au-delà ce n’est plus un relevé, c’est un suivi horaire');
});

test('on ne demande pas quand c’est le compagnon qui vient de parler', () => {
  const o = occasionDeDemander([msg(0, CALME), msg(10, SOMBRE), msg(11, 'je t’écoute.', 'assistant')],
                               [], T0 + 12 * 60000);
  assert.equal(o.demander, false);
  assert.match(o.pourquoi, /vient de parler/);
});

test('un message trop court ne dit pas encore qu’il s’est passé quelque chose', () => {
  const o = occasionDeDemander([msg(0, CALME), msg(5, CALME), msg(10, 'ouais bof')], [], T0 + 11 * 60000);
  assert.equal(o.demander, false);
});

test('la veille voit le danger, pas le ton — et c’est une limite assumée', () => {
  const o = occasionDeDemander([msg(0, CALME), msg(5, CALME), msg(10, PLAT)], [], T0 + 11 * 60000);
  assert.equal(o.demander, false,
    'ajouter ici un détecteur de ton reviendrait à inventer une heuristique que ' +
    'personne n’a validée, dans un produit où elle déciderait quand demander à ' +
    'quelqu’un de se chiffrer — on préfère rater');
});

test('le bloc est un fait, pas un ordre — et il dit de ne pas insister', () => {
  const b = proposerNoteBlock({ demander: true, pourquoi: 'le ton vient de changer' });
  assert.match(b, /pas une consigne/);
  assert.match(b, /Tu n'es pas obligé/);
  assert.match(b, /questionnaire/);
  assert.match(b, /jamais deux fois de suite/);
  // Le texte est retourné à la ligne : on compare sans les blancs.
  assert.match(b.replace(/\s+/g, ' '), /ne dis pas que quelque chose te l'a suggéré/,
    'savoir qu’un déclencheur existe suffirait à en parler, et commenter le déclencheur revient à commenter l’humeur');
  assert.equal(proposerNoteBlock({ demander: false }), null,
    'présent à chaque tour, il deviendrait du bruit');
});
