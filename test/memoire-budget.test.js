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
const { memoireSousBudget, recentMemory, BUDGET_MEMOIRE, ORDRE_MEMOIRE, FIL_TRANSMIS }
  = await import('../server/api.js');

const bloc = (n, c) => c.repeat(n);
/*
 * LES POIDS SONT MESURÉS, PAS INVENTÉS. Ils viennent de l'export réel de
 * quelqu'un, chargé dans une base de test : quatorze journées écrites pèsent
 * 95 824 signes, le carnet 78 000. Le total dépasse le plafond de moitié —
 * c'est le cas qui se produit vraiment, pas un cas construit pour déborder.
 *
 * Si un jour ces chiffres cessent de déborder le plafond, les tests qui
 * suivent ne prouveront plus rien EN SILENCE : d'où le garde ci-dessous.
 */
const REEL = () => new Map([
  ['ancres',    bloc(100, 'A')],
  ['grille',    bloc(2400, 'G')],
  ['repères',   bloc(400, 'R')],
  ['motifs',    bloc(1100, 'M')],
  ['journées',  bloc(95824, 'J')],
  ['prises',    bloc(6000, 'P')],
  ['horizons',  bloc(9000, 'H')],
  ['carnet',    bloc(78000, 'C')],
]);

test('LE DÉCOR DE CES TESTS DÉBORDE VRAIMENT LE PLAFOND', () => {
  // Sans ça, tout ce qui suit passerait au vert en ne testant rien : un
  // budget assez large pour tout prendre ne fait jamais sortir personne.
  const total = [...REEL().values()].reduce((n, t) => n + t.length, 0);
  assert.ok(total > BUDGET_MEMOIRE,
    `${total} signes sous un plafond de ${BUDGET_MEMOIRE} : plus rien ne déborde, `
    + `les tests de priorité ne discriminent plus`);
});

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
                                   'journées', 'carte', 'prises', 'horizons', 'carnet']);
  /*
   * `carte` est juste derrière les journées, et c'est voulu : elle couvre TOUT
   * le journal là où elles ne portent que les dernières, pour mille fois moins
   * cher — mais elle ne remplace pas de lire ses mots, elle dit où aller les
   * lire. Devant le carnet, donc, et derrière ce qu'il a écrit ces jours-ci.
   */
  assert.ok(ORDRE_MEMOIRE.indexOf('carte') < ORDRE_MEMOIRE.indexOf('carnet'));
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

test('LE CURSEUR DÉCIDE DU NOMBRE DE JOURNÉES, ET RIEN NE LE CONTREDIT EN SILENCE', () => {
  /*
   * LA RÉGRESSION QUE CE TEST GARDE, ET ELLE A ÉTÉ VÉCUE.
   *
   * Un plafond de 14 000 signes bornait ce bloc. Mesuré sur un journal réel :
   * quatorze journées écrites pèsent 95 824 signes, donc le plafond n'en
   * gardait TROIS. L'écran annonçait « 14 journées passées transmises » et le
   * compagnon en recevait trois — il ne s'en souvenait pas parce qu'il ne les
   * avait jamais eues, et la personne en face le voyait redemander ce qu'elle
   * venait de dire.
   *
   * Un réglage qui ment est pire qu'un réglage cher : le second se voit sur
   * une facture, le premier ne se voit nulle part.
   */
  setSettings({ memoryDays: 9, carnetMemoire: false, prisesMemoire: false }, OWNER);
  const AUJ = '2026-03-01';
  const ins = db.prepare('INSERT OR REPLACE INTO entries(user_id,date,note,text) VALUES(?,?,?,?)');
  for (let i = 1; i <= 12; i++) {
    const d = new Date(Date.parse(AUJ) - i * 864e5).toISOString().slice(0, 10);
    // Des journées LONGUES : c'est le cas où l'ancien plafond mordait.
    ins.run(OWNER, d, 5, `MARQUEJOUR${i} — ` + 'une phrase entière qui se termine. '.repeat(200));
  }
  const m = recentMemory(AUJ, OWNER, null);
  for (let i = 1; i <= 9; i++) {
    assert.ok(m.stable.includes(`MARQUEJOUR${i}`),
      `la journée ${i} manque : le curseur en demande 9 et quelque chose en a retiré`);
  }
  assert.equal(m.stable.includes('MARQUEJOUR10'), false, 'le curseur en demande 9, il en passe 10');
  assert.ok(m.tailles['journées'] > 14000,
    'le bloc tient sous 14 000 signes : le plafond qui écrasait le curseur est revenu');
});

test('LA FENÊTRE DU FIL COUVRE UNE VRAIE SOIRÉE', () => {
  /*
   * Elle valait 24 messages — douze échanges. Mesuré sur un journal réel : une
   * soirée fait 36 messages en médiane, 12 soirées sur 27 dépassent 24, et la
   * plus longue en fait 174. Le compagnon perdait donc les deux premiers tiers
   * de la soirée EN COURS, et redemandait ce qui venait d'être dit.
   *
   * Le chiffre avait été choisi quand le prompt pesait 66 000 jetons. Il en
   * pèse trois fois moins et un message du fil vaut une quarantaine de jetons
   * relus à un dixième : la fenêtre économisait des centièmes de centime en
   * coûtant la conversation.
   */
  assert.ok(FIL_TRANSMIS >= 40,
    `${FIL_TRANSMIS} messages : la fenêtre ne couvre plus une soirée médiane de 36`);
});

test('la composition rendue ne compte QUE ce qui est parti', () => {
  // Sinon l'étiquette annoncerait 125 k pour un prompt qui en porte 24 —
  // et on chercherait une baleine qui n'est plus là.
  const r = memoireSousBudget(REEL());
  assert.deepEqual(r.hors, ['carnet']);
});
