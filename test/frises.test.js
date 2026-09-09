/*
 * UNE MARQUE PAR JOUR, SUR UN AXE DE TEMPS RÉEL.
 *
 * La frise d'un mécanisme groupait par MOIS : vingt occurrences étalées sur six
 * mois faisaient six barres, et la forme qu'on lisait était celle du
 * calendrier, pas celle du mécanisme. Un mois aplatit dans les deux sens — une
 * salve de cinq jours d'affilée et cinq occurrences réparties sur trente jours
 * sortaient identiques, alors que c'est exactement ce qu'on vient distinguer.
 *
 * Et « 4 sur 30 nuits » ne disait pas d'où venait le 4 : trois causes très
 * différentes (rien reçu / reçu mais pas dérivable / simplement pas assez) que
 * le chiffre seul ne permet pas de départager.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.BD_DB = join(mkdtempSync(join(tmpdir(), 'bd-frises-')), 'test.db');

const { db, upsertUser, addMessage, addMotif, marquerMotif, motifSeries, poserActiviteJour } =
  await import('../server/db.js');
const { addDays } = await import('../server/stats.js');
const { fonctionnements } = await import('../server/fonctionnements.js');

test('un mécanisme se compte par JOUR, pas par mois', () => {
  const U = 'frise-jour';
  upsertUser({ id: U, username: U });
  const m = addMotif({ nom: 'pensée de fin de nuit', mecanisme: 'les idées noires entre 3h et 6h', userId: U });
  // Deux occurrences le même jour, une le lendemain, une trois mois plus tard.
  const quand = [['2026-03-02', 2], ['2026-03-03', 1], ['2026-06-14', 1]];
  for (const [d, n] of quand) for (let i = 0; i < n; i++) {
    const id = addMessage({ ts: `${d}T0${i + 1}:12:00.000Z`, date: d, role: 'user', text: 'encore éveillé', userId: U });
    marquerMotif(m.id, id, U);
  }
  const serie = motifSeries(U).get(m.id);
  assert.deepEqual(serie, [{ periode: '2026-03-02', n: 2 },
                           { periode: '2026-03-03', n: 1 },
                           { periode: '2026-06-14', n: 1 }],
                   'la série doit porter des DATES, pas des mois');
  // Le piège : groupé par mois, les deux premiers jours fusionnaient en une
  // seule barre « 2026-03 » et la salve devenait invisible.
  assert.ok(serie.every(p => /^\d{4}-\d{2}-\d{2}$/.test(p.periode)));
  assert.equal(serie.length, 3, 'trois jours distincts, pas deux mois');
});

test('la jauge des nuits dit d’où vient son chiffre', async () => {
  /*
   * Trois causes, trois phrases. Devant « 4 / 30 » sans explication, on ne sait
   * pas s'il faut dormir plus, réparer l'application, ou attendre.
   */
  const rien = 'rien-recu';
  upsertUser({ id: rien, username: rien });
  const ins = db.prepare('INSERT INTO entries(user_id, date, text, note) VALUES(?,?,?,?)');
  const FIN = new Date().toISOString().slice(0, 10);
  for (let k = 0; k < 40; k++) ins.run(rien, addDays(FIN, -(39 - k)), 'journée écrite', 6);
  const jRien = fonctionnements(rien).jauges.find(j => j.cle === 'nuits');
  assert.match(jRien.pourquoi, /n’a rien envoyé/, jRien.pourquoi);

  /*
   * Des digests, mais dont aucun ne donne de nuit. Le cas réel : l'ordinateur
   * reste allumé en permanence, la plage court de minuit à minuit, et le seul
   * silence disponible (23:59 → 00:00) fait une minute — sous les deux heures
   * qu'il faut pour appeler ça une nuit. Machi Tool a tout envoyé, et il n'y a
   * rien à en tirer : c'est la deuxième des trois causes, et celle qu'un
   * chiffre nu ne permet pas de distinguer de la première.
   */
  const muet = 'recu-muet';
  upsertUser({ id: muet, username: muet });
  for (let k = 0; k < 40; k++) {
    const d = addDays(FIN, -(39 - k));
    ins.run(muet, d, 'journée écrite', 6);
    poserActiviteJour(muet, d, { date: d, plage: { de: '00:00', a: '23:59' }, trous: [],
                                 temps_par_contexte_s: { code: 3600 } });
  }
  const jMuet = fonctionnements(muet).jauges.find(j => j.cle === 'nuits');
  assert.match(jMuet.pourquoi, /journées mesurées/, jMuet.pourquoi);
  assert.match(jMuet.pourquoi, /pas de silence assez net|donne/, jMuet.pourquoi);
  assert.doesNotMatch(jMuet.pourquoi, /n’a rien envoyé/,
                      'des digests reçus ne doivent pas se lire comme « rien reçu »');
});
