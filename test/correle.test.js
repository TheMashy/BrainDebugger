/**
 * CORRÉLER : les mots du log d'une journée mis en face de sa note.
 *
 * Module pur, testé sans base : mêmes lignes en entrée, même lien en sortie.
 * On vérifie le sens de l'écart, la présence par JOUR (pas par occurrence), le
 * plancher de journées et le silence sous le bruit.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { correlations, valeurDuJour } from '../server/correlations.js';

// base des notes = (2+3+8+9+5+6)/6 = 5.5
const JOURS = [
  { date: '2026-01-01', note: 2, text: 'pluie grise fatigue' },
  { date: '2026-01-02', note: 3, text: 'pluie encore pluie pluie' },   // pluie x3, un seul jour
  { date: '2026-01-03', note: 8, text: 'soleil energie' },
  { date: '2026-01-04', note: 9, text: 'soleil marche dehors' },
  { date: '2026-01-05', note: 5, text: 'journee ordinaire travail' },
  { date: '2026-01-06', note: 6, text: 'ordinaire travail encore' },
];

test('le sens de l’écart : un mot des mauvais jours plonge, un mot des bons jours monte', () => {
  const r = correlations(JOURS, { min: 2 });
  assert.equal(r.assez, true);
  assert.equal(r.base, 5.5);

  const pluie = r.baisses.find(x => x.terme === 'pluie');
  const soleil = r.hausses.find(x => x.terme === 'soleil');
  assert.ok(pluie, 'pluie tombe du côté des baisses');
  assert.ok(soleil, 'soleil monte du côté des hausses');
  assert.equal(pluie.moyenne, 2.5);     // (2+3)/2
  assert.equal(pluie.ecart, -3);        // 2.5 - 5.5
  assert.equal(soleil.moyenne, 8.5);    // (8+9)/2
  assert.equal(soleil.ecart, 3);        // 8.5 - 5.5
});

test('présence par JOUR, jamais par occurrence : pluie répétée reste deux journées', () => {
  const r = correlations(JOURS, { min: 2 });
  const pluie = r.baisses.find(x => x.terme === 'pluie');
  assert.equal(pluie.jours, 2, 'le 2 janvier compte une fois malgré les trois « pluie »');
});

test('sous le plancher de journées, un terme ne sort pas', () => {
  const r = correlations(JOURS, { min: 3 });
  // « soleil » et « pluie » n'ont que deux journées chacun : à min=3 ils tombent.
  assert.ok(!r.hausses.some(x => x.terme === 'soleil'));
  assert.ok(!r.baisses.some(x => x.terme === 'pluie'));
});

test('un écart dans le bruit ne s’affiche pas', () => {
  const r = correlations(JOURS, { min: 2 });
  // « travail » est sur les jours 5 et 6 (notes 5 et 6) : moyenne 5.5 = la base,
  // écart nul — il ne doit apparaître nulle part.
  const partout = [...r.hausses, ...r.baisses].map(x => x.terme);
  assert.ok(!partout.includes('travail'), 'écart nul ⇒ silence');
});

test('pas assez de journées : on le dit, on n’invente pas de lien', () => {
  const r = correlations(JOURS.slice(0, 3), { min: 2 });   // 3 jours < min*2
  assert.equal(r.assez, false);
  assert.equal(r.nJours, 3);
  assert.deepEqual(r.hausses, []);
  assert.deepEqual(r.baisses, []);
});

test('les journées sans texte ou sans note sont écartées du calcul', () => {
  const avecTrous = [
    ...JOURS,
    { date: '2026-01-07', note: null, text: 'soleil soleil soleil' },  // pas de note
    { date: '2026-01-08', note: 10, text: '' },                        // pas de texte
  ];
  const r = correlations(avecTrous, { min: 2 });
  assert.equal(r.nJours, 6, 'seules les six journées complètes comptent');
  assert.equal(r.base, 5.5, 'la note 10 sans texte ne déplace pas la base');
});

test('valeurDuJour lit la note, ou une mesure quantified-self attachée', () => {
  assert.equal(valeurDuJour({ note: 7 }), 7);
  assert.ok(Number.isNaN(valeurDuJour({ note: null })));
  assert.equal(valeurDuJour({ mesures: { sommeil: 6.5 } }, 'sommeil'), 6.5);
  assert.ok(Number.isNaN(valeurDuJour({ mesures: {} }, 'sommeil')));
});

test('corréler sur une mesure quantified-self, pas seulement la note', () => {
  const rows = [
    { date: '2026-02-01', note: 5, text: 'ecran toute la soiree', mesures: { sommeil: 5 } },
    { date: '2026-02-02', note: 5, text: 'ecran ecran', mesures: { sommeil: 5.5 } },
    { date: '2026-02-03', note: 5, text: 'dehors marche', mesures: { sommeil: 8 } },
    { date: '2026-02-04', note: 5, text: 'dehors air', mesures: { sommeil: 8.5 } },
  ];
  const r = correlations(rows, { min: 2, metrique: 'sommeil' });
  assert.equal(r.metrique, 'sommeil');
  assert.equal(r.base, 6.75);                               // (5+5.5+8+8.5)/4
  assert.ok(r.baisses.find(x => x.terme === 'ecran'), 'l’écran va avec moins de sommeil');
  assert.ok(r.hausses.find(x => x.terme === 'dehors'), 'dehors va avec plus de sommeil');
});
