/*
 * LA ROUTE DES PRISES, ET SON CACHE.
 *
 * Le cache n'est pas un confort. `prises()` repasse six familles d'expressions
 * sur tout le journal — 270 ms sur 750 journées d'un millier de caractères —
 * et le bloc du compagnon le demande à CHAQUE message envoyé. Sans cache,
 * c'est un quart de seconde de calcul bloquant ajouté à chaque phrase.
 *
 * Ce qui se teste ici, c'est donc les deux moitiés : que ça ne recalcule pas
 * pour rien, et que ça recalcule quand la personne a écrit. Un cache qui ne se
 * vide pas est pire que pas de cache — il montre hier.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.BD_DB = join(mkdtempSync(join(tmpdir(), 'bd-prises-')), 'test.db');
const { OWNER, addMessage, setNote } = await import('../server/db.js');
const { routes, invalidate } = await import('../server/api.js');

const J = i => { const d = new Date(); d.setUTCDate(d.getUTCDate() - 400 + i); return d.toISOString().slice(0, 10); };
const ecrire = (i, texte, note = 6) => {
  addMessage({ ts: Date.parse(J(i) + 'T21:00:00Z'), date: J(i), source: 'web', role: 'user', text: texte, userId: OWNER });
  setNote(J(i), note, OWNER);
};

test('sans journal, la route répond sans rien inventer', async () => {
  const r = await routes['GET /api/prises']({ userId: OWNER });
  assert.equal(r.assez, false);
  assert.deepEqual(r.prises, []);
});

test('trois jours écrits font apparaître la famille', async () => {
  for (let i = 0; i < 40; i++) ecrire(i, 'journée ordinaire, du travail et une marche.');
  for (const i of [10, 20, 30]) ecrire(i, "j'ai bu quatre bières ce soir.", 4);
  invalidate(OWNER);
  const r = await routes['GET /api/prises']({ userId: OWNER });
  assert.equal(r.prises.length, 1);
  assert.equal(r.prises[0].cle, 'alcool');
  assert.equal(r.prises[0].n, 3);
});

test('la route rend le même objet tant que rien n’est écrit', async () => {
  const a = await routes['GET /api/prises']({ userId: OWNER });
  const b = await routes['GET /api/prises']({ userId: OWNER });
  assert.equal(a, b, 'deux appels de suite doivent partager le résultat, pas le recalculer');
});

test('écrire vide le cache — sinon la vue montre hier', async () => {
  const avant = await routes['GET /api/prises']({ userId: OWNER });
  ecrire(35, "j'ai encore bu ce soir.", 3);
  invalidate(OWNER);
  const apres = await routes['GET /api/prises']({ userId: OWNER });
  assert.notEqual(avant, apres);
  assert.equal(apres.prises[0].n, 4, 'la journée qui vient d’être écrite compte');
});
