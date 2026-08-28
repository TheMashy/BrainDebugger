/**
 * La carte organique. Ce qui est testé est la traduction vers le moteur de
 * placement — le dessin, lui, se regarde.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { versGraphe, cadrer, couronne, journeeAu, recadrer, vueNeutre, versCarte, zoomer,
         contour, K_MIN, K_MAX, TEINTE_GENRE, NOM_GENRE } from '../web/relations.js';
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

test('les teintes des genres restent dans la bande DÉCLARÉE', () => {
  // « Ce qui est rempli est mesuré, ce qui est contouré est déclaré. » Cette
  // carte est entièrement déclarée : ses teintes ne doivent pas pouvoir se
  // confondre avec la rampe des notes, qui occupe le reste du cercle.
  const lo = Math.min(...TEINTES_DECLAREES), hi = Math.max(...TEINTES_DECLAREES);
  for (const [g, t] of Object.entries(TEINTE_GENRE)) {
    assert.ok(t >= lo - 12 && t <= hi + 12, `${g} = ${t}°, hors de la bande ${lo}-${hi}`);
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
  assert.equal(G.noeuds[0].amas, 'p0');
  assert.equal(G.noeuds[1].amas, 'p0');
  assert.equal(G.noeuds[0].ilot, 0);
  // Le troisième est dans la piste 1 : il porte son amas à elle.
  assert.equal(G.noeuds[2].amas, 'p1');
});

test('sans pistes, on retombe sur le regroupement par genre', () => {
  // C'est le bon défaut, et le seul possible tant qu'aucune lecture n'a tourné :
  // seize nœuds reliés dans tous les sens forment une pelote.
  const G = versGraphe(CARTE);
  assert.deepEqual(G.noeuds.map(n => n.amas), ['personne', 'corps', 'periode']);
  assert.deepEqual(G.noeuds.map(n => n.ilot), [null, null, null]);
  assert.deepEqual(G.ilots, []);
});

test('un nœud ne tombe que dans un seul îlot', () => {
  // Deux enveloppes qui se traversent effacent exactement ce qu'on venait
  // chercher sur la carte : des groupes qu'on distingue.
  const G = versGraphe(CARTE, [
    { nom: 'a', noeuds: ['Léa'] },
    { nom: 'b', noeuds: ['Léa', 'le dimanche soir'] }
  ]);
  assert.equal(G.noeuds[0].ilot, 0, 'le premier îlot garde le nœud');
  assert.equal(G.noeuds[2].ilot, 1);
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
