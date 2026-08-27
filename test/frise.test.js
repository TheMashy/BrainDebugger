import test from 'node:test';
import assert from 'node:assert/strict';
import { voies, etendue, situer, estPeriode, finEffective, JOUR_MS } from '../web/frise.js';

/* ------------------------------ les voies ------------------------------ */

const P = (date, fin) => ({ date, fin });

test('deux périodes disjointes tiennent sur une seule voie', () => {
  const v = voies([P('2020-01-01', '2020-06-01'), P('2021-01-01', '2021-06-01')]);
  assert.deepEqual(v.map(x => x.voie), [0, 0]);
});

test('deux périodes qui se chevauchent prennent deux voies', () => {
  const v = voies([P('2020-01-01', '2021-01-01'), P('2020-06-01', '2021-06-01')]);
  assert.notEqual(v[0].voie, v[1].voie);
});

test('le nombre de voies égale la simultanéité maximale', () => {
  // Quatre périodes couvrent toutes le 1er juin 2022 : il faut quatre voies,
  // et pas une de plus.
  const p = [
    P('2019-03-01', '2023-06-30'),
    P('2021-02-15', '2024-09-30'),
    P('2020-05-10', '2022-11-20'),
    P('2022-03-18', '2026-03-19'),
    P('2014-09-01', '2019-06-30'),     // avant tout le monde : reprend la voie 0
    P('2023-09-09', '2025-04-01')
  ];
  const v = voies(p);
  assert.equal(new Set(v.map(x => x.voie)).size, 4);
});

test('une période finie libère sa voie pour la suivante', () => {
  const v = voies([P('2020-01-01', '2020-12-31'), P('2021-01-01', '2021-12-31'), P('2022-01-01', '2022-12-31')]);
  assert.deepEqual(v.map(x => x.voie), [0, 0, 0]);
});

test('la marge empêche deux périodes bout à bout de se coller', () => {
  const collees = [P('2020-01-01', '2020-06-01'), P('2020-06-02', '2020-12-01')];
  assert.deepEqual(voies(collees).map(x => x.voie), [0, 0]);
  // avec 30 jours de marge, elles se séparent
  assert.notEqual(voies(collees, 30)[0].voie, voies(collees, 30)[1].voie);
});

test('à début égal, la plus longue passe au-dessus', () => {
  // Les périodes de fond doivent se lire en premier : sans ce tri, l'ordre
  // dépend de l'ordre d'insertion en base, c'est-à-dire de rien.
  const v = voies([P('2020-01-01', '2020-03-01'), P('2020-01-01', '2024-01-01')]);
  assert.ok(v[1].voie < v[0].voie, 'la longue devrait être plus haut');
});

test('un repère ponctuel (fin nulle) ne casse rien', () => {
  const v = voies([{ date: '2020-01-01', fin: null }, P('2019-01-01', '2021-01-01')]);
  assert.equal(v.length, 2);
  assert.notEqual(v[0].voie, v[1].voie);
});

test('aucune période : aucune voie', () => {
  assert.deepEqual(voies([]), []);
});

/* ----------------------------- l'étendue ------------------------------ */

test("l'étendue remonte au plus ancien des trois repères possibles", () => {
  const e = etendue({
    naissance: '1996-04-12',
    events: [{ date: '2011-11-03' }, { date: '2014-09-01', fin: '2019-06-30' }],
    premierJour: '2022-01-01', dernierJour: '2026-08-27', aujourdhui: '2026-08-27'
  });
  assert.equal(e.debut, '1996-04-12');
  assert.equal(e.fin, '2026-08-27');
  assert.deepEqual(e.journal, { debut: '2022-01-01', fin: '2026-08-27' });
});

test('sans naissance ni repère ancien, la frise se limite au journal', () => {
  // On n'invente pas une origine : une frise qui commence en 1990 pour
  // quelqu'un qui n'a rien renseigné avant 2022 montre trente ans de vide.
  const e = etendue({ naissance: null, events: [], premierJour: '2022-01-01',
                      dernierJour: '2026-08-27', aujourdhui: '2026-08-27' });
  assert.equal(e.debut, '2022-01-01');
});

test('une période qui déborde dans le futur étire la fin', () => {
  const e = etendue({ naissance: '1996-04-12', events: [{ date: '2026-01-01', fin: '2027-06-01' }],
                      premierJour: '2022-01-01', dernierJour: '2026-08-27', aujourdhui: '2026-08-27' });
  assert.equal(e.fin, '2027-06-01');
});

test("l'étendue compte les jours entre ses bornes", () => {
  const e = etendue({ naissance: '2020-01-01', events: [], premierJour: '2020-01-01',
                      dernierJour: '2020-01-31', aujourdhui: '2020-01-31' });
  assert.equal(e.jours, 30);
});

/* ------------------------------ situer -------------------------------- */

test('situer place une date entre 0 et 1, linéairement', () => {
  const et = { debut: '2020-01-01', fin: '2020-01-11' };
  assert.equal(situer('2020-01-01', et), 0);
  assert.equal(situer('2020-01-11', et), 1);
  assert.equal(situer('2020-01-06', et), 0.5);
});

test("l'échelle est linéaire : dix ans font dix fois un an", () => {
  // C'est la propriété qui rend une frise lisible. La perdre reviendrait à
  // faire mentir toutes les durées, ce qui est justement ce qu'on lui demande.
  const et = { debut: '2000-01-01', fin: '2020-01-01' };
  const unAn = situer('2001-01-01', et);
  const dixAns = situer('2010-01-01', et);
  assert.ok(Math.abs(dixAns / unAn - 10) < 0.02, `${dixAns / unAn} devrait valoir 10`);
});

test('une date hors bornes est ramenée sur la frise, pas au-delà', () => {
  const et = { debut: '2020-01-01', fin: '2021-01-01' };
  assert.equal(situer('2019-01-01', et), 0);
  assert.equal(situer('2030-01-01', et), 1);
});

test('JOUR_MS vaut bien une journée', () => {
  assert.equal(JOUR_MS, 24 * 60 * 60 * 1000);
});

/* -------------------- points, périodes, rétro-compat -------------------- */

test('un repère sans fin est un instant, avec fin une période', () => {
  assert.equal(estPeriode({ date: '2020-01-01', fin: null }), false);
  assert.equal(estPeriode({ date: '2020-01-01', fin: '2020-06-01' }), true);
});

test('une période « en cours » n’a pas de fin en base mais en a une à l’écran', () => {
  // Une sentinelle dans la colonne date serait pire que la colonne séparée :
  // en ASCII '*' vaut 0x2A et '0' vaut 0x30, l'étoile passerait donc devant
  // toutes les dates dans un tri, et l'étendue partirait de « * ».
  const e = { date: '2024-01-01', fin: null, ouvert: 1 };
  assert.equal(estPeriode(e), true);
  assert.equal(finEffective(e, '2026-08-27'), '2026-08-27');
  assert.equal(finEffective({ date: '2020-01-01', fin: '2021-01-01' }, '2026-08-27'), '2021-01-01');
});

test('une borne malformée ne peut pas produire NaN', () => {
  // Un champ date accepte une année à quatre chiffres : « 0202-04-12 » donnait
  // un domaine de six cent mille jours où le journal faisait deux pixels, et
  // « lol » une frise entièrement blanche, sans erreur nulle part.
  for (const mauvaise of ['0202-04-12', 'lol', '', '12/04/1996', '1899-12-31']) {
    const e = etendue({ naissance: mauvaise, events: [], premierJour: '2022-01-01',
                        dernierJour: '2026-08-27', aujourdhui: '2026-08-27' });
    assert.ok(!Number.isNaN(e.jours), `« ${mauvaise} » produit NaN`);
    assert.equal(e.debut, '2022-01-01', `« ${mauvaise} » ne doit pas devenir une borne`);
  }
});

test('une date de repère malformée est ignorée comme borne', () => {
  const e = etendue({ naissance: '1996-04-12', events: [{ date: 'oups', fin: null }],
                      premierJour: '2022-01-01', dernierJour: '2026-08-27', aujourdhui: '2026-08-27' });
  assert.equal(e.debut, '1996-04-12');
  assert.ok(!Number.isNaN(e.jours));
});
