/**
 * LA CARTE DU JOURNAL, AU LIEU DU JOURNAL.
 *
 * Le compagnon portait le TEXTE des journées et du carnet en permanence :
 * 125 000 signes chez quelqu'un, repayés à chaque phrase et plein tarif dès
 * qu'il revient après plus d'une heure. Or il a déjà de quoi aller lire ce
 * qu'il lui faut — `chercher_journees`, `lire_carnet`. Ce qui lui manquait,
 * c'était de SAVOIR QUOI DEMANDER.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildIndex, termesDuDoc, PART_BANALE, CORPUS_MIN } from '../server/search.js';
import { sommaireBlock } from '../server/chat.js';

const JOURS = [
  'encore du discord toute la soirée, fumé pas mal, rien mangé',
  'boulot, réunion difficile, boule au ventre toute la matinée',
  'chalet avec les potes, on a marché, j étais bien pour une fois',
  'fatigué, rien fait de la journée, scroll youtube jusqu à 4h',
  'dispute avec ma mère au téléphone, ça m a retourné',
  'séance chez la psy, on a parlé de mon père',
  'rien de spécial, un peu de guitare le soir',
  'grosse angoisse dans le train, j ai cru que j allais tomber',
  'soirée tranquille, film avec les colocs',
  'insomnie, encore, levé à 14h le lendemain',
];
const docs = JOURS.map((t, i) => ({ id: `j${i}`, text: t }));
const idx = buildIndex(docs);

test('chaque journée reçoit les mots qui la distinguent des AUTRES', () => {
  assert.deepEqual(termesDuDoc(idx, 'j2', 3), ['chalet', 'potes', 'marche']);
  assert.ok(termesDuDoc(idx, 'j5', 4).includes('psy'));
  assert.ok(termesDuDoc(idx, 'j9', 3).includes('insomnie'));
});

test('UN MOT PARTOUT NE DISTINGUE RIEN — et l’idf seul ne suffit pas à l’écarter', () => {
  /*
   * Il le pénalise, mais s'il n'y a rien d'autre dans la journée il ressort
   * quand même. Une carte où trente lignes sur soixante disent « fatigue,
   * soir, rien » a l'air pleine et ne permet aucun choix.
   */
  const partout = Array.from({ length: 20 }, (_, i) =>
    ({ id: `p${i}`, text: `fatigue fatigue fatigue ${i % 2 ? 'guitare' : 'vélo'}` }));
  const ix = buildIndex(partout);
  const m = termesDuDoc(ix, 'p1', 3);
  assert.equal(m.includes('fatigue'), false, '« fatigue » est dans les 20 journées et sort quand même');
  assert.ok(m.includes('guitare'));
});

test('mais PAS sur un journal qui commence : on viderait la carte quand elle sert le plus', () => {
  // « La moitié des journées », sur trois journées, ce sont deux journées.
  const petit = buildIndex(Array.from({ length: CORPUS_MIN - 1 }, (_, i) =>
    ({ id: `q${i}`, text: 'angoisse le matin, encore' })));
  assert.ok(termesDuDoc(petit, 'q0', 3).length > 0, 'la carte est vide sur un petit journal');
  assert.ok(PART_BANALE > 0 && PART_BANALE < 1);
});

test('un document absent de l’index ne rend rien plutôt que de lever', () => {
  assert.deepEqual(termesDuDoc(idx, 'jamais-vu', 3), []);
});

test('LA CARTE DIT D’ALLER LIRE, ET NOMME L’OUTIL', () => {
  const b = sommaireBlock(
    [{ date: '2026-02-28', note: 7, mots: ['chalet', 'potes'] }],
    [{ id: 12, quand: 'vers 2019', mots: ['hôpital'] }]);
  assert.match(b, /chercher_journees/);
  assert.match(b, /lire_carnet/);
  assert.match(b, /2026-02-28 \(7\/10\) chalet, potes/);
  assert.match(b, /#12 \(vers 2019\) hôpital/);
});

test('ELLE INTERDIT DE SE CITER — ce sont des jetons, pas ses phrases', () => {
  /*
   * « tu as parlé de boule au ventre le 27 » a l'air d'une lecture et n'en est
   * pas une. La règle est la même que pour les journées brutes, en plus
   * strict : ici les mots ne sont même pas les siens tels qu'il les a écrits.
   */
  const b = sommaireBlock([{ date: '2026-02-28', note: 7, mots: ['chalet'] }], []);
  assert.match(b, /COMPTAGE/);
  assert.match(b, /[Tt]u ne les cites jamais/);
  assert.match(b, /sans être allé relire ce jour-là/);
});

test('une journée sans mot distinctif ne fait pas de ligne vide', () => {
  const b = sommaireBlock([{ date: '2026-02-28', note: 7, mots: [] },
                           { date: '2026-03-01', note: 5, mots: ['chalet'] }], []);
  assert.equal(b.includes('2026-02-28'), false);
  assert.match(b, /2026-03-01/);
});

test('rien à cartographier ne rend rien', () => {
  assert.equal(sommaireBlock([], []), null);
  assert.equal(sommaireBlock([{ date: '2026-01-01', note: 3, mots: [] }], []), null);
});

test('la section du carnet disparaît quand il n’y a pas de note apportée', () => {
  const b = sommaireBlock([{ date: '2026-02-28', note: 7, mots: ['chalet'] }], []);
  assert.equal(b.includes("APPORTÉ D'AILLEURS"), false);
  assert.equal(b.includes('lire_carnet'), false, 'un outil proposé sans rien à y lire');
});

test('UN MOT QUI NOMME UN ÉTAT PASSE DEVANT UN MOT QUI NOMME UNE CIRCONSTANCE', () => {
  /*
   * Le score brut favorise ce qui est rare et répété : « guitare » vingt-cinq
   * fois écrase « vide » une fois. Or pour retrouver une journée, savoir qu'on
   * s'y sentait vide vaut mieux que savoir qu'on y a joué de la guitare — et
   * c'est ce qui manquait à une carte triée par le seul comptage.
   *
   * Le cas est extrême exprès : c'est le seul endroit où la partition change
   * quelque chose, et un test qui ne le pousse pas jusque-là ne prouve rien.
   * (Vérifié : sans elle, ce même corpus rend « guitare, vide ».)
   */
  const docs = [{ id: 'a', text: 'guitare '.repeat(25) + 'vide' },
                ...Array.from({ length: 3 }, (_, i) => ({ id: `c${i}`, text: `vide et plat ${i}` })),
                ...Array.from({ length: 8 }, (_, i) => ({ id: `b${i}`, text: `boulot train metro ${i}` }))];
  assert.deepEqual(termesDuDoc(buildIndex(docs), 'a', 2), ['vide', 'guitare']);
});
