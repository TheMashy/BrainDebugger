/**
 * CE QU'UNE AUTRE APPLICATION ENVOIE.
 *
 * Deux choses se testent ici, et elles ne se ressemblent pas :
 *
 *   — la TOLÉRANCE de l'analyse. Le produit accepte les formes de JSON qui
 *     existent vraiment, parce que personne n'écrit un adaptateur pour tester
 *     si ça marche. Chaque forme acceptée est un test, sinon elle se perd à la
 *     première refonte.
 *   — l'INVARIANT qui protège le journal : une mesure n'est pas une journée.
 *     Elle ne compte nulle part comme une journée écrite.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.BD_DB = join(mkdtempSync(join(tmpdir(), 'bd-mes-')), 'test.db');

const {
  OWNER, poserMesure, mesuresDuJour, inventaireMesures, derniereMesure,
  oublierMesure, noterEnvoi, journalQS, viderJournalQS, JOURNAL_QS,
  allEntries, setNote
} = await import('../server/db.js');
const M = await import('../server/mesures.js');

const AUJ = new Date().toISOString().slice(0, 10);
const cles = r => r.gardees.map(g => g.cle);
const par = (r, cle) => r.gardees.find(g => g.cle === cle);

/* ============ LES FORMES QU'ON ACCEPTE ============ */

test('un objet à plat est une liste de mesures du jour', () => {
  const r = M.analyser({ pas: 8410, sommeil_h: 6.2 });
  assert.deepEqual(cles(r), ['pas', 'sommeil_h']);
  assert.equal(par(r, 'pas').date, AUJ, 'sans date, une mesure est du jour');
  assert.equal(r.laissees.length, 0);
});

test('une enveloppe : source, date et le bloc des mesures', () => {
  const r = M.analyser({ source: 'montre', date: '2026-08-30', mesures: { pas: 100 } });
  assert.equal(r.gardees.length, 1);
  assert.equal(par(r, 'pas').source, 'montre');
  assert.equal(par(r, 'pas').date, '2026-08-30');
});

test('les quatre noms du bloc de mesures marchent tous', () => {
  for (const k of ['mesures', 'measures', 'data', 'metrics']) {
    const r = M.analyser({ [k]: { pas: 1 } });
    assert.equal(r.gardees.length, 1, `${k} n'a pas été reconnu comme enveloppe`);
  }
});

test('un lot : un tableau d’envois, chacun avec sa date', () => {
  const r = M.analyser([{ pas: 1, date: '2026-08-01' }, { pas: 2, date: '2026-08-02' }]);
  assert.deepEqual(r.gardees.map(g => [g.date, g.valeur]), [['2026-08-01', 1], ['2026-08-02', 2]]);
});

test('un niveau d’imbrication est aplati, deux sont refusés avec la raison', () => {
  const r = M.analyser({ sommeil: { duree_h: 6.2, reveils: 3 }, trop: { a: { b: 1 } } });
  assert.deepEqual(cles(r), ['sommeil_duree_h', 'sommeil_reveils']);
  assert.match(r.laissees[0].pourquoi, /imbriqué trop profond/);
});

/* ============ LES VALEURS ============ */

test('une virgule décimale est un nombre — sinon la langue du téléphone décide du type', () => {
  assert.equal(M.lireValeur('6,2').valeur, 6.2);
  assert.equal(M.lireValeur('8410').valeur, 8410);
});

test('un booléen devient 1 ou 0 : « traitement pris » est une série qui se trace', () => {
  assert.equal(M.lireValeur(true).valeur, 1);
  assert.equal(M.lireValeur(false).valeur, 0);
});

test('{valeur, unite} garde son unité', () => {
  const v = M.lireValeur({ valeur: 72, unite: 'kg' });
  assert.equal(v.valeur, 72);
  assert.equal(v.unite, 'kg');
});

test('ce qui n’est pas un nombre reste du texte, borné', () => {
  const v = M.lireValeur('sommeil profond');
  assert.equal(v.valeur, null);
  assert.equal(v.texte, 'sommeil profond');
  assert.equal(M.lireValeur('x'.repeat(500)).texte.length, M.MAX_TEXTE);
});

test('null et la chaîne vide ne sont pas des valeurs', () => {
  // Une balance qui envoie poids: null les jours sans pesée remplirait la série
  // de trous écrits, indistinguables d'un zéro à la lecture.
  assert.equal(M.lireValeur(null), null);
  assert.equal(M.lireValeur('  '), null);
  assert.equal(M.lireValeur({}), null);
});

test('« 0 » est une valeur, et pas une absence', () => {
  assert.equal(M.lireValeur(0).valeur, 0);
  assert.equal(M.lireValeur('0').valeur, 0);
});

/* ============ LES NOMS DE SÉRIES ============ */

test('les noms sont normalisés : trois écritures, une seule série', () => {
  const n = M.normaliserCle;
  assert.equal(n('Sommeil (h)'), 'sommeil_h');
  assert.equal(n('SOMMEIL H'), 'sommeil_h');
  assert.equal(n('sommeil_h'), 'sommeil_h');
  assert.equal(n('Café pris'), 'cafe_pris', 'les accents doivent tomber');
});

test('un nom vide ou fait de ponctuation ne crée pas de série', () => {
  assert.equal(M.normaliserCle('***'), null);
  assert.equal(M.normaliserCle(''), null);
  assert.equal(M.analyser({ '***': 3 }).gardees.length, 0);
});

test('les clés d’enveloppe ne deviennent jamais des mesures', () => {
  const r = M.analyser({ pas: 1, date: '2026-08-30', source: 'montre', ts: 123 });
  assert.deepEqual(cles(r), ['pas']);
});

/* ============ LES DATES ============ */

test('un horodatage en secondes et un en millisecondes donnent le même jour', () => {
  const ms = Date.UTC(2026, 6, 15, 12, 0, 0);
  const a = M.analyser({ ts: ms, pas: 1, source: 'a' }).gardees[0];
  const b = M.analyser({ ts: Math.floor(ms / 1000), pas: 1, source: 'a' }).gardees[0];
  assert.equal(a.date, b.date);
});

test('une date hors du plausible est refusée, pas rangée en silence', () => {
  // Une seconde prise pour une milliseconde tombe en 1970 : rangée sans bruit,
  // elle n'apparaît qu'au moment où un graphe s'aplatit.
  const r = M.analyser({ ts: 0, pas: 1 });
  assert.equal(r.gardees.length, 0);
  assert.match(r.laissees[0].pourquoi, /hors du plausible/);
});

test('une date illisible dit ce qu’elle a lu', () => {
  const r = M.analyser({ date: 'hier soir', pas: 1 });
  assert.match(r.laissees[0].pourquoi, /date illisible/);
  assert.match(r.laissees[0].pourquoi, /hier soir/);
});

test('demain passe : une montre réglée sur un autre fuseau est légitime', () => {
  const demain = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
  assert.equal(M.analyser({ date: demain, pas: 1 }).gardees.length, 1);
});

/* ============ LES BORNES ============ */

test('un envoi géant est coupé, et le dit', () => {
  const gros = Object.fromEntries(Array.from({ length: M.MAX_MESURES + 20 }, (_, i) => [`m${i}`, i]));
  const r = M.analyser(gros);
  assert.equal(r.gardees.length, M.MAX_MESURES);
  assert.match(r.laissees[0].pourquoi, new RegExp(`${M.MAX_MESURES} mesures`));
});

test('un nom à rallonge est tronqué, pas refusé', () => {
  assert.equal(M.normaliserCle('a'.repeat(200)).length, M.MAX_CLE);
});

/* ============ CE QUI EST ÉCRIT EN BASE ============ */

test('le même jour renvoyé deux fois remplace, il ne s’additionne pas', () => {
  // C'est LA raison d'être de l'index unique : une application de suivi
  // resynchronise la semaine entière à chaque réveil.
  poserMesure({ date: '2026-05-01', source: 'montre', cle: 'pas', valeur: 8000 });
  poserMesure({ date: '2026-05-01', source: 'montre', cle: 'pas', valeur: 8410 });
  const j = mesuresDuJour('2026-05-01').filter(m => m.cle === 'pas');
  assert.equal(j.length, 1, 'deux lignes pour le même jour et la même série');
  assert.equal(j[0].valeur, 8410, 'c’est le dernier envoi qui fait foi');
});

test('deux sources gardent chacune leur série du même nom', () => {
  poserMesure({ date: '2026-05-01', source: 'telephone', cle: 'pas', valeur: 7200 });
  const j = mesuresDuJour('2026-05-01').filter(m => m.cle === 'pas');
  assert.equal(j.length, 2, 'la montre et le téléphone ne comptent pas la même chose');
});

test('UNE MESURE N’EST PAS UNE JOURNÉE ÉCRITE', () => {
  // L'invariant du produit : le dénominateur de tout ce qui s'affiche est le
  // nombre de journées vécues et notées à la main. Une montre n'en crée pas.
  const avant = allEntries(OWNER).length;
  poserMesure({ date: '2031-01-01', source: 'montre', cle: 'pas', valeur: 1 });
  assert.equal(allEntries(OWNER).length, avant,
               'une mesure a créé une entrée de journal');
});

test('l’inventaire dit l’étendue, le compte et la dernière valeur', () => {
  const inv = inventaireMesures().find(x => x.source === 'montre' && x.cle === 'pas');
  assert.ok(inv.n >= 2);
  assert.equal(inv.haut, 8410);
  assert.equal(derniereMesure('montre', 'pas').date, '2031-01-01');
});

test('oublier une série la retire entièrement — une intégration ratée s’annule', () => {
  poserMesure({ date: '2026-06-01', source: 'test', cle: 'faux', valeur: 1 });
  poserMesure({ date: '2026-06-02', source: 'test', cle: 'faux', valeur: 2 });
  assert.equal(oublierMesure('test', 'faux'), 2);
  assert.equal(inventaireMesures().some(x => x.cle === 'faux'), false);
});

/* ============ LE JOURNAL ============ */

test('le journal garde ce qui est passé ET ce qui a été refusé', () => {
  viderJournalQS();
  noterEnvoi({ source: 'montre', statut: 200, recues: 3, gardees: 3 });
  noterEnvoi({ source: null, statut: 400, refus: 'JSON invalide' });
  const j = journalQS();
  assert.equal(j.length, 2);
  assert.equal(j[0].statut, 400, 'le plus récent en premier');
  assert.match(j[0].refus, /JSON invalide/);
});

test('le journal est taillé à l’écriture, pas à la lecture', () => {
  // Une application qui envoie toutes les cinq minutes remplirait la table
  // entre deux visites — et c'est justement celle qu'on n'ouvre jamais.
  viderJournalQS();
  for (let i = 0; i < JOURNAL_QS + 25; i++) noterEnvoi({ statut: 200, recues: 1, gardees: 1 });
  assert.equal(journalQS().length, JOURNAL_QS);
});

test('l’aperçu porte les noms des séries, jamais les valeurs', () => {
  const a = M.apercuDe(['pas', 'sommeil_h', 'pas']);
  assert.equal(a, 'pas, sommeil_h');
  assert.match(M.apercuDe(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h']), /\+2$/);
});
