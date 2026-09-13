/**
 * LA MÉMOIRE A UN PLAFOND, ET CE QUI DÉBORDE SE VA CHERCHER.
 *
 * Elle faisait 125 000 signes chez quelqu'un — les deux tiers d'un prompt de
 * 66 000 jetons. Le cache ne résout pas ça : il vit au mieux une heure, et
 * quelqu'un qui revient parler toutes les une à cinq heures repart À FROID à
 * chaque fois. Un départ à froid coûte la TAILLE du prompt, plein tarif, et
 * aucun réglage de cache n'y change rien. Mesuré : 0,17 $ le message.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.BD_DB = join(mkdtempSync(join(tmpdir(), 'bd-budget-')), 'test.db');
const { db, OWNER, setSettings, addMessage } = await import('../server/db.js');
const { memoireSousBudget, recentMemory, BUDGET_MEMOIRE, PART_JOURNEES, ORDRE_MEMOIRE }
  = await import('../server/api.js');

const bloc = (n, c) => c.repeat(n);
const REEL = () => new Map([
  ['ancres',    bloc(100, 'A')],
  ['grille',    bloc(2400, 'G')],
  ['repères',   bloc(400, 'R')],
  ['motifs',    bloc(1100, 'M')],
  ['journées',  bloc(14000, 'J')],
  ['prises',    bloc(6000, 'P')],
  ['horizons',  bloc(9000, 'H')],
  ['carnet',    bloc(78000, 'C')],
]);

test('LE PLAFOND TIENT', () => {
  const r = memoireSousBudget(REEL());
  // La note de ce qui manque s'ajoute APRÈS le décompte : c'est quelques
  // centaines de signes, et elle évite bien plus cher qu'elle ne coûte.
  assert.ok(r.texte.length < BUDGET_MEMOIRE + 1000,
    `${r.texte.length} signes pour un budget de ${BUDGET_MEMOIRE}`);
});

test('CE QUI SORT, C’EST LE PLUS GROS ET LE PLUS SUBSTITUABLE', () => {
  const r = memoireSousBudget(REEL());
  assert.equal(r.hors.includes('carnet'), true, 'le carnet — 78 000 signes — est resté');
  for (const garde of ['ancres', 'grille', 'repères', 'motifs', 'journées']) {
    assert.equal(r.hors.includes(garde), false, `« ${garde} » est sorti avant le carnet`);
  }
});

test('UN GROS BLOC PRIORITAIRE NE SE FAIT PAS DOUBLER PAR DES PETITS DE LA FIN', () => {
  /*
   * LE DÉFAUT QUE CE TEST GARDE. Un remplissage glouton — « on saute celui-là
   * et on prend les suivants » — laissait passer les petits blocs de la fin
   * par-dessus un gros bloc du début : ses journées écrites sortaient, et le
   * carnet restait. C'est l'inverse exact de l'ordre déclaré, et ça ne se voit
   * pas : la mémoire a l'air pleine.
   */
  const m = new Map([['ancres', bloc(100, 'A')],
                     ['journées', bloc(BUDGET_MEMOIRE, 'J')],   // ne tient pas
                     ['carnet', bloc(200, 'C')]]);              // tiendrait, lui
  const r = memoireSousBudget(m);
  assert.equal(r.hors.includes('carnet'), true,
    'le carnet est passé devant les journées qui ne tenaient pas : la priorité est inversée');
  // Pas `includes('C')` : la note de ce qui manque en contient. On vise le
  // CONTENU du bloc, qu'elle ne peut pas produire par accident.
  assert.equal(r.texte.includes('C'.repeat(50)), false, 'le contenu du carnet est passé');
});

test('l’ordre est un ordre de VALEUR, et il est écrit', () => {
  assert.deepEqual(ORDRE_MEMOIRE, ['ancres', 'grille', 'repères', 'motifs',
                                   'journées', 'prises', 'horizons', 'carnet']);
});

test('ON DIT AU COMPAGNON CE QU’IL N’A PAS', () => {
  /*
   * Un contexte amputé en silence, c'est un compagnon qui affirme ne rien
   * savoir d'une chose qu'il pourrait aller lire — et la personne en face
   * conclut qu'il a oublié.
   */
  const r = memoireSousBudget(REEL());
  assert.match(r.texte, /CE QUI N'EST PAS ICI/);
  assert.match(r.texte, /lire_carnet/, 'l’outil qui va le chercher n’est pas nommé');
  assert.match(r.texte, /ne dis jamais\s+que tu ne sais pas/,
    'rien n’empêche le compagnon de répondre « je ne sais pas » sur ce qu’il peut lire');
});

test('CE QUI N’A PAS D’OUTIL EST DIT AUTREMENT : « ne le suppose pas »', () => {
  // Les synthèses sur la durée ne se rechargent pas. Sans cette ligne, le
  // compagnon répondrait « ça dure depuis longtemps » de mémoire —
  // c'est-à-dire en l'inventant, sur le terrain où ce produit n'invente jamais.
  const m = new Map([['ancres', bloc(100, 'A')],
                     ['horizons', bloc(BUDGET_MEMOIRE + 1, 'H')]]);
  const r = memoireSousBudget(m);
  assert.match(r.texte, /ne parle pas de distance de tête/);
  assert.match(r.texte, /reconstruis-la avec/);
});

test('rien à mettre ne rend rien, pas une note toute seule', () => {
  assert.equal(memoireSousBudget(new Map()).texte, null);
});

test('LES JOURNÉES MAIGRISSENT PAR LA FIN LA PLUS ANCIENNE, PAS AU MILIEU D’UNE PHRASE', () => {
  /*
   * C'est le bloc qui compte le plus, et celui qui grossit sans limite :
   * quelqu'un qui écrit longuement quatorze soirs de suite le fait exploser
   * tout seul. Il perd des journées ENTIÈRES — une journée tronquée se lirait
   * comme une journée qui s'arrête net, et le compagnon y répondrait.
   */
  setSettings({ memoryDays: 14, carnetMemoire: false, prisesMemoire: false }, OWNER);
  const AUJ = '2026-03-01';
  const ins = db.prepare('INSERT OR REPLACE INTO entries(user_id,date,note,text) VALUES(?,?,?,?)');
  for (let i = 1; i <= 14; i++) {
    const d = new Date(Date.parse(AUJ) - i * 864e5).toISOString().slice(0, 10);
    // Une marque par journée : la DATE seule ne prouve rien, elle figure aussi
    // dans la grille des cinq semaines, qui est un autre bloc.
    ins.run(OWNER, d, 5, `MARQUEJOUR${i} — ` + 'une phrase entière qui se termine. '.repeat(120));
  }
  const m = recentMemory(AUJ, OWNER, null);
  assert.ok(m.tailles['journées'] <= PART_JOURNEES,
    `${m.tailles['journées']} signes de journées pour une part de ${PART_JOURNEES}`);
  assert.ok(m.stable.includes('MARQUEJOUR1'), 'la journée la plus RÉCENTE est sortie');
  assert.equal(m.stable.includes('MARQUEJOUR14'), false, 'la plus ancienne est restée');
  // Et ce qui reste se termine sur une phrase finie, pas au milieu d'un mot.
  const dedans = m.stable.slice(m.stable.indexOf('MARQUEJOUR'));
  assert.match(dedans.split('\n\n---\n\n')[0].trim(), /se termine\.$/,
    'une journée a été coupée au milieu d’une phrase');
});

test('la composition rendue ne compte QUE ce qui est parti', () => {
  // Sinon l'étiquette annoncerait 125 k pour un prompt qui en porte 24 —
  // et on chercherait une baleine qui n'est plus là.
  const m = new Map([['ancres', bloc(100, 'A')], ['carnet', bloc(90000, 'C')]]);
  const r = memoireSousBudget(m);
  assert.deepEqual(r.hors, ['carnet']);
});
