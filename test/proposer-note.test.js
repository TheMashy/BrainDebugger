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

test('QUAND L’OCCASION EST LÀ, LE BLOC DIT DE DEMANDER — et comment', () => {
  /*
   * Il disait « tu n'es pas obligé, et c'est important ». Mesuré sur quatre ans
   * de journal réel : 28 occasions données, et 8 messages du compagnon sur 486
   * formulaient la question de façon reconnaissable. L'échelle n'apparaissait
   * donc quasiment jamais, et ce qu'elle mesure — l'écart d'un moment à
   * l'autre — n'existait pas.
   *
   * Le bloc demande maintenant. Les freins qui comptent restent, et ils sont
   * ceux-là : jamais deux fois de suite, et jamais un mot sur ce qui l'a
   * suggéré.
   */
  const b = proposerNoteBlock({ demander: true, pourquoi: 'le ton vient de changer' });
  const plat = b.replace(/\s+/g, ' ');
  assert.match(plat, /Demande-lui où il en est LÀ/, 'le bloc ne demande plus rien');
  assert.match(plat, /EN CLAIR et sur MAINTENANT/,
    'sans consigne de formulation, la question est posée en allusion et l’échelle n’apparaît pas');
  assert.match(b, /questionnaire/);
  assert.match(b, /jamais deux fois de suite/);
  // Le texte est retourné à la ligne : on compare sans les blancs.
  assert.match(plat, /Ne dis jamais que quelque chose te l'a suggéré/,
    'savoir qu’un déclencheur existe suffirait à en parler, et commenter le déclencheur revient à commenter l’humeur');
  assert.equal(proposerNoteBlock({ demander: false }), null,
    'présent à chaque tour, il deviendrait du bruit');
});

/* =====================================================================
 *  LE TROISIÈME SIGNAL : UN PAN DE CONVERSATION QUI N'A RIEN RELEVÉ.
 *
 * Les deux premiers attendent un ÉVÉNEMENT — le ton bascule, la conversation
 * reprend — et une soirée ordinaire n'en produit aucun. Mesuré sur quatre ans
 * de journal réel : 152 tours sur 499 repartaient avec « rien n'a bougé ».
 *
 * Or ce qu'on mesure n'est pas l'événement, c'est l'ÉCART d'un moment à
 * l'autre. Trois quarts d'heure de conversation sans un seul relevé, c'est
 * exactement un écart qu'on ne saura pas relire demain.
 * ===================================================================== */

const fil = (...mins) => mins.map(([m, t]) => msg(m, t));

test('UNE SOIRÉE CALME FINIT PAR DONNER L’OCCASION', () => {
  // Rien ne bascule, rien ne reprend : sur l'ancienne règle, jamais.
  const o = occasionDeDemander(fil([0, CALME], [20, CALME], [50, CALME]), [],
                               T0 + 50 * 60000);
  assert.equal(o.demander, true, `refusé : ${o.pourquoi}`);
  assert.match(o.pourquoi, /rien n’a encore été relevé/);
});

test('mais pas au bout de dix minutes : on ne demande pas à quelqu’un qui vient de dire bonsoir', () => {
  const o = occasionDeDemander(fil([0, CALME], [10, CALME]), [], T0 + 10 * 60000);
  assert.equal(o.demander, false);
});

test('APRÈS UN RELEVÉ, ON SE TAIT — puis le pan recommence', () => {
  /*
   * Les deux moitiés d'une même durée. En deçà, redemander ne mesure pas un
   * écart, ça mesure une insistance ; au-delà, c'est un pan de conversation
   * que personne n'a mesuré. C'est pour ça que le pan repart du DERNIER
   * RELEVÉ quand il y en a un, et du premier mot de la conversation sinon.
   */
  const releves = [{ ts: new Date(T0 + 40 * 60000).toISOString() }];
  const tot = occasionDeDemander(fil([0, CALME], [60, CALME]), releves, T0 + 60 * 60000);
  assert.equal(tot.demander, false, 'vingt minutes après un relevé, il n’y a rien de neuf à mesurer');
  assert.match(tot.pourquoi, /vient de répondre/);

  const tard = occasionDeDemander(fil([0, CALME], [95, CALME]), releves, T0 + 95 * 60000);
  assert.equal(tard.demander, true, `refusé : ${tard.pourquoi}`);
  assert.match(tard.pourquoi, /depuis le dernier relevé/,
    'le pan est reparti du premier message : il compterait la soirée entière, relevé ou pas');
});

test('« ok » ne compte pas comme un moment, même après une heure', () => {
  const o = occasionDeDemander([...fil([0, CALME]), msg(90, 'ok')], [], T0 + 90 * 60000);
  assert.equal(o.demander, false);
  assert.match(o.pourquoi, /trop court/);
});

test('LE SIGNAL DU TEXTE GARDE SON PLANCHER DE MOTS, LES SIGNAUX DE L’HORLOGE NON', () => {
  /*
   * Ils ne lisent pas la même chose. Le ton se lit DANS le texte et il en faut
   * assez pour l'y voir ; le temps se lit sur l'horloge, où cinq mots valent
   * cinquante. Un seul plancher pour les deux, et les soirées où l'on écrit
   * court ne relèvent jamais rien.
   */
  assert.ok(FREINS.mots_min > FREINS.mots_min_horloge);
  const court = 'la journée a été rude quand même';   // < mots_min, > mots_min_horloge
  assert.ok(court.split(/\s+/).length < FREINS.mots_min);
  const o = occasionDeDemander([...fil([0, CALME]), msg(60, court)], [], T0 + 60 * 60000);
  assert.equal(o.demander, true, `refusé : ${o.pourquoi}`);
});

test('les freins passent toujours AVANT les signaux', () => {
  const complet = Array.from({ length: FREINS.par_jour },
    (_, i) => ({ ts: new Date(T0 + i * 60000).toISOString() }));
  const o = occasionDeDemander(fil([0, CALME], [200, CALME]), complet, T0 + 200 * 60000);
  assert.equal(o.demander, false, 'le plafond du jour ne tient plus');
  assert.match(o.pourquoi, /assez de relevés/);
});

test('desserrés, mais pas ouverts : les freins gardent des valeurs qui veulent dire quelque chose', () => {
  // Le compagnon n'est pas une infirmière de nuit : six sur une soirée reste
  // sous une fois l'heure, et trois quarts d'heure séparent deux relevés.
  assert.ok(FREINS.par_jour <= 6, 'au-delà, ce n’est plus un relevé, c’est un suivi horaire');
  assert.ok(FREINS.depuis_dernier_ms >= 30 * 60 * 1000);
  assert.ok(FREINS.pan_sans_releve_ms >= 30 * 60 * 1000);
});
