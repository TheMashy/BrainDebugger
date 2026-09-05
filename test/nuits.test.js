/*
 * LES NUITS, LUES DANS L'ACTIVITÉ DU POSTE.
 *
 * Ce qui est testé : un ordinateur éteint la nuit, un ordinateur laissé
 * allumé (le trou qui s'ouvre après minuit), un redémarrage nocturne qui
 * n'est pas un lever, un verre d'eau qui ne coupe pas la nuit, et un poste
 * qui contredit le clavier — auquel cas la nuit le DIT.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { nuitDuJour } from '../server/nuits.js';

const dig = (o = {}) => ({ date: '2026-09-05', plage: { de: '08:02', a: '23:41' }, trous: [], ...o });
const veille = (o = {}) => ({ date: '2026-09-04', plage: { de: '07:50', a: '23:30' }, trous: [], ...o });

test('ordinateur éteint la nuit : dernière touche de la veille → première du matin', () => {
  const n = nuitDuJour(dig(), veille());
  assert.equal(n.coucher, '23:30'); assert.equal(n.lever, '08:02'); assert.equal(n.sommeil_h, 8.5); assert.equal(n.source, 'activite'); assert.equal(n.souci, null);
});

test('ordinateur laissé allumé : le trou qui s’ouvre après minuit est la nuit', () => {
  // Encore debout à 00:40, puis rien jusqu’à 07:55 ; la veille finit à 23:59 et le jour commence à 00:05.
  const n = nuitDuJour(dig({ plage: { de: '00:05', a: '22:10' }, trous: [{ de: '00:40', a: '07:55', minutes: 435 }] }), veille({ plage: { de: '08:00', a: '23:59' } }));
  assert.equal(n.coucher, '00:40'); assert.equal(n.lever, '07:55'); assert.equal(n.sommeil_h, 7.3);
});

test('un redémarrage sans personne devant n’est pas un lever : le poste ne gagne que s’il colle au clavier', () => {
  // Machi Tool a apparié un démarrage automatique à 00:30 ; le clavier dit 23:30 → 08:02.
  const n = nuitDuJour(dig({ poste: { coucher: '23:30', reveil: '00:30', sommeil_h: 1.0 } }), veille());
  assert.equal(n.coucher, '23:30'); assert.equal(n.lever, '08:02'); assert.equal(n.sommeil_h, 8.5);
  assert.match(n.souci, /le poste dit 1 h/);
});

test('un verre d’eau à 4 h ne coupe pas la nuit', () => {
  const n = nuitDuJour(dig({ plage: { de: '04:02', a: '23:00' }, trous: [{ de: '04:10', a: '08:00', minutes: 230 }] }), veille({ plage: { de: '08:00', a: '23:45' } }));
  // 23:45 → 04:02 puis 04:10 → 08:00 : une seule nuit, 8 h 07 moins les 8 minutes debout.
  assert.equal(n.coucher, '23:45'); assert.equal(n.lever, '08:00'); assert.equal(n.sommeil_h, 8.1);
});

test('sans veille ni trou, le poste apparié par Machi Tool sert tel quel', () => {
  const n = nuitDuJour({ date: '2026-09-05', poste: { coucher: '00:23', reveil: '05:41', sommeil_h: 5.3 } }, null);
  assert.equal(n.coucher, '00:23'); assert.equal(n.lever, '05:41'); assert.equal(n.sommeil_h, 5.3); assert.equal(n.source, 'poste');
});

test('un silence de vingt heures n’est pas une nuit : un week-end sans ordinateur reste inconnu', () => {
  const n = nuitDuJour(dig({ plage: { de: '19:30', a: '23:00' } }), veille({ plage: { de: '08:00', a: '23:00' } }));
  assert.equal(n, null);
});

test('ce qui ne colle pas se dit, en une phrase', () => {
  const n = nuitDuJour(dig({ plage: { de: '02:10', a: '23:00' }, trous: [] }), veille({ plage: { de: '08:00', a: '22:00' } }));
  assert.equal(n.lever, '02:10'); assert.match(n.souci, /un lever à 02:10/);
});

test('sans digest du jour, pas de nuit', () => {
  assert.equal(nuitDuJour(null, veille()), null);
});
