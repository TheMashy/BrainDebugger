/*
 * LES NUITS DE QUELQU'UN QUI DORT LE JOUR — et celles de tout le monde.
 *
 * L'écran du 7 septembre disait « levé 00:00 (mesure) · couché 19:47 » à une
 * personne couchée à 05:26 et levée à 16:20. Deux bornes fixes en étaient la
 * cause : la nuit devait se terminer avant 16 h, et, faute de nuit, le bord
 * du fichier civil (plage.de = 00:00) passait pour un réveil.
 *
 * Ce qui est testé ici : le 7 septembre tel qu'il s'est passé, le poste laissé
 * allumé toute la nuit, le redémarrage nocturne qui ne coupe rien, la journée
 * en cours qui n'a pas encore de nuit, le dormeur de 23:30 à 07:15 qui doit
 * continuer à marcher, et le rythme de la personne qui départage un silence
 * de nuit d'une absence plus longue.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.BD_DB = join(mkdtempSync(join(tmpdir(), 'bd-nuits-')), 'test.db');

const { nuitDuJour, rythmeDe, nuits, rythmeUtilisateur, oublierRythme } = await import('../server/nuits.js');
const { poserActiviteJour } = await import('../server/db.js');
const { addDays } = await import('../server/stats.js');

const debout = (date, o = {}) => ({ date, plage: { de: '00:00', a: '23:59' }, trous: [], ...o });

/* --------------------------- le 7 septembre --------------------------- */

test('le 7 septembre : debout à minuit, couché 05:26, levé 16:20', () => {
  const n = nuitDuJour({ date: '2026-09-07', plage: { de: '00:00', a: '22:10' }, trous: [{ de: '05:26', a: '16:20', minutes: 654 }] },
                       debout('2026-09-06'));
  assert.ok(n, 'aucune nuit trouvée — la borne des 16 h est-elle revenue ?');
  assert.equal(n.coucher, '05:26'); assert.equal(n.lever, '16:20'); assert.equal(n.sommeil_h, 10.9);
  assert.equal(n.source, 'activite'); assert.equal(n.souci, null);
});

test('le poste laissé allumé toute la nuit : le trou est la nuit, même s’il se ferme à 16:16', () => {
  const n = nuitDuJour(debout('2026-09-07', { plage: { de: '00:00', a: '19:47' }, trous: [{ de: '05:27', a: '16:16', minutes: 649 }] }),
                       debout('2026-09-06'));
  assert.equal(n.coucher, '05:27'); assert.equal(n.lever, '16:16'); assert.equal(n.sommeil_h, 10.8);
});

test('éteint à 05:26, rallumé à 15:31 : le trou de reprise fait la nuit', () => {
  const n = nuitDuJour(debout('2026-09-07', { plage: { de: '00:00', a: '19:47' }, trous: [{ de: '05:20', a: '15:31', minutes: 611 }] }),
                       debout('2026-09-06', { plage: { de: '16:10', a: '23:59' } }));
  assert.equal(n.coucher, '05:20'); assert.equal(n.lever, '15:31'); assert.equal(n.sommeil_h, 10.2);
});

test('un lever à 16:15 vaut un lever à 08:00 : seule la durée borne', () => {
  // 05:26 → 22:10 fait 16 h 44 : ce n'est pas une nuit — par la durée, pas par l'heure.
  const n = nuitDuJour(debout('2026-09-07', { trous: [{ de: '05:26', a: '22:10', minutes: 1004 }] }), debout('2026-09-06'));
  assert.equal(n, null);
});

/* ------------------------ le redémarrage nocturne ------------------------ */

test('Windows redémarre seul à 00:30 : ce n’est ni un lever ni une coupure', () => {
  // Un vieux Machi Tool a apparié extinction 00:30 / démarrage 00:31 ; le clavier dit 23:30 → 08:00.
  const n = nuitDuJour({ date: '2026-09-07', plage: { de: '08:00', a: '12:00' }, trous: [], poste: { coucher: '00:30', reveil: '00:31', sommeil_h: 0 } },
                       { date: '2026-09-06', plage: { de: '08:00', a: '23:30' }, trous: [] });
  assert.equal(n.coucher, '23:30'); assert.equal(n.lever, '08:00'); assert.equal(n.sommeil_h, 8.5);
});

test('une extinction au milieu de la nuit (mise à jour à 09:00) ne coupe pas le silence', () => {
  const n = nuitDuJour(debout('2026-09-07', { trous: [{ de: '05:26', a: '16:15', minutes: 649 }],
                                              poste: { coucher: '09:00', reveil: '16:15', sommeil_h: 7.3 } }),
                       debout('2026-09-06'));
  assert.equal(n.coucher, '05:26'); assert.equal(n.lever, '16:15'); assert.equal(n.sommeil_h, 10.8);
  assert.match(n.souci, /le poste dit 7,3 h, le clavier 10,8 h/);
});

/* --------------------------- la journée en cours --------------------------- */

test('une journée en cours, avant le coucher, n’a pas de nuit — et pas de lever inventé', () => {
  const n = nuitDuJour({ date: '2026-09-08', plage: { de: '00:00', a: '04:18' }, trous: [] },
                       debout('2026-09-07', { plage: { de: '16:20', a: '23:59' } }));
  assert.equal(n, null, '00:00 est le bord du fichier civil, pas un réveil');
});

test('un poste sans coucher (le vieux repli {reveil: 00:00}) n’est pas une nuit', () => {
  const n = nuitDuJour({ date: '2026-09-07', plage: { de: '00:00', a: '19:47' }, trous: [], poste: { reveil: '00:00', source: 'clavier' } },
                       debout('2026-09-06'));
  assert.equal(n, null);
  // Sans veille non plus : le poste seul ne sert que complet.
  assert.equal(nuitDuJour({ date: '2026-09-07', poste: { reveil: '00:00', source: 'clavier' } }, null), null);
});

/* ---------------------------- le dormeur du soir ---------------------------- */

test('le dormeur de 23:30 à 07:15 continue à marcher', () => {
  const n = nuitDuJour({ date: '2026-09-07', plage: { de: '07:15', a: '22:00' }, trous: [] },
                       { date: '2026-09-06', plage: { de: '07:20', a: '23:30' }, trous: [] });
  assert.equal(n.coucher, '23:30'); assert.equal(n.lever, '07:15'); assert.equal(n.sommeil_h, 7.8); assert.equal(n.souci, null);
});

test('un coucher l’après-midi, après une nuit blanche, fait une nuit qui se termine à 01:00', () => {
  // Dernière touche à 15:00 la veille, première à 01:00 : 10 h, dans la fenêtre des 36 h.
  const n = nuitDuJour({ date: '2026-09-07', plage: { de: '01:00', a: '20:00' }, trous: [] },
                       debout('2026-09-06', { plage: { de: '00:00', a: '15:00' } }));
  assert.equal(n.coucher, '15:00'); assert.equal(n.lever, '01:00'); assert.equal(n.sommeil_h, 10);
});

/* ---------------------------- le rythme départage ---------------------------- */

const RYTHME = { coucher: 5 * 60 + 26, lever: 16 * 60 + 15 };

test('avec son rythme, la nuit courte l’emporte sur l’absence plus longue — et ça se dit', () => {
  const d = debout('2026-09-07', { trous: [{ de: '05:30', a: '10:00', minutes: 270 }, { de: '12:00', a: '21:00', minutes: 540 }] });
  const avec = nuitDuJour(d, debout('2026-09-06'), { rythme: RYTHME });
  assert.equal(avec.coucher, '05:30'); assert.equal(avec.lever, '10:00'); assert.equal(avec.sommeil_h, 4.5);
  assert.match(avec.souci, /un silence plus long, de 12:00 à 21:00 \(9 h\), pris pour une absence/);
  // Sans rythme connu, c'est le PREMIER silence recevable : la même réponse
  // que le rythme, obtenue autrement — la nuit qui ouvre le jour est son
  // premier sommeil, pas son plus long silence. Et comme rien ne le prouve,
  // elle sort marquée `incertain` : elle s'affiche, mais ne fait pas rythme.
  const sans = nuitDuJour(d, debout('2026-09-06'));
  assert.equal(sans.coucher, '05:30'); assert.equal(sans.lever, '10:00');
  assert.equal(sans.incertain, true);
  assert.match(sans.souci, /un silence plus long, de 12:00 à 21:00 \(9 h\), pris pour une absence/);
});

test('une sieste ne concourt pas : moins de la moitié de la nuit', () => {
  const d = debout('2026-09-07', { trous: [{ de: '05:30', a: '16:00', minutes: 630 }, { de: '19:00', a: '21:30', minutes: 150 }] });
  for (const opts of [{ rythme: RYTHME }, {}]) {
    const n = nuitDuJour(d, debout('2026-09-06'), opts);
    assert.equal(n.coucher, '05:30'); assert.equal(n.lever, '16:00'); assert.equal(n.souci, null);
  }
});

test('un seul silence recevable reste la nuit, même loin du rythme', () => {
  const n = nuitDuJour(debout('2026-09-07', { trous: [{ de: '12:00', a: '21:00', minutes: 540 }] }), debout('2026-09-06'), { rythme: RYTHME });
  assert.equal(n.coucher, '12:00'); assert.equal(n.lever, '21:00');
});

test('le rythme ne se lit que sur des nuits complètes', () => {
  const liste = [];
  for (let i = 0; i < 10; i++) liste.push({ coucher: null, lever: '00:00', sommeil_h: null });
  assert.deepEqual(rythmeDe(liste), { coucher: null, lever: null }, 'dix réveils sans coucher ne font pas un rythme');
  for (let i = 0; i < 7; i++) liste.push({ coucher: `05:${20 + i}`, lever: `16:${10 + i}`, sommeil_h: 10.8 });
  const ry = rythmeDe(liste);
  assert.equal(ry.coucher, 5 * 60 + 23); assert.equal(ry.lever, 16 * 60 + 13);
});

/* ------------------------- nuits() en deux passes, en base ------------------------- */

const AUJ = new Date().toISOString().slice(0, 10);

/** `n` jours de nuits 05:2x → 16:1x, finissant la veille de `dernier`, pour `userId`. */
function semerNuits(userId, n, dernier) {
  const premier = addDays(dernier, -n);
  poserActiviteJour(userId, addDays(premier, -1), debout(addDays(premier, -1)));
  for (let i = 0; i < n; i++) {
    const d = addDays(premier, i);
    poserActiviteJour(userId, d, debout(d, { trous: [{ de: `05:2${i % 5}`, a: `16:1${i % 5}`, minutes: 650 }] }));
  }
}

test('nuits() : dix nuits en base donnent un rythme, et la seconde passe s’en sert', () => {
  const U = 'deux-passes';
  semerNuits(U, 10, AUJ);
  // Le jour d'après : une nuit courte et une absence plus longue.
  poserActiviteJour(U, AUJ, debout(AUJ, { trous: [{ de: '05:30', a: '10:00', minutes: 270 }, { de: '12:00', a: '21:00', minutes: 540 }] }));
  const out = nuits(U, { jours: 30 });
  assert.equal(out.length, 11);
  const ry = rythmeDe(out);
  assert.ok(Math.abs(ry.coucher - (5 * 60 + 22)) <= 3, `coucher médian ${ry.coucher}`);
  assert.ok(Math.abs(ry.lever - (16 * 60 + 12)) <= 3, `lever médian ${ry.lever}`);
  const dernier = out.at(-1);
  assert.equal(dernier.date, AUJ);
  assert.equal(dernier.lever, '10:00', 'la seconde passe choisit la nuit qui colle au rythme');
  assert.match(dernier.souci, /pris pour une absence/);
});

test('nuits() : six nuits ne font pas un rythme, le premier silence tranche', () => {
  const U = 'six-nuits';
  // Cinq nuits semées, plus celle du jour testé : six nuits complètes en tout.
  semerNuits(U, 5, AUJ);
  poserActiviteJour(U, AUJ, debout(AUJ, { trous: [{ de: '05:30', a: '10:00', minutes: 270 }, { de: '12:00', a: '21:00', minutes: 540 }] }));
  const out = nuits(U, { jours: 30 });
  assert.deepEqual(rythmeDe(out), { coucher: null, lever: null });
  assert.equal(out.at(-1).lever, '10:00');
  assert.equal(out.at(-1).incertain, true, 'devinée faute de rythme, elle ne fera pas rythme');
  assert.ok(out.every(n => !/loin de ton/.test(n.souci ?? '')), 'aucun écart au rythme sous sept nuits');
});

test('rythmeUtilisateur est mémorisé, et oublierRythme force la relecture', () => {
  const U = 'memo-rythme';
  assert.deepEqual(rythmeUtilisateur(U), { coucher: null, lever: null });
  semerNuits(U, 10, AUJ);
  assert.deepEqual(rythmeUtilisateur(U), { coucher: null, lever: null }, 'dans les cinq minutes, on ne relit pas la base');
  oublierRythme(U);
  assert.notEqual(rythmeUtilisateur(U).lever, null, 'une fois oublié, le rythme se relit');
});
