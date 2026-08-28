/**
 * La carte organique. Ce qui est testé est la traduction vers le moteur de
 * placement — le dessin, lui, se regarde.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { versGraphe, cadrer, couronne, TEINTE_GENRE, NOM_GENRE } from '../web/relations.js';
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
