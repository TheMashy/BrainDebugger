/*
 * UNE NOTE ÉCRITE DANS LA CONVERSATION EST UNE NOTE.
 *
 * « ressenti avant de m'endormir 1/10 là » : écrit noir sur blanc le 8
 * septembre, et absent partout — ni dans les humeurs de la journée, ni dans
 * l'amplitude, ni dans rien de ce qui se compte. Le compagnon a bien un outil
 * pour poser un relevé, mais c'est LUI qui décide de s'en servir : hors ligne,
 * distrait, ou simplement occupé à répondre, il ne le fait pas.
 *
 * L'extracteur en rate exprès, et beaucoup. Un relevé inventé entre dans
 * l'amplitude d'une journée, déplace une courbe, et se relit plus tard comme
 * quelque chose que la personne aurait dit d'elle-même. Rater un « ça va
 * moyen » ne coûte rien ; fabriquer un « 8/10 » à partir d'une note de film
 * coûte une journée falsifiée.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.BD_DB = join(mkdtempSync(join(tmpdir(), 'bd-note-')), 'test.db');

const { upsertUser, addMessage, relevesDuJour } = await import('../server/db.js');
const { noteDiteDans } = await import('../server/jour-vecu.js');
const { noterNoteDite, relireLesNotesDites } = await import('../server/api.js');

const LA_PHRASE = "j'ai plus l'impression d'avoir de force, je fais plus d'efforts " +
  "pour le travail, pour l'avenir, j'ai l'impression de vivre comme si je n'avais " +
  "plus de futur en allant au lit ( mtn ) c'est le fond ouais ressenti avant de " +
  "m'endormir 1/10 là";

test('la phrase qui a motivé tout ceci est reconnue', () => {
  const n = noteDiteDans(LA_PHRASE);
  assert.equal(n.valeur, 1);
  assert.match(n.extrait, /ressenti avant de m’?'?endormir 1\/10/,
    'l’extrait porte ce qui l’a fait reconnaître : un relevé doit être contestable');
});

test('« si je » vingt mots plus tôt ne parle pas du chiffre', () => {
  /*
   * Le garde « ce n'est pas maintenant » appliqué au message entier refusait
   * exactement cette phrase. C'est le raisonnement que le fichier tient déjà
   * pour la négation : elle se cherche à côté du verbe, pas dans la phrase
   * entière. Un message long et réfléchi en contient forcément un.
   */
  assert.ok(noteDiteDans(LA_PHRASE));
  assert.equal(noteDiteDans("d'habitude je suis à 2/10"), null,
    'près du chiffre, en revanche, il compte');
});

test('les trois pièges, et le premier est français', () => {
  assert.equal(noteDiteDans('rendez-vous le 8/10 chez le psy'), null, 'le 8/10 est une DATE');
  assert.equal(noteDiteDans('du 3/10 au 9/10 je suis absent'), null);
  assert.equal(noteDiteDans('Elden Ring 9/10 franchement'), null, 'une note, mais pas la sienne');
  assert.equal(noteDiteDans('ce film 8/10'), null);
  assert.equal(noteDiteDans("j'ai pris 4/10 mg"), null, 'une dose');
  assert.equal(noteDiteDans('3 sur 10 personnes le font'), null, 'un dénombrement');
});

test('ce qu’on reconnaît : la personne parle d’elle, près du chiffre', () => {
  assert.equal(noteDiteDans('je suis à 3/10 là').valeur, 3);
  assert.equal(noteDiteDans('mon moral est à 7 sur 10').valeur, 7);
  assert.equal(noteDiteDans('je dirais 5/10 aujourd’hui').valeur, 5);
  assert.equal(noteDiteDans('3/10').valeur, 3, 'seul dans le message, il se suffit');
  assert.equal(noteDiteDans('0/10').valeur, 0, 'zéro est une note, pas une absence');
  assert.equal(noteDiteDans('10/10').valeur, 10);
  assert.equal(noteDiteDans('11/10'), null, 'hors échelle');
});

test('celui qui se reprend donne son chiffre en dernier', () => {
  assert.equal(noteDiteDans('je dirais 4/10, non plutôt 2/10').valeur, 2);
  assert.equal(noteDiteDans('ce film 8/10 mais moi je suis à 3/10').valeur, 3,
    'la note de l’objet est écartée, la sienne est prise');
});

test('le relevé est posé, ancré au message, et une seule fois', () => {
  const U = 'note-dite';
  upsertUser({ id: U, username: U });
  const D = '2026-09-08';
  const id = addMessage({ ts: `${D}T06:48:00.000Z`, date: D, role: 'user', text: LA_PHRASE, userId: U });

  assert.equal(noterNoteDite(LA_PHRASE, id, D, U), true);
  const r = relevesDuJour(D, U);
  assert.equal(r.length, 1);
  assert.equal(r[0].valeur, 1);
  assert.equal(r[0].source, 'toi',
    'le mot que la colonne emploie déjà pour « la personne l’a posé elle-même » — ' +
    'inventer un troisième vocabulaire pour la même chose la rendrait invisible ' +
    'à `relevesDeToi`, qui alimente l’écran');

  assert.equal(noterNoteDite(LA_PHRASE, id, D, U), false, 'le même message ne repose rien');
  assert.equal(relevesDuJour(D, U).length, 1);
});

test('la relecture rattrape ce qui a été écrit avant l’extracteur', () => {
  const V = 'note-retro';
  upsertUser({ id: V, username: V });
  addMessage({ ts: '2026-09-01T20:00:00.000Z', date: '2026-09-01', role: 'user',
               text: 'je suis à 2/10 ce soir', userId: V });
  addMessage({ ts: '2026-09-02T20:00:00.000Z', date: '2026-09-02', role: 'user',
               text: 'sorti au ciné, ce film 9/10', userId: V });
  addMessage({ ts: '2026-09-03T20:00:00.000Z', date: '2026-09-03', role: 'user',
               text: 'mon moral 6/10', userId: V });

  assert.equal(relireLesNotesDites(V), 2, 'la note de film n’en est pas une');
  assert.equal(relevesDuJour('2026-09-01', V)[0].valeur, 2);
  assert.equal(relevesDuJour('2026-09-02', V).length, 0);
  assert.equal(relevesDuJour('2026-09-03', V)[0].valeur, 6);

  assert.equal(relireLesNotesDites(V), 0, 'relancée, elle n’empile pas');
});
