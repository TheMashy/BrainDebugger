/**
 * CE QUE COÛTE UN ÉCHANGE. Le total du mois ne dit pas si une optimisation a
 * servi — il monte avec l'usage. Le prix d'UN échange, lui, se compare d'une
 * semaine à l'autre, et c'est la seule mesure qui répond à la question.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.BD_DB = join(mkdtempSync(join(tmpdir(), 'bd-profil-')), 'test.db');
const { db } = await import('../server/db.js');
const { echangesDe, profilUsage } = await import('../server/usage.js');

const ligne = (ts, o = {}) => ({ ts, model: 'claude-sonnet-5', input_tokens: 0, output_tokens: 0,
                                 cache_read_tokens: 0, cache_write_tokens: 0, ...o });

test('trois appels rapprochés font UN échange, pas trois', () => {
  // Le compagnon qui pose un repère puis marque un motif : trois appels, une
  // réponse. Compter trois échanges diviserait le coût réel par trois.
  const ech = echangesDe([
    ligne('2026-09-07T20:00:00.000Z', { input_tokens: 100 }),
    ligne('2026-09-07T20:00:04.000Z', { input_tokens: 100 }),
    ligne('2026-09-07T20:00:09.000Z', { input_tokens: 100 })
  ]);
  assert.equal(ech.length, 1);
  assert.equal(ech[0].appels, 3);
  assert.equal(ech[0].equivalent, 300);
});

test('deux minutes de silence séparent deux échanges', () => {
  const ech = echangesDe([
    ligne('2026-09-07T20:00:00.000Z', { input_tokens: 10 }),
    ligne('2026-09-07T20:05:00.000Z', { input_tokens: 10 })
  ]);
  assert.equal(ech.length, 2);
});

test('l’équivalent compte le cache à son prix, pas au tarif plein', () => {
  const [e] = echangesDe([ligne('2026-09-07T20:00:00.000Z',
    { input_tokens: 1000, output_tokens: 100, cache_read_tokens: 10_000, cache_write_tokens: 400 })]);
  assert.equal(e.traverses, 11_500, 'ce qui a traversé le modèle');
  assert.equal(e.equivalent, 1000 + 100 + 1000 + 500, 'relu à un dixième, écrit à cinq quarts');
  assert.ok(e.equivalent < e.traverses / 4, `${e.equivalent} contre ${e.traverses} traversés`);
});

test('la médiane, pas la moyenne : un échange géant ne cache pas le quotidien', () => {
  const U = 'profil-mediane';
  const t = s => new Date(Date.now() - s * 1000).toISOString();
  const pose = (ts, inp) => db.prepare(
    `INSERT INTO usage(user_id, ts, month, model, input_tokens, output_tokens,
                       cache_read_tokens, cache_write_tokens, source)
     VALUES(?,?,?,?,?,0,0,0,'chat')`
  ).run(U, ts, ts.slice(0, 7), 'claude-sonnet-5', inp);
  // Cinq échanges ordinaires cette semaine, plus un document collé.
  [3600, 7200, 10800, 14400, 18000].forEach((s, i) => pose(t(s), 1000 + i));
  pose(t(21600), 900_000);
  const p = profilUsage(U).chat.semaine;
  assert.equal(p.echanges, 6);
  // Six valeurs : la médiane est entre la 3e et la 4e. La moyenne, elle,
  // dirait 150 000 — l'échange géant écraserait les cinq autres.
  assert.equal(p.par_echange, 1002.5, 'la médiane tient bon');
});

test('la semaine et la précédente se comparent — c’est là que l’optimisation se voit', () => {
  const U = 'profil-semaines';
  const t = j => new Date(Date.now() - j * 864e5).toISOString();
  const pose = (ts, inp, lu) => db.prepare(
    `INSERT INTO usage(user_id, ts, month, model, input_tokens, output_tokens,
                       cache_read_tokens, cache_write_tokens, source)
     VALUES(?,?,?,?,?,0,?,0,'chat')`
  ).run(U, ts, ts.slice(0, 7), 'claude-sonnet-5', inp, lu);
  // Avant : tout plein tarif. Après : tout relu du cache.
  for (let i = 0; i < 4; i++) pose(t(8 + i), 20_000, 0);
  for (let i = 0; i < 4; i++) pose(t(1 + i * 0.2), 1_000, 19_000);
  const { semaine, avant } = profilUsage(U).chat;
  assert.equal(avant.part_cache, 0, 'rien n’était relu');
  assert.ok(semaine.part_cache > 90, `${semaine.part_cache} % relu du cache`);
  assert.ok(semaine.par_echange < avant.par_echange / 5,
            `${semaine.par_echange} contre ${avant.par_echange} par échange`);
});

test('une fenêtre vide ne rend pas des zéros trompeurs', () => {
  const p = profilUsage('profil-vide').chat.semaine;
  assert.equal(p.echanges, 0);
  assert.equal(p.par_echange, null, 'pas de médiane sans échange');
  assert.equal(p.part_cache, null, 'pas de part de cache sans entrée');
});
