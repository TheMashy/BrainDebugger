/*
 * UNE NUIT ÉCRITE COMPTE COMME UNE NUIT — DANS LES DEUX MOTEURS.
 *
 * « Ma carte » sait depuis longtemps que « je vais me coucher » le soir et
 * « je viens de me lever » le matin font une nuit mesurée : ce n'est pas une
 * déduction, c'est un témoignage. « Comment ça marche chez toi » ne le savait
 * pas. Elle remplaçait bien le coucher et le lever par ce qui avait été dit,
 * mais gardait le `sommeil_h` de Machi Tool — ou rien du tout les jours où il
 * n'avait rien envoyé.
 *
 * Deux conséquences, et la seconde est celle qui se voit à l'écran :
 *
 *   1. les deux pages se contredisaient sur la même journée — le fichier
 *      s'interdit explicitement ça (voir le commentaire de `tableDe`) ;
 *   2. les bornes dites se relisent sur TOUT le journal
 *      (`relireLesBornesDites`), donc un passé entier de nuits écrites noir
 *      sur blanc restait invisible à la seule page qui dit « il n'y a pas
 *      assez de nuits pour compter ».
 *
 * Ce qui est vérifié ici : la nuit dite arrive dans la table, elle vaut la
 * même chose que dans « Ma carte », et elle ne se fabrique pas à partir de
 * deux bornes de machine — celles-là ont déjà été jugées ailleurs.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.BD_DB = join(mkdtempSync(join(tmpdir(), 'bd-nuitdite-')), 'test.db');

const { db, upsertUser, poserMesure, poserActiviteJour } = await import('../server/db.js');
const { addDays } = await import('../server/stats.js');
const { tableDe, analyserTable } = await import('../server/fonctionnements.js');
const { nuits, MIN_NUIT, MAX_NUIT } = await import('../server/nuits.js');
const { SOURCE_DIT, CLE_LEVER, CLE_COUCHER } = await import('../server/jour-vecu.js');

const FIN = new Date().toISOString().slice(0, 10);
const ins = db.prepare('INSERT INTO entries(user_id, date, text, note) VALUES(?,?,?,?)');
const jourDe = k => addDays(FIN, -k);

/** Un journal écrit tous les jours, et rien d'autre : aucun digest. */
function semer(U, n) {
  upsertUser({ id: U, username: U });
  for (let k = n - 1; k >= 0; k--) ins.run(U, jourDe(k), 'journée écrite', 5);
}
const dire = (U, date, cle, heure) =>
  poserMesure({ date, source: SOURCE_DIT, cle, texte: heure, userId: U });

const ligneDe = (U, date) => tableDe(U).jours.find(j => j.date === date);

test('deux bornes dites font une nuit, sans que Machi Tool ait rien envoyé', () => {
  const U = 'nuit-ecrite';
  semer(U, 40);
  // Couché le soir du J−6 à 23:30, levé le matin du J−5 à 07:45 : 8,25 h.
  dire(U, jourDe(6), CLE_COUCHER, '23:30');
  dire(U, jourDe(5), CLE_LEVER, '07:45');

  const l = ligneDe(U, jourDe(5));
  assert.equal(l.sommeil_h, 8.3, 'la nuit qui OUVRE le jour est celle du coucher de la veille');
  assert.ok(l.nuit_dite, 'elle doit se dire venue des phrases, pas de la machine');
});

test('un coucher écrit APRÈS minuit se rattache au soir d’avant', () => {
  const U = 'nuit-ecrite-tard';
  semer(U, 40);
  /*
   * C'est le cas de quelqu'un qui vit la nuit, et c'est celui qui faisait
   * afficher 3,7 h de sommeil : « ressenti avant de m'endormir » à 06:48 le
   * matin du J−4 ferme le jour vécu J−5, pas le jour J−4.
   */
  dire(U, jourDe(4), CLE_COUCHER, '06:48');
  dire(U, jourDe(4), CLE_LEVER, '18:00');

  assert.equal(ligneDe(U, jourDe(5))?.coucher, 30.8, '06:48 se compte 30,8 depuis le soir d’avant');
  assert.equal(ligneDe(U, jourDe(4)).sommeil_h, 11.2, '06:48 → 18:00, c’est 11,2 h');
});

test('les deux moteurs disent la même nuit, au dixième près', () => {
  const U = 'deux-moteurs';
  semer(U, 40);
  dire(U, jourDe(8), CLE_COUCHER, '01:20');
  dire(U, jourDe(8), CLE_LEVER, '09:50');

  // `nuits()` range la nuit sur le jour qu'elle OUVRE, comme la table.
  const maCarte = nuits(U, { jours: 40 }).find(n => n.date === jourDe(8));
  assert.ok(maCarte?.sommeil_h != null, 'Ma carte doit voir cette nuit-là');
  assert.equal(ligneDe(U, jourDe(8)).sommeil_h, maCarte.sommeil_h,
    'deux moteurs qui ne comptent pas la même nuit, c’est deux pages qui se contredisent');
});

test('une durée impossible n’est pas une nuit', () => {
  const U = 'nuit-impossible';
  semer(U, 40);
  // Couché à 23:00, levé à 00:30 : une heure et demie. C'est une coupure.
  dire(U, jourDe(12), CLE_COUCHER, '23:00');
  dire(U, jourDe(11), CLE_LEVER, '00:30');
  assert.equal(ligneDe(U, jourDe(11)).sommeil_h, null, `moins de ${MIN_NUIT} h n’est pas une nuit`);

  // Couché à 20:00, levé à 21:00 le lendemain : vingt-cinq heures.
  dire(U, jourDe(20), CLE_COUCHER, '20:00');
  dire(U, jourDe(19), CLE_LEVER, '21:00');
  assert.equal(ligneDe(U, jourDe(19)).sommeil_h, null, `plus de ${MAX_NUIT} h non plus`);
});

test('DEUX BORNES DE MACHINE NE SUFFISENT PAS À REFAIRE UNE NUIT', () => {
  /*
   * C'est le garde-fou, et il vaut le test à lui seul. `nuitDuJour` a ses
   * raisons de refuser une paire — un poste laissé allumé, une frontière de
   * fichier prise pour un réveil. Recalculer la durée à partir de la paire
   * qu'il vient d'écarter reviendrait à passer outre son avis avec exactement
   * les chiffres qu'il a rejetés : c'est le bug des 3,7 h, remis en place par
   * la porte de derrière.
   */
  const U = 'machine-seule';
  semer(U, 40);
  const d = jourDe(15);
  poserActiviteJour(U, d, { date: d, plage: { de: '00:00', a: '23:59' }, trous: [],
                            poste: { coucher: '23:00', reveil: '00:00', sommeil_h: null },
                            temps_par_contexte_s: { code: 3600 } });
  const l = ligneDe(U, d);
  assert.ok(l, 'la journée doit exister dans la table');
  assert.ok(!l.nuit_dite, 'aucune borne dite ce jour-là : rien ne doit être recalculé');
});

test('la jauge dit d’où viennent les nuits, sans reprocher à Machi Tool ce qu’il n’a pas mesuré', () => {
  const U = 'jauge-honnete';
  semer(U, 40);
  for (const k of [30, 28, 26, 24]) {
    dire(U, jourDe(k + 1), CLE_COUCHER, '23:30');
    dire(U, jourDe(k), CLE_LEVER, '07:30');
  }
  const r = analyserTable(tableDe(U));
  assert.equal(r.periode.nuits_dites, 4);
  const g = r.jauges.find(j => j.cle === 'nuits');
  assert.match(g.pourquoi, /tes propres phrases/, 'la phrase doit reconnaître ce que la personne a écrit');
  assert.doesNotMatch(g.pourquoi, /dont 4 donne/, 'ces nuits-là ne viennent pas de Machi Tool');
});
