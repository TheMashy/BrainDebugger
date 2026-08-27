/**
 * Tests du decoupage des notes collees.
 *
 * C'est la partie ou une erreur coute cher : mal reconnaitre une date range des
 * annees de journal sous la mauvaise journee, et le miroir rendra alors des mots
 * qui n'ont pas ete ecrits ce jour-la. Un mensonge tranquille, invisible, sur la
 * seule chose que ce produit promette.
 *
 * On ne teste que parseDateLine et parseNotes : ils sont purs et ne touchent pas
 * la base, ce qui permet de les couvrir sans fixture.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseDateLine, parseNotes } from '../server/import-notes.js';

/* ---------- reconnaissance de date ---------- */

test('dates : les formats courants sont reconnus', () => {
  const cas = [
    ['2024-03-12',            '2024-03-12'],
    ['2024/03/12',            '2024-03-12'],
    ['12/03/2024',            '2024-03-12'],
    ['12-03-2024',            '2024-03-12'],
    ['12.03.2024',            '2024-03-12'],
    ['12 mars 2024',          '2024-03-12'],
    ['12 Mars 2024',          '2024-03-12'],
    ['1er mars 2024',         '2024-03-01'],
    ['12 févr. 2024',         '2024-02-12'],
    ['mars 12, 2024',         '2024-03-12'],
    ['March 12 2024',         '2024-03-12'],
    ['mardi 12 mars 2024',    '2024-03-12'],
    ['Lun. 12/03/2024',       '2024-03-12'],
    ['## 2024-03-12',         '2024-03-12'],
    ['- 12 mars 2024',        '2024-03-12']
  ];
  for (const [entree, attendu] of cas) {
    const r = parseDateLine(entree);
    assert.ok(r, `non reconnu : ${entree}`);
    assert.equal(r.date, attendu, `${entree} mal interprete`);
  }
});

test('dates : le jour precede le mois', () => {
  // 03/04 est le 3 avril, pas le 4 mars. C'est un journal tenu en francais.
  assert.equal(parseDateLine('03/04/2024').date, '2024-04-03');
});

test('dates : une annee sur deux chiffres bascule au bon siecle', () => {
  assert.equal(parseDateLine('12/03/24').date, '2024-03-12');
  assert.equal(parseDateLine('12/03/98').date, '1998-03-12');
});

test('dates : une date impossible est refusee', () => {
  // Le 31 fevrier existe dans une regex naive, pas dans un calendrier. Accepte,
  // il creerait une journee fantome que rien ne pourrait plus retrouver.
  assert.equal(parseDateLine('31/02/2024'), null);
  assert.equal(parseDateLine('2024-13-01'), null);
  assert.equal(parseDateLine('00/03/2024'), null);
});

test('dates : une ligne de texte ordinaire n\'est pas prise pour une date', () => {
  for (const l of [
    'Je me suis levé à 7h30',
    'On était 12 à table',
    'rendez-vous à 14h',
    'j\'ai lu 30 pages',
    '',
    'mars'
  ]) {
    assert.equal(parseDateLine(l), null, `pris a tort pour une date : ${l}`);
  }
});

test('dates : le texte colle a la date sur la meme ligne est recupere', () => {
  const r = parseDateLine('12 mars 2024 — journée correcte');
  assert.equal(r.date, '2024-03-12');
  assert.equal(r.reste, 'journée correcte');
  assert.equal(parseDateLine('2024-03-12 : fatigué').reste, 'fatigué');
});

/* ---------- decoupage ---------- */

test('decoupage : chaque date ouvre une journee', () => {
  const { entries } = parseNotes(`
2024-03-12
Journée lourde.
Pas dormi.

2024-03-13
Mieux.
`);
  assert.equal(entries.length, 2);
  assert.equal(entries[0].date, '2024-03-12');
  assert.equal(entries[0].text, 'Journée lourde.\nPas dormi.');
  assert.equal(entries[1].text, 'Mieux.');
});

test('decoupage : les journees ressortent triees', () => {
  const { entries } = parseNotes('2024-05-02\nb\n\n2024-01-09\na');
  assert.deepEqual(entries.map(e => e.date), ['2024-01-09', '2024-05-02']);
});

test('decoupage : ce qui precede la premiere date est ecarte', () => {
  // Un titre de document n'est pas une journee. L'attacher a la premiere date
  // salirait le corpus avec du texte que personne n'a ecrit ce jour-la.
  const { entries, ignore } = parseNotes('Mon journal 2024\n\n2024-03-12\nvrai contenu');
  assert.equal(entries.length, 1);
  assert.equal(entries[0].text, 'vrai contenu');
  assert.equal(ignore, 'Mon journal 2024');
});

test('decoupage : une date qui revient est recollee, pas ecrasee', () => {
  // Recollee en gardant la coupure : ce sont deux moments de la meme journee,
  // pas une phrase coupee en deux.
  const { entries } = parseNotes('2024-03-12\nle matin\n\n2024-03-12\nle soir');
  assert.equal(entries.length, 1);
  assert.equal(entries[0].text, 'le matin\n\nle soir');
});

test('decoupage : une journee sans texte n\'est pas creee', () => {
  // Une date seule ne dit rien. La garder produirait une entree vide qui compte
  // comme une journee ecrite dans le miroir alors qu'elle ne contient rien.
  const { entries } = parseNotes('2024-03-12\n\n2024-03-13\nquelque chose');
  assert.deepEqual(entries.map(e => e.date), ['2024-03-13']);
});

test('decoupage : les lignes vides internes sont conservees, les paquets reduits', () => {
  const { entries } = parseNotes('2024-03-12\npara un\n\n\n\npara deux');
  assert.equal(entries[0].text, 'para un\n\npara deux');
});

test('decoupage : les fins de ligne Windows ne cassent rien', () => {
  const { entries } = parseNotes('2024-03-12\r\nlundi\r\n\r\n2024-03-13\r\nmardi');
  assert.equal(entries.length, 2);
  assert.equal(entries[0].text, 'lundi');
});

test('decoupage : un texte sans aucune date ne produit rien', () => {
  const { entries, ignore } = parseNotes('juste du texte\nsur deux lignes');
  assert.equal(entries.length, 0);
  assert.equal(ignore, 'juste du texte\nsur deux lignes');
});

test('decoupage : les formats se melangent dans un meme bloc', () => {
  const { entries } = parseNotes(`
12 mars 2024
un

13/03/2024
deux

2024-03-14 — trois
`);
  assert.deepEqual(entries.map(e => e.date), ['2024-03-12', '2024-03-13', '2024-03-14']);
  assert.equal(entries[2].text, 'trois');
});

test('decoupage : une ligne qui commence par un nombre reste du texte', () => {
  // Le piege du parseur naif : « 12 heures de sommeil » n'ouvre pas une journee.
  const { entries } = parseNotes('2024-03-12\n12 heures de sommeil\n8 km courus');
  assert.equal(entries.length, 1);
  assert.equal(entries[0].text, '12 heures de sommeil\n8 km courus');
});
