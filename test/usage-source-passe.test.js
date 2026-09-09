/*
 * LA DÉPENSE DU PASSÉ RETROUVE D'OÙ ELLE VENAIT.
 *
 * `usage.source` est arrivée après coup : NULL sur tout ce qui précède. Or les
 * trois mesures qui disent si l'optimisation a servi — les jetons d'UN échange,
 * ses euros, la part relue du cache — se calculent source par source, pour ne
 * pas coller une relecture de la carte et une conversation dans le même
 * échange. Résultat : les courbes n'existaient pas sur la période d'avant,
 * c'est-à-dire exactement celle qu'on veut comparer à aujourd'hui.
 *
 * La ligne suivie d'une réponse du compagnon dans la seconde EST un échange de
 * chat — le journal le dit. Le reste est la carte, par élimination sur une
 * liste fermée de cinq appelants. Ce qui est vérifié ici : la lecture est
 * juste, elle ne touche pas à ce qui est déjà su, et elle ne repasse pas.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.BD_DB = join(mkdtempSync(join(tmpdir(), 'bd-usrc-')), 'test.db');

const { db, upsertUser, addMessage } = await import('../server/db.js');
const { attribuerLesAnciensAppels } = await import('../server/migrate.js');
const { serieUsage } = await import('../server/usage.js');

const U = 'passe';
upsertUser({ id: U, username: U });

const ilYA = min => new Date(Date.now() - min * 60_000).toISOString();
const appel = (ts, source = null, model = 'claude-opus-5') =>
  db.prepare(`INSERT INTO usage(user_id, ts, month, model, input_tokens, output_tokens,
                                cache_read_tokens, cache_write_tokens, source)
              VALUES(?,?,?,?,?,?,?,?,?)`)
    .run(U, ts, ts.slice(0, 7), model, 4000, 600, 12000, 800, source);
const dans = (ts, sec) => new Date(Date.parse(ts) + sec * 1000).toISOString();
const sourceDe = ts => db.prepare('SELECT source FROM usage WHERE user_id = ? AND ts = ?').get(U, ts)?.source;

/* Trois vieux appels : deux suivis d'une réponse du compagnon, un tout seul. */
const T_CHAT = ilYA(600), T_CHAT2 = ilYA(500), T_CARTE = ilYA(400);
appel(T_CHAT); appel(T_CHAT2); appel(T_CARTE);
addMessage({ ts: dans(T_CHAT, 0), date: T_CHAT.slice(0, 10), role: 'pet', text: 'je suis là', userId: U });
addMessage({ ts: dans(T_CHAT2, 2), date: T_CHAT2.slice(0, 10), role: 'pet', text: 'oui', userId: U });
/* Un message d'AUTRE CHOSE, loin : il ne doit rien attribuer. */
addMessage({ ts: dans(T_CARTE, 600), date: T_CARTE.slice(0, 10), role: 'pet', text: 'plus tard', userId: U });
/* Et une ligne déjà su : elle ne bouge pas. */
const T_SU = ilYA(300);
appel(T_SU, 'carte');
addMessage({ ts: dans(T_SU, 1), date: T_SU.slice(0, 10), role: 'pet', text: 'coïncidence', userId: U });

test('un appel suivi d’une réponse du compagnon dans la seconde est un échange de chat', () => {
  assert.equal(attribuerLesAnciensAppels(db), 3, 'trois lignes sans source à rattraper');
  assert.equal(sourceDe(T_CHAT), 'chat');
  assert.equal(sourceDe(T_CHAT2), 'chat', 'deux secondes après, c’est encore le même échange');
});

test('un appel que rien ne suit est du travail de fond', () => {
  assert.equal(sourceDe(T_CARTE), 'carte',
    'dix minutes plus tard, ce message-là ne parle pas de cet appel');
});

test('CE QUI ÉTAIT DÉJÀ SU N’EST PAS RÉÉCRIT', () => {
  // Le message tombe à une seconde de l'appel : la règle dirait « chat ».
  // Mais la ligne portait déjà sa source, écrite au moment où elle a eu lieu.
  assert.equal(sourceDe(T_SU), 'carte', 'une lecture après coup ne contredit pas ce qui a été noté sur le moment');
});

test('un second passage ne trouve plus rien', () => {
  assert.equal(attribuerLesAnciensAppels(db), 0);
});

test('et la courbe par échange existe enfin sur ces heures-là', () => {
  /*
   * C'est la raison de tout ceci. Avant, ces quatre appels étaient rangés dans
   * « autre » : ils faisaient une barre de volume, et RIEN dans les trois
   * mesures par échange — un trou là où on cherche justement la comparaison.
   */
  const s = serieUsage(U, 'heure');
  const avec = s.points.filter(p => p.cout_par_echange != null);
  assert.ok(avec.length >= 2, `au moins deux heures doivent porter un coût par échange (${avec.length})`);
  assert.ok(s.points.every(p => !p.autre), 'plus une seule ligne sans source');
});
