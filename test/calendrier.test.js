import test from 'node:test';
import assert from 'node:assert/strict';
import { grilleMois, decalerMois, calMarkup, calClic, moisDe, estDate } from '../web/calendrier.js';

/* ----------------------------- la grille ----------------------------- */

test('un mois fait toujours six semaines pleines', () => {
  // Une hauteur qui change en changeant de mois fait sauter le panneau sous
  // le curseur au moment ou on vise une case.
  for (const m of ['2026-02', '2026-08', '2024-02', '2021-05']) {
    assert.equal(grilleMois(m).length, 42, m);
  }
});

test('la semaine commence le lundi', () => {
  // 1er août 2026 = samedi. La grille doit donc s'ouvrir le lundi 27 juillet.
  assert.equal(grilleMois('2026-08')[0].date, '2026-07-27');
  // 1er juin 2026 = lundi : pas de débordement à gauche.
  assert.equal(grilleMois('2026-06')[0].date, '2026-06-01');
});

test('les jours des mois voisins sont marqués « hors »', () => {
  const g = grilleMois('2026-08');
  assert.equal(g[0].hors, true);
  assert.equal(g.find(c => c.date === '2026-08-01').hors, false);
  assert.equal(g.filter(c => !c.hors).length, 31);
});

test('décaler un mois ne déborde ni à 12 ni à 0', () => {
  assert.equal(decalerMois('2026-12', 1), '2027-01');
  assert.equal(decalerMois('2026-01', -1), '2025-12');
  assert.equal(decalerMois('2026-03', -12), '2025-03');
  assert.equal(decalerMois('2026-01', -144), '2014-01');
});

test('le 31 janvier moins un mois ne devient pas le 3 mars', () => {
  // Le piège classique de setMonth() sur une Date : février n'a pas de 31.
  assert.equal(decalerMois('2026-01', 1), '2026-02');
  assert.equal(decalerMois('2026-03', -1), '2026-02');
});

/* ---------------------------- la sélection ---------------------------- */

const E = (p = {}) => ({ vue: 'jour', curseur: '2026-08', debut: null, fin: null, plage: false, ...p });

test('sans plage, un clic remplace la date', () => {
  let e = calClic(E(), { cal: 'jour', d: '2026-08-10' });
  assert.equal(e.debut, '2026-08-10');
  e = calClic(e, { cal: 'jour', d: '2026-08-14' });
  assert.deepEqual([e.debut, e.fin], ['2026-08-14', null]);
});

test('une plage se trace en deux clics', () => {
  let e = calClic(E({ plage: true }), { cal: 'jour', d: '2026-08-04' });
  e = calClic(e, { cal: 'jour', d: '2026-08-20' });
  assert.deepEqual([e.debut, e.fin], ['2026-08-04', '2026-08-20']);
});

test('cliquer la fin avant le début dit la même chose', () => {
  // Refuser aurait appris à la personne quelque chose qu'elle savait déjà.
  let e = calClic(E({ plage: true }), { cal: 'jour', d: '2026-08-20' });
  e = calClic(e, { cal: 'jour', d: '2026-08-04' });
  assert.deepEqual([e.debut, e.fin], ['2026-08-04', '2026-08-20']);
});

test('un troisième clic recommence la plage', () => {
  let e = E({ plage: true, debut: '2026-08-04', fin: '2026-08-20' });
  e = calClic(e, { cal: 'jour', d: '2026-08-12' });
  assert.deepEqual([e.debut, e.fin], ['2026-08-12', null]);
});

test('recliquer le début seul l’efface plutôt que de faire une plage nulle', () => {
  let e = E({ plage: true, debut: '2026-08-04' });
  e = calClic(e, { cal: 'jour', d: '2026-08-04' });
  assert.equal(e.fin, null);
});

/* ---------------------------- la navigation ---------------------------- */

test('trois clics suffisent pour aller n’importe où', () => {
  // Un repère d'enfance sur un calendrier qui n'avance que d'un mois demande
  // trois cent trente-six clics.
  let e = E();
  e = calClic(e, { cal: 'vue-an' });
  assert.equal(e.vue, 'an');
  e = calClic(e, { cal: 'an', a: 1998 });
  assert.deepEqual([e.vue, e.curseur], ['mois', '1998-08']);
  e = calClic(e, { cal: 'mois', m: 4 });
  assert.deepEqual([e.vue, e.curseur], ['jour', '1998-04']);
});

test('les flèches changent de pas selon le niveau ouvert', () => {
  assert.equal(calClic(E(), { cal: 'suiv' }).curseur, '2026-09');
  assert.equal(calClic(E({ vue: 'mois' }), { cal: 'suiv' }).curseur, '2027-08');
  assert.equal(calClic(E({ vue: 'an' }), { cal: 'suiv' }).curseur, '2038-08');
});

/* ------------------------------ le markup ------------------------------ */

test('les bornes désactivent les cases hors domaine', () => {
  const html = calMarkup({ curseur: '2026-08', min: '2026-08-05', max: '2026-08-20' });
  assert.match(html, /data-d="2026-08-04"[^>]*disabled/);
  assert.doesNotMatch(html, /data-d="2026-08-10"[^>]*disabled/);
});

test('la plage sélectionnée marque ses bornes et son intérieur', () => {
  const html = calMarkup({ curseur: '2026-08', plage: true, debut: '2026-08-04', fin: '2026-08-08' });
  assert.match(html, /class="calj borne lo"[^>]*data-d="2026-08-04"/);
  assert.match(html, /class="calj borne hi"[^>]*data-d="2026-08-08"/);
  assert.match(html, /class="calj entre"[^>]*data-d="2026-08-06"/);
  assert.doesNotMatch(html, /class="calj entre"[^>]*data-d="2026-08-09"/);
});

test('le mois du max reste atteignable même si son 31 le dépasse', () => {
  const html = calMarkup({ vue: 'mois', curseur: '2026-08', max: '2026-08-27' });
  assert.doesNotMatch(html, /data-m="8"[^>]*disabled/);
  assert.match(html, /data-m="9"[^>]*disabled/);
});

test('aucune injection ne passe par la couleur d’une journée', () => {
  const html = calMarkup({ curseur: '2026-08', jour: () => ({ couleur: '"><script>x</script>' }) });
  assert.doesNotMatch(html, /<script/);
});

test('moisDe et estDate ne se laissent pas avoir', () => {
  assert.equal(estDate('lol'), false);
  assert.equal(estDate('2026-08-27'), true);
  assert.equal(moisDe(null, '2026-08'), '2026-08');
  assert.equal(moisDe('2021-03-02', '2026-08'), '2021-03');
});
