/**
 * DEMANDER SON CHIFFRE : parfois, après une bascule, jamais en boucle.
 *
 * D'abord la règle pure (peutDemander, demandeOuverte, formulesRecentes), puis
 * le parcours réel à travers les outils du compagnon, sur une base jetable.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { peutDemander, demandeOuverte, formulesRecentes, MAX_PAR_JOUR } from '../server/demande-note.js';

const J = '2026-05-10';
const at = (h, m = 0) => new Date(`${J}T${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00Z`);
const iso = (h, m = 0) => at(h, m).toISOString();

/* ---------------- la règle ---------------- */

test('sans relevé récent, pas de question', () => {
  assert.equal(peutDemander({ date: J, maintenant: at(20), releves: [] }).ok, false);
  // un relevé de 19h n'est plus frais à 20h
  assert.equal(peutDemander({ date: J, maintenant: at(20), releves: [{ ts: iso(19) }] }).ok, false);
});

test('une bascule fraîche, rien demandé : oui', () => {
  const v = peutDemander({ date: J, maintenant: at(20, 10), releves: [{ ts: iso(20) }] });
  assert.equal(v.ok, true);
});

test('une question sans réponse ferme la journée : pas de relance', () => {
  const v = peutDemander({
    date: J, maintenant: at(23),
    demandes: [{ date: J, ts: iso(14), reponse: null }],
    releves: [{ ts: iso(22, 50) }]
  });
  assert.equal(v.ok, false);
  assert.match(v.pourquoi, /sans réponse/);
});

test(`pas moins de quatre heures entre deux questions`, () => {
  const v = peutDemander({
    date: J, maintenant: at(17),
    demandes: [{ date: J, ts: iso(14), reponse: 6 }],
    releves: [{ ts: iso(16, 55) }]
  });
  assert.equal(v.ok, false);
  assert.equal(peutDemander({
    date: J, maintenant: at(18, 30),
    demandes: [{ date: J, ts: iso(14), reponse: 6 }],
    releves: [{ ts: iso(18, 20) }]
  }).ok, true);
});

test(`pas plus de ${MAX_PAR_JOUR} questions par jour`, () => {
  const v = peutDemander({
    date: J, maintenant: at(23),
    demandes: [{ date: J, ts: iso(8), reponse: 5 }, { date: J, ts: iso(13), reponse: 3 }],
    releves: [{ ts: iso(22, 50) }]
  });
  assert.equal(v.ok, false);
});

test('la même bascule ne sert pas deux fois : le relevé doit suivre la dernière question', () => {
  const v = peutDemander({
    date: J, maintenant: at(21),
    demandes: [{ date: '2026-05-09', ts: '2026-05-09T23:59:00Z', reponse: 4 }],
    releves: [{ ts: iso(20, 30) }]
  });
  assert.equal(v.ok, true, 'la veille au soir ne bloque pas une bascule du lendemain soir');
  const meme = peutDemander({
    date: J, maintenant: at(20, 40),
    demandes: [{ date: J, ts: iso(20, 35), reponse: 4 }],
    releves: [{ ts: iso(20, 30) }]
  });
  assert.equal(meme.ok, false);
});

test('une réponse ne se rattache qu’à une question ouverte et récente', () => {
  const d = [{ id: 1, date: J, ts: iso(20), reponse: null }];
  assert.equal(demandeOuverte(d, J, at(20, 5))?.id, 1);
  assert.equal(demandeOuverte(d, J, at(23, 30)), null, 'trois heures plus tard, ça ne répond plus à la question');
  assert.equal(demandeOuverte([{ ...d[0], reponse: 7 }], J, at(20, 5)), null, 'déjà répondue');
});

test('les formules récentes reviennent, la plus récente d’abord', () => {
  const f = formulesRecentes([
    { ts: iso(8), formule: 'A' }, { ts: iso(12), formule: 'B' }, { ts: iso(16), formule: 'C' }
  ]);
  assert.deepEqual(f, ['C', 'B', 'A']);
});

/* ---------------- le parcours, à travers les outils ---------------- */

process.env.BD_DB = join(mkdtempSync(join(tmpdir(), 'bd-dn-')), 'test.db');
const { addMessage, demandesDepuis, deleteDay } = await import('../server/db.js');
const { outilsPour, routes } = await import('../server/api.js');
const U = 'local';

test('relevé → question → réponse, puis plus de question', async () => {
  addMessage({ ts: new Date().toISOString(), date: new Date().toISOString().slice(0, 10),
               role: 'user', text: 'ça allait et là tout s’effondre', userId: U });
  const o = outilsPour(U, 1);

  // Pas de réponse à rattacher tant qu'on n'a rien demandé.
  assert.ok(o.noter_moment({ valeur: 5 }).erreur);

  const r1 = o.relever_humeur({ valeur: 2, quoi: 'bascule nette vers le noir' });
  assert.match(r1.message, /Tu PEUX/, 'la bascule ouvre la question');

  assert.ok(o.demander_note({ formule: 'là, tout de suite, tu te mettrais combien ?' }).message);
  // Elle n'a pas encore répondu : on ne redemande pas.
  assert.ok(o.demander_note({ formule: 'et maintenant, sur 10 ?' }).erreur);

  assert.ok(o.noter_moment({ valeur: 11 }).erreur, 'hors échelle');
  assert.match(o.noter_moment({ valeur: 3 }).message, /Noté \(3\/10\)/);
  assert.ok(o.noter_moment({ valeur: 4 }).erreur, 'la question est fermée');

  // Nouvelle bascule tout de suite après : le relevé ne propose plus de question.
  const r2 = o.relever_humeur({ valeur: 7, quoi: 'remonte d’un coup en parlant du concert' });
  assert.doesNotMatch(r2.message, /Tu PEUX/);
  assert.ok(o.demander_note({ formule: 'tu dirais combien là ?' }).erreur, 'trop tôt');

  const d = demandesDepuis('2000-01-01', U);
  assert.equal(d.length, 1);
  assert.equal(d[0].reponse, 3);
});

test('les chiffres demandés sortent dans l’export, et partent avec la journée', async () => {
  const exp = routes['GET /api/export']({ userId: U });
  assert.equal(exp.demandesNote.length, 1);
  deleteDay(exp.demandesNote[0].date, U);
  assert.equal(demandesDepuis('2000-01-01', U).length, 0);
});
