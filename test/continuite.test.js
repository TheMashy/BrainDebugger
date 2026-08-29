/**
 * LA CONTINUITE D'UNE LECTURE A L'AUTRE.
 *
 * Le defaut repare ici ne se voyait pas dans une lecture prise seule : elle
 * etait juste, chaque fois. Il se voyait dans la SUITE. Trois soirs de plus
 * dans le journal, un « relire », et tout changeait de nom, de groupe et de
 * couleur -- alors que rien de ce que ces noms decrivaient n'avait bouge.
 *
 * Vu de l'ecran, ce n'est pas une lecture plus fine : c'est la preuve que rien
 * de ce qu'on avait compris ne tenait. On ne peut pas se reconnaitre dans une
 * carte qui se refait a chaque visite.
 *
 * Trois mecanismes, testes ici separement, parce qu'ils tombent en panne
 * separement : les NOMS (le modele voit la lecture precedente et la consigne
 * lui demande de les reprendre), les COULEURS (elles suivent le nom, plus le
 * rang), et les PLACES (elles suivent le nom, plus l'index).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { corpusPour, valider, validerPistes, validerCarte } from '../server/lecture.js';
import { disposer } from '../web/carte.js';
import { TEINTES_DECLAREES } from '../web/reperes.js';

const DATES = new Set(['2024-03-12', '2024-04-02', '2024-05-20']);
const D = [...DATES];

const theme = (nom, extra = {}) => ({
  nom, quoi: 'x', intensite: 2, serie: [],
  preuves: [{ date: D[0], extrait: 'z' }], ...extra
});

/** Une lecture deja enregistree, celle a laquelle la suivante doit se rattacher. */
const AVANT = {
  synthese: 'x',
  themes: [{ nom: 'les remontées courtes', quoi: 'a', intensite: 2 },
           { nom: 'le sommeil décide', quoi: 'b', intensite: 3 },
           { nom: 'tu minimises', quoi: 'c', intensite: 1 }],
  pistes: [
    { nom: 'dépression', quoi: 'a', contre: 'b', force: 2, teinte: TEINTES_DECLAREES[3],
      themes: ['les remontées courtes', 'le sommeil décide'], noeuds: ['le sommeil'] },
    { nom: 'hyperactivité', quoi: 'a', contre: 'b', force: 1, teinte: TEINTES_DECLAREES[1],
      themes: ['tu minimises', 'les remontées courtes'], noeuds: [] }
  ],
  carte: {
    noeuds: [{ nom: 'le sommeil', genre: 'corps', poids: 3, jours: [] },
             { nom: 'Léa', genre: 'personne', poids: 2, jours: [] }],
    liens: [{ de: 'le sommeil', vers: 'Léa', quoi: 'précède', force: 2 }]
  }
};

/* ------------------------- ce que le modele voit ------------------------- */

const rows = [{ date: D[0], note: 5, text: 'une journée écrite' },
              { date: D[1], note: 6, text: 'une autre' }];

test('sans lecture précédente, le corpus n’en parle pas', () => {
  // Une premiere lecture ne doit pas lire « CE QUE TU AVAIS COMPRIS » suivi de
  // rien : elle conclurait qu'elle a oublie quelque chose.
  const c = corpusPour({ rows });
  assert.ok(!c.texte.includes('LA DERNIÈRE FOIS'));
  assert.equal(c.precedente, null);
});

test('la lecture précédente entre dans le corpus, avec ses noms exacts', () => {
  const c = corpusPour({ rows, precedente: AVANT });
  assert.ok(c.texte.includes('CE QUE TU AVAIS COMPRIS LA DERNIÈRE FOIS'));
  for (const n of ['dépression', 'hyperactivité', 'les remontées courtes', 'le sommeil', 'Léa'])
    assert.ok(c.texte.includes(n), `« ${n} » manque au bloc`);
  // Ce qui RELIE les nœuds, pas seulement leur liste : c'est ce qu'on lui
  // demande de reconduire.
  assert.ok(c.texte.includes('précède'));
});

test('le bloc arrive APRÈS le journal, pas avant', () => {
  // Dans l'autre sens, le modèle partirait de ses propres conclusions et
  // relirait le corpus pour les confirmer : de la continuité aveugle.
  const c = corpusPour({ rows, precedente: AVANT });
  assert.ok(c.texte.indexOf('SES JOURNÉES ÉCRITES') < c.texte.indexOf('LA DERNIÈRE FOIS'));
});

test('une lecture précédente vide ne produit pas de bloc', () => {
  const c = corpusPour({ rows, precedente: { synthese: '', themes: [], pistes: [], carte: null } });
  assert.ok(!c.texte.includes('LA DERNIÈRE FOIS'));
});

/* ------------------------- ce qui en est déduit ------------------------- */

test('un nom repris est reconnu comme repris, quoi qu’en dise le modèle', () => {
  // Le modèle annonce « nouveau » ; le nom existait. C'est le fait qui tranche,
  // pas l'étiquette qu'il colle dessus.
  const r = valider({ synthese: 'x', themes: [theme('le sommeil décide', { suite: 'nouveau' })] },
                    DATES, [], AVANT);
  assert.equal(r.themes[0].suite, 'repris');
  assert.deepEqual(r.themes[0].avant, []);
});

test('un renommage porte le nom d’avant', () => {
  const r = valider({ synthese: 'x',
    themes: [theme('la nuit décide de tout', { avant: ['le sommeil décide'] })] }, DATES, [], AVANT);
  assert.equal(r.themes[0].suite, 'renomme');
  assert.deepEqual(r.themes[0].avant, ['le sommeil décide']);
});

test('deux noms d’avant sous une seule entrée : une fusion', () => {
  const r = valider({ synthese: 'x',
    themes: [theme('ce qui ne tient pas', { avant: ['le sommeil décide', 'tu minimises'] })] },
    DATES, [], AVANT);
  assert.equal(r.themes[0].suite, 'fusion');
  assert.equal(r.themes[0].avant.length, 2);
});

test('un ancêtre inventé ne fait pas un renommage', () => {
  // Sinon le modèle peut se réclamer d'une continuité qui n'a jamais existé,
  // et l'interface annoncerait « repris de » un nom que personne n'a jamais lu.
  const r = valider({ synthese: 'x', themes: [theme('tout neuf', { avant: ['un thème jamais rendu'] })] },
                    DATES, [], AVANT);
  assert.equal(r.themes[0].suite, 'nouveau');
  assert.deepEqual(r.themes[0].avant, []);
});

test('sans lecture précédente, tout est neuf et rien ne prétend le contraire', () => {
  const r = valider({ synthese: 'x', themes: [theme('les remontées courtes', { avant: ['x'] })] }, DATES);
  assert.equal(r.themes[0].suite, 'nouveau');
  assert.deepEqual(r.themes[0].avant, []);
});

test('un nom repris n’est pas volé par une entrée qui prétend le renommer', () => {
  // L'ordre de résolution compte : le thème qui S'APPELLE « tu minimises »
  // réserve ce nom avant que l'autre ne puisse s'en réclamer.
  const r = valider({ synthese: 'x', themes: [
    theme('autre chose', { avant: ['tu minimises'] }),
    theme('tu minimises')
  ] }, DATES, [], AVANT);
  const par = Object.fromEntries(r.themes.map(t => [t.nom, t]));
  assert.equal(par['tu minimises'].suite, 'repris');
  assert.equal(par['autre chose'].suite, 'nouveau');
});

test('un même ancêtre ne peut pas avoir deux successeurs', () => {
  const r = valider({ synthese: 'x', themes: [
    theme('premier', { avant: ['le sommeil décide'] }),
    theme('second', { avant: ['le sommeil décide'] })
  ] }, DATES, [], AVANT);
  assert.equal(r.themes.filter(t => t.avant.includes('le sommeil décide')).length, 1);
});

test('les nœuds de la carte suivent la même règle', () => {
  const c = validerCarte({
    noeuds: [{ nom: 'le sommeil', genre: 'corps', poids: 3, jours: [] },
             { nom: 'les nuits blanches', genre: 'periode', poids: 2, jours: [], avant: ['Léa'] }],
    liens: [{ de: 'le sommeil', vers: 'les nuits blanches', quoi: 'précède', force: 2 }]
  }, null, { themes: new Set(), pistes: new Set(),
             noeuds: new Set(['le sommeil', 'léa']), teintes: new Map() });
  assert.equal(c.noeuds.find(n => n.nom === 'le sommeil').suite, 'repris');
  assert.equal(c.noeuds.find(n => n.nom === 'les nuits blanches').suite, 'renomme');
});

/* ----------------------------- les couleurs ----------------------------- */

const pisteBrute = (nom, extra = {}) => ({
  nom, quoi: 'a', contre: 'ce qui va contre', force: 2,
  themes: ['t1', 't2'], ...extra
});
const THEMES = new Set(['t1', 't2']);

test('une piste reprise garde SA teinte, même si son rang change', () => {
  // C'est le cœur du défaut : la teinte venait de l'index. « dépression »
  // passée de la deuxième à la première place changeait de couleur, et avec
  // elle son îlot sur la carte et tous ses mécanismes en dessous.
  const p = validerPistes([pisteBrute('hyperactivité'), pisteBrute('dépression')],
                          THEMES, new Set(), memoireDe(AVANT));
  const par = Object.fromEntries(p.map(x => [x.nom, x.teinte]));
  assert.equal(par['dépression'], TEINTES_DECLAREES[3]);
  assert.equal(par['hyperactivité'], TEINTES_DECLAREES[1]);
});

test('la teinte traverse un renommage', () => {
  const p = validerPistes([pisteBrute('épuisement de fond', { avant: ['dépression'] })],
                          THEMES, new Set(), memoireDe(AVANT));
  assert.equal(p[0].teinte, TEINTES_DECLAREES[3]);
});

test('une piste neuve ne prend pas la teinte d’une piste gardée', () => {
  const p = validerPistes([pisteBrute('dépression'), pisteBrute('quelque chose de neuf')],
                          THEMES, new Set(), memoireDe(AVANT));
  assert.notEqual(p[0].teinte, p[1].teinte);
  assert.ok(TEINTES_DECLAREES.includes(p[1].teinte));
});

test('toute piste porte une teinte de la bande déclarée', () => {
  // La règle de couleur du produit : ce qui est DÉCLARÉ vit dans 232-336, et
  // ne peut pas emprunter le vert d'une bonne journée.
  const p = validerPistes([pisteBrute('a'), pisteBrute('b'), pisteBrute('c')], THEMES);
  assert.equal(p.length, 3);
  for (const x of p) assert.ok(TEINTES_DECLAREES.includes(x.teinte));
  assert.equal(new Set(p.map(x => x.teinte)).size, 3);
});

/* `memoire()` n'est pas exporté — il n'a pas à l'être, c'est un détail de la
   validation. On le reconstruit ici sous la forme qu'attendent les fonctions,
   ce qui a l'avantage de figer ce contrat. */
function memoireDe(p) {
  const bas = x => String(x).trim().toLowerCase();
  return {
    themes: new Set((p.themes ?? []).map(t => bas(t.nom))),
    pistes: new Set((p.pistes ?? []).map(x => bas(x.nom))),
    noeuds: new Set((p.carte?.noeuds ?? []).map(n => bas(n.nom))),
    teintes: new Map((p.pistes ?? []).map(x => [bas(x.nom), x.teinte]))
  };
}

/* ------------------------------ la synthèse ------------------------------ */

test('la synthèse ne se coupe pas au milieu d’un mot', () => {
  // « … parce que le vide, s » — une phrase amputée se lit comme une panne de
  // l'application, pas comme une limite.
  const longue = ('Tu remontes en fin d\'été et tu redescends en novembre. ').repeat(40);
  const r = valider({ synthese: longue, themes: [] }, DATES);
  assert.ok(r.synthese.length < longue.length);
  assert.ok(/[.!?…]$/.test(r.synthese), `finit par « ${r.synthese.slice(-24)} »`);
});

test('une synthèse courte passe entière', () => {
  const s = 'Deux phrases. Et pas une de plus.';
  assert.equal(valider({ synthese: s, themes: [] }, DATES).synthese, s);
});

/* ------------------------------ les places ------------------------------ */

const noeud = (nom, amas) => ({ nom, amas, jours: 10 });

test('un nœud de plus ne déplace pas les autres', () => {
  /*
   * Le défaut : les positions de départ venaient d'une spirale INDEXÉE. Un
   * nœud inséré en troisième position décalait tous les suivants d'un cran, et
   * la simulation, partie d'ailleurs, arrivait ailleurs. Quelqu'un qui n'avait
   * rien changé de sa vie retrouvait une carte entièrement redisposée.
   */
  const base = ['a', 'b', 'c', 'd', 'e'].map(n => noeud(n, 'p0'));
  const liens = [{ s: 0, t: 1, force: 1 }, { s: 1, t: 2, force: 1 },
                 { s: 2, t: 3, force: 1 }, { s: 3, t: 4, force: 1 }];
  const avant = disposer({ noeuds: base, liens }, 800, 500);
  // Le nouveau est inséré EN TÊTE : c'est le cas qui décalait tout.
  const apres = disposer({ noeuds: [noeud('zz', 'p0'), ...base],
                           liens: liens.map(l => ({ ...l, s: l.s + 1, t: l.t + 1 })) }, 800, 500);
  const ecarts = base.map((_, i) => Math.hypot(
    avant.pts[i].x - apres.pts[i + 1].x, avant.pts[i].y - apres.pts[i + 1].y));
  const moyen = ecarts.reduce((a, b) => a + b, 0) / ecarts.length;
  assert.ok(moyen < 90, `les nœuds gardés ont bougé de ${Math.round(moyen)} px en moyenne`);
});

test('la même carte se redispose à l’identique', () => {
  const G = { noeuds: ['a', 'b', 'c'].map(n => noeud(n, 'p0')),
              liens: [{ s: 0, t: 1, force: 1 }] };
  const un = disposer(G, 800, 500), deux = disposer(G, 800, 500);
  assert.deepEqual(un.pts.map(p => [p.x, p.y]), deux.pts.map(p => [p.x, p.y]));
});

test('deux îlots partent séparés', () => {
  // Sans ancre par amas, les membres d'un même îlot partaient aux quatre coins
  // et la simulation passait son temps à les ramener : les enveloppes
  // finissaient étirées et se traversaient toutes.
  const G = {
    noeuds: [...['a', 'b', 'c'].map(n => noeud(n, 'p0')), ...['d', 'e', 'f'].map(n => noeud(n, 'p1'))],
    liens: [{ s: 0, t: 1, force: 1 }, { s: 3, t: 4, force: 1 }]
  };
  const { pts } = disposer(G, 800, 500);
  const centre = is => ({ x: is.reduce((s, i) => s + pts[i].x, 0) / is.length,
                          y: is.reduce((s, i) => s + pts[i].y, 0) / is.length });
  const a = centre([0, 1, 2]), b = centre([3, 4, 5]);
  const etale = is => Math.max(...is.map(i => Math.hypot(pts[i].x - (is[0] < 3 ? a : b).x,
                                                        pts[i].y - (is[0] < 3 ? a : b).y)));
  // Les deux centres sont plus loin l'un de l'autre que ne s'étale chaque îlot.
  assert.ok(Math.hypot(a.x - b.x, a.y - b.y) > Math.max(etale([0, 1, 2]), etale([3, 4, 5])));
});

/* ----------------------------- le branchement ----------------------------- */

/*
 * Le chaînon qui manquait ne serait visible nulle part ailleurs : la route peut
 * très bien oublier de passer la lecture enregistrée, et tout ce qui précède
 * resterait vert pendant que l'application, elle, repart de zéro à chaque fois.
 * On la fait donc tourner pour de vrai, avec une lecture déjà en base.
 */
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('la route de lecture repart de celle qui est enregistrée', async () => {
  process.env.BD_DB = join(mkdtempSync(join(tmpdir(), 'bd-cont-')), 'test.db');
  const { setLecture, addMessage, OWNER } = await import('../server/db.js');
  const api = await import('../server/api.js');

  for (let i = 1; i <= 20; i++) {
    const d = `2026-03-${String(i).padStart(2, '0')}`;
    addMessage({ ts: `${d}T20:00:00Z`, date: d, role: 'user', text: 'une journée écrite ce soir' });
  }
  api.invalidate(OWNER);
  setLecture({ contenu: AVANT, jusqu_au: '2026-03-20', jours: 20, modele: 'm', userId: OWNER });

  // Le corpus que la route enverrait : la lecture enregistrée doit y être, avec
  // ses noms, sinon toute la mécanique testée plus haut ne sert à rien.
  const c = api.corpusDuJournal(OWNER);
  assert.ok(c.texte.includes('CE QUE TU AVAIS COMPRIS LA DERNIÈRE FOIS'));
  assert.ok(c.texte.includes('dépression'));
  assert.equal(c.precedente?.pistes?.length, 2);

  // Et la route tourne : sans clé elle s'arrête au modèle, mais APRÈS avoir
  // construit ce corpus-là.
  const r = await api.routes['POST /api/lecture']({ userId: OWNER });
  assert.match(String(r.error), /clé API/i);
});
