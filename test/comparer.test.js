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

/** Hasard à graine fixe : un test qui échoue doit échouer pareil au prochain lancement. */
function alea(graine) {
  let s = graine >>> 0;
  return () => {
    s = (s + 0x6D2B79F5) >>> 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const gauss = r => Math.sqrt(-2 * Math.log(1 - r())) * Math.cos(2 * Math.PI * r());
const borne = v => Math.max(0, Math.min(10, Math.round(v)));

/**
 * Une série qui ressemble à un vrai journal, SANS aucun effet de calendrier ni
 * d'écriture : une note colle à la veille (AR(1), phi = 0,3), le niveau change
 * deux fois de 0,6 point, et l'écriture arrive par périodes.
 */
function journalSansEffet(graine, n = 1700) {
  const r = alea(graine);
  let e = 0;
  return Array.from({ length: n }, (_, i) => {
    e = 0.3 * e + 1.25 * gauss(r);
    const niveau = i < 600 ? 6 : i < 1150 ? 5.4 : 6;
    // Trois journées écrites isolées, puis une période d'écriture dense à la fin.
    const ecrit = i === 700 || i === 900 || i === 1300 || (i >= n - 60 && r() < 0.75);
    return { date: new Date(Date.UTC(2021, 0, 1 + i)).toISOString().slice(0, 10),
             note: borne(niveau + e), text: ecrit ? 'x'.repeat(50 + Math.floor(r() * 2000)) : '' };
  });
}
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
  // Des journées écrites éparpillées au hasard sur quatorze mois, et un vrai
  // écart : il doit tenir mois par mois.
  const r = alea(3);
  const rows = corpus(() => { const e = r() < 0.5; return { note: e ? 8 : 4, text: e ? 'une vraie journée' : '' }; }, 420);
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
  assert.match(c.phrase, /les lendemains d'une journée à 3 ou moins sont à/);
  // La veille est dite : sans elle, la phrase taisait que le lendemain remonte.
  assert.match(c.phrase, /\(la veille : 2\.5\)/);
  // Jamais seulement les issues favorables : ceux qui remontent ET ceux qui restent bas.
  assert.match(c.phrase, /\d+ sur \d+ remontent d'au moins 2 points, \d+ restent à 3 ou moins/);
});

test('les repères ne servent que s’il y en a', () => {
  const rows = corpus((d, i) => ({ note: i < 30 ? 3 : 8, text: 'x' }));
  assert.ok(!comparaisons(rows).some(x => x.phrase.includes('repère')));
  const c = comparaisons(rows, [{ date: jour(0) }, { date: jour(5) }, { date: jour(12) }]);
  assert.ok(c.some(x => x.phrase.includes('repère')));
  // Une date invalide ne fait pas planter le calcul.
  assert.ok(Array.isArray(comparaisons(rows, [{ date: 'lol' }, { date: null }])));
});

test('les identifiants sont uniques, et le mieux établi passe devant', () => {
  // Trier par |écart| mettait en tête le plus petit groupe : une moyenne sur
  // neuf journées est la plus extrême (malédiction du vainqueur).
  const rows = corpus((d, i) => {
    const dim = (new Date(Date.parse(d + 'T00:00:00Z')).getUTCDay() + 6) % 7 === 6;
    return { note: (i % 10 === 0 ? 2 : i % 10 === 1 ? 3 : dim ? 4 : 7), text: i % 3 ? 'x' : '' };
  }, 500);
  const c = comparaisons(rows);
  assert.ok(c.length >= 2, c.map(x => x.phrase).join(' | '));
  assert.equal(new Set(c.map(x => x.id)).size, c.length);
  for (let i = 1; i < c.length; i++) assert.ok(c[i - 1].p <= c[i].p, 'pas trié par p');
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

/* ------------- ce qui ne doit plus passer : le bruit d'un vrai journal ------------- */

test('sur un journal sans aucun effet, au plus une graine sur dix publie un jour, un mois ou « écrire »', () => {
  // Le moteur d'avant publiait des mois et « les journées où tu écris » dans
  // la plupart des graines : les journées se ressemblent d'un jour à l'autre et
  // le niveau change d'une année à l'autre, et rien n'en tenait compte.
  let graines = 0;
  const vus = [];
  for (let g = 1; g <= 50; g++) {
    const c = comparaisons(journalSansEffet(g))
      .filter(x => /les \w+s sont à|les mois d|où tu écris|les plus écrites/.test(x.phrase));
    if (c.length) { graines++; vus.push(...c.map(x => x.phrase.slice(0, 40))); }
  }
  assert.ok(graines <= 5, `${graines} graines sur 50 : ${vus.join(' | ')}`);
});

test('écrire pendant une bonne période ne fait pas « les journées où tu écris »', () => {
  // 400 journées à un chiffre autour de 5,5, puis 45 journées écrites autour
  // de 6,5 : c'est une période, pas l'écriture.
  const r = alea(7);
  const bloc = Array.from({ length: 445 }, (_, i) => ({
    date: jour(i),
    note: borne((i < 400 ? 5.5 : 6.5) + gauss(r)),
    text: i < 400 ? '' : 'x'.repeat(40 + Math.floor(r() * 3000))
  }));
  const rien = rows => comparaisons(rows).filter(x => /où tu écris|les plus écrites/.test(x.phrase));
  assert.deepEqual(rien(bloc), []);
  // Trois journées écrites isolées, dans trois autres mois, n'y changent rien.
  const eparpille = bloc.map((x, i) => ([40, 130, 250].includes(i) ? { ...x, text: 'une journée écrite' } : x));
  assert.deepEqual(rien(eparpille), []);
});

test('le lendemain d’une journée basse tient sur une série qui colle, avec des creux', () => {
  const r = alea(11);
  let e = 0;
  const rows = Array.from({ length: 900 }, (_, i) => {
    // Un creux entre dans la série et s'y estompe : le lendemain en garde un peu.
    e = 0.3 * e + 1.2 * gauss(r) + (i % 37 === 0 ? -4 : 0);
    return { date: jour(i), note: borne(6 + e), text: '' };
  });
  const c = comparaisons(rows).find(x => x.phrase.includes('lendemains'));
  assert.ok(c, 'le lendemain d’une journée basse n’est pas ressorti');
  assert.ok(c.ecart < 0);
  assert.match(c.phrase, /la veille/);
});

test('une vraie saison se dit en mois, pas en journées', () => {
  // Cinq ans, août plus haut chaque année : « sur 5 mois d'août ».
  const r = alea(5);
  let e = 0;
  const rows = Array.from({ length: 5 * 365 }, (_, i) => {
    const d = new Date(Date.UTC(2020, 0, 1 + i)).toISOString().slice(0, 10);
    e = 0.3 * e + 1.1 * gauss(r);
    return { date: d, note: borne(5.5 + e + (d.slice(5, 7) === '08' ? 2 : 0)), text: '' };
  });
  const c = comparaisons(rows).find(x => x.phrase.includes('août'));
  assert.ok(c, 'le mois d’août n’est pas ressorti');
  assert.match(c.phrase, /les mois d'août sont à [\d.]+, contre [\d.]+ le reste de l'année \(sur 5 mois d'août\)/);
  assert.doesNotMatch(c.phrase, /journées/);
});

test('un mois qui ne va dans le même sens qu’une année sur deux ne se publie pas', () => {
  // Août très haut deux années, plus bas les trois autres : l'écart global
  // existe, la saison non.
  const r = alea(9);
  const rows = Array.from({ length: 5 * 365 }, (_, i) => {
    const d = new Date(Date.UTC(2020, 0, 1 + i)).toISOString().slice(0, 10);
    const an = Number(d.slice(0, 4));
    const aout = d.slice(5, 7) === '08' ? (an === 2020 || an === 2022 ? 4 : -0.5) : 0;
    return { date: d, note: borne(5.5 + 0.8 * gauss(r) + aout), text: '' };
  });
  assert.ok(!comparaisons(rows).some(x => x.phrase.includes('août')));
});

test('aucune phrase ne parle de quelqu’un : des jours, jamais « tu es »', () => {
  const r = alea(13);
  const jeux = [
    corpus((d, i) => ({ note: i % 10 === 0 ? 2 : (i % 10 === 1 ? 3 : 7), text: 'x' }), 400),
    corpus(d => ({ note: (new Date(Date.parse(d + 'T00:00:00Z')).getUTCDay() + 6) % 7 === 6 ? 4 : 7, text: 'x' }), 400),
    corpus(() => { const e = r() < 0.5; return { note: e ? 8 : 4, text: e ? 'une vraie journée' : '' }; }, 420),
    journalSansEffet(3)
  ];
  let vues = 0;
  for (const rows of jeux) {
    for (const c of comparaisons(rows, [{ date: jour(10) }, { date: jour(200) }])) {
      vues++;
      assert.doesNotMatch(c.phrase, /\btu (es|vas|seras|étais)\b/, c.phrase);
      if (c.phrase.includes('lendemain')) assert.match(c.phrase, /la veille/);
    }
  }
  assert.ok(vues >= 3, 'le test doit voir des phrases');
});

test('le bloc ne dit plus au modèle que les comparaisons sont « exactes » tout court', () => {
  const b = comparaisonBlock([{ id: 'c1', phrase: 'x', ecart: 1, n: 50 }]);
  assert.doesNotMatch(b, /Elles sont exactes/);
  assert.match(b, /Le calcul est exact ; ce sont des écarts observés, pas des causes/);
});
