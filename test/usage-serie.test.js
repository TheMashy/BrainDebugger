/**
 * LA COURBE NE MONTRAIT QU'UNE CHOSE, ET CE N'ÉTAIT PAS LA BONNE.
 *
 * Les jetons TRAVERSÉS par période montent avec l'usage : cinquante échanges à
 * moitié prix font une barre plus haute que vingt échanges au prix fort. On ne
 * peut donc pas y lire « est-ce que ça baisse ? », qui est la seule question
 * qu'on se pose en optimisant.
 *
 * Quatre mesures sur la même série, et le choix de la mesure est le choix de la
 * question. Ces tests fixent surtout deux choses qu'il serait facile de rater :
 * une période sans échange n'a pas de prix par échange (elle vaut `null`, pas
 * zéro), et un échange qui traverse minuit reste UN échange.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.BD_DB = join(mkdtempSync(join(tmpdir(), 'bd-serie-')), 'test.db');
const { db, upsertUser } = await import('../server/db.js');
const { serieUsage, FENETRES } = await import('../server/usage.js');

const U = 'serie';
upsertUser({ id: U, username: U });

/** Un appel, posé à une date absolue. */
const poser = (ts, o = {}) => db.prepare(`
  INSERT INTO usage(user_id, ts, month, model, input_tokens, output_tokens,
                    cache_read_tokens, cache_write_tokens, source)
  VALUES(?,?,?,?,?,?,?,?,?)`).run(
  U, ts, ts.slice(0, 7), o.model ?? 'claude-sonnet-5',
  o.input ?? 0, o.output ?? 0, o.lu ?? 0, o.ecrit ?? 0, o.source ?? 'chat');

/** Le jour J moins n, à une heure donnée. */
const jour = (n, h = 12, m = 0) => {
  const d = new Date();
  d.setUTCHours(h, m, 0, 0);
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString();
};

// Deux journées : la première chère (peu de cache), la seconde bon marché.
// C'est exactement la forme d'une optimisation qui a servi.
for (let i = 0; i < 3; i++) {
  poser(jour(5, 10, i * 5), { input: 20_000, output: 500, source: 'chat' });
}
for (let i = 0; i < 3; i++) {
  poser(jour(2, 10, i * 5), { input: 2_000, output: 500, lu: 18_000, source: 'chat' });
}

test('une période sans échange n’a pas de prix par échange — null, jamais zéro', () => {
  const s = serieUsage(U, 'jour');
  const creux = s.points.filter(p => !p.echanges);
  assert.ok(creux.length, 'il y a bien des journées vides dans les trente');
  for (const p of creux) {
    assert.equal(p.cout_par_echange, null);
    assert.equal(p.par_echange, null);
    assert.equal(p.tokens, 0, 'le volume, lui, vaut bien zéro : rien n’a traversé');
  }
});

test('le prix d’un échange baisse quand le cache prend — c’est ce qu’on vient voir', () => {
  const s = serieUsage(U, 'jour');
  const cher = s.points.find(p => p.k === jour(5).slice(0, 10));
  const doux = s.points.find(p => p.k === jour(2).slice(0, 10));
  assert.equal(cher.echanges, 3, 'cinq minutes séparent chaque appel : trois échanges');
  assert.equal(doux.echanges, 3);
  assert.ok(doux.par_echange < cher.par_echange / 3,
    `${doux.par_echange} contre ${cher.par_echange} : le cache divise le prix`);
  assert.ok(doux.cout_par_echange < cher.cout_par_echange);
  assert.ok(doux.part_cache > 80 && cher.part_cache === 0,
    'la part du cache est la CAUSE, et elle se lit sur la même série');
  // Et le VOLUME, lui, ne dit rien de tout ça : les deux journées se valent.
  assert.ok(Math.abs(doux.tokens - cher.tokens) / cher.tokens < 0.1,
    `${doux.tokens} contre ${cher.tokens} traversés : le volume ne voit pas l’optimisation`);
});

test('un échange qui traverse minuit reste UN échange, rangé au jour de son début', () => {
  const V = 'minuit';
  upsertUser({ id: V, username: V });
  const d = new Date(); d.setUTCHours(0, 0, 0, 0); d.setUTCDate(d.getUTCDate() - 3);
  const avant = new Date(d.getTime() - 30_000).toISOString();   // 23:59:30 la veille
  const apres = new Date(d.getTime() + 30_000).toISOString();   // 00:00:30
  for (const ts of [avant, apres]) db.prepare(`
    INSERT INTO usage(user_id, ts, month, model, input_tokens, output_tokens,
                      cache_read_tokens, cache_write_tokens, source)
    VALUES(?,?,?,?,?,?,?,?,?)`).run(V, ts, ts.slice(0, 7), 'claude-sonnet-5', 100, 10, 0, 0, 'chat');
  const s = serieUsage(V, 'jour');
  assert.equal(s.echanges, 1, 'une minute d’écart : c’est le même échange');
  const veille = s.points.find(p => p.k === avant.slice(0, 10));
  assert.equal(veille.echanges, 1, 'rangé au jour de son PREMIER appel');
  assert.equal(s.points.find(p => p.k === apres.slice(0, 10)).echanges, 0);
});

test('chat et carte ne se fondent pas dans le même échange', () => {
  const W = 'sources';
  upsertUser({ id: W, username: W });
  const t = jour(1, 9, 0);
  const t2 = new Date(Date.parse(t) + 10_000).toISOString();
  for (const [ts, src] of [[t, 'chat'], [t2, 'carte']]) db.prepare(`
    INSERT INTO usage(user_id, ts, month, model, input_tokens, output_tokens,
                      cache_read_tokens, cache_write_tokens, source)
    VALUES(?,?,?,?,?,?,?,?,?)`).run(W, ts, ts.slice(0, 7), 'claude-sonnet-5', 100, 10, 0, 0, src);
  const s = serieUsage(W, 'jour');
  assert.equal(s.echanges, 2,
    'une relecture de la carte lancée pendant une conversation n’est pas le même échange');
});

test('les quatre fenêtres rendent le bon nombre de pas, du plus fin au plus large', () => {
  for (const [g, f] of Object.entries(FENETRES)) {
    const s = serieUsage(U, g);
    assert.equal(s.points.length, f.pas, g);
    assert.equal(s.unite, f.unite);
    // Les clés sont triées et sans doublon : c'est ce qui fait un axe.
    const ks = s.points.map(p => p.k);
    assert.deepEqual(ks, [...ks].sort(), g);
    assert.equal(new Set(ks).size, ks.length, g);
  }
});

test('les mois et les semaines rassemblent ce que les jours éparpillent', () => {
  const mois = serieUsage(U, 'mois');
  assert.equal(mois.echanges, 6, 'les six échanges sont là, quelle que soit la fenêtre');
  assert.equal(serieUsage(U, 'jour').echanges, 6);
  // Le dernier seau du mois porte tout : les deux journées sont récentes.
  assert.equal(mois.points.at(-1).echanges, 6);
});

test('chaque mesure a son propre pic — sinon les trois autres s’écrasent contre l’axe', () => {
  const s = serieUsage(U, 'jour');
  assert.ok(s.pics.volume > 1000, 'des jetons');
  assert.ok(s.pics.jetons > 0 && s.pics.jetons < s.pics.volume);
  assert.ok(s.pics.cout > 0 && s.pics.cout < 1);
  assert.equal(s.pics.cache, 100, 'un pourcentage a son plafond, pas son maximum observé');
});
