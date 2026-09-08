/*
 * LA TABLE DES FONCTIONNEMENTS ET LES NUITS : LES DEUX MOTEURS DOIVENT DIRE
 * LA MÊME NUIT.
 *
 * « Ma carte » lit les nuits avec le rythme de la personne (api.js le passe) ;
 * `tableDe` les lisait SANS. Deux réponses pour la même journée, dans deux
 * onglets de la même application — et c'est la table, celle qui ne se relit
 * pas, qui nourrit ensuite les liens et les bascules.
 *
 * Et le vieux repli : `poste.reveil` seul, sans coucher, valait un lever. Ce
 * repli-là a été retiré de « Ma carte » ; il était resté ici. Le lever fantôme
 * à 00:00 n'avait pas disparu, il avait déménagé — et il se voyait plus
 * souvent, puisque la table couvre toute la période au lieu d'un jour.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.BD_DB = join(mkdtempSync(join(tmpdir(), 'bd-table-nuits-')), 'test.db');

const { tableDe } = await import('../server/fonctionnements.js');
const { poserActiviteJour } = await import('../server/db.js');
const { oublierRythme } = await import('../server/nuits.js');
const { addDays } = await import('../server/stats.js');

const J = i => new Date(Date.UTC(2026, 0, 1 + i)).toISOString().slice(0, 10);
const jourDe = (date, o = {}) => ({ date, plage: { de: '00:00', a: '23:59' }, trous: [],
                                    temps_par_contexte_s: { code: 3600 }, ...o });
const ligne = (T, d) => T.jours.find(j => j.date === d);

test('un réveil sans coucher ne devient pas un lever à 00:00', () => {
  const U = 'table-reveil-nu';
  for (let i = 0; i < 12; i++) {
    // Exactement ce que les digests d'avant la 1.20 portent : le bord du
    // fichier civil, pris pour un lever faute de mieux.
    poserActiviteJour(U, J(i), jourDe(J(i), { poste: { reveil: '00:00', source: 'clavier' } }));
  }
  oublierRythme(U);
  const T = tableDe(U, { jours: 20, jusquA: J(11) });
  const levers = T.jours.map(j => j.lever).filter(v => v != null);
  assert.deepEqual(levers, [], `un lever a été fabriqué depuis un réveil sans coucher : ${levers}`);
  assert.deepEqual(T.jours.map(j => j.sommeil_h).filter(v => v != null), [],
                   'et aucune durée de sommeil ne vient de cet appariement-là');
});

test('la table élit la même nuit que Ma carte : le rythme de la personne', () => {
  const U = 'table-rythme';
  /*
   * Le cas choisi est celui où les deux règles DIVERGENT — sinon le test ne
   * prouve rien. Quelqu'un dont le rythme est 12:00 → 21:00 : sur un jour à
   * deux silences, la règle sans rythme prend le premier (05:30 → 10:00), et
   * seul le rythme retrouve sa vraie nuit. Si la table ne le reçoit pas, elle
   * contredit « Ma carte » sur la même journée.
   */
  for (let i = 0; i < 12; i++)
    poserActiviteJour(U, J(i), jourDe(J(i), { trous: [{ de: `12:0${i % 5}`, a: `21:0${i % 5}`, minutes: 540 }] }));
  poserActiviteJour(U, J(12), jourDe(J(12), { trous: [{ de: '05:30', a: '10:00', minutes: 270 },
                                                      { de: '12:00', a: '21:00', minutes: 540 }] }));
  oublierRythme(U);
  const T = tableDe(U, { jours: 30, jusquA: J(12) });
  assert.equal(ligne(T, J(12)).lever, 21, 'la table a lu cette nuit-là sans le rythme de la personne');
  assert.equal(ligne(T, J(12)).sommeil_h, 9);
});
