/*
 * SUR QUEL JOUR TOMBE CHAQUE BORNE.
 *
 * « levé 15:51, couché 10:33 » se lit comme une absurdité tant qu'on ne dit
 * pas que le 10:33 est celui du LENDEMAIN. Chez quelqu'un qui vit la nuit, les
 * deux bouts d'une même journée vécue tombent presque toujours sur deux dates
 * civiles différentes — et il fallait refaire le calcul de tête à chaque fois,
 * y compris pour savoir si le site s'était trompé.
 *
 * Le calcul se fait dans `posteDuJour`, où la règle « a-t-on passé minuit »
 * est déjà écrite. Ce qui est vérifié ici : le lever ouvre la journée, le
 * coucher la ferme quitte à passer minuit, `dormi_de` est derrière le lever et
 * pas devant, et une journée ordinaire ne change pas de jour — sans quoi
 * l'écran afficherait deux numéros pour ne rien apprendre.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.BD_DB = join(mkdtempSync(join(tmpdir(), 'bd-pj-')), 'test.db');

const { upsertUser, poserMesure, poserActiviteJour } = await import('../server/db.js');
const { posteDuJour } = await import('../server/api.js');
const { SOURCE_DIT, CLE_LEVER, CLE_COUCHER } = await import('../server/jour-vecu.js');
const { addDays } = await import('../server/stats.js');

const J = '2026-09-09';
const dire = (u, date, cle, heure) =>
  poserMesure({ date, source: SOURCE_DIT, cle, texte: heure, userId: u });

test('LA JOURNÉE DE LA CAPTURE : levé 15:51, couché 10:33 le LENDEMAIN', () => {
  const U = 'nocturne';
  upsertUser({ id: U, username: U });
  dire(U, J, CLE_LEVER, '15:51');
  // « je me couche » écrit à 10:33 le lendemain matin : c'est la fin de J.
  dire(U, addDays(J, 1), CLE_COUCHER, '10:33');

  const p = posteDuJour(J, U);
  assert.equal(p.lever.heure, '15:51');
  assert.equal(p.lever.jour, J, 'le lever OUVRE la journée : il est sur J, par définition');
  assert.equal(p.coucher.heure, '10:33');
  assert.equal(p.coucher.jour, addDays(J, 1),
    '10:33 vient AVANT 15:51 dans la journée civile : il a fallu passer minuit');
});

test('une journée ordinaire ne porte aucun numéro', () => {
  /*
   * C'est la moitié qui compte du correctif : le numéro n'apparaît que
   * lorsqu'il apprend quelque chose. Un numéro toujours là cesse d'être un
   * signe, et ajoute deux nombres à lire sur toutes les journées normales.
   */
  const U = 'diurne';
  upsertUser({ id: U, username: U });
  dire(U, J, CLE_LEVER, '08:15');
  dire(U, J, CLE_COUCHER, '23:40');

  const p = posteDuJour(J, U);
  assert.equal(p.lever.jour, J);
  assert.equal(p.coucher.jour, J, 'levé puis couché le même jour : rien à signaler');
});

test('sans lever connu, on retombe sur la convention du fichier : avant midi, c’est demain', () => {
  const U = 'sans-lever';
  upsertUser({ id: U, username: U });
  dire(U, addDays(J, 1), CLE_COUCHER, '03:20');

  const p = posteDuJour(J, U);
  assert.equal(p.coucher.heure, '03:20');
  assert.equal(p.coucher.jour, addDays(J, 1),
    'un coucher du petit matin ferme la journée d’avant');
});

test('« dormi_de » est DERRIÈRE le lever, jamais devant', () => {
  /*
   * `dormi_de` est l'autre sens : le coucher qui a OUVERT la nuit terminée par
   * ce lever. Le ranger comme le coucher qui FERME la journée le mettrait un
   * jour trop loin, et l'infobulle dirait « endormi vers 23:59 le 10 » pour une
   * nuit dormie le 8.
   */
  const U = 'veille';
  upsertUser({ id: U, username: U });
  const d = J;
  poserActiviteJour(U, d, { date: d, plage: { de: '00:00', a: '23:59' }, trous: [],
                            poste: { coucher: '23:30', reveil: '07:30', sommeil_h: 8 },
                            temps_par_contexte_s: { code: 3600 } });
  const p = posteDuJour(d, U);
  if (p?.dormi_de && p.lever?.heure) {
    const av = Number(p.dormi_de.slice(0, 2)) * 60 + Number(p.dormi_de.slice(3, 5));
    const lv = Number(p.lever.heure.slice(0, 2)) * 60 + Number(p.lever.heure.slice(3, 5));
    assert.equal(p.dormi_de_jour, av < lv ? d : addDays(d, -1),
      'endormi avant le lever dans la journée civile = même jour, sinon la veille');
  }
});
