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

/* ---------- formats etendus ---------- */

test('dates : les enveloppes et prefixes courants sont retires', () => {
  const cas = [
    ['[2024-03-12]',      '2024-03-12'],
    ['(12 mars 2024)',    '2024-03-12'],
    ['Le 12 mars 2024',   '2024-03-12'],
    ['2024-03-12.md',     '2024-03-12'],   // en-tete recopie depuis Obsidian
    ['20240312',          '2024-03-12'],
    ['March 12th, 2024',  '2024-03-12'],
    ['12th March 2024',   '2024-03-12'],
    ['1er avril 2024',    '2024-04-01']
  ];
  for (const [entree, attendu] of cas) {
    const r = parseDateLine(entree);
    assert.ok(r, `non reconnu : ${entree}`);
    assert.equal(r.date, attendu, `${entree} mal interprete`);
  }
});

test('dates : une heure accolee est coupee, pas versee dans le texte', () => {
  // Sinon « 21:30 » devient la premiere ligne de la journee et pollue le corpus
  // que le miroir fouille.
  for (const l of ['2024-03-12 21:30', '12 mars 2024 à 21h30', '12/03/2024 21:30', 'le 3 avril 2024, 22h']) {
    const r = parseDateLine(l);
    assert.ok(r, `non reconnu : ${l}`);
    assert.equal(r.reste, '', `heure laissee dans le texte : ${l}`);
  }
});

test('dates : huit chiffres suivis de texte ne sont pas une date', () => {
  // Un numero de dossier ouvrirait une journee fantome au milieu du journal.
  assert.equal(parseDateLine('20240312 est mon code'), null);
  assert.equal(parseDateLine('20240312').date, '2024-03-12');
});

test('dates : sans annee, on prend la derniere occurrence passee', () => {
  // Refuser revenait a jeter tout un carnet parce que son auteur ecrit « 17/08 »
  // comme tout le monde. « 17/08 » veut dire le 17 aout qui vient de passer,
  // pas celui qui arrive : on ne date jamais dans le futur.
  const today = '2026-08-27';
  assert.equal(parseDateLine('17/08', { today }).date, '2026-08-17');
  assert.equal(parseDateLine('12 mars', { today }).date, '2026-03-12');
  // Deja passe cette annee ? on reste dans l'annee. Sinon on recule d'un an.
  assert.equal(parseDateLine('28/08', { today }).date, '2025-08-28');
  assert.equal(parseDateLine('25/12', { today }).date, '2025-12-25');
});

test('dates : l\'inference ne produit jamais une date future', () => {
  // Une journee datee demain n'a pas pu etre ecrite. Elle fausserait la
  // reference glissante et apparaitrait dans une grille qui n'existe pas encore.
  const today = '2026-08-27';
  for (const l of ['28/08', '01/12', '31 décembre', 'novembre 3']) {
    const r = parseDateLine(l, { today });
    assert.ok(r, `non reconnu : ${l}`);
    assert.ok(r.date <= today, `${l} date dans le futur : ${r.date}`);
  }
});

test('decoupage : l\'annee est reportee sur les dates qui n\'en portent pas', () => {
  // Un cahier tenu a la main porte l'annee une fois en tete, plus jamais ensuite.
  const { entries } = parseNotes('2023\n\n12 mars\nune\n\n15 mars\ndeux\n\nmars 20\ntrois');
  assert.deepEqual(entries.map(e => e.date), ['2023-03-12', '2023-03-15', '2023-03-20']);
});

test('decoupage : le passage de nouvel an avance l\'annee', () => {
  // « 28 decembre » puis « 3 janvier » : le second est l'annee suivante, sinon
  // il remonterait onze mois en arriere au milieu d'un journal qui avance.
  const { entries } = parseNotes('2023-12-20\navant\n\n28/12\nreveillon\n\n3 janvier\napres');
  assert.deepEqual(entries.map(e => e.date), ['2023-12-20', '2023-12-28', '2024-01-03']);
});

test('decoupage : une date sans annee ouvre quand meme une journee', () => {
  const { entries } = parseNotes('12 mars\nrien ne dit quelle annee', { today: '2026-08-27' });
  assert.equal(entries.length, 1);
  assert.equal(entries[0].date, '2026-03-12');
  assert.equal(entries[0].text, 'rien ne dit quelle annee');
});

test('decoupage : une annee explicite l\'emporte sur l\'inference', () => {
  // Le contexte du document prime toujours : « 2023 » en tete puis « 12 mars »
  // donne mars 2023, pas mars de cette annee.
  const { entries } = parseNotes('2023\n\n12 mars\nune', { today: '2026-08-27' });
  assert.equal(entries[0].date, '2023-03-12');
});

/* ---------- tableaux colles ---------- */

const TAB = [
  'Date\tHeure\tHumeur\tCe qui se passait\tOxaz.\tWeed\tSommeil',
  "17/08\t~06h45\t-1\tRéveil après une nuit blanche passée à préparer le doc\t0\tnon\tnuit blanche",
  '17/08\tmatin\t~0\tRendormie, réveil correct\t0\tnon\tquelques heures, bonnes',
  "17/08\tau lever\t-2\tPoids dans la cage thoracique, anxiété d'anticipation avant le RDV\t0\tnon\t—",
  '18/08\tmatin\t+1\tRéveil correct, café tranquille sur le balcon\t0\tnon\t7h'
].join('\n');

test('tableau : un collage depuis un tableur est reconnu', () => {
  // Le cas reel qui echouait : la date occupe une COLONNE, pas une ligne a elle.
  const { entries, table } = parseNotes(TAB, { today: '2026-08-27' });
  assert.equal(table, true, 'doit passer par le lecteur de tableau');
  assert.deepEqual(entries.map(e => e.date), ['2026-08-17', '2026-08-18']);
});

test('tableau : les moments d\'une meme journee sont recolles', () => {
  // Un tableur en produit plusieurs par jour — reveil, midi, coucher.
  const { entries } = parseNotes(TAB, { today: '2026-08-27' });
  const jour = entries.find(e => e.date === '2026-08-17');
  assert.equal(jour.text.split('\n').length, 3);
  assert.match(jour.text, /nuit blanche/);
  assert.match(jour.text, /cage thoracique/);
});

test('tableau : l\'heure prefixe le texte, les colonnes de suivi sont nommees', () => {
  const { entries } = parseNotes(TAB, { today: '2026-08-27' });
  const jour = entries.find(e => e.date === '2026-08-17');
  assert.match(jour.text, /^~06h45 — Réveil/m);
  assert.match(jour.text, /Humeur -1/);
  assert.match(jour.text, /Sommeil nuit blanche/);
});

test('tableau : les cellules vides et les tirets de remplissage sont ecartes', () => {
  // « — » dans une colonne veut dire « rien a signaler », pas une donnee.
  const { entries } = parseNotes(TAB, { today: '2026-08-27' });
  const jour = entries.find(e => e.date === '2026-08-17');
  assert.doesNotMatch(jour.text, /Sommeil —/);
});

test('tableau : un tableau Markdown passe aussi', () => {
  const md = [
    '| Date | Note |',
    '|---|---|',
    '| 2024-03-12 | Nuit blanche, je tourne en rond depuis trois jours |',
    '| 2024-03-13 | Couru 8 km, la tête plus claire ce matin |',
    '| 2024-03-14 | Journée plate, rien à signaler de particulier |'
  ].join('\n');
  const { entries } = parseNotes(md);
  assert.deepEqual(entries.map(e => e.date), ['2024-03-12', '2024-03-13', '2024-03-14']);
  assert.match(entries[0].text, /tourne en rond/);
});

test('tableau : sans colonne de prose, on ne fabrique pas un tableau', () => {
  // Une grille de chiffres n'est pas un journal : la lire comme du texte
  // remplirait le corpus de « 0 non 2 » que la recherche ne saura pas utiliser.
  const chiffres = ['Date\tPoids\tPas', '12/03/2024\t72\t8400', '13/03/2024\t71\t9100', '14/03/2024\t72\t7700'].join('\n');
  const r = parseNotes(chiffres, { today: '2026-08-27' });
  assert.notEqual(r.table, true);
});

test('tableau : un texte ordinaire ne bascule pas en mode tableau', () => {
  // Deux espaces suffisent a ressembler a des colonnes ; il en faut plus pour
  // que ce soit vraiment un tableau.
  const { entries, table } = parseNotes(
    '2024-03-12\nJournée lourde.  Pas dormi.\n\n2024-03-13\nMieux.');
  assert.notEqual(table, true);
  assert.equal(entries.length, 2);
});
