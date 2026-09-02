/**
 * La carte organique. Ce qui est testé est la traduction vers le moteur de
 * placement — le dessin, lui, se regarde.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { versGraphe, cadrer, couronne, journeeAu, recadrer, vueNeutre, versCarte, zoomer,
         contour, poidsDuNoeud, ilotDesNoeuds, appuyer, siensDe, tenueDe, SEUIL_APPUI, SEUIL_PART,
         LIBRE, K_MIN, K_MAX, TEINTE_GENRE, NOM_GENRE } from '../web/relations.js';
import { disposer } from '../web/carte.js';
import { GENRES } from '../server/lecture.js';
import { TEINTES_DECLAREES } from '../web/reperes.js';

const CARTE = {
  noeuds: [{ nom: 'Léa', genre: 'personne', poids: 3 },
           { nom: 'les nuits courtes', genre: 'corps', poids: 2 },
           { nom: 'le dimanche soir', genre: 'periode', poids: 1 }],
  liens: [{ de: 'Léa', vers: 'les nuits courtes', quoi: 'précède', force: 3 },
          { de: 'le dimanche soir', vers: 'Léa', quoi: 'fait retomber', force: 1 }]
};

test('les liens sont traduits en indices, dans les deux sens', () => {
  const G = versGraphe(CARTE);
  assert.deepEqual(G.liens.map(l => [l.s, l.t]), [[0, 1], [2, 0]]);
  assert.deepEqual(G.liens.map(l => l.quoi), ['précède', 'fait retomber']);
});

test('un lien vers un nom absent ne devient pas un lien vers l’indice 0', () => {
  // `index.get()` rend undefined, et undefined dans pts[] est un plantage muet
  // au premier rendu — ou pire, un trait vers le mauvais nœud.
  const G = versGraphe({ noeuds: CARTE.noeuds, liens: [{ de: 'Léa', vers: 'fantôme', quoi: 'x', force: 2 }] });
  assert.deepEqual(G.liens, []);
});

test('le poids devient la masse, le genre devient l’amas', () => {
  // Sans regroupement par genre, seize nœuds reliés dans tous les sens forment
  // une pelote où plus rien ne se distingue.
  const G = versGraphe(CARTE);
  assert.deepEqual(G.noeuds.map(n => n.jours), [3, 2, 1]);
  assert.deepEqual(G.noeuds.map(n => n.amas), ['personne', 'corps', 'periode']);
});

test('une carte vide ne casse rien', () => {
  for (const v of [null, undefined, {}, { noeuds: [], liens: [] }]) {
    const G = versGraphe(v);
    assert.deepEqual([G.noeuds, G.liens], [[], []]);
  }
});

test('chaque genre du serveur a une teinte et un nom lisible', () => {
  for (const g of GENRES) {
    assert.ok(TEINTE_GENRE[g], `teinte manquante pour ${g}`);
    assert.ok(NOM_GENRE[g], `nom manquant pour ${g}`);
  }
});

/*
 * CE QUE CE TEST GARDAIT, ET CE QU'IL GARDE MAINTENANT.
 *
 * Il exigeait que les teintes des genres tiennent dans la bande des teintes
 * DÉCLARÉES (232-336). C'était un raccourci : ce qu'on protège vraiment, c'est
 * que la couleur d'un genre — déclarée — ne puisse pas se confondre avec celle
 * d'un écart de journée — mesurée. La bande servait de proxy pour « pas la
 * rampe », et elle était bien plus étroite que la propriété.
 *
 * Assez étroite pour causer un défaut réel : huit genres à treize degrés
 * d'écart, tous au même bleu-violet. La légende annonçait huit types, l'œil en
 * voyait un — « mon amas c'est un amas de points ».
 *
 * Le test mesure donc maintenant les DEUX propriétés, et la rampe est lue là où
 * elle est écrite plutôt que devinée :
 *   — aucune teinte de genre dans la rampe des écarts ;
 *   — et des genres assez ÉCARTÉS entre eux pour se distinguer.
 * La seconde n'était testée nulle part, et c'est celle qui avait cassé.
 */
const RAMPE = { bas: 18, haut: 128 };   // cf. `couleurEcart` : hsl(18 + (t+1)*55 …)

test('aucune teinte de genre ne tombe dans la rampe des écarts', () => {
  // « Ce qui est rempli est mesuré, ce qui est contouré est déclaré. » Les
  // journées sont des pastilles PLEINES à la couleur de leur écart, autour de
  // chaque nœud ; un anneau de la même teinte, à côté, brouillerait les deux.
  const MARGE = 12;
  for (const [g, t] of Object.entries(TEINTE_GENRE)) {
    assert.ok(t < RAMPE.bas - MARGE || t > RAMPE.haut + MARGE,
      `${g} = ${t}°, dans la rampe des écarts (${RAMPE.bas}-${RAMPE.haut})`);
  }
});

test('les genres se distinguent les uns des autres', () => {
  /*
   * C'est LE défaut que l'ancienne bande produisait. Vingt degrés est le
   * minimum où deux teintes de même saturation se lisent comme deux couleurs
   * plutôt que comme deux nuances — en dessous, une légende de huit entrées
   * annonce huit choses qu'on ne peut pas retrouver sur le dessin.
   */
  const tri = Object.entries(TEINTE_GENRE).sort((a, b) => a[1] - b[1]);
  for (let i = 1; i < tri.length; i++) {
    const d = tri[i][1] - tri[i - 1][1];
    assert.ok(d >= 20, `${tri[i - 1][0]} (${tri[i - 1][1]}°) et ${tri[i][0]} (${tri[i][1]}°) : ${d}° d'écart`);
  }
  // Et l'ensemble occupe une vraie étendue, pas un coin du cercle.
  assert.ok(tri.at(-1)[1] - tri[0][1] >= 150, 'toutes les teintes sont dans le même quartier');
});

test('les teintes déclarées de l’application restent hors de la rampe, elles aussi', () => {
  // Les repères et les motifs partagent cette contrainte : une pastille de
  // repère verte se lirait comme une bonne journée.
  for (const t of TEINTES_DECLAREES) {
    assert.ok(t < RAMPE.bas - 12 || t > RAMPE.haut + 12, `${t}° est dans la rampe`);
  }
});

/* ------------------------------ le cadrage ------------------------------ */

const pts = () => [{ x: 300, y: 300 }, { x: 340, y: 320 }, { x: 320, y: 280 }];

test('le graphe est mis à l’échelle du cadre, sans être déformé', () => {
  // Un seul facteur pour les deux axes : deux facteurs feraient mentir les
  // angles, et les distances relatives sont ce que la carte porte.
  const p = cadrer(pts(), 900, 500);
  const l = Math.max(...p.map(q => q.x)) - Math.min(...p.map(q => q.x));
  const h = Math.max(...p.map(q => q.y)) - Math.min(...p.map(q => q.y));
  assert.ok(Math.abs(l / h - 40 / 40) < 0.01, `déformé : ${l} × ${h}`);
  assert.ok(l > 40, 'pas agrandi du tout');
});

test('un petit graphe n’est pas étiré jusqu’aux bords', () => {
  // L'étaler en constellation perdrait le regroupement par genre.
  const p = cadrer(pts(), 2000, 2000);
  const l = Math.max(...p.map(q => q.x)) - Math.min(...p.map(q => q.x));
  assert.ok(l <= 40 * 1.6 + 0.01, `étiré à ${l}`);
});

test('le graphe est recentré, et un nœud seul se pose au milieu', () => {
  const p = cadrer(pts(), 900, 500);
  const cx = (Math.max(...p.map(q => q.x)) + Math.min(...p.map(q => q.x))) / 2;
  assert.ok(Math.abs(cx - 450) < 0.01, `centre à ${cx}`);
  assert.deepEqual(cadrer([{ x: 5, y: 5 }], 900, 500), [{ x: 450, y: 250 }]);
  assert.deepEqual(cadrer([], 900, 500), []);
});

test('la marge latérale est plus large que la verticale', () => {
  // Un libellé s'étale latéralement bien au-delà de son nœud — « l'appart de
  // Lyon » fait cent pixels pour un anneau de dix — et c'est en largeur qu'il
  // sort du cadre.
  const p = cadrer([{ x: 0, y: 0 }, { x: 100, y: 100 }], 400, 400);
  const l = Math.abs(p[1].x - p[0].x), h = Math.abs(p[1].y - p[0].y);
  assert.ok(l <= 400 - 62 * 2 + 0.01, `déborde en largeur : ${l}`);
  assert.equal(Math.round(l), Math.round(h), 'la mise à l’échelle a déformé');
});

/* -------------------- les journées derrière un nœud -------------------- */

test('les dates ne peuvent pas écraser la masse du nœud', () => {
  // `jours` est le nom que disposer() donne à la MASSE et celui que le serveur
  // donne à la LISTE. Ils se sont rencontrés ici, et la liste écrasait la masse
  // sans rien casser de visible — la disposition devenait juste fausse.
  const G = versGraphe({
    noeuds: [{ nom: 'a', genre: 'corps', poids: 2, jours: [{ d: '2024-01-01', e: 1 }, { d: '2024-01-02', e: -2 }] },
             { nom: 'b', genre: 'lieu', poids: 1, jours: [] }],
    liens: [{ de: 'a', vers: 'b', quoi: 'précède', force: 2 }]
  });
  assert.equal(typeof G.noeuds[0].jours, 'number', 'la masse doit rester un nombre');
  assert.equal(G.noeuds[0].jours, 2);
  assert.equal(G.noeuds[0].occurrences.length, 2);
  // Sans dates, on retombe sur le poids déclaré plutôt que sur zéro : un nœud
  // de masse nulle se fait éjecter par la répulsion.
  assert.equal(G.noeuds[1].jours, 1);
});

test('la couronne place une journée par point, sans se recouvrir', () => {
  const n = { poids: 2, occurrences: Array.from({ length: 40 }, (_, i) => ({ d: `2024-01-${String(i + 1).padStart(2, '0')}`, e: i % 5 - 2 })) };
  const pts = couronne(n, 9);
  assert.equal(pts.length, 40);
  // Chaque point est dehors : un point sous l'anneau serait invisible.
  for (const p of pts) assert.ok(Math.hypot(p.x, p.y) > 9, 'un point tombe dans l’anneau');
  // Deux points ne se superposent jamais.
  for (let i = 0; i < pts.length; i++) {
    for (let j = i + 1; j < pts.length; j++) {
      assert.ok(Math.hypot(pts[i].x - pts[j].x, pts[i].y - pts[j].y) > 1.4,
        `les points ${i} et ${j} se recouvrent`);
    }
  }
});

test('la couronne tient un corpus démesuré sans exploser', () => {
  const n = { poids: 3, occurrences: Array.from({ length: 900 }, () => ({ d: '2024-01-01', e: 0 })) };
  const pts = couronne(n, 9);
  assert.ok(pts.length <= 96, 'la couronne doit être plafonnée');
  for (const p of pts) assert.ok(Math.hypot(p.x, p.y) < 60, 'la couronne déborde du nœud');
});

test('une journée sans écart reste une journée', () => {
  const pts = couronne({ occurrences: [{ d: '2024-01-01', e: null }] }, 6);
  assert.equal(pts.length, 1);
  assert.equal(pts[0].e, null);
});

/* ------------------------- se promener dans la carte ------------------------- */

test('le zoom garde fixe le point visé', () => {
  // La seule façon de zoomer qui ne désoriente pas : on grossit ce qu'on vise,
  // pas le centre du cadre. Sinon il faut rattraper au glissé à chaque cran.
  const v0 = vueNeutre();
  const v1 = zoomer(v0, 300, 200, 2);
  assert.equal(v1.k, 2);
  const avant = versCarte(v0, 300, 200);
  const apres = versCarte(v1, 300, 200);
  assert.ok(Math.abs(avant.x - apres.x) < 1e-9 && Math.abs(avant.y - apres.y) < 1e-9,
    'le point sous le curseur a bougé');
});

test('le zoom est borné des deux côtés', () => {
  let v = vueNeutre();
  for (let i = 0; i < 40; i++) v = zoomer(v, 0, 0, 2);
  assert.equal(v.k, K_MAX);
  for (let i = 0; i < 80; i++) v = zoomer(v, 0, 0, 0.5);
  assert.equal(v.k, K_MIN);
});

test('recadrer ramène le graphe dans le cadre, pas le cadre sur zéro', () => {
  // On recentre sur le GRAPHE : après trois glissades, ce sont deux choses
  // très différentes.
  const pts = [{ x: 900, y: 900 }, { x: 1100, y: 1000 }];
  const v = recadrer(pts, 600, 400);
  const c = versCarte(v, 300, 200);
  assert.ok(Math.abs(c.x - 1000) < 1e-6, 'le milieu du graphe doit tomber au milieu du cadre');
  assert.ok(Math.abs(c.y - 950) < 1e-6);
  assert.ok(v.k >= K_MIN && v.k <= K_MAX);
  // Un graphe vide ne fait pas planter le bouton.
  assert.deepEqual(recadrer([], 600, 400), vueNeutre());
});

test('un point de la couronne se vise à l’écran, pas dans la carte', () => {
  // Le rayon de capture est en pixels ÉCRAN : sous zoom fort, un rayon en
  // coordonnées carte deviendrait minuscule à viser.
  const G = versGraphe({
    noeuds: [{ nom: 'a', genre: 'corps', poids: 2,
               jours: [{ d: '2024-03-01', e: 2 }, { d: '2024-03-02', e: -1 }] }],
    liens: []
  });
  const pts = [{ x: 100, y: 100 }];
  const cible = couronne(G.noeuds[0], 9)[0];
  const sx = 100 + cible.x, sy = 100 + cible.y;

  const sansZoom = journeeAu(pts, G, sx, sy, 1, vueNeutre());
  assert.equal(sansZoom?.date, '2024-03-01');

  const v = { x: 0, y: 0, k: 3 };
  const zoome = journeeAu(pts, G, sx * 3, sy * 3, 1, v);
  assert.equal(zoome?.date, '2024-03-01', 'la même journée doit rester visable sous zoom');

  // Loin de tout point, on ne renvoie rien : un clic dans le vide n'ouvre pas
  // une journée au hasard.
  assert.equal(journeeAu(pts, G, 400, 400, 1, vueNeutre()), null);
});

test('un nœud sans journées ne piège pas la visée', () => {
  const G = versGraphe({ noeuds: [{ nom: 'a', genre: 'lieu', poids: 1, jours: [] }], liens: [] });
  assert.equal(journeeAu([{ x: 50, y: 50 }], G, 50, 50, 1, vueNeutre()), null);
});

/* ------------------------------- les îlots -------------------------------

   Une piste nomme des nœuds ; ces nœuds deviennent un AMAS, et `disposer` les
   range côte à côte sans rien savoir de plus. Le regroupement spatial tombe
   tout seul — mais seulement si la traduction tient. */

const PISTES = [
  { nom: 'dépendance aux anxiolytiques', noeuds: ['Léa', 'les nuits courtes'] },
  { nom: 'la peur de décevoir', noeuds: ['le dimanche soir'] }
];

test('les nœuds d’une piste forment un amas, les autres gardent leur genre', () => {
  const G = versGraphe(CARTE, PISTES);
  assert.equal(G.noeuds[0].amas, 'piste:dépendance aux anxiolytiques');
  assert.equal(G.noeuds[1].amas, 'piste:dépendance aux anxiolytiques');
  assert.equal(G.noeuds[0].ilot, 0);
  // Le troisième est dans la piste 1 : il porte son amas à elle.
  assert.equal(G.noeuds[2].amas, 'piste:la peur de décevoir');
});

test('l’amas d’une piste est son NOM, pas son rang', () => {
  /*
   * `disposer()` pose chaque amas à l'endroit que son nom lui donne. Avec un
   * numéro d'ordre, une piste qui passe de la deuxième à la première place
   * emmène tout son groupe à l'autre bout du cadre alors qu'aucun nœud n'a
   * changé — le défaut même qu'on répare : une carte qui se réorganise
   * entièrement pour trois soirs d'écriture de plus.
   */
  const inverse = versGraphe(CARTE, [PISTES[1], PISTES[0]]);
  const direct = versGraphe(CARTE, PISTES);
  const par = g => Object.fromEntries(g.noeuds.map(n => [n.nom, n.amas]));
  assert.deepEqual(par(inverse), par(direct));
});

test('sans pistes, on retombe sur le regroupement par genre', () => {
  // C'est le bon défaut, et le seul possible tant qu'aucune lecture n'a tourné :
  // seize nœuds reliés dans tous les sens forment une pelote.
  const G = versGraphe(CARTE);
  assert.deepEqual(G.noeuds.map(n => n.amas), ['personne', 'corps', 'periode']);
  assert.deepEqual(G.noeuds.map(n => n.ilot), [null, null, null]);
  assert.deepEqual(G.ilots, []);
});

test('un nœud réclamé par deux pistes appartient aux deux, et se pose dans une', () => {
  /*
   * LE PREMIER ARRIVÉ NE GARDE PLUS LE NŒUD. Une chose qui appartient à deux
   * endroits est souvent celle qui compte le plus, et la ranger d'un seul côté
   * efface exactement ce qui la rend intéressante.
   *
   * `ilots` est l'APPARTENANCE et peut valoir pour deux ; `ilot` est la PLACE,
   * et il n'y en a qu'une : un point sur la toile tiré vers deux ancres
   * finirait entre les deux, dans un endroit qui n'est ni l'un ni l'autre.
   */
  const G = versGraphe(CARTE, [
    { nom: 'a', noeuds: ['Léa'] },
    { nom: 'b', noeuds: ['Léa', 'le dimanche soir'] }
  ]);
  assert.deepEqual(G.noeuds[0].ilots, [0, 1], 'Léa est dans les deux');
  assert.equal(G.noeuds[0].ilot, 0, 'et se pose dans la première');
  assert.deepEqual(G.noeuds[2].ilots, [1]);
  assert.equal(G.ilots.length, 2, 'les deux pistes deviennent des îlots');
});

test('les deux îlots d’un nœud partagé le comptent chacun', () => {
  // Sinon l'un des deux serait mesuré sur un membre qu'il n'a pas, et son
  // enveloppe dirait autre chose que ce qu'elle entoure.
  const noeuds = ['a', 'b', 'c'].map(nom => ({ nom, genre: 'activite', poids: 1, jours: [] }));
  const liens = [{ de: 'a', vers: 'b', quoi: 'précède', force: 2 },
                 { de: 'b', vers: 'c', quoi: 'précède', force: 2 }];
  const G = versGraphe({ noeuds, liens }, [
    { nom: 'un', teinte: 200, noeuds: ['a', 'b'] },
    { nom: 'deux', teinte: 300, noeuds: ['b', 'c'] }
  ]);
  for (const a of G.ilots) assert.equal(a.n, 2, `« ${a.nom} » compte ses deux membres`);
  // Et « b » n'est plus un pont : il est DANS les deux, il ne les relie pas.
  assert.deepEqual(G.noeuds[1].ilots, [0, 1]);
});

test('une piste qui ne place aucun nœud ne devient pas un îlot vide', () => {
  // Sinon la carte dessinerait une enveloppe autour de rien, avec un nom
  // flottant au-dessus — le contraire d'un repère.
  const G = versGraphe(CARTE, [{ nom: 'fantôme', noeuds: ['personne qui n’existe pas'] }]);
  assert.deepEqual(G.ilots, []);
});

test('un nom de nœud se retrouve quelle que soit sa casse', () => {
  // Le modèle rend « Léa » dans la carte et « léa » dans la piste : deux
  // écritures du même nom ne doivent pas casser l'îlot.
  const G = versGraphe(CARTE, [{ nom: 'x', noeuds: ['LÉA', 'LES NUITS COURTES'] }]);
  assert.equal(G.noeuds[0].ilot, 0);
  assert.equal(G.noeuds[1].ilot, 0);
});

test('l’enveloppe d’un îlot entoure tous ses nœuds', () => {
  // Un cercle englobant paraissait plus simple — mais dès qu'un îlot s'étire,
  // son cercle recouvre la moitié de la carte. Ce qu'on veut n'est pas « la
  // zone qui contient », c'est « la forme de ce groupe-là ».
  const membres = [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 80 }, { x: 40, y: 40 }];
  const b = contour(membres, 20);
  assert.ok(b.length >= 3);
  // Chaque nœud est à l'intérieur : on teste par le rayon depuis le centre,
  // suffisant sur un convexe dilaté.
  const cx = b.reduce((s, p) => s + p.x, 0) / b.length;
  const cy = b.reduce((s, p) => s + p.y, 0) / b.length;
  const rMax = Math.max(...b.map(p => Math.hypot(p.x - cx, p.y - cy)));
  for (const m of membres) {
    assert.ok(Math.hypot(m.x - cx, m.y - cy) <= rMax, `${m.x},${m.y} hors de l’enveloppe`);
  }
});

test('deux nœuds seulement donnent quand même une enveloppe', () => {
  // Pas de polygone possible à deux points : sans ce cas, un îlot de deux
  // nœuds ne dessinait rien du tout.
  const b = contour([{ x: 0, y: 0 }, { x: 60, y: 0 }], 20);
  assert.ok(b.length >= 3);
  assert.ok(b.every(p => Number.isFinite(p.x) && Number.isFinite(p.y)));
});

/* ================= CE QU'UN NŒUD PÈSE DANS LES PISTES ================= */

/*
 * LE PROBLÈME que ça résout : la carte porte des CHOSES — « Londres », « la
 * weed » — et juste dessous s'affichent des MÉCANISMES. Deux vocabulaires,
 * deux listes, et rien qui dise comment l'un touche l'autre. On regardait
 * « Londres » sans pouvoir savoir si ça comptait dans ce qui avait été compris,
 * ou si c'était juste un endroit où l'on était allé.
 *
 * La fausse solution aurait été de renommer les nœuds d'après les mécanismes :
 * une carte de mécanismes n'est plus une carte, c'est la même liste dessinée
 * deux fois. Ce qui fait la valeur de « Londres » sur une carte, c'est
 * justement que ce soit un lieu.
 */

const j = (a, b) => Array.from({ length: b - a + 1 },
  (_, i) => `2026-01-${String(a + i).padStart(2, '0')}`);

const LECT = {
  themes: [
    { nom: 'la bascule', preuves: [{ date: '2026-01-03', extrait: 'x' }] },
    { nom: 'la nuit', preuves: [{ date: '2026-01-04', extrait: 'x' }] },
    { nom: 'le retrait', preuves: [{ date: '2026-01-20', extrait: 'x' }] }
  ],
  pistes: [
    { nom: 'instabilité', teinte: 232, themes: ['la bascule', 'la nuit'],
      noeuds: ['le sommeil', 'les nuits blanches'] },
    { nom: 'vide au travail', teinte: 284, themes: ['le retrait'], noeuds: ['le doc'] }
  ],
  carte: {
    noeuds: [
      // Londres tombe sur les mêmes journées que le sommeil, pas sur celles du doc.
      { nom: 'Londres', genre: 'lieu', poids: 2, jours: j(1, 10) },
      { nom: 'le sommeil', genre: 'corps', poids: 3, jours: j(1, 10) },
      { nom: 'les nuits blanches', genre: 'periode', poids: 2, jours: j(5, 12) },
      { nom: 'le doc', genre: 'travail', poids: 3, jours: j(20, 28) }
    ],
    liens: [
      { de: 'Londres', vers: 'le sommeil', quoi: 'fait retomber', force: 3 },
      { de: 'les nuits blanches', vers: 'le doc', quoi: 'précède', force: 2 }
    ]
  }
};

test('un nœud dit ce qu’il pèse dans chaque piste, en journées partagées', () => {
  const p = poidsDuNoeud(LECT, 'Londres');
  assert.equal(p.nom, 'Londres');
  assert.equal(p.jours.length, 10);
  // Londres partage ses dix journées avec « instabilité » (le sommeil, 1→10)
  // et aucune avec « vide au travail » (le doc, 20→28), qui disparaît donc.
  assert.deepEqual(p.pesees.map(x => x.nom), ['instabilité']);
  assert.equal(p.pesees[0].partage, 10);
  assert.equal(p.pesees[0].sur, 10);
  assert.equal(p.pesees[0].part, 1);
  // Et ça vaut plus que le hasard : la piste ne couvre pas tout le journal.
  assert.ok(p.pesees[0].rapport > 1);
});

test('une ligne à zéro n’est pas affichée : ce n’est pas une information', () => {
  const p = poidsDuNoeud(LECT, 'le doc');
  assert.deepEqual(p.pesees.map(x => x.nom), ['vide au travail']);
});

test('un nœud ne se compare pas à lui-même dans sa propre piste', () => {
  // Sans cette exclusion, « le sommeil » afficherait 100 % sur son propre îlot
  // parce qu'il y est — ce qui n'apprend rien à personne.
  const p = poidsDuNoeud(LECT, 'le sommeil');
  const sien = p.pesees.find(x => x.nom === 'instabilité');
  assert.ok(sien.sien, 'il appartient bien à cette piste');
  /*
   * Ses journées 1→10 croisent « les nuits blanches » (5→12) sur 5→10 : six.
   * Plus les deux journées citées en preuve par ses thèmes, le 03 et le 04 —
   * une piste ne se réduit pas à ses nœuds, elle porte aussi ce sur quoi
   * reposent les mécanismes qu'elle regroupe. Huit, donc.
   */
  assert.equal(sien.partage, 8);
});

test('un nœud porte son îlot et ce qui le relie, avec le sens du lien', () => {
  const p = poidsDuNoeud(LECT, 'Londres');
  assert.equal(p.ilot, null, 'Londres n’appartient à aucune piste, et c’est très bien');
  assert.deepEqual(p.liens, [{ autre: 'le sommeil', quoi: 'fait retomber', force: 3, sortant: true }]);

  const s = poidsDuNoeud(LECT, 'le sommeil');
  assert.equal(s.ilot.nom, 'instabilité');
  assert.equal(s.ilot.teinte, 232);
  // Vu depuis « le sommeil », le lien est ENTRANT : « Londres fait retomber le
  // sommeil » ne se lit pas dans l'autre sens.
  assert.equal(s.liens[0].sortant, false);
  assert.equal(s.liens[0].autre, 'Londres');
});

test('les journées décorées comptent comme les journées en clair', () => {
  /*
   * LE PIÈGE, ET IL EST MUET. Le serveur rend les journées en clair —
   * « 2026-03-12 » — puis les DÉCORE avant de les envoyer : chacune devient
   * { d, e }, où `e` est l'écart de la journée, ce qui sert à colorer les
   * points de la couronne. Les deux formes circulent donc, et comparer sans le
   * savoir donne zéro partout, sans lever : toutes les intersections sont
   * vides et le panneau conclut, très poliment, qu'aucune piste ne partage
   * rien. C'est exactement ce que l'application affichait.
   */
  const decore = {
    ...LECT,
    carte: {
      ...LECT.carte,
      noeuds: LECT.carte.noeuds.map(n => ({ ...n, jours: n.jours.map(d => ({ d, e: -1.2 })) }))
    }
  };
  const clair = poidsDuNoeud(LECT, 'Londres');
  const orne = poidsDuNoeud(decore, 'Londres');
  assert.deepEqual(orne.jours, clair.jours);
  assert.deepEqual(orne.pesees.map(x => [x.nom, x.partage]),
                   clair.pesees.map(x => [x.nom, x.partage]));
  assert.ok(orne.pesees.length, 'et surtout : pas zéro partout');
});

test('un nom absent de la carte ne rend rien plutôt qu’un objet vide', () => {
  assert.equal(poidsDuNoeud(LECT, 'fantôme'), null);
  assert.equal(poidsDuNoeud(null, 'Londres'), null);
});

/* ============ LA CARTE ET LA LISTE DÉSIGNENT LE MÊME ÎLOT ============ */

test('l’index d’un îlot est celui de sa piste, filtrage compris', () => {
  /*
   * LE CONTRAT QUI TIENT LES DEUX MOITIÉS DE LA PAGE. Survoler un groupe de
   * mécanismes allume son îlot sur la carte, et l'inverse — les deux se
   * désignent par un NUMÉRO, celui de la piste. La liste le pose en
   * `data-ilot` avec l'index du `forEach` sur les pistes ; la carte le pose en
   * `ilot` sur chaque nœud et en `i` sur chaque enveloppe.
   *
   * `versGraphe` FILTRE les îlots qui n'ont aucun nœud. S'il renumérotait au
   * passage, survoler « dépendance » en bas allumerait l'îlot d'à côté en
   * haut — et personne ne verrait que c'est faux, puisque quelque chose
   * s'allumerait quand même.
   */
  const pistes = [
    { nom: 'sans le moindre nœud', noeuds: [] },            // celle qui sera filtrée
    { nom: 'dépendance', noeuds: ['Léa', 'les nuits courtes'] },
    { nom: 'vide au travail', noeuds: ['le dimanche soir'] }
  ];
  const G = versGraphe(CARTE, pistes);

  // La première est absente des enveloppes, et les autres gardent LEUR index.
  assert.deepEqual(G.ilots.map(a => [a.i, a.nom]),
                   [[1, 'dépendance'], [2, 'vide au travail']]);
  // Et chaque nœud pointe sur l'index de la piste qui le revendique.
  assert.deepEqual(G.noeuds.map(n => n.ilot), [1, 1, 2]);
  for (const n of G.noeuds) {
    assert.ok(G.ilots.some(a => a.i === n.ilot),
              `le nœud « ${n.nom} » vise un îlot que la carte ne dessine pas`);
  }
});

test('le nom d’un îlot est celui de la piste, au caractère près', () => {
  // C'est ce qui fait qu'on reconnaît le même groupe en haut et en bas. Une
  // troncature, une majuscule ajoutée, et les deux moitiés se remettent à
  // parler de deux choses.
  const pistes = [{ nom: 'la peur d’être seul le soir', noeuds: ['Léa', 'les nuits courtes'] }];
  assert.equal(versGraphe(CARTE, pistes).ilots[0].nom, 'la peur d’être seul le soir');
});

test('la liste sous la carte et l’enveloppe sur la carte tiennent les mêmes nœuds', () => {
  /*
   * L'INCOHÉRENCE QU'ON NE POUVAIT PAS VOIR. La zone « dépendance » de la
   * toile tenait la weed et les anxios ; la colonne « dépendance » d'en dessous
   * tenait autre chose. Même titre, même couleur, deux contenus — et rien pour
   * s'en apercevoir, puisque les deux avaient l'air d'aller bien.
   *
   * Une seule appartenance est calculée, `ilotDesNoeuds`, et les deux moitiés
   * la lisent. Ce test tient la promesse par le seul bout qui compte : pour
   * chaque îlot, l'ensemble des noms qu'il dessine est l'ensemble des noms que
   * la liste écrirait sous son titre.
   */
  const pistes = [
    { nom: 'dépendance', noeuds: ['Léa', 'les nuits courtes', 'un nœud disparu'] },
    { nom: 'vide au travail', noeuds: ['le dimanche soir', 'Léa'] } // Léa est dans les deux
  ];
  const ilotDe = ilotDesNoeuds(CARTE, pistes);
  const G = versGraphe(CARTE, pistes);

  for (const a of G.ilots) {
    const surLaCarte = G.noeuds.filter(n => siensDe(n).includes(a.i)).map(n => n.nom).sort();
    // Ce que la liste écrit sous ce titre : le même filtre, depuis la carte brute.
    const enListe = CARTE.noeuds
      .filter(n => (ilotDe.get(String(n.nom).toLowerCase()) ?? []).includes(a.i))
      .map(n => n.nom).sort();
    assert.deepEqual(surLaCarte, enListe,
                     `« ${a.nom ?? 'sans nom'} » ne tient pas la même chose des deux côtés`);
  }
  // Et un nom que la carte ne porte pas ne compte nulle part.
  assert.equal(ilotDe.has('un nœud disparu'), false);
  // Un nœud revendiqué deux fois est dans les deux, des deux côtés — c'est
  // exactement ce recouvrement que la partition effaçait sans le dire.
  assert.deepEqual(ilotDe.get('léa'), [0, 1]);
});

test('ce qui n’est dans aucune piste est quand même sur la carte, sans titre', () => {
  /*
   * « s'il y a des nœuds un peu hors piste qui ne se retrouvent pas encore dans
   * une grande thématique, tu peux quand même les afficher sur la carte dans
   * des groupes séparés qui ne forment pas encore un îlot proprement
   * identifié. » Une enveloppe sans nom, donc — et un index qui ne peut pas
   * croiser celui d'une piste, sans quoi survoler l'une allumerait l'autre.
   */
  const carte = {
    noeuds: [...CARTE.noeuds,
             { nom: 'la salle de sport', genre: 'activite', poids: 2 },
             { nom: 'le mardi', genre: 'periode', poids: 1 }],
    liens: [...CARTE.liens,
            { de: 'la salle de sport', vers: 'le mardi', quoi: 'tombe', force: 2 }]
  };
  const G = versGraphe(carte, [{ nom: 'dépendance', noeuds: ['Léa', 'les nuits courtes'] }]);

  const sansNom = G.ilots.filter(a => a.nom == null);
  assert.equal(sansNom.length, 1);
  assert.ok(sansNom[0].i >= LIBRE, 'une grappe ne doit jamais porter l’index d’une piste');
  assert.deepEqual(G.noeuds.filter(n => n.ilot === sansNom[0].i).map(n => n.nom),
                   ['la salle de sport', 'le mardi']);
  // Le nœud qui n'a aucun voisin libre reste seul : deux, c'est un groupe, un, non.
  assert.equal(G.noeuds.find(n => n.nom === 'le dimanche soir').ilot, null);
});


/* ==================== LES ÎLOTS SE SERRENT VRAIMENT ====================
 *
 * « Les patterns ne sont pas regroupés en îlot. Pour l'instant ma carte c'est
 * un amas de points. » C'était vrai, et rien ne le voyait : les îlots étaient
 * CALCULÉS correctement — les tests plus haut le vérifient — puis la simulation
 * les refondait en une seule masse.
 *
 * La répulsion et les ressorts étaient GLOBAUX : deux nœuds se repoussaient
 * pareil qu'ils soient du même îlot ou non, et un lien tirait pareil qu'il
 * reste dedans ou traverse. Le rappel d'amas devait lutter seul contre les
 * deux, et il perdait dès que l'îlot dépassait quatre ou cinq nœuds —
 * c'est-à-dire sur les îlots NOMMÉS, les seuls qui portent une lecture.
 *
 * CE QUE CE TEST MESURE, ET CE QU'IL NE MESURE PAS. Il mesure le RAPPORT entre
 * la distance moyenne dedans et la distance moyenne dehors. Mesuré sur une
 * carte de la densité réelle : 3,9 avant, 6,0 après — les îlots se sont serrés
 * (86 px → 56 px de distance interne moyenne), pas éloignés (leurs centres
 * n'ont pas bougé). C'est bien ce qu'on voulait : sur un cadre fixe, la place
 * gagnée est celle qu'on prend à l'intérieur des groupes.
 *
 * Le seuil est posé ENTRE les deux mesures, et le test a été vérifié dans les
 * deux sens — avec les anciens coefficients réintroduits, il tombe.
 */
test('après la simulation, un îlot est nettement plus serré que l’espace entre îlots', () => {
  /*
   * La densité compte. Sur trois groupes de cinq bien séparés, les ANCIENS
   * coefficients passaient déjà : le défaut n'apparaît qu'à la densité d'une
   * vraie carte — huit amas, des tailles inégales, et des liens qui traversent.
   */
  const GROUPES = [
    ['a1', 'a2', 'a3', 'a4', 'a5'], ['b1', 'b2', 'b3', 'b4', 'b5'],
    ['c1', 'c2', 'c3', 'c4'], ['d1', 'd2', 'd3'], ['e1', 'e2', 'e3'],
    ['f1', 'f2'], ['g1', 'g2'], ['h1', 'h2']
  ];
  const noeuds = [];
  GROUPES.forEach((g, k) => g.forEach((nom, j) =>
    noeuds.push({ nom, amas: `piste:${k}`, jours: 3 + (j * 7) % 20 })));
  const idx = nom => noeuds.findIndex(n => n.nom === nom);

  const liens = [];
  for (const g of GROUPES) for (let i = 1; i < g.length; i++) {
    liens.push({ s: idx(g[i - 1]), t: idx(g[i]), force: 0.8 });
  }
  // Les liens qui TRAVERSENT : c'est eux qui fondaient deux îlots en un.
  for (const [a, b] of [['a1', 'b1'], ['a5', 'b5'], ['b3', 'c1'], ['c4', 'd1'], ['a3', 'c3']]) {
    liens.push({ s: idx(a), t: idx(b), force: 0.7 });
  }

  const dispo = disposer({ noeuds, liens }, 1180, 720);
  const moy = a => a.reduce((x, y) => x + y, 0) / a.length;
  const dedans = [], dehors = [];
  for (let i = 0; i < noeuds.length; i++) for (let j = i + 1; j < noeuds.length; j++) {
    const d = Math.hypot(dispo.pts[i].x - dispo.pts[j].x, dispo.pts[i].y - dispo.pts[j].y);
    (noeuds[i].amas === noeuds[j].amas ? dedans : dehors).push(d);
  }
  const rapport = moy(dehors) / moy(dedans);
  assert.ok(rapport > 5,
    `les îlots ne se serrent pas : dedans ${moy(dedans).toFixed(0)} px, dehors ${moy(dehors).toFixed(0)} px (rapport ${rapport.toFixed(2)})`);
});


/* ===================== CE QUI APPUIE UN ILOT =====================
 *
 * Trois nombres decident si une enveloppe se dessine. Ils ont ete ecrits parce
 * que le banc a montre qu'une poche est aussi pleine avec zero lien interne
 * qu'avec quatre-vingts -- l'enveloppe se calculant sur les POSITIONS, qui ne
 * savent rien des liens.
 */

/** Un graphe ou l'on choisit exactement qui est relie a qui. */
function carteDe(membres, aretes, pistes) {
  const noeuds = membres.map(nom => ({ nom, genre: 'activite', poids: 1, jours: [] }));
  const liens = aretes.map(([de, vers]) => ({ de, vers, quoi: 'précède', force: 2 }));
  return versGraphe({ noeuds, liens }, pistes);
}

test('l’appui compte ce qui reste dedans, la densite ce qui se touche', () => {
  // a-b-c relies en chaine, plus un lien qui sort vers d.
  const G = carteDe(['a', 'b', 'c', 'd'],
                    [['a', 'b'], ['b', 'c'], ['c', 'd']],
                    [{ nom: 'trois', teinte: 200, noeuds: ['a', 'b', 'c'] }]);
  const a = G.ilots.find(x => x.nom === 'trois');
  assert.equal(a.n, 3);
  assert.equal(a.dedans, 2);
  assert.equal(a.dehors, 1);
  assert.equal(a.densite, 2 / 3);          // 2 liens sur 3 paires possibles
  assert.equal(a.appui, 2 / 3);            // 2 dedans sur 3 liens touchant l'ilot
  assert.equal(a.part, 1);                 // une seule piece
});

test('un ilot plus relie au dehors qu’a lui-meme perd son enveloppe', () => {
  // « se faire petit », vu sur une vraie lecture : 1 lien dedans, 9 dehors.
  const G = carteDe(['x', 'y', 'z', 'hors'],
                    [['x', 'y'], ['x', 'hors'], ['y', 'hors'], ['z', 'hors']],
                    [{ nom: 'creux', teinte: 200, noeuds: ['x', 'y', 'z'] }]);
  const a = G.ilots.find(x => x.nom === 'creux');
  assert.equal(a.dedans, 1);
  assert.equal(a.dehors, 3);
  assert.ok(a.appui < SEUIL_APPUI, `appui ${a.appui}`);
  assert.equal(tenueDe(a), 0, 'pas d’enveloppe');
});

test('un ilot dont les membres ne se tiennent pas perd son enveloppe, meme avec un appui parfait', () => {
  /*
   * LE PIEGE QUE L'APPUI SEUL NE VOIT PAS. Six noeuds, UN lien interne, aucun
   * lien sortant : tout ce qui le relie reste dedans, donc appui = 1,00 —
   * pendant que cinq membres sur six ne touchent rien. C'est le cas « epars »
   * du banc fabrique, et sans la troisieme mesure il serait dessine a pleine
   * enveloppe.
   */
  const G = carteDe(['a', 'b', 'c', 'd', 'e', 'f'], [['a', 'b']],
                    [{ nom: 'eparse', teinte: 200, noeuds: ['a', 'b', 'c', 'd', 'e', 'f'] }]);
  const a = G.ilots.find(x => x.nom === 'eparse');
  assert.equal(a.appui, 1, 'rien ne sort, donc tout reste dedans');
  assert.equal(a.part, 2 / 6, 'et pourtant la plus grande piece n’en tient que deux');
  assert.ok(a.part < SEUIL_PART);
  assert.equal(tenueDe(a), 0);
});

test('un ilot dense et entier garde son enveloppe, a pleine force', () => {
  const G = carteDe(['a', 'b', 'c'], [['a', 'b'], ['b', 'c'], ['a', 'c']],
                    [{ nom: 'tenu', teinte: 200, noeuds: ['a', 'b', 'c'] }]);
  const a = G.ilots.find(x => x.nom === 'tenu');
  assert.equal(a.densite, 1);
  assert.equal(a.appui, 1);
  assert.equal(a.part, 1);
  assert.equal(tenueDe(a), 1);
});

test('la tenue monte avec l’appui, entre le seuil et un', () => {
  const faible = { appui: SEUIL_APPUI, part: 1 };
  const moyen  = { appui: (SEUIL_APPUI + 1) / 2, part: 1 };
  const plein  = { appui: 1, part: 1 };
  assert.equal(tenueDe(faible), 0);
  assert.ok(tenueDe(moyen) > 0.45 && tenueDe(moyen) < 0.55);
  assert.equal(tenueDe(plein), 1);
  assert.equal(tenueDe(undefined), 0, 'un ilot sans mesure ne se dessine pas');
});

test('appuyer ne compte que les liens de l’ilot vise', () => {
  const noeuds = [{ nom: 'a', ilot: 0 }, { nom: 'b', ilot: 0 },
                  { nom: 'c', ilot: 1 }, { nom: 'd', ilot: 1 }];
  const liens = [{ s: 0, t: 1 }, { s: 2, t: 3 }, { s: 1, t: 2 }];
  const [un, deux] = appuyer([{ i: 0 }, { i: 1 }], noeuds, liens);
  for (const a of [un, deux]) {
    assert.equal(a.dedans, 1);
    assert.equal(a.dehors, 1, 'le lien qui traverse compte pour les deux, dehors');
  }
});

test('un noeud hors de tout ilot ne compte dans aucun', () => {
  const [a] = appuyer([{ i: 0 }],
    [{ nom: 'a', ilot: 0 }, { nom: 'b', ilot: 0 }, { nom: 'seul', ilot: null }],
    [{ s: 0, t: 1 }]);
  assert.equal(a.n, 2);
  assert.equal(a.dedans, 1);
  assert.equal(a.dehors, 0);
});
