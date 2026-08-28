/**
 * L'heure devant chaque message.
 *
 * Le compagnon ne pouvait pas savoir qu'on lui écrivait à trois heures du
 * matin, ni que sept heures s'étaient écoulées depuis la dernière phrase —
 * alors que c'est ce qu'on remarque en premier chez quelqu'un qu'on connaît.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { marqueTemps, SYSTEM_PROMPT } from '../server/chat.js';

test('le marqueur porte le jour et l’heure', () => {
  const t = marqueTemps(new Date(2026, 7, 12, 3, 14).toISOString());
  assert.match(t, /^mer\. 12\/08 03:14$/);
});

test('minuit et midi ne se confondent pas', () => {
  // Le cas qui compte : c'est précisément l'heure où l'on écrit ce qu'on
  // n'écrit pas en plein jour.
  assert.match(marqueTemps(new Date(2026, 0, 1, 0, 5).toISOString()), /00:05$/);
  assert.match(marqueTemps(new Date(2026, 0, 1, 12, 5).toISOString()), /12:05$/);
});

test('une date illisible ne produit pas de marqueur', () => {
  // Sans ça, un « [Invalid Date] » se retrouverait collé devant une phrase.
  assert.equal(marqueTemps('pas une date'), null);
  assert.equal(marqueTemps(''), null);
  assert.equal(marqueTemps(undefined), null);
});

test('la consigne interdit de recopier le marqueur', () => {
  // Un compagnon qui préfixe ses réponses de l'heure a l'air d'un journal
  // système, pas de quelqu'un.
  assert.match(SYSTEM_PROMPT, /ne le recopies jamais/);
  assert.match(SYSTEM_PROMPT, /tu ne sais pas s'il dormait/);
});
