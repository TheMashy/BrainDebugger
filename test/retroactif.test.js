/*
 * CE QUE L'APPLICATION MONTRE D'UN JOURNAL QU'ON N'ÉCRIT PAS TOUS LES JOURS.
 *
 * « Je ne vois que deux jours, alors que j'ai des années de journal. » La
 * fenêtre des fonctionnements valait « les cent quatre-vingts derniers jours »,
 * ce qui n'est une fenêtre que pour qui écrit quotidiennement. Mesuré sur un
 * journal de cinq ans écrit un jour sur douze : quinze journées écrites sur
 * cent quarante-trois entraient dedans, aucun seuil n'était atteint, et
 * l'onglet répondait « pas encore de quoi compter » à quelqu'un qui avait tout
 * donné.
 *
 * Ce qui est vérifié ici : la fenêtre se compte en MATIÈRE ; elle ne bouge pas
 * pour qui écrit chaque jour ; la bande dessine les journées et non le
 * calendrier ; les silences se marquent ; et ce qui ne peut pas être
 * rétroactif se dit au lieu de passer pour une panne.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.BD_DB = join(mkdtempSync(join(tmpdir(), 'bd-retro-')), 'test.db');

const { db, upsertUser, poserActiviteJour } = await import('../server/db.js');
const { addDays } = await import('../server/stats.js');
const { fonctionnements, tableDe, SEUILS } = await import('../server/fonctionnements.js');
const { prises } = await import('../server/prises.js');
const { bandeLiee, bandeCouches } = await import('../web/bande.js');

const FIN = new Date().toISOString().slice(0, 10);
const ins = db.prepare('INSERT INTO entries(user_id, date, text, note) VALUES(?,?,?,?)');
const TEXTES = ['journée plate, rien à en dire', "j'ai bu quatre bières hier soir, encore",
                'fumé un joint pour dormir', 'grosse journée de boulot',
                "j'ai bu deux verres de vin avec des amis", 'sorti marcher deux heures'];

/** Un journal de `n` journées écrites, espacées de `pas` jours civils. */
function semer(U, n, pas) {
  upsertUser({ id: U, username: U });
  for (let k = 0; k < n; k++) ins.run(U, addDays(FIN, -(n - 1 - k) * pas), TEXTES[k % TEXTES.length], 4 + (k % 5));
  return U;
}

test('un journal clairsemé : la fenêtre remonte jusqu’à la première journée', () => {
  const U = semer('clairseme', 143, 12);          // cinq ans, un jour sur douze
  const p = fonctionnements(U).periode;
  assert.equal(p.nourries, 143, 'toutes les journées écrites doivent entrer dans la fenêtre');
  assert.equal(p.notes, 143);
  assert.equal(p.elargie, true, 'la fenêtre s’est ouverte : l’écran doit pouvoir le dire');
  assert.ok(p.jours > 1600, `la période civile couvre le journal entier (${p.jours} j)`);
  assert.equal(fonctionnements(U).assez, true, 'avec la matière rassemblée, il y a de quoi compter');
});

test('un journal quotidien ne bouge pas : la fenêtre reste celle qu’on demande', () => {
  const U = semer('quotidien', 300, 1);
  const p = fonctionnements(U).periode;
  assert.equal(p.jours, SEUILS.jours_defaut, 'la fenêtre d’un journal dense ne doit pas s’ouvrir');
  assert.equal(p.nourries, SEUILS.jours_defaut);
  assert.equal(p.elargie, false);
});

test('les jours de prise deviennent visibles sur la bande', () => {
  /*
   * Vingt-quatre jours d'alcool comptés par le moteur, trois seulement dans la
   * fenêtre de la bande : le tableau disait un chiffre, le dessin juste en
   * dessous en montrait un autre. Le moteur des prises lisait déjà tout le
   * journal — c'est la bande qui n'en voyait qu'un bout.
   */
  const U = 'clairseme';
  const F = fonctionnements(U), P = prises(U, {});
  const dans = new Set(F.series.dates);
  for (const p of P.prises) {
    assert.ok(p.jours.length > 3, `${p.cle} : ${p.jours.length} jours comptés`);
    assert.equal(p.jours.filter(d => dans.has(d)).length, p.jours.length,
                 `${p.cle} : des jours comptés restent hors de la bande`);
  }
  const svg = bandeCouches(null, F, null, 'prise', { prises: P });
  assert.ok(svg.includes('data-couche="prise"'), 'la couche des prises ne se dessine pas');
});

test('la bande dessine les journées, pas le calendrier', () => {
  // Mille sept cents colonnes d'un demi-pixel dont 92 % de vide ne sont pas une
  // bande, c'est une bouillie grise. L'axe est ordinal : une journée, un carré.
  const F = fonctionnements('clairseme');
  assert.equal(F.series.nourri.length, F.series.dates.length, 'le drapeau doit être aligné sur les dates');
  const portantes = F.series.nourri.filter(Boolean).length;
  assert.equal(portantes, 143);
  assert.ok(F.series.dates.length > 1600, 'la table, elle, garde le calendrier complet');
  const svg = bandeLiee({ noeuds: [{ nom: 'x', genre: 'x', jours: [F.series.dates.at(-1)] }] }, F);
  const colonnes = (svg.match(/class="bj"/g) ?? []).length;
  assert.ok(colonnes === 0 || colonnes === portantes, `${colonnes} colonnes pour ${portantes} journées`);
});

test('les silences se marquent — ils ne le pouvaient pas avant', () => {
  /*
   * `trousDe` cherche l'écart entre deux dates CONSÉCUTIVES de l'axe. Tant que
   * l'axe portait tous les jours civils, cet écart valait un, toujours : le
   * marquage des silences ne pouvait pas se déclencher. Il était mort en
   * silence, ce qui est la façon dont ce genre de code meurt.
   */
  const U = semer('coupure', 0, 1);
  for (let k = 0; k < 40; k++) ins.run(U, addDays(FIN, -(160 - k)), 'écrit', 5);
  for (let k = 0; k < 40; k++) ins.run(U, addDays(FIN, -(39 - k)), 'écrit', 5);
  const F = fonctionnements(U);
  const svg = bandeLiee({ noeuds: [{ nom: 'x', genre: 'x', jours: [addDays(FIN, -160), addDays(FIN, -10)] }] }, F);
  assert.match(svg, /class="btrou"/, 'les deux mois sans rien écrire ne sont pas marqués');
  assert.match(svg, /8[0-9] jours sans rien écrire/);
});

test('ce qui ne peut pas être rétroactif se dit', () => {
  /*
   * Le texte et les notes se relisent aussi loin que le journal remonte. Les
   * nuits et le temps d'écran, non : ils n'existent qu'à partir du jour où
   * Machi Tool les a mesurés. Sur une fenêtre de cinq ans, « 2 nuits » a l'air
   * d'une panne — c'est l'âge de la mesure.
   */
  const U = semer('mesure-recente', 143, 12);
  const T0 = tableDe(U);
  assert.equal(T0.mesure_depuis, null, 'sans digest, il n’y a pas de date de première mesure');
  for (const d of [addDays(FIN, -2), addDays(FIN, -1)])
    poserActiviteJour(U, d, { date: d, plage: { de: '00:00', a: '23:59' }, trous: [],
                              temps_par_contexte_s: { code: 3600 } });
  const p = fonctionnements(U).periode;
  assert.equal(p.mesure_depuis, addDays(FIN, -2), 'la date de la première mesure doit être rendue');
  assert.ok(p.de < p.mesure_depuis, 'et elle est bien postérieure au début de la fenêtre : c’est ça qu’il faut dire');
});

/* ---------------- relire le passé avec l'extracteur d'aujourd'hui ---------------- */

const { relireLesBornesDites, rangerToutLeJournal } = await import('../server/api.js');
const { addMessage, mesuresDuJour, poserMesure } = await import('../server/db.js');
const { SOURCE_DIT, CLE_LEVER, CLE_COUCHER } = await import('../server/jour-vecu.js');

test('« je viens de me lever », écrit il y a trois ans, est enfin lu', () => {
  /*
   * `noterBornesDites` ne tourne qu'à l'écriture. Tout ce qui a été écrit avant
   * que cet extracteur existe n'a jamais été lu : le journal contient la
   * phrase, l'application sait la comprendre, et la mesure n'existe pas. Rien
   * ne signale ce trou-là.
   */
  const U = 'vieilles-bornes';
  upsertUser({ id: U, username: U });
  const jour = j => `2023-04-${String(j).padStart(2, '0')}`;
  addMessage({ ts: `${jour(3)}T15:12:00.000Z`, date: jour(3), role: 'user',
               text: 'je viens de me lever, il est tard', userId: U });
  addMessage({ ts: `${jour(4)}T23:40:00.000Z`, date: jour(4), role: 'user',
               text: 'je vais me coucher à 23:40, journée finie', userId: U });
  addMessage({ ts: `${jour(5)}T10:00:00.000Z`, date: jour(5), role: 'user',
               text: 'rien de spécial aujourd’hui', userId: U });

  assert.deepEqual(mesuresDuJour(jour(3), U), [], 'rien n’a été posé à l’écriture, c’est le point de départ');
  assert.equal(relireLesBornesDites(U), 2, 'les deux bornes du passé doivent être retrouvées');

  const lever = mesuresDuJour(jour(3), U).find(m => m.cle === CLE_LEVER);
  assert.ok(lever, 'le lever de 2023 n’a pas été posé');
  assert.equal(lever.source, SOURCE_DIT);
  assert.match(lever.texte, /^1[45]:\d\d$/, `l'heure vient du message, pas d'aujourd'hui : ${lever.texte}`);
  assert.ok(mesuresDuJour(jour(4), U).some(m => m.cle === CLE_COUCHER && m.texte === '23:40'));
  assert.deepEqual(mesuresDuJour(jour(5), U), [], 'une journée sans borne dite reste vide');
});

test('la relecture est idempotente et n’écrase jamais ce qui a été dit à chaud', () => {
  const U = 'vieilles-bornes';
  assert.equal(relireLesBornesDites(U), 0, 'un second passage ne repose rien');
  // Une borne enregistrée à chaud gagne : on ne contredit pas le moment vécu
  // avec une relecture faite après coup.
  const V = 'a-chaud';
  upsertUser({ id: V, username: V });
  const d = '2023-06-10';
  addMessage({ ts: `${d}T09:00:00.000Z`, date: d, role: 'user', text: 'je viens de me lever', userId: V });
  poserMesure({ date: d, source: SOURCE_DIT, cle: CLE_LEVER, texte: '07:30', userId: V });
  assert.equal(relireLesBornesDites(V), 0);
  assert.equal(mesuresDuJour(d, V).find(m => m.cle === CLE_LEVER).texte, '07:30');
});

test('« ranger tout le journal » relit d’abord, range ensuite', () => {
  const U = 'ranger-relit';
  upsertUser({ id: U, username: U });
  const d = '2023-08-20';
  addMessage({ ts: `${d}T22:10:00.000Z`, date: d, role: 'user', text: 'soirée tranquille', userId: U });
  addMessage({ ts: `${addDays(d, 1)}T04:30:00.000Z`, date: addDays(d, 1), role: 'user',
               text: 'je vais me coucher à 04:30', userId: U });
  const r = rangerToutLeJournal(U);
  assert.equal(r.bornes_retrouvees, 1, 'la borne du passé doit être retrouvée par le bouton');
  assert.ok('messages' in r && 'jours' in r);
});
