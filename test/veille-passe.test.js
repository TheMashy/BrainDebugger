/*
 * LA VEILLE DEVANT LE PASSÉ RACONTÉ.
 *
 * Quatre-vingt-sept phrases, écrites comme on les écrit le soir : des récits de
 * trauma ancien qui ne doivent PAS être rouges (jaune « évoqué », ou rien), des
 * crises présentes qui DOIVENT le rester, et des métaphores qui ne sont rien.
 * Chaque phrase porte le verdict attendu et sa raison (test/veille-cas.json).
 *
 * L'asymétrie est écrite ici : un rouge attendu et manqué est un ÉCHEC ; un
 * jaune attendu rendu rouge est un échec aussi — mais le premier se corrige
 * toujours, quitte à laisser passer des seconds.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { niveauDuTexte } from '../server/veille.js';

const CAS = JSON.parse(readFileSync(new URL('./veille-cas.json', import.meta.url), 'utf-8'));
const obtenu = c => niveauDuTexte(c.phrase, { aujourdhui: c.aujourdhui ?? '2026-09-05' }).niveau ?? 'rien';

test('aucune crise présente n’est rétrogradée (les rouges attendus restent rouges)', () => {
  const rates = CAS.filter(c => c.attendu === 'rouge' && obtenu(c) !== 'rouge');
  assert.deepEqual(rates.map(c => `${c.phrase} → ${obtenu(c)}`), []);
});

test('un trauma raconté au passé n’est pas un rouge (jaune ou rien)', () => {
  const faux = CAS.filter(c => c.attendu !== 'rouge' && obtenu(c) === 'rouge');
  assert.deepEqual(faux.map(c => `${c.phrase} → rouge (attendu ${c.attendu})`), []);
});

test('ce qui n’est rien reste rien', () => {
  const faux = CAS.filter(c => c.attendu === 'rien' && obtenu(c) !== 'rien');
  assert.deepEqual(faux.map(c => `${c.phrase} → ${obtenu(c)}`), []);
});
