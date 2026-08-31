/**
 * CE QUI VA ENSEMBLE — et surtout, CE QU'ON REFUSE DE MONTRER.
 *
 * Le test central de ce fichier n'est pas « trouve-t-il un lien qui existe ? »
 * mais « combien en invente-t-il quand il n'y en a aucun ? ». Vingt séries
 * testées à deux décalages font quarante interrogations du hasard : au seuil
 * naïf de p < 0,05, on en attend deux « significatives » sur des données
 * entièrement aléatoires. Une application qui les affiche dit à quelqu'un que
 * son café explique son anxiété, et cette personne réorganise sa vie autour.
 *
 * On vérifie donc les deux sens : la sensibilité (un lien planté ressort) et la
 * spécificité (du bruit ne ressort pas). Le second est le seul qui protège.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as L from '../server/liens.js';

const J = n => new Date(Date.UTC(2026, 7, 31) - n * 86400000).toISOString().slice(0, 10);

/** Un générateur reproductible : un test statistique qui change de verdict
 *  d'une exécution à l'autre n'est pas un test, c'est un tirage. */
const alea = graine => {
  let s = graine;
  return () => (s = (s * 1103515245 + 12345) % 2147483648) / 2147483648;
};

/* ============ LA STATISTIQUE, CONTRE DES VALEURS PUBLIÉES ============ */

test('la bêta incomplète rend les valeurs connues', () => {
  // À 1e-7 près et pas à la précision machine : la fraction continue s'arrête
  // à sept chiffres significatifs, ce qui est très au-delà de ce dont un seuil
  // de décision a besoin. Exiger davantage ferait tourner la boucle deux fois
  // plus longtemps pour des décimales que personne ne lit.
  assert.ok(Math.abs(L.betai(0.5, 0.5, 0.5) - 0.5) < 1e-7);
  assert.equal(L.betai(2, 3, 0), 0);
  assert.equal(L.betai(2, 3, 1), 1);
});

test('les valeurs p correspondent aux tables de Student', () => {
  // Une table approchée se tromperait exactement là où ça compte : près du
  // seuil, qui est le seul endroit où la valeur sert à quelque chose.
  const proche = (a, b, tol) => assert.ok(Math.abs(a - b) < tol,
    `${a.toFixed(5)} attendu ${b} (±${tol})`);
  proche(L.valeurP(0.5, 30), 0.00490, 5e-5);
  proche(L.valeurP(0.361, 30), 0.0500, 5e-4);
  proche(L.valeurP(0.8, 10), 0.00548, 5e-5);
  proche(L.valeurP(0.632, 10), 0.0500, 5e-4);
  assert.equal(L.valeurP(0, 30) > 0.99, true);
});

test('Pearson : parfait, opposé, et indéfini quand rien ne varie', () => {
  assert.ok(Math.abs(L.correlation([1, 2, 3, 4], [2, 4, 6, 8]) - 1) < 1e-12);
  assert.ok(Math.abs(L.correlation([1, 2, 3, 4], [8, 6, 4, 2]) + 1) < 1e-12);
  // Une série constante n'a pas de corrélation : la formule y divise par zéro,
  // et rendre 0 ferait passer « aucune information » pour « aucun lien ».
  assert.equal(L.correlation([5, 5, 5, 5], [1, 2, 3, 4]), null);
  assert.equal(L.correlation([1, 2], [1, 2]), null, 'deux points suffisaient à faire un r de 1');
});

/* ============ BENJAMINI-HOCHBERG ============ */

test('BH garde le plus GRAND rang qui vérifie l’inégalité, pas le premier', () => {
  // La propriété qui distingue cette correction d'un seuil ligne à ligne : une
  // p qui échouerait prise seule passe si elle est sous un rang qui, lui, passe.
  const tests = [{ p: 0.001 }, { p: 0.008 }, { p: 0.039 }, { p: 0.2 }, { p: 0.7 }];
  const gardes = L.retenir(tests, 0.05).map(t => t.p);
  // k=3 : 0.039 <= 3/5 * 0.05 = 0.03 → faux ; k=2 : 0.008 <= 0.02 → vrai
  assert.deepEqual(gardes, [0.001, 0.008]);
});

test('BH ne garde rien quand rien ne passe, et tout quand tout passe', () => {
  assert.deepEqual(L.retenir([{ p: 0.4 }, { p: 0.6 }], 0.05), []);
  assert.equal(L.retenir([{ p: 1e-9 }, { p: 2e-9 }], 0.05).length, 2);
  assert.deepEqual(L.retenir([], 0.05), []);
});

/* ============ LA SENSIBILITÉ : un lien réel doit ressortir ============ */

test('un lien planté entre le sommeil et la note ressort', () => {
  const rnd = alea(42);
  const mesures = [], entries = [];
  for (let i = 0; i < 80; i++) {
    const som = 4 + rnd() * 5;
    mesures.push({ date: J(i), source: 'montre', cle: 'sommeil_h', valeur: som, unite: 'h' });
    entries.push({ date: J(i), note: Math.max(1, Math.min(10, Math.round(2 + (som - 4) * 0.9 + (rnd() - 0.5) * 2))) });
  }
  const out = L.liens(mesures, entries);
  const l = out.liens.find(x => x.cle === 'sommeil_h' && x.decalage === 0);
  assert.ok(l, 'le lien planté n’a pas été retrouvé');
  assert.ok(l.r > 0.5, `r trop faible : ${l.r}`);
  assert.equal(l.sens, 'haut');
});

/* ============ LA SPÉCIFICITÉ : c’est elle qui protège ============ */

test('VINGT SÉRIES DE BRUIT NE PRODUISENT PRESQUE AUCUN LIEN', () => {
  let inventes = 0, naifs = 0;
  const ESSAIS = 25;
  for (let e = 0; e < ESSAIS; e++) {
    const rnd = alea(1000 + e * 7);
    const mesures = [], entries = [];
    for (let i = 0; i < 70; i++) {
      entries.push({ date: J(i), note: Math.round(1 + rnd() * 9) });
      for (let k = 0; k < 20; k++) {
        mesures.push({ date: J(i), source: 'x', cle: `s${k}`, valeur: rnd() * 100 });
      }
    }
    inventes += L.liens(mesures, entries).liens.length;

    // Ce que ferait la version naïve : un seuil p < 0,05 appliqué ligne à ligne.
    const notes = new Map(entries.map(x => [x.date, x.note]));
    for (let k = 0; k < 20; k++) {
      for (const d of L.DECALAGES) {
        const { xs, ys } = L.apparier(mesures.filter(m => m.cle === `s${k}`), notes, d);
        const r = L.correlation(xs, ys);
        if (r != null && L.valeurP(r, xs.length) < 0.05) naifs++;
      }
    }
  }
  // Le seuil naïf en invente ~2 par jeu, exactement ce que prédit la théorie.
  assert.ok(naifs > ESSAIS, `le seuil naïf n’en a produit que ${naifs} — le test ne prouve rien`);
  assert.ok(inventes <= ESSAIS * 0.2,
    `${inventes} faux liens sur ${ESSAIS} jeux de bruit (le naïf en fait ${naifs})`);
});

/* ============ CE QU'ON APPARIE, ET CE QU'ON REFUSE D'APPARIER ============ */

test('le décalage décale bien du bon côté', () => {
  const notes = new Map([['2026-08-01', 3], ['2026-08-02', 9]]);
  const serie = [{ date: '2026-08-01', valeur: 7 }];
  assert.deepEqual(L.apparier(serie, notes, 0).ys, [3]);
  assert.deepEqual(L.apparier(serie, notes, 1).ys, [9], 'j+1 doit prendre la note du LENDEMAIN');
});

test('une journée sans note ne fabrique pas de paire', () => {
  // On ne comble pas un trou par une moyenne : ça ajouterait des points au
  // centre du nuage et gonflerait la confiance sans une seule observation.
  const notes = new Map([['2026-08-01', 5]]);
  const serie = [{ date: '2026-08-01', valeur: 1 }, { date: '2026-08-02', valeur: 2 }];
  assert.equal(L.apparier(serie, notes, 0).xs.length, 1);
});

test('une valeur nulle n’entre pas dans le calcul', () => {
  const notes = new Map([['2026-08-01', 5], ['2026-08-02', 6]]);
  const serie = [{ date: '2026-08-01', valeur: null }, { date: '2026-08-02', valeur: 2 }];
  assert.equal(L.apparier(serie, notes, 0).xs.length, 1);
});

test('sous MIN_POINTS journées, aucune série n’est testée', () => {
  const rnd = alea(9);
  const mesures = [], entries = [];
  for (let i = 0; i < L.MIN_POINTS - 1; i++) {
    mesures.push({ date: J(i), source: 'a', cle: 'x', valeur: i });
    entries.push({ date: J(i), note: Math.round(1 + rnd() * 9) });
  }
  const out = L.liens(mesures, entries);
  assert.equal(out.testes, 0, 'un coefficient sur dix-neuf points est du bruit décoré');
  assert.equal(out.assezDePoints, false);
});

/* ============ L'ÉCART EN POINTS, QUI EST CE QU'ON AFFICHE ============ */

test('l’écart de moitié coupe à la médiane et compare les deux moyennes', () => {
  const xs = [1, 2, 3, 4, 5, 6, 7, 8];
  const ys = [2, 2, 2, 2, 8, 8, 8, 8];
  const m = L.ecartDeMoitie(xs, ys);
  assert.equal(m.seuil, 4.5);
  assert.equal(m.sous, 2);
  assert.equal(m.sur, 8);
  assert.equal(m.ecart, 6);
});

test('une moitié trop petite ne produit pas d’écart', () => {
  // Une série de pas avec trois journées de randonnée a une moyenne que quatre
  // jours sur cinq ne dépassent jamais : la coupure tomberait sur un groupe
  // minuscule, et l'écart serait une anecdote présentée comme une règle.
  assert.equal(L.ecartDeMoitie([1, 1, 1, 1, 9], [1, 2, 3, 4, 5]), null);
});

/* ============ LE PLANCHER : ce qui le franchit, et ce qui ne le franchit pas ============ */

test('SOUS LE PLANCHER, LES MESURES PASSENT MAIS PAS LEURS LIENS', async () => {
  /*
   * La règle du plancher n'est pas « on cache tout » : les repères et les notes
   * apportées le franchissent déjà, parce que ce sont des faits, pas une
   * statistique calculée sur quelqu'un. Une durée de sommeil relevée par une
   * montre est de la même nature.
   *
   * La phrase du lien, elle, est exactement ce que le plancher retient. « Les
   * journées au-dessus de 6,2 h sont notées 2,2 points plus haut », sur une
   * journée que quelqu'un vient de noter 2, c'est l'application qui explique à
   * quelqu'un qui va mal que ça se voyait venir.
   */
  const { mkdtempSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  process.env.BD_DB = join(mkdtempSync(join(tmpdir(), 'bd-plancher-')), 'test.db');
  const db = await import('../server/db.js');
  const api = await import('../server/api.js');

  const rnd = alea(3);
  const som = new Map();
  for (let i = 0; i < 60; i++) {
    const h = Math.round((4 + rnd() * 5) * 10) / 10;
    som.set(J(i), h);
    db.poserMesure({ date: J(i), source: 'montre', cle: 'sommeil_h', valeur: h, unite: 'h' });
  }
  for (let i = 0; i < 60; i++) {
    db.setNote(J(i), Math.max(1, Math.min(10, Math.round(2.2 + (som.get(J(i)) - 4) * 0.85 + (rnd() - 0.5) * 2))));
  }
  // Une journée volontairement très basse, pour tomber sous le plancher.
  db.setNote(J(5), 1);

  const bas = api.routes['GET /api/mirror']({ query: { date: J(5) }, userId: db.OWNER });
  assert.equal(bas.floored, true, 'la journée de test n’est pas sous le plancher — le test ne prouve rien');
  assert.ok(bas.mesures.length > 0, 'les mesures ont été retenues par le plancher');
  assert.equal(bas.mesures.some(m => m.lien), false, 'un lien est passé sous le plancher');
  // Le chiffre lui-même, et son côté, restent : c'est un fait daté.
  assert.ok(bas.mesures.some(m => m.cle === 'sommeil_h' && m.valeur != null && m.cote));

  const haut = api.routes['GET /api/mirror']({ query: { date: J(2) }, userId: db.OWNER });
  if (!haut.floored) {
    assert.ok(haut.mesures.some(m => m.lien),
              'au-dessus du plancher, le lien devrait accompagner la mesure');
  }
});

test('la journée ouverte situe chaque mesure, avec trois états et pas deux', async () => {
  const db = await import('../server/db.js');
  const api = await import('../server/api.js');
  // Une valeur qui EST la médiane ne peut pas être « au-dessus » d'elle-même :
  // sur une série impaire c'est la journée du milieu, pas un cas de bord.
  const toutes = api.mesuresSituees(J(2), db.OWNER);
  for (const m of toutes) {
    if (m.valeur === m.mediane) assert.equal(m.cote, 'pile', `${m.cle} : valeur = médiane mais côté ${m.cote}`);
    if (m.valeur > m.mediane) assert.equal(m.cote, 'haut');
    if (m.valeur < m.mediane) assert.equal(m.cote, 'bas');
  }
});

/* ============ LE VOCABULAIRE ============ */

test('LE MODULE N’EMPLOIE AUCUN VERBE DE CAUSALITÉ', () => {
  // Un lien entre le sommeil et l'humeur ne dit pas lequel des deux mène.
  // Dormir peu peut abîmer la journée ; une journée qui s'annonce mal peut
  // aussi tenir éveillé la nuit d'avant.
  const src = readFileSync(new URL('../server/liens.js', import.meta.url), 'utf8');
  const code = src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/.*$/gm, ' ');
  for (const mot of ['cause', 'causé', 'provoque', 'entraîne', 'explique', 'à cause de']) {
    assert.equal(code.toLowerCase().includes(mot), false,
      `« ${mot} » est entré dans le code de liens.js`);
  }
});

test('la page ne l’emploie pas non plus — c’est elle qu’on lit', () => {
  const app = readFileSync(new URL('../web/app.js', import.meta.url), 'utf8');
  const debut = app.indexOf('const nomMesure =');
  const fin = app.indexOf('function thematiquesMarkup', debut);
  assert.ok(debut > 0 && fin > debut, 'le bloc des mesures de la journée est introuvable');
  const code = app.slice(debut, fin).replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/.*$/gm, ' ');
  for (const mot of ['cause', 'provoque', 'entraîne', 'explique']) {
    assert.equal(code.toLowerCase().includes(mot), false,
      `« ${mot} » est écrit dans la journée ouverte`);
  }
  // Et la formulation retenue est bien celle qui ne tranche pas.
  assert.match(code, /notées/, 'la phrase du lien a changé de forme sans que le test le sache');
});
