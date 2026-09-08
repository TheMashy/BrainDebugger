/*
 * CE QU'ON CONSULTE DEVIENT UNE VARIABLE.
 *
 * Machi Tool range chaque instant passé dans un navigateur par SUJET. Tant que
 * ce chiffre ne vivait que dans une barre de la journée, il ne se comparait à
 * rien : on voyait « 40 min de guerre » et on passait à la suite. Versé dans la
 * table, il passe dans le même moulin que le sommeil et le coucher, et la
 * question devient : les jours où j'en regarde beaucoup, ma note fait quoi ?
 *
 * Ce qui se teste ici est surtout ce qui NE doit pas arriver : un faux zéro les
 * jours où rien ne mesurait, et un constat tiré de deux journées.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.BD_DB = join(mkdtempSync(join(tmpdir(), 'bd-sujets-')), 'test.db');

const { db, upsertUser, poserActiviteJour } = await import('../server/db.js');
const { addDays } = await import('../server/stats.js');
const { tableDe, fonctionnements, SEUILS } = await import('../server/fonctionnements.js');

const FIN = new Date().toISOString().slice(0, 10);
const ins = db.prepare('INSERT INTO entries(user_id, date, text, note) VALUES(?,?,?,?)');
const jour = (U, d, note, themes, avecDigest = true) => {
  ins.run(U, d, 'journée écrite, assez de texte pour nourrir la table', note);
  if (avecDigest) poserActiviteJour(U, d, {
    date: d, plage: { de: '09:00', a: '23:00' }, trous: [],
    temps_par_contexte_s: { 'web:youtube': 7200 },
    temps_par_theme_web_s: Object.fromEntries(Object.entries(themes).map(([k, m]) => [k, m * 60])),
  });
};

test('un sujet regardé devient une variable, et le lien se trouve', () => {
  const U = 'lien-guerre';
  upsertUser({ id: U, username: U });
  // Un jour sur trois : beaucoup de guerre. Le lendemain : note basse.
  for (let k = 0; k < 90; k++) {
    const d = addDays(FIN, -(89 - k));
    jour(U, d, (k > 0 && (k - 1) % 3 === 0) ? 3 + (k % 2) : 7 + (k % 3),
         { guerre: k % 3 === 0 ? 70 + (k % 5) * 4 : 3 + (k % 4) });
  }
  const T = tableDe(U);
  assert.ok(T.variables.includes('sujet_guerre'), `variables : ${T.variables}`);
  const liens = fonctionnements(U).items.filter(i => i.type === 'lien');
  const g = liens.find(i => /guerre/.test(i.phrase));
  assert.ok(g, `aucun lien trouvé sur un signal planté : ${JSON.stringify(liens.map(l => l.phrase))}`);
  // La phrase se lit en français : ni le nom de la colonne, ni « peu de la guerre ».
  assert.match(g.phrase, /peu de guerre|beaucoup de guerre/);
  assert.doesNotMatch(g.phrase, /sujet_|sujet guerre|de la guerre \(/);
  // Et en minutes, parce que c'est du temps de consultation.
  assert.match(g.phrase, /min|\d+ h/);
});

test('ZÉRO N’EST PAS « ON NE SAIT PAS » : un jour sans digest reste vide', () => {
  /*
   * Le piège qui aurait rendu tous les liens faux. Une journée sans digest ne
   * sait rien de ce qui a été regardé. La compter zéro minute remplirait la
   * série de faux zéros les jours où Machi Tool était éteint — et comme ces
   * jours-là sont rarement au hasard (ordinateur fermé, week-end, vacances), le
   * lien calculé dessus dirait précisément le contraire de la vérité.
   */
  const U = 'faux-zeros';
  upsertUser({ id: U, username: U });
  for (let k = 0; k < 40; k++) {
    const d = addDays(FIN, -(39 - k));
    jour(U, d, 6, { guerre: 30 }, k % 2 === 0);   // un jour sur deux sans digest
  }
  const T = tableDe(U);
  const avecDigest = T.jours.filter(j => j.sujet_guerre != null);
  const sans = T.jours.filter(j => j.date >= T.de && j.sujet_guerre == null && j.note != null);
  assert.equal(avecDigest.length, 20, 'seuls les jours mesurés portent une valeur');
  assert.equal(sans.length, 20, 'les jours sans digest doivent rester VIDES, pas à zéro');
  assert.ok(avecDigest.every(j => j.sujet_guerre === 30));
});

test('mais un jour mesuré SANS ce sujet vaut bien zéro : c’est une mesure', () => {
  const U = 'vrais-zeros';
  upsertUser({ id: U, username: U });
  for (let k = 0; k < 40; k++) {
    const d = addDays(FIN, -(39 - k));
    jour(U, d, 6, k % 2 === 0 ? { guerre: 30 } : { musique: 20 });
  }
  const T = tableDe(U);
  const zeros = T.jours.filter(j => j.sujet_guerre === 0);
  assert.equal(zeros.length, 20, 'un jour mesuré où la guerre n’apparaît pas vaut zéro minute');
});

test('un sujet vu deux fois en soixante jours ne fait pas un constat', () => {
  /*
   * Sans le second seuil, deux journées suffisaient à sortir « les jours où tu
   * regardes de la politique, tu dors moins » — une anecdote habillée en
   * constat, et sur ce terrain une anecdote habillée en constat est ce qui
   * coûte le plus cher.
   */
  const U = 'trop-rare';
  upsertUser({ id: U, username: U });
  for (let k = 0; k < 60; k++) {
    const d = addDays(FIN, -(59 - k));
    jour(U, d, 6, k < 2 ? { politique: 90 } : { musique: 20 });
  }
  const T = tableDe(U);
  assert.ok(!T.variables.includes('sujet_politique'),
            'deux journées ne font pas une série — le sujet ne doit pas devenir une variable');
  assert.ok(T.variables.includes('sujet_musique'), 'celui qui est là 58 jours, si');
  assert.ok(SEUILS.lien.min_groupe >= 10);
});
