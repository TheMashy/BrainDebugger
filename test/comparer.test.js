/**
 * Les comparaisons. Ce qui est testé, c'est ce qu'elles REFUSENT de dire.
 *
 * Un modèle à qui on demande « donne un chiffre » en invente un, et il le
 * formule si bien qu'on ne peut pas le distinguer d'un vrai. Ici il ne rend
 * qu'un identifiant ; la phrase vient du serveur.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { comparaisons, comparaisonBlock, MIN_COTE, MIN_ECART } from '../server/comparer.js';

const jour = (i) => new Date(Date.UTC(2024, 0, 1 + i)).toISOString().slice(0, 10);
const corpus = (f, n = 240) => Array.from({ length: n }, (_, i) => ({ date: jour(i), ...f(jour(i), i) }));

test('un creux réel sur un jour de la semaine ressort', () => {
  // 2024-01-01 est un lundi : (i + 6) % 7 === 6 donne les dimanches.
  const rows = corpus(d => {
    const dim = (new Date(Date.parse(d + 'T00:00:00Z')).getUTCDay() + 6) % 7 === 6;
    return { note: dim ? 4 : 7, text: 'x' };
  });
  const c = comparaisons(rows);
  const dim = c.find(x => x.phrase.includes('dimanche'));
  assert.ok(dim, 'le creux du dimanche n’est pas ressorti');
  assert.match(dim.phrase, /les dimanches sont à 4 de moyenne, contre 7 les autres jours \(\d+ dimanches\)/);
  assert.equal(dim.ecart, -3);
});

test('un corpus plat ne produit aucune comparaison', () => {
  // C'est le cas qui compte : sans ce refus, l'application publierait du bruit
  // avec la même assurance qu'un fait.
  assert.deepEqual(comparaisons(corpus(() => ({ note: 6, text: 'x' }))), []);
});

test('un écart plus petit que l’arrondi de la note est écarté', () => {
  // Quelqu'un qui hésite entre 6 et 7 produit cet écart-là sans que rien n'ait
  // changé dans sa vie.
  const rows = corpus(d => {
    const dim = (new Date(Date.parse(d + 'T00:00:00Z')).getUTCDay() + 6) % 7 === 6;
    return { note: dim ? 6 : 6 + MIN_ECART / 2, text: 'x' };
  });
  assert.ok(!comparaisons(rows).some(x => x.phrase.includes('dimanche')));
});

test('un côté trop mince est écarté, même avec un écart énorme', () => {
  const rows = corpus((d, i) => ({ note: i < MIN_COTE - 1 ? 0 : 8, text: 'x' }), 200);
  for (const c of comparaisons(rows)) assert.ok(c.n >= MIN_COTE, c.phrase);
});

test('écrire ou non se compare, sans supposer une cause', () => {
  const rows = corpus((d, i) => ({ note: i % 2 ? 8 : 4, text: i % 2 ? 'une vraie journée' : '' }));
  const c = comparaisons(rows).find(x => x.phrase.includes('où tu écris'));
  assert.ok(c);
  assert.match(c.phrase, /journées où tu écris sont à 8, celles où tu ne notes qu'un chiffre à 4/);
  assert.doesNotMatch(c.phrase, /parce que|donc|cause/);
});

test('les journées longues se comparent sur un quantile, pas sur un nombre de signes', () => {
  // « long » ne veut pas dire la même chose chez quelqu'un qui écrit trois
  // lignes et chez quelqu'un qui en écrit trente.
  const court = corpus((d, i) => ({ note: i % 5 === 0 ? 9 : 5, text: 'x'.repeat(i % 5 === 0 ? 40 : 8) }));
  const long = corpus((d, i) => ({ note: i % 5 === 0 ? 9 : 5, text: 'x'.repeat(i % 5 === 0 ? 4000 : 800) }));
  const p = r => comparaisons(r).find(x => x.phrase.includes('les plus écrites'));
  assert.ok(p(court) && p(long));
  assert.equal(p(court).ecart, p(long).ecart);
});

test('le lendemain d’une journée basse se mesure', () => {
  const rows = corpus((d, i) => ({ note: i % 10 === 0 ? 2 : (i % 10 === 1 ? 3 : 7), text: 'x' }));
  const c = comparaisons(rows).find(x => x.phrase.includes('lendemain'));
  assert.ok(c);
  assert.match(c.phrase, /le lendemain d'une journée à 3 ou moins/);
});

test('les repères ne servent que s’il y en a', () => {
  const rows = corpus((d, i) => ({ note: i < 30 ? 3 : 8, text: 'x' }));
  assert.ok(!comparaisons(rows).some(x => x.phrase.includes('repère')));
  const c = comparaisons(rows, [{ date: jour(0) }, { date: jour(5) }, { date: jour(12) }]);
  assert.ok(c.some(x => x.phrase.includes('repère')));
  // Une date invalide ne fait pas planter le calcul.
  assert.ok(Array.isArray(comparaisons(rows, [{ date: 'lol' }, { date: null }])));
});

test('les identifiants sont uniques et les écarts triés', () => {
  const rows = corpus((d, i) => ({ note: (i * 7) % 11, text: i % 3 ? 'x' : '' }));
  const c = comparaisons(rows);
  assert.equal(new Set(c.map(x => x.id)).size, c.length);
  for (let i = 1; i < c.length; i++) {
    assert.ok(Math.abs(c[i - 1].ecart) >= Math.abs(c[i].ecart), 'pas trié par écart');
  }
  assert.ok(c.length <= 12);
});

test('le bloc dit au modèle de ne pas recopier le nombre', () => {
  const b = comparaisonBlock([{ id: 'c1', phrase: 'les dimanches sont à 4, contre 7', ecart: -3, n: 50 }]);
  assert.match(b, /\[c1\] les dimanches/);
  assert.match(b, /recopies PAS le nombre/);
  assert.equal(comparaisonBlock([]), null);
  assert.equal(comparaisonBlock(null), null);
});

test('un corpus trop court ne compare rien', () => {
  assert.deepEqual(comparaisons(corpus(() => ({ note: 5, text: 'x' }), 6)), []);
  assert.deepEqual(comparaisons([]), []);
  assert.deepEqual(comparaisons(null), []);
});
